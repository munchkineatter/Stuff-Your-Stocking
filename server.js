import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { DEFAULT_SETTINGS, applyAction, boardView, emptyGame, normalizeSettings } from './public/js/game.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;
const HOST_PIN = process.env.HOST_PIN || '';
const DATA_FILE = path.join(process.env.DATA_DIR || path.join(ROOT, 'data'), 'state.json');
const MAX_UNDO = 100;
const secureRandom = () => crypto.randomInt(2 ** 32) / 2 ** 32;

if (!HOST_PIN) console.warn('⚠  HOST_PIN is not set — anyone can control the game. Set it before going live.');

// ---------- state + persistence ----------

let state = { settings: normalizeSettings(DEFAULT_SETTINGS), game: emptyGame(), history: [] };

try {
  const saved = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
  state = {
    settings: normalizeSettings(saved.settings),
    game: { ...emptyGame(), ...saved.game },
    history: Array.isArray(saved.history) ? saved.history.slice(-MAX_UNDO) : [],
  };
  console.log(`Loaded saved state from ${DATA_FILE}`);
} catch (err) {
  if (err.code !== 'ENOENT') console.error('Could not load saved state, starting fresh:', err.message);
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
      const tmp = `${DATA_FILE}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(state));
      await fs.rename(tmp, DATA_FILE); // atomic: never leaves a half-written file
    } catch (err) {
      console.error('Failed to save state:', err.message);
    }
  }, 250);
}

// ---------- static files ----------

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const ROUTES = { '/': 'index.html', '/host': 'host.html' };

async function serveStatic(req, res) {
  const { pathname } = new URL(req.url, 'http://x');
  if (pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
  }
  const rel = ROUTES[pathname] ?? decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  }
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end();
  }
  serveStatic(req, res).catch(() => {
    res.writeHead(500);
    res.end();
  });
});

// ---------- realtime ----------

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

const pinOk = (pin) => {
  if (!HOST_PIN) return true;
  const a = crypto.createHash('sha256').update(String(pin ?? '')).digest();
  const b = crypto.createHash('sha256').update(HOST_PIN).digest();
  return crypto.timingSafeEqual(a, b);
};

const displayView = () => ({
  t: 'display',
  title: state.settings.title,
  columns: state.settings.columns,
  theme: state.settings.theme,
  board: boardView(state.settings, state.game),
});
const hostView = () => ({ t: 'host', settings: state.settings, game: state.game, canUndo: state.history.length > 0 });

const send = (ws, msg) => ws.readyState === ws.OPEN && ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));

function broadcast() {
  const d = JSON.stringify(displayView());
  const h = JSON.stringify(hostView());
  for (const ws of wss.clients) {
    if (ws.role === 'host') send(ws, h);
    else if (ws.role === 'display') send(ws, d);
  }
  scheduleSave();
}

function handleHost(ws, msg) {
  switch (msg.t) {
    case 'action': {
      const next = applyAction(state.game, msg.action, state.settings, secureRandom);
      // Editing the offer amount isn't a step worth undoing on its own.
      if (msg.action.type !== 'setOffer') state.history = [...state.history, state.game].slice(-MAX_UNDO);
      state.game = next;
      break;
    }
    case 'undo':
      if (!state.history.length) throw new Error('Nothing to undo.');
      state.game = state.history.at(-1);
      state.history = state.history.slice(0, -1);
      break;
    case 'settings':
      state.settings = normalizeSettings(msg.settings);
      break;
    default:
      throw new Error('Unknown message.');
  }
  broadcast();
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.t === 'hello') {
      if (msg.role === 'host') {
        if (!pinOk(msg.pin)) return send(ws, { t: 'auth', ok: false });
        ws.role = 'host';
        send(ws, { t: 'auth', ok: true });
        return send(ws, hostView());
      }
      ws.role = 'display';
      return send(ws, displayView());
    }
    if (ws.role !== 'host') return send(ws, { t: 'error', message: 'Not authorized.' });
    try {
      handleHost(ws, msg);
    } catch (err) {
      send(ws, { t: 'error', message: err.message });
    }
  });
});

// Drop connections that silently died (e.g. a laptop lid closed) so they don't pile up.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);
wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`🎄 Stuff Your Stocking running on http://localhost:${PORT}`);
  console.log(`   Audience board: /   Host controls: /host`);
});
