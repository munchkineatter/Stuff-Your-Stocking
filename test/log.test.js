import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, applyAction, emptyGame, normalizeSettings } from '../public/js/game.js';
import { csvFilename, eventsFor, newLog, record, recordUndo, summarize, toCSV } from '../public/js/log.js';

const settings = normalizeSettings({
  ...DEFAULT_SETTINGS,
  prizes: [100, 200, 300, 400, 500],
  presets: [{ name: 'Quick', schedule: [2, 1] }],
  activePreset: 'Quick',
  banker: { offers: [{ name: 'Low', startPct: 50, endPct: 50 }, { name: 'High', startPct: 100, endPct: 100 }], defaultOffer: 'Low', roundTo: 1 },
});
const identity = () => 0.999999; // keeps case i holding prizes[i]

// Plays actions like the server does: apply, then log; 'undo' pops the last state.
function run(actions, contestant = 'Jamie') {
  let game = emptyGame();
  let log = newLog(1, contestant, new Date('2026-12-24T18:00:00Z'));
  const history = [];
  for (const a of actions) {
    if (a === 'undo') {
      game = history.pop();
      log = recordUndo(log);
      continue;
    }
    const next = applyAction(game, a, settings, identity);
    if (a.type !== 'newGame' && a.type !== 'setOffer') history.push(game);
    log = record(log, eventsFor(game, next, a, settings));
    game = next;
  }
  return { game, log };
}

const parse = (csv) => csv.trim().split('\r\n').map((l) => l.split(','));

test('a full game produces one row per event, in order', () => {
  const { game, log } = run([
    { type: 'newGame' }, { type: 'pickCase', caseNo: 5 },
    { type: 'openCase', caseNo: 1 }, { type: 'openCase', caseNo: 2 },
    { type: 'setOffer', choice: 'High' }, { type: 'noDeal' },
    { type: 'openCase', caseNo: 3 }, { type: 'deal' },
  ]);
  assert.equal(game.phase, 'over');
  assert.deepEqual(log.events.map((e) => e.event), [
    'game_start', 'pick_case', 'open_case', 'open_case', 'banker_offer', 'no_deal', 'open_case', 'banker_offer', 'deal', 'game_end',
  ]);
  const noDeal = log.events.find((e) => e.event === 'no_deal');
  assert.deepEqual(noDeal.options, { Low: 200, High: 400 }); // avg of 300,400,500 = 400
  assert.equal(noDeal.offerChoice, 'High');
  assert.equal(noDeal.offerAmount, 400);
  const end = log.events.at(-1);
  assert.equal(end.winnings, 225); // round 2: avg of 400,500 = 450 × 50%
  assert.match(end.notes, /case #5 held 500/);
  assert.ok(log.endedAt);
  assert.deepEqual(summarize(log), { id: 1, contestant: 'Jamie', startedAt: '2026-12-24T18:00:00.000Z', endedAt: log.endedAt, outcome: 'DEAL', winnings: 225, rows: 10 });
});

test('undo keeps the undone rows, marked, and adds an undo row', () => {
  const { log } = run([
    { type: 'newGame' }, { type: 'pickCase', caseNo: 5 },
    { type: 'openCase', caseNo: 1 }, { type: 'openCase', caseNo: 2 }, // 2nd open also logs the offer (same step)
    'undo',
    { type: 'openCase', caseNo: 3 },
  ]);
  const rows = log.events.map((e) => `${e.event}${e.case ? `#${e.case}` : ''}${e.undone ? ' (undone)' : ''}`);
  assert.deepEqual(rows, [
    'game_start', 'pick_case#5', 'open_case#1', 'open_case#2 (undone)', 'banker_offer (undone)', 'undo', 'open_case#3', 'banker_offer',
  ]);
  assert.match(log.events[5].notes, /open_case \+ banker_offer/);
});

test('undoing the end of a game reopens it', () => {
  const { log } = run([
    { type: 'newGame' }, { type: 'pickCase', caseNo: 5 },
    { type: 'openCase', caseNo: 1 }, { type: 'openCase', caseNo: 2 }, { type: 'deal' }, 'undo',
  ]);
  assert.equal(log.endedAt, null);
  assert.equal(summarize(log).outcome, null);
});

test('CSV has offer columns per variation and escapes user text', () => {
  const { log } = run([
    { type: 'newGame' }, { type: 'pickCase', caseNo: 5 },
    { type: 'openCase', caseNo: 1 }, { type: 'openCase', caseNo: 2 }, { type: 'noDeal' },
    { type: 'openCase', caseNo: 3 }, { type: 'noDeal' }, { type: 'finalChoice', swap: true },
  ], '=HYPERLINK("x"), Jr.');
  const csv = toCSV([log]);
  const [header, ...rows] = parse(csv);
  assert.deepEqual(header.slice(11, 15), ['offer_Low', 'offer_High', 'offer_choice', 'offer_amount']);
  assert.equal(rows.length, log.events.length);
  // Name is quoted (comma + quotes) and prefixed so spreadsheets don't run it as a formula.
  assert.ok(csv.includes(`"'=HYPERLINK(""x""), Jr."`));
  assert.ok(csv.includes('final_choice') && csv.includes('SWAP'));
  assert.match(csvFilename([log]), /^stuff-your-stocking_game-1_HYPERLINK-x-Jr_\d{4}-\d{2}-\d{2}_\d{4}\.csv$/);
  assert.match(csvFilename([log, log]), /all-games/);
  assert.match(csvFilename([{ ...log, contestant: 'Zoë "Z" O\'Neil' }]), /_game-1_Zoe-Z-O-Neil_/);
});
