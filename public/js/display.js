import { connect, money } from './socket.js';

const boardEl = document.getElementById('board');
const snowEl = document.getElementById('snow');
const statusEl = document.getElementById('status');
const statusText = document.getElementById('statusText');
const root = document.documentElement.style;

let layoutKey = '';
let cells = [];

function render(view) {
  document.title = view.title;
  root.setProperty('--bg', view.theme.background);
  root.setProperty('--accent', view.theme.accent);
  setSnow(view.theme.snow);

  // Only rebuild the DOM when the set of prizes or the layout changes;
  // otherwise just toggle classes so the CSS transitions play.
  const key = `${view.columns}|${view.board.map((p) => p.value).join(',')}`;
  if (key !== layoutKey) {
    layoutKey = key;
    buildBoard(view);
    return;
  }
  view.board.forEach((p, i) => {
    const el = cells[i];
    if (p.out === el.classList.contains('out')) return;
    el.classList.toggle('out', p.out);
    if (p.out) {
      el.classList.remove('just-out');
      void el.offsetWidth; // restart the animation
      el.classList.add('just-out');
    }
  });
}

function buildBoard({ board, columns }) {
  const cols = Math.min(columns, board.length);
  const rows = Math.ceil(board.length / cols);
  root.setProperty('--cols', cols);
  root.setProperty('--rows', rows);
  boardEl.replaceChildren();
  cells = [];
  for (let c = 0; c < cols; c++) {
    const col = document.createElement('div');
    col.className = c < Math.ceil(cols / 2) ? 'col' : 'col right';
    for (const p of board.slice(c * rows, (c + 1) * rows)) {
      const el = document.createElement('div');
      el.className = p.out ? 'prize out' : 'prize';
      el.textContent = money(p.value);
      col.append(el);
      cells.push(el);
    }
    boardEl.append(col);
  }
}

let snowOn = null;
function setSnow(on) {
  if (on === snowOn) return;
  snowOn = on;
  snowEl.replaceChildren();
  if (!on) return;
  const chars = ['❄', '❅', '❆', '✻', '✼', '•'];
  for (let i = 0; i < 60; i++) {
    const f = document.createElement('span');
    f.className = 'flake';
    f.textContent = chars[(Math.random() * chars.length) | 0];
    f.style.left = `${Math.random() * 100}%`;
    f.style.fontSize = `${Math.random() * 1.5 + 0.5}rem`;
    f.style.opacity = (Math.random() * 0.5 + 0.2).toFixed(2);
    f.style.animationDuration = `${Math.random() * 8 + 6}s`;
    f.style.animationDelay = `${-Math.random() * 14}s`; // negative: already mid-fall on load
    snowEl.append(f);
  }
}

connect({
  onOpen: (send) => send({ t: 'hello', role: 'display' }),
  onMessage: (msg) => msg.t === 'display' && render(msg),
  onStatus: (up) => {
    statusEl.classList.toggle('down', !up);
    statusText.textContent = up ? 'Live' : 'Reconnecting…';
  },
});

// Fullscreen on double-click or F; keep the screen awake during the show.
const toggleFullscreen = () =>
  document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
document.addEventListener('dblclick', toggleFullscreen);
document.addEventListener('keydown', (e) => e.key.toLowerCase() === 'f' && toggleFullscreen());

async function keepAwake() {
  try {
    await navigator.wakeLock?.request('screen');
  } catch {}
}
keepAwake();
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && keepAwake());
