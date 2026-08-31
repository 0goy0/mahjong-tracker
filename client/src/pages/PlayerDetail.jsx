import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  AreaChart, Area, CartesianGrid, Cell, ReferenceLine,
} from 'recharts';
import { ArrowLeft, Pencil, Check, X, Users } from 'lucide-react';
import { api } from '../api';
import { usePool, currentPoolLabel } from '../PoolContext';
import { getRank } from '../labels';

const COLOR_PRESETS = [
  '#f59e0b', '#ef4444', '#22c55e', '#3b82f6', '#a855f7',
  '#ec4899', '#14b8a6', '#f97316', '#84cc16', '#06b6d4',
];

const C = {
  card: '#ffffff', border: '#e5e4e0', borderMuted: '#ededeb',
  bg: '#fafaf8', bgSubtle: '#f5f5f2',
  text: '#0a0a0a', textSec: '#374151', textMuted: '#6b7280', textFaint: '#9ca3af',
  win: '#15803d', loss: '#dc2626',
};

const TOOLTIP_STYLE = {
  background: '#ffffff',
  border: '1px solid #e5e4e0',
  color: '#0a0a0a',
  borderRadius: 10,
  fontSize: 13,
  boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
};

function initials(name) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function chipColor(v) {
  return v > 0 ? C.win : v < 0 ? C.loss : C.textMuted;
}

function signed(v) {
  return (v > 0 ? '+' : '') + v;
}

const inputStyle = {
  background: '#ffffff', border: '1px solid #d4d3cf', borderRadius: 8,
  color: '#0a0a0a', padding: '6px 10px', outline: 'none', fontSize: 14,
};

export default function PlayerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { pool, pools } = usePool();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [eloData, setEloData] = useState(null);
  const [tab, setTab] = useState('pools');
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    const [data, elo] = await Promise.all([
      api.getPlayerStats(id, pool),
      pool ? api.getEloPlayer(id, pool) : Promise.resolve(null),
    ]);
    if (!data.error) {
      setStats(data);
      setEditName(data.name);
      setEditColor(data.color);
    }
    setEloData(elo && !elo.error ? elo : null);
    setLoading(false);
  }

  useEffect(() => { load(); }, [id, pool]);

  async function saveEdit() {
    setSaving(true);
    await api.updatePlayer(id, { name: editName, color: editColor });
    setSaving(false);
    setEditing(false);
    load();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span style={{ color: C.textMuted }}>Loading...</span>
      </div>
    );
  }

  if (!stats) {
    return <div className="text-center py-16" style={{ color: C.textMuted }}>Player not found.</div>;
  }

  const winRate = stats.games_played
    ? ((stats.wins / stats.games_played) * 100).toFixed(1) + '%'
    : '0.0%';

  const poolData = (stats.byPool || []).map(r => ({
    pool: r.label,
    chips: r.total_chips,
    games: r.games,
    wins: r.wins,
    losses: r.losses,
    winRate: r.win_rate,
  }));

  const usualPartner = (stats.opponents || [])[0];
  const rankInfo = getRank(eloData?.rating);
  const avgChips = stats.games_played
    ? (stats.total_chips / stats.games_played).toFixed(1)
    : null;

  const statCards = [
    ...(eloData?.rating != null ? [{
      label: 'Rating',
      value: Math.round(eloData.rating),
      sub: rankInfo ? `${rankInfo.chinese} ${rankInfo.title}` : null,
      color: rankInfo?.color || C.text,
      accent: true,
      accentColor: rankInfo?.color || '#f59e0b',
    }] : []),
    { label: 'Games', value: stats.games_played || 0 },
    { label: 'Win Rate', value: winRate },
    {
      label: 'Total Chips',
      value: signed(stats.total_chips || 0),
      color: chipColor(stats.total_chips || 0),
    },
    {
      label: 'Avg Chips/Game',
      value: avgChips != null ? (Number(avgChips) > 0 ? '+' : '') + avgChips : '—',
      color: avgChips != null ? chipColor(Number(avgChips)) : C.textMuted,
    },
    {
      label: 'Biggest Win',
      value: stats.best_game != null && stats.best_game > 0 ? signed(stats.best_game) : '—',
      color: C.win,
    },
    {
      label: 'Biggest Loss',
      value: stats.worst_game != null && stats.worst_game < 0 ? signed(stats.worst_game) : '—',
      color: C.loss,
    },
  ];

  return (
    <div className="space-y-8">
      <button
        onClick={() => navigate('/players')}
        className="flex items-center gap-2 text-sm transition-colors hover:opacity-70"
        style={{ color: C.textMuted, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        <ArrowLeft size={16} /> Back to Players
      </button>

      {/* Header */}
      <div className="flex items-center gap-5">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold flex-shrink-0"
          style={{ background: stats.color, color: '#0a0a0a' }}
        >
          {initials(stats.name)}
        </div>
        <div className="flex-1">
          {editing ? (
            <div className="flex items-center gap-3 flex-wrap">
              <input value={editName} onChange={e => setEditName(e.target.value)} style={{ ...inputStyle, width: 200 }} />
              <div className="flex gap-1">
                {COLOR_PRESETS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setEditColor(c)}
                    className="w-6 h-6 rounded-full"
                    style={{ background: c, border: editColor === c ? '2px solid #0a0a0a' : '2px solid transparent', cursor: 'pointer' }}
                  />
                ))}
              </div>
              <button onClick={saveEdit} disabled={saving}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium"
                style={{ background: '#22c55e', color: '#ffffff', border: 'none', cursor: 'pointer' }}>
                <Check size={14} /> Save
              </button>
              <button onClick={() => setEditing(false)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium"
                style={{ background: C.bgSubtle, color: C.textMuted, border: `1px solid ${C.border}`, cursor: 'pointer' }}>
                <X size={14} /> Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold" style={{ color: C.text }}>{stats.name}</h1>
              {rankInfo && (
                <span className="text-sm font-semibold px-2.5 py-0.5 rounded-lg"
                  style={{ background: rankInfo.color + '18', color: rankInfo.color, border: `1px solid ${rankInfo.color}44` }}>
                  {rankInfo.chinese} {rankInfo.title}
                </span>
              )}
              <button onClick={() => setEditing(true)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs"
                style={{ background: C.bgSubtle, color: C.textMuted, border: `1px solid ${C.border}`, cursor: 'pointer' }}>
                <Pencil size={12} /> Edit
              </button>
              {usualPartner && (
                <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg"
                  style={{ background: C.bgSubtle, color: C.textMuted, border: `1px solid ${C.border}` }}>
                  <Users size={12} /> Usually plays with <span style={{ color: C.text, fontWeight: 600, marginLeft: 3 }}>{usualPartner.name}</span>
                  <span style={{ color: C.textFaint, marginLeft: 2 }}>({usualPartner.games_together})</span>
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Scope */}
      <div className="text-xs rounded-lg px-3 py-2 inline-block"
        style={{ color: C.textMuted, background: C.bgSubtle, border: `1px solid ${C.border}` }}>
        Showing stats for <span style={{ color: '#f59e0b', fontWeight: 600 }}>{currentPoolLabel(pool, pools)}</span>
        {' — switch pools in the bar above'}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {statCards.map(s => (
          <div key={s.label} className="rounded-2xl border p-4 flex flex-col gap-1"
            style={{
              background: s.accent ? (s.accentColor + '0a') : C.card,
              borderColor: s.accent ? (s.accentColor + '55') : C.border,
            }}>
            <span className="text-xs" style={{ color: C.textFaint }}>{s.label}</span>
            <span className="text-xl font-bold tabular-nums" style={{ color: s.color || C.text }}>{s.value}</span>
            {s.sub && <span className="text-xs font-medium" style={{ color: s.accentColor || C.textMuted }}>{s.sub}</span>}
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div>
        <div className="flex gap-1 mb-6 border-b" style={{ borderColor: C.border }}>
          {['pools', 'history', 'opponents'].map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-4 py-2.5 text-sm font-medium capitalize transition-colors"
              style={{
                background: 'none',
                border: 'none',
                borderBottom: tab === t ? '2px solid #f59e0b' : '2px solid transparent',
                color: tab === t ? '#f59e0b' : C.textMuted,
                cursor: 'pointer',
                marginBottom: -1,
              }}
            >
              {t === 'pools' ? 'By Pool' : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {tab === 'pools' && (
          <div className="space-y-6">
            <div className="rounded-2xl border overflow-hidden" style={{ background: C.card, borderColor: C.border }}>
              <div className="px-6 py-4 border-b" style={{ borderColor: C.border, background: C.bgSubtle }}>
                <h3 className="font-semibold" style={{ color: C.text }}>Performance by Pool</h3>
                <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>
                  Every rule-set this player has played — each is its own universe.
                </p>
              </div>
              {poolData.length === 0 ? (
                <div className="px-6 py-8 text-center" style={{ color: C.textMuted }}>No games yet.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                      {['Pool', 'Games', 'Wins', 'Losses', 'Win Rate', 'Chips'].map(h => (
                        <th key={h} className="px-4 py-3 text-left font-medium" style={{ color: C.textFaint, fontSize: 11 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {poolData.map(m => (
                      <tr key={m.pool} style={{ borderBottom: `1px solid ${C.borderMuted}` }} className="hover:bg-stone-50 transition-colors">
                        <td className="px-4 py-3 font-medium" style={{ color: C.text }}>{m.pool}</td>
                        <td className="px-4 py-3 tabular-nums" style={{ color: C.textMuted }}>{m.games}</td>
                        <td className="px-4 py-3 tabular-nums font-medium" style={{ color: C.win }}>{m.wins}</td>
                        <td className="px-4 py-3 tabular-nums font-medium" style={{ color: C.loss }}>{m.losses}</td>
                        <td className="px-4 py-3 tabular-nums" style={{ color: C.textSec }}>{m.winRate}%</td>
                        <td className="px-4 py-3 tabular-nums font-semibold" style={{ color: chipColor(m.chips) }}>{signed(m.chips)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {poolData.length > 0 && (
              <div className="rounded-2xl border p-6" style={{ background: C.card, borderColor: C.border }}>
                <h3 className="font-semibold mb-4" style={{ color: C.text }}>Chips by Pool</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={poolData} barSize={44}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ededeb" vertical={false} />
                    <XAxis dataKey="pool" tick={{ fill: C.textFaint, fontSize: 13 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: C.textFaint, fontSize: 12 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: '#00000006' }} />
                    <Bar dataKey="chips" name="Chips" radius={[6, 6, 0, 0]}>
                      {poolData.map(m => (
                        <Cell key={m.pool} fill={m.chips >= 0 ? '#22c55e' : '#ef4444'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {tab === 'history' && (
          <div className="rounded-2xl border p-6" style={{ background: C.card, borderColor: C.border }}>
            <h3 className="font-semibold mb-4" style={{ color: C.text }}>Cumulative Chips Over Time</h3>
            {(stats.cumulativeHistory || []).length <= 1 ? (
              <p style={{ color: C.textMuted, fontSize: 14 }}>No game history yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <AreaChart data={stats.cumulativeHistory} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <defs>
                    <linearGradient id="chipFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={stats.color || '#f59e0b'} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={stats.color || '#f59e0b'} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ededeb" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: C.textFaint, fontSize: 12 }} axisLine={{ stroke: C.border }} tickLine={false} padding={{ left: 8, right: 8 }} />
                  <YAxis tick={{ fill: C.textFaint, fontSize: 12 }} axisLine={false} tickLine={false} width={44} />
                  <ReferenceLine y={0} stroke={C.border} strokeWidth={1.5} />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(v) => [signed(v), 'Cumulative']}
                    cursor={{ stroke: '#d4d3cf', strokeWidth: 1, strokeDasharray: '4 4' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="cumulative"
                    name="Cumulative Chips"
                    stroke={stats.color || '#f59e0b'}
                    strokeWidth={2.5}
                    fill="url(#chipFill)"
                    dot={{ fill: stats.color || '#f59e0b', r: 3, strokeWidth: 0 }}
                    activeDot={{ r: 6, strokeWidth: 2, stroke: '#ffffff' }}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        )}

        {tab === 'opponents' && (
          <div className="rounded-2xl border overflow-hidden" style={{ background: C.card, borderColor: C.border }}>
            <div className="px-6 py-4 border-b" style={{ borderColor: C.border, background: C.bgSubtle }}>
              <h3 className="font-semibold" style={{ color: C.text }}>Head-to-Head Records</h3>
              <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>
                Chips reflect the direct flow between you and each opponent.
              </p>
            </div>
            {(stats.opponents || []).length === 0 ? (
              <div className="px-6 py-8 text-center" style={{ color: C.textMuted }}>No opponents yet.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    {['Opponent', 'Games Together', 'Net Chips vs Them'].map(h => (
                      <th key={h} className="px-4 py-3 text-left font-medium" style={{ color: C.textFaint, fontSize: 11 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(stats.opponents || []).map(opp => (
                    <tr key={opp.id} style={{ borderBottom: `1px solid ${C.borderMuted}` }} className="hover:bg-stone-50 transition-colors">
                      <td className="px-4 py-3">
                        <button
                          onClick={() => navigate(`/players/${opp.id}`)}
                          className="flex items-center gap-2 hover:opacity-75"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                        >
                          <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                            style={{ background: opp.color, color: '#0a0a0a' }}>
                            {opp.name.charAt(0).toUpperCase()}
                          </span>
                          <span style={{ color: C.text }}>{opp.name}</span>
                        </button>
                      </td>
                      <td className="px-4 py-3 tabular-nums" style={{ color: C.textMuted }}>{opp.games_together}</td>
                      <td className="px-4 py-3 tabular-nums font-semibold" style={{ color: chipColor(opp.my_chips) }}>{signed(opp.my_chips)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
