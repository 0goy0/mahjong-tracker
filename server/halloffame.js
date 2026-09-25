// ─── Hall of Fame ───────────────────────────────────────────────────────────
// Cross-mode all-time records — the single bests across every LIVE (non-archived)
// pool. Computed on the fly from the game log + ratings, so it never drifts. Shared
// by the web API (/api/halloffame) and the bot (/halloffame) so they can't disagree.
// ELO records name the pool they were set in (ratings never merge across modes).

const LIVE = `(g.deleted_at IS NULL OR g.deleted_at = '')`;
const NOT_ARCHIVED = `NOT IN (SELECT pool_key FROM archived_pools)`;
const CROWN_MIN_GAMES = 5; // a pool only confers a KING once it has this many games (matches bot.js)

const daysBetween = (a, b) =>
  Math.max(0, Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000));
const todayISO = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};

// Reconstruct the KING (pool leader) timeline from the rating history and measure
// the longest continuous reign, in days. There's no stored crown log, so we replay
// each pool: after every game (once the pool has ≥ CROWN_MIN_GAMES) the top-rated
// player is the king; a reign runs from the date they took the crown to the date
// it passed to someone else (or today, if they still hold it).
function longestReign(db) {
  const pools = db.prepare(`SELECT DISTINCT pool_key FROM elo_current WHERE pool_key ${NOT_ARCHIVED}`).all().map(r => r.pool_key);
  let best = null; // { playerId, poolKey, days, ongoing, start, end }
  for (const pk of pools) {
    const rows = db.prepare(`
      SELECT eh.game_id, eh.player_id, eh.rating_after, g.date
      FROM elo_history eh JOIN games g ON g.id = eh.game_id
      WHERE eh.pool_key = ? AND ${LIVE}
      ORDER BY g.date ASC, g.created_at ASC, g.id ASC, eh.seq ASC
    `).all(pk);
    if (!rows.length) continue;

    const ratings = {};
    let gameCount = 0, curGame = null, curDate = null;
    let reignLeader = null, reignStart = null;
    const consider = (leader, start, end, ongoing) => {
      if (leader == null || !start) return;
      const days = daysBetween(start, end);
      if (!best || days > best.days) best = { playerId: leader, poolKey: pk, days, ongoing, start, end };
    };
    const flushGame = () => {
      if (curGame == null) return;
      gameCount++;
      if (gameCount < CROWN_MIN_GAMES) return; // no crown yet
      let leader = null, max = -Infinity;
      for (const pid in ratings) { if (ratings[pid] > max) { max = ratings[pid]; leader = Number(pid); } }
      if (leader !== reignLeader) {
        consider(reignLeader, reignStart, curDate, false); // previous king dethroned at curDate
        reignLeader = leader;
        reignStart = curDate;
      }
    };
    for (const row of rows) {
      if (row.game_id !== curGame) { flushGame(); curGame = row.game_id; curDate = row.date; }
      ratings[row.player_id] = row.rating_after;
    }
    flushGame(); // final game
    consider(reignLeader, reignStart, todayISO(), true); // ongoing reign runs to today
  }
  return best;
}

// Longest EMPEROR reign: an emperor leads EVERY qualifying pool (≥ CROWN_MIN_GAMES
// games, not archived) at once, and there must be ≥2 such pools. Replay all pools
// on one merged timeline; after each game, the emperor is the player who is the
// sole leader of every qualifying pool (else there's no emperor). Measured in days.
function longestEmperorReign(db) {
  const pools = new Set(db.prepare(`SELECT DISTINCT pool_key FROM elo_current WHERE pool_key ${NOT_ARCHIVED}`).all().map(r => r.pool_key));
  if (pools.size < 2) return null;
  const rows = db.prepare(`
    SELECT eh.game_id, eh.pool_key, eh.player_id, eh.rating_after, g.date
    FROM elo_history eh JOIN games g ON g.id = eh.game_id
    WHERE eh.pool_key ${NOT_ARCHIVED} AND ${LIVE}
    ORDER BY g.date ASC, g.created_at ASC, g.id ASC, eh.seq ASC
  `).all();
  if (!rows.length) return null;

  const ratings = {}; // poolKey -> { playerId: rating }
  const count = {};    // poolKey -> games played so far
  let curGame = null, curDate = null, emperor = null, start = null, best = null;
  const consider = (e, s, end, ongoing) => {
    if (e == null || !s) return;
    const days = daysBetween(s, end);
    if (!best || days > best.days) best = { playerId: e, days, ongoing, start: s };
  };
  const leaderOf = pk => {
    const r = ratings[pk] || {}; let ld = null, mx = -Infinity;
    for (const pid in r) { if (r[pid] > mx) { mx = r[pid]; ld = Number(pid); } }
    return ld;
  };
  const evalEmperor = () => {
    const qual = [...pools].filter(pk => (count[pk] || 0) >= CROWN_MIN_GAMES);
    let emp = null;
    if (qual.length >= 2) {
      let common = null, ok = true;
      for (const pk of qual) {
        const ld = leaderOf(pk);
        if (ld == null) { ok = false; break; }
        if (common == null) common = ld; else if (common !== ld) { ok = false; break; }
      }
      if (ok) emp = common;
    }
    if (emp !== emperor) { consider(emperor, start, curDate, false); emperor = emp; start = emp != null ? curDate : null; }
  };
  for (const row of rows) {
    if (row.game_id !== curGame) {
      if (curGame != null) evalEmperor();
      curGame = row.game_id; curDate = row.date;
      count[row.pool_key] = (count[row.pool_key] || 0) + 1;
    }
    (ratings[row.pool_key] || (ratings[row.pool_key] = {}))[row.player_id] = row.rating_after;
  }
  evalEmperor();
  consider(emperor, start, todayISO(), true);
  return best;
}

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

  // ⏳ Longest KING reign — who held a pool's crown the longest, in days.
  const reign = longestReign(db);
  if (reign && reign.days >= 1) {
    const name = get('SELECT name FROM players WHERE id = ?', reign.playerId)?.name;
    if (name) {
      records.push({
        key: 'longest_reign', icon: '⏳', label: 'Longest Reign',
        name, value: `${reign.days} day${reign.days === 1 ? '' : 's'}`,
        sub: `KING of ${elo.poolLabel(reign.poolKey)}${reign.ongoing ? ' · still reigning 👑' : ''}`,
      });
    }
  }

  // 🏛️ Longest EMPEROR reign — held #1 in EVERY pool at once, the longest.
  const emp = longestEmperorReign(db);
  if (emp && emp.days >= 1) {
    const name = get('SELECT name FROM players WHERE id = ?', emp.playerId)?.name;
    if (name) {
      records.push({
        key: 'longest_emperor', icon: '🏛️', label: 'Longest Emperor Reign',
        name, value: `${emp.days} day${emp.days === 1 ? '' : 's'}`,
        sub: `EMPEROR of all pools${emp.ongoing ? ' · still reigning 👑' : ''}`,
      });
    }
  }

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

  // 🎯 Best win rate (a win = a game finished with positive chips; min 10 games so a
  // hot 3-game streak doesn't top the board)
  const wr = get(`
    SELECT p.name, SUM(CASE WHEN gs.chips > 0 THEN 1 ELSE 0 END) wins, COUNT(*) games
    FROM game_seats gs JOIN players p ON p.id = gs.player_id JOIN games g ON g.id = gs.game_id
    WHERE ${LIVE} AND g.pool_key ${NOT_ARCHIVED}
    GROUP BY gs.player_id HAVING COUNT(*) >= 10
    ORDER BY (SUM(CASE WHEN gs.chips > 0 THEN 1 ELSE 0 END) * 1.0 / COUNT(*)) DESC LIMIT 1
  `);
  if (wr) records.push({ key: 'best_win_rate', icon: '🎯', label: 'Best Win Rate', name: wr.name, value: `${Math.round((wr.wins / wr.games) * 100)}%`, sub: `${wr.games} games` });

  // 🎮 Most games — measured in POTS (1 pot = 4 winds), matching /profile's volume metric
  const most = get(`
    SELECT p.name, SUM(g.rounds) winds
    FROM game_seats gs JOIN players p ON p.id = gs.player_id JOIN games g ON g.id = gs.game_id
    WHERE ${LIVE} AND g.pool_key ${NOT_ARCHIVED}
    GROUP BY gs.player_id ORDER BY winds DESC LIMIT 1
  `);
  if (most) {
    const pots = (most.winds || 0) / 4;
    const potsStr = Number.isInteger(pots) ? String(pots) : pots.toFixed(1);
    records.push({ key: 'most_games', icon: '🎮', label: 'Most Games', name: most.name, value: `${potsStr} pots` });
  }

  // 📅 Most pots played by the whole league in a single day (1 pot = 4 winds,
  // summed across every game that day — a group activity record, with the date).
  const busiest = get(`
    SELECT g.date, SUM(g.rounds) winds, COUNT(*) games
    FROM games g
    WHERE ${LIVE} AND g.pool_key ${NOT_ARCHIVED}
    GROUP BY g.date ORDER BY winds DESC, g.date DESC LIMIT 1
  `);
  if (busiest && busiest.winds) {
    const pots = busiest.winds / 4;
    const potsStr = Number.isInteger(pots) ? String(pots) : pots.toFixed(1);
    records.push({ key: 'busiest_day', icon: '📅', label: 'Most Pots in a Day', name: busiest.date, value: `${potsStr} pots`, sub: `${busiest.games} game${busiest.games === 1 ? '' : 's'}` });
  }

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

// ─── Season of Fame ───────────────────────────────────────────────────────────
// The Hall of Fame's monthly sibling — records scoped to one season. Ratings come
// from the season_elo_* tables; chip/streak/pot records from that season's games.
const season = require('./season');

function computeSeasonFame(db, elo, seasonId) {
  const cut = season.cutover(db);
  const { clause, params } = season.seasonWhere(seasonId, cut);
  const records = [];
  const get = (sql, p) => db.prepare(sql).get(p);
  const all = (sql, p) => db.prepare(sql).all(p);

  const totalGames = get(`SELECT COUNT(*) n FROM games g WHERE (g.deleted_at IS NULL OR g.deleted_at='') AND g.pool_key ${NOT_ARCHIVED} AND ${clause}`, params)?.n || 0;

  // 👑 Season Champion — highest season rating (5-game floor), + Season Kings/pool.
  const { champion } = season.seasonKingsAndChampion(db, seasonId, 5);
  if (champion) records.push({ key: 'season_champion', icon: '🏆', label: 'Season Champion', name: champion.name, value: `${Math.round(champion.rating)}`, sub: elo.poolLabel(champion.pool_key) });

  // 📈/📉 biggest season ELO gain / drop (archived pools excluded, like all-time)
  const swing = dir => get(`
    SELECT p.name, eh.delta, eh.pool_key FROM season_elo_history eh
    JOIN players p ON p.id = eh.player_id
    WHERE eh.season = @s AND eh.pool_key ${NOT_ARCHIVED} ORDER BY eh.delta ${dir} LIMIT 1`, { s: seasonId });
  const gain = swing('DESC');
  if (gain && gain.delta > 0) records.push({ key: 'biggest_gain', icon: '📈', label: 'Biggest ELO Gain', name: gain.name, value: `+${Math.round(gain.delta)}`, sub: elo.poolLabel(gain.pool_key) });
  const drop = swing('ASC');
  if (drop && drop.delta < 0) records.push({ key: 'biggest_drop', icon: '📉', label: 'Biggest ELO Drop', name: drop.name, value: `${Math.round(drop.delta)}`, sub: elo.poolLabel(drop.pool_key) });

  // 💰/💀 biggest win / loss (chips) this season
  const chip = dir => get(`
    SELECT p.name, gs.chips, g.date FROM game_seats gs
    JOIN players p ON p.id = gs.player_id JOIN games g ON g.id = gs.game_id
    WHERE (g.deleted_at IS NULL OR g.deleted_at='') AND g.pool_key ${NOT_ARCHIVED} AND ${clause}
    ORDER BY gs.chips ${dir} LIMIT 1`, params);
  const win = chip('DESC');
  if (win && win.chips > 0) records.push({ key: 'biggest_win', icon: '💰', label: 'Biggest Win', name: win.name, value: `+${win.chips} chips`, sub: win.date });
  const loss = chip('ASC');
  if (loss && loss.chips < 0) records.push({ key: 'biggest_loss', icon: '💀', label: 'Biggest Loss', name: loss.name, value: `${loss.chips} chips`, sub: loss.date });

  // 🔥 longest win streak within the season
  const seq = all(`
    SELECT gs.player_id, p.name, gs.chips FROM game_seats gs
    JOIN players p ON p.id = gs.player_id JOIN games g ON g.id = gs.game_id
    WHERE (g.deleted_at IS NULL OR g.deleted_at='') AND g.pool_key ${NOT_ARCHIVED} AND ${clause}
    ORDER BY gs.player_id, g.date ASC, g.created_at ASC, g.id ASC`, params);
  let best = { name: null, run: 0 }, curId = null, cur = 0;
  for (const r of seq) {
    if (r.player_id !== curId) { curId = r.player_id; cur = 0; }
    cur = r.chips > 0 ? cur + 1 : 0;
    if (cur > best.run) best = { name: r.name, run: cur };
  }
  if (best.run >= 2) records.push({ key: 'longest_streak', icon: '🔥', label: 'Longest Win Streak', name: best.name, value: `${best.run} wins` });

  // 🎮 most pots this season (1 pot = 4 winds)
  const most = get(`
    SELECT p.name, SUM(g.rounds) winds FROM game_seats gs
    JOIN players p ON p.id = gs.player_id JOIN games g ON g.id = gs.game_id
    WHERE (g.deleted_at IS NULL OR g.deleted_at='') AND g.pool_key ${NOT_ARCHIVED} AND ${clause}
    GROUP BY gs.player_id ORDER BY winds DESC LIMIT 1`, params);
  if (most) {
    const pots = (most.winds || 0) / 4;
    records.push({ key: 'most_games', icon: '🎮', label: 'Most Pots', name: most.name, value: `${Number.isInteger(pots) ? pots : pots.toFixed(1)} pots` });
  }

  // 📅 busiest day this season
  const busiest = get(`
    SELECT g.date, SUM(g.rounds) winds, COUNT(*) games FROM games g
    WHERE (g.deleted_at IS NULL OR g.deleted_at='') AND g.pool_key ${NOT_ARCHIVED} AND ${clause}
    GROUP BY g.date ORDER BY winds DESC, g.date DESC LIMIT 1`, params);
  if (busiest && busiest.winds) {
    const pots = busiest.winds / 4;
    records.push({ key: 'busiest_day', icon: '📅', label: 'Most Pots in a Day', name: busiest.date, value: `${Number.isInteger(pots) ? pots : pots.toFixed(1)} pots`, sub: `${busiest.games} game${busiest.games === 1 ? '' : 's'}` });
  }

  return { totalGames, records };
}

module.exports = { computeHallOfFame, computeSeasonFame };
