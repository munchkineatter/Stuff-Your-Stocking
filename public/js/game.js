// Shared game logic. Imported by the server (authoritative) and the host page
// (for derived values like the suggested offer). Pure functions only.

export const DEFAULT_SETTINGS = Object.freeze({
  title: 'Stuff Your Stocking',
  prizes: [
    1500, 2000, 2200, 2400, 2500, 2600, 2800, 3000, 3200, 3400,
    3800, 4000, 4200, 4400, 4500, 4800, 5000, 6000, 7500, 10000,
  ],
  columns: 4,
  theme: { background: '#1a5c32', accent: '#e63c2f', snow: true, lights: true, glints: true },
  // The host sees one amount per offer variation and picks one. Each amount =
  // average of the remaining prizes × a percentage that ramps linearly from
  // startPct (first offer) to endPct (last offer), rounded to the nearest roundTo.
  banker: {
    offers: [
      { name: 'Lowball', startPct: 25, endPct: 70 },
      { name: 'Fair', startPct: 35, endPct: 95 },
      { name: 'Generous', startPct: 50, endPct: 110 },
    ],
    defaultOffer: 'Fair',
    roundTo: 100,
  },
  presets: [{ name: 'Standard', schedule: [6, 5, 4, 3, 2, 1, 1] }],
  activePreset: 'Standard',
});

export const PHASES = ['idle', 'pick', 'open', 'offer', 'final', 'over'];

export function emptyGame() {
  return {
    phase: 'idle',
    cases: [],        // cases[i] = prize inside case number i + 1
    playerCase: null,
    opened: [],       // case numbers in the order they were opened
    schedule: [],
    round: 0,
    toOpen: 0,        // cases to open this round
    openedThisRound: 0,
    offer: null,      // { options: [{ name, pct, amount }], choice, amount } while phase === 'offer'
    offers: [],       // history: { round, amount, choice, accepted }
    result: null,     // { type: 'deal'|'keep'|'swap', amount, caseNo, casePrize }
  };
}

// ---------- settings ----------

const HEX = /^#[0-9a-f]{6}$/i;
const clampInt = (v, lo, hi, dflt) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

export function parseNumberList(text) {
  return String(text)
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1') // thousands separators: "$1,500" → 1500
    .split(/[\s,;]+/)
    .map((s) => s.replace(/[$_]/g, ''))
    .filter(Boolean)
    .map(Number);
}

// Validates untrusted settings input. Throws with a human-readable message.
export function normalizeSettings(input) {
  const d = DEFAULT_SETTINGS;
  const s = input && typeof input === 'object' ? input : {};

  const prizes = (Array.isArray(s.prizes) ? s.prizes : d.prizes).map(Number);
  if (prizes.length < 2 || prizes.length > 100) throw new Error('Enter between 2 and 100 prizes.');
  if (prizes.some((p) => !Number.isFinite(p) || p < 0)) throw new Error('Prizes must be non-negative numbers.');

  const presetsIn = Array.isArray(s.presets) && s.presets.length ? s.presets : d.presets;
  const presets = [];
  for (const p of presetsIn.slice(0, 50)) {
    const name = String(p?.name ?? '').trim().slice(0, 40);
    if (!name) throw new Error('Every preset needs a name.');
    if (presets.some((q) => q.name === name)) throw new Error(`Duplicate preset name "${name}".`);
    const schedule = (Array.isArray(p.schedule) ? p.schedule : []).map(Number);
    if (!schedule.length || schedule.some((n) => !Number.isInteger(n) || n < 1 || n > 99)) {
      throw new Error(`Preset "${name}" needs whole numbers of 1 or more, e.g. 6,5,4,3,2,1,1.`);
    }
    presets.push({ name, schedule });
  }
  const activePreset = presets.some((p) => p.name === s.activePreset) ? s.activePreset : presets[0].name;

  const t = s.theme || {};
  const b = s.banker || {};
  // Settings saved before offer variations existed have no `offers`; they get the defaults.
  const offersIn = Array.isArray(b.offers) && b.offers.length ? b.offers : d.banker.offers;
  const offers = [];
  for (const o of offersIn.slice(0, 12)) {
    const name = String(o?.name ?? '').trim().slice(0, 30);
    if (!name) throw new Error('Every banker offer needs a name.');
    if (offers.some((q) => q.name === name)) throw new Error(`Duplicate banker offer name "${name}".`);
    const startPct = Number(o.startPct);
    const endPct = Number(o.endPct);
    for (const v of [startPct, endPct]) {
      if (!Number.isFinite(v) || v < 1 || v > 300) throw new Error(`"${name}" percentages must be between 1 and 300.`);
    }
    offers.push({ name, startPct: Math.round(startPct), endPct: Math.round(endPct) });
  }
  const named = (n) => offers.some((o) => o.name === n);
  const defaultOffer = named(b.defaultOffer) ? b.defaultOffer : named(d.banker.defaultOffer) ? d.banker.defaultOffer : offers[0].name;
  return {
    title: String(s.title ?? d.title).trim().slice(0, 80) || d.title,
    prizes: prizes.sort((a, z) => a - z),
    columns: clampInt(s.columns, 1, 8, d.columns),
    theme: {
      background: HEX.test(t.background) ? t.background : d.theme.background,
      accent: HEX.test(t.accent) ? t.accent : d.theme.accent,
      snow: t.snow === undefined ? d.theme.snow : Boolean(t.snow),
      lights: t.lights === undefined ? d.theme.lights : Boolean(t.lights),
      glints: t.glints === undefined ? d.theme.glints : Boolean(t.glints),
    },
    banker: { offers, defaultOffer, roundTo: clampInt(b.roundTo, 1, 100000, d.banker.roundTo) },
    presets,
    activePreset,
  };
}

export function activeSchedule(settings) {
  return (settings.presets.find((p) => p.name === settings.activePreset) || settings.presets[0]).schedule;
}

// ---------- derived values ----------

const scheduled = (schedule, round) => schedule[round - 1] ?? schedule[schedule.length - 1] ?? 1;

// Unopened cases other than the player's.
export function othersRemaining(game) {
  return game.cases.length - game.opened.length - (game.playerCase ? 1 : 0);
}

// Never open the last other case: the game always ends with a final two.
function casesToOpen(schedule, round, others) {
  return Math.min(scheduled(schedule, round), others - 1);
}

// Cases actually opened per round for a given case count (the preset, trimmed or
// extended so the game lands exactly on a final two).
export function effectiveSchedule(schedule, caseCount) {
  const out = [];
  let others = caseCount - 1;
  while (others > 1) {
    const n = casesToOpen(schedule, out.length + 1, others);
    out.push(n);
    others -= n;
  }
  return out;
}

export const totalRounds = (schedule, caseCount) => effectiveSchedule(schedule, caseCount).length;

// Prizes still in play (unopened cases, including the player's).
export function remainingPrizes(game) {
  const opened = new Set(game.opened);
  return game.cases.filter((_, i) => !opened.has(i + 1));
}

// How far through the offers this round is: 0 at the first offer, 1 at the last.
function offerProgress(game) {
  const rounds = totalRounds(game.schedule, game.cases.length);
  return rounds > 1 ? Math.min(1, Math.max(0, (game.round - 1) / (rounds - 1))) : 1;
}

// One amount per offer variation for the current round, plus the % used.
export function offerOptions(game, banker) {
  const left = remainingPrizes(game);
  const ev = left.length ? left.reduce((a, b) => a + b, 0) / left.length : 0;
  const t = offerProgress(game);
  const step = banker.roundTo || 1;
  return banker.offers.map(({ name, startPct, endPct }) => {
    const pct = Math.round(startPct + (endPct - startPct) * t);
    return { name, pct, amount: Math.max(0, Math.round((ev * pct) / 100 / step) * step) };
  });
}

// Fresh offer state with the default variation selected.
function openOffer(game, banker) {
  const options = offerOptions(game, banker);
  const chosen = options.find((o) => o.name === banker.defaultOffer) || options[0];
  return { options, choice: chosen.name, amount: chosen.amount };
}

// Recalculate the amounts if banker settings change while an offer is up,
// keeping the host's selection (or their custom amount).
export function refreshOffer(game, banker) {
  if (game.phase !== 'offer') return game;
  const options = offerOptions(game, banker);
  const kept = options.find((o) => o.name === game.offer.choice);
  if (kept) return { ...game, offer: { options, choice: kept.name, amount: kept.amount } };
  if (game.offer.choice === null) return { ...game, offer: { ...game.offer, options } };
  return { ...game, offer: openOffer(game, banker) };
}

// Audience-safe board: every prize, sorted, with an eliminated flag.
// Never exposes which case holds what.
export function boardView(settings, game) {
  const source = game.phase === 'idle' ? settings.prizes : [...game.cases].sort((a, b) => a - b);
  const outCounts = new Map();
  for (const n of game.opened) {
    const v = game.cases[n - 1];
    outCounts.set(v, (outCounts.get(v) || 0) + 1);
  }
  return source.map((value) => {
    const left = outCounts.get(value) || 0;
    if (left) outCounts.set(value, left - 1);
    return { value, out: left > 0 };
  });
}

// ---------- reducer ----------

function shuffle(arr, random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function caseNumber(game, n) {
  const c = Number(n);
  if (!Number.isInteger(c) || c < 1 || c > game.cases.length) throw new Error('No such case.');
  return c;
}

function expectPhase(game, ...phases) {
  if (!phases.includes(game.phase)) throw new Error(`Not allowed right now (phase: ${game.phase}).`);
}

function startRound(game, round) {
  return { ...game, phase: 'open', round, openedThisRound: 0, toOpen: casesToOpen(game.schedule, round, othersRemaining(game)) };
}

// Returns the next game state, or throws an Error whose message is shown to the host.
export function applyAction(game, action, settings, random = Math.random) {
  switch (action?.type) {
    case 'newGame':
      return {
        ...emptyGame(),
        phase: 'pick',
        cases: shuffle(settings.prizes, random),
        schedule: [...activeSchedule(settings)],
      };

    case 'pickCase': {
      expectPhase(game, 'pick');
      return startRound({ ...game, playerCase: caseNumber(game, action.caseNo) }, 1);
    }

    case 'openCase': {
      expectPhase(game, 'open');
      const c = caseNumber(game, action.caseNo);
      if (c === game.playerCase) throw new Error("That's the contestant's case.");
      if (game.opened.includes(c)) throw new Error(`Case ${c} is already open.`);
      const next = { ...game, opened: [...game.opened, c], openedThisRound: game.openedThisRound + 1 };
      if (next.openedThisRound < next.toOpen) return next;
      return { ...next, phase: 'offer', offer: openOffer(next, settings.banker) };
    }

    // Either { choice: 'Fair' } to pick a variation, or { amount } for a custom figure.
    case 'setOffer': {
      expectPhase(game, 'offer');
      if (action.choice !== undefined) {
        const opt = game.offer.options.find((o) => o.name === action.choice);
        if (!opt) throw new Error('No such offer.');
        return { ...game, offer: { ...game.offer, choice: opt.name, amount: opt.amount } };
      }
      const amount = Math.round(Number(action.amount));
      if (!Number.isFinite(amount) || amount < 0) throw new Error('Offer must be a non-negative number.');
      // A typed amount that matches a variation counts as picking it.
      const match = game.offer.options.find((o) => o.amount === amount && o.name === game.offer.choice)
        || game.offer.options.find((o) => o.amount === amount);
      return { ...game, offer: { ...game.offer, choice: match ? match.name : null, amount } };
    }

    case 'deal': {
      expectPhase(game, 'offer');
      return {
        ...game,
        phase: 'over',
        offers: [...game.offers, { round: game.round, amount: game.offer.amount, choice: game.offer.choice, accepted: true }],
        result: { type: 'deal', amount: game.offer.amount, caseNo: game.playerCase, casePrize: game.cases[game.playerCase - 1] },
        offer: null,
      };
    }

    case 'noDeal': {
      expectPhase(game, 'offer');
      const next = { ...game, offers: [...game.offers, { round: game.round, amount: game.offer.amount, choice: game.offer.choice, accepted: false }], offer: null };
      return othersRemaining(next) <= 1 ? { ...next, phase: 'final' } : startRound(next, game.round + 1);
    }

    case 'finalChoice': {
      expectPhase(game, 'final');
      const other = game.cases.findIndex((_, i) => i + 1 !== game.playerCase && !game.opened.includes(i + 1)) + 1;
      const caseNo = action.swap ? other : game.playerCase;
      return {
        ...game,
        phase: 'over',
        result: { type: action.swap ? 'swap' : 'keep', amount: game.cases[caseNo - 1], caseNo, casePrize: game.cases[caseNo - 1] },
      };
    }

    default:
      throw new Error('Unknown action.');
  }
}
