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
