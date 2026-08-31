const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const elo = require('./elo');

const app = express();
const PORT = process.env.PORT || 3333;

app.use(cors());
app.use(express.json({ limit: '10mb' })); // generous limit so restore uploads fit

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Greedy settlement: match each loser's debt to winners in turn. Always produces
// integer transfers that reconcile exactly (total losses === total wins).
function deriveTransfers(seats) {
  const winners = seats.filter(s => s.chips > 0).map(s => ({ id: s.player_id, remaining: s.chips }));
  const losers = seats.filter(s => s.chips < 0).map(s => ({ id: s.player_id, remaining: -s.chips }));
  const transfers = [];
  let wi = 0;
  for (const l of losers) {
    while (l.remaining > 0 && wi < winners.length) {
      const w = winners[wi];
      const amt = Math.min(l.remaining, w.remaining);
      if (amt > 0) transfers.push({ from_player_id: l.id, to_player_id: w.id, amount: amt });
      l.remaining -= amt;
      w.remaining -= amt;
      if (w.remaining === 0) wi += 1;
    }
  }
  return transfers;
}

function parseModes(raw) {
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [raw];
  } catch {
    return raw ? [raw] : [];
  }
}

// Pool key for a stored game row (whose `modes` is the raw JSON string).
function poolKeyForRow(row) {
  return elo.poolKey(parseModes(row.modes), row.min_tai, row.max_tai);
}

// Strict pool scoping — a mode-SET + tai bounds is its own universe (the central
// invariant). ?pool= omitted / 'all' → null → the SQL clause is a no-op, but the
// UI always sends a concrete pool; stats NEVER merge across pools.
function poolParam(req) {
  const p = req.query.pool;
  return p && p !== 'all' ? String(p) : null;
}
const POOL_SQL = `g.deleted_at IS NULL AND (@pool IS NULL OR g.pool_key = @pool)`;

// Validate + normalize a game payload (shared by create and update). Returns
// { error } on failure or { data } with everything ready to persist.
function prepareGame(body) {
  const { date, modes, rounds, min_tai, max_tai, base_chips, duration_minutes, notes, seats, transfers } = body;

  if (!date || !seats || seats.length !== 4) {
    return { error: 'date and exactly 4 seats required' };
  }
  if (!Array.isArray(modes) || modes.length === 0) {
    return { error: 'at least one mode required' };
  }
  if (new Set(seats.map(s => s.player_id)).size !== 4) {
    return { error: 'all 4 players must be distinct' };
  }

  const normSeats = seats.map(s => ({ ...s, chips: parseInt(s.chips) || 0 }));
  if (normSeats.reduce((sum, s) => sum + s.chips, 0) !== 0) {
    return { error: 'Chips must sum to 0' };
  }

  const finalTransfers = Array.isArray(transfers) && transfers.length
    ? transfers.map(t => ({
        from_player_id: t.from_player_id, to_player_id: t.to_player_id, amount: parseInt(t.amount) || 0,
      })).filter(t => t.amount > 0)
    : deriveTransfers(normSeats);

  const minTai = min_tai ?? 0;
  const maxTai = max_tai ?? 5;

  return {
    data: {
      date,
      modes,
      numRounds: Math.max(1, parseInt(rounds) || 4),
      min_tai: minTai,
      max_tai: maxTai,
      pool_key: elo.poolKey(modes, minTai, maxTai),
      base_chips: base_chips != null ? parseInt(base_chips) : null,
      duration_minutes: duration_minutes || null,
      notes: notes || null,
      normSeats,
      finalTransfers,
    },
  };
}

// Write a game's seats + transfer ledger. Caller is responsible for the games
// row itself and for wrapping this in a transaction.
function writeSeatsTransfers(gameId, data) {
  const seatStmt = db.prepare('INSERT INTO game_seats (game_id, player_id, seat, chips) VALUES (?, ?, ?, ?)');
  for (const s of data.normSeats) seatStmt.run(gameId, s.player_id, s.seat, s.chips);
  const trStmt = db.prepare('INSERT INTO transfers (game_id, from_player_id, to_player_id, amount) VALUES (?, ?, ?, ?)');
  for (const t of data.finalTransfers) trStmt.run(gameId, t.from_player_id, t.to_player_id, t.amount);
}

// ─── ELO recompute engine ─────────────────────────────────────────────────────
// Ratings are DERIVED — any game create/edit/delete triggers a full replay of
// the affected pool(s). See docs/ELO-AND-STATS-DESIGN.md §4.

function loadEloConfig() {
  const cfg = {};
  for (const r of db.prepare('SELECT key, value FROM elo_config').all()) cfg[r.key] = r.value;
  return cfg;
}

const _gamesMetaStmt = db.prepare(
  'SELECT id, date, created_at, modes, min_tai, max_tai, rounds, pool_key FROM games WHERE deleted_at IS NULL ORDER BY date ASC, created_at ASC, id ASC'
);
const _seatsForGame = db.prepare('SELECT player_id, seat, chips FROM game_seats WHERE game_id = ?');
const _transfersForGame = db.prepare('SELECT from_player_id, to_player_id, amount FROM transfers WHERE game_id = ?');

// All games in a pool, in stable timeline order, shaped for the ELO engine.
function loadPoolGames(poolKey) {
  return _gamesMetaStmt.all()
    .filter(g => (g.pool_key || poolKeyForRow(g)) === poolKey)
    .map(g => ({
      id: g.id,
      winds: g.rounds,
      seats: _seatsForGame.all(g.id),
      transfers: _transfersForGame.all(g.id),
    }));
}

const _delCurrent = db.prepare('DELETE FROM elo_current WHERE pool_key = ?');
const _delHistory = db.prepare('DELETE FROM elo_history WHERE pool_key = ?');
const _insCurrent = db.prepare(
  'INSERT INTO elo_current (pool_key, player_id, rating, games_played, peak_rating, last_delta) VALUES (?, ?, ?, ?, ?, ?)'
);
const _insHistory = db.prepare(
  'INSERT INTO elo_history (game_id, pool_key, player_id, seq, rating_before, rating_after, delta, chips, winds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
);

// Replace a pool's derived rating rows in one transaction.
const recomputePool = db.transaction((poolKey) => {
  const cfg = loadEloConfig();
  const { current, history } = elo.computePoolTimeline(loadPoolGames(poolKey), cfg);
  _delCurrent.run(poolKey);
  _delHistory.run(poolKey);
  for (const c of current) {
    _insCurrent.run(poolKey, c.player_id, c.rating, c.games_played, c.peak_rating, c.last_delta);
  }
  for (const h of history) {
    _insHistory.run(h.game_id, poolKey, h.player_id, h.seq, h.rating_before, h.rating_after, h.delta, h.chips, h.winds);
  }
});

function allPoolKeys() {
  const set = new Set();
  for (const g of _gamesMetaStmt.all()) set.add(g.pool_key || poolKeyForRow(g));
  return [...set];
}

// Self-heal games.pool_key for any row that is missing or stale (e.g. after a
// schema migration or a hand-edited DB). Cheap, idempotent, runs at startup.
const _setPoolKey = db.prepare('UPDATE games SET pool_key = ? WHERE id = ?');
const backfillPoolKeys = db.transaction(() => {
  for (const g of _gamesMetaStmt.all()) {
    const want = poolKeyForRow(g);
    if (g.pool_key !== want) _setPoolKey.run(want, g.id);
  }
});

// Full backfill — recompute every pool from scratch (idempotent). Run at startup
// so existing games get rated and config changes (e.g. chip_scale) take effect.
function recomputeAllPools() {
  for (const key of allPoolKeys()) recomputePool(key);
}

// ─── Players ────────────────────────────────────────────────────────────────

app.get('/api/players', (req, res) => {
  try {
    res.json(db.prepare('SELECT * FROM players ORDER BY name').all());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/players', (req, res) => {
  try {
    const { name, color } = req.body;
    if (!name || !color) return res.status(400).json({ error: 'name and color required' });
    const result = db.prepare('INSERT INTO players (name, color) VALUES (?, ?)').run(name, color);
    res.json(db.prepare('SELECT * FROM players WHERE id = ?').get(result.lastInsertRowid));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/players/:id', (req, res) => {
  try {
    const { name, color } = req.body;
    db.prepare('UPDATE players SET name = ?, color = ? WHERE id = ?').run(name, color, req.params.id);
    const player = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id);
    if (!player) return res.status(404).json({ error: 'Player not found' });
    res.json(player);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/players/:id', (req, res) => {
  try {
    const result = db.prepare('DELETE FROM players WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Player not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Pools (the global universe switcher) ─────────────────────────────────────

// Distinct rating universes (mode-set + tai), with game + player counts. This
// replaces the retired loose per-mode filter — a game belongs to exactly ONE
// pool (its sorted mode-set + tai), never counted under each mode separately.
app.get('/api/pools', (_req, res) => {
  try {
    const gameCounts = {};
    for (const g of _gamesMetaStmt.all()) {
      const k = g.pool_key || poolKeyForRow(g);
      gameCounts[k] = (gameCounts[k] || 0) + 1;
    }
    const playerCounts = {};
    for (const r of db.prepare('SELECT pool_key, COUNT(*) AS n FROM elo_current GROUP BY pool_key').all()) {
      playerCounts[r.pool_key] = r.n;
    }
    const pools = Object.keys(gameCounts)
      .map(k => ({ pool_key: k, label: elo.poolLabel(k), games: gameCounts[k], players: playerCounts[k] || 0 }))
      .sort((a, b) => b.games - a.games || a.label.localeCompare(b.label));
    res.json(pools);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Games ───────────────────────────────────────────────────────────────────

app.get('/api/games', (req, res) => {
  try {
    const pool = poolParam(req);
    const games = db.prepare(`
      SELECT
        g.id, g.date, g.modes, g.rounds, g.min_tai, g.max_tai, g.pool_key, g.duration_minutes, g.notes, g.created_at,
        json_group_array(json_object(
          'id', gs.id, 'player_id', gs.player_id, 'player_name', p.name,
          'player_color', p.color, 'seat', gs.seat, 'chips', gs.chips
        )) as seats
      FROM games g
      JOIN game_seats gs ON gs.game_id = g.id
      JOIN players p ON p.id = gs.player_id
      WHERE ${POOL_SQL}
      GROUP BY g.id
      ORDER BY g.date DESC, g.created_at DESC
    `).all({ pool });

    const transferStmt = db.prepare(`
      SELECT t.from_player_id, t.to_player_id, t.amount, pf.name as from_name, pt.name as to_name
      FROM transfers t
      JOIN players pf ON pf.id = t.from_player_id
      JOIN players pt ON pt.id = t.to_player_id
      WHERE t.game_id = ?
    `);
    const eloStmt = db.prepare('SELECT player_id, delta, rating_after FROM elo_history WHERE game_id = ?');

    res.json(games.map(g => {
      const seats = JSON.parse(g.seats);
      const eloBy = {};
      for (const e of eloStmt.all(g.id)) eloBy[e.player_id] = e;
      for (const s of seats) {
        const e = eloBy[s.player_id];
        s.elo_delta = e ? Math.round(e.delta) : null;
        s.elo_after = e ? Math.round(e.rating_after) : null;
      }
      return { ...g, modes: parseModes(g.modes), seats, transfers: transferStmt.all(g.id) };
    }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/games', (req, res) => {
  try {
    const { error, data } = prepareGame(req.body);
    if (error) return res.status(400).json({ error });

    const insertGame = db.transaction(() => {
      const result = db.prepare(
        'INSERT INTO games (date, modes, rounds, min_tai, max_tai, pool_key, base_chips, duration_minutes, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(data.date, JSON.stringify(data.modes), data.numRounds, data.min_tai, data.max_tai, data.pool_key, data.base_chips, data.duration_minutes, data.notes);
      const gameId = result.lastInsertRowid;
      writeSeatsTransfers(gameId, data);
      return gameId;
    });

    const gameId = insertGame();
    recomputePool(data.pool_key);
    const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
    res.json({ ...game, modes: parseModes(game.modes) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Batch create — one real-life sitting split into segments, each its own ruleset
// (e.g. 3 winds guo_san+8_fei then 2 winds vanilla). Each segment is a separate
// game in its own pool (the mode-set invariant); they're just entered together.
// All-or-nothing: validate every segment, insert in one transaction, then
// recompute each affected pool once.
app.post('/api/games/batch', (req, res) => {
  try {
    const list = req.body && req.body.games;
    if (!Array.isArray(list) || list.length === 0) {
      return res.status(400).json({ error: 'games array required' });
    }
    const prepared = [];
    for (let i = 0; i < list.length; i++) {
      const { error, data } = prepareGame(list[i]);
      if (error) return res.status(400).json({ error: `Segment ${i + 1}: ${error}` });
      prepared.push(data);
    }

    const insertAll = db.transaction(() => {
      const stmt = db.prepare(
        'INSERT INTO games (date, modes, rounds, min_tai, max_tai, pool_key, base_chips, duration_minutes, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      );
      const ids = [];
      for (const data of prepared) {
        const result = stmt.run(data.date, JSON.stringify(data.modes), data.numRounds, data.min_tai, data.max_tai, data.pool_key, data.base_chips, data.duration_minutes, data.notes);
        writeSeatsTransfers(result.lastInsertRowid, data);
        ids.push(result.lastInsertRowid);
      }
      return ids;
    });

    const ids = insertAll();
    for (const pk of [...new Set(prepared.map(d => d.pool_key))]) recomputePool(pk);
    res.json({ ids, count: ids.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Single game with its seats + transfer ledger — used to prefill the edit form.
app.get('/api/games/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const g = db.prepare('SELECT * FROM games WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!g) return res.status(404).json({ error: 'Game not found' });

    const seats = db.prepare(`
      SELECT gs.id, gs.player_id, p.name as player_name, p.color as player_color, gs.seat, gs.chips
      FROM game_seats gs JOIN players p ON p.id = gs.player_id
      WHERE gs.game_id = ?
    `).all(id);

    const transfers = db.prepare(`
      SELECT t.from_player_id, t.to_player_id, t.amount, pf.name as from_name, pt.name as to_name
      FROM transfers t
      JOIN players pf ON pf.id = t.from_player_id
      JOIN players pt ON pt.id = t.to_player_id
      WHERE t.game_id = ?
    `).all(id);

    res.json({ ...g, modes: parseModes(g.modes), seats, transfers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/games/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT id, modes, min_tai, max_tai, pool_key FROM games WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!existing) return res.status(404).json({ error: 'Game not found' });

    const { error, data } = prepareGame(req.body);
    if (error) return res.status(400).json({ error });

    const oldPool = existing.pool_key || poolKeyForRow(existing);
    const newPool = data.pool_key;

    const updateGame = db.transaction(() => {
      db.prepare(
        'UPDATE games SET date = ?, modes = ?, rounds = ?, min_tai = ?, max_tai = ?, pool_key = ?, base_chips = ?, duration_minutes = ?, notes = ? WHERE id = ?'
      ).run(data.date, JSON.stringify(data.modes), data.numRounds, data.min_tai, data.max_tai, data.pool_key, data.base_chips, data.duration_minutes, data.notes, id);
      // Replace seats + transfers wholesale — simpler and always consistent.
      db.prepare('DELETE FROM game_seats WHERE game_id = ?').run(id);
      db.prepare('DELETE FROM transfers WHERE game_id = ?').run(id);
      writeSeatsTransfers(id, data);
    });

    updateGame();
    // A mode-set / tai edit moves the game between pools — recompute both.
    // Order matters: recompute the OLD pool FIRST so its DELETE clears this
    // game's stale elo_history rows (PK is game_id+player_id) before the new
    // pool tries to insert them, and so the old pool's standings are cleared.
    if (oldPool !== newPool) recomputePool(oldPool);
    recomputePool(newPool);
    const game = db.prepare('SELECT * FROM games WHERE id = ?').get(id);
    res.json({ ...game, modes: parseModes(game.modes) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/games/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT modes, min_tai, max_tai, pool_key FROM games WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Game not found' });
    db.prepare("UPDATE games SET deleted_at = datetime('now') WHERE id = ?").run(req.params.id);
    // Replay the pool so ratings reflect the removal (elo_history rows for this
    // game are excluded because _gamesMetaStmt filters deleted_at IS NULL).
    recomputePool(row.pool_key || poolKeyForRow(row));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Stats (STRICTLY per pool via @pool) ──────────────────────────────────────

app.get('/api/stats/leaderboard', (req, res) => {
  try {
    const pool = poolParam(req);
    const rows = db.prepare(`
      SELECT
        p.id, p.name, p.color,
        COUNT(DISTINCT gs.game_id) as games_played,
        COALESCE(SUM(gs.chips), 0) as total_chips,
        COALESCE(SUM(g.rounds), 0) as total_winds,
        SUM(CASE WHEN gs.chips > 0 THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN gs.chips < 0 THEN 1 ELSE 0 END) as losses,
        ROUND(AVG(gs.chips), 2) as avg_chips
      FROM players p
      JOIN game_seats gs ON gs.player_id = p.id
      JOIN games g ON g.id = gs.game_id
      WHERE ${POOL_SQL}
      GROUP BY p.id
      ORDER BY total_chips DESC
    `).all({ pool });
    // Chips per wind — the great equalizer across sessions of different length.
    for (const r of rows) {
      r.chips_per_wind = r.total_winds ? +(r.total_chips / r.total_winds).toFixed(2) : 0;
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats/player/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const pool = poolParam(req);
    const player = db.prepare('SELECT id, name, color FROM players WHERE id = ?').get(id);
    if (!player) return res.status(404).json({ error: 'Player not found' });

    const agg = db.prepare(`
      SELECT
        COUNT(DISTINCT gs.game_id) as games_played,
        COALESCE(SUM(gs.chips), 0) as total_chips,
        COALESCE(SUM(g.rounds), 0) as total_winds,
        SUM(CASE WHEN gs.chips > 0 THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN gs.chips < 0 THEN 1 ELSE 0 END) as losses,
        MAX(gs.chips) as best_game,
        MIN(gs.chips) as worst_game,
        ROUND(AVG(gs.chips), 2) as avg_chips,
        ROUND(AVG(g.duration_minutes), 0) as avg_duration,
        SUM(CASE WHEN g.duration_minutes IS NOT NULL THEN 1 ELSE 0 END) as timed_games
      FROM game_seats gs
      JOIN games g ON g.id = gs.game_id
      WHERE gs.player_id = @id AND ${POOL_SQL}
    `).get({ id, pool });
    agg.chips_per_wind = agg.total_winds ? +(agg.total_chips / agg.total_winds).toFixed(2) : 0;

    // Which pools (universes) this player has played, and how they do in each —
    // a cross-pool overview (this is the ONLY place we look across pools, and it
    // never merges their numbers).
    const poolRows = db.prepare(`
      SELECT g.pool_key, gs.chips
      FROM game_seats gs JOIN games g ON g.id = gs.game_id
      WHERE gs.player_id = ?
    `).all(id);
    const poolAgg = {};
    for (const row of poolRows) {
      const k = row.pool_key;
      if (!poolAgg[k]) poolAgg[k] = { pool_key: k, label: elo.poolLabel(k), games: 0, wins: 0, losses: 0, total_chips: 0 };
      const a = poolAgg[k];
      a.games += 1;
      a.total_chips += row.chips;
      if (row.chips > 0) a.wins += 1;
      else if (row.chips < 0) a.losses += 1;
    }
    const byPool = Object.values(poolAgg)
      .map(m => ({ ...m, win_rate: m.games ? +((m.wins / m.games) * 100).toFixed(1) : 0 }))
      .sort((a, b) => b.games - a.games);

    // Cumulative chip history within the selected pool, baseline 0 first.
    const history = db.prepare(`
      SELECT g.date, g.id, gs.chips
      FROM game_seats gs JOIN games g ON g.id = gs.game_id
      WHERE gs.player_id = @id AND ${POOL_SQL}
      ORDER BY g.date ASC, g.created_at ASC
    `).all({ id, pool });
    let cumulative = 0;
    const cumulativeHistory = [{ date: 'Start', label: 'Start', chips: 0, cumulative: 0 }];
    history.forEach((row, i) => {
      cumulative += row.chips;
      cumulativeHistory.push({ date: row.date, label: `${row.date}`, seq: i + 1, chips: row.chips, cumulative });
    });

    // Opponents within the selected pool, pairwise chips from the ledger.
    const opponents = db.prepare(`
      SELECT p.id, p.name, p.color, COUNT(DISTINCT gs.game_id) as games_together
      FROM game_seats gs_me
      JOIN games g ON g.id = gs_me.game_id
      JOIN game_seats gs ON gs.game_id = gs_me.game_id AND gs.player_id != @id
      JOIN players p ON p.id = gs.player_id
      WHERE gs_me.player_id = @id AND ${POOL_SQL}
      GROUP BY p.id
      ORDER BY games_together DESC
    `).all({ id, pool });

    const flowStmt = db.prepare(`
      SELECT COALESCE(SUM(t.amount), 0) as s
      FROM transfers t JOIN games g ON g.id = t.game_id
      WHERE t.from_player_id = @from AND t.to_player_id = @to AND ${POOL_SQL}
    `);
    for (const opp of opponents) {
      const paid = flowStmt.get({ from: id, to: opp.id, pool }).s;
      const received = flowStmt.get({ from: opp.id, to: id, pool }).s;
      opp.my_chips = received - paid;
    }

    res.json({ ...player, ...agg, byPool, cumulativeHistory, opponents });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats/h2h/:id1/:id2', (req, res) => {
  try {
    const id1 = Number(req.params.id1);
    const id2 = Number(req.params.id2);
    const pool = poolParam(req);

    const games = db.prepare(`
      SELECT g.id, g.date, g.modes, g.min_tai, g.max_tai, g.pool_key,
        json_group_array(json_object(
          'player_id', gs.player_id, 'player_name', p.name,
          'player_color', p.color, 'seat', gs.seat, 'chips', gs.chips
        )) as seats
      FROM games g
      JOIN game_seats gs ON gs.game_id = g.id
      JOIN players p ON p.id = gs.player_id
      WHERE ${POOL_SQL} AND g.id IN (
        SELECT gs1.game_id FROM game_seats gs1
        JOIN game_seats gs2 ON gs2.game_id = gs1.game_id
        WHERE gs1.player_id = @id1 AND gs2.player_id = @id2
      )
      GROUP BY g.id
      ORDER BY g.date DESC
    `).all({ id1, id2, pool });

    const flowStmt = db.prepare(`SELECT COALESCE(SUM(amount),0) as s FROM transfers WHERE game_id = ? AND from_player_id = ? AND to_player_id = ?`);
    let p1Net = 0;
    const parsed = games.map(g => {
      const p1toP2 = flowStmt.get(g.id, id1, id2).s;
      const p2toP1 = flowStmt.get(g.id, id2, id1).s;
      const p1vsP2 = p2toP1 - p1toP2;
      p1Net += p1vsP2;
      return { ...g, modes: parseModes(g.modes), seats: JSON.parse(g.seats), p1vsP2 };
    });

    res.json({
      games: parsed,
      p1Chips: p1Net,
      p2Chips: -p1Net,
      p1Wins: parsed.filter(g => g.p1vsP2 > 0).length,
      p2Wins: parsed.filter(g => g.p1vsP2 < 0).length,
      gamesCount: parsed.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats/history', (req, res) => {
  try {
    const pool = poolParam(req);
    const players = db.prepare('SELECT * FROM players ORDER BY name').all();

    const allSeats = db.prepare(`
      SELECT gs.player_id, g.date, gs.chips
      FROM game_seats gs JOIN games g ON g.id = gs.game_id
      WHERE ${POOL_SQL}
      ORDER BY g.date ASC, g.created_at ASC, g.id ASC
    `).all({ pool });

    const dateMap = {};
    const cumulative = {};
    for (const p of players) cumulative[p.id] = 0;
    for (const row of allSeats) {
      cumulative[row.player_id] = (cumulative[row.player_id] || 0) + row.chips;
      if (!dateMap[row.date]) dateMap[row.date] = {};
      dateMap[row.date][row.player_id] = cumulative[row.player_id];
    }

    const dates = Object.keys(dateMap).sort();
    const baseline = { date: 'Start' };
    for (const p of players) baseline[p.id] = 0;
    const result = [baseline];
    const running = {};
    for (const p of players) running[p.id] = 0;
    for (const date of dates) {
      const point = { date };
      for (const p of players) {
        if (dateMap[date][p.id] !== undefined) running[p.id] = dateMap[date][p.id];
        point[p.id] = running[p.id];
      }
      result.push(point);
    }

    res.json({ players, history: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ELO ratings (all derived / read-only) ────────────────────────────────────

// Per-pool leaderboard, ranked by rating. Chip stats come from the pool's own
// history rows (per-wind normalized).
app.get('/api/elo/leaderboard', (req, res) => {
  try {
    const pool = req.query.pool;
    if (!pool || pool === 'all') return res.status(400).json({ error: 'pool query param required' });
    const rows = db.prepare(`
      SELECT ec.player_id, p.name, p.color, ec.rating, ec.peak_rating, ec.games_played, ec.last_delta,
        COALESCE(SUM(eh.chips), 0) AS total_chips,
        COALESCE(SUM(eh.winds), 0) AS total_winds,
        SUM(CASE WHEN eh.chips > 0 THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN eh.chips < 0 THEN 1 ELSE 0 END) AS losses
      FROM elo_current ec
      JOIN players p ON p.id = ec.player_id
      LEFT JOIN elo_history eh ON eh.player_id = ec.player_id AND eh.pool_key = ec.pool_key
      WHERE ec.pool_key = @pool
      GROUP BY ec.player_id
      ORDER BY ec.rating DESC
    `).all({ pool });
    for (const r of rows) {
      // Ratings + deltas are shown as integers (chess.com style). Full precision
      // stays in the DB so replay/conservation is exact; we only round on the way out.
      r.rating = Math.round(r.rating);
      r.peak_rating = Math.round(r.peak_rating);
      r.last_delta = Math.round(r.last_delta);
      r.chips_per_wind = r.total_winds ? +(r.total_chips / r.total_winds).toFixed(2) : 0;
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// One player's standing + Elo-over-time timeline within a pool.
app.get('/api/elo/player/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const pool = req.query.pool;
    const player = db.prepare('SELECT id, name, color FROM players WHERE id = ?').get(id);
    if (!player) return res.status(404).json({ error: 'Player not found' });
    if (!pool || pool === 'all') return res.status(400).json({ error: 'pool query param required' });

    const cur = db.prepare(
      'SELECT rating, peak_rating, games_played, last_delta FROM elo_current WHERE pool_key = ? AND player_id = ?'
    ).get(pool, id);

    const ranked = db.prepare(
      'SELECT player_id FROM elo_current WHERE pool_key = ? ORDER BY rating DESC'
    ).all(pool);
    const rank = ranked.findIndex(r => r.player_id === id) + 1; // 0 → not in pool

    const timeline = db.prepare(`
      SELECT eh.seq, eh.game_id, g.date, eh.rating_before, eh.rating_after, eh.delta, eh.chips, eh.winds
      FROM elo_history eh JOIN games g ON g.id = eh.game_id
      WHERE eh.pool_key = @pool AND eh.player_id = @id
      ORDER BY eh.seq ASC
    `).all({ pool, id }).map(t => ({
      ...t,
      rating_before: Math.round(t.rating_before),
      rating_after: Math.round(t.rating_after),
      delta: Math.round(t.delta),
    }));

    res.json({
      player,
      pool_key: pool,
      rating: cur ? Math.round(cur.rating) : null,
      peak_rating: cur ? Math.round(cur.peak_rating) : null,
      games_played: cur ? cur.games_played : 0,
      last_delta: cur ? Math.round(cur.last_delta) : null,
      rank: rank || null,
      pool_players: ranked.length,
      timeline,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Backup / restore (off-machine safety net) ────────────────────────────────

// Full portable snapshot of the log (the source of truth — ratings replay from
// it, so they are NOT exported). Original ids are preserved so references hold.
app.get('/api/backup', (_req, res) => {
  try {
    const players = db.prepare('SELECT id, name, color, created_at FROM players ORDER BY id').all();
    const gameRows = db.prepare('SELECT * FROM games ORDER BY id').all();
    const games = gameRows.map(g => ({
      id: g.id,
      date: g.date,
      modes: parseModes(g.modes),
      rounds: g.rounds,
      min_tai: g.min_tai,
      max_tai: g.max_tai,
      duration_minutes: g.duration_minutes,
      notes: g.notes,
      created_at: g.created_at,
      seats: db.prepare('SELECT player_id, seat, chips FROM game_seats WHERE game_id = ? ORDER BY id').all(g.id),
      transfers: db.prepare('SELECT from_player_id, to_player_id, amount FROM transfers WHERE game_id = ? ORDER BY id').all(g.id),
    }));
    res.json({
      app: 'mahjong-tracker',
      version: 1,
      exported_at: new Date().toISOString(),
      players,
      games,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Replace ALL data with a backup snapshot. Destructive by design (the client
// confirms first). Preserves ids; recomputes every pool afterward.
app.post('/api/restore', (req, res) => {
  try {
    const body = req.body || {};
    if (body.app !== 'mahjong-tracker' || !Array.isArray(body.players) || !Array.isArray(body.games)) {
      return res.status(400).json({ error: 'Not a valid Mahjong Tracker backup file' });
    }

    const restore = db.transaction(() => {
      // Wipe (CASCADE clears seats/transfers/elo rows tied to games/players).
      db.prepare('DELETE FROM elo_history').run();
      db.prepare('DELETE FROM elo_current').run();
      db.prepare('DELETE FROM transfers').run();
      db.prepare('DELETE FROM game_seats').run();
      db.prepare('DELETE FROM games').run();
      db.prepare('DELETE FROM players').run();

      const insPlayer = db.prepare('INSERT INTO players (id, name, color, created_at) VALUES (?, ?, ?, COALESCE(?, datetime(\'now\')))');
      for (const p of body.players) insPlayer.run(p.id, p.name, p.color || '#f59e0b', p.created_at || null);

      const insGame = db.prepare(
        'INSERT INTO games (id, date, modes, rounds, min_tai, max_tai, pool_key, duration_minutes, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime(\'now\')))'
      );
      const insSeat = db.prepare('INSERT INTO game_seats (game_id, player_id, seat, chips) VALUES (?, ?, ?, ?)');
      const insTr = db.prepare('INSERT INTO transfers (game_id, from_player_id, to_player_id, amount) VALUES (?, ?, ?, ?)');
      for (const g of body.games) {
        const modes = Array.isArray(g.modes) ? g.modes : parseModes(g.modes);
        const minTai = g.min_tai ?? 0;
        const maxTai = g.max_tai ?? 5;
        insGame.run(
          g.id, g.date, JSON.stringify(modes), g.rounds ?? 4, minTai, maxTai,
          elo.poolKey(modes, minTai, maxTai), g.duration_minutes ?? null, g.notes ?? null, g.created_at || null,
        );
        for (const s of g.seats || []) insSeat.run(g.id, s.player_id, s.seat, s.chips);
        for (const t of g.transfers || []) insTr.run(g.id, t.from_player_id, t.to_player_id, t.amount);
      }
    });

    restore();
    recomputeAllPools();
    res.json({
      success: true,
      players: db.prepare('SELECT COUNT(*) AS n FROM players').get().n,
      games: db.prepare('SELECT COUNT(*) AS n FROM games WHERE deleted_at IS NULL').get().n,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Production static serving ───────────────────────────────────────────────

if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// Self-heal pool keys, then backfill all pool ratings before serving (idempotent).
try {
  backfillPoolKeys();
  recomputeAllPools();
} catch (err) {
  console.error('ELO backfill failed:', err.message);
}

app.listen(PORT, () => {
  console.log(`Mahjong Tracker server running on http://localhost:${PORT}`);
});

// Start Telegram bot (polling — works locally without a public URL)
try {
  require('./bot')({ recomputePool });
} catch (err) {
  console.error('Telegram bot failed to start:', err.message);
}
