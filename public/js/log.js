// Game log: turns each host action into event rows, and logs into CSV.
// Shared by the server (records events) and the host page (builds the CSV, so
// timestamps come out in the host's local time).

import { activeSchedule, othersRemaining, remainingPrizes } from './game.js';

export const MAX_SAVED_GAMES = 200;

export function newLog(id, contestant, now = new Date()) {
  return { id, contestant, startedAt: now.toISOString(), endedAt: null, step: 0, events: [] };
}

const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

function snapshot(game) {
  return { casesLeft: othersRemaining(game), avgLeft: avg(remainingPrizes(game)) };
}

// Rows for one applied action (prev → next). Returns [] for actions not worth a row.
export function eventsFor(prev, next, action, settings) {
  const round = next.round || null;
  switch (action.type) {
    case 'newGame': {
      const preset = settings.activePreset;
      return [{
        event: 'game_start',
        casesLeft: next.cases.length,
        notes: `${next.cases.length} cases; preset "${preset}" (${activeSchedule(settings).join(', ')})`,
      }];
    }
    case 'pickCase':
      return [{ event: 'pick_case', case: next.playerCase, ...snapshot(next) }];
    case 'openCase': {
      const c = next.opened.at(-1);
      const rows = [{ event: 'open_case', round, case: c, prize: next.cases[c - 1], ...snapshot(next) }];
      if (next.phase === 'offer') {
        rows.push({
          event: 'banker_offer',
          round,
          ...snapshot(next),
          options: Object.fromEntries(next.offer.options.map((o) => [o.name, o.amount])),
          offerChoice: next.offer.choice,
          offerAmount: next.offer.amount,
          notes: 'Pre-selected offer shown',
        });
      }
      return rows;
    }
    case 'deal':
    case 'noDeal': {
      const accepted = action.type === 'deal';
      const rows = [{
        event: accepted ? 'deal' : 'no_deal',
        round: prev.round,
        ...snapshot(prev),
        options: Object.fromEntries(prev.offer.options.map((o) => [o.name, o.amount])),
        offerChoice: prev.offer.choice ?? 'custom',
        offerAmount: prev.offer.amount,
        decision: accepted ? 'DEAL' : 'NO DEAL',
      }];
      if (accepted) rows.push(endRow(next));
      return rows;
    }
    case 'finalChoice':
      return [
        { event: 'final_choice', case: next.result.caseNo, prize: next.result.casePrize, decision: next.result.type.toUpperCase() },
        endRow(next),
      ];
    default:
      return [];
  }
}

function endRow(game) {
  const r = game.result;
  const own = game.cases[game.playerCase - 1];
  const notes = r.type === 'deal'
    ? `Took the deal; their case #${game.playerCase} held ${own}`
    : `${r.type === 'swap' ? 'Swapped to' : 'Kept'} case #${r.caseNo}`;
  return { event: 'game_end', case: r.caseNo, prize: r.casePrize, decision: r.type.toUpperCase(), winnings: r.amount, notes };
}

// Appends rows for one action as a single step (so Undo can mark them together).
export function record(log, rows, now = new Date()) {
  if (!rows.length) return log;
  const step = log.step + 1;
  const at = now.toISOString();
  const start = log.events.length;
  const added = rows.map((r, i) => ({ seq: start + i + 1, at, step, undone: false, ...r }));
  const ended = added.some((r) => r.event === 'game_end');
  return { ...log, step, events: [...log.events, ...added], endedAt: ended ? at : log.endedAt };
}

// Marks the latest step's rows as undone and adds an "undo" row.
export function recordUndo(log, now = new Date()) {
  const live = log.events.filter((e) => !e.undone && e.event !== 'undo' && e.event !== 'game_start');
  if (!live.length) return log;
  const step = live.at(-1).step;
  const undone = log.events.filter((e) => e.step === step && !e.undone);
  const events = log.events.map((e) => (e.step === step ? { ...e, undone: true } : e));
  const at = now.toISOString();
  return {
    ...log,
    step: log.step + 1,
    endedAt: undone.some((e) => e.event === 'game_end') ? null : log.endedAt,
    events: [...events, {
      seq: events.length + 1, at, step: log.step + 1, undone: false, event: 'undo',
      notes: `Undid step ${step}: ${undone.map((e) => e.event).join(' + ')}`,
    }],
  };
}

export function summarize(log) {
  const end = [...log.events].reverse().find((e) => e.event === 'game_end' && !e.undone);
  return {
    id: log.id,
    contestant: log.contestant,
    startedAt: log.startedAt,
    endedAt: end ? log.endedAt : null,
    outcome: end ? end.decision : null,
    winnings: end ? end.winnings : null,
    rows: log.events.length,
  };
}

// ---------- CSV ----------

const pad = (n) => String(n).padStart(2, '0');
function localTime(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function cell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Stop spreadsheet apps from treating user-typed text (names) as a formula.
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// One CSV for one or many games. Offer variations become their own columns
// (offer_Lowball, offer_Fair, ...) so they're easy to chart.
export function toCSV(logs) {
  const names = [];
  for (const log of logs) {
    for (const e of log.events) {
      for (const n of Object.keys(e.options || {})) if (!names.includes(n)) names.push(n);
    }
  }
  const header = [
    'game', 'contestant', 'time', 'seq', 'step', 'event', 'round', 'case', 'prize',
    'cases_left', 'avg_left', ...names.map((n) => `offer_${n}`), 'offer_choice', 'offer_amount',
    'decision', 'winnings', 'undone', 'notes',
  ];
  const lines = [header.map(cell).join(',')];
  for (const log of logs) {
    for (const e of log.events) {
      lines.push([
        log.id, log.contestant, localTime(e.at), e.seq, e.step, e.event, e.round, e.case, e.prize,
        e.casesLeft, e.avgLeft, ...names.map((n) => e.options?.[n]), e.offerChoice, e.offerAmount,
        e.decision, e.winnings, e.undone ? 'yes' : '', e.notes,
      ].map(cell).join(','));
    }
  }
  return `${lines.join('\r\n')}\r\n`;
}

export function csvFilename(logs) {
  const stamp = (iso) => localTime(iso).replace(' ', '_').replace(/:/g, '').slice(0, 15);
  if (logs.length !== 1) return `stuff-your-stocking_all-games_${stamp(new Date().toISOString())}.csv`;
  const [log] = logs;
  // Plain ASCII: some browsers refuse a download name with accents ("Zoë" → "Zoe").
  const who = log.contestant.normalize('NFD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `stuff-your-stocking_game-${log.id}${who ? `_${who}` : ''}_${stamp(log.startedAt)}.csv`;
}
