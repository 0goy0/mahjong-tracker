const test = require('node:test');
const assert = require('node:assert');
const {
  poolKey,
  poolLabel,
  computeGameDeltas,
  computePoolTimeline,
  DEFAULT_CONFIG,
} = require('./elo');

// ── Fixtures ──────────────────────────────────────────────────────────────────
// Build a game where `winnerChips` flow to `winner` split evenly from the other
// three losers. Ledger mirrors the app's settlement (loser=from, winner=to).
function oneWinnerGame(id, winner, losers, winnerChips, winds = 4) {
  const per = winnerChips / losers.length;
  const seats = [
    { player_id: winner, chips: winnerChips },
    ...losers.map(l => ({ player_id: l, chips: -per })),
  ];
  const transfers = losers.map(l => ({ from_player_id: l, to_player_id: winner, amount: per }));
  return { id, winds, seats, transfers };
}

test('poolKey is order-independent and includes tai bounds', () => {
  assert.strictEqual(poolKey(['guo_san', '8_fei'], 1, 6), '8_fei+guo_san|1-6');
  assert.strictEqual(poolKey(['8_fei', 'guo_san'], 1, 6), '8_fei+guo_san|1-6');
  assert.strictEqual(poolKey(['vanilla'], 0, 5), 'vanilla|0-5');
  // de-dup
  assert.strictEqual(poolKey(['vanilla', 'vanilla'], 0, 5), 'vanilla|0-5');
  // tai splits pools
  assert.notStrictEqual(poolKey(['vanilla'], 0, 5), poolKey(['vanilla'], 1, 6));
});

test('poolLabel is human readable', () => {
  assert.strictEqual(poolLabel('8_fei+guo_san|1-6'), '8 Fei + Guo San · 1–6 tai');
  assert.strictEqual(poolLabel('vanilla|0-5'), 'Vanilla · 0–5 tai');
});

test('(a) total rating is conserved under uniform K', () => {
  // All four fresh → all K=40 → deltas must sum to ~0.
  const g = oneWinnerGame(1, 10, [20, 30, 40], 30);
  const { current } = computePoolTimeline([g]);
  const sum = current.reduce((a, p) => a + (p.rating - DEFAULT_CONFIG.base_rating), 0);
  assert.ok(Math.abs(sum) < 1e-9, `sum of deltas should be ~0, got ${sum}`);
});

test('(b) monotonicity — more chips means a larger winner delta', () => {
  const small = computePoolTimeline([oneWinnerGame(1, 10, [20, 30, 40], 30)]);
  const big = computePoolTimeline([oneWinnerGame(1, 10, [20, 30, 40], 90)]);
  const dSmall = small.current.find(p => p.player_id === 10).last_delta;
  const dBig = big.current.find(p => p.player_id === 10).last_delta;
  assert.ok(dBig > dSmall, `bigger win should move more: ${dBig} !> ${dSmall}`);
});

test('(c) beating higher-rated opponents yields a larger delta', () => {
  const g = oneWinnerGame(1, 10, [20, 30, 40], 30);
  const base = computeGameDeltas(g, {}, {}, DEFAULT_CONFIG);
  const strongOpps = computeGameDeltas(
    g,
    { 10: 1000, 20: 1200, 30: 1200, 40: 1200 },
    {},
    DEFAULT_CONFIG,
  );
  assert.ok(
    strongOpps[10].delta > base[10].delta,
    `beating stronger field should gain more: ${strongOpps[10].delta} !> ${base[10].delta}`,
  );
});

test('(d) replay is deterministic', () => {
  const games = [
    oneWinnerGame(1, 10, [20, 30, 40], 30),
    oneWinnerGame(2, 20, [10, 30, 40], 60, 7),
    oneWinnerGame(3, 30, [10, 20, 40], 15),
  ];
  const a = computePoolTimeline(games);
  const b = computePoolTimeline(games);
  assert.deepStrictEqual(a, b);
});

test('(e) delete-then-recompute equals never-inserted', () => {
  const g1 = oneWinnerGame(1, 10, [20, 30, 40], 30);
  const g2 = oneWinnerGame(2, 20, [10, 30, 40], 60, 7);
  const g3 = oneWinnerGame(3, 30, [10, 20, 40], 15);
  const withoutG2 = computePoolTimeline([g1, g3]);
  const deletedG2 = computePoolTimeline([g1, g2, g3].filter(g => g.id !== 2));
  assert.deepStrictEqual(deletedG2, withoutG2);
});

test('worked micro-example matches the design doc (~+7.9 dealer)', () => {
  // dong +30 vs three losers −10, W=4, s=3, all fresh (K=40). Doc: dong ≈ +7.9.
  const g = oneWinnerGame(1, 10, [20, 30, 40], 30);
  const { current } = computePoolTimeline([g], { chip_scale: 3 });
  const dong = current.find(p => p.player_id === 10);
  assert.ok(Math.abs(dong.last_delta - 7.9) < 0.2, `expected ~+7.9, got ${dong.last_delta}`);
});

test('peak_rating tracks the high-water mark, not the latest', () => {
  const games = [
    oneWinnerGame(1, 10, [20, 30, 40], 90), // 10 spikes up
    oneWinnerGame(2, 20, [10, 30, 40], 90), // 10 drops back
  ];
  const { current } = computePoolTimeline(games);
  const p = current.find(x => x.player_id === 10);
  assert.ok(p.peak_rating > p.rating, 'peak should exceed current after a drop');
});
