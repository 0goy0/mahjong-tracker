// ─── Hall of Fame ───────────────────────────────────────────────────────────
// Cross-mode all-time records — the single bests across every LIVE (non-archived)
// pool. Computed on the fly from the game log + ratings, so it never drifts. Shared
// by the web API (/api/halloffame) and the bot (/halloffame) so they can't disagree.
// ELO records name the pool they were set in (ratings never merge across modes).

const LIVE = `(g.deleted_at IS NULL OR g.deleted_at = '')`;
const NOT_ARCHIVED = `NOT IN (SELECT pool_key FROM archived_pools)`;

function computeHallOfFame(db, elo) {
  const records = [];
  const get = (sql, ...a) => db.prepare(sql).get(...a);

  const totalGames = get(`SELECT COUNT(*) n FROM games g WHERE ${LIVE} AND g.pool_key ${NOT_ARCHIVED}`)?.n || 0;

  // 👑 Highest rating (per pool)
  const he = get(`
    SELECT p.name, ec.rating, ec.pool_key
    FROM elo_current ec JOIN players p ON p.id = ec.player_id
    WHERE ec.pool_key ${NOT_ARCHIVED}
    ORDER BY ec.rating DESC LIMIT 1
  `);
  if (he) records.push({ key: 'highest_elo', icon: '👑', label: 'Highest Rating', name: he.name, value: `${Math.round(he.rating)}`, sub: elo.poolLabel(he.pool_key) });

  // 📈 Biggest single-game ELO gain / 📉 drop
  const swing = dir => get(`
    SELECT p.name, eh.delta, eh.pool_key
    FROM elo_history eh JOIN players p ON p.id = eh.player_id JOIN games g ON g.id = eh.game_id
    WHERE ${LIVE} AND eh.pool_key ${NOT_ARCHIVED}
    ORDER BY eh.delta ${dir} LIMIT 1
  `);
  const gain = swing('DESC');
  if (gain && gain.delta > 0) records.push({ key: 'biggest_gain', icon: '📈', label: 'Biggest ELO Gain', name: gain.name, value: `+${Math.round(gain.delta)}`, sub: elo.poolLabel(gain.pool_key) });
  const drop = swing('ASC');
  if (drop && drop.delta < 0) records.push({ key: 'biggest_drop', icon: '📉', label: 'Biggest ELO Drop', name: drop.name, value: `${Math.round(drop.delta)}`, sub: elo.poolLabel(drop.pool_key) });

  // 💰 Biggest win / 💀 loss (chips, any mode)
  const chipRec = dir => get(`
    SELECT p.name, gs.chips, g.date
    FROM game_seats gs JOIN players p ON p.id = gs.player_id JOIN games g ON g.id = gs.game_id
    WHERE ${LIVE} AND g.pool_key ${NOT_ARCHIVED}
    ORDER BY gs.chips ${dir} LIMIT 1
  `);
  const win = chipRec('DESC');
  if (win && win.chips > 0) records.push({ key: 'biggest_win', icon: '💰', label: 'Biggest Win', name: win.name, value: `+${win.chips} chips`, sub: win.date });
  const loss = chipRec('ASC');
  if (loss && loss.chips < 0) records.push({ key: 'biggest_loss', icon: '💀', label: 'Biggest Loss', name: loss.name, value: `${loss.chips} chips`, sub: loss.date });

  // 🔥 Longest win streak (scan each player's chronological games)
  const seq = db.prepare(`
    SELECT gs.player_id, p.name, gs.chips
    FROM game_seats gs JOIN players p ON p.id = gs.player_id JOIN games g ON g.id = gs.game_id
    WHERE ${LIVE} AND g.pool_key ${NOT_ARCHIVED}
    ORDER BY gs.player_id, g.date ASC, g.created_at ASC, g.id ASC
  `).all();
  let best = { name: null, run: 0 }, curId = null, cur = 0;
  for (const r of seq) {
    if (r.player_id !== curId) { curId = r.player_id; cur = 0; }
    cur = r.chips > 0 ? cur + 1 : 0;
    if (cur > best.run) best = { name: r.name, run: cur };
  }
  if (best.run >= 2) records.push({ key: 'longest_streak', icon: '🔥', label: 'Longest Win Streak', name: best.name, value: `${best.run} wins` });

  // 🎮 Most games
  const most = get(`
    SELECT p.name, COUNT(*) n
    FROM game_seats gs JOIN players p ON p.id = gs.player_id JOIN games g ON g.id = gs.game_id
    WHERE ${LIVE} AND g.pool_key ${NOT_ARCHIVED}
    GROUP BY gs.player_id ORDER BY n DESC LIMIT 1
  `);
  if (most) records.push({ key: 'most_games', icon: '🎮', label: 'Most Games', name: most.name, value: `${most.n} games` });

  // 🌬️ Best chips/wind (min 20 winds so tiny samples don't fluke the top)
  const cpw = get(`
    SELECT p.name, SUM(gs.chips) * 1.0 / SUM(g.rounds) cpw, SUM(g.rounds) winds
    FROM game_seats gs JOIN players p ON p.id = gs.player_id JOIN games g ON g.id = gs.game_id
    WHERE ${LIVE} AND g.pool_key ${NOT_ARCHIVED}
    GROUP BY gs.player_id HAVING SUM(g.rounds) >= 20 ORDER BY cpw DESC LIMIT 1
  `);
  if (cpw) records.push({ key: 'best_cpw', icon: '🌬️', label: 'Best Chips/Wind', name: cpw.name, value: `${cpw.cpw > 0 ? '+' : ''}${cpw.cpw.toFixed(1)}/wind` });

  return { totalGames, records };
}

module.exports = { computeHallOfFame };
