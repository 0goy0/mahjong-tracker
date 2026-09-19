// Achievement tests — focus on the archived-pool behaviour: a stray/junk mode-set
// must NOT block Apex (#1 in EVERY pool) once it's archived. Runs against a throwaway
// DB; env is set BEFORE requiring ./db because db reads its path at module-load time.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.TRACKER_DB = path.join(os.tmpdir(), `mj-ach-test-${Date.now()}.db`);

const db = require('./db');
const { computeAchievements } = require('./achievements');

test.after(() => { try { fs.unlinkSync(process.env.TRACKER_DB); } catch { /* ignore */ } });

function addPlayer(id, name) {
  db.prepare('INSERT INTO players (id, name, color) VALUES (?, ?, ?)').run(id, name, '#f59e0b');
}
function setRating(poolKey, pid, rating) {
  db.prepare('INSERT INTO elo_current (pool_key, player_id, rating, games_played, peak_rating, last_delta) VALUES (?, ?, ?, ?, ?, ?)')
    .run(poolKey, pid, rating, 12, rating, 0);
}
const has = (pid, key) => computeAchievements(db, pid).find(a => a.key === key)?.earned;

let _gid = 1000;
function addTimedGame(pid, ts, winds) {
  _gid += 1;
  db.prepare('INSERT INTO games (id, date, modes, rounds, min_tai, max_tai, pool_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(_gid, ts.slice(0, 10), '["vanilla"]', winds, 0, 5, 'vanilla|0-5', ts);
  db.prepare('INSERT INTO game_seats (game_id, player_id, seat, chips) VALUES (?, ?, ?, ?)').run(_gid, pid, 'dong', 10);
}

test('Marathon — 16 winds in a rolling 24h window that straddles midnight (calendar-day would miss it)', () => {
  addPlayer(90, 'Grinder');
  // 8 winds late Jan 1, 8 winds early/mid Jan 2 — all within 24h of the 16:00 start.
  addTimedGame(90, '2026-01-01 16:00:00', 4);
  addTimedGame(90, '2026-01-01 22:00:00', 4);
  addTimedGame(90, '2026-01-02 03:00:00', 4);
  addTimedGame(90, '2026-01-02 14:00:00', 4);
  assert.strictEqual(has(90, 'marathon'), true); // rolling window sees 16; no single date does
  assert.strictEqual(has(90, 'all_nighter'), false); // only 16 in the window, Ironman needs 20
});

test('Marathon — winds spread beyond 24h do NOT stack', () => {
  addPlayer(91, 'Casual');
  addTimedGame(91, '2026-02-01 12:00:00', 8);
  addTimedGame(91, '2026-02-03 12:00:00', 8); // 48h later — separate window
  assert.strictEqual(has(91, 'marathon'), false);
});

test('Apex — a stray pool blocks Apex until it is archived', () => {
  addPlayer(1, 'Ace');
  addPlayer(2, 'Rival');

  // Ace is #1 of the main pool; Rival is #1 of a stray guo_san 0–5 pool (Ace absent).
  setRating('vanilla|0-5', 1, 1500);
  setRating('vanilla|0-5', 2, 1000);
  setRating('guo_san|0-5', 2, 1200);

  // Ace tops every pool he's IN, but Apex needs #1 in EVERY pool → the stray blocks it.
  assert.strictEqual(has(1, 'top_dog'), true, 'Ace should be Top Dog of the main pool');
  assert.strictEqual(has(1, 'apex'), false, 'stray pool should block Apex');

  // Archive the stray pool → it no longer counts, so Ace is now Apex.
  db.prepare("INSERT INTO archived_pools (pool_key) VALUES ('guo_san|0-5')").run();
  assert.strictEqual(has(1, 'apex'), true, 'archiving the stray pool should unlock Apex');
});

// ── helpers for the rating-history + full-table achievements ────────────────────
function addEloGame(pid, poolKey, ts, before, after, chips = 10) {
  _gid += 1;
  db.prepare('INSERT INTO games (id, date, modes, rounds, min_tai, max_tai, pool_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(_gid, ts.slice(0, 10), '["vanilla"]', 4, 0, 5, poolKey, ts);
  db.prepare('INSERT INTO game_seats (game_id, player_id, seat, chips) VALUES (?, ?, ?, ?)').run(_gid, pid, 'dong', chips);
  db.prepare('INSERT INTO elo_history (game_id, pool_key, player_id, seq, rating_before, rating_after, delta, chips, winds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(_gid, poolKey, pid, 1, before, after, after - before, chips, 4);
  return _gid;
}
function addTableGame(seats, ts, poolKey = 'ks|0-5') {
  _gid += 1;
  db.prepare('INSERT INTO games (id, date, modes, rounds, min_tai, max_tai, pool_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(_gid, ts.slice(0, 10), '["vanilla"]', 4, 0, 5, poolKey, ts);
  const names = ['dong', 'nan', 'xi', 'bei'];
  seats.forEach((s, i) => {
    db.prepare('INSERT INTO game_seats (game_id, player_id, seat, chips) VALUES (?, ?, ?, ?)').run(_gid, s.pid, names[i], s.chips);
    db.prepare('INSERT INTO elo_history (game_id, pool_key, player_id, seq, rating_before, rating_after, delta, chips, winds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(_gid, poolKey, s.pid, i + 1, s.rating, s.rating, 0, s.chips, 4);
  });
  return _gid;
}

test('No Lifer — 24 winds inside a rolling 24h window (also clears Marathon + Ironman)', () => {
  addPlayer(98, 'Zombie');
  for (const h of [0, 4, 8, 12, 16, 20]) addTimedGame(98, `2026-05-01 ${String(h).padStart(2, '0')}:00:00`, 4); // 6×4 = 24
  assert.strictEqual(has(98, 'no_lifer'), true);
  assert.strictEqual(has(98, 'marathon'), true);
  assert.strictEqual(has(98, 'all_nighter'), true);
});

test('King Slayer — anyone who finishes above the table king (highest-rated) earns it', () => {
  addPlayer(94, 'King'); addPlayer(95, 'Mid'); addPlayer(96, 'Low'); addPlayer(97, 'Filler');
  // King is the highest-rated seat but bombs to last. Mid and Low both finish above them.
  addTableGame([
    { pid: 94, chips: -300, rating: 1400 }, // the king, loses hardest
    { pid: 95, chips: 300, rating: 1100 },  // beats the king
    { pid: 96, chips: -50, rating: 1000 },  // also finishes above the king (−50 > −300)
    { pid: 97, chips: 50, rating: 1050 },
  ], '2026-05-10 20:00:00');
  assert.strictEqual(has(95, 'king_slayer'), true);  // not the lowest-rated, still slays
  assert.strictEqual(has(96, 'king_slayer'), true);  // anyone above the king counts
  assert.strictEqual(has(94, 'king_slayer'), false); // the king can't slay itself
});

test('Bull Market — +100 within a rolling week (baseline, not accumulated)', () => {
  addPlayer(92, 'Climber');
  addEloGame(92, 'bull|0-5', '2026-04-01 12:00:00', 1000, 1040);
  addEloGame(92, 'bull|0-5', '2026-04-02 12:00:00', 1040, 1080);
  addEloGame(92, 'bull|0-5', '2026-04-03 12:00:00', 1080, 1110); // 1000 → 1110 in 2 days
  assert.strictEqual(has(92, 'bull_market'), true);
  assert.strictEqual(has(92, 'bear_market'), false);
});

test('Bear Market — −100 within a rolling week', () => {
  addPlayer(93, 'Faller');
  addEloGame(93, 'bear|0-5', '2026-04-01 12:00:00', 1000, 960);
  addEloGame(93, 'bear|0-5', '2026-04-02 12:00:00', 960, 920);
  addEloGame(93, 'bear|0-5', '2026-04-03 12:00:00', 920, 890); // 1000 → 890
  assert.strictEqual(has(93, 'bear_market'), true);
  assert.strictEqual(has(93, 'bull_market'), false);
});
