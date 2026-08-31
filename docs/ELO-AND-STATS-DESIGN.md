# Mahjong Tracker — Rating & Stats Architecture (ELO)

**Status:** design spec, ready to implement. Authored 2026-08-28.
**Audience:** the implementing engineer/model. This is the *heart of the project* — read it fully before writing code.

---

## 0. What this project is

A **chess.com for our Singapore-mahjong circle, minus the playing**. We don't play games in the app;
we *record* real-life games and the app is the source of truth for stats, history, and skill ratings.

Every game we log is:

- a **date** (no time — time is irrelevant),
- a **game mode / ruleset** (see §1 — can be a *combination* of modes),
- the **number of winds** played (feng; e.g. 4 winds or 7 winds),
- the **four players seated by wind**: 东 dong / 南 nan / 西 xi / 北 bei,
- each player's **net chips** for the game (always sums to **0**).

From that log we already derive: leaderboards, per-player profiles, head-to-head, per-mode breakdowns,
and a pairwise **transfer ledger** (who paid whom). This doc adds the flagship feature: **ELO ratings**.

---

## 1. The central invariant: a mode(-set) is its own universe

> "For each particular mode, it is a completely different game. The tracking cannot overlap.
> It's like comparing tennis to badminton." — the owner

This is non-negotiable and drives the whole data architecture:

- The **ruleset a game was played under is its identity.** Stats and ratings for one ruleset
  **never** mix with another.
- A ruleset can be a **set of modes**, e.g. `vanilla`, or `8_fei + guo_san`. The **set** is what matters,
  order-independent. `8_fei + guo_san` is a *different game* from `8_fei` alone and from `guo_san` alone.
- **Winds do NOT split the universe.** Same ruleset with a different number of winds is the same game;
  we make them comparable by normalizing to **chips per wind** (`chips / winds`). This is the great equalizer —
  every chip figure that feeds ratings or cross-game comparison is per-wind.
- This is exactly the chess analogy: **blitz Elo ≠ rapid Elo.** Each ruleset gets its **own independent
  Elo pool, its own leaderboard, its own everything.**

### 1.1 Pool identity (the canonical key)

Define `pool_key` from the game's modes (de-duplicated, sorted, joined with `+`) **and** its tai bounds:

```
poolKey(modes, min_tai, max_tai) =
  [...new Set(modes)].sort().join('+') + '|' + min_tai + '-' + max_tai
// (["guo_san","8_fei"], 1, 6)  ->  "8_fei+guo_san|1-6"
// (["vanilla"], 0, 5)          ->  "vanilla|0-5"
```

Everything rating-related is keyed by `pool_key`. This is the single source of truth — use it on server AND
client; never derive pool identity any other way.

**DECIDED 2026-08-28 (owner):** min/max **tai ARE part of pool identity** — changing the tai bounds makes it a
genuinely different game with its own leaderboard/ratings (e.g. `vanilla|0-5` ≠ `vanilla|1-6`). **Winds are
NOT** part of identity — they're normalized away via chips-per-wind. Consequence: pools fragment fairly
finely, so a pool's ratings only become meaningful once it has enough games; the leaderboard UI should show a
game-count and treat thin pools accordingly (e.g. "provisional" badge until N games in that pool).

### 1.2 Reconciling with today's mode filter

The current app has a *loose* mode filter where a game counts under **each** of its modes independently
(`/api/modes`, `MODE_SQL`). That is **inconsistent with the "combination is its own game" rule**.

**DECIDED 2026-08-28 (owner):** strict pools everywhere. **Retire the loose per-mode counting entirely.**
Leaderboard, profiles, chips, AND Elo all key off the exact `pool_key` (the sorted mode-set). A game logged as
`8_fei + guo_san` appears **only** in the `8_fei+guo_san` pool — never under `8_fei` alone or `guo_san` alone.
`/api/modes` + `MODE_SQL` are replaced by pool-scoped queries (`/api/pools`, `WHERE poolKey = ?`). No separate
"loose browse" filter.

---

## 2. Data model

Existing tables (keep): `players`, `games` (`modes` JSON array, `rounds` = **winds**, `min_tai`, `max_tai`,
`date`, `created_at`), `game_seats` (`seat`, `player_id`, `chips`), `transfers`
(`game_id`, `from_player_id`, `to_player_id`, `amount` — the pairwise ledger).

> Naming note: the DB column is `rounds`; in the domain and UI it is **winds (feng)**. Either rename to
> `winds` in a migration, or alias consistently. The UI must show "winds". LogGame currently has **no winds
> input** — add one (default 4).

### New tables (all **derived** — regenerable from the game log by replay; never hand-edited)

```sql
-- One row per (pool, player): the live standing.
CREATE TABLE elo_current (
  pool_key       TEXT    NOT NULL,
  player_id      INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  rating         REAL    NOT NULL,
  games_played   INTEGER NOT NULL,
  peak_rating    REAL    NOT NULL,
  last_delta     REAL    NOT NULL,
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (pool_key, player_id)
);

-- One row per (game, player): the timeline, for charts + per-game deltas in the log.
CREATE TABLE elo_history (
  game_id        INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  pool_key       TEXT    NOT NULL,
  player_id      INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  seq            INTEGER NOT NULL,        -- game index within the pool timeline (1-based)
  rating_before  REAL    NOT NULL,
  rating_after   REAL    NOT NULL,
  delta          REAL    NOT NULL,
  chips          INTEGER NOT NULL,        -- net chips this game
  winds          INTEGER NOT NULL,
  PRIMARY KEY (game_id, player_id)
);
CREATE INDEX idx_elo_hist_pool ON elo_history(pool_key, seq);
CREATE INDEX idx_elo_hist_player ON elo_history(player_id, pool_key, seq);
```

Because these are derived, the source of truth remains the game log. **Any create / update / delete of a game
triggers a full replay-recompute of that game's pool** (see §4).

### Config

```sql
CREATE TABLE elo_config (
  key TEXT PRIMARY KEY,
  value REAL NOT NULL
);
-- seed: base_rating=1000, chip_scale=<calibrated>, k_provisional=40, k_mid=24, k_stable=16,
--       provisional_games=10, stable_games=30
```

---

## 3. The ELO algorithm

The design goal, stated by the owner:

> Winning against **higher-rated** opponents raises your Elo more. Winning **more chips** matters. It must
> account for **chips per wind**. Ratings are **per-mode-set**.

We satisfy all four with **pairwise, margin-aware Elo built on the transfer ledger.** Because we know exactly
how many chips flowed between each pair of players, we don't approximate a 4-player result — we compute a real
head-to-head outcome for every pair at the table.

### 3.1 Definitions for a single game `g` in pool `P` with `W` winds

- Players `i ∈ {dong, nan, xi, bei}`, net chips `c_i`, with `Σ c_i = 0`.
- Pairwise net from the ledger: `gᵢⱼ = (chips j paid to i) − (chips i paid to j)` = chips `i` won from `j`.
  - Antisymmetric: `gᵢⱼ = −gⱼᵢ`. And `Σⱼ gᵢⱼ = cᵢ` (the ledger reconciles to net chips).
- **Per-wind normalization:** `ĝᵢⱼ = gᵢⱼ / W`.
- Pre-game ratings in pool `P`: `Rᵢ` (default `base_rating` = 1000 if the player has no games in `P` yet).

### 3.2 Expected vs actual score, per ordered pair (i, j)

Standard Elo expectation:

```
Eᵢⱼ = 1 / (1 + 10^((Rⱼ − Rᵢ) / 400))          // Eᵢⱼ + Eⱼᵢ = 1
```

Actual score as a **smooth function of the margin** (this is where "more chips = more credit" lives):

```
Sᵢⱼ = σ(ĝᵢⱼ / s),   where σ(x) = 1/(1+e^(−x)),   s = chip_scale (config)
```

- `s` is the chips-per-wind swing that represents a "clearly decisive" head-to-head. Calibrate to real data
  (see §7). `Sᵢⱼ + Sⱼᵢ = 1` because `ĝⱼᵢ = −ĝᵢⱼ` and `σ(−x) = 1−σ(x)`.
- If `i` netted chips off `j`, `ĝᵢⱼ > 0 ⇒ Sᵢⱼ > 0.5`. A wash ⇒ `0.5`.

### 3.3 Rating update

```
ΔRᵢ = (K / (n−1)) · Σ_{j≠i} (Sᵢⱼ − Eᵢⱼ)          // n = 4, so divide by 3
Rᵢ' = Rᵢ + ΔRᵢ
```

Averaging over the 3 opponents keeps a single game's swing on the same scale as a classic 1-v-1 Elo game.

**Why this hits every requirement:**
- *Beat a higher-rated player* → their `Rⱼ > Rᵢ` → `Eᵢⱼ` small → `(Sᵢⱼ − Eᵢⱼ)` large → bigger gain. ✅
- *Win more chips* → `ĝᵢⱼ` large → `Sᵢⱼ → 1` → bigger gain. ✅
- *Chips per wind* → baked into `ĝᵢⱼ = gᵢⱼ / W`. ✅
- *Per-mode-set* → the whole computation runs inside one `pool_key`. ✅

**Conservation:** with a single uniform `K` for the game, `Σᵢ ΔRᵢ = 0` exactly, because every pair term
`(Sᵢⱼ − Eᵢⱼ)` is cancelled by its mirror `(Sⱼᵢ − Eⱼᵢ)`. The pool's total rating is conserved — clean and
self-consistent. (See §3.4 for the provisional-K tradeoff.)

### 3.4 K-factor (experience weighting)

Give new players faster-moving ratings:

```
K(player, pool) = k_provisional (=40)  if games_in_pool < provisional_games (=10)
                = k_mid         (=24)  if games_in_pool < stable_games (=30)
                = k_stable      (=16)  otherwise
```

Tradeoff to document in code: **per-player K breaks exact conservation** (a provisional player and a stable
player at the same table move by different absolute amounts). This is standard and acceptable (chess ratings
aren't strictly conserved either). If strict conservation is ever required, use a single `K` per game =
the min (or mean) of the table's K values. Recommendation: **keep per-player K; accept the small drift.**

### 3.5 Optional pot-size weight (extension, off by default)

If we later want a blow-out night to move ratings more than a quiet one, multiply each **pair** term by a
symmetric factor of the pair's own margin, `m(ĝᵢⱼ) = m(ĝⱼᵢ)` (e.g. `1 + log1p(|ĝᵢⱼ|/s)`), which preserves the
per-pair cancellation and thus conservation. Do **not** use a per-player pot factor. Ship without this first;
`Sᵢⱼ` already carries margin.

### 3.6 Worked micro-example

Pool `vanilla`, all four at 1000, `W = 4` winds. Final chips (dong +30, nan −10, xi −10, bei −10) with a ledger
where nan/xi/bei each paid 10 to dong. Per-wind pairwise for dong vs each loser: `ĝ = 10/4 = 2.5`. With
`s = 3`: `S = σ(2.5/3) = σ(0.833) ≈ 0.697`; `E = 0.5`. `ΔR_dong = (K/3)·Σ(0.697−0.5) = (K/3)·(3·0.197) =
K·0.197`. With provisional `K=40`, dong ≈ **+7.9**; each loser symmetric ≈ **−2.6**. Sum ≈ 0. ✅

---

## 4. Recompute engine (determinism is mandatory)

Games can be **edited or deleted** (edit already shipped). Editing a past game changes *every subsequent
rating in that pool*. Therefore ratings must be **deterministically replayable from the log**, never only
incrementally mutated.

**Algorithm — `recomputePool(pool_key)`:**

1. Load all games whose `poolKey(modes) === pool_key`, ordered `date ASC, created_at ASC, id ASC`
   (stable, total order).
2. Initialize `ratings = {}` (default 1000 on first appearance) and `gamesPlayed = {}`.
3. For each game in order: read seats + ledger, compute `ĝᵢⱼ`, `Eᵢⱼ`, `Sᵢⱼ`, `ΔRᵢ` (§3); append an
   `elo_history` row per player (`rating_before`, `rating_after`, `delta`, `seq`); bump `gamesPlayed`.
4. Replace `elo_current` + `elo_history` rows for this pool inside a single transaction
   (`DELETE ... WHERE pool_key=?` then bulk insert).

**Triggers:** `POST/PUT/DELETE /api/games` → after the game write commits, call `recomputePool` for the
affected pool(s). On an **edit that changes the mode-set**, recompute **both** the old and new pool.

Cost is trivial (hundreds→thousands of games, O(n) per pool). Keep the whole engine a **pure function**
`computePoolTimeline(gamesInOrder, config) -> { current, history }` so it is unit-testable without a DB.

**Unit tests to write:** (a) total rating conserved under uniform K; (b) monotonicity — more chips ⇒ larger
delta; (c) higher-rated-opponent win ⇒ larger delta than same win vs lower-rated; (d) replay determinism —
recompute twice gives identical output; (e) delete-then-recompute equals never-inserted.

---

## 5. API surface (all rating data is read-only/derived)

```
GET /api/pools
    -> [{ pool_key, label, games, players }]           // label = human "8 Fei + Guo San"

GET /api/elo/leaderboard?pool=<key>
    -> [{ player_id, name, color, rating, peak_rating, games_played,
          wins, losses, total_chips, chips_per_wind, last_delta }]  sorted by rating desc

GET /api/elo/player/:id?pool=<key>
    -> { player, rating, peak_rating, games_played, rank,
         timeline: [{ seq, date, game_id, rating_after, delta, chips, winds }] }

GET /api/games?pool=<key>    // extend existing: include per-seat elo_after + delta from elo_history
```

`?pool=all` or omitted = a cross-pool summary view (list each pool with its top player), **never** a merged
rating — pools do not merge.

---

## 6. Frontend

New top-level **Ratings** section (chess.com energy):

- **Pool switcher** (mode-set chips): pick which universe you're viewing. Distinct from the old loose filter.
- **Leaderboard:** rank, player (color chip + name), **big rating number**, peak, games, W–L, chips/wind,
  last-change badge (▲+12 / ▼−8). Sort by rating (default), chips/wind, games.
- **Player profile additions:** an **Elo-over-time line chart** per pool (from `timeline`), current-rating
  badges for each pool the player has played, rank within pool, peak.
- **Game log:** next to each player show their **Elo delta** for that game (`+7.9` / `−2.6`) alongside chips.
- Reuse existing dark/gold system (`#09090b` / amber `#f59e0b`, green/red for +/−, Recharts, lucide icons).

Also: add the **winds input** to LogGame. **DECIDED 2026-08-28 (owner):** quick-pick buttons for **4** and
**7** winds (the common cases) **plus a free number field** for anything else (min 1). Default 4. And make the
mode multi-select clearly communicate "this set of modes = one game / one rating pool."

---

## 7. Calibrating `chip_scale` (s)

`s` sets how much a chip swing moves ratings. Procedure once real games exist:

1. Compute the distribution of `|ĝᵢⱼ|` (absolute pairwise chips-per-wind) across all logged pairs.
2. Set `s ≈ median(|ĝᵢⱼ|)` so a "typical" pairwise result maps to `S ≈ 0.62–0.70` (a normal win), and
   blow-outs approach `S → 0.9+`.
3. Store in `elo_config`; expose a tuning note. Re-runs are free (full replay), so `s` can be retuned later
   and all history regenerates.

Sensible bootstrap default before data exists: pick `s` = the chips a "clear but not crushing" single-wind
head-to-head would be (owner's judgment, e.g. 3–5 chips/wind). Tune after ~20 games.

---

## 8. Implementation phases

1. **Pool identity** — `poolKey()` helper (server + client), resolve the min/max-tai decision (§9), refactor
   stats to pool-scoped, add `/api/pools`. Add winds input to LogGame.
2. **ELO engine** — pure `computePoolTimeline`, config table, unit tests (§4).
3. **Recompute hooks** — wire `recomputePool` into POST/PUT/DELETE games (both pools on mode-set edits).
4. **Rating APIs** — leaderboard, player timeline, game-log deltas.
5. **Frontend** — Ratings section, pool switcher, leaderboard, profile chart, log deltas.
6. **Calibrate** `s` and confirm K bands feel right on real data.

Ship 1–4 behind the scenes first (ratings computed, no UI), eyeball the numbers against intuition, then build 5.

---

## 9. Open decisions (owner must confirm)

1. ✅ **CONFIRMED 2026-08-28** — min/max **tai split pools**; they're part of `pool_key` (see §1.1). Winds do not.
2. ✅ **CONFIRMED 2026-08-28** — mode-SET pools: `8_fei + guo_san` is its own pool, separate from each single mode.
3. ✅ **CONFIRMED 2026-08-28** — all chip/win/profile stats become strictly pool-scoped; the loose per-mode
   filter is retired (see §1.2).
4. ✅ **CONFIRMED 2026-08-28** — **fast-then-settle** ratings: provisional K 40→24→16 at 10/30 games in-pool
   (accept the minor conservation drift from per-player K; see §3.4).
5. ✅ **CONFIRMED 2026-08-28** — base rating **1000**. K bands 40·24·16 at 10·30 games. All in `elo_config`.
6. ✅ **CONFIRMED 2026-08-28** — winds input: 4/7 quick-picks + free number field, default 4 (see §6).
7. ⬜ REMAINING (a *tuning* step, not a blocker): calibrate **chip_scale `s`** once real games exist (§7).
   Everything else can be built now; `s` is retunable anytime because ratings replay from the log.

---

## 10. Non-negotiables recap (do not violate)

- Chips per game **sum to 0**; the transfer ledger reconciles to net chips. Validate on write.
- Ratings and stats are **strictly per pool** — universes never merge.
- Everything cross-game is **per-wind** normalized.
- Rating tables are **derived**; the game log is the only source of truth; **all ratings are replayable**.
- No time-of-day. No emojis. Plain English + SG/mahjong terms. Dark + gold aesthetic.
