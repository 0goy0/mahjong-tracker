// Season engine tests — season identity/numbering + the season-only rubber-band.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
process.env.TRACKER_DB = path.join(os.tmpdir(), `mj-season-test-${Date.now()}.db`);
const db = require('./db');
const { seasonOf, seasonNum, seasonKingsAndChampion, seasonCrown, listSeasons, currentSeason, seasonRankEntry, seasonRankTagName } = require('./season');
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

test('rubber-band — continuous: bottom boosted, top taxed, scales by standing', () => {
  // rank 0 = very top (pos 1, c +1); rank n-1 = very bottom (pos 0, c -1).
  assert.strictEqual(rubberFactor(0, 6, +10, RB), 1 - RB.winTax);  // top, win  -> 0.25
  assert.strictEqual(rubberFactor(0, 6, -10, RB), 1 + RB.lossAmp); // top, lose -> 1.75
  assert.strictEqual(rubberFactor(5, 6, +10, RB), 1 + RB.winTax);  // bottom, win  -> 1.75
  assert.strictEqual(rubberFactor(5, 6, -10, RB), 1 - RB.lossAmp); // bottom, lose -> 0.25
  // a mid-low player still gets a real boost (the point — no one is stuck):
  assert.ok(rubberFactor(4, 6, +10, RB) > 1.3, 'a lower-mid player wins more');
});

test('rubber-band — exact centre, small pools and net-0 are untouched', () => {
  assert.strictEqual(rubberFactor(3, 7, +10, RB), 1); // dead centre of 7 (c=0)
  assert.strictEqual(rubberFactor(0, 3, +10, RB), 1); // pool < minPlayers (4)
  assert.strictEqual(rubberFactor(0, 6, 0, RB), 1);   // net-0 game never moved
});

test('rubber-band — neutral on a tie, diverges from a plain run once ratings spread', () => {
  const seats = [
    { player_id: 1, chips: 300 }, { player_id: 2, chips: 100 },
    { player_id: 3, chips: -100 }, { player_id: 4, chips: -300 },
  ];
  // First game only: everyone starts tied at base 1000, so rank position is
  // meaningless and the rubber-band must NOT reshape the ladder (the season-start
  // inversion bug). Season run == plain run.
  const g1 = [{ id: 1, winds: 4, base_chips: 500, rating_multiplier: 1, seats }];
  const plain1 = computePoolTimeline(g1, {});
  const seasonal1 = computePoolTimeline(g1, { rubberBand: RB });
  const p1 = Object.fromEntries(plain1.current.map(c => [c.player_id, Math.round(c.rating)]));
  const s1 = Object.fromEntries(seasonal1.current.map(c => [c.player_id, Math.round(c.rating)]));
  assert.deepStrictEqual(s1, p1, 'first game (all tied) is untouched by the rubber-band');

  // Second game: ratings have now diverged, so the rubber-band reshapes the ladder
  // vs a plain run (leaders taxed, trailers boosted).
  const games = [g1[0], { id: 2, winds: 4, base_chips: 500, rating_multiplier: 1, seats }];
  const plain = computePoolTimeline(games, {});
  const seasonal = computePoolTimeline(games, { rubberBand: RB });
  const pMap = Object.fromEntries(plain.current.map(c => [c.player_id, Math.round(c.rating)]));
  const sMap = Object.fromEntries(seasonal.current.map(c => [c.player_id, Math.round(c.rating)]));
  assert.ok(Object.keys(pMap).some(pid => pMap[pid] !== sMap[pid]), 'rubber-band changes the ladder');
  // sign-lock holds: winner still up, loser still down
  assert.ok(sMap[1] >= 1000 && sMap[4] <= 1000);
});

test('seasonKingsAndChampion — King = top rating in any pool with ≥5 games (no per-player floor)', () => {
  db.prepare("INSERT INTO players (id,name,color) VALUES (40,'Kingpin','#f59e0b'),(41,'Runner','#f59e0b'),(42,'Emperor','#f59e0b'),(43,'Rookie','#f59e0b'),(44,'Lonely','#f59e0b')").run();
  const insC = db.prepare('INSERT INTO season_elo_current (season,pool_key,player_id,rating,games_played,peak_rating,last_delta) VALUES (?,?,?,?,?,?,0)');
  insC.run('2026-10', 'poolA|1-6', 40, 1200, 6, 1200);
  insC.run('2026-10', 'poolA|1-6', 41, 1100, 6, 1100);
  insC.run('2026-10', 'poolB|1-6', 42, 1300, 7, 1300);
  insC.run('2026-10', 'poolB|1-6', 43, 1400, 3, 1400); // top rating, only 3 personal games — now STILL King
  insC.run('2026-10', 'poolC|1-6', 44, 1500, 2, 1500); // highest rating overall BUT its pool is under the floor
  // The per-pool ≥5 gate reads the games table.
  const insG = db.prepare('INSERT INTO games (id,date,modes,rounds,min_tai,max_tai,pool_key) VALUES (?,?,?,?,?,?,?)');
  let g = 1000;
  const addGames = (pk, n) => { for (let i = 0; i < n; i++) insG.run(++g, `2026-10-0${(i % 9) + 1}`, '["vanilla"]', 4, 1, 6, pk); };
  addGames('poolA|1-6', 5);
  addGames('poolB|1-6', 5);
  addGames('poolC|1-6', 2); // below the floor → no King for poolC
  const { kings, champion } = seasonKingsAndChampion(db, '2026-10', 5);
  assert.strictEqual(kings.length, 2);                                          // poolA + poolB qualify
  assert.strictEqual(kings.find(k => k.pool_key === 'poolA|1-6').player_id, 40);
  assert.strictEqual(kings.find(k => k.pool_key === 'poolB|1-6').player_id, 43); // Rookie is King on pure rating
  assert.ok(!kings.find(k => k.pool_key === 'poolC|1-6'), 'under-floor pool mints no King');
  assert.strictEqual(champion.player_id, 43);                                   // 1400, best among qualifying kings
});

test('seasonCrown — king for leading a qualifying pool, emperor for leading ALL of them', () => {
  const S = '2026-11'; // isolated season id so other tests' pools don't bleed in
  db.prepare("INSERT INTO players (id,name,color) VALUES (50,'Mono','#f59e0b'),(51,'Sub','#f59e0b')").run();
  const insC = db.prepare('INSERT INTO season_elo_current (season,pool_key,player_id,rating,games_played,peak_rating,last_delta) VALUES (?,?,?,?,?,?,0)');
  insC.run(S, 'poolX|1-6', 50, 1300, 1, 1300); // leads X with a single personal game
  insC.run(S, 'poolX|1-6', 51, 1200, 8, 1200);
  insC.run(S, 'poolY|1-6', 50, 1250, 1, 1250); // also leads Y
  insC.run(S, 'poolY|1-6', 51, 1100, 8, 1100);
  const insG = db.prepare('INSERT INTO games (id,date,modes,rounds,min_tai,max_tai,pool_key) VALUES (?,?,?,?,?,?,?)');
  let g = 2000;
  const addGames = (pk, n) => { for (let i = 0; i < n; i++) insG.run(++g, `2026-11-0${(i % 9) + 1}`, '["vanilla"]', 4, 1, 6, pk); };
  addGames('poolX|1-6', 5);
  addGames('poolY|1-6', 5);
  assert.strictEqual(seasonCrown(db, 51, S, 5), null);       // leads neither pool
  assert.strictEqual(seasonCrown(db, 50, S, 5), 'emperor');  // leads both qualifying pools (≥2)
  // Add a third qualifying pool that 50 does NOT lead → 50 drops to plain king.
  insC.run(S, 'poolZ|1-6', 51, 1400, 8, 1400);
  insC.run(S, 'poolZ|1-6', 50, 1000, 1, 1000);
  addGames('poolZ|1-6', 5);
  assert.strictEqual(seasonCrown(db, 50, S, 5), 'king');     // leads 2 of 3
  assert.strictEqual(seasonCrown(db, 51, S, 5), 'king');     // leads 1 of 3
});

test('listSeasons — always includes the current season, even with no games', () => {
  // Regression: a freshly-started season has no games, but must still be a valid
  // filter option (else the Leaderboard season dropdown defaults to a season that
  // isn't in its own list and silently shows nothing).
  const cur = currentSeason(db);
  const list = listSeasons(db);
  const entry = list.find(s => s.id === cur.id);
  assert.ok(entry, 'current season is present in listSeasons');
  assert.strictEqual(entry.current, true);
});


test('season ranks — Goldfish is 900-950, Seaweed below 900', () => {
  assert.strictEqual(seasonRankEntry(960).name, 'Clownfish');
  assert.strictEqual(seasonRankEntry(900).name, 'Goldfish');
  assert.strictEqual(seasonRankEntry(949).name, 'Goldfish');
  assert.strictEqual(seasonRankEntry(899).name, 'Seaweed');
  assert.strictEqual(seasonRankEntry(500).name, 'Seaweed');
});

test('admin-tag name abbreviates only when the crown prefix would overflow 16 chars', () => {
  // Full name shows with no/short prefix; "KING Megalodon" (14) still fits.
  assert.strictEqual(seasonRankTagName(1250, 0), 'Megalodon');
  assert.strictEqual(seasonRankTagName(1250, 'KING '.length), 'Megalodon');
  // "EMPEROR Megalodon" (17) overflows → short alias; tag becomes "EMPEROR Mega".
  assert.strictEqual(seasonRankTagName(1250, 'EMPEROR '.length), 'Mega');
  assert.strictEqual(seasonRankTagName(960, 'EMPEROR '.length), 'Clown'); // Clownfish 17 → Clown
  // Ranks with no short alias just keep the full name.
  assert.strictEqual(seasonRankTagName(1500, 'EMPEROR '.length), 'Kraken');
});
