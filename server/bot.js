const TelegramBot = require('node-telegram-bot-api');
const db = require('./db');
const elo = require('./elo');

const TOKEN = process.env.TELEGRAM_TOKEN;
if (!TOKEN) throw new Error('TELEGRAM_TOKEN env var is required');
const GROUP_CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID
  ? Number(process.env.TELEGRAM_GROUP_CHAT_ID)
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

  db.transaction(() => {
    const result = db.prepare(
      'INSERT INTO games (date, modes, rounds, min_tai, max_tai, pool_key, base_chips, duration_minutes, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(s.date, JSON.stringify(modes), s.rounds, minTai, maxTai, poolKey, s.baseChips || null, null, s.notes || null);
    const gameId = result.lastInsertRowid;
    const seatStmt = db.prepare('INSERT INTO game_seats (game_id, player_id, seat, chips) VALUES (?, ?, ?, ?)');
    for (const seat of s.seats) seatStmt.run(gameId, seat.player_id, seat.seat, seat.chips);
    const trStmt = db.prepare('INSERT INTO transfers (game_id, from_player_id, to_player_id, amount) VALUES (?, ?, ?, ?)');
    for (const t of deriveTransfers(s.seats)) trStmt.run(gameId, t.from_player_id, t.to_player_id, t.amount);
  })();

  recomputePool(poolKey);
  return s.seats.map(seat => seat.player_id);
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

// ── Rank title updater ────────────────────────────────────────────────────────
// Called after any game is logged (bot or web). For each player that has a linked
// Telegram user ID, updates their admin custom title in the group chat.
async function updateRankTitles(bot, playerIds) {
  if (!GROUP_CHAT_ID || !playerIds || !playerIds.length) return;
  for (const pid of playerIds) {
    const player = db.prepare('SELECT telegram_user_id FROM players WHERE id = ?').get(pid);
    if (!player?.telegram_user_id) continue;
    const eloRow = db.prepare(
      'SELECT MAX(rating) AS rating FROM elo_current WHERE player_id = ?'
    ).get(pid);
    if (!eloRow?.rating) continue;
    const title = getRank(Math.round(eloRow.rating));
    try {
      await bot.setChatAdministratorCustomTitle(GROUP_CHAT_ID, player.telegram_user_id, title);
    } catch {
      // silently skip — player not admin, or not in group
    }
  }
}

// ── Weekly leaderboard ────────────────────────────────────────────────────────
// Fires every Monday at 9am SGT (1am UTC). Posts top 10 for every pool.
function buildWeeklyMessage() {
  const pools = db.prepare(
    'SELECT DISTINCT pool_key FROM elo_current ORDER BY pool_key'
  ).all().map(r => r.pool_key);

  if (!pools.length) return null;

  const now = new Date(Date.now() + 8 * 3600 * 1000);
  const dateStr = now.toISOString().slice(0, 10);
  const lines = [`🏆 *Weekly Standings — ${dateStr}*\n`];

  for (const pk of pools) {
    const rows = db.prepare(`
      SELECT p.name, ec.rating, ec.last_delta, ec.games_played
      FROM elo_current ec JOIN players p ON p.id = ec.player_id
      WHERE ec.pool_key = ? ORDER BY ec.rating DESC LIMIT 10
    `).all(pk);
    if (!rows.length) continue;

    lines.push(`*${elo.poolLabel(pk)}*`);
    rows.forEach((r, i) => {
      const rating = Math.round(r.rating);
      const delta = r.last_delta != null
        ? (r.last_delta >= 0 ? ` _(+${Math.round(r.last_delta)})_` : ` _(${Math.round(r.last_delta)})_`)
        : '';
      lines.push(`${i + 1}. ${r.name} — *${rating}*${delta}  ${getRank(rating)}`);
    });
    lines.push('');
  }

  return lines.join('\n');
}

function startWeeklyCron(bot) {
  if (!GROUP_CHAT_ID) return;
  let lastFiredWeek = -1;

  // Check every minute; fire on Monday 1am UTC = 9am SGT
  setInterval(() => {
    const now = new Date();
    if (now.getUTCDay() !== 1 || now.getUTCHours() !== 1) return;
    const week = Math.floor(now.getTime() / (7 * 24 * 3600 * 1000));
    if (lastFiredWeek === week) return;
    lastFiredWeek = week;
    const msg = buildWeeklyMessage();
    if (msg) bot.sendMessage(GROUP_CHAT_ID, msg, { parse_mode: 'Markdown' }).catch(console.error);
  }, 60 * 1000);
}

// ── Bot ───────────────────────────────────────────────────────────────────────
module.exports = function startBot({ recomputePool }) {
  const bot = new TelegramBot(TOKEN, { polling: true });
  console.log('Telegram bot started (polling)');

  // Expose so index.js can call after web-logged games too
  const rankUpdater = (playerIds) => updateRankTitles(bot, playerIds);

  startWeeklyCron(bot);

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
      '🀄 *Mahjong Tracker Bot*\n\n' +
      '/log — log a game\n' +
      '/standings — leaderboard\n' +
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
    const rankStr = eloRow?.rating ? ` Current rank: *${getRank(Math.round(eloRow.rating))}*` : '';
    bot.sendMessage(msg.chat.id, `✅ Linked to *${player.name}*!${rankStr}\n\nYour admin title will update automatically after each game.`, { parse_mode: 'Markdown' });
    rankUpdater([player.id]);
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
      SELECT p.name, ec.rating, ec.last_delta, ec.games_played
      FROM elo_current ec JOIN players p ON p.id = ec.player_id
      WHERE ec.pool_key = ? ORDER BY ec.rating DESC
    `).all(poolKey);

    if (!rows.length) return bot.sendMessage(chatId, 'No ratings in this pool yet.');

    const lines = [`🏆 *${elo.poolLabel(poolKey)}*\n`];
    rows.forEach((r, i) => {
      const rating = Math.round(r.rating);
      const delta = r.last_delta != null
        ? (r.last_delta >= 0 ? ` _(+${Math.round(r.last_delta)})_` : ` _(${Math.round(r.last_delta)})_`)
        : '';
      lines.push(`${i + 1}. ${r.name} — *${rating}*${delta}`);
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
        const playerIds = insertGame(s, recomputePool);
        bot.editMessageText('✅ Game logged!', { chat_id: chatId, message_id: msgId });
        clear(chatId);
        rankUpdater(playerIds);
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

  return { updateRankTitles: rankUpdater };
};
