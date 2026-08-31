// ─── ELO engine ───────────────────────────────────────────────────────────────
// Pairwise, margin-aware Elo built on the transfer ledger. Everything here is a
// PURE function of the game log — no DB, no side effects — so it is trivially
// unit-testable and fully replayable. See docs/ELO-AND-STATS-DESIGN.md.

// Human labels for the built-in modes. Custom modes fall back to their raw
// string. Kept in sync with client/src/labels.js MODES.
const MODE_LABELS = {
  vanilla: 'Vanilla',
  guo_san: 'Guo San',
  '8_fei': '8 Fei',
  min_tai: 'Min Tai',
  max_tai: 'Max Tai',
};

function modeLabel(m) {
  return MODE_LABELS[m] || m;
}

// Canonical pool identity: de-duplicated + sorted mode set, plus the tai bounds.
// This is THE single source of truth for "which universe a game belongs to".
// A mode-SET is its own game; winds are NOT part of identity (normalized away
// via chips-per-wind). e.g. (["guo_san","8_fei"], 1, 6) -> "8_fei+guo_san|1-6".
function poolKey(modes, minTai, maxTai) {
  const set = [...new Set(modes)].sort().join('+');
  return `${set}|${minTai}-${maxTai}`;
}

// Human-readable label for a pool key, e.g. "8 Fei + Guo San · 1–6 tai".
function poolLabel(key) {
  const [modesPart, taiPart] = String(key).split('|');
  const modesLabel = modesPart.split('+').map(modeLabel).join(' + ');
  return taiPart ? `${modesLabel} · ${taiPart.replace('-', '–')} tai` : modesLabel;
}

const DEFAULT_CONFIG = {
  base_rating: 1000,
  k_provisional: 200,
  k_mid: 120,
  k_stable: 80,
  provisional_games: 10,
  stable_games: 30,
};

// K-factor by experience in this pool (games played BEFORE the current game).
function kFactor(gamesBefore, cfg) {
  if (gamesBefore < cfg.provisional_games) return cfg.k_provisional;
  if (gamesBefore < cfg.stable_games) return cfg.k_mid;
  return cfg.k_stable;
}

// Rank scores for 1st–4th place (used for placement bonus).
const RANK_SCORES = [1.0, 0.67, 0.33, 0.0];

// Compute the per-player Elo deltas for ONE game, given the current ratings and
// games-played snapshot for the pool. Returns { [player_id]: { before, after,
// delta } }. Does not mutate its inputs.
//
// Formula:
//   chipScore   = chips_i / (2 × totalWon)          — relative to session, range roughly -0.5..+0.5
//   E_i         = avg pairwise ELO expectation vs opponents
//   multiplier  = opponent strength modifier (flips based on win/loss):
//                   winning: 1 + (0.5 - E)  → underdog amplified, favourite reduced
//                   losing:  1 - (0.5 - E)  → underdog softened, favourite amplified
//   placementBonus = (rankScore - 0.5) × 0.2   — small ±0.1 nudge for table position
//   delta = K × (chipScore × multiplier + placementBonus)
//
// Properties:
//   win chips  → delta always positive (chipScore > 0, multiplier > 0)
//   lose chips → delta always negative (chipScore < 0, multiplier > 0)
//   net 0      → small move based on opponent strength + placement
function computeGameDeltas(game, ratings, gamesPlayed, cfg) {
  const ids = game.seats.map(s => s.player_id);

  const chipsBySeat = {};
  for (const seat of game.seats) chipsBySeat[seat.player_id] = seat.chips;

  // Total chips won this session — normalises chip scores automatically to any mode/stake.
  const totalWon = ids.reduce((sum, id) => {
    const c = chipsBySeat[id] ?? 0;
    return sum + (c > 0 ? c : 0);
  }, 0);

  // Rank scores, averaging ties.
  const sorted = [...ids].sort((a, b) => chipsBySeat[b] - chipsBySeat[a]);
  const rankScore = {};
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length && chipsBySeat[sorted[j]] === chipsBySeat[sorted[i]]) j++;
    const avg = RANK_SCORES.slice(i, j).reduce((a, b) => a + b, 0) / (j - i);
    for (let k = i; k < j; k++) rankScore[sorted[k]] = avg;
    i = j;
  }

  const out = {};
  for (const id of ids) {
    const Ri = ratings[id] ?? cfg.base_rating;
    const Ki = kFactor(gamesPlayed[id] ?? 0, cfg);
    const chips = chipsBySeat[id] ?? 0;

    // Chip score: relative to session total, centred at 0.
    const chipScore = totalWon > 0 ? chips / (2 * totalWon) : 0;

    // Expected score: avg ELO expectation against each opponent.
    let E = 0;
    for (const opp of ids) {
      if (opp === id) continue;
      const Ro = ratings[opp] ?? cfg.base_rating;
      E += 1 / (1 + Math.pow(10, (Ro - Ri) / 400));
    }
    E /= (ids.length - 1);

    // Opponent multiplier — direction-aware so sign of chipScore is always preserved.
    let multiplier;
    if (chips > 0)      multiplier = 1 + (0.5 - E); // underdog win → >1, favourite win → <1
    else if (chips < 0) multiplier = 1 - (0.5 - E); // underdog loss → <1, favourite loss → >1
    else                multiplier = 1;              // net 0: placement + strength handle it

    // Placement bonus: small secondary adjustment (±0.1 max).
    const placementBonus = (rankScore[id] - 0.5) * 0.2;

    // Net 0 chips: move based on opponent strength (draw vs strong = gain, vs weak = lose).
    const strengthBonus = chips === 0 ? (0.5 - E) * 0.3 : 0;

    const delta = Ki * (chipScore * multiplier + placementBonus + strengthBonus);
    out[id] = { before: Ri, after: Ri + delta, delta };
  }
  return out;
}

// Replay an ordered list of games in one pool into a full rating timeline.
// PURE: same input → identical output (determinism is mandatory because games
// can be edited/deleted, forcing a from-scratch recompute of the pool).
//
// `gamesInOrder`: [{ id, winds, seats: [{player_id, chips}], transfers:
//   [{from_player_id, to_player_id, amount}] }] already ordered
//   (date ASC, created_at ASC, id ASC).
// Returns { current: [{player_id, rating, games_played, peak_rating,
//   last_delta}], history: [{game_id, player_id, seq, rating_before,
//   rating_after, delta, chips, winds}] }.
function computePoolTimeline(gamesInOrder, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const ratings = {};
  const gamesPlayed = {};
  const peak = {};
  const lastDelta = {};
  const history = [];

  let seq = 0;
  for (const game of gamesInOrder) {
    seq += 1;
    const deltas = computeGameDeltas(game, ratings, gamesPlayed, cfg);
    const chipsBySeat = {};
    for (const st of game.seats) chipsBySeat[st.player_id] = st.chips;

    for (const st of game.seats) {
      const pid = st.player_id;
      const d = deltas[pid];
      history.push({
        game_id: game.id,
        player_id: pid,
        seq,
        rating_before: d.before,
        rating_after: d.after,
        delta: d.delta,
        chips: chipsBySeat[pid] ?? 0,
        winds: Math.max(1, game.winds || 1),
      });
      ratings[pid] = d.after;
      gamesPlayed[pid] = (gamesPlayed[pid] ?? 0) + 1;
      peak[pid] = Math.max(peak[pid] ?? cfg.base_rating, d.after);
      lastDelta[pid] = d.delta;
    }
  }

  const current = Object.keys(ratings).map(pid => ({
    player_id: Number(pid),
    rating: ratings[pid],
    games_played: gamesPlayed[pid],
    peak_rating: peak[pid],
    last_delta: lastDelta[pid],
  }));

  return { current, history };
}

module.exports = {
  MODE_LABELS,
  modeLabel,
  poolKey,
  poolLabel,
  kFactor,
  RANK_SCORES,
  computeGameDeltas,
  computePoolTimeline,
  DEFAULT_CONFIG,
};
