import React, { useEffect, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  BarChart, Bar, PieChart, Pie, Cell,
} from 'recharts';
import { api } from '../api';
import { usePool, currentPoolLabel } from '../PoolContext';

const MODE_COLORS = ['#f59e0b', '#3b82f6', '#22c55e', '#a855f7', '#ec4899', '#14b8a6', '#f97316', '#84cc16', '#06b6d4', '#ef4444'];

const C = {
  card: '#ffffff', border: '#e5e4e0', bg: '#fafaf8', bgSubtle: '#f5f5f2',
  text: '#0a0a0a', textSec: '#374151', textMuted: '#6b7280', textFaint: '#9ca3af',
  win: '#15803d', loss: '#dc2626',
};

const TOOLTIP_STYLE = {
  background: '#ffffff', border: '1px solid #e5e4e0', color: '#0a0a0a',
  borderRadius: 10, fontSize: 13, boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
};

function Card({ title, subtitle, children }) {
  return (
    <div className="rounded-2xl border p-6" style={{ background: C.card, borderColor: C.border }}>
      <h3 className="font-semibold" style={{ color: C.text }}>{title}</h3>
      {subtitle && <p className="text-xs mt-0.5 mb-4" style={{ color: C.textMuted }}>{subtitle}</p>}
      {!subtitle && <div className="mb-4" />}
      {children}
    </div>
  );
}

function Empty({ msg }) {
  return <p style={{ color: C.textMuted, fontSize: 14 }}>{msg}</p>;
}

function signed(v) {
  return (v > 0 ? '+' : '') + v;
}

function WealthTooltip({ active, payload, label, nameById }) {
  if (!active || !payload || !payload.length) return null;
  const rows = [...payload].filter(p => p.value != null).sort((a, b) => b.value - a.value);
  return (
    <div style={{ ...TOOLTIP_STYLE, padding: '10px 12px', minWidth: 150 }}>
      <div style={{ color: C.textMuted, marginBottom: 6, fontWeight: 600 }}>{label}</div>
      {rows.map(r => (
        <div key={r.dataKey} className="flex items-center justify-between gap-4" style={{ marginBottom: 2 }}>
          <span className="flex items-center gap-1.5">
            <span style={{ width: 8, height: 8, borderRadius: 4, background: r.color, display: 'inline-block' }} />
            <span style={{ color: C.textSec }}>{nameById[r.dataKey] || r.name}</span>
          </span>
          <span style={{ color: r.value >= 0 ? C.win : C.loss, fontWeight: 600 }}>{signed(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function Analytics() {
  const { pool, pools } = usePool();
  const [history, setHistory] = useState({ players: [], history: [] });
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hidden, setHidden] = useState({});

  useEffect(() => {
    setLoading(true);
    Promise.all([api.getHistory(pool), api.getLeaderboard(pool)]).then(([h, lb]) => {
      setHistory(h && !h.error ? h : { players: [], history: [] });
      setLeaderboard(Array.isArray(lb) ? lb : []);
      setLoading(false);
    });
  }, [pool]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span style={{ color: C.textMuted }}>Loading...</span>
      </div>
    );
  }

  const players = history.players || [];
  const nameById = {};
  for (const p of players) nameById[p.id] = p.name;

  const poolData = pools.map(p => ({ name: p.label, value: p.games }));

  const topPerformers = [...leaderboard]
    .filter(p => p.games_played)
    .sort((a, b) => (b.total_chips || 0) - (a.total_chips || 0))
    .slice(0, 10)
    .map(p => ({ name: p.name, chips: p.total_chips || 0 }));

  const hasHistory = history.history.length > 1 && players.length > 0;

  function toggle(pid) {
    setHidden(prev => ({ ...prev, [pid]: !prev[pid] }));
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: C.text }}>Analytics</h1>
        <p className="text-sm mt-1" style={{ color: C.textMuted }}>
          Trends and breakdowns · <span style={{ color: '#f59e0b', fontWeight: 600 }}>{currentPoolLabel(pool, pools)}</span>
        </p>
      </div>

      {/* Cumulative wealth */}
      <Card
        title="Cumulative Chip Wealth"
        subtitle="Each player's running chip total over time. Click a name below to show/hide a line."
      >
        {!hasHistory ? (
          <Empty msg="No game history in this pool yet." />
        ) : (
          <>
            <div className="flex flex-wrap gap-2 mb-4">
              {players.map(p => {
                const off = hidden[p.id];
                return (
                  <button
                    key={p.id}
                    onClick={() => toggle(p.id)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-opacity"
                    style={{
                      background: off ? C.bgSubtle : p.color + '18',
                      border: `1px solid ${off ? C.border : p.color + '55'}`,
                      color: off ? C.textFaint : p.color,
                      opacity: off ? 0.6 : 1,
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ width: 9, height: 9, borderRadius: 5, background: off ? C.textFaint : p.color, display: 'inline-block' }} />
                    {p.name}
                  </button>
                );
              })}
            </div>
            <ResponsiveContainer width="100%" height={380}>
              <LineChart data={history.history} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ededeb" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: C.textFaint, fontSize: 12 }} axisLine={{ stroke: C.border }} tickLine={false} padding={{ left: 8, right: 8 }} />
                <YAxis tick={{ fill: C.textFaint, fontSize: 12 }} axisLine={false} tickLine={false} width={44} />
                <ReferenceLine y={0} stroke={C.border} strokeWidth={1.5} />
                <Tooltip content={<WealthTooltip nameById={nameById} />} cursor={{ stroke: '#d4d3cf', strokeWidth: 1, strokeDasharray: '4 4' }} />
                {players.map(p => (
                  <Line
                    key={p.id}
                    type="monotone"
                    dataKey={String(p.id)}
                    name={p.name}
                    stroke={p.color}
                    strokeWidth={2.5}
                    dot={{ fill: p.color, r: 2.5, strokeWidth: 0 }}
                    activeDot={{ r: 6, strokeWidth: 2, stroke: '#ffffff' }}
                    connectNulls
                    hide={!!hidden[p.id]}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Games by Pool" subtitle="How many games each rule-set pool has been played in.">
          {poolData.length === 0 ? (
            <Empty msg="No games logged yet." />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={poolData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                  innerRadius={55} outerRadius={100} paddingAngle={2}
                  label={({ name, value }) => `${name} (${value})`} labelLine={false}>
                  {poolData.map((entry, i) => (
                    <Cell key={entry.name} fill={MODE_COLORS[i % MODE_COLORS.length]} stroke="#ffffff" strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Top Performers" subtitle={`Total chips in ${currentPoolLabel(pool, pools)}.`}>
          {topPerformers.length === 0 ? (
            <Empty msg="No player results in this mode yet." />
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(300, topPerformers.length * 40)}>
              <BarChart data={topPerformers} layout="vertical" margin={{ left: 10, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ededeb" horizontal={false} />
                <XAxis type="number" tick={{ fill: C.textFaint, fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={90} tick={{ fill: C.textSec, fontSize: 13 }} axisLine={false} tickLine={false} />
                <ReferenceLine x={0} stroke={C.border} />
                <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: '#00000006' }} formatter={(v) => signed(v)} />
                <Bar dataKey="chips" name="Total Chips" radius={[0, 6, 6, 0]}>
                  {topPerformers.map(p => (
                    <Cell key={p.name} fill={p.chips >= 0 ? '#22c55e' : '#ef4444'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>
    </div>
  );
}
