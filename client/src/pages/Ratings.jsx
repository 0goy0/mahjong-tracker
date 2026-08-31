import React, { useEffect, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';
import { TrendingUp, TrendingDown, Trophy } from 'lucide-react';
import { api } from '../api';
import { usePool, currentPoolLabel } from '../PoolContext';
import { getRank, RANKS } from '../labels';

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
};

const TOOLTIP_STYLE = {
  background: '#ffffff',
  border: '1px solid #e5e4e0',
  color: '#0a0a0a',
  borderRadius: 10,
  fontSize: 13,
  boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
};


function signed(v, digits = 0) {
  const n = Number(v);
  return (n > 0 ? '+' : '') + n.toFixed(digits);
}

function DeltaBadge({ delta }) {
  if (delta == null) return <span style={{ color: C.textFaint }}>—</span>;
  const up = delta >= 0;
  const color = up ? C.win : C.loss;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className="inline-flex items-center gap-1 font-semibold" style={{ color }}>
      <Icon size={12} />{signed(delta)}
    </span>
  );
}

const SORTS = {
  rating: { label: 'Rating', fn: (a, b) => b.rating - a.rating },
  chips_per_wind: { label: 'Chips/wind', fn: (a, b) => b.chips_per_wind - a.chips_per_wind },
  games_played: { label: 'Games', fn: (a, b) => b.games_played - a.games_played },
};

function Leaderboard({ rows, sort, setSort, selectedPlayer, onSelectPlayer }) {
  const sorted = [...rows].sort(SORTS[sort].fn);
  return (
    <div className="rounded-2xl border overflow-hidden" style={{ background: C.card, borderColor: C.border }}>
      <div className="flex items-center gap-2 px-5 py-3.5 border-b" style={{ borderColor: C.border, background: C.bgSubtle }}>
        <Trophy size={15} color="#f59e0b" />
        <span className="font-semibold text-sm" style={{ color: C.text }}>Leaderboard</span>
        <div className="ml-auto flex items-center gap-1">
          <span className="text-xs mr-1" style={{ color: C.textFaint }}>Sort by</span>
          {Object.entries(SORTS).map(([key, { label }]) => (
            <button key={key} onClick={() => setSort(key)}
              className="px-2.5 py-1 rounded-lg text-xs font-medium transition-colors"
              style={{
                background: sort === key ? '#f59e0b' : 'transparent',
                color: sort === key ? '#0a0a0a' : C.textMuted,
                border: `1px solid ${sort === key ? '#f59e0b' : C.border}`,
                cursor: 'pointer',
              }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr style={{ borderBottom: `1px solid ${C.border}` }}>
            <th className="text-left font-medium px-5 py-2.5 w-10" style={{ color: C.textFaint, fontSize: 11 }}>#</th>
            <th className="text-left font-medium px-2 py-2.5" style={{ color: C.textFaint, fontSize: 11 }}>PLAYER</th>
            <th className="text-right font-medium px-2 py-2.5" style={{ color: C.textFaint, fontSize: 11 }}>RATING</th>
            <th className="text-right font-medium px-2 py-2.5" style={{ color: C.textFaint, fontSize: 11 }}>PEAK</th>
            <th className="text-right font-medium px-2 py-2.5" style={{ color: C.textFaint, fontSize: 11 }}>GAMES</th>
            <th className="text-right font-medium px-2 py-2.5" style={{ color: C.textFaint, fontSize: 11 }}>W–L</th>
            <th className="text-right font-medium px-2 py-2.5" style={{ color: C.textFaint, fontSize: 11 }}>CHIPS/WIND</th>
            <th className="text-right font-medium px-5 py-2.5" style={{ color: C.textFaint, fontSize: 11 }}>LAST</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => {
            const active = selectedPlayer === r.player_id;
            const isLeader = i === 0;
            const rk = getRank(r.rating);
            const rowBg = active ? '#fffbeb' : isLeader ? '#fefce8' : 'transparent';
            return (
              <tr key={r.player_id} onClick={() => onSelectPlayer(r.player_id)}
                className="border-t cursor-pointer transition-colors hover:bg-amber-50/40"
                style={{ borderColor: C.borderMuted, background: rowBg }}>
                <td className="px-5 py-3.5 font-bold tabular-nums"
                  style={{ color: isLeader ? '#f59e0b' : C.textFaint, fontSize: isLeader ? 15 : 12 }}>{i + 1}</td>
                <td className="px-2 py-3.5">
                  <span className="flex items-center gap-2.5">
                    <span style={{ width: isLeader ? 12 : 10, height: isLeader ? 12 : 10, borderRadius: '50%', background: r.color, display: 'inline-block', flexShrink: 0 }} />
                    <span style={{ color: C.text, fontWeight: isLeader ? 600 : 500, fontSize: isLeader ? 15 : 14 }}>{r.name}</span>
                    {rk && (
                      <span className="text-xs px-1.5 py-0.5 rounded font-medium"
                        style={{ background: rk.color + '18', color: rk.color, border: `1px solid ${rk.color}33` }}>
                        {rk.chinese} {rk.title}
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-2 py-3.5 text-right tabular-nums"
                  style={{ fontWeight: 700, fontSize: isLeader ? 17 : 14, color: C.text }}>{r.rating.toFixed(0)}</td>
                <td className="px-2 py-3.5 text-right tabular-nums text-sm" style={{ color: C.textMuted }}>{r.peak_rating.toFixed(0)}</td>
                <td className="px-2 py-3.5 text-right tabular-nums text-sm" style={{ color: C.textMuted }}>{r.games_played}</td>
                <td className="px-2 py-3.5 text-right tabular-nums text-sm">
                  <span style={{ color: C.win }}>{r.wins}</span>
                  <span style={{ color: C.border }}>–</span>
                  <span style={{ color: C.loss }}>{r.losses}</span>
                </td>
                <td className="px-2 py-3.5 text-right tabular-nums text-sm font-medium"
                  style={{ color: r.chips_per_wind >= 0 ? C.win : C.loss }}>{signed(r.chips_per_wind, 2)}</td>
                <td className="px-5 py-3.5 text-right"><DeltaBadge delta={r.last_delta} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EloTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  return (
    <div style={{ ...TOOLTIP_STYLE, padding: '10px 14px', minWidth: 150 }}>
      <div style={{ color: C.textMuted, marginBottom: 4, fontWeight: 600, fontSize: 12 }}>{p.label}</div>
      <div className="flex items-center justify-between gap-4">
        <span style={{ color: C.textSec }}>Rating</span>
        <span style={{ color: C.text, fontWeight: 700 }}>{p.rating.toFixed(0)}</span>
      </div>
      {p.delta != null && (
        <div className="flex items-center justify-between gap-4">
          <span style={{ color: C.textSec }}>Change</span>
          <span style={{ color: p.delta >= 0 ? C.win : C.loss, fontWeight: 600 }}>{signed(p.delta)}</span>
        </div>
      )}
      {p.chips != null && (
        <div className="flex items-center justify-between gap-4">
          <span style={{ color: C.textSec }}>Chips</span>
          <span style={{ color: p.chips >= 0 ? C.win : C.loss, fontWeight: 600 }}>{signed(p.chips, 0)}</span>
        </div>
      )}
    </div>
  );
}

function PlayerPanel({ detail, color }) {
  if (!detail) return null;
  const { player, rating, peak_rating, games_played, rank, pool_players, timeline } = detail;

  const chartData = [];
  if (timeline.length) {
    chartData.push({ label: 'Start', rating: timeline[0].rating_before, delta: null, chips: null });
    for (const t of timeline) {
      chartData.push({ label: `G${t.seq}`, rating: t.rating_after, delta: t.delta, chips: t.chips, date: t.date });
    }
  }

  const rankInfo = getRank(rating);
  return (
    <div className="rounded-2xl border overflow-hidden"
      style={{ background: C.card, borderColor: rankInfo ? rankInfo.color + '55' : C.border }}>
      {/* Header with rank tint */}
      <div className="px-6 pt-6 pb-5" style={{ background: rankInfo ? rankInfo.color + '0a' : C.bgSubtle }}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span style={{ width: 14, height: 14, borderRadius: 7, background: color, display: 'inline-block', flexShrink: 0, marginTop: 5 }} />
            <div>
              <h3 className="font-bold text-xl" style={{ color: C.text }}>{player.name}</h3>
              {rankInfo && (
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-sm font-bold px-2 py-0.5 rounded-md"
                    style={{ background: rankInfo.color + '18', color: rankInfo.color, border: `1px solid ${rankInfo.color}44` }}>
                    {rankInfo.chinese} {rankInfo.title}
                  </span>
                  {rank && <span className="text-xs" style={{ color: C.textFaint }}>#{rank} of {pool_players}</span>}
                </div>
              )}
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="tabular-nums font-bold leading-none" style={{ fontSize: 48, color: C.text, letterSpacing: '-0.03em' }}>
              {rating != null ? rating.toFixed(0) : '—'}
            </div>
            <div className="text-xs mt-1.5" style={{ color: C.textMuted }}>
              Peak <span style={{ color: C.textSec, fontWeight: 600 }}>{peak_rating != null ? peak_rating.toFixed(0) : '—'}</span>
              <span style={{ color: C.border }}> · </span>
              <span style={{ color: C.textSec }}>{games_played} game{games_played !== 1 ? 's' : ''}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="px-6 pb-6 pt-2">
        {chartData.length > 1 ? (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ededeb" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} padding={{ left: 8, right: 8 }} />
              <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} width={44} domain={['dataMin - 30', 'dataMax + 30']} />
              <ReferenceLine y={1000} stroke="#e5e4e0" strokeDasharray="4 4"
                label={{ value: '1000', fill: '#c4c3bf', fontSize: 11, position: 'insideLeft' }} />
              <Tooltip content={<EloTooltip />} cursor={{ stroke: '#d4d3cf', strokeWidth: 1, strokeDasharray: '4 4' }} />
              <Line type="monotone" dataKey="rating" stroke={color} strokeWidth={2.5}
                dot={{ fill: color, r: 3, strokeWidth: 0 }}
                activeDot={{ r: 6, strokeWidth: 2, stroke: '#ffffff' }}
                isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p style={{ color: C.textMuted, fontSize: 14 }}>No rated games for this player in this pool yet.</p>
        )}
      </div>
    </div>
  );
}

export default function Ratings() {
  const { pool, pools } = usePool();
  const [rows, setRows] = useState([]);
  const [sort, setSort] = useState('rating');
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    if (!pool) { setRows([]); setSelectedPlayer(null); setDetail(null); return; }
    setSelectedPlayer(null);
    setDetail(null);
    api.getEloLeaderboard(pool).then(data => {
      const list = Array.isArray(data) ? data : [];
      setRows(list);
      if (list.length) setSelectedPlayer(list[0].player_id);
    });
  }, [pool]);

  useEffect(() => {
    if (!pool || !selectedPlayer) return;
    api.getEloPlayer(selectedPlayer, pool).then(d => {
      if (d && !d.error) setDetail(d);
    });
  }, [selectedPlayer, pool]);

  const selectedColor = (rows.find(r => r.player_id === selectedPlayer) || {}).color || '#f59e0b';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: '#0a0a0a' }}>Ratings</h1>
        <p className="text-sm mt-1" style={{ color: C.textMuted }}>
          Skill ratings for <span style={{ color: '#f59e0b', fontWeight: 600 }}>{currentPoolLabel(pool, pools)}</span>.
          {' '}Each mode-set + tai bound is its own Elo universe.
        </p>
      </div>

      {!pool ? (
        <div className="rounded-2xl border p-10 text-center" style={{ background: C.card, borderColor: C.border }}>
          <p style={{ color: C.textMuted }}>No games logged yet. Log a game to start building ratings.</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border p-10 text-center" style={{ background: C.card, borderColor: C.border }}>
          <p style={{ color: C.textMuted }}>No rated players in this pool yet.</p>
        </div>
      ) : (
        <>
          <Leaderboard rows={rows} sort={sort} setSort={setSort} selectedPlayer={selectedPlayer} onSelectPlayer={setSelectedPlayer} />
          <PlayerPanel detail={detail} color={selectedColor} />
        </>
      )}

      <RankChart currentRating={detail?.rating} />
    </div>
  );
}

function RankChart({ currentRating }) {
  const MAX = 3200;
  const tiers = [...RANKS].reverse(); // ascending order (Gooner first)

  return (
    <div className="rounded-2xl border overflow-hidden" style={{ background: C.card, borderColor: C.border }}>
      <div className="px-6 py-4 border-b" style={{ borderColor: C.border, background: C.bgSubtle }}>
        <h3 className="font-semibold" style={{ color: C.text }}>Rank Ladder</h3>
        <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>Points required to reach each tier</p>
      </div>
      <div className="p-6 space-y-3">
        {tiers.map((rank, i) => {
          const next = tiers[i + 1];
          const floor = rank.min;
          const ceiling = next ? next.min : MAX;
          const span = ceiling - floor;
          const barWidth = Math.min(100, (span / (MAX - 0)) * 100 * 3.5); // visual width scaled for readability
          const isCurrent = currentRating != null && currentRating >= floor && (!next || currentRating < next.min);
          const achieved = currentRating != null && currentRating >= floor;

          return (
            <div key={rank.title} className="flex items-center gap-4">
              {/* Rank label */}
              <div className="flex-shrink-0 text-right" style={{ width: 160 }}>
                <span className="text-sm font-bold" style={{ color: isCurrent ? rank.color : achieved ? rank.color + 'cc' : C.textFaint }}>
                  {rank.chinese} {rank.title}
                </span>
              </div>

              {/* Bar */}
              <div className="flex-1 relative h-7 rounded-lg overflow-hidden" style={{ background: C.bgSubtle, border: `1px solid ${C.border}` }}>
                <div className="h-full rounded-lg transition-all"
                  style={{
                    width: `${Math.max(4, barWidth)}%`,
                    background: achieved ? rank.color + (isCurrent ? 'dd' : '66') : rank.color + '22',
                  }} />
                {isCurrent && (
                  <div className="absolute inset-0 flex items-center px-3">
                    <span className="text-xs font-bold" style={{ color: '#0a0a0a' }}>YOU ARE HERE</span>
                  </div>
                )}
              </div>

              {/* Range */}
              <div className="flex-shrink-0 tabular-nums text-xs" style={{ width: 110, color: C.textMuted }}>
                {floor.toLocaleString()}
                {next ? ` – ${(next.min - 1).toLocaleString()}` : '+'}
              </div>

              {/* Gap to next */}
              <div className="flex-shrink-0 tabular-nums text-xs text-right" style={{ width: 80, color: C.textFaint }}>
                {next ? `${span.toLocaleString()} pts` : '∞'}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
