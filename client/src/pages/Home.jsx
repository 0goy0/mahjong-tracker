import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PlusCircle, Trophy, ClipboardList, BarChart2, Users, ArrowRight, Sun, Moon } from 'lucide-react';
import { api } from '../api';
import { usePool } from '../PoolContext';
import { getRank, poolLabel } from '../labels';
import { fireConfetti } from '../lib/celebrate';
import CelebrationBanner from '../components/CelebrationBanner';

import { C, useTheme } from '../theme';

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

function Stat({ value, label }) {
  return (
    <div className="flex flex-col items-center gap-1 py-4">
      <span className="font-display font-bold leading-none" style={{ color: C.text, fontSize: 28, letterSpacing: '-0.02em' }}>{value}</span>
      <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: C.textFaint }}>{label}</span>
    </div>
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

// Celebrate anything that changed in the active pool's standings since you last
// looked (a new KING at #1, or the biggest rank-up). Invisible unless it fires —
// a little delight on return, kept even though the page itself is brand-generic.
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
  const [stats, setStats] = useState({ games: 0, players: 0, ladders: 0 });
  const [celebration, setCelebration] = useState(null);

  useEffect(() => {
    Promise.all([
      api.getPlayers(),
      api.getGames(),
      api.getPools(),
      pool ? api.getEloLeaderboard(pool) : Promise.resolve([]),
    ]).then(([players, games, pools, elo]) => {
      const p = Array.isArray(players) ? players : [];
      const g = Array.isArray(games) ? games : [];
      const pl = Array.isArray(pools) ? pools : [];
      setStats({ games: g.length, players: p.length, ladders: pl.length });

      const change = standingsChange(pool, Array.isArray(elo) ? elo : []);
      if (change) {
        fireConfetti({ count: change.count, power: change.power });
        setCelebration({ title: change.title, subtitle: change.subtitle, variant: 'big', id: Date.now() });
      }
    });
  }, [pool]);

  return (
    <>
      <CelebrationBanner celebration={celebration} onDone={() => setCelebration(null)} />
      <div className="max-w-md mx-auto">
        <div className="flex justify-end" data-no-stagger>
          <ThemeToggle />
        </div>

        {/* Brand masthead — this is Mahjong Ranked. */}
        <section className="relative text-center pt-6 pb-2" data-no-countup>
          <div className="absolute pointer-events-none" aria-hidden="true"
            style={{ top: -30, left: '50%', transform: 'translateX(-50%)', width: 340, height: 300, background: 'radial-gradient(circle, var(--gold-soft), transparent 66%)' }} />
          <div className="relative mx-auto flex items-center justify-center font-display select-none"
            style={{ width: 92, height: 92, borderRadius: 24, background: C.gold, color: '#0a0c0b', fontSize: 50, fontWeight: 700, boxShadow: '0 18px 44px -12px var(--gold)' }}>
            麻
          </div>
          <h1 className="font-display font-bold leading-none mt-6"
            style={{ color: C.text, fontSize: 'clamp(40px, 12vw, 58px)', letterSpacing: '-0.035em' }}>
            Mahjong <span style={{ color: C.gold }}>Ranked</span>
          </h1>
          <p className="mx-auto mt-4 text-[15px] leading-relaxed" style={{ color: C.textMuted, maxWidth: '30ch' }}>
            Every ruleset, every game — one skill ladder for the table.
          </p>
        </section>

        <div className="grid grid-cols-3 rounded-2xl border overflow-hidden mt-7"
          style={{ background: C.card, borderColor: C.border }}>
          <div style={{ borderRight: '1px solid var(--border-muted)' }}><Stat value={stats.games} label="Games" /></div>
          <div style={{ borderRight: '1px solid var(--border-muted)' }}><Stat value={stats.players} label="Players" /></div>
          <Stat value={stats.ladders} label="Ladders" />
        </div>

        <Link to="/log"
          className="group flex items-center justify-center gap-2.5 rounded-2xl px-5 py-4 font-semibold transition-transform hover:-translate-y-0.5 mt-4"
          style={{ background: C.gold, color: '#0a0c0b', boxShadow: '0 12px 30px -10px var(--gold)' }}>
          <PlusCircle size={19} /> Log a game
          <ArrowRight size={18} className="transition-transform group-hover:translate-x-0.5" />
        </Link>

        <div className="mt-4"><Links /></div>
      </div>
    </>
  );
}
