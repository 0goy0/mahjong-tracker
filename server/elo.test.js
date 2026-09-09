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
  // All four fresh → uniform K → RAW deltas sum to ~0. Tested at loss_factor:1
  // because the default (0.6) softens losses on purpose, which intentionally
  // breaks conservation to make climbing easier (see tests (h)/(i)).
  const g = oneWinnerGame(1, 10, [20, 30, 40], 30);
  const { current } = computePoolTimeline([g], { loss_factor: 1 });
  const sum = current.reduce((a, p) => a + (p.rating - DEFAULT_CONFIG.base_rating), 0);
  assert.ok(Math.abs(sum) < 1e-9, `sum of deltas should be ~0, got ${sum}`);
});

test('(b) monotonicity — more chips means a larger winner delta', () => {
  // Fixed stake so the chip denominator is constant across both games — otherwise
  // a sole winner's normalized chipScore is 0.5 regardless of how much they won.
  const stake = g => ({ ...g, base_chips: 500 });
  const small = computePoolTimeline([stake(oneWinnerGame(1, 10, [20, 30, 40], 30))]);
  const big = computePoolTimeline([stake(oneWinnerGame(1, 10, [20, 30, 40], 90))]);
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

test('(f) sign lock — a chip loss never yields a positive delta (the "zann" case)', () => {
  // 2026-09-07 Vanilla: shayn +66 (1st), zann -18 (2nd), grace -22 (3rd), amber -26 (4th).
  // Large stake so placement (+0.034 for 2nd) would otherwise outweigh zann's small
  // normalized loss and flip her delta positive (pre-fix she gained +3).
  const game = {
    id: 1, winds: 4, base_chips: 500, transfers: [],
    seats: [
      { player_id: 1, chips: 66 },
      { player_id: 2, chips: -18 },
      { player_id: 3, chips: -22 },
      { player_id: 4, chips: -26 },
    ],
  };
  const d = computeGameDeltas(game, {}, {}, DEFAULT_CONFIG);
  assert.ok(d[1].delta > 0, 'chip winner must gain rating');
  assert.ok(d[2].delta <= 0, `chip loser must not gain (was +3 pre-fix): ${d[2].delta}`);
  assert.ok(d[3].delta < 0 && d[4].delta < 0, 'the other chip losers lose rating');
  // Placement still orders the magnitude among losers: 2nd loses less than 3rd, 3rd less than 4th.
  assert.ok(
    d[2].delta > d[3].delta && d[3].delta > d[4].delta,
    `placement must still order losers by magnitude: ${d[2].delta}, ${d[3].delta}, ${d[4].delta}`,
  );
});

test('sign lock — a net-0 wash still moves on opponent strength (vs stronger → +)', () => {
  // Two players net 0. vs a stronger field the wash should nudge UP, vs weaker DOWN.
  const wash = {
    id: 1, winds: 4, base_chips: 500, transfers: [],
    seats: [
      { player_id: 1, chips: 10 }, { player_id: 2, chips: -10 },
      { player_id: 3, chips: 0 },  { player_id: 4, chips: 0 },
    ],
  };
  const strong = computeGameDeltas(wash, { 1: 1000, 2: 1000, 3: 1000, 4: 1400 }, {}, DEFAULT_CONFIG);
  assert.ok(strong[3].delta > 0, `net-0 vs a stronger field should gain: ${strong[3].delta}`);
});

test('worked micro-example — current formula: dealer win is positive and conserved', () => {
  // dong +30 vs three losers −10 each, fixed stake 500, all fresh (uniform K).
  // (Supersedes the old design-doc sigmoid example, which is no longer the formula.)
  const g = { ...oneWinnerGame(1, 10, [20, 30, 40], 30), base_chips: 500 };
  const { current } = computePoolTimeline([g], { loss_factor: 1 }); // raw math
  const dong = current.find(p => p.player_id === 10);
  const sum = current.reduce((a, p) => a + (p.rating - DEFAULT_CONFIG.base_rating), 0);
  assert.ok(dong.last_delta > 0, `dealer win should be positive: ${dong.last_delta}`);
  assert.ok(Math.abs(sum) < 1e-9, `conserved under uniform K: ${sum}`);
  assert.ok(Math.abs(dong.last_delta - 26) < 0.5, `expected ~+26 under current formula, got ${dong.last_delta}`);
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

test('(g) softened losses — losers drop by loss_factor×, winners unchanged', () => {
  const g = { ...oneWinnerGame(1, 10, [20, 30, 40], 30), base_chips: 500 };
  const full = computeGameDeltas(g, {}, {}, { ...DEFAULT_CONFIG, loss_factor: 1 });
  const soft = computeGameDeltas(g, {}, {}, { ...DEFAULT_CONFIG, loss_factor: 0.6 });
  // Winner's gain is untouched by the loss factor.
  assert.ok(Math.abs(soft[10].delta - full[10].delta) < 1e-9, 'winner delta unchanged by loss_factor');
  // Each loser drops exactly loss_factor× the unsoftened amount, and still loses.
  for (const l of [20, 30, 40]) {
    assert.ok(soft[l].delta < 0, `loser still loses rating: ${soft[l].delta}`);
    assert.ok(Math.abs(soft[l].delta - full[l].delta * 0.6) < 1e-9,
      `loser ${l} should be 0.6× unsoftened: ${soft[l].delta} vs ${full[l].delta}`);
  }
});

test('(h) softened losses inflate total rating — climbing is easier', () => {
  const g = { ...oneWinnerGame(1, 10, [20, 30, 40], 30), base_chips: 500 };
  const { current } = computePoolTimeline([g]); // default loss_factor (0.6)
  const sum = current.reduce((a, p) => a + (p.rating - DEFAULT_CONFIG.base_rating), 0);
  const winnings = current
    .filter(p => p.rating > DEFAULT_CONFIG.base_rating)
    .reduce((a, p) => a + (p.rating - DEFAULT_CONFIG.base_rating), 0);
  assert.ok(sum > 0, `net rating should inflate upward: ${sum}`);
  // Invariant: net drift == (1 - loss_factor) × total winnings.
  assert.ok(Math.abs(sum - winnings * (1 - DEFAULT_CONFIG.loss_factor)) < 1e-9,
    `net should equal (1-lf)×winnings: ${sum}`);
});

test('(i) monotonic losses survive softening — a bigger chip loss still costs more', () => {
  const d = computeGameDeltas({
    id: 1, winds: 4, base_chips: 500, transfers: [],
    seats: [
      { player_id: 1, chips: 90 }, { player_id: 2, chips: -10 },
      { player_id: 3, chips: -30 }, { player_id: 4, chips: -50 },
    ],
  }, {}, {}, DEFAULT_CONFIG);
  assert.ok(d[2].delta > d[3].delta && d[3].delta > d[4].delta,
    `more chips lost → more rating lost even softened: ${d[2].delta}, ${d[3].delta}, ${d[4].delta}`);
});
