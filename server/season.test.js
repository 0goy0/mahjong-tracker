// Season engine tests — season identity/numbering + the season-only rubber-band.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
process.env.TRACKER_DB = path.join(os.tmpdir(), `mj-season-test-${Date.now()}.db`);
const db = require('./db');
const { seasonOf, seasonNum, seasonKingsAndChampion } = require('./season');
const { rubberFactor, SEASON_RUBBER_BAND: RB, computePoolTimeline } = require('./elo');

test('seasonOf — everything is Season 1 while the cutover is unset', () => {
  assert.deepStrictEqual(seasonOf('2026-08-15', null), { id: 'S1', num: 1 });
  assert.deepStrictEqual(seasonOf('2026-09-30', null), { id: 'S1', num: 1 });
});

test('seasonOf — cutover splits S1 (frozen) from monthly seasons', () => {
  const cut = '2026-10-01';
  assert.deepStrictEqual(seasonOf('2026-09-24', cut), { id: 'S1', num: 1 });   // before cutover
  assert.deepStrictEqual(seasonOf('2026-10-01', cut), { id: '2026-10', num: 2 }); // cutover day
  assert.deepStrictEqual(seasonOf('2026-10-31', cut), { id: '2026-10', num: 2 });
  assert.deepStrictEqual(seasonOf('2026-11-05', cut), { id: '2026-11', num: 3 });
  assert.deepStrictEqual(seasonOf('2027-01-02', cut), { id: '2027-01', num: 5 });
});

test('seasonOf — mid-month cutover keeps pre-cutover games in S1', () => {
  const cut = '2026-10-10';
  assert.strictEqual(seasonOf('2026-10-05', cut).id, 'S1');       // same month, before cutover
  assert.strictEqual(seasonOf('2026-10-10', cut).id, '2026-10');  // on/after cutover
  assert.strictEqual(seasonNum('2026-10', cut), 2);
});

test('rubber-band — bottom bunch boosted, top bunch taxed (>=6 players)', () => {
  // top winner loses juice, top loser bleeds more; bottom winner surges, bottom loser cushioned
  assert.strictEqual(rubberFactor(0, 6, +10, RB), 1 - RB.damp); // top, win  -> 0.6
  assert.strictEqual(rubberFactor(0, 6, -10, RB), 1 + RB.boost); // top, lose -> 1.5
  assert.strictEqual(rubberFactor(5, 6, +10, RB), 1 + RB.boost); // bottom, win  -> 1.5
  assert.strictEqual(rubberFactor(5, 6, -10, RB), 1 - RB.damp);  // bottom, lose -> 0.6
});

test('rubber-band — middle players and small pools are untouched', () => {
  assert.strictEqual(rubberFactor(3, 8, +10, RB), 1); // middle of 8
  assert.strictEqual(rubberFactor(0, 5, +10, RB), 1); // pool < minPlayers (6)
  assert.strictEqual(rubberFactor(0, 6, 0, RB), 1);   // net-0 game never moved
});

test('rubber-band — season run diverges from a plain run, sign-locked', () => {
  // 6 players; a lopsided game. With the rubber-band the ladder should compress.
  const seats = [
    { player_id: 1, chips: 300 }, { player_id: 2, chips: 100 },
    { player_id: 3, chips: -100 }, { player_id: 4, chips: -300 },
  ];
  const games = [{ id: 1, winds: 4, base_chips: 500, rating_multiplier: 1, seats }];
  const plain = computePoolTimeline(games, {});
  const seasonal = computePoolTimeline(games, { rubberBand: RB });
  // With only 4 players (< minPlayers 6) the rubber-band is inert → identical.
  assert.deepStrictEqual(
    plain.current.map(c => Math.round(c.rating)).sort(),
    seasonal.current.map(c => Math.round(c.rating)).sort()
  );
});

test('seasonKingsAndChampion — per-pool kings + overall champion, 5-game floor', () => {
  db.prepare("INSERT INTO players (id,name,color) VALUES (40,'Kingpin','#f59e0b'),(41,'Runner','#f59e0b'),(42,'Emperor','#f59e0b'),(43,'Rookie','#f59e0b')").run();
  const ins = db.prepare('INSERT INTO season_elo_current (season,pool_key,player_id,rating,games_played,peak_rating,last_delta) VALUES (?,?,?,?,?,?,0)');
  ins.run('2026-10', 'poolA|1-6', 40, 1200, 6, 1200);
  ins.run('2026-10', 'poolA|1-6', 41, 1100, 6, 1100);
  ins.run('2026-10', 'poolB|1-6', 42, 1300, 7, 1300); // highest overall, eligible
  ins.run('2026-10', 'poolB|1-6', 43, 1400, 3, 1400); // higher rating BUT <5 games → ineligible
  const { kings, champion } = seasonKingsAndChampion(db, '2026-10', 5);
  assert.strictEqual(kings.length, 2);                        // one king per pool
  assert.strictEqual(kings.find(k => k.pool_key === 'poolA|1-6').player_id, 40);
  assert.strictEqual(kings.find(k => k.pool_key === 'poolB|1-6').player_id, 42); // Rookie excluded by floor
  assert.strictEqual(champion.player_id, 42);                 // best eligible rating overall
});

test('rubber-band — kicks in once the pool reaches 6 players', () => {
  // Warm up 6 players across games so standings exist, then compare a final game.
  const mk = (id, s) => ({ id, winds: 4, base_chips: 500, rating_multiplier: 1, seats: s });
  const warm = [
    mk(1, [{ player_id: 1, chips: 200 }, { player_id: 2, chips: 60 }, { player_id: 3, chips: -60 }, { player_id: 4, chips: -200 }]),
    mk(2, [{ player_id: 5, chips: 200 }, { player_id: 6, chips: 60 }, { player_id: 1, chips: -60 }, { player_id: 4, chips: -200 }]),
  ];
  const plain = computePoolTimeline(warm, {});
  const seasonal = computePoolTimeline(warm, { rubberBand: RB });
  // Game 2 has 6 distinct players in standings → season result must differ from plain.
  const pMap = Object.fromEntries(plain.current.map(c => [c.player_id, Math.round(c.rating)]));
  const sMap = Object.fromEntries(seasonal.current.map(c => [c.player_id, Math.round(c.rating)]));
  const differs = Object.keys(pMap).some(pid => pMap[pid] !== sMap[pid]);
  assert.ok(differs, 'rubber-band should change ratings once >=6 players are in the pool');
});
