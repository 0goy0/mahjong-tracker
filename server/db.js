const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
// TRACKER_DB lets tests / throwaway instances point at a scratch database.
const dbPath = process.env.TRACKER_DB || path.join(dataDir, 'tracker.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#f59e0b',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    modes TEXT NOT NULL DEFAULT '["vanilla"]',
    rounds INTEGER NOT NULL DEFAULT 4,
    min_tai INTEGER NOT NULL DEFAULT 0,
    max_tai INTEGER NOT NULL DEFAULT 5,
    -- Canonical rating universe (sorted mode-set + tai). Maintained on write and
    -- self-healed at startup; lets every stats query filter strictly by pool.
    pool_key TEXT,
    duration_minutes INTEGER,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS game_seats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    player_id INTEGER NOT NULL REFERENCES players(id),
    seat TEXT NOT NULL,
    chips INTEGER NOT NULL
  );

  -- Pairwise chip flow: from_player_id paid amount to to_player_id in this game.
  CREATE TABLE IF NOT EXISTS transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    from_player_id INTEGER NOT NULL REFERENCES players(id),
    to_player_id INTEGER NOT NULL REFERENCES players(id),
    amount INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_transfers_game ON transfers(game_id);
  CREATE INDEX IF NOT EXISTS idx_transfers_from ON transfers(from_player_id);
  CREATE INDEX IF NOT EXISTS idx_transfers_to ON transfers(to_player_id);

  -- ── ELO (all DERIVED — regenerable from the game log by replay) ───────────────
  -- Live standing per (pool, player).
  CREATE TABLE IF NOT EXISTS elo_current (
    pool_key      TEXT    NOT NULL,
    player_id     INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    rating        REAL    NOT NULL,
    games_played  INTEGER NOT NULL,
    peak_rating   REAL    NOT NULL,
    last_delta    REAL    NOT NULL,
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (pool_key, player_id)
  );

  -- Per (game, player) timeline row — powers charts + per-game deltas in the log.
  CREATE TABLE IF NOT EXISTS elo_history (
    game_id       INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    pool_key      TEXT    NOT NULL,
    player_id     INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    seq           INTEGER NOT NULL,
    rating_before REAL    NOT NULL,
    rating_after  REAL    NOT NULL,
    delta         REAL    NOT NULL,
    chips         INTEGER NOT NULL,
    winds         INTEGER NOT NULL,
    PRIMARY KEY (game_id, player_id)
  );
  CREATE INDEX IF NOT EXISTS idx_elo_hist_pool ON elo_history(pool_key, seq);
  CREATE INDEX IF NOT EXISTS idx_elo_hist_player ON elo_history(player_id, pool_key, seq);

  CREATE TABLE IF NOT EXISTS elo_config (
    key   TEXT PRIMARY KEY,
    value REAL NOT NULL
  );
`);

// Seed rating config (only inserts missing keys — never clobbers a tuned value).
const seedConfig = db.prepare('INSERT OR IGNORE INTO elo_config (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries({
  base_rating: 1000,
  // K is intentionally FLAT at 200 for everyone (no decay by games played) —
  // matches elo.js DEFAULT_CONFIG. The provisional/mid/stable knobs are kept for
  // a possible future ramp but must stay equal, or veterans get under-scaled.
  k_provisional: 200,
  k_mid: 200,
  k_stable: 200,
  provisional_games: 10,
  stable_games: 30,
})) {
  seedConfig.run(k, v);
}

// ── Migrations ────────────────────────────────────────────────────────────────
// Add columns to already-existing databases without dropping data. Each guard
// checks the live schema first so this is safe to run every startup.
function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
}

if (!hasColumn('players', 'telegram_user_id')) {
  db.exec(`ALTER TABLE players ADD COLUMN telegram_user_id INTEGER`);
}

if (!hasColumn('games', 'rounds')) {
  db.exec(`ALTER TABLE games ADD COLUMN rounds INTEGER NOT NULL DEFAULT 4`);
}
if (!hasColumn('games', 'pool_key')) {
  db.exec(`ALTER TABLE games ADD COLUMN pool_key TEXT`);
}
if (!hasColumn('games', 'base_chips')) {
  db.exec(`ALTER TABLE games ADD COLUMN base_chips INTEGER`);
}
if (!hasColumn('games', 'deleted_at')) {
  db.exec(`ALTER TABLE games ADD COLUMN deleted_at TEXT`);
}
if (!hasColumn('games', 'rating_multiplier')) {
  db.exec(`ALTER TABLE games ADD COLUMN rating_multiplier REAL NOT NULL DEFAULT 1`);
}

// Backfill base_chips = 500 for all games that predate the field
db.prepare(`UPDATE games SET base_chips = 500 WHERE base_chips IS NULL`).run();

if (!hasColumn('players', 'avatar')) {
  db.exec(`ALTER TABLE players ADD COLUMN avatar TEXT`);
}

// The last rank the bot ANNOUNCED for this player (e.g. "半色 Boner"). Lets rank
// up/down messages self-heal: if an announcement is ever missed, the stored rank
// lags the real one and the next recompute catches up. Seeded silently the first
// time a player is processed (so no flood on first deploy).
if (!hasColumn('players', 'announced_rank')) {
  db.exec(`ALTER TABLE players ADD COLUMN announced_rank TEXT`);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS achievements (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id    INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    key          TEXT NOT NULL,
    awarded_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(player_id, key)
  );

  CREATE TABLE IF NOT EXISTS game_reactions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id      INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    emoji        TEXT NOT NULL,
    reactor      TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(game_id, emoji, reactor)
  );
  CREATE INDEX IF NOT EXISTS idx_reactions_game ON game_reactions(game_id);
`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_games_pool ON games(pool_key)`);

// Pools hidden from the pool list, standings, KING crowns and Apex WITHOUT deleting
// their game history — a one-off / junk mode-set can be tucked away so it stops
// cluttering rankings and blocking Apex (#1 in EVERY pool). Un-archive = delete the row.
db.exec(`
  CREATE TABLE IF NOT EXISTS archived_pools (
    pool_key    TEXT PRIMARY KEY,
    archived_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Group-chat novelty counter: tallies how many times each Telegram user says the
// word, keyed by their telegram user id (works even for people who aren't linked
// tracker players). name is their display name at last count, for the leaderboard.
db.exec(`
  CREATE TABLE IF NOT EXISTS word_counter (
    tg_user_id   INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,
    count        INTEGER NOT NULL DEFAULT 0,
    last_said_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Remembers the Telegram message posted for each game's log broadcast, so an edit
// can delete the stale post and put up the corrected one, and a delete can remove
// it. One row per game (re-broadcasting overwrites it).
db.exec(`
  CREATE TABLE IF NOT EXISTS game_broadcasts (
    game_id     INTEGER PRIMARY KEY,
    chat_id     INTEGER NOT NULL,
    message_id  INTEGER NOT NULL,
    posted_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Running max hits already counted per message, so an EDIT that adds more slurs
// only credits the delta (no double-counting the original), and editing them out
// never subtracts — once said, it's counted.
db.exec(`
  CREATE TABLE IF NOT EXISTS message_word_hits (
    chat_id     INTEGER NOT NULL,
    message_id  INTEGER NOT NULL,
    hits        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (chat_id, message_id)
  );
`);

// One-time cleanup: archive the stray single-game "Guo San · 0–5 tai" universe (Guo
// San normally runs 2–6 tai, so this 0–5 pool is a mis-log). Guarded by a marker so a
// deliberate un-archive later isn't silently undone on the next boot.
if (!db.prepare(`SELECT 1 FROM elo_config WHERE key = 'archive_seed_guo_san_0_5'`).get()) {
  const stray = db.prepare(`SELECT 1 FROM games WHERE pool_key = 'guo_san|0-5' LIMIT 1`).get();
  if (stray) {
    db.prepare(`INSERT OR IGNORE INTO archived_pools (pool_key) VALUES ('guo_san|0-5')`).run();
    db.prepare(`INSERT OR IGNORE INTO elo_config (key, value) VALUES ('archive_seed_guo_san_0_5', 1)`).run();
    console.log('[migration] archived stray pool guo_san|0-5');
  }
}

// Migration: chip_scale stays at 4 (higher = less sensitive, smaller swings).
// Revert any bad previous migration.
const csRow = db.prepare('SELECT value FROM elo_config WHERE key = ?').get('chip_scale');
if (csRow && csRow.value !== 4) {
  db.prepare('UPDATE elo_config SET value = 4 WHERE key = ?').run('chip_scale');
}
// Migration: K factors ×5 for more exciting per-game rating swings.
const kpRow = db.prepare('SELECT value FROM elo_config WHERE key = ?').get('k_provisional');
if (kpRow && kpRow.value <= 40) {
  db.prepare('UPDATE elo_config SET value = 200 WHERE key = ?').run('k_provisional');
  db.prepare('UPDATE elo_config SET value = 120 WHERE key = ?').run('k_mid');
  db.prepare('UPDATE elo_config SET value = 80 WHERE key = ?').run('k_stable');
}
// Migration: FLATTEN K to 200 for all tiers. Existing DBs (incl. Railway) still
// held the decaying tiers k_mid=120 / k_stable=80, which the recompute honoured
// over the flat-200 code intent — under-scaling every game a player logs past
// their 10th (×0.6) and 30th (×0.4). Force all three to 200. Idempotent; the
// startup recomputeAllPools() then heals every pool with flat K.
db.prepare(
  `UPDATE elo_config SET value = 200 WHERE key IN ('k_provisional','k_mid','k_stable') AND value <> 200`
).run();

module.exports = db;
