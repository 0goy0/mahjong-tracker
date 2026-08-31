const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

// TRACKER_DB lets tests / throwaway instances point at a scratch database.
const dbPath = process.env.TRACKER_DB || path.join(dataDir, 'tracker.db');
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
  k_provisional: 200,
  k_mid: 120,
  k_stable: 80,
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

if (!hasColumn('games', 'rounds')) {
  db.exec(`ALTER TABLE games ADD COLUMN rounds INTEGER NOT NULL DEFAULT 4`);
}
if (!hasColumn('games', 'pool_key')) {
  db.exec(`ALTER TABLE games ADD COLUMN pool_key TEXT`);
}
if (!hasColumn('games', 'base_chips')) {
  db.exec(`ALTER TABLE games ADD COLUMN base_chips INTEGER`);
}
db.exec(`CREATE INDEX IF NOT EXISTS idx_games_pool ON games(pool_key)`);

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

module.exports = db;
