import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, TrendingUp, TrendingDown } from 'lucide-react';
import { api } from '../api';
import { modesLabel, SEAT_LABELS, getRank } from '../labels';
import { usePool, currentPoolLabel } from '../PoolContext';

const C = {
  card: '#ffffff',
  border: '#e5e4e0',
  borderMuted: '#ededeb',
  bg: '#fafaf8',
  bgSubtle: '#f5f5f2',
  text: '#0a0a0a',
  textSec: '#374151',
  textMuted: '#6b7280',
  textFaint: '#9ca3af',
  win: '#15803d',
  loss: '#dc2626',
  winBg: '#f0fdf4',
  lossBg: '#fef2f2',
};

function signed(v) { return (v > 0 ? '+' : '') + v; }

function DeltaChip({ delta }) {
  if (delta == null) return null;
  const up = delta >= 0;
  return (
    <span className="inline-flex items-center gap-0.5 text-xs font-semibold" style={{ color: up ? C.win : C.loss }}>
      {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {Math.abs(delta)}
    </span>
  );
}

export default function Dashboard() {
  const { pool, pools } = usePool();
  const [leaderboard, setLeaderboard] = useState([]);
  const [eloRows, setEloRows] = useState([]);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const eloFetch = pool ? api.getEloLeaderboard(pool) : Promise.resolve([]);
    Promise.all([api.getLeaderboard(pool), api.getGames(pool), eloFetch]).then(([lb, gs, elo]) => {
      setLeaderboard(Array.isArray(lb) ? lb : []);
      setGames(Array.isArray(gs) ? gs : []);
      setEloRows(Array.isArray(elo) ? elo : []);
      setLoading(false);
    });
  }, [pool]);

  if (loading) {
    return <div className="flex items-center justify-center h-64" style={{ color: C.textMuted }}>Loading…</div>;
  }

  const merged = eloRows.length
    ? eloRows.map(r => {
        const c = leaderboard.find(p => p.id === r.player_id) || {};
        return { ...r, id: r.player_id, total_chips: c.total_chips ?? null, avg_chips: c.avg_chips ?? null };
      })
    : leaderboard.map(p => ({ ...p, rating: null, last_delta: null }));

  const recentGames = games.slice(0, 8);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: '#0a0a0a' }}>Dashboard</h1>
        <p className="text-sm mt-1" style={{ color: C.textMuted }}>
          {currentPoolLabel(pool, pools)} · {games.length} game{games.length !== 1 ? 's' : ''} · {leaderboard.length} player{leaderboard.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Standings */}
      <div className="rounded-2xl border overflow-hidden" style={{ background: C.card, borderColor: C.border }}>
        <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: C.border }}>
          <h2 className="font-semibold" style={{ color: C.text }}>Standings</h2>
          <Link to="/ratings" className="text-xs font-medium" style={{ color: '#f59e0b' }}>Full ratings →</Link>
        </div>
        {merged.length === 0 ? (
          <div className="px-6 py-10 text-center" style={{ color: C.textMuted }}>
            No players yet. <Link to="/players" style={{ color: '#f59e0b' }} className="hover:underline">Add some players</Link> to get started.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}`, background: C.bgSubtle }}>
                  <th className="px-5 py-2.5 text-left font-medium w-10" style={{ color: C.textFaint, fontSize: 11 }}>#</th>
                  <th className="px-3 py-2.5 text-left font-medium" style={{ color: C.textFaint, fontSize: 11 }}>PLAYER</th>
                  <th className="px-3 py-2.5 text-right font-medium" style={{ color: C.textFaint, fontSize: 11 }}>RATING</th>
                  <th className="px-3 py-2.5 text-right font-medium" style={{ color: C.textFaint, fontSize: 11 }}>LAST</th>
                  <th className="px-3 py-2.5 text-right font-medium" style={{ color: C.textFaint, fontSize: 11 }}>CHIPS</th>
                  <th className="px-3 py-2.5 text-right font-medium" style={{ color: C.textFaint, fontSize: 11 }}>AVG</th>
                  <th className="px-5 py-2.5 text-right font-medium" style={{ color: C.textFaint, fontSize: 11 }}>W–L</th>
                </tr>
              </thead>
              <tbody>
                {merged.map((p, i) => {
                  const rankInfo = getRank(p.rating);
                  const isLeader = i === 0;
                  return (
                    <tr key={p.id}
                      style={{ borderBottom: `1px solid ${C.borderMuted}`, background: isLeader ? '#fffbeb' : 'transparent' }}
                      className="transition-colors hover:bg-amber-50/50">
                      <td className="px-5 py-3.5 font-bold tabular-nums"
                        style={{ color: isLeader ? '#f59e0b' : C.textFaint, fontSize: isLeader ? 15 : 12 }}>
                        {i + 1}
                      </td>
                      <td className="px-3 py-3.5">
                        <Link to={`/players/${p.id}`} className="flex items-center gap-2.5 hover:opacity-75 transition-opacity">
                          <span className="rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold"
                            style={{ width: isLeader ? 30 : 26, height: isLeader ? 30 : 26, background: p.color, color: '#0a0a0a' }}>
                            {p.name.charAt(0).toUpperCase()}
                          </span>
                          <div>
                            <div style={{ color: C.text, fontWeight: isLeader ? 600 : 500, fontSize: isLeader ? 15 : 14 }}>{p.name}</div>
                            {rankInfo && <div className="text-xs font-medium" style={{ color: rankInfo.color }}>{rankInfo.chinese} {rankInfo.title}</div>}
                          </div>
                        </Link>
                      </td>
                      <td className="px-3 py-3.5 text-right font-bold tabular-nums"
                        style={{ color: C.text, fontSize: isLeader ? 17 : 14 }}>
                        {p.rating != null ? p.rating : '—'}
                      </td>
                      <td className="px-3 py-3.5 text-right"><DeltaChip delta={p.last_delta} /></td>
                      <td className="px-3 py-3.5 text-right font-medium tabular-nums text-sm"
                        style={{ color: (p.total_chips ?? 0) >= 0 ? C.win : C.loss }}>
                        {p.total_chips != null ? signed(p.total_chips) : '—'}
                      </td>
                      <td className="px-3 py-3.5 text-right tabular-nums text-sm"
                        style={{ color: (p.avg_chips ?? 0) >= 0 ? C.win : C.loss }}>
                        {p.avg_chips != null ? (p.avg_chips > 0 ? '+' : '') + Number(p.avg_chips).toFixed(1) : '—'}
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums text-sm">
                        <span style={{ color: C.win }}>{p.wins ?? 0}</span>
                        <span style={{ color: C.border }}>–</span>
                        <span style={{ color: C.loss }}>{p.losses ?? 0}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent Games */}
      <div className="rounded-2xl border" style={{ background: C.card, borderColor: C.border }}>
        <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: C.border }}>
          <h2 className="font-semibold" style={{ color: C.text }}>Recent Games</h2>
          <Link to="/log" className="text-xs font-medium" style={{ color: '#f59e0b' }}>Log a game →</Link>
        </div>
        {recentGames.length === 0 ? (
          <div className="px-6 py-10 text-center" style={{ color: C.textMuted }}>No games logged yet.</div>
        ) : (
          <div className="divide-y" style={{ borderColor: C.borderMuted }}>
            {recentGames.map(game => (
              <div key={game.id} className="px-6 py-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <span className="text-sm font-semibold" style={{ color: C.text }}>{game.date}</span>
                    <span className="text-xs px-2 py-0.5 rounded-md font-medium"
                      style={{ background: C.bgSubtle, color: C.textSec, border: `1px solid ${C.border}` }}>
                      {modesLabel(game.modes)}
                    </span>
                  </div>
                  <Link to={`/log/${game.id}`}
                    className="flex items-center gap-1 text-xs transition-colors hover:text-amber-500"
                    style={{ color: C.textFaint }}>
                    <Pencil size={11} /> Edit
                  </Link>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[...game.seats].sort((a, b) => b.chips - a.chips).map(s => (
                    <div key={s.id} className="flex items-center justify-between rounded-xl px-3 py-2.5"
                      style={{ background: C.bgSubtle, border: `1px solid ${C.border}` }}>
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold"
                          style={{ background: s.player_color, color: '#0a0a0a' }}>
                          {s.player_name.charAt(0).toUpperCase()}
                        </span>
                        <span className="text-sm font-medium" style={{ color: C.textSec }}>{s.player_name}</span>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-bold tabular-nums"
                          style={{ color: s.chips > 0 ? C.win : s.chips < 0 ? C.loss : C.textMuted }}>
                          {s.chips > 0 ? '+' : ''}{s.chips}
                        </div>
                        {s.elo_delta != null && <DeltaChip delta={s.elo_delta} />}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
