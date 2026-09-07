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
  { key: 'big_win',     glyph: '大胜', icon: '💰', title: 'Big Winner',    desc: 'Win 500+ chips in a single game',     repeatable: true  },
  { key: 'cracked',     glyph: '崩盘', icon: '💀', title: 'Cracked',       desc: 'Lose 500+ chips in a single game',    repeatable: true  },
  { key: 'sole_winner', glyph: '独赢', icon: '🃏', title: 'Sole Winner',   desc: 'Win while everyone else loses chips', repeatable: true  },
  { key: 'loss_3',      glyph: '三败', icon: '🥶', title: 'Cold Streak',     desc: 'Lose 3 games in a row',             repeatable: false },
  { key: 'loss_5',      glyph: '散财', icon: '💸', title: 'Community Wallet', desc: 'Lose 5 games in a row',              repeatable: false },
  { key: 'loss_10',     glyph: '十败', icon: '🪦', title: 'Rock Bottom',      desc: 'Lose 10 games in a row',            repeatable: false },
  { key: 'rank_1200',   glyph: '新星', icon: '📈', title: 'Rising Star',   desc: 'Reach 1200+ rating',                  repeatable: false },
  { key: 'rank_1600',   glyph: '精英', icon: '🌟', title: 'Elite',         desc: 'Reach 1600+ rating',                  repeatable: false },
  { key: 'rank_2000',   glyph: '传奇', icon: '🏅', title: 'Legend',        desc: 'Reach 2000+ rating',                  repeatable: false },
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
    SELECT gs.game_id, gs.chips, g.date
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

  // Rating milestones — best rating across all pools
  const bestRating = db.prepare('SELECT MAX(rating) r FROM elo_current WHERE player_id = ?').get(playerId)?.r || 0;
  set('rank_1200', bestRating >= 1200 ? 1 : 0, null);
  set('rank_1600', bestRating >= 1600 ? 1 : 0, null);
  set('rank_2000', bestRating >= 2000 ? 1 : 0, null);

  // Top Dog (#1 in any pool) and Apex (#1 in every pool)
  const topStmt = db.prepare('SELECT player_id FROM elo_current WHERE pool_key = ? ORDER BY rating DESC LIMIT 1');
  const myPools = db.prepare('SELECT DISTINCT pool_key FROM elo_current WHERE player_id = ?').all(playerId).map(r => r.pool_key);
  const topDog = myPools.some(pk => topStmt.get(pk)?.player_id === playerId);
  set('top_dog', topDog ? 1 : 0, null);

  const allPools = db.prepare('SELECT DISTINCT pool_key FROM elo_current').all().map(r => r.pool_key);
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
