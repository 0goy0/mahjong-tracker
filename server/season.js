// ─── Season model ─────────────────────────────────────────────────────────────
// A season is a month-long ELO ladder that runs ALONGSIDE the untouched all-time
// ratings. Membership is derived from a game's date + a cutover:
//   • season2_start UNSET  → every game is Season 1 (the genesis era).
//   • season2_start SET (a date) → games before it stay Season 1 (frozen); games
//     on/after it are grouped by calendar month as Season 2, 3, 4, …
// The cutover is stored in elo_config as a YYYYMMDD integer (that table is REAL-only).

const SEASON1 = 'S1';

// 8-tier season rank ladder — PLACEHOLDER names, Rank 1 = top. Rename any time by
// editing this array; `min` is the season-rating floor for the tier. Season ELO
// starts at 1000 and is compressed by the rubber-band, so tiers cluster near 1000.
const SEASON_RANKS = [
  { min: 1240, t: 'Rank 1' },
  { min: 1160, t: 'Rank 2' },
  { min: 1090, t: 'Rank 3' },
  { min: 1030, t: 'Rank 4' },
  { min: 970,  t: 'Rank 5' },
  { min: 910,  t: 'Rank 6' },
  { min: 840,  t: 'Rank 7' },
  { min: -Infinity, t: 'Rank 8' },
];
function seasonRank(rating) {
  const r = Math.round(rating ?? 1000);
  return (SEASON_RANKS.find(x => r >= x.min) || SEASON_RANKS[SEASON_RANKS.length - 1]).t;
}

const ymOf = d => String(d).slice(0, 7);
function monthDiff(a, b) { // whole months from 'YYYY-MM' a to b
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}
function todayISO() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

// Read the cutover date ('YYYY-MM-DD') or null, from the YYYYMMDD integer config.
function cutover(db) {
  const v = db.prepare(`SELECT value FROM elo_config WHERE key = 'season2_start'`).get()?.value;
  if (v == null) return null;
  const s = String(Math.round(v)).padStart(8, '0');
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}
// Set / clear the cutover. `dateStr` = 'YYYY-MM-DD' to launch Season 2, or null to revert.
function setCutover(db, dateStr) {
  if (!dateStr) { db.prepare(`DELETE FROM elo_config WHERE key = 'season2_start'`).run(); return; }
  const n = Number(dateStr.replace(/-/g, ''));
  db.prepare(`INSERT INTO elo_config (key, value) VALUES ('season2_start', ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(n);
}

// Which season a date belongs to, given the cutover string (or null).
function seasonOf(dateStr, cut) {
  if (!cut || dateStr < cut) return { id: SEASON1, num: 1 };
  const id = ymOf(dateStr);
  return { id, num: 2 + monthDiff(ymOf(cut), id) };
}
function seasonNum(id, cut) {
  if (id === SEASON1) return 1;
  return cut ? 2 + monthDiff(ymOf(cut), id) : 1;
}
const seasonLabel = (id, cut) => `Season ${seasonNum(id, cut)}`;

function currentSeason(db) {
  const cut = cutover(db);
  const { id, num } = seasonOf(todayISO(), cut);
  return { id, num, label: `Season ${num}`, cut };
}

// SQL fragment + params to select a season's games (join alias `g`).
function seasonWhere(id, cut) {
  if (id === SEASON1) {
    return cut ? { clause: 'g.date < @seasonCut', params: { seasonCut: cut } }
               : { clause: '1=1', params: {} };
  }
  return { clause: 'substr(g.date,1,7) = @seasonMonth AND g.date >= @seasonCut',
           params: { seasonMonth: id, seasonCut: cut } };
}

// Every season that currently has at least one live game, ordered S1 → newest.
function listSeasons(db) {
  const cut = cutover(db);
  const dates = db.prepare(`SELECT DISTINCT date FROM games WHERE (deleted_at IS NULL OR deleted_at = '')`).all().map(r => r.date);
  const ids = new Set(dates.map(d => seasonOf(d, cut).id));
  const arr = [...ids].sort((a, b) => a === SEASON1 ? -1 : b === SEASON1 ? 1 : (a < b ? -1 : 1));
  const curId = currentSeason(db).id;
  return arr.map(id => ({ id, num: seasonNum(id, cut), label: `Season ${seasonNum(id, cut)}`, current: id === curId }));
}

// ── Season query helpers (shared by the web API and the bot) ──────────────────

// Non-archived pools that have any standings this season.
function seasonPools(db, seasonId) {
  const arch = new Set(db.prepare('SELECT pool_key FROM archived_pools').all().map(r => r.pool_key));
  return db.prepare('SELECT DISTINCT pool_key FROM season_elo_current WHERE season = ?')
    .all(seasonId).map(r => r.pool_key).filter(pk => !arch.has(pk));
}

// Ordered standings for one pool this season.
function seasonStandings(db, seasonId, poolKey) {
  return db.prepare(`
    SELECT sc.player_id, p.name, sc.rating, sc.games_played
    FROM season_elo_current sc JOIN players p ON p.id = sc.player_id
    WHERE sc.season = ? AND sc.pool_key = ? ORDER BY sc.rating DESC
  `).all(seasonId, poolKey);
}

// A player's season snapshot: per-pool rating/rank + overall chip aggregates.
function seasonPlayerStats(db, seasonId, playerId) {
  const cut = cutover(db);
  const { clause, params } = seasonWhere(seasonId, cut);
  const rankStmt = db.prepare('SELECT COUNT(*) + 1 r FROM season_elo_current WHERE season = ? AND pool_key = ? AND rating > ?');
  const pools = db.prepare(`
    SELECT pool_key, rating, games_played FROM season_elo_current
    WHERE season = ? AND player_id = ? ORDER BY rating DESC
  `).all(seasonId, playerId).map(p => ({
    ...p, rank: rankStmt.get(seasonId, p.pool_key, p.rating).r, rankTitle: seasonRank(p.rating),
  }));
  const agg = db.prepare(`
    SELECT COUNT(*) games, COALESCE(SUM(gs.chips), 0) net,
      SUM(CASE WHEN gs.chips > 0 THEN 1 ELSE 0 END) wins,
      COALESCE(SUM(g.rounds), 0) winds
    FROM game_seats gs JOIN games g ON g.id = gs.game_id
    WHERE gs.player_id = @pid AND (g.deleted_at IS NULL OR g.deleted_at = '') AND ${clause}
  `).get({ pid: playerId, ...params });
  return { pools, overall: agg };
}

// Per-pool Season Kings (top rating, ≥minGames) + the overall Champion (best of them).
function seasonKingsAndChampion(db, seasonId, minGames = 5) {
  const kings = [];
  for (const pk of seasonPools(db, seasonId)) {
    const top = db.prepare(`
      SELECT sc.player_id, p.name, sc.rating, sc.games_played
      FROM season_elo_current sc JOIN players p ON p.id = sc.player_id
      WHERE sc.season = ? AND sc.pool_key = ? AND sc.games_played >= ?
      ORDER BY sc.rating DESC LIMIT 1
    `).get(seasonId, pk, minGames);
    if (top) kings.push({ pool_key: pk, ...top });
  }
  const champion = kings.slice().sort((a, b) => b.rating - a.rating)[0] || null;
  return { kings, champion };
}

module.exports = {
  SEASON1, SEASON_RANKS, seasonRank,
  cutover, setCutover, seasonOf, seasonNum, seasonLabel, currentSeason,
  seasonWhere, listSeasons, todayISO, ymOf,
  seasonPools, seasonStandings, seasonPlayerStats, seasonKingsAndChampion,
};
