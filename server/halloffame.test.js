// Hall of Fame record tests. Throwaway DB; env set before requiring ./db.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.TRACKER_DB = path.join(os.tmpdir(), `mj-hof-test-${Date.now()}.db`);

const db = require('./db');
const elo = require('./elo');
const { computeHallOfFame } = require('./halloffame');

test.after(() => { try { fs.unlinkSync(process.env.TRACKER_DB); } catch { /* ignore */ } });

let gid = 0;
function addPlayer(id, name) {
  db.prepare('INSERT INTO players (id, name, color) VALUES (?, ?, ?)').run(id, name, '#f59e0b');
}
// A 2-seat game with elo_history for both, in vanilla|1-6.
function addGame(date, a, b, poolKey = 'vanilla|1-6') {
  gid += 1;
  db.prepare('INSERT INTO games (id, date, modes, rounds, min_tai, max_tai, pool_key) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(gid, date, '["vanilla"]', 4, 1, 6, poolKey);
  for (const s of [a, b]) {
    db.prepare('INSERT INTO game_seats (game_id, player_id, seat, chips) VALUES (?, ?, ?, ?)').run(gid, s.pid, s.seat, s.chips);
    db.prepare('INSERT INTO elo_history (game_id, pool_key, player_id, seq, rating_before, rating_after, delta, chips, winds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(gid, poolKey, s.pid, 1, s.before, s.after, s.after - s.before, s.chips, 4);
  }
}
function setRating(pid, rating) {
  db.prepare('INSERT INTO elo_current (pool_key, player_id, rating, games_played, peak_rating, last_delta) VALUES (?, ?, ?, ?, ?, ?)')
    .run('vanilla|1-6', pid, rating, 3, rating, 0);
}
const rec = (hof, key) => hof.records.find(r => r.key === key);

test('computeHallOfFame — surfaces the right record holders', () => {
  addPlayer(1, 'Alpha');
  addPlayer(2, 'Bravo');
  // 3 games: Alpha wins all (win streak 3), biggest win 400; Bravo's biggest loss -400.
  addGame('2026-01-01', { pid: 1, seat: 'dong', chips: 400, before: 1000, after: 1050 }, { pid: 2, seat: 'nan', chips: -400, before: 1000, after: 970 });
  addGame('2026-01-02', { pid: 1, seat: 'dong', chips: 100, before: 1050, after: 1075 }, { pid: 2, seat: 'nan', chips: -100, before: 970, after: 955 });
  addGame('2026-01-03', { pid: 1, seat: 'dong', chips: 200, before: 1075, after: 1120 }, { pid: 2, seat: 'nan', chips: -200, before: 955, after: 930 });
  setRating(1, 1120);
  setRating(2, 930);

  const hof = computeHallOfFame(db, elo);

  assert.strictEqual(hof.totalGames, 3);
  assert.strictEqual(rec(hof, 'highest_elo').name, 'Alpha');
  assert.strictEqual(rec(hof, 'highest_elo').value, '1120');
  assert.strictEqual(rec(hof, 'biggest_win').name, 'Alpha');
  assert.strictEqual(rec(hof, 'biggest_win').value, '+400 chips');
  assert.strictEqual(rec(hof, 'biggest_loss').name, 'Bravo');
  assert.strictEqual(rec(hof, 'biggest_loss').value, '-400 chips');
  assert.strictEqual(rec(hof, 'longest_streak').name, 'Alpha');
  assert.strictEqual(rec(hof, 'longest_streak').value, '3 wins');
  assert.strictEqual(rec(hof, 'biggest_gain').name, 'Alpha'); // +50 best delta
  // Most Games is shown in pots (3 games × 4 winds = 12 winds = 3 pots)
  assert.strictEqual(rec(hof, 'most_games').value, '3 pots');
});

test('computeHallOfFame — Best Win Rate needs 10+ games', () => {
  addPlayer(10, 'Sharp');
  addPlayer(11, 'Foil');
  // Sharp: 7 wins / 10 games = 70%. Foil is the mandatory opponent (all losses here).
  for (let k = 0; k < 10; k++) {
    const win = k < 7;
    addGame(`2026-03-${String(k + 1).padStart(2, '0')}`,
      { pid: 10, seat: 'dong', chips: win ? 100 : -100, before: 1000, after: 1000 },
      { pid: 11, seat: 'nan', chips: win ? -100 : 100, before: 1000, after: 1000 });
  }
  const hof = computeHallOfFame(db, elo);
  // Alpha (100% over 3 games) is below the 10-game floor, so Sharp tops it.
  assert.strictEqual(rec(hof, 'best_win_rate').name, 'Sharp');
  assert.strictEqual(rec(hof, 'best_win_rate').value, '70%');
});

test('computeHallOfFame — Longest Reign tracks the KING crown tenure', () => {
  addPlayer(20, 'Reignor');
  addPlayer(21, 'Rival');
  const pool = 'reign|1-6';
  db.prepare('INSERT INTO elo_current (pool_key, player_id, rating, games_played, peak_rating, last_delta) VALUES (?,?,?,?,?,?)').run(pool, 20, 1300, 6, 1300, 0);
  db.prepare('INSERT INTO elo_current (pool_key, player_id, rating, games_played, peak_rating, last_delta) VALUES (?,?,?,?,?,?)').run(pool, 21, 1000, 6, 1000, 0);
  // 6 games from a very early date — Reignor is always top-rated, so he takes the
  // crown at the 5th game (crown threshold) and is still reigning. Starting in 2020
  // guarantees this is the longest reign across all pools (others are 2026-dated).
  for (let k = 1; k <= 6; k++) {
    addGame(`2020-01-0${k}`,
      { pid: 20, seat: 'dong', chips: 10, before: 1300, after: 1300 },
      { pid: 21, seat: 'nan', chips: -10, before: 1000, after: 1000 }, pool);
  }
  const lr = rec(computeHallOfFame(db, elo), 'longest_reign');
  assert.ok(lr, 'a longest_reign record exists');
  assert.strictEqual(lr.name, 'Reignor');
  assert.match(lr.sub, /KING of/);
  assert.match(lr.sub, /still reigning/);        // ongoing reign
  assert.ok(parseInt(lr.value) > 1000, `expected >1000 days, got ${lr.value}`);
});

test('computeHallOfFame — archived pools are excluded', () => {
  // A monster rating sitting in an archived pool must NOT become the Highest Rating.
  addPlayer(3, 'Ghost');
  db.prepare("INSERT INTO elo_current (pool_key, player_id, rating, games_played, peak_rating, last_delta) VALUES ('junk|0-5', 3, 9999, 1, 9999, 0)").run();
  db.prepare("INSERT INTO archived_pools (pool_key) VALUES ('junk|0-5')").run();
  const hof = computeHallOfFame(db, elo);
  assert.notStrictEqual(rec(hof, 'highest_elo').name, 'Ghost');
});
