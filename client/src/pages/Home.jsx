import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PlusCircle, Trophy, ClipboardList, BarChart2, Users, Crown, ArrowRight, Sun, Moon } from 'lucide-react';
import { api } from '../api';
import { usePool } from '../PoolContext';
import { getRank, poolLabel } from '../labels';
import { fireConfetti } from '../lib/celebrate';
import CelebrationBanner from '../components/CelebrationBanner';

import { C, useTheme } from '../theme';

function initials(name) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

// A hand-drawn mahjong tile — the one piece of bespoke art (empty state). Ivory
// face, warm bevel, a single jade circle (一筒). Themes via CSS vars.
function Tile({ size = 76 }) {
  return (
    <svg width={size} height={size * 1.32} viewBox="0 0 76 100" role="img" aria-label="Mahjong tile">
      <rect x="2.5" y="4" width="71" height="92" rx="12" fill="var(--card-raised)" stroke="var(--border-strong)" strokeWidth="1.5" />
      <rect x="9" y="10" width="58" height="80" rx="8" fill="var(--bg-subtle)" />
      <circle cx="38" cy="50" r="19" fill="none" stroke="var(--jade)" strokeWidth="5" />
      <circle cx="38" cy="50" r="8.5" fill="var(--jade)" fillOpacity="0.9" />
      <circle cx="38" cy="50" r="3.2" fill="var(--card-raised)" />
    </svg>
  );
}

function ThemeToggle() {
  const { mode, toggle } = useTheme();
  return (
    <button onClick={toggle} aria-label="Toggle light / dark"
      className="flex items-center justify-center rounded-full transition-colors"
      style={{ width: 34, height: 34, background: C.card, border: `1px solid ${C.border}`, color: C.textSec }}>
      {mode === 'light' ? <Moon size={15} /> : <Sun size={15} />}
    </button>
  );
}

// The whole page, really: whoever reigns this pool, as the cover story.
function King({ player, pool }) {
  const rank = getRank(player.rating);
  const ring = player.color || C.gold;
  return (
    <section className="relative overflow-hidden rounded-3xl border text-center"
      style={{ background: 'var(--tint-gold)', borderColor: C.border, boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 30px 60px -32px rgba(0,0,0,0.35)' }}>
      <div className="absolute pointer-events-none" aria-hidden="true"
        style={{ top: -120, left: '50%', transform: 'translateX(-50%)', width: 420, height: 320, background: 'radial-gradient(circle, var(--gold-soft), transparent 68%)' }} />
      <div className="absolute pointer-events-none select-none font-display" aria-hidden="true"
        style={{ right: 10, bottom: -56, fontSize: 210, lineHeight: 1, color: C.gold, opacity: 0.05 }}>麻</div>

      <div className="relative px-6 pt-8 pb-9 flex flex-col items-center">
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold mb-5" style={{ color: C.gold }}>
          <Crown size={14} strokeWidth={2.4} /> Reigning · {poolLabel(pool) || 'the table'}
        </div>

        {player.avatar ? (
          <img src={player.avatar} alt={player.name} className="rounded-full object-cover"
            style={{ width: 84, height: 84, border: `2.5px solid ${ring}`, boxShadow: `0 10px 30px -8px ${ring}aa` }} />
        ) : (
          <div className="rounded-full flex items-center justify-center font-bold"
            style={{ width: 84, height: 84, background: ring, color: '#f4efe4', fontSize: 30, border: `2.5px solid ${ring}`, boxShadow: `0 10px 30px -8px ${ring}aa` }}>
            {initials(player.name)}
          </div>
        )}

        <h1 className="font-display font-bold leading-none mt-4 max-w-full truncate px-2"
          style={{ color: C.text, fontSize: 'clamp(30px, 8vw, 42px)', letterSpacing: '-0.03em' }}>
          {player.name}
        </h1>
        {rank && (
          <div className="mt-2 text-sm font-semibold" style={{ color: rank.color }}>{rank.chinese} {rank.title}</div>
        )}

        <div className="font-display font-bold leading-none mt-5"
          style={{ color: C.gold, fontSize: 'clamp(44px, 14vw, 64px)', letterSpacing: '-0.03em' }}>
          {Math.round(player.rating)}
        </div>
        <div className="flex items-center gap-2.5 mt-2">
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.textFaint }}>Elo</span>
          {player.last_delta != null && (
            <span className="text-xs font-bold tabular-nums" style={{ color: player.last_delta >= 0 ? C.win : C.loss }}>
              {player.last_delta >= 0 ? '▲' : '▼'} {Math.abs(Math.round(player.last_delta))}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

function Links() {
  const links = [
    { to: '/ratings', icon: Trophy, label: 'Leaderboard' },
    { to: '/history', icon: ClipboardList, label: 'History' },
    { to: '/analytics', icon: BarChart2, label: 'Stats' },
    { to: '/players', icon: Users, label: 'Players' },
  ];
  return (
    <div className="grid grid-cols-4 rounded-2xl border overflow-hidden" style={{ background: C.card, borderColor: C.border }} data-no-stagger>
      {links.map(({ to, icon: Icon, label }, i) => (
        <Link key={to} to={to} className="flex flex-col items-center gap-1.5 py-3.5 transition-colors"
          style={{ borderLeft: i ? '1px solid var(--border-muted)' : 'none' }}>
          <Icon size={17} color={C.textMuted} />
          <span className="text-xs font-semibold" style={{ color: C.text }}>{label}</span>
        </Link>
      ))}
    </div>
  );
}

// Celebrate anything that changed in this pool's standings since you last looked:
// a new KING at #1, or the biggest rank-up among everyone. Snapshot is kept in
// localStorage per pool, so each change is celebrated exactly once.
function standingsChange(poolKey, rows) {
  if (!poolKey || !rows.length) return null;
  const key = `mj_lb_snap_${poolKey}`;
  let prev = null;
  try { prev = JSON.parse(localStorage.getItem(key) || 'null'); } catch { /* ignore */ }
  const snap = { top: rows[0].player_id, r: Object.fromEntries(rows.map(x => [x.player_id, x.rating])) };
  try { localStorage.setItem(key, JSON.stringify(snap)); } catch { /* ignore */ }
  if (!prev || prev.top == null) return null;

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
  const [leader, setLeader] = useState(null);
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
      const top = e[0];
      if (top) {
        const pl = p.find(x => x.id === top.player_id);
        setLeader({ ...top, color: pl?.color || C.gold, avatar: pl?.avatar || null });
      } else setLeader(null);
      setCounts({ games: g.length, players: p.length });

      const change = standingsChange(pool, e);
      if (change) {
        fireConfetti({ count: change.count, power: change.power });
        setCelebration({ title: change.title, subtitle: change.subtitle, variant: 'big', id: Date.now() });
      }
    });
  }, [pool]);

  return (
    <>
      <CelebrationBanner celebration={celebration} onDone={() => setCelebration(null)} />
      <div className="max-w-md mx-auto space-y-5">
        <div className="flex items-center justify-between" data-no-stagger>
          <span className="text-xs tabular-nums" style={{ color: C.textMuted }}>
            {counts.players} players · {counts.games} games
          </span>
          <ThemeToggle />
        </div>

        {leader ? (
          <>
            <King player={leader} pool={pool} />
            <Link to="/log"
              className="group flex items-center justify-center gap-2.5 rounded-2xl px-5 py-4 font-semibold transition-transform hover:-translate-y-0.5"
              style={{ background: C.gold, color: '#0a0c0b', boxShadow: '0 12px 30px -10px var(--gold)' }}>
              <PlusCircle size={19} /> Log a game
              <ArrowRight size={18} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Links />
          </>
        ) : (
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
        )}
      </div>
    </>
  );
}
