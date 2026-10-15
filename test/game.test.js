import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS, applyAction, boardView, effectiveSchedule, emptyGame,
  normalizeSettings, parseNumberList, remainingPrizes, suggestOffer,
} from '../public/js/game.js';

const settings = normalizeSettings(DEFAULT_SETTINGS);
const identity = () => 0.999999; // Fisher-Yates with j === i leaves order unchanged

function play(actions, s = settings) {
  return actions.reduce((g, a) => applyAction(g, a, s, identity), emptyGame());
}

function openNext(game, s = settings) {
  const c = game.cases.findIndex((_, i) => i + 1 !== game.playerCase && !game.opened.includes(i + 1)) + 1;
  return applyAction(game, { type: 'openCase', caseNo: c }, s);
}

test('effective schedule always lands on a final two', () => {
  assert.deepEqual(effectiveSchedule([6, 5, 4, 3, 2, 1, 1], 20), [6, 5, 4, 3]);
  assert.deepEqual(effectiveSchedule([6, 5, 4, 3, 2, 1, 1], 26), [6, 5, 4, 3, 2, 1, 1, 1, 1]);
  assert.deepEqual(effectiveSchedule([1], 5), [1, 1, 1]);
  assert.deepEqual(effectiveSchedule([10], 2), []);
});

test('full game: no deal through to a swap', () => {
  let g = play([{ type: 'newGame' }, { type: 'pickCase', caseNo: 20 }]);
  assert.equal(g.phase, 'open');
  assert.equal(g.toOpen, 6);

  for (const expected of [6, 5, 4, 3]) {
    assert.equal(g.toOpen, expected);
    for (let i = 0; i < expected; i++) g = openNext(g);
    assert.equal(g.phase, 'offer');
    assert.ok(g.offer.suggested > 0);
    g = applyAction(g, { type: 'noDeal' }, settings);
  }
  assert.equal(g.phase, 'final');
  assert.equal(remainingPrizes(g).length, 2);

  g = applyAction(g, { type: 'finalChoice', swap: true }, settings);
  assert.equal(g.phase, 'over');
  assert.equal(g.result.type, 'swap');
  assert.notEqual(g.result.caseNo, 20);
  assert.equal(g.offers.length, 4);
});

test('deal ends the game with the offered amount', () => {
  let g = play([{ type: 'newGame' }, { type: 'pickCase', caseNo: 1 }]);
  for (let i = 0; i < 6; i++) g = openNext(g);
  g = applyAction(g, { type: 'setOffer', amount: 1234 }, settings);
  g = applyAction(g, { type: 'deal' }, settings);
  assert.equal(g.phase, 'over');
  assert.deepEqual(g.result, { type: 'deal', amount: 1234, caseNo: 1, casePrize: g.cases[0] });
});

test('illegal moves are rejected', () => {
  const g = play([{ type: 'newGame' }, { type: 'pickCase', caseNo: 3 }]);
  assert.throws(() => applyAction(g, { type: 'openCase', caseNo: 3 }, settings), /contestant/);
  assert.throws(() => applyAction(g, { type: 'openCase', caseNo: 99 }, settings), /No such case/);
  assert.throws(() => applyAction(g, { type: 'deal' }, settings), /Not allowed/);
  const g2 = openNext(g);
  assert.throws(() => applyAction(g2, { type: 'openCase', caseNo: g2.opened[0] }, settings), /already open/);
});

test('banker offer ramps from start % to end % of the average', () => {
  const s = normalizeSettings({ ...DEFAULT_SETTINGS, prizes: [100, 200, 300, 400], banker: { startPct: 50, endPct: 100, roundTo: 1 }, presets: [{ name: 'x', schedule: [1] }] });
  let g = play([{ type: 'newGame' }, { type: 'pickCase', caseNo: 4 }], s);
  g = applyAction(g, { type: 'openCase', caseNo: 1 }, s); // removes 100 → avg 300
  assert.equal(g.offer.suggested, 150); // round 1 of 2 → 50%
  g = applyAction(g, { type: 'noDeal' }, s);
  g = applyAction(g, { type: 'openCase', caseNo: 2 }, s); // removes 200 → avg 350
  assert.equal(g.offer.suggested, 350); // last round → 100%
  assert.equal(suggestOffer(g, s.banker), 350);
});

test('board view handles duplicate prize values and hides case positions', () => {
  const s = normalizeSettings({ ...DEFAULT_SETTINGS, prizes: [5, 5, 10] });
  let g = play([{ type: 'newGame' }, { type: 'pickCase', caseNo: 3 }], s);
  g = applyAction(g, { type: 'openCase', caseNo: 1 }, s);
  const board = boardView(s, g);
  assert.deepEqual(board, [{ value: 5, out: true }, { value: 5, out: false }, { value: 10, out: false }]);
  assert.ok(board.every((p) => Object.keys(p).join() === 'value,out'));
});

test('settings validation', () => {
  assert.deepEqual(parseNumberList('$1,500\n2000; 2_500, $10,000'), [1500, 2000, 2500, 10000]);
  assert.deepEqual(parseNumberList('1500\n2000\n2500'), [1500, 2000, 2500]);
  assert.throws(() => normalizeSettings({ prizes: [1] }), /between 2 and 100/);
  assert.throws(() => normalizeSettings({ presets: [{ name: 'a', schedule: [0] }] }), /whole numbers/);
  assert.throws(() => normalizeSettings({ presets: [{ name: 'a', schedule: [1] }, { name: 'a', schedule: [2] }] }), /Duplicate/);
  const s = normalizeSettings({ prizes: [3, 1, 2], theme: { background: 'red' }, activePreset: 'nope' });
  assert.deepEqual(s.prizes, [1, 2, 3]);
  assert.equal(s.theme.background, DEFAULT_SETTINGS.theme.background);
  assert.equal(s.activePreset, 'Standard');
});
