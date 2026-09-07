const TelegramBot = require('node-telegram-bot-api');
const db = require('./db');
const elo = require('./elo');
const { computeAchievements } = require('./achievements');

const TOKEN = process.env.TELEGRAM_TOKEN;
if (!TOKEN) throw new Error('TELEGRAM_TOKEN env var is required');
const GROUP_CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID
  ? Number(process.env.TELEGRAM_GROUP_CHAT_ID)
  : null;
const RANKINGS_TOPIC_ID = process.env.TELEGRAM_RANKINGS_TOPIC_ID
  ? Number(process.env.TELEGRAM_RANKINGS_TOPIC_ID)
  : null;
const LOGS_TOPIC_ID = process.env.TELEGRAM_LOGS_TOPIC_ID
  ? Number(process.env.TELEGRAM_LOGS_TOPIC_ID)
  : null;

const SEATS = [
  { value: 'dong', label: '东 East' },
  { value: 'nan',  label: '南 South' },
  { value: 'xi',   label: '西 West' },
  { value: 'bei',  label: '北 North' },
];

const MODES_LIST = [
  { value: 'vanilla', label: 'Vanilla' },
  { value: '4_fei',   label: '4 Fei' },
  { value: '8_fei',   label: '8 Fei' },
  { value: '12_fei',  label: '12 Fei' },
  { value: 'guo_san', label: 'Guo San' },
];

const RANKS = [
  { min: 2800, t: '天胡 Legend' },   { min: 2300, t: '满台 Molester' },
  { min: 1900, t: '大牌 Beater' },   { min: 1600, t: '一色 Stroker' },
  { min: 1350, t: '半色 Boner' },    { min: 1150, t: '碰碰 Pervert' },
  { min: 1000, t: '一台 Wanker' },   { min: 0,    t: '炸胡 Gooner' },
];
function getRank(r) { return (RANKS.find(x => r >= x.min) || RANKS[RANKS.length - 1]).t; }

// Is this player currently #1 in any pool (King of the Hill)?
function isPoolLeader(pid) {
  return !!db.prepare(`
    SELECT 1 FROM elo_current ec
    WHERE ec.player_id = ?
      AND ec.rating = (SELECT MAX(rating) FROM elo_current e2 WHERE e2.pool_key = ec.pool_key)
    LIMIT 1
  `).get(pid);
}

// Admin title: pool leaders become "KING <english rank>" (e.g. KING Wanker);
// everyone else keeps their full rank (e.g. 炸胡 Gooner). No emoji — Telegram
// bans emoji in admin custom titles.
function crownedTitle(rating, isLeader) {
  const base = getRank(Math.round(rating ?? 1000));
  if (!isLeader) return base;
  const english = base.split(' ').slice(1).join(' ') || base;
  return `KING ${english}`;
}

// ── Sessions ──────────────────────────────────────────────────────────────────
const sessions = new Map();
function sess(id) { if (!sessions.has(id)) sessions.set(id, {}); return sessions.get(id); }
function clear(id) { sessions.set(id, {}); }

// ── Helpers ───────────────────────────────────────────────────────────────────
function allPlayers() {
  return db.prepare('SELECT id, name FROM players ORDER BY name').all();
}

function modesLabel(modes) {
  return modes.map(m => MODES_LIST.find(x => x.value === m)?.label || m).join(' + ');
}

function taiDefaults(modes) {
  const restricted = modes.some(m => ['4_fei', '8_fei', '12_fei', 'guo_san'].includes(m));
  return restricted ? { minTai: 2, maxTai: 6 } : { minTai: 0, maxTai: 5 };
}

function today() { return new Date().toISOString().slice(0, 10); }

function deriveTransfers(seats) {
  const winners = seats.filter(s => s.chips > 0).map(s => ({ id: s.player_id, rem: s.chips }));
  const losers  = seats.filter(s => s.chips < 0).map(s => ({ id: s.player_id, rem: -s.chips }));
  const out = [];
  let wi = 0;
  for (const l of losers) {
    while (l.rem > 0 && wi < winners.length) {
      const w = winners[wi];
      const amt = Math.min(l.rem, w.rem);
      if (amt > 0) out.push({ from_player_id: l.id, to_player_id: w.id, amount: amt });
      l.rem -= amt; w.rem -= amt;
      if (w.rem === 0) wi++;
    }
  }
  return out;
}

function summaryText(s) {
  const sorted = [...s.seats].sort((a, b) => b.chips - a.chips);
  const lines = [
    `📅 *${s.date}*  ·  ${modesLabel(s.modes)}  ·  ${s.rounds} winds`,
    `🫚 Tai: ${s.minTai}–${s.maxTai}\n`,
  ];
  for (const seat of sorted) {
    const chip = seat.chips > 0 ? `+${seat.chips}` : `${seat.chips}`;
    lines.push(`${seat.name}: *${chip}*`);
  }
  const transfers = deriveTransfers(s.seats);
  if (transfers.length) {
    const byId = Object.fromEntries(s.seats.map(x => [x.player_id, x.name]));
    lines.push('\n💸 Settlement:');
    for (const t of transfers) lines.push(`${byId[t.from_player_id]} → ${byId[t.to_player_id]}: ${t.amount}`);
  }
  if (s.notes) lines.push(`\n📝 ${s.notes}`);
  return lines.join('\n');
}

function insertGame(s, recomputePool) {
  const modes = s.modes;
  const minTai = s.minTai ?? 0;
  const maxTai = s.maxTai ?? 5;
  const poolKey = elo.poolKey(modes, minTai, maxTai);

  const gameId = db.transaction(() => {
    const result = db.prepare(
      'INSERT INTO games (date, modes, rounds, min_tai, max_tai, pool_key, base_chips, duration_minutes, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(s.date, JSON.stringify(modes), s.rounds, minTai, maxTai, poolKey, s.baseChips || null, null, s.notes || null);
    const gid = result.lastInsertRowid;
    const seatStmt = db.prepare('INSERT INTO game_seats (game_id, player_id, seat, chips) VALUES (?, ?, ?, ?)');
    for (const seat of s.seats) seatStmt.run(gid, seat.player_id, seat.seat, seat.chips);
    const trStmt = db.prepare('INSERT INTO transfers (game_id, from_player_id, to_player_id, amount) VALUES (?, ?, ?, ?)');
    for (const t of deriveTransfers(s.seats)) trStmt.run(gid, t.from_player_id, t.to_player_id, t.amount);
    return gid;
  })();

  recomputePool(poolKey);
  return { playerIds: s.seats.map(seat => seat.player_id), gameId };
}

// ── Keyboards ─────────────────────────────────────────────────────────────────
function modeKeyboard(selected) {
  const rows = [];
  for (let i = 0; i < MODES_LIST.length; i += 2) {
    rows.push(MODES_LIST.slice(i, i + 2).map(m => ({
      text: selected.includes(m.value) ? `✓ ${m.label}` : m.label,
      callback_data: `mode:${m.value}`,
    })));
  }
  rows.push([{ text: 'Done →', callback_data: 'mode:done' }]);
  return { inline_keyboard: rows };
}

function playerKeyboard(players, exclude = []) {
  const available = players.filter(p => !exclude.includes(p.id));
  const rows = [];
  for (let i = 0; i < available.length; i += 2) {
    rows.push(available.slice(i, i + 2).map(p => ({
      text: p.name, callback_data: `player:${p.id}:${p.name}`,
    })));
  }
  rows.push([{ text: '➕ Add new player', callback_data: 'addplayer' }]);
  return { inline_keyboard: rows };
}

function windsKeyboard() {
  return { inline_keyboard: [
    [{ text: '4 winds', callback_data: 'winds:4' }, { text: '7 winds', callback_data: 'winds:7' }],
    [{ text: 'Other (type below)', callback_data: 'winds:other' }],
  ]};
}

function poolsKeyboard(pools) {
  const rows = pools.map(p => [{ text: p.label, callback_data: `standings:${p.pool_key}` }]);
  return { inline_keyboard: rows };
}

function profileKeyboard(players) {
  const rows = [];
  for (let i = 0; i < players.length; i += 2) {
    rows.push(players.slice(i, i + 2).map(p => ({ text: p.name, callback_data: `profile:${p.id}` })));
  }
  return { inline_keyboard: rows };
}

// Two-step /vs picker. First pick uses `vsa:<id>`; the second keyboard carries
// the first pick in the callback (`vsb:<aId>:<bId>`) so no session state needed.
function vsKeyboard(players, prefix, firstId) {
  const rows = [];
  const avail = firstId ? players.filter(p => p.id !== firstId) : players;
  for (let i = 0; i < avail.length; i += 2) {
    rows.push(avail.slice(i, i + 2).map(p => ({
      text: p.name,
      callback_data: firstId ? `vsb:${firstId}:${p.id}` : `vsa:${p.id}`,
    })));
  }
  return { inline_keyboard: rows };
}

// ── Win streak ────────────────────────────────────────────────────────────────
function getWinStreak(playerId) {
  const games = db.prepare(`
    SELECT gs.chips FROM game_seats gs
    JOIN games g ON g.id = gs.game_id
    WHERE gs.player_id = ? AND (g.deleted_at IS NULL OR g.deleted_at = '')
    ORDER BY g.date DESC, g.created_at DESC, g.id DESC
    LIMIT 50
  `).all(playerId);
  let streak = 0;
  for (const g of games) {
    if (g.chips > 0) streak++;
    else break;
  }
  return streak;
}

// Rich player profile for the /profile command — the website in a message:
// per-pool ratings, overall record, biggest win/loss, top opponent, badges.
function buildProfile(playerId, name) {
  const lines = [`📊 *${name}'s Profile*`];

  // Per-pool rating + record (a "mode set" is a pool).
  const pools = db.prepare(`
    SELECT ec.pool_key, ec.rating FROM elo_current ec
    WHERE ec.player_id = ? ORDER BY ec.rating DESC
  `).all(playerId);
  if (pools.length) {
    lines.push('', '*Ratings by mode*');
    for (const p of pools) {
      const rating = Math.round(p.rating);
      const rec = db.prepare(`
        SELECT COUNT(*) games, SUM(CASE WHEN gs.chips > 0 THEN 1 ELSE 0 END) wins
        FROM game_seats gs JOIN games g ON g.id = gs.game_id
        WHERE gs.player_id = ? AND g.pool_key = ? AND (g.deleted_at IS NULL OR g.deleted_at = '')
      `).get(playerId, p.pool_key);
      const wr = rec.games ? Math.round((rec.wins / rec.games) * 100) : 0;
      lines.push(`• ${elo.poolLabel(p.pool_key)} — *${rating}* ${getRank(rating)}  _(${wr}% WR, ${rec.games}g)_`);
    }
  }

  // Overall record.
  const agg = db.prepare(`
    SELECT COUNT(*) games, COALESCE(SUM(chips), 0) total,
      SUM(CASE WHEN chips > 0 THEN 1 ELSE 0 END) wins,
      COALESCE(SUM(g.rounds), 0) winds,
      MAX(chips) best, MIN(chips) worst
    FROM game_seats gs JOIN games g ON g.id = gs.game_id
    WHERE gs.player_id = ? AND (g.deleted_at IS NULL OR g.deleted_at = '')
  `).get(playerId);
  if (agg.games) {
    const wr = ((agg.wins / agg.games) * 100).toFixed(0);
    lines.push('', '*Overall*');
    lines.push(`🎮 ${agg.games} games  ·  🏆 ${agg.wins} wins (${wr}%)`);
    lines.push(`💰 Net chips: ${agg.total > 0 ? '+' : ''}${agg.total}`);
    // CPW — chips per wind, length-normalised so long and short games compare.
    if (agg.winds) {
      const cpw = agg.total / agg.winds;
      lines.push(`🌬️ CPW: ${cpw > 0 ? '+' : ''}${cpw.toFixed(1)} chips/wind`);
    }
    // Only show a best/worst line when the game was actually a win / a loss.
    const bw = [];
    if (agg.best > 0)  bw.push(`📈 Biggest win: +${agg.best} chips`);
    if (agg.worst < 0) bw.push(`📉 Biggest loss: ${agg.worst} chips`);
    if (bw.length) lines.push(bw.join('   '));
    const streak = getWinStreak(playerId);
    if (streak >= 2) lines.push(`🔥 Current win streak: ${streak}`);
  }

  // Seat / wind win-rate — how they do from each table position.
  const SEAT_LABELS = { dong: '东 East', nan: '南 South', xi: '西 West', bei: '北 North' };
  const seatRows = db.prepare(`
    SELECT gs.seat, COUNT(*) games,
      SUM(CASE WHEN gs.chips > 0 THEN 1 ELSE 0 END) wins,
      COALESCE(SUM(gs.chips), 0) net
    FROM game_seats gs JOIN games g ON g.id = gs.game_id
    WHERE gs.player_id = ? AND (g.deleted_at IS NULL OR g.deleted_at = '')
    GROUP BY gs.seat
  `).all(playerId);
  const seatMap = Object.fromEntries(seatRows.map(r => [r.seat, r]));
  const seatLines = [];
  for (const s of ['dong', 'nan', 'xi', 'bei']) {
    const r = seatMap[s];
    if (!r || !r.games) continue;
    const wr = Math.round((r.wins / r.games) * 100);
    seatLines.push(`${SEAT_LABELS[s]}: ${wr}% (${r.wins}/${r.games})  ·  net ${r.net > 0 ? '+' : ''}${r.net}`);
  }
  if (seatLines.length) lines.push('', '*By seat*', ...seatLines);

  // Most-frequent opponent (most games sharing a table).
  const nemesis = db.prepare(`
    SELECT p.name, COUNT(*) n FROM game_seats a
    JOIN game_seats b ON b.game_id = a.game_id AND b.player_id != a.player_id
    JOIN games g ON g.id = a.game_id
    JOIN players p ON p.id = b.player_id
    WHERE a.player_id = ? AND (g.deleted_at IS NULL OR g.deleted_at = '')
    GROUP BY b.player_id ORDER BY n DESC LIMIT 1
  `).get(playerId);
  if (nemesis) lines.push('', `🎯 Plays most with: *${nemesis.name}* (${nemesis.n} games)`);

  // Nemesis & Victim — net chip flow per opponent from the transfer ledger.
  const paidRows = db.prepare(`
    SELECT t.to_player_id id, SUM(t.amount) amt FROM transfers t
    JOIN games g ON g.id = t.game_id
    WHERE t.from_player_id = ? AND (g.deleted_at IS NULL OR g.deleted_at = '')
    GROUP BY t.to_player_id
  `).all(playerId);
  const recvRows = db.prepare(`
    SELECT t.from_player_id id, SUM(t.amount) amt FROM transfers t
    JOIN games g ON g.id = t.game_id
    WHERE t.to_player_id = ? AND (g.deleted_at IS NULL OR g.deleted_at = '')
    GROUP BY t.from_player_id
  `).all(playerId);
  const paid = Object.fromEntries(paidRows.map(r => [r.id, r.amt]));
  const recv = Object.fromEntries(recvRows.map(r => [r.id, r.amt]));
  const oppIds = new Set([...paidRows.map(r => r.id), ...recvRows.map(r => r.id)]);
  const nets = [...oppIds].map(id => ({ id, net: (recv[id] || 0) - (paid[id] || 0) })).sort((a, b) => b.net - a.net);
  const nameOf = id => db.prepare('SELECT name FROM players WHERE id = ?').get(id)?.name || '?';
  const victim = nets[0];
  const bleed = nets[nets.length - 1];
  if (victim && victim.net > 0) lines.push(`😈 Farms most: *${nameOf(victim.id)}* (+${victim.net})`);
  if (bleed && bleed.net < 0) lines.push(`😱 Bleeds most to: *${nameOf(bleed.id)}* (${bleed.net})`);

  // Achievement badges (earned only), with ×N counts.
  const earned = computeAchievements(db, playerId).filter(a => a.earned);
  if (earned.length) {
    lines.push('', `*Achievements* (${earned.length})`);
    lines.push(earned.map(a => `${a.icon}${a.title}${a.count > 1 ? ` ×${a.count}` : ''}`).join('  ·  '));
  }

  return lines.join('\n');
}

// Head-to-head rivalry, broken down per mode-set (pool) the two players shared.
function buildRivalry(aId, aName, bId, bName) {
  const rows = db.prepare(`
    SELECT g.pool_key, a.chips AS mine, b.chips AS theirs
    FROM game_seats a
    JOIN game_seats b ON b.game_id = a.game_id AND b.player_id = ?
    JOIN games g ON g.id = a.game_id
    WHERE a.player_id = ? AND (g.deleted_at IS NULL OR g.deleted_at = '')
  `).all(bId, aId);

  if (!rows.length) return `${aName} and ${bName} haven't played a game together yet. 🀄`;

  // Group by pool, preserving pool order by games played.
  const byPool = new Map();
  for (const r of rows) {
    if (!byPool.has(r.pool_key)) byPool.set(r.pool_key, { n: 0, mySum: 0, theirSum: 0, myWins: 0, theirWins: 0, myHigher: 0 });
    const s = byPool.get(r.pool_key);
    s.n++; s.mySum += r.mine; s.theirSum += r.theirs;
    if (r.mine > 0) s.myWins++;
    if (r.theirs > 0) s.theirWins++;
    if (r.mine > r.theirs) s.myHigher++;
  }

  const section = (label, s) => {
    const lead = s.myHigher > s.n - s.myHigher ? `*${aName}* leads`
      : (s.myHigher < s.n - s.myHigher ? `*${bName}* leads` : 'Dead even');
    return [
      `*${label}*`,
      `🀄 ${s.n} game${s.n === 1 ? '' : 's'} — ${lead} ${s.myHigher}–${s.n - s.myHigher} at the table`,
      `${aName}: ${s.myWins} chip-wins · net ${s.mySum > 0 ? '+' : ''}${s.mySum}`,
      `${bName}: ${s.theirWins} chip-wins · net ${s.theirSum > 0 ? '+' : ''}${s.theirSum}`,
    ].join('\n');
  };

  const lines = [`⚔️ *${aName}* vs *${bName}*`, ''];
  const pools = [...byPool.entries()].sort((x, y) => y[1].n - x[1].n);
  lines.push(pools.map(([pk, s]) => section(elo.poolLabel(pk), s)).join('\n\n'));
  return lines.join('\n');
}

// Pre-game win-probability. score = strength(rating) × form(win-rate) × h2h,
// then normalised to 100%. See design notes in chat.
function buildOdds(poolKey, playerIds) {
  const flowStmt = db.prepare(`
    SELECT COALESCE(SUM(t.amount), 0) s FROM transfers t JOIN games g ON g.id = t.game_id
    WHERE t.from_player_id = ? AND t.to_player_id = ? AND g.pool_key = ?
      AND (g.deleted_at IS NULL OR g.deleted_at = '')
  `);
  const M = 4; // pseudo-count for win-rate regularisation (baseline 0.25)

  const scored = playerIds.map(pid => {
    const name = db.prepare('SELECT name FROM players WHERE id = ?').get(pid)?.name || '?';
    const R = db.prepare('SELECT rating FROM elo_current WHERE pool_key = ? AND player_id = ?').get(poolKey, pid)?.rating ?? 1000;
    const rec = db.prepare(`
      SELECT COUNT(*) games, SUM(CASE WHEN gs.chips > 0 THEN 1 ELSE 0 END) wins
      FROM game_seats gs JOIN games g ON g.id = gs.game_id
      WHERE gs.player_id = ? AND g.pool_key = ? AND (g.deleted_at IS NULL OR g.deleted_at = '')
    `).get(pid, poolKey);
    const games = rec.games || 0, wins = rec.wins || 0;

    // Net chips vs the other three at this table (pool ledger).
    let netVsField = 0;
    for (const opp of playerIds) {
      if (opp === pid) continue;
      netVsField += flowStmt.get(opp, pid, poolKey).s - flowStmt.get(pid, opp, poolKey).s;
    }

    const strength = Math.pow(10, R / 400);
    const wrAdj = (wins + 0.25 * M) / (games + M);
    const form = Math.min(1.6, Math.max(0.5, 1 + 0.6 * (wrAdj - 0.25)));
    const h2h = 1 + 0.3 * Math.tanh(netVsField / 800);
    return { name, R: Math.round(R), games, wrAdj, score: strength * form * h2h };
  });

  const total = scored.reduce((s, x) => s + x.score, 0) || 1;
  scored.forEach(x => { x.prob = (x.score / total) * 100; });
  scored.sort((a, b) => b.prob - a.prob);

  const lines = [`🎲 *Pre-game odds — ${elo.poolLabel(poolKey)}*`, ''];
  const medals = ['🥇', '🥈', '🥉', '4️⃣'];
  scored.forEach((x, i) => {
    lines.push(`${medals[i]} *${x.prob.toFixed(0)}%*  ${x.name}  _(${x.R}, ${Math.round(x.wrAdj * 100)}% form)_`);
  });
  lines.push('', '_Win chance from rating × win-rate × head-to-head._');
  return lines.join('\n');
}

function oddsPoolKeyboard(pools) {
  return { inline_keyboard: pools.map(p => [{ text: p.label, callback_data: `oddspool:${p.pool_key}` }]) };
}
function oddsPlayerKeyboard(players, picked) {
  const rows = [];
  const avail = players.filter(p => !picked.includes(p.id));
  for (let i = 0; i < avail.length; i += 2) {
    rows.push(avail.slice(i, i + 2).map(p => ({ text: p.name, callback_data: `oddspick:${p.id}` })));
  }
  return { inline_keyboard: rows };
}

// ── CRACKED roast (templated) ───────────────────────────────────────────────
// Pre-written lines with {loser}/{amount}/{kraken} filled in. Zero-cost and
// instant; swap for an AI-generated line later if you want spicier.
const ROASTS = [
  'How does your asshole feel, {loser} 😹',
  '{loser} just took it like a good boy 🤣',
  '{loser} is so generous today! ❤️',
  'Maybe {loser} just likes being spanked 😯',
  'Thank you Thank you Thank you Thank you 😁',
];
function roastLine(loser, amount, kraken) {
  const t = ROASTS[Math.floor(Math.random() * ROASTS.length)];
  return t.replace(/{loser}/g, loser).replace(/{amount}/g, amount).replace(/{kraken}/g, kraken || 'The table');
}

// ── Rank title updater ────────────────────────────────────────────────────────
async function updateRankTitles(bot, playerIds) {
  if (!GROUP_CHAT_ID || !playerIds || !playerIds.length) return;
  for (const pid of playerIds) {
    const player = db.prepare('SELECT name, telegram_user_id FROM players WHERE id = ?').get(pid);
    if (!player?.telegram_user_id) continue;

    // Use highest rating across all pools
    const eloRow = db.prepare(`
      SELECT ec.rating FROM elo_current ec
      WHERE ec.player_id = ?
      ORDER BY ec.rating DESC LIMIT 1
    `).get(pid);
    const newRank = crownedTitle(eloRow?.rating, isPoolLeader(pid));

    // Check for rank-up by comparing latest elo_history before/after
    const latest = db.prepare(`
      SELECT rating_before, rating_after FROM elo_history
      WHERE player_id = ? ORDER BY seq DESC LIMIT 1
    `).get(pid);
    if (latest) {
      const oldRank = getRank(Math.round(latest.rating_before));
      const afterRank = getRank(Math.round(latest.rating_after));
      if (oldRank !== afterRank) {
        const oldIdx = RANKS.findIndex(r => r.t === oldRank);
        const newIdx = RANKS.findIndex(r => r.t === afterRank);
        if (newIdx < oldIdx) {
          bot.sendMessage(GROUP_CHAT_ID,
            `🎉 *${player.name}* just ranked up to *${afterRank}*! 🀄🔥`,
            { parse_mode: 'Markdown' }
          ).catch(console.error);
        }
      }
    }

    try {
      await bot.setChatAdministratorCustomTitle(GROUP_CHAT_ID, player.telegram_user_id, newRank);
      console.log(`Set title for ${player.name}: ${newRank}`);
    } catch (err) {
      console.error(`setChatAdministratorCustomTitle failed for ${player.name}:`, err.message);
    }
  }
}

// Announce when a pool's #1 (King of the Hill) changes hands.
function announceDethrone(bot, poolKey, oldId, newId) {
  if (!GROUP_CHAT_ID || !newId || oldId === newId) return;
  const label = elo.poolLabel(poolKey);
  const nu = db.prepare('SELECT name FROM players WHERE id = ?').get(newId)?.name;
  if (!nu) return;
  const msg = oldId
    ? `👑 *${nu}* dethroned *${db.prepare('SELECT name FROM players WHERE id = ?').get(oldId)?.name}* to become *KING* of *${label}*!`
    : `👑 *${nu}* is the new *KING* of *${label}*!`;
  bot.sendMessage(GROUP_CHAT_ID, msg, { parse_mode: 'Markdown' }).catch(console.error);
}

// ── Post-game broadcast ───────────────────────────────────────────────────────
const PLACE_EMOJIS = ['🥇', '🥈', '🥉', '4️⃣'];

function postGameBroadcast(bot, gameId) {
  if (!GROUP_CHAT_ID || !LOGS_TOPIC_ID) return;
  try {
    const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
    if (!game) return;
    const seats = db.prepare(`
      SELECT gs.chips, p.name FROM game_seats gs
      JOIN players p ON p.id = gs.player_id
      WHERE gs.game_id = ? ORDER BY gs.chips DESC
    `).all(gameId);
    const modes = JSON.parse(game.modes);
    const modeStr = modes.map(m => MODES_LIST.find(x => x.value === m)?.label || m).join(' + ');
    const lines = [
      `🀄 *Game Logged*`,
      `📅 ${game.date}  ·  ${modeStr}  ·  ${game.rounds} winds  ·  🫚 ${game.min_tai}–${game.max_tai} tai`,
      '',
    ];
    seats.forEach((s, i) => {
      const chip = s.chips > 0 ? `+${s.chips}` : `${s.chips}`;
      const tag = s.chips <= -500 ? '  💀 *CRACKED*' : (s.chips >= 500 ? '  🐙' : '');
      lines.push(`${PLACE_EMOJIS[i]} *${s.name}*  ${chip}${tag}`);
    });
    // Auto-roast the worst cracking (lost 500+), crediting the top winner.
    const worst = seats[seats.length - 1];
    if (worst && worst.chips <= -500) {
      const kraken = seats[0]?.chips > 0 ? seats[0].name : null;
      lines.push('', roastLine(worst.name, Math.abs(worst.chips), kraken));
    }
    bot.sendMessage(GROUP_CHAT_ID, lines.join('\n'), {
      parse_mode: 'Markdown',
      message_thread_id: LOGS_TOPIC_ID,
    }).catch(console.error);
  } catch (err) {
    console.error('postGameBroadcast error:', err.message);
  }
}

// Hype shoutouts to the main chat (same channel as rank-ups): live win streaks
// (5+, re-announced every game until broken) and newly-unlocked achievements.
// `unlocks` = [{ player_id, name, newly: [{ glyph, icon, title }] }].
function announceMilestones(bot, seatedIds, unlocks) {
  if (!GROUP_CHAT_ID) return;
  try {
    const lines = [];
    for (const pid of seatedIds || []) {
      const streak = getWinStreak(pid);
      if (streak >= 5) {
        const name = db.prepare('SELECT name FROM players WHERE id = ?').get(pid)?.name || 'Someone';
        lines.push(`🔥 *${name}* is on a *${streak}-game* win streak!`);
      }
    }
    for (const u of unlocks || []) {
      for (const a of u.newly) lines.push(`🏅 *${u.name}* unlocked *${a.glyph} ${a.title}*! ${a.icon}`);
    }
    if (lines.length) {
      bot.sendMessage(GROUP_CHAT_ID, lines.join('\n'), { parse_mode: 'Markdown' }).catch(console.error);
    }
  } catch (err) {
    console.error('announceMilestones error:', err.message);
  }
}

// ── Weekly leaderboard ────────────────────────────────────────────────────────
function buildWeeklyMessage() {
  const pools = db.prepare(
    'SELECT DISTINCT pool_key FROM elo_current ORDER BY pool_key'
  ).all().map(r => r.pool_key);
  if (!pools.length) return null;

  const now = new Date(Date.now() + 8 * 3600 * 1000);
  const dateStr = now.toISOString().slice(0, 10);
  // Cutoff = start of the 7-day window (SGT date), for weekly deltas & highlights.
  const cutoff = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const lines = [`🏆 *Weekly Standings — ${dateStr}*\n`];

  // Rating change over the past week = sum of this week's ELO deltas in the pool.
  const weekDeltaStmt = db.prepare(`
    SELECT COALESCE(SUM(h.delta), 0) AS d
    FROM elo_history h JOIN games g ON g.id = h.game_id
    WHERE h.player_id = ? AND h.pool_key = ? AND g.date >= ?
      AND (g.deleted_at IS NULL OR g.deleted_at = '')
  `);

  for (const pk of pools) {
    const rows = db.prepare(`
      SELECT p.id, p.name, ec.rating
      FROM elo_current ec JOIN players p ON p.id = ec.player_id
      WHERE ec.pool_key = ? ORDER BY ec.rating DESC LIMIT 10
    `).all(pk);
    if (!rows.length) continue;
    lines.push(`*${elo.poolLabel(pk)}*`);
    rows.forEach((r, i) => {
      const rating = Math.round(r.rating);
      const wd = Math.round(weekDeltaStmt.get(r.id, pk, cutoff).d);
      const delta = wd === 0 ? '' : (wd > 0 ? ` _(+${wd} this wk)_` : ` _(${wd} this wk)_`);
      lines.push(`${i + 1}. ${r.name} — *${rating}*${delta}  ${getRank(rating)}`);
    });
    lines.push('');
  }

  return lines.join('\n');
}

// ── Weekly awards show (separate message from the standings) ──────────────────
function buildAwardsMessage() {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  const cutoff = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const lines = ['🎉 *Weekly Awards* 🎉', ''];
  let any = false;

  // Rating climbers this week (sum of ELO deltas across pools).
  const gains = db.prepare(`
    SELECT p.name, SUM(h.delta) AS gain
    FROM elo_history h JOIN games g ON g.id = h.game_id JOIN players p ON p.id = h.player_id
    WHERE g.date >= ? AND (g.deleted_at IS NULL OR g.deleted_at = '')
    GROUP BY h.player_id ORDER BY gain DESC
  `).all(cutoff).filter(g => g.gain > 0);
  if (gains[0]) { lines.push(`🏆 *MVP* — ${gains[0].name} (+${Math.round(gains[0].gain)} rating)`); any = true; }
  if (gains[1]) { lines.push(`📈 *Most Improved* — ${gains[1].name} (+${Math.round(gains[1].gain)} rating)`); }

  // Chip swings this week.
  const weekNet = db.prepare(`
    SELECT p.name, SUM(gs.chips) AS total FROM game_seats gs
    JOIN players p ON p.id = gs.player_id JOIN games g ON g.id = gs.game_id
    WHERE g.date >= ? AND (g.deleted_at IS NULL OR g.deleted_at = '')
    GROUP BY gs.player_id ORDER BY total DESC
  `).all(cutoff);
  if (weekNet.length) {
    const kraken = weekNet[0], cracked = weekNet[weekNet.length - 1];
    if (kraken && kraken.total > 0) { lines.push(`🐙 *KRAKEN* — ${kraken.name} (+${kraken.total} chips)`); any = true; }
    if (cracked && cracked.total < 0) { lines.push(`💀 *CRACKED* — ${cracked.name} (${cracked.total} chips)`); any = true; }
  }

  // Activity + efficiency this week.
  const perPlayer = db.prepare(`
    SELECT p.name, COUNT(DISTINCT gs.game_id) AS games,
      COALESCE(SUM(gs.chips), 0) AS chips, COALESCE(SUM(g.rounds), 0) AS winds
    FROM game_seats gs JOIN players p ON p.id = gs.player_id JOIN games g ON g.id = gs.game_id
    WHERE g.date >= ? AND (g.deleted_at IS NULL OR g.deleted_at = '')
    GROUP BY gs.player_id
  `).all(cutoff);
  if (perPlayer.length) {
    const active = [...perPlayer].sort((a, b) => b.games - a.games)[0];
    if (active) { lines.push(`🎮 *Most Active* — ${active.name} (${active.games} games)`); any = true; }
    const cpw = perPlayer.filter(p => p.games >= 2 && p.winds > 0)
      .map(p => ({ name: p.name, cpw: p.chips / p.winds }))
      .sort((a, b) => b.cpw - a.cpw)[0];
    if (cpw && cpw.cpw > 0) lines.push(`🌬️ *CPW King* — ${cpw.name} (+${cpw.cpw.toFixed(1)}/wind)`);
  }

  // Most-played game modes this week (each mode in a multi-mode game counts once).
  const weekGames = db.prepare(`
    SELECT modes FROM games WHERE date >= ? AND (deleted_at IS NULL OR deleted_at = '')
  `).all(cutoff);
  const modeCounts = {};
  for (const g of weekGames) {
    let modes;
    try { modes = JSON.parse(g.modes); } catch { modes = []; }
    for (const m of modes) modeCounts[m] = (modeCounts[m] || 0) + 1;
  }
  const rankedModes = Object.entries(modeCounts).sort((a, b) => b[1] - a[1]);
  if (rankedModes.length) {
    lines.push('', '🎴 *Modes played this week*');
    rankedModes.forEach(([m, n], i) => {
      const label = MODES_LIST.find(x => x.value === m)?.label || m;
      lines.push(`${i + 1}. ${label} — ${n} game${n === 1 ? '' : 's'}`);
    });
    any = true;
  }

  return any ? lines.join('\n') : null;
}

// ── Monthly summary ───────────────────────────────────────────────────────────
function buildMonthlyMessage() {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  const prevMonth = new Date(now);
  prevMonth.setMonth(prevMonth.getMonth() - 1);
  const y = prevMonth.getUTCFullYear();
  const m = String(prevMonth.getUTCMonth() + 1).padStart(2, '0');
  const monthStr = prevMonth.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'Asia/Singapore' });
  const prefix = `${y}-${m}`;

  const pools = db.prepare(`
    SELECT DISTINCT g.pool_key FROM games g
    WHERE g.date LIKE ? AND (g.deleted_at IS NULL OR g.deleted_at = '')
  `).all(`${prefix}%`).map(r => r.pool_key);

  if (!pools.length) return null;

  const lines = [`📅 *Monthly Summary — ${monthStr}*\n`];

  for (const pk of pools) {
    const rows = db.prepare(`
      SELECT p.name, SUM(gs.chips) as chips, COUNT(*) as games,
        SUM(CASE WHEN gs.chips > 0 THEN 1 ELSE 0 END) as wins
      FROM game_seats gs
      JOIN players p ON p.id = gs.player_id
      JOIN games g ON g.id = gs.game_id
      WHERE g.pool_key = ? AND g.date LIKE ?
        AND (g.deleted_at IS NULL OR g.deleted_at = '')
      GROUP BY gs.player_id ORDER BY chips DESC
    `).all(pk, `${prefix}%`);
    if (!rows.length) continue;
    lines.push(`*${elo.poolLabel(pk)}*`);
    rows.forEach((r, i) => {
      const chip = r.chips > 0 ? `+${r.chips}` : `${r.chips}`;
      lines.push(`${i + 1}. ${r.name} — ${chip} chips · ${r.games}G · ${r.wins}W`);
    });
    lines.push('');
  }

  return lines.join('\n');
}

function startCrons(bot) {
  if (!GROUP_CHAT_ID) return;
  let lastFiredWeek = -1;
  let lastFiredMonth = -1;

  setInterval(() => {
    const now = new Date();
    const utcDay = now.getUTCDay();
    const utcHour = now.getUTCHours();
    const utcDate = now.getUTCDate();

    // Weekly: Monday 1am UTC = 9am SGT
    if (utcDay === 1 && utcHour === 1) {
      const week = Math.floor(now.getTime() / (7 * 24 * 3600 * 1000));
      if (lastFiredWeek !== week) {
        lastFiredWeek = week;
        const opts = { parse_mode: 'Markdown', ...(RANKINGS_TOPIC_ID ? { message_thread_id: RANKINGS_TOPIC_ID } : {}) };
        const standings = buildWeeklyMessage();
        if (standings) bot.sendMessage(GROUP_CHAT_ID, standings, opts).catch(console.error);
        const awards = buildAwardsMessage();
        if (awards) bot.sendMessage(GROUP_CHAT_ID, awards, opts).catch(console.error);
      }
    }

    // Monthly: 1st of month, 1am UTC = 9am SGT
    if (utcDate === 1 && utcHour === 1) {
      const monthKey = now.getUTCFullYear() * 12 + now.getUTCMonth();
      if (lastFiredMonth !== monthKey) {
        lastFiredMonth = monthKey;
        const msg = buildMonthlyMessage();
        if (msg) bot.sendMessage(GROUP_CHAT_ID, msg, {
          parse_mode: 'Markdown',
          ...(RANKINGS_TOPIC_ID ? { message_thread_id: RANKINGS_TOPIC_ID } : {}),
        }).catch(console.error);
      }
    }
  }, 60 * 1000);
}

// ── Bot ───────────────────────────────────────────────────────────────────────
module.exports = function startBot({ recomputePool }) {
  const bot = new TelegramBot(TOKEN, { polling: true });
  console.log('Telegram bot started (polling)');

  // Expose so index.js can call after web-logged games too
  const rankUpdater = (playerIds) => updateRankTitles(bot, playerIds);
  const broadcaster = (gameId) => postGameBroadcast(bot, gameId);
  const dethroner = (poolKey, oldId, newId) => announceDethrone(bot, poolKey, oldId, newId);

  startCrons(bot);

  function startLog(chatId) {
    const players = allPlayers();
    if (players.length < 4) {
      return bot.sendMessage(chatId, 'You need at least 4 registered players. Use /addplayer to add some first.');
    }
    clear(chatId);
    const s = sess(chatId);
    s.step = 'mode';
    s.modes = ['vanilla'];
    s.date = today();
    s.players = players;
    bot.sendMessage(chatId, '🎮 *Select game modes:*\n_(tap to toggle, then Done)_', {
      parse_mode: 'Markdown',
      reply_markup: modeKeyboard(s.modes),
    });
  }

  // ── Commands ────────────────────────────────────────────────────────────────
  bot.onText(/\/start/, msg => {
    bot.sendMessage(msg.chat.id,
      '🀄 *Mahjong Ranked Bot*\n\n' +
      '/log — log a game\n' +
      '/standings — leaderboard\n' +
      '/profile — pick anyone to see ratings, stats & achievements\n' +
      '/vs — head-to-head rivalry between any two players\n' +
      '/odds — pre-game win probabilities for a 4-player table\n' +
      '/players — list players\n' +
      '/addplayer — add a new player\n' +
      '/link <name> — link your Telegram account to your player profile\n' +
      '/cancel — cancel current action',
      { parse_mode: 'Markdown' }
    );
  });

  bot.onText(/\/cancel/, msg => {
    clear(msg.chat.id);
    bot.sendMessage(msg.chat.id, 'Cancelled. ✋');
  });

  bot.onText(/\/log/, msg => startLog(msg.chat.id));

  bot.onText(/\/players/, msg => {
    const ps = allPlayers();
    if (!ps.length) return bot.sendMessage(msg.chat.id, 'No players yet. Use /addplayer to add one.');
    bot.sendMessage(msg.chat.id, '*Players:*\n' + ps.map(p => `• ${p.name}`).join('\n'), { parse_mode: 'Markdown' });
  });

  bot.onText(/\/addplayer/, msg => {
    const s = sess(msg.chat.id);
    s.step = 'addplayer_name';
    bot.sendMessage(msg.chat.id, "👤 Enter the new player's name:");
  });

  bot.onText(/\/link(?:\s+(.+))?/, (msg, match) => {
    const name = match[1]?.trim();
    if (!name) {
      return bot.sendMessage(msg.chat.id,
        'Usage: /link <your player name>\nExample: /link Bryan\n\nThis links your Telegram account to your tracker profile so your rank title updates automatically.',
        { parse_mode: 'Markdown' }
      );
    }
    const player = db.prepare('SELECT * FROM players WHERE LOWER(name) = LOWER(?)').get(name);
    if (!player) {
      const names = allPlayers().map(p => p.name).join(', ');
      return bot.sendMessage(msg.chat.id, `No player named "${name}".\n\nKnown players: ${names}`);
    }
    const existing = db.prepare('SELECT p.name FROM players p WHERE p.telegram_user_id = ? AND p.id != ?').get(msg.from.id, player.id);
    if (existing) {
      bot.sendMessage(msg.chat.id, `⚠️ Your account was previously linked to *${existing.name}* — switching to *${player.name}*.`, { parse_mode: 'Markdown' });
      db.prepare('UPDATE players SET telegram_user_id = NULL WHERE telegram_user_id = ?').run(msg.from.id);
    }
    db.prepare('UPDATE players SET telegram_user_id = ? WHERE id = ?').run(msg.from.id, player.id);
    const eloRow = db.prepare('SELECT MAX(rating) AS rating FROM elo_current WHERE player_id = ?').get(player.id);
    const rankStr = eloRow?.rating ? ` Current rank: *${crownedTitle(eloRow.rating, isPoolLeader(player.id))}*` : '';
    bot.sendMessage(msg.chat.id, `✅ Linked to *${player.name}*!${rankStr}\n\nYour admin title will update automatically after each game.`, { parse_mode: 'Markdown' });

    // Promote in group so the bot can set a custom title (bot can only set titles for admins it promoted)
    if (GROUP_CHAT_ID) {
      bot.promoteChatMember(GROUP_CHAT_ID, msg.from.id, {
        can_manage_chat: true,  // minimum required to actually become admin
        can_change_info: false,
        can_delete_messages: false,
        can_invite_users: false,
        can_restrict_members: false,
        can_pin_messages: false,
        can_manage_topics: false,
        can_manage_video_chats: false,
      }).then(() => rankUpdater([player.id]))
        .catch(err => {
          console.error('promoteChatMember failed:', err.message);
          bot.sendMessage(msg.chat.id,
            `⚠️ Couldn't set your rank title: ${err.message}\n\nMake sure the bot has "Add Members" admin permission in the group.`
          ).catch(console.error);
        });
    } else {
      rankUpdater([player.id]);
    }
  });

  bot.onText(/\/profile(?:\s+(.+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const arg = match[1]?.trim();
    // Direct lookup by name still works: /profile Wyman
    if (arg) {
      const player = db.prepare('SELECT * FROM players WHERE LOWER(name) = LOWER(?)').get(arg);
      if (!player) {
        const names = allPlayers().map(p => p.name).join(', ');
        return bot.sendMessage(chatId, `No player named "${arg}".\n\nKnown players: ${names}`);
      }
      return bot.sendMessage(chatId, buildProfile(player.id, player.name), { parse_mode: 'Markdown' });
    }
    // Otherwise show a tap-to-pick list of everyone (so it's obvious you can
    // view anyone, not just yourself).
    const players = allPlayers();
    if (!players.length) return bot.sendMessage(chatId, 'No players yet. Use /addplayer to add one.');
    bot.sendMessage(chatId, '👤 *Whose profile?*', {
      parse_mode: 'Markdown',
      reply_markup: profileKeyboard(players),
    });
  });

  bot.onText(/\/vs(?:\s+(.+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const oppName = match[1]?.trim();
    // Shortcut: /vs <name> = you (linked) vs them.
    if (oppName) {
      const me = db.prepare('SELECT * FROM players WHERE telegram_user_id = ?').get(msg.from.id);
      if (!me) {
        return bot.sendMessage(chatId, 'Link your account first with /link <your name>, or just use /vs and pick both players.', { parse_mode: 'Markdown' });
      }
      const opp = db.prepare('SELECT * FROM players WHERE LOWER(name) = LOWER(?)').get(oppName);
      if (!opp) {
        const names = allPlayers().map(p => p.name).join(', ');
        return bot.sendMessage(chatId, `No player named "${oppName}".\n\nKnown players: ${names}`);
      }
      if (opp.id === me.id) return bot.sendMessage(chatId, "You can't have a rivalry with yourself. 🀄");
      return bot.sendMessage(chatId, buildRivalry(me.id, me.name, opp.id, opp.name), { parse_mode: 'Markdown' });
    }
    // Otherwise pick both sides from a list.
    const players = allPlayers();
    if (players.length < 2) return bot.sendMessage(chatId, 'Need at least 2 players.');
    bot.sendMessage(chatId, '⚔️ *Rivalry — pick the first player:*', {
      parse_mode: 'Markdown',
      reply_markup: vsKeyboard(players, 'vsa'),
    });
  });

  bot.onText(/\/odds/, msg => {
    const chatId = msg.chat.id;
    const players = allPlayers();
    if (players.length < 4) return bot.sendMessage(chatId, 'Need at least 4 players.');
    const pools = db.prepare(
      'SELECT pool_key, COUNT(*) as n FROM games GROUP BY pool_key ORDER BY n DESC'
    ).all().map(p => ({ pool_key: p.pool_key, label: elo.poolLabel(p.pool_key) }));
    if (!pools.length) return bot.sendMessage(chatId, 'No games logged yet — no ratings to base odds on.');
    const s = sess(chatId);
    s.step = 'odds_pool';
    bot.sendMessage(chatId, '🎲 *Pre-game odds — which mode?*', {
      parse_mode: 'Markdown',
      reply_markup: oddsPoolKeyboard(pools),
    });
  });

  bot.onText(/\/standings/, msg => {
    const pools = db.prepare(
      'SELECT pool_key, COUNT(*) as n FROM games GROUP BY pool_key ORDER BY n DESC'
    ).all().map(p => ({ pool_key: p.pool_key, label: elo.poolLabel(p.pool_key), games: p.n }));

    if (!pools.length) return bot.sendMessage(msg.chat.id, 'No games logged yet.');
    if (pools.length === 1) return showStandings(msg.chat.id, pools[0].pool_key);

    const s = sess(msg.chat.id);
    s.step = 'standings_pool';
    bot.sendMessage(msg.chat.id, '🏆 *Which pool?*', {
      parse_mode: 'Markdown',
      reply_markup: poolsKeyboard(pools),
    });
  });

  function showStandings(chatId, poolKey) {
    const rows = db.prepare(`
      SELECT p.name, ec.rating
      FROM elo_current ec JOIN players p ON p.id = ec.player_id
      WHERE ec.pool_key = ? ORDER BY ec.rating DESC
    `).all(poolKey);

    if (!rows.length) return bot.sendMessage(chatId, 'No ratings in this pool yet.');

    const lines = [`🏆 *${elo.poolLabel(poolKey)}*\n`];
    rows.forEach((r, i) => {
      const rating = Math.round(r.rating);
      lines.push(`${i + 1}. ${r.name} — *${rating}*`);
      lines.push(`   ${getRank(rating)}`);
    });

    bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'Markdown' });
  }

  // ── Callback queries ─────────────────────────────────────────────────────────
  bot.on('callback_query', async query => {
    const chatId = query.message.chat.id;
    const msgId  = query.message.message_id;
    const data   = query.data;
    const s      = sess(chatId);

    bot.answerCallbackQuery(query.id);

    // Pool selection for standings
    if (data.startsWith('standings:')) {
      const poolKey = data.slice(10);
      clear(chatId);
      bot.deleteMessage(chatId, msgId).catch(() => {});
      return showStandings(chatId, poolKey);
    }

    // Player selection for /profile
    if (data.startsWith('profile:')) {
      const pid = Number(data.slice(8));
      const player = db.prepare('SELECT * FROM players WHERE id = ?').get(pid);
      bot.deleteMessage(chatId, msgId).catch(() => {});
      if (player) bot.sendMessage(chatId, buildProfile(player.id, player.name), { parse_mode: 'Markdown' });
      return;
    }

    // /vs — first player picked, now choose the opponent.
    if (data.startsWith('vsa:')) {
      const firstId = Number(data.slice(4));
      const first = db.prepare('SELECT name FROM players WHERE id = ?').get(firstId);
      if (!first) return;
      return bot.editMessageText(`⚔️ *${first.name}* vs… pick the opponent:`, {
        chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
        reply_markup: vsKeyboard(allPlayers(), 'vsb', firstId),
      });
    }

    // /vs — both players picked, show the rivalry.
    if (data.startsWith('vsb:')) {
      const [, aId, bId] = data.split(':').map(Number);
      const a = db.prepare('SELECT id, name FROM players WHERE id = ?').get(aId);
      const b = db.prepare('SELECT id, name FROM players WHERE id = ?').get(bId);
      bot.deleteMessage(chatId, msgId).catch(() => {});
      if (a && b) bot.sendMessage(chatId, buildRivalry(a.id, a.name, b.id, b.name), { parse_mode: 'Markdown' });
      return;
    }

    // /odds — pool chosen, now pick the 4 players.
    if (data.startsWith('oddspool:') && s.step === 'odds_pool') {
      s.oddsPool = data.slice(9);
      s.oddsPlayers = [];
      s.step = 'odds_pick';
      return bot.editMessageText('🎲 *Pick player 1 of 4:*', {
        chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
        reply_markup: oddsPlayerKeyboard(allPlayers(), []),
      });
    }

    // /odds — picking the 4 players one at a time.
    if (data.startsWith('oddspick:') && s.step === 'odds_pick') {
      const pid = Number(data.slice(9));
      if (!s.oddsPlayers.includes(pid)) s.oddsPlayers.push(pid);
      if (s.oddsPlayers.length < 4) {
        return bot.editMessageText(`🎲 *Pick player ${s.oddsPlayers.length + 1} of 4:*`, {
          chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
          reply_markup: oddsPlayerKeyboard(allPlayers(), s.oddsPlayers),
        });
      }
      const poolKey = s.oddsPool;
      const picks = s.oddsPlayers.slice(0, 4);
      clear(chatId);
      bot.deleteMessage(chatId, msgId).catch(() => {});
      return bot.sendMessage(chatId, buildOdds(poolKey, picks), { parse_mode: 'Markdown' });
    }

    // Mode toggle
    if (data.startsWith('mode:') && s.step === 'mode') {
      const val = data.slice(5);
      if (val === 'done') {
        if (!s.modes.length) return bot.answerCallbackQuery(query.id, { text: 'Pick at least one mode.' });
        s.step = 'tai';
        return bot.editMessageText('🫚 *Tai restriction?*', {
          chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [
            [{ text: 'Set min / max tai', callback_data: 'tai:yes' }],
          ]},
        });
      }
      s.modes = s.modes.includes(val) ? s.modes.filter(m => m !== val) : [...s.modes, val];
      return bot.editMessageReplyMarkup(modeKeyboard(s.modes), { chat_id: chatId, message_id: msgId });
    }

    // Tai
    if (data === 'tai:yes' && s.step === 'tai') {
      s.step = 'min_tai';
      return bot.editMessageText('Enter *min tai*:\n\n`0` = no minimum (players can zimo any tai)', {
        chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
      });
    }

    // Winds
    if (data.startsWith('winds:') && s.step === 'winds') {
      const val = data.slice(6);
      if (val === 'other') {
        s.step = 'winds_custom';
        return bot.editMessageText('💨 Enter number of winds (e.g. 6 or 8):', {
          chat_id: chatId, message_id: msgId,
        });
      }
      s.rounds = parseInt(val);
      s.seats = [];
      s.step = 'seat_0';
      return bot.editMessageText(`👤 *Select ${SEATS[0].label} player:*`, {
        chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
        reply_markup: playerKeyboard(s.players, []),
      });
    }

    // Add player during seat selection
    if (data === 'addplayer' && s.step?.startsWith('seat_')) {
      s.addingForStep = s.step;
      s.step = 'addplayer_inline';
      return bot.editMessageText("👤 Enter the new player's name:", {
        chat_id: chatId, message_id: msgId,
      });
    }

    // Player selection for seats
    if (data.startsWith('player:') && s.step?.startsWith('seat_')) {
      const parts = data.split(':');
      const pid = parseInt(parts[1]);
      const pname = parts.slice(2).join(':');
      const seatIdx = parseInt(s.step.slice(5));
      s.seats.push({ seat: SEATS[seatIdx].value, player_id: pid, name: pname, chips: 0 });

      const nextIdx = seatIdx + 1;
      if (nextIdx < 4) {
        s.step = `seat_${nextIdx}`;
        const taken = s.seats.map(x => x.player_id);
        return bot.editMessageText(`👤 *Select ${SEATS[nextIdx].label} player:*`, {
          chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
          reply_markup: playerKeyboard(s.players, taken),
        });
      }
      s.chipIdx = 0;
      s.step = 'base_chips';
      return bot.editMessageText(
        `⚙️ *Starting chips per player?*\n\nHow many chips does everyone start with? (e.g. \`500\`)`,
        { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }
      );
    }

    // Confirm
    if (data === 'confirm' && s.step === 'confirm') {
      try {
        const { playerIds, gameId } = insertGame(s, recomputePool);
        bot.editMessageText('✅ Game logged!', { chat_id: chatId, message_id: msgId });
        clear(chatId);
        rankUpdater(playerIds);
        broadcaster(gameId);
      } catch (err) {
        bot.editMessageText(`❌ Error: ${err.message}`, { chat_id: chatId, message_id: msgId });
        clear(chatId);
      }
      return;
    }

    if (data === 'notes:skip' && s.step === 'notes') {
      s.notes = null;
      s.step = 'confirm';
      return bot.editMessageText(summaryText(s) + '\n\nLog this game?', {
        chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
          [{ text: '✅ Confirm', callback_data: 'confirm' }, { text: '❌ Cancel', callback_data: 'cancel_log' }],
        ]},
      });
    }

    if (data === 'cancel_log') {
      clear(chatId);
      return bot.editMessageText('Cancelled.', { chat_id: chatId, message_id: msgId });
    }
  });

  // ── Text messages ─────────────────────────────────────────────────────────────
  bot.on('message', msg => {
    if (!msg.text || msg.text.startsWith('/')) return;
    const chatId = msg.chat.id;
    const s      = sess(chatId);
    const text   = msg.text.trim();
    // In group chats, only respond if there's an active session for this chat
    if (msg.chat.type !== 'private' && !s.step) return;

    // Add player (standalone command flow)
    if (s.step === 'addplayer_name') {
      if (!text) return bot.sendMessage(chatId, "Name can't be empty.");
      const existing = db.prepare('SELECT id FROM players WHERE LOWER(name) = LOWER(?)').get(text);
      if (existing) return bot.sendMessage(chatId, `❌ A player named "${text}" already exists.`);
      try {
        const result = db.prepare("INSERT INTO players (name, color) VALUES (?, '#6b7280')").run(text);
        const player = db.prepare('SELECT * FROM players WHERE id = ?').get(result.lastInsertRowid);
        clear(chatId);
        bot.sendMessage(chatId, `✅ Player *${player.name}* added! Use /log to log a game.`, { parse_mode: 'Markdown' });
      } catch (err) {
        bot.sendMessage(chatId, `❌ ${err.message}`);
      }
      return;
    }

    // Add player inline during /log flow
    if (s.step === 'addplayer_inline') {
      if (!text) return bot.sendMessage(chatId, "Name can't be empty.");
      const existing = db.prepare('SELECT id FROM players WHERE LOWER(name) = LOWER(?)').get(text);
      if (existing) return bot.sendMessage(chatId, `❌ A player named "${text}" already exists.`);
      try {
        const result = db.prepare("INSERT INTO players (name, color) VALUES (?, '#6b7280')").run(text);
        const player = db.prepare('SELECT * FROM players WHERE id = ?').get(result.lastInsertRowid);
        s.players = allPlayers();
        s.step = s.addingForStep;
        const seatIdx = parseInt(s.step.slice(5));
        const taken = s.seats.map(x => x.player_id);
        bot.sendMessage(chatId, `✅ *${player.name}* added!\n\n👤 *Select ${SEATS[seatIdx].label} player:*`, {
          parse_mode: 'Markdown',
          reply_markup: playerKeyboard(s.players, taken),
        });
      } catch (err) {
        bot.sendMessage(chatId, `❌ ${err.message}`);
      }
      return;
    }

    // Min tai
    if (s.step === 'min_tai') {
      const n = parseInt(text);
      if (isNaN(n) || n < 0) return bot.sendMessage(chatId, 'Enter a valid number (0 or more).');
      s.minTai = n;
      s.step = 'max_tai';
      return bot.sendMessage(chatId, 'Enter *max tai* (e.g. 5):', { parse_mode: 'Markdown' });
    }

    // Max tai
    if (s.step === 'max_tai') {
      const n = parseInt(text);
      if (isNaN(n) || n < 1) return bot.sendMessage(chatId, 'Enter a valid number (1 or more).');
      s.maxTai = n;
      s.step = 'winds';
      return bot.sendMessage(chatId, '💨 *How many winds?*', {
        parse_mode: 'Markdown',
        reply_markup: windsKeyboard(),
      });
    }

    // Custom winds
    if (s.step === 'winds_custom') {
      const n = parseInt(text);
      if (isNaN(n) || n < 1) return bot.sendMessage(chatId, 'Enter a valid number (e.g. 6).');
      s.rounds = n;
      s.seats = [];
      s.step = 'seat_0';
      return bot.sendMessage(chatId, `👤 *Select ${SEATS[0].label} player:*`, {
        parse_mode: 'Markdown',
        reply_markup: playerKeyboard(s.players, []),
      });
    }

    // Base chips
    if (s.step === 'base_chips') {
      const n = parseInt(text);
      if (isNaN(n) || n <= 0) return bot.sendMessage(chatId, 'Enter a valid number (e.g. 500).');
      s.baseChips = n;
      s.step = 'chips_0';
      return bot.sendMessage(chatId,
        `💰 Final chips for *${s.seats[0].name}* (${SEATS[0].label})?\n\nStarted with ${n}. Enter how many they ended with.`,
        { parse_mode: 'Markdown' }
      );
    }

    // Chips entry (final counts → stored as net)
    if (s.step?.startsWith('chips_')) {
      const finalCount = parseInt(text);
      if (isNaN(finalCount) || finalCount < 0) return bot.sendMessage(chatId, 'Enter a valid chip count (e.g. 450 or 550).');
      const idx = s.chipIdx;
      s.seats[idx].chips = finalCount - s.baseChips;
      s.chipIdx++;

      if (s.chipIdx < 3) {
        s.step = `chips_${s.chipIdx}`;
        return bot.sendMessage(chatId,
          `💰 Final chips for *${s.seats[s.chipIdx].name}* (${SEATS[s.chipIdx].label})?\n\nStarted with ${s.baseChips}.`,
          { parse_mode: 'Markdown' }
        );
      }
      const netSum = s.seats.slice(0, 3).reduce((a, b) => a + b.chips, 0);
      s.seats[3].chips = -netSum;
      const finalFour = s.seats[3].chips + s.baseChips;
      s.step = 'notes';
      return bot.sendMessage(chatId,
        `_${s.seats[3].name} (${SEATS[3].label}) auto-calculated: ${finalFour} chips (net ${s.seats[3].chips >= 0 ? '+' : ''}${s.seats[3].chips})_\n\n📝 Any notes for this session? (type a note or tap Skip)`,
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: 'Skip →', callback_data: 'notes:skip' }]] },
        }
      );
    }

    // Notes
    if (s.step === 'notes') {
      s.notes = text;
      s.step = 'confirm';
      return bot.sendMessage(chatId, summaryText(s) + '\n\nLog this game?', {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
          [{ text: '✅ Confirm', callback_data: 'confirm' }, { text: '❌ Cancel', callback_data: 'cancel_log' }],
        ]},
      });
    }

    if (!s.step) {
      bot.sendMessage(chatId, 'Use /log to log a game, /standings for rankings, or /help for all commands.');
    }
  });

  return {
    updateRankTitles: rankUpdater,
    postGameBroadcast: broadcaster,
    announceDethrone: dethroner,
    announceMilestones: (seatedIds, unlocks) => announceMilestones(bot, seatedIds, unlocks),
  };
};
