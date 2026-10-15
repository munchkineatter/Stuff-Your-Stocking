import { connect, money } from './socket.js';

const boardEl = document.getElementById('board');
const statusEl = document.getElementById('status');
const statusText = document.getElementById('statusText');
const root = document.documentElement.style;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const rand = (min, max) => min + Math.random() * (max - min);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

let layoutKey = '';
let cells = [];

function render(view) {
  document.title = view.title;
  root.setProperty('--bg', view.theme.background);
  root.setProperty('--accent', view.theme.accent);
  setSnow(view.theme.snow);
  setLights(view.theme.lights);
  glintsOn = view.theme.glints;

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
    el.classList.remove('just-out', 'glint');
    if (p.out) {
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
      el.textContent = el.dataset.text = money(p.value);
      col.append(el);
      cells.push(el);
    }
    boardEl.append(col);
  }
}

// ---------- snow: far / mid layers behind the board, a few near flakes in front ----------

const SNOW_LAYERS = [
  { name: 'far',  parent: 'snowBack',  count: 45, size: [0.3, 0.65], fall: [16, 26], opacity: [0.25, 0.5],  sway: [8, 18],  chars: ['•', '•', '❄'] },
  { name: 'mid',  parent: 'snowBack',  count: 30, size: [0.8, 1.4],  fall: [9, 15],  opacity: [0.45, 0.8],  sway: [18, 40], chars: ['❄', '❅', '❆', '✻', '✼'] },
  { name: 'near', parent: 'snowFront', count: 8,  size: [2, 3.2],    fall: [6, 9],   opacity: [0.2, 0.4],   sway: [40, 80], chars: ['❄', '❅', '❆'] },
];

let snowOn = null;
function setSnow(on) {
  if (on === snowOn) return;
  snowOn = on;
  for (const id of ['snowBack', 'snowFront']) document.getElementById(id).replaceChildren();
  if (!on) return;
  for (const layer of SNOW_LAYERS) {
    const parent = document.getElementById(layer.parent);
    for (let i = 0; i < layer.count; i++) {
      const flake = document.createElement('div');
      flake.className = `flake ${layer.name}`;
      const fall = rand(...layer.fall);
      flake.style.left = `${rand(-2, 100)}%`;
      flake.style.animationDuration = `${fall}s`;
      flake.style.animationDelay = `${-rand(0, fall)}s`; // negative: already mid-fall on load
      const inner = document.createElement('span');
      inner.textContent = pick(layer.chars);
      inner.style.fontSize = `${rand(...layer.size)}rem`;
      inner.style.opacity = rand(...layer.opacity).toFixed(2);
      inner.style.setProperty('--sway', `${rand(...layer.sway)}px`);
      inner.style.animationDuration = `${rand(2.5, 6)}s`;
      inner.style.animationDelay = `${-rand(0, 6)}s`;
      flake.append(inner);
      parent.append(flake);
    }
  }
}

// ---------- string lights around the edges ----------

const BULB_COLORS = ['#ff3b30', '#2ee65e', '#ffd23f', '#3fa9ff', '#ff7ad9'];
const BULB_SPACING = 52; // px between bulbs
const EDGE = 40;         // px reserved on each side when lights are on

let lightsOn = null;
function setLights(on) {
  if (on === lightsOn) return;
  lightsOn = on;
  root.setProperty('--edge', on ? `${EDGE}px` : '0px');
  buildLights();
}

function buildLights() {
  const wrap = document.getElementById('lights');
  wrap.replaceChildren();
  if (!lightsOn) return;
  const w = innerWidth;
  const h = innerHeight - 2 * EDGE;
  let n = 0; // running index so colors and the chase continue around the corners
  for (const [side, length] of [['top', w], ['right', h], ['bottom', w], ['left', h]]) {
    const strand = document.createElement('div');
    strand.className = `strand ${side}`;
    const count = Math.max(2, Math.round(length / BULB_SPACING));
    for (let i = 0; i < count; i++, n++) {
      const bulb = document.createElement('i');
      bulb.className = 'bulb';
      bulb.style.setProperty('--c', BULB_COLORS[n % BULB_COLORS.length]);
      bulb.style.setProperty('--d', `${-(n % 3) * 0.8}s`); // three groups → chasing pattern
      strand.append(bulb);
    }
    wrap.append(strand);
  }
}

let resizeTimer;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(buildLights, 200);
});

// ---------- glints: a sparkle sweeps across a random remaining prize ----------

let glintsOn = false;
function glint() {
  setTimeout(glint, rand(1800, 3800));
  if (!glintsOn || reducedMotion.matches || document.hidden) return;
  const candidates = cells.filter((el) => !el.classList.contains('out') && !el.classList.contains('glint'));
  if (!candidates.length) return;
  const el = pick(candidates);
  el.classList.add('glint');
  setTimeout(() => el.classList.remove('glint'), 1150);
  // Star pops near the end of the sweep.
  setTimeout(() => {
    if (el.classList.contains('out')) return;
    const star = document.createElement('span');
    star.className = 'sparkle';
    star.textContent = '✦';
    star.style.left = `${rand(5, 85)}%`;
    star.style.top = `${rand(-25, 5)}%`;
    el.append(star);
    star.addEventListener('animationend', () => star.remove());
  }, 650);
}
glint();

// ---------- connection ----------

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
