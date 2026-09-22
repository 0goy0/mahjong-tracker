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

test('King Slayer — beat the reigning pool king (crown-holder), not merely the top seat', () => {
  addPlayer(94, 'King'); addPlayer(95, 'Mid'); addPlayer(96, 'Low'); addPlayer(97, 'Filler');
  // Establish a crowned pool: ≥5 prior games and 94 is the clear #1 (1400) going in.
  addEloGame(94, 'ks|0-5', '2026-05-01 10:00:00', 1000, 1400);
  addEloGame(95, 'ks|0-5', '2026-05-02 10:00:00', 1000, 1100);
  addEloGame(96, 'ks|0-5', '2026-05-03 10:00:00', 1000, 1000);
  addEloGame(97, 'ks|0-5', '2026-05-04 10:00:00', 1000, 1050);
  addEloGame(95, 'ks|0-5', '2026-05-05 10:00:00', 1100, 1100); // 5th prior game → crown exists
  // The king sits down and bombs to last. 95 wins chips (a real slaying); 96
  // finishes above the king but still LOST chips (−50), so it doesn't count.
  addTableGame([
    { pid: 94, chips: -300, rating: 1400 }, // the reigning king, loses hardest
    { pid: 95, chips: 300, rating: 1100 },  // WON chips and beat the king → slays
    { pid: 96, chips: -50, rating: 1000 },  // above the king (−50 > −300) but still lost chips
    { pid: 97, chips: 50, rating: 1050 },
  ], '2026-05-10 20:00:00', 'ks|0-5');
  assert.strictEqual(has(95, 'king_slayer'), true);  // won chips + slew the crowned king
  assert.strictEqual(has(96, 'king_slayer'), false); // lost chips → not a slaying
  assert.strictEqual(has(94, 'king_slayer'), false); // the king can't slay itself
});

test('King Slayer — is per-mode: beating a king of ANOTHER pool does not count', () => {
  addPlayer(74, 'KingA'); addPlayer(75, 'Challenger'); addPlayer(76, 'P3'); addPlayer(77, 'P4');
  // 74 is the crowned #1 of pool A (1500), but only mid-pack in pool B.
  addEloGame(74, 'modeA|0-5', '2026-08-01 10:00:00', 1000, 1500);
  addEloGame(75, 'modeA|0-5', '2026-08-02 10:00:00', 1000, 1100);
  addEloGame(76, 'modeA|0-5', '2026-08-03 10:00:00', 1000, 1000);
  addEloGame(77, 'modeA|0-5', '2026-08-04 10:00:00', 1000, 1050);
  addEloGame(75, 'modeA|0-5', '2026-08-05 10:00:00', 1100, 1100);
  // Pool B has its own history; here 76 is the #1, 74 is NOT the king.
  addEloGame(76, 'modeB|0-5', '2026-08-01 10:00:00', 1000, 1400);
  addEloGame(74, 'modeB|0-5', '2026-08-02 10:00:00', 1000, 1050);
  addEloGame(75, 'modeB|0-5', '2026-08-03 10:00:00', 1000, 1000);
  addEloGame(77, 'modeB|0-5', '2026-08-04 10:00:00', 1000, 1020);
  addEloGame(76, 'modeB|0-5', '2026-08-05 10:00:00', 1400, 1400);
  // A pool-B game where 75 beats 74 — but 74 isn't pool B's king. Pool B's real
  // king (76) wins, so nobody slays a king here.
  addTableGame([
    { pid: 74, chips: -200, rating: 1050 }, // king of pool A only — not the king HERE
    { pid: 75, chips: 100, rating: 1000 },  // beats 74, but 74 isn't pool B's king
    { pid: 76, chips: 300, rating: 1400 },  // the actual pool-B king — wins, unslain
    { pid: 77, chips: -200, rating: 1020 },
  ], '2026-08-10 20:00:00', 'modeB|0-5');
  assert.strictEqual(has(75, 'king_slayer'), false); // 74 is only king of pool A
});

test('King Slayer — beating the top SEAT does NOT count when the real king is absent', () => {
  addPlayer(84, 'Absent'); addPlayer(85, 'Second'); addPlayer(86, 'Third'); addPlayer(87, 'Fourth'); addPlayer(88, 'Extra');
  // 84 is the crowned #1 (1500) but never sits at this table. ≥5 prior games.
  addEloGame(84, 'ksn|0-5', '2026-06-01 10:00:00', 1000, 1500);
  addEloGame(85, 'ksn|0-5', '2026-06-02 10:00:00', 1000, 1200);
  addEloGame(86, 'ksn|0-5', '2026-06-03 10:00:00', 1000, 1100);
  addEloGame(87, 'ksn|0-5', '2026-06-04 10:00:00', 1000, 1150);
  addEloGame(85, 'ksn|0-5', '2026-06-05 10:00:00', 1200, 1200); // 5th prior game
  // The king (84) is absent; 85 is the strongest seat at 1200 but is NOT the crown.
  addTableGame([
    { pid: 85, chips: -200, rating: 1200 }, // top seat here, but not the reigning king
    { pid: 86, chips: 100, rating: 1100 },  // beats the top seat…
    { pid: 87, chips: 50, rating: 1150 },   // …and so does this one
    { pid: 88, chips: 50, rating: 1000 },
  ], '2026-06-10 20:00:00', 'ksn|0-5');
  assert.strictEqual(has(86, 'king_slayer'), false); // top seat wasn't the king
  assert.strictEqual(has(87, 'king_slayer'), false);
});

test('Bent Over — 300+ loss in Vanilla · 1–6 tai only (not other pools/thresholds)', () => {
  addPlayer(70, 'Victim');
  const bend = (gid, pool, chips) => {
    db.prepare('INSERT INTO games (id, date, modes, rounds, min_tai, max_tai, pool_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(gid, '2026-07-01', '["vanilla"]', 4, 1, 6, pool, '2026-07-01 12:00:00');
    db.prepare('INSERT INTO game_seats (game_id, player_id, seat, chips) VALUES (?, ?, ?, ?)').run(gid, 70, 'dong', chips);
  };
  bend(2001, 'vanilla|1-6', -350); // counts
  bend(2002, 'vanilla|1-6', -300); // counts (boundary)
  bend(2003, 'vanilla|1-6', -200); // too small
  bend(2004, 'guo_san|1-6', -400); // wrong pool
  const bo = computeAchievements(db, 70).find(a => a.key === 'bent_over');
  assert.strictEqual(bo.earned, true);
  assert.strictEqual(bo.count, 2);
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
