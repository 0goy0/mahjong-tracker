// ─── Achievements ─────────────────────────────────────────────────────────────
// Single source of truth for achievement definitions AND their live evaluation.
// Everything is computed on-the-fly from the game log + current ratings — there
// is no achievements table to drift out of sync (this is what makes counts like
// "won 500+ ten times → ×10" possible, and why editing/deleting a game can never
// leave a stale or missing badge). Shared by the web API and the Telegram bot.

const ACHIEVEMENTS = [
  { key: 'first_win',   glyph: '开胡', icon: '🥇', title: 'First Blood',   desc: 'Win your first game',                 repeatable: false },
  { key: 'streak_3',    glyph: '三连', icon: '🔥', title: 'On Fire',       desc: 'Win 3 games in a row',                repeatable: false },
  { key: 'streak_5',    glyph: '五连', icon: '🌋', title: 'Unstoppable',   desc: 'Win 5 games in a row',                repeatable: false },
  { key: 'streak_10',   glyph: '十连', icon: '☄️', title: 'Rampage',       desc: 'Win 10 games in a row',               repeatable: false },
  { key: 'games_20',    glyph: '廿场', icon: '⚡', title: 'Regular',       desc: 'Play 20 games',                       repeatable: false },
  { key: 'games_50',    glyph: '半百', icon: '🎖️', title: 'Veteran',       desc: 'Play 50 games',                       repeatable: false },
  { key: 'games_100',   glyph: '百场', icon: '🏯', title: 'Century',       desc: 'Play 100 games',                      repeatable: false },
  { key: 'marathon',    glyph: '车轮战', icon: '🔁', title: 'Marathon',     desc: 'Play 16 winds within 24 hours',       repeatable: false },
  { key: 'all_nighter', glyph: '铁人', icon: '🦾', title: 'Ironman',       desc: 'Play 20 winds within 24 hours',       repeatable: false },
  { key: 'no_lifer',    glyph: '肝帝', icon: '🧟', title: 'No Lifer',      desc: 'Play 24 winds within 24 hours',       repeatable: false },
  { key: 'big_win',     glyph: '大胜', icon: '💰', title: 'Big Winner',    desc: 'Win 500+ chips in a single game',     repeatable: true  },
  { key: 'cracked',     glyph: '崩盘', icon: '💀', title: 'Cracked',       desc: 'Lose 500+ chips in a single game',    repeatable: true  },
  { key: 'bent_over',   glyph: '折腰', icon: '🍑', title: 'Bent Over',     desc: 'Lose 300+ chips in a single Vanilla · 1–6 tai game', repeatable: true  },
  { key: 'sole_winner', glyph: '独赢', icon: '🃏', title: 'Sole Winner',   desc: 'Win while everyone else loses chips', repeatable: true  },
  { key: 'sole_loser',  glyph: '独输', icon: '🏧', title: 'Sole Loser',    desc: 'Lose while everyone else wins chips', repeatable: true  },
  { key: 'giant_slayer',glyph: '屠龙', icon: '🐉', title: 'Giant Slayer',  desc: 'Win chips as the lowest-rated player at the table', repeatable: true  },
  { key: 'king_slayer', glyph: '弑君', icon: '⚔️', title: 'King Slayer',   desc: 'Win chips AND finish above the reigning KING (the pool\'s #1) at your table', repeatable: true  },
  { key: 'even_steven', glyph: '平手', icon: '⚖️', title: 'Even Steven',   desc: 'Finish a game at exactly 0 net chips', repeatable: true  },
  { key: 'loss_3',      glyph: '三败', icon: '🥶', title: 'Cold Streak',     desc: 'Lose 3 games in a row',             repeatable: false },
  { key: 'loss_5',      glyph: '散财', icon: '💸', title: 'Community Wallet', desc: 'Lose 5 games in a row',              repeatable: false },
  { key: 'loss_10',     glyph: '十败', icon: '🪦', title: 'Rock Bottom',      desc: 'Lose 10 games in a row',            repeatable: false },
  { key: 'rank_1200',   glyph: '新星', icon: '📈', title: 'Rising Star',   desc: 'Reach 1200+ rating',                  repeatable: false },
  { key: 'rank_1600',   glyph: '精英', icon: '🌟', title: 'Elite',         desc: 'Reach 1600+ rating',                  repeatable: false },
  { key: 'rank_2000',   glyph: '传奇', icon: '🏅', title: 'Legend',        desc: 'Reach 2000+ rating',                  repeatable: false },
  { key: 'bull_market', glyph: '牛市', icon: '🐂', title: 'Bull Market',   desc: 'Gain 100+ rating within a week',      repeatable: false },
  { key: 'bear_market', glyph: '熊市', icon: '🐻', title: 'Bear Market',   desc: 'Lose 100+ rating within a week',      repeatable: false },
  { key: 'top_dog',     glyph: '榜首', icon: '🏆', title: 'Top Dog',       desc: 'Reach #1 in any pool',                repeatable: false },
  { key: 'apex',        glyph: '独霸', icon: '👑', title: 'Apex',          desc: 'Reach #1 in every pool',              repeatable: false },
  { key: 'comeback',    glyph: '逆转', icon: '🦾', title: 'Comeback Kid',  desc: 'Win after 3 straight losses',         repeatable: false },
];

// Returns the full achievement list for a player, each augmented with:
//   count  — how many times earned (repeatables can exceed 1; one-timers are 0/1)
//   earned — count > 0
//   first  — YYYY-MM-DD the achievement was first earned (null where not datable)
function computeAchievements(db, playerId) {
  playerId = Number(playerId);

  const games = db.prepare(`
    SELECT gs.game_id, gs.chips, g.date, g.rounds AS winds, g.created_at AS ts, g.pool_key
    FROM game_seats gs JOIN games g ON g.id = gs.game_id
    WHERE gs.player_id = ? AND (g.deleted_at IS NULL OR g.deleted_at = '')
    ORDER BY g.date ASC, g.created_at ASC, g.id ASC
  `).all(playerId);

  const res = {};
  const set = (key, count, first) => { res[key] = { count, first: first || null }; };
  const total = games.length;

  // First win
  const firstWin = games.find(g => g.chips > 0);
  set('first_win', firstWin ? 1 : 0, firstWin?.date);

  // Win streaks (consecutive games with positive chips)
  let cur = 0, best = 0;
  const streakFirst = { 3: null, 5: null, 10: null };
  for (const g of games) {
    if (g.chips > 0) {
      cur++;
      best = Math.max(best, cur);
      for (const n of [3, 5, 10]) if (cur === n && !streakFirst[n]) streakFirst[n] = g.date;
    } else cur = 0;
  }
  set('streak_3',  best >= 3  ? 1 : 0, streakFirst[3]);
  set('streak_5',  best >= 5  ? 1 : 0, streakFirst[5]);
  set('streak_10', best >= 10 ? 1 : 0, streakFirst[10]);

  // Games played milestones — first earned = date of the Nth game
  const dateAt = n => (total >= n ? games[n - 1].date : null);
  set('games_20',  total >= 20  ? 1 : 0, dateAt(20));
  set('games_50',  total >= 50  ? 1 : 0, dateAt(50));
  set('games_100', total >= 100 ? 1 : 0, dateAt(100));

  // Repeatable chip achievements
  const bigWins = games.filter(g => g.chips >= 500);
  set('big_win', bigWins.length, bigWins[0]?.date);
  const cracks = games.filter(g => g.chips <= -500);
  set('cracked', cracks.length, cracks[0]?.date);
  // Bent Over — a heavy bleed (300+) in the Vanilla · 1–6 tai pool specifically.
  const bent = games.filter(g => g.pool_key === 'vanilla|1-6' && g.chips <= -300);
  set('bent_over', bent.length, bent[0]?.date);

  // Sole winner — this player positive, every other seat negative
  let soleCount = 0, soleFirst = null;
  const othersStmt = db.prepare('SELECT chips FROM game_seats WHERE game_id = ? AND player_id != ?');
  for (const g of games) {
    if (g.chips <= 0) continue;
    const others = othersStmt.all(g.game_id, playerId);
    if (others.length && others.every(o => o.chips < 0)) {
      soleCount++;
      if (!soleFirst) soleFirst = g.date;
    }
  }
  set('sole_winner', soleCount, soleFirst);

  // Sole loser — this player negative, every other seat positive (mirror of sole winner)
  let soleLossCount = 0, soleLossFirst = null;
  for (const g of games) {
    if (g.chips >= 0) continue;
    const others = othersStmt.all(g.game_id, playerId);
    if (others.length && others.every(o => o.chips > 0)) {
      soleLossCount++;
      if (!soleLossFirst) soleLossFirst = g.date;
    }
  }
  set('sole_loser', soleLossCount, soleLossFirst);

  // Giant Slayer — win chips while being the lowest-rated player at the table,
  // by pre-game rating (elo_history.rating_before, same pool since game_id is unique to one pool).
  let giantCount = 0, giantFirst = null;
  const ratingsAtGame = db.prepare('SELECT player_id, rating_before FROM elo_history WHERE game_id = ?');
  for (const g of games) {
    if (g.chips <= 0) continue;
    const rows = ratingsAtGame.all(g.game_id);
    const mine = rows.find(r => r.player_id === playerId);
    if (!mine || rows.length < 2) continue;
    const lowest = rows.every(r => r.player_id === playerId || r.rating_before > mine.rating_before);
    if (lowest) { giantCount++; if (!giantFirst) giantFirst = g.date; }
  }
  set('giant_slayer', giantCount, giantFirst);

  // King Slayer — beat the reigning KING: the player who actually held the crown
  // (the pool's overall #1) going into this game. Not merely the strongest at the
  // table — the top seat must ALSO be the pool leader at that moment, and the pool
  // must have enough games to confer a crown (matches CROWN_MIN_GAMES in bot.js).
  const CROWN_MIN_GAMES = 5;
  // Highest current rating in the pool just before a game (each player's latest
  // rating_after prior to `ts`) = the reigning king's rating.
  const poolLeaderBeforeStmt = db.prepare(`
    SELECT MAX(rating_after) AS lead FROM (
      SELECT eh.rating_after,
             ROW_NUMBER() OVER (PARTITION BY eh.player_id
                                ORDER BY g2.created_at DESC, eh.seq DESC) AS rn
      FROM elo_history eh JOIN games g2 ON g2.id = eh.game_id
      WHERE eh.pool_key = ? AND g2.created_at < ?
        AND (g2.deleted_at IS NULL OR g2.deleted_at = '')
    ) WHERE rn = 1
  `);
  const poolGamesBeforeStmt = db.prepare(`
    SELECT COUNT(*) AS n FROM games
    WHERE pool_key = ? AND created_at < ? AND (deleted_at IS NULL OR deleted_at = '')
  `);
  let kingCount = 0, kingFirst = null;
  const chipsOfStmt = db.prepare('SELECT chips FROM game_seats WHERE game_id = ? AND player_id = ?');
  for (const g of games) {
    const rows = ratingsAtGame.all(g.game_id);
    if (rows.length < 2) continue;
    let king = null, tie = false;
    for (const r of rows) {
      if (!king || r.rating_before > king.rating_before) { king = r; tie = false; }
      else if (r.rating_before === king.rating_before) tie = true;
    }
    if (!king || tie || king.player_id === playerId) continue; // need a clear king that isn't me
    // The top seat must be the pool's reigning crown-holder, not just the best here.
    if (poolGamesBeforeStmt.get(g.pool_key, g.ts).n < CROWN_MIN_GAMES) continue;
    const poolLead = poolLeaderBeforeStmt.get(g.pool_key, g.ts).lead;
    if (poolLead == null || king.rating_before < poolLead - 1e-9) continue; // not the actual king
    const kingChips = chipsOfStmt.get(g.game_id, king.player_id)?.chips;
    if (kingChips == null) continue;
    // Must actually WIN chips AND out-earn the king — beating a bleeding king
    // while you also lost chips isn't a slaying, you both lost.
    if (g.chips > 0 && g.chips > kingChips) {
      kingCount++;
      if (!kingFirst) kingFirst = g.date;
    }
  }
  set('king_slayer', kingCount, kingFirst);

  // Even Steven — finish a game at exactly 0 net chips
  const evens = games.filter(g => g.chips === 0);
  set('even_steven', evens.length, evens[0]?.date);

  // Marathon (16) / Ironman (20) — most winds inside any rolling 24h window, keyed
  // off each game's log time. So a session that straddles midnight still counts: a
  // game logged Mon 4pm opens a window that runs to Tue 4pm. Beats the old
  // calendar-day bucket, which would split a late-night grind across two dates.
  const WINDOW = 24 * 3600 * 1000;
  const toMs = ts => {
    const m = ts ? Date.parse(String(ts).replace(' ', 'T') + 'Z') : NaN; // stored as 'YYYY-MM-DD HH:MM:SS'
    return Number.isNaN(m) ? null : m;
  };
  const timed = games
    .map(g => ({ ms: toMs(g.ts), winds: Math.max(1, g.winds || 1), date: g.date }))
    .filter(g => g.ms != null)
    .sort((a, b) => a.ms - b.ms);
  let bestWinds = 0, lo = 0, sum = 0;
  const firstAt = { 16: null, 20: null, 24: null };
  for (let hi = 0; hi < timed.length; hi++) {
    sum += timed[hi].winds;
    while (timed[hi].ms - timed[lo].ms > WINDOW) { sum -= timed[lo].winds; lo++; } // window is inclusive of exactly 24h
    if (sum > bestWinds) bestWinds = sum;
    for (const n of [16, 20, 24]) if (sum >= n && !firstAt[n]) firstAt[n] = timed[hi].date;
  }
  set('marathon',    bestWinds >= 16 ? 1 : 0, firstAt[16]);
  set('all_nighter', bestWinds >= 20 ? 1 : 0, firstAt[20]);
  set('no_lifer',    bestWinds >= 24 ? 1 : 0, firstAt[24]);

  // Bull / Bear Market — a ≥100 rating swing inside any rolling 7-day window, measured
  // from a baseline (NOT accumulated): rise 100 → Bull, drop 100 → Bear. Ratings are
  // per pool, so we check each pool and earn if any one had such a week.
  const WEEK = 7 * 24 * 3600 * 1000;
  const histRows = db.prepare(`
    SELECT eh.pool_key, eh.rating_before, eh.rating_after, g.date, g.created_at AS ts
    FROM elo_history eh JOIN games g ON g.id = eh.game_id
    WHERE eh.player_id = ? AND (g.deleted_at IS NULL OR g.deleted_at = '')
    ORDER BY g.created_at ASC, eh.seq ASC
  `).all(playerId);
  const byPool = {};
  for (const r of histRows) {
    const ms = toMs(r.ts);
    if (ms == null) continue;
    (byPool[r.pool_key] = byPool[r.pool_key] || []).push({ ms, before: r.rating_before, after: r.rating_after, date: r.date });
  }
  let bullDate = null, bearDate = null;
  for (const pool of Object.keys(byPool)) {
    const seq = byPool[pool];
    // Timeline: the pre-game baseline of the first row, then every rating_after.
    const pts = [{ ms: seq[0].ms, r: seq[0].before, date: seq[0].date }, ...seq.map(x => ({ ms: x.ms, r: x.after, date: x.date }))];
    for (let j = 1; j < pts.length; j++) {
      let minR = pts[j].r, maxR = pts[j].r;
      for (let i = j - 1; i >= 0 && pts[j].ms - pts[i].ms <= WEEK; i--) {
        if (pts[i].r < minR) minR = pts[i].r;
        if (pts[i].r > maxR) maxR = pts[i].r;
      }
      if (!bullDate && pts[j].r - minR >= 100) bullDate = pts[j].date;
      if (!bearDate && pts[j].r - maxR <= -100) bearDate = pts[j].date;
    }
  }
  set('bull_market', bullDate ? 1 : 0, bullDate);
  set('bear_market', bearDate ? 1 : 0, bearDate);

  // Comeback — a win immediately following 3+ consecutive losses
  let loss = 0, comeback = false, comebackDate = null;
  for (const g of games) {
    if (g.chips > 0) { if (loss >= 3 && !comeback) { comeback = true; comebackDate = g.date; } loss = 0; }
    else loss++;
  }
  set('comeback', comeback ? 1 : 0, comebackDate);

  // Losing streaks (consecutive games with negative chips)
  let curLoss = 0, bestLoss = 0;
  const lossFirst = { 3: null, 5: null, 10: null };
  for (const g of games) {
    if (g.chips < 0) {
      curLoss++;
      bestLoss = Math.max(bestLoss, curLoss);
      for (const n of [3, 5, 10]) if (curLoss === n && !lossFirst[n]) lossFirst[n] = g.date;
    } else curLoss = 0;
  }
  set('loss_3',  bestLoss >= 3  ? 1 : 0, lossFirst[3]);
  set('loss_5',  bestLoss >= 5  ? 1 : 0, lossFirst[5]);
  set('loss_10', bestLoss >= 10 ? 1 : 0, lossFirst[10]);

  // Archived pools don't count toward ratings badges, Top Dog or Apex (they're hidden).
  const archived = new Set(db.prepare('SELECT pool_key FROM archived_pools').all().map(r => r.pool_key));

  // Rating milestones — best rating across all live pools
  const bestRating = db.prepare(
    'SELECT MAX(rating) r FROM elo_current WHERE player_id = ? AND pool_key NOT IN (SELECT pool_key FROM archived_pools)'
  ).get(playerId)?.r || 0;
  set('rank_1200', bestRating >= 1200 ? 1 : 0, null);
  set('rank_1600', bestRating >= 1600 ? 1 : 0, null);
  set('rank_2000', bestRating >= 2000 ? 1 : 0, null);

  // Top Dog (#1 in any pool) and Apex (#1 in every pool) — archived pools excluded so a
  // stray/junk mode-set can never block Apex.
  const topStmt = db.prepare('SELECT player_id FROM elo_current WHERE pool_key = ? ORDER BY rating DESC LIMIT 1');
  const myPools = db.prepare('SELECT DISTINCT pool_key FROM elo_current WHERE player_id = ?')
    .all(playerId).map(r => r.pool_key).filter(pk => !archived.has(pk));
  const topDog = myPools.some(pk => topStmt.get(pk)?.player_id === playerId);
  set('top_dog', topDog ? 1 : 0, null);

  const allPools = db.prepare('SELECT DISTINCT pool_key FROM elo_current')
    .all().map(r => r.pool_key).filter(pk => !archived.has(pk));
  const apex = allPools.length > 0 && allPools.every(pk => topStmt.get(pk)?.player_id === playerId);
  set('apex', apex ? 1 : 0, null);

  return ACHIEVEMENTS.map(a => ({
    ...a,
    count: res[a.key]?.count || 0,
    earned: (res[a.key]?.count || 0) > 0,
    first: res[a.key]?.first || null,
  }));
}

module.exports = { ACHIEVEMENTS, computeAchievements };
