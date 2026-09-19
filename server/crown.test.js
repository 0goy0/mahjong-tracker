// EMPEROR / KING crown-status tests. Runs against a throwaway DB; env is set BEFORE
// requiring ./db and ./bot because both read config at module-load time.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.TRACKER_DB = path.join(os.tmpdir(), `mj-crown-test-${Date.now()}.db`);
process.env.TELEGRAM_TOKEN = 'test:token';
process.env.TELEGRAM_GROUP_CHAT_ID = '-100999';
process.env.TELEGRAM_LOGS_TOPIC_ID = '7';

const db = require('./db');
const bot = require('./bot');

test.after(() => { try { fs.unlinkSync(process.env.TRACKER_DB); } catch { /* ignore */ } });

let gid = 0;
function addPlayer(id, name) {
  db.prepare('INSERT INTO players (id, name, color) VALUES (?, ?, ?)').run(id, name, '#f59e0b');
}
// n games in a pool (enough to clear the 5-game crown minimum).
function addGames(poolKey, a, b, n) {
  for (let k = 0; k < n; k++) {
    gid += 1;
    db.prepare('INSERT INTO games (id, date, modes, rounds, min_tai, max_tai, pool_key) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(gid, '2026-08-01', '["vanilla"]', 4, 0, 5, poolKey);
    db.prepare('INSERT INTO game_seats (game_id, player_id, seat, chips) VALUES (?, ?, ?, ?)').run(gid, a, 'dong', 10);
    db.prepare('INSERT INTO game_seats (game_id, player_id, seat, chips) VALUES (?, ?, ?, ?)').run(gid, b, 'nan', -10);
  }
}
function setR(poolKey, pid, rating) {
  db.prepare('INSERT INTO elo_current (pool_key, player_id, rating, games_played, peak_rating, last_delta) VALUES (?, ?, ?, ?, ?, ?)')
    .run(poolKey, pid, rating, 10, rating, 0);
}

test('crownStatus — EMPEROR leads every crown pool; KING leads only some', () => {
  addPlayer(1, 'Ruler');
  addPlayer(2, 'Rival');
  addGames('a|0-5', 1, 2, 5);
  addGames('b|2-6', 1, 2, 5);
  setR('a|0-5', 1, 1500); setR('a|0-5', 2, 1000);
  setR('b|2-6', 1, 1500); setR('b|2-6', 2, 1000);

  assert.strictEqual(bot.crownStatus(1), 'emperor'); // leads both crown pools
  assert.strictEqual(bot.crownStatus(2), null);      // leads neither
  assert.match(bot.crownedTitle(1500, 'emperor'), /^EMPEROR /);

  // Rival storms pool b — now each leads exactly one pool → both merely KING.
  db.prepare('UPDATE elo_current SET rating = 2000 WHERE pool_key = ? AND player_id = ?').run('b|2-6', 2);
  assert.strictEqual(bot.crownStatus(1), 'king');
  assert.strictEqual(bot.crownStatus(2), 'king');
});
