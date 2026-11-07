import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SETTINGS, applyAction, boardView, effectiveSchedule, emptyGame,
  normalizeSettings, offerOptions, parseNumberList, refreshOffer, remainingPrizes,
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
    assert.equal(g.offer.options.length, 3);
    assert.equal(g.offer.choice, 'Fair');
    assert.ok(g.offer.amount > 0);
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

const rampBanker = {
  offers: [{ name: 'Low', startPct: 50, endPct: 100 }, { name: 'High', startPct: 100, endPct: 150 }],
  defaultOffer: 'High',
  roundTo: 1,
};

test('each offer variation ramps from its first % to its last % of the average', () => {
  const s = normalizeSettings({ ...DEFAULT_SETTINGS, prizes: [100, 200, 300, 400], banker: rampBanker, presets: [{ name: 'x', schedule: [1] }] });
  let g = play([{ type: 'newGame' }, { type: 'pickCase', caseNo: 4 }], s);
  g = applyAction(g, { type: 'openCase', caseNo: 1 }, s); // removes 100 → avg 300
  assert.deepEqual(g.offer.options, [{ name: 'Low', pct: 50, amount: 150 }, { name: 'High', pct: 100, amount: 300 }]);
  assert.equal(g.offer.choice, 'High'); // the default is pre-selected
  assert.equal(g.offer.amount, 300);
  g = applyAction(g, { type: 'noDeal' }, s);
  g = applyAction(g, { type: 'openCase', caseNo: 2 }, s); // removes 200 → avg 350
  assert.deepEqual(offerOptions(g, s.banker).map((o) => o.amount), [350, 525]); // last round → end %
});

test('host can pick a variation or type a custom amount', () => {
  const s = normalizeSettings({ ...DEFAULT_SETTINGS, prizes: [100, 200, 300, 400], banker: rampBanker, presets: [{ name: 'x', schedule: [1] }] });
  let g = play([{ type: 'newGame' }, { type: 'pickCase', caseNo: 4 }], s);
  g = applyAction(g, { type: 'openCase', caseNo: 1 }, s);
  g = applyAction(g, { type: 'setOffer', choice: 'Low' }, s);
  assert.deepEqual([g.offer.choice, g.offer.amount], ['Low', 150]);
  g = applyAction(g, { type: 'setOffer', amount: 222 }, s);
  assert.deepEqual([g.offer.choice, g.offer.amount], [null, 222]);
  g = applyAction(g, { type: 'setOffer', amount: 300 }, s); // typed amount equal to a variation selects it
  assert.equal(g.offer.choice, 'High');
  assert.throws(() => applyAction(g, { type: 'setOffer', choice: 'Nope' }, s), /No such offer/);
  g = applyAction(g, { type: 'setOffer', choice: 'Low' }, s);
  g = applyAction(g, { type: 'deal' }, s);
  assert.deepEqual(g.offers, [{ round: 1, amount: 150, choice: 'Low', accepted: true }]);
});

test('changing banker settings mid-offer recalculates but keeps the selection', () => {
  const s = normalizeSettings({ ...DEFAULT_SETTINGS, prizes: [100, 200, 300, 400], banker: rampBanker, presets: [{ name: 'x', schedule: [1] }] });
  let g = play([{ type: 'newGame' }, { type: 'pickCase', caseNo: 4 }], s);
  g = applyAction(g, { type: 'openCase', caseNo: 1 }, s);
  g = applyAction(g, { type: 'setOffer', choice: 'Low' }, s);
  const s2 = normalizeSettings({ ...s, banker: { ...rampBanker, offers: [{ name: 'Low', startPct: 10, endPct: 20 }, rampBanker.offers[1]] } });
  const g2 = refreshOffer(g, s2.banker);
  assert.deepEqual([g2.offer.choice, g2.offer.amount], ['Low', 30]);
  // A game saved by the old version (no options) gets fresh variations with the default selected.
  const old = refreshOffer({ ...g, offer: { suggested: 100, amount: 100 } }, s.banker);
  assert.deepEqual([old.offer.choice, old.offer.amount], ['High', 300]);
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
  // Settings saved before offer variations existed get the default three.
  const old = normalizeSettings({ banker: { startPct: 40, endPct: 90, roundTo: 50 } });
  assert.deepEqual(old.banker.offers.map((o) => o.name), ['Lowball', 'Fair', 'Generous']);
  assert.equal(old.banker.defaultOffer, 'Fair');
  assert.equal(old.banker.roundTo, 50);
  assert.throws(() => normalizeSettings({ banker: { offers: [{ name: 'A', startPct: 0, endPct: 50 }] } }), /between 1 and 300/);
  assert.throws(() => normalizeSettings({ banker: { offers: [{ name: 'A', startPct: 5, endPct: 50 }, { name: 'A', startPct: 5, endPct: 50 }] } }), /Duplicate banker/);
});
