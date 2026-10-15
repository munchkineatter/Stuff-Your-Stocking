import { connect, money } from './socket.js';
import {
  DEFAULT_SETTINGS, activeSchedule, effectiveSchedule, normalizeSettings,
  othersRemaining, parseNumberList, remainingPrizes,
} from './game.js';

const $ = (id) => document.getElementById(id);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

let current = null; // last host view from the server: { settings, game, canUndo }
let pin = store.get('sys-pin') || '';

// ---------- connection + auth ----------

const send = connect({
  onOpen: (s) => s({ t: 'hello', role: 'host', pin }),
  onStatus: (up) => {
    $('conn').classList.toggle('down', !up);
    $('connText').textContent = up ? 'Live' : 'Reconnecting…';
    document.body.classList.toggle('offline', !up);
  },
  onMessage: (msg) => {
    if (msg.t === 'auth') {
      if (msg.ok) {
        $('login').close();
        store.set('sys-pin', pin);
      } else {
        $('loginError').hidden = !pin;
        if (!$('login').open) $('login').showModal();
      }
    } else if (msg.t === 'host') {
      current = msg;
      renderGame();
      if (!settingsDirty) fillSettings(current.settings);
    } else if (msg.t === 'error') {
      toast(msg.message, true);
    }
  },
});

$('loginForm').addEventListener('submit', () => {
  pin = $('pin').value;
  send({ t: 'hello', role: 'host', pin });
});
$('login').addEventListener('cancel', (e) => e.preventDefault());

const act = (action) => send({ t: 'action', action });

// ---------- tabs ----------

document.querySelectorAll('[role=tab]').forEach((btn) =>
  btn.addEventListener('click', () => {
    document.querySelectorAll('[role=tab]').forEach((b) => b.setAttribute('aria-selected', b === btn));
    document.querySelectorAll('.tab').forEach((t) => (t.hidden = t.id !== `tab-${btn.dataset.tab}`));
  }),
);

// ---------- game rendering ----------

function renderGame() {
  const { game, settings, canUndo } = current;
  $('title').textContent = settings.title;
  document.title = `Host · ${settings.title}`;

  renderBanner(game);
  renderCases(game);
  renderSide(game);

  $('undoBtn').disabled = !canUndo;
}

function renderBanner(game) {
  const b = $('banner');
  const left = game.toOpen - game.openedThisRound;
  const rounds = game.schedule.length ? effectiveSchedule(game.schedule, game.cases.length).length : 0;
  const text = {
    idle: 'Press <b>New game</b> to shuffle the cases.',
    pick: 'Contestant: <b>pick your case</b>.',
    open: `Round ${game.round} of ${rounds} — open <b>${left}</b> more case${left === 1 ? '' : 's'}.`,
    offer: `Round ${game.round} — <b>the banker is calling</b>.`,
    final: 'Final two — <b>keep or swap?</b>',
    over: 'Game over.',
  }[game.phase];
  b.innerHTML = text;
  b.dataset.phase = game.phase;
}

function renderCases(game) {
  const wrap = $('cases');
  const peek = $('peek').checked;
  const opened = new Set(game.opened);
  const count = game.cases.length || current.settings.prizes.length;
  const clickable = game.phase === 'pick' || game.phase === 'open';

  if (wrap.children.length !== count) {
    wrap.replaceChildren(...Array.from({ length: count }, (_, i) => {
      const btn = document.createElement('button');
      btn.className = 'case';
      btn.dataset.no = i + 1;
      return btn;
    }));
  }

  [...wrap.children].forEach((btn, i) => {
    const no = i + 1;
    const prize = game.cases[i];
    const isPlayer = no === game.playerCase;
    const isOpen = opened.has(no);
    const reveal = isOpen || (game.phase === 'over' && prize !== undefined) || (peek && prize !== undefined);
    btn.className = `case${isPlayer ? ' player' : ''}${isOpen ? ' open' : ''}`;
    btn.disabled = !clickable || isOpen || (game.phase === 'open' && isPlayer);
    btn.innerHTML = `<span class="no">${no}</span>${reveal ? `<span class="val">${money(prize)}</span>` : ''}${isPlayer ? '<span class="tag">contestant</span>' : ''}`;
  });
}

function renderSide(game) {
  const { settings } = current;

  // Banker
  $('offerPanel').hidden = game.phase !== 'offer';
  if (game.phase === 'offer') {
    const left = remainingPrizes(game);
    $('suggested').textContent = money(game.offer.suggested);
    $('ev').textContent = money(left.reduce((a, b) => a + b, 0) / left.length);
    const input = $('offerAmount');
    if (document.activeElement !== input) input.value = game.offer.amount;
    input.step = settings.banker.roundTo;
  }

  // Final two
  $('finalPanel').hidden = game.phase !== 'final';
  if (game.phase === 'final') {
    const other = game.cases.findIndex((_, i) => i + 1 !== game.playerCase && !game.opened.includes(i + 1)) + 1;
    $('finalText').textContent = `Keep case ${game.playerCase} or swap for case ${other}?`;
  }

  // Result
  const r = game.result;
  $('resultPanel').hidden = !r;
  if (r) {
    $('resultPanel').innerHTML =
      r.type === 'deal'
        ? `<h2>Deal!</h2><p class="big">${money(r.amount)}</p><p class="muted">Case ${r.caseNo} held ${money(r.casePrize)} — ${r.casePrize > r.amount ? 'the banker won this one' : 'great deal'}.</p>`
        : `<h2>${r.type === 'swap' ? 'Swapped' : 'Kept'} case ${r.caseNo}</h2><p class="big">${money(r.amount)}</p>`;
  }

  // Mini prize board (mirrors the audience board)
  const out = game.opened.map((n) => game.cases[n - 1]);
  const values = game.phase === 'idle' ? settings.prizes : [...game.cases].sort((a, b) => a - b);
  $('miniBoard').replaceChildren(...values.map((v) => {
    const li = document.createElement('li');
    li.textContent = money(v);
    const i = out.indexOf(v);
    if (i !== -1) {
      out.splice(i, 1);
      li.className = 'out';
    }
    return li;
  }));

  // Offer history
  $('historyPanel').hidden = !game.offers.length;
  $('history').replaceChildren(...game.offers.map((o) => {
    const li = document.createElement('li');
    li.textContent = `Round ${o.round}: ${money(o.amount)}${o.accepted ? ' ✔ accepted' : ''}`;
    return li;
  }));
}

$('peek').addEventListener('change', renderGame);

$('cases').addEventListener('click', (e) => {
  const btn = e.target.closest('.case');
  if (!btn || btn.disabled) return;
  const caseNo = Number(btn.dataset.no);
  act({ type: current.game.phase === 'pick' ? 'pickCase' : 'openCase', caseNo });
});

$('offerAmount').addEventListener('change', (e) => act({ type: 'setOffer', amount: e.target.value }));
$('dealBtn').addEventListener('click', () => {
  // Apply an edited-but-not-yet-blurred offer first.
  const typed = Math.round(Number($('offerAmount').value));
  if (typed !== current.game.offer.amount) act({ type: 'setOffer', amount: typed });
  act({ type: 'deal' });
});
$('noDealBtn').addEventListener('click', () => act({ type: 'noDeal' }));
$('keepBtn').addEventListener('click', () => act({ type: 'finalChoice', swap: false }));
$('swapBtn').addEventListener('click', () => act({ type: 'finalChoice', swap: true }));
$('undoBtn').addEventListener('click', () => send({ t: 'undo' }));
$('newGameBtn').addEventListener('click', () => {
  const inProgress = !['idle', 'over'].includes(current?.game.phase);
  if (inProgress && !confirm('A game is in progress. Start a new one?')) return;
  act({ type: 'newGame' });
});

// Keyboard: U = undo (handy on a laptop during the show)
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea')) return;
  if (e.key.toLowerCase() === 'u' && !$('undoBtn').disabled) send({ t: 'undo' });
});

// ---------- settings ----------

const form = $('settingsForm');
let settingsDirty = false;
let presets = [];

function fillSettings(s) {
  form.title.value = s.title;
  form.prizes.value = s.prizes.join('\n');
  form.columns.value = s.columns;
  form.background.value = s.theme.background;
  form.accent.value = s.theme.accent;
  form.snow.checked = s.theme.snow;
  form.lights.checked = s.theme.lights;
  form.glints.checked = s.theme.glints;
  form.startPct.value = s.banker.startPct;
  form.endPct.value = s.banker.endPct;
  form.roundTo.value = s.banker.roundTo;
  presets = s.presets.map((p) => ({ ...p, active: p.name === s.activePreset }));
  renderPresets();
  updatePrizeCount();
  setDirty(false);
}

function renderPresets() {
  const caseCount = parseNumberList(form.prizes.value).length;
  $('presets').replaceChildren(...presets.map((p, i) => {
    const row = document.createElement('div');
    row.className = 'preset';
    const plan = caseCount >= 2 ? effectiveSchedule(p.schedule, caseCount) : [];
    row.innerHTML = `
      <label class="radio" title="Use this preset"><input type="radio" name="activePreset" ${p.active ? 'checked' : ''}> Use</label>
      <input class="pname" value="" placeholder="Name" maxlength="40" aria-label="Preset name">
      <input class="psched" value="${p.schedule.join(', ')}" placeholder="6, 5, 4, 3, 2, 1, 1" aria-label="Cases per round">
      <button type="button" class="btn small danger" ${presets.length < 2 ? 'disabled' : ''} aria-label="Delete preset">✕</button>
      <small class="muted plan">${plan.length ? `With ${caseCount} cases: ${plan.join(' → ')} then final two (${plan.length} offers)` : ''}</small>`;
    row.querySelector('.pname').value = p.name; // set via property: no HTML injection from names
    row.querySelector('input[type=radio]').addEventListener('change', () => presets.forEach((q, j) => (q.active = j === i)));
    row.querySelector('.pname').addEventListener('input', (e) => (p.name = e.target.value));
    row.querySelector('.psched').addEventListener('change', (e) => {
      p.schedule = parseNumberList(e.target.value);
      renderPresets();
    });
    row.querySelector('.danger').addEventListener('click', () => {
      presets.splice(i, 1);
      if (!presets.some((q) => q.active)) presets[0].active = true;
      renderPresets();
      setDirty(true);
    });
    return row;
  }));
}

$('addPreset').addEventListener('click', () => {
  const base = activeSchedule({ presets, activePreset: presets.find((p) => p.active)?.name });
  presets.push({ name: `Preset ${presets.length + 1}`, schedule: [...base], active: false });
  renderPresets();
  setDirty(true);
});

function updatePrizeCount() {
  const n = parseNumberList(form.prizes.value).length;
  $('prizeCount').textContent = `${n} prize${n === 1 ? '' : 's'} → ${n} cases`;
}

function readForm() {
  return {
    title: form.title.value,
    prizes: parseNumberList(form.prizes.value),
    columns: form.columns.value,
    theme: { background: form.background.value, accent: form.accent.value, snow: form.snow.checked, lights: form.lights.checked, glints: form.glints.checked },
    banker: { startPct: form.startPct.value, endPct: form.endPct.value, roundTo: form.roundTo.value },
    presets: presets.map(({ name, schedule }) => ({ name: name.trim(), schedule })),
    activePreset: presets.find((p) => p.active)?.name.trim(),
  };
}

function setDirty(d) {
  settingsDirty = d;
  form.classList.toggle('dirty', d);
}

form.addEventListener('input', (e) => {
  setDirty(true);
  if (e.target.name === 'prizes') {
    updatePrizeCount();
    renderPresets();
  }
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  try {
    const settings = normalizeSettings(readForm()); // validate locally for instant feedback
    send({ t: 'settings', settings });
    setDirty(false);
    toast('Settings saved');
  } catch (err) {
    toast(err.message, true);
  }
});

$('revertBtn').addEventListener('click', () => current && fillSettings(current.settings));
$('defaultsBtn').addEventListener('click', () => {
  if (!confirm('Reset all settings (prizes, look, banker, presets) to defaults? You can still discard before saving.')) return;
  fillSettings(normalizeSettings(DEFAULT_SETTINGS));
  setDirty(true);
});

$('exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(current.settings, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'stuff-your-stocking-settings.json' });
  a.click();
  URL.revokeObjectURL(a.href);
});

$('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    fillSettings(normalizeSettings(JSON.parse(await file.text())));
    setDirty(true);
    toast('Imported — review and press Save settings');
  } catch (err) {
    toast(`Import failed: ${err.message}`, true);
  }
});

// ---------- toast ----------

let toastTimer;
function toast(text, isError = false) {
  const t = $('toast');
  t.textContent = text;
  t.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), 3000);
}
