// Bot logic tests — the promotion-message fix, streak callouts, and the ELO
// deltas in the game-logged broadcast. Runs against a throwaway DB so it never
// touches real data. All env is set BEFORE requiring ./db and ./bot because both
// read config (DB path, chat/topic ids) at module-load time.
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.TRACKER_DB = path.join(os.tmpdir(), `mj-bot-test-${Date.now()}.db`);
process.env.TELEGRAM_TOKEN = 'test:token';
process.env.TELEGRAM_GROUP_CHAT_ID = '-100999';
process.env.TELEGRAM_LOGS_TOPIC_ID = '7';

const db = require('./db');
const bot = require('./bot'); // startBot fn with test helpers attached (no bot is constructed)

test.after(() => { try { fs.unlinkSync(process.env.TRACKER_DB); } catch { /* ignore */ } });

// ── seed helpers ────────────────────────────────────────────────────────────
let gid = 0;
function addPlayer(id, name, tg = null) {
  db.prepare('INSERT INTO players (id, name, color, telegram_user_id) VALUES (?, ?, ?, ?)')
    .run(id, name, '#f59e0b', tg);
}
function addGame(seats, date, poolKey = 'vanilla|0-5') {
  gid += 1;
  db.prepare('INSERT INTO games (id, date, modes, rounds, min_tai, max_tai, pool_key) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(gid, date, '["vanilla"]', 4, 0, 5, poolKey);
  const s = db.prepare('INSERT INTO game_seats (game_id, player_id, seat, chips) VALUES (?, ?, ?, ?)');
  const seatNames = ['dong', 'nan', 'xi', 'bei'];
  seats.forEach(([pid, chips], i) => s.run(gid, pid, seatNames[i] || 'dong', chips));
  return gid;
}
function setRating(pid, rating) {
  db.prepare('INSERT INTO elo_current (pool_key, player_id, rating, games_played, peak_rating, last_delta) VALUES (?, ?, ?, ?, ?, ?)')
    .run('vanilla|0-5', pid, rating, 12, rating, 0);
}
function mockBot() {
  const sent = [];
  return {
    sent,
    sendMessage: (_chat, text) => { sent.push(text); return Promise.resolve(); },
    setChatAdministratorCustomTitle: () => Promise.resolve(),
  };
}

// ── getStreak ────────────────────────────────────────────────────────────────
test('getStreak — counts the current WIN streak and stops at the first loss', () => {
  addPlayer(1, 'Streaky');
  addPlayer(2, 'Filler');
  addGame([[1, -10], [2, 10]], '2026-01-01'); // loss (oldest)
  addGame([[1, 20], [2, -20]], '2026-01-02'); // win
  addGame([[1, 15], [2, -15]], '2026-01-03'); // win
  addGame([[1, 30], [2, -30]], '2026-01-04'); // win (newest)
  assert.deepStrictEqual(bot.getStreak(1), { kind: 'win', count: 3 });
});

test('getStreak — counts a LOSE streak', () => {
  addPlayer(3, 'Cracked');
  addGame([[3, -10], [2, 10]], '2026-02-01');
  addGame([[3, -20], [2, 20]], '2026-02-02');
  addGame([[3, -5], [2, 5]], '2026-02-03');
  assert.deepStrictEqual(bot.getStreak(3), { kind: 'lose', count: 3 });
});

// ── streakLine ────────────────────────────────────────────────────────────────
test('streakLine — names the player, reads win vs lose, and escalates', () => {
  assert.match(bot.streakLine('Zoe', 'win', 3), /Zoe/);
  assert.match(bot.streakLine('Zoe', 'win', 3), /wins in a row/i);
  assert.match(bot.streakLine('Zoe', 'lose', 3), /dropped/i);
  assert.notStrictEqual(bot.streakLine('Zoe', 'win', 3), bot.streakLine('Zoe', 'win', 6));
});

// ── updateRankTitles — the promotion-message fix ──────────────────────────────
test('updateRankTitles — announces a genuine rank-up (Pervert → Boner)', async () => {
  addPlayer(10, 'Wyman', 555001);
  setRating(10, 1365); // Boner (>=1350)
  const mb = mockBot();
  await bot.updateRankTitles(mb, [10], { 10: 1200 }); // was Pervert
  assert.ok(mb.sent.some(t => /ranked up/i.test(t) && /Boner/.test(t)),
    `expected a Boner rank-up message, got: ${JSON.stringify(mb.sent)}`);
});

test('updateRankTitles — silent when only the crown changed (rank unchanged)', async () => {
  addPlayer(11, 'Steady', 555002);
  setRating(11, 1365);
  const mb = mockBot();
  await bot.updateRankTitles(mb, [11], { 11: 1360 }); // Boner before AND after
  assert.strictEqual(mb.sent.length, 0, `no rank-up expected, got: ${JSON.stringify(mb.sent)}`);
});

test('updateRankTitles — silent on debut (no prior rating to diff)', async () => {
  addPlayer(12, 'Rookie', 555003);
  setRating(12, 1010);
  const mb = mockBot();
  await bot.updateRankTitles(mb, [12], { 12: null });
  assert.strictEqual(mb.sent.length, 0);
});

test('updateRankTitles — announces a DEMOTION (Boner → Pervert)', async () => {
  addPlayer(13, 'Slipping', 555004);
  setRating(13, 1200); // Pervert (1150–1349)
  const mb = mockBot();
  await bot.updateRankTitles(mb, [13], { 13: 1400 }); // was Boner
  assert.ok(mb.sent.some(t => /slipped down/i.test(t) && /Pervert/.test(t)),
    `expected a demotion message, got: ${JSON.stringify(mb.sent)}`);
});

// ── postGameBroadcast — ELO deltas in the game-logged message ──────────────────
test('postGameBroadcast — shows each player\'s ELO change beside their chips', () => {
  addPlayer(20, 'Winner', 556001);
  addPlayer(21, 'Loser', 556002);
  const g = addGame([[20, 100], [21, -100]], '2026-03-01');
  const insH = db.prepare('INSERT INTO elo_history (game_id, pool_key, player_id, seq, rating_before, rating_after, delta, chips, winds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  insH.run(g, 'vanilla|0-5', 20, 1, 1000, 1025, 25, 100, 4);
  insH.run(g, 'vanilla|0-5', 21, 1, 1000, 985, -15, -100, 4);
  const mb = mockBot();
  bot.postGameBroadcast(mb, g);
  const msg = mb.sent.join('\n');
  assert.match(msg, /\+25 ELO/);
  assert.match(msg, /-15 ELO/);
});
