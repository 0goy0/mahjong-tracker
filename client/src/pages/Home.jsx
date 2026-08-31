import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PlusCircle, Trophy, Users, BarChart2 } from 'lucide-react';
import { api } from '../api';
import { usePool } from '../PoolContext';
import { getRank } from '../labels';

const C = {
  card: '#ffffff', border: '#e5e4e0',
  bg: '#fafaf8', bgSubtle: '#f5f5f2',
  text: '#0a0a0a', textSec: '#374151', textMuted: '#6b7280', textFaint: '#9ca3af',
  win: '#15803d', loss: '#dc2626',
};

export default function Home() {
  const { pool } = usePool();
  const [stats, setStats] = useState({ games: 0, players: 0, topPlayer: null });

  useEffect(() => {
    Promise.all([api.getGames(pool), api.getPlayers(), pool ? api.getEloLeaderboard(pool) : Promise.resolve([])]).then(([games, players, elo]) => {
      const g = Array.isArray(games) ? games : [];
      const p = Array.isArray(players) ? players : [];
      const e = Array.isArray(elo) ? elo : [];
      setStats({ games: g.length, players: p.length, topPlayer: e[0] || null });
    });
  }, [pool]);

  const rank = getRank(stats.topPlayer?.rating);

  return (
    <div className="max-w-xl mx-auto py-12 space-y-10">
      {/* Logo + title */}
      <div className="text-center space-y-3">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl font-bold mx-auto"
          style={{ background: '#f59e0b', color: '#0a0a0a', boxShadow: '0 0 32px #f59e0b44' }}>
          麻
        </div>
        <div>
          <h1 className="text-3xl font-bold" style={{ color: C.text }}>Mahjong Tracker</h1>
          <p className="text-sm mt-1" style={{ color: C.textMuted }}>Track games, ratings, and bragging rights.</p>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border p-5 text-center" style={{ background: C.card, borderColor: C.border }}>
          <div className="text-3xl font-bold tabular-nums" style={{ color: C.text }}>{stats.games}</div>
          <div className="text-sm mt-1" style={{ color: C.textMuted }}>Games logged</div>
        </div>
        <div className="rounded-2xl border p-5 text-center" style={{ background: C.card, borderColor: C.border }}>
          <div className="text-3xl font-bold tabular-nums" style={{ color: C.text }}>{stats.players}</div>
          <div className="text-sm mt-1" style={{ color: C.textMuted }}>Players</div>
        </div>
        {stats.topPlayer && (
          <div className="col-span-2 rounded-2xl border p-5 flex items-center gap-4" style={{ background: '#fffbeb', borderColor: '#f59e0b44' }}>
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold flex-shrink-0"
              style={{ background: stats.topPlayer.color, color: '#0a0a0a' }}>
              {stats.topPlayer.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium mb-0.5" style={{ color: '#b45309' }}>Current leader</div>
              <div className="font-bold truncate" style={{ color: C.text }}>{stats.topPlayer.name}</div>
              {rank && <div className="text-xs font-semibold mt-0.5" style={{ color: rank.color }}>{rank.chinese} {rank.title}</div>}
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-2xl font-bold tabular-nums" style={{ color: C.text }}>{Math.round(stats.topPlayer.rating)}</div>
              <div className="text-xs" style={{ color: C.textMuted }}>rating</div>
            </div>
          </div>
        )}
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { to: '/log', icon: PlusCircle, label: 'Log a game', desc: 'Record a session', color: '#f59e0b' },
          { to: '/ratings', icon: Trophy, label: 'Ratings', desc: 'See the leaderboard', color: '#a855f7' },
          { to: '/players', icon: Users, label: 'Players', desc: 'Manage your group', color: '#3b82f6' },
          { to: '/analytics', icon: BarChart2, label: 'Analytics', desc: 'Trends over time', color: '#22c55e' },
        ].map(({ to, icon: Icon, label, desc, color }) => (
          <Link key={to} to={to}
            className="rounded-2xl border p-5 flex items-center gap-3 transition-all hover:shadow-sm hover:border-amber-200 group"
            style={{ background: C.card, borderColor: C.border }}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: color + '18' }}>
              <Icon size={18} color={color} />
            </div>
            <div>
              <div className="font-semibold text-sm" style={{ color: C.text }}>{label}</div>
              <div className="text-xs" style={{ color: C.textMuted }}>{desc}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
