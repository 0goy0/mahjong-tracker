import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PlusCircle, Trophy, ClipboardList, BarChart2, Crown, ArrowRight } from 'lucide-react';
import { api } from '../api';
import { usePool } from '../PoolContext';
import { getRank, poolLabel } from '../labels';
import { fireConfetti } from '../lib/celebrate';
import CelebrationBanner from '../components/CelebrationBanner';

import { C } from '../theme';

function initials(name) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function chipColor(v) { return v > 0 ? C.win : v < 0 ? C.loss : C.textMuted; }
function signed(v) { return (v > 0 ? '+' : '') + v; }

const MODE_LABELS = { vanilla: 'Vanilla', guo_san: 'Guo San', '8_fei': '8 Fei', '4_fei': '4 Fei', '12_fei': '12 Fei' };

// A hand-drawn mahjong tile — the page's one piece of bespoke art (empty state).
// Ivory face, warm bevel, a single jade circle (一筒) so it reads as mahjong
// without leaning on a glyph. Themes via CSS vars so it works light and dark.
function Tile({ size = 76, className = '', style }) {
  return (
    <svg width={size} height={size * 1.32} viewBox="0 0 76 100" className={className} style={style}
      role="img" aria-label="Mahjong tile">
      <rect x="2.5" y="4" width="71" height="92" rx="12" fill="var(--card-raised)" stroke="var(--border-strong)" strokeWidth="1.5" />
      <rect x="9" y="10" width="58" height="80" rx="8" fill="var(--bg-subtle)" />
      <circle cx="38" cy="50" r="19" fill="none" stroke="var(--jade)" strokeWidth="5" />
      <circle cx="38" cy="50" r="8.5" fill="var(--jade)" fillOpacity="0.9" />
      <circle cx="38" cy="50" r="3.2" fill="var(--card-raised)" />
    </svg>
  );
}

function Avatar({ player, size = 44, ring = true }) {
  const common = {
    width: size, height: size,
    border: ring ? `2px solid ${player.color}` : 'none',
    boxShadow: ring ? `0 6px 18px -6px ${player.color}aa` : 'none',
  };
  return player.avatar
    ? <img src={player.avatar} alt={player.name} className="rounded-full object-cover flex-shrink-0" style={common} />
    : (
      <div className="rounded-full flex items-center justify-center font-bold flex-shrink-0"
        style={{ ...common, background: player.color, color: '#f4efe4', fontSize: size * 0.34 }}>
        {initials(player.name)}
      </div>
    );
}

// The front page's lede: whoever is #1 in this pool, framed like a headline.
function Leader({ player, meta }) {
  const rank = getRank(player.rating);
  return (
    <section className="relative overflow-hidden rounded-3xl border"
      style={{ background: 'var(--tint-gold)', borderColor: C.border, boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 24px 48px -28px rgba(0,0,0,0.3)' }}>
      {/* soft radial warmth + a faint oversized glyph (drawn depth, not glass) */}
      <div className="absolute pointer-events-none" aria-hidden="true"
        style={{ top: -80, right: -60, width: 280, height: 280, background: 'radial-gradient(circle, var(--gold-soft), transparent 68%)' }} />
      <div className="absolute pointer-events-none select-none font-display" aria-hidden="true"
        style={{ right: 16, bottom: -40, fontSize: 170, lineHeight: 1, color: C.gold, opacity: 0.06 }}>麻</div>

      <div className="relative px-6 pt-5 pb-6 sm:px-7">
        <div className="flex items-center justify-between gap-3 pb-5 mb-5 border-b"
          style={{ borderColor: 'var(--border-muted)' }}>
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: C.gold }}>
            <Crown size={14} strokeWidth={2.4} /> Leading {poolLabel(meta.pool) || 'the table'}
          </span>
          <span className="text-xs tabular-nums" style={{ color: C.textMuted }}>
            {meta.games} games · {meta.players} players
          </span>
        </div>

        <div className="flex items-center gap-4 sm:gap-5">
          <Avatar player={player} size={72} />
          <div className="min-w-0 flex-1">
            <h1 className="font-display font-bold leading-none truncate"
              style={{ color: C.text, fontSize: 'clamp(30px, 7vw, 46px)', letterSpacing: '-0.03em' }}>
              {player.name}
            </h1>
            {rank && (
              <div className="mt-1.5 text-sm font-semibold truncate" style={{ color: rank.color }}>
                {rank.chinese} {rank.title}
              </div>
            )}
          </div>
          <div className="text-right flex-shrink-0">
            <div className="font-display font-bold leading-none"
              style={{ color: C.gold, fontSize: 'clamp(34px, 8vw, 54px)', letterSpacing: '-0.03em' }}>
              {Math.round(player.rating)}
            </div>
            <div className="flex items-center justify-end gap-2 mt-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: C.textFaint }}>Elo</span>
              {player.last_delta != null && (
                <span className="text-xs font-bold tabular-nums" style={{ color: player.last_delta >= 0 ? C.win : C.loss }}>
                  {player.last_delta >= 0 ? '▲' : '▼'} {Math.abs(Math.round(player.last_delta))}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// Everyone chasing — ranks 2..N as a tight standings list, no podium blocks.
function Chasers({ rows }) {
  if (!rows.length) return null;
  return (
    <section className="rounded-2xl border overflow-hidden" data-no-countup
      style={{ background: C.card, borderColor: C.border }}>
      <div className="flex items-center gap-2 px-5 py-3.5 border-b" style={{ borderColor: C.border }}>
        <Trophy size={15} color={C.gold} />
        <span className="font-semibold text-sm" style={{ color: C.text }}>The chase</span>
        <Link to="/ratings" className="ml-auto inline-flex items-center gap-1 text-xs font-semibold" style={{ color: C.gold }}>
          Full leaderboard <ArrowRight size={13} />
        </Link>
      </div>
      {rows.map((p, i) => {
        const rank = getRank(p.rating);
        return (
          <div key={p.player_id}
            className="px-5 py-3 flex items-center gap-3.5 border-b last:border-0"
            style={{ borderColor: 'var(--border-muted)' }}>
            <span className="font-display font-bold tabular-nums w-5 text-center flex-shrink-0"
              style={{ color: C.textFaint, fontSize: 17 }}>{i + 2}</span>
            <Avatar player={p} size={34} ring={false} />
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-sm truncate" style={{ color: C.text }}>{p.name}</div>
              {rank && <div className="text-xs truncate" style={{ color: rank.color }}>{rank.chinese} {rank.title}</div>}
            </div>
            {p.last_delta != null && (
              <span className="text-xs font-semibold tabular-nums flex-shrink-0"
                style={{ color: p.last_delta >= 0 ? C.win : C.loss }}>
                {p.last_delta >= 0 ? '+' : ''}{Math.round(p.last_delta)}
              </span>
            )}
            <span className="font-display font-bold tabular-nums flex-shrink-0 text-right"
              style={{ color: C.text, fontSize: 18, minWidth: 48 }}>{Math.round(p.rating)}</span>
          </div>
        );
      })}
    </section>
  );
}

function LastGame({ game }) {
  const modes = Array.isArray(game.modes) ? game.modes : [];
  const modeStr = modes.map(m => MODE_LABELS[m] || m).join(' + ');
  const sorted = [...(game.seats || [])].sort((a, b) => b.chips - a.chips);

  return (
    <section className="rounded-2xl border overflow-hidden" data-no-countup
      style={{ background: C.card, borderColor: C.border }}>
      <div className="px-5 py-3.5 border-b flex items-center justify-between gap-2" style={{ borderColor: C.border }}>
        <span className="font-semibold text-sm" style={{ color: C.text }}>Latest result</span>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs px-2 py-0.5 rounded-full font-semibold flex-shrink-0"
            style={{ background: C.goldSoft, color: C.gold }}>{modeStr}</span>
          <span className="text-xs flex-shrink-0 tabular-nums" style={{ color: C.textMuted }}>
            {game.rounds} winds · {game.date}
          </span>
        </div>
      </div>
      {sorted.map((seat, i) => (
        <div key={seat.player_id}
          className="px-5 py-3 flex items-center gap-3.5 border-b last:border-0"
          style={{ borderColor: 'var(--border-muted)', background: i === 0 ? 'var(--tint-gold)' : 'transparent' }}>
          <span className="font-display font-bold tabular-nums w-5 text-center flex-shrink-0"
            style={{ color: i === 0 ? C.gold : C.textFaint, fontSize: 16 }}>{i + 1}</span>
          <span className="flex-1 font-medium text-sm truncate" style={{ color: C.text }}>{seat.player_name}</span>
          {seat.elo_delta != null && (
            <span className="text-xs font-medium tabular-nums flex-shrink-0"
              style={{ color: seat.elo_delta >= 0 ? C.win : C.loss }}>
              {seat.elo_delta >= 0 ? '+' : ''}{seat.elo_delta}
            </span>
          )}
          <span className="font-bold text-sm tabular-nums flex-shrink-0"
            style={{ color: chipColor(seat.chips), minWidth: 54, textAlign: 'right' }}>
            {signed(seat.chips)}
          </span>
        </div>
      ))}
    </section>
  );
}

function Actions() {
  const links = [
    { to: '/ratings', icon: Trophy, label: 'Leaderboard' },
    { to: '/history', icon: ClipboardList, label: 'History' },
    { to: '/analytics', icon: BarChart2, label: 'Analytics' },
  ];
  return (
    <section className="space-y-3" data-no-stagger>
      <Link to="/log"
        className="group flex items-center justify-between gap-3 rounded-2xl px-5 py-4 font-semibold transition-transform hover:-translate-y-0.5"
        style={{ background: C.gold, color: '#0a0c0b', boxShadow: '0 10px 26px -10px var(--gold)' }}>
        <span className="flex items-center gap-2.5"><PlusCircle size={19} /> Log a game</span>
        <ArrowRight size={18} className="transition-transform group-hover:translate-x-0.5" />
      </Link>
      <div className="grid grid-cols-3 rounded-2xl border overflow-hidden" style={{ background: C.card, borderColor: C.border }}>
        {links.map(({ to, icon: Icon, label }, i) => (
          <Link key={to} to={to}
            className="flex flex-col items-center gap-1.5 py-3.5 transition-colors"
            style={{ borderLeft: i ? '1px solid var(--border-muted)' : 'none' }}>
            <Icon size={17} color={C.textMuted} />
            <span className="text-xs font-semibold" style={{ color: C.text }}>{label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

// Celebrate anything that changed in this pool's standings since you last looked:
// a new KING at #1, or the biggest rank-up among everyone. Snapshot is kept in
// localStorage per pool, so each change is celebrated exactly once. Returns a
// { title, subtitle, count, power } to celebrate, or null.
function standingsChange(poolKey, rows) {
  if (!poolKey || !rows.length) return null;
  const key = `mj_lb_snap_${poolKey}`;
  let prev = null;
  try { prev = JSON.parse(localStorage.getItem(key) || 'null'); } catch { /* ignore */ }
  const snap = { top: rows[0].player_id, r: Object.fromEntries(rows.map(x => [x.player_id, x.rating])) };
  try { localStorage.setItem(key, JSON.stringify(snap)); } catch { /* ignore */ }
  if (!prev || prev.top == null) return null; // first visit for this pool → nothing to compare

  if (snap.top !== prev.top) {
    return { title: `👑 ${rows[0].name} is the new KING`, subtitle: poolLabel(poolKey), count: 180, power: 1.35 };
  }
  let best = null;
  for (const row of rows) {
    const before = prev.r?.[row.player_id];
    if (before == null) continue;
    const rb = getRank(before), ra = getRank(row.rating);
    if (rb && ra && ra.min > rb.min && (!best || row.rating - before > best.gain)) {
      best = { name: row.name, rank: ra, gain: row.rating - before };
    }
  }
  if (best) return { title: `${best.name} ranked up!`, subtitle: `${best.rank.chinese} ${best.rank.title}`, count: 150, power: 1.2 };
  return null;
}

export default function Home() {
  const { pool } = usePool();
  const [standings, setStandings] = useState([]);
  const [lastGame, setLastGame] = useState(null);
  const [counts, setCounts] = useState({ games: 0, players: 0 });
  const [celebration, setCelebration] = useState(null);

  useEffect(() => {
    Promise.all([
      api.getPlayers(),
      pool ? api.getEloLeaderboard(pool) : Promise.resolve([]),
      api.getGames(pool),
    ]).then(([players, elo, games]) => {
      const p = Array.isArray(players) ? players : [];
      const e = Array.isArray(elo) ? elo : [];
      const g = Array.isArray(games) ? games : [];
      const playerMap = Object.fromEntries(p.map(pl => [pl.id, pl]));
      const enriched = e.map(row => ({
        ...row,
        color: playerMap[row.player_id]?.color || C.gold,
        avatar: playerMap[row.player_id]?.avatar || null,
      }));
      setStandings(enriched.slice(0, 5));
      setCounts({ games: g.length, players: p.length });
      setLastGame(g[0] || null);

      const change = standingsChange(pool, e);
      if (change) {
        fireConfetti({ count: change.count, power: change.power });
        setCelebration({ title: change.title, subtitle: change.subtitle, variant: 'big', id: Date.now() });
      }
    });
  }, [pool]);

  const leader = standings[0];
  const noData = !standings.length && !lastGame;

  return (
    <>
      <CelebrationBanner celebration={celebration} onDone={() => setCelebration(null)} />
      <div className="max-w-2xl mx-auto space-y-4">
        {noData ? (
          <div className="rounded-3xl border px-8 py-14 text-center flex flex-col items-center"
            style={{ background: C.card, borderColor: C.border }}>
            <Tile size={72} />
            <p className="font-display font-bold mt-6" style={{ color: C.text, fontSize: 24 }}>No games yet</p>
            <p className="text-sm mt-1.5 mb-7 max-w-xs" style={{ color: C.textMuted }}>
              Log your first session and the ladder starts climbing.
            </p>
            <Link to="/log"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl font-semibold text-sm transition-transform hover:-translate-y-0.5"
              style={{ background: C.gold, color: '#0a0c0b', boxShadow: '0 10px 26px -10px var(--gold)' }}>
              <PlusCircle size={16} /> Log a game
            </Link>
          </div>
        ) : (
          <>
            {leader && <Leader player={leader} meta={{ pool, games: counts.games, players: counts.players }} />}
            {standings.length > 1 && <Chasers rows={standings.slice(1)} />}
            {lastGame && <LastGame game={lastGame} />}
            <Actions />
          </>
        )}
      </div>
    </>
  );
}
