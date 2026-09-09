import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  ComposedChart, Bar, Cell, PieChart, Pie, AreaChart, Area,
} from 'recharts';
import { Swords, Coins, Medal, Dices, TrendingUp, TrendingDown, Crown } from 'lucide-react';
import { C, TOOLTIP_STYLE, CHART } from '../theme';

// Podium ramp: good → bad, instantly legible on dark.
const PLACE = [
  { label: '1st', color: '#34d399' },
  { label: '2nd', color: '#a3e635' },
  { label: '3rd', color: '#fb923c' },
  { label: '4th', color: '#f87171' },
];

const signed = (v, d = 0) => (Number(v) > 0 ? '+' : '') + Number(v).toFixed(d);
const shortDate = (s) => (s ? s.slice(5) : ''); // MM-DD

// A section shell. `hero` gives the race its heavier, more premium treatment.
function Section({ icon: Icon, title, subtitle, right, hero, accent = '#e8b04b', children }) {
  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{
        background: C.card,
        borderColor: hero ? accent + '44' : C.border,
        boxShadow: hero ? '0 20px 48px -20px rgba(0,0,0,0.65)' : '0 1px 3px rgba(0,0,0,0.4)',
      }}
    >
      <div
        className="flex items-center gap-3 px-6 py-4 border-b"
        style={{ borderColor: C.border, background: hero ? accent + '0c' : C.bgSubtle }}
      >
        <span
          className="flex items-center justify-center rounded-lg flex-shrink-0"
          style={{ width: 30, height: 30, background: accent + '1a', color: accent }}
        >
          <Icon size={16} strokeWidth={2.25} />
        </span>
        <div className="min-w-0">
          <h3 className="font-semibold leading-tight truncate" style={{ color: C.text, fontSize: hero ? 16 : 14.5 }}>{title}</h3>
          {subtitle && <p className="text-xs mt-0.5 truncate" style={{ color: C.textMuted }}>{subtitle}</p>}
        </div>
        {right && <div className="ml-auto flex-shrink-0">{right}</div>}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

function Empty({ msg }) {
  return (
    <div className="flex items-center justify-center py-10 rounded-xl" style={{ background: C.bgSubtle, border: `1px dashed ${C.border}` }}>
      <span style={{ color: C.textMuted, fontSize: 13.5 }}>{msg}</span>
    </div>
  );
}

// ─── Pool Race ──────────────────────────────────────────────────────────────
// Every player's rating trajectory over the pool timeline. The one animated
// moment on the page: lines draw in left-to-right like a race to the finish.
export function PoolRace({ data, selected, onSelect }) {
  const players = data?.players || [];
  const steps = data?.steps || [];
  const [off, setOff] = useState({});

  if (steps.length < 2 || players.length === 0) {
    return (
      <Section icon={Swords} title="The Race" subtitle="Every player's rating over time in this pool" hero>
        <Empty msg="Log a few games in this pool to watch the ratings diverge." />
      </Section>
    );
  }

  const leader = players[0];
  const toggle = (pid) => setOff((p) => ({ ...p, [pid]: !p[pid] }));

  return (
    <Section
      icon={Swords}
      title="The Race"
      subtitle={`${players.length} players · ${steps.length} games · leader ${leader.name} at ${leader.rating}`}
      hero
    >
      <div className="flex flex-wrap gap-1.5 mb-5">
        {players.map((p) => {
          const hidden = off[p.player_id];
          const isSel = selected === p.player_id;
          return (
            <button
              key={p.player_id}
              onClick={() => (onSelect ? onSelect(p.player_id) : toggle(p.player_id))}
              onDoubleClick={() => toggle(p.player_id)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all"
              style={{
                background: hidden ? C.bgSubtle : isSel ? p.color + '1f' : p.color + '12',
                border: `1px solid ${hidden ? C.border : isSel ? p.color : p.color + '44'}`,
                color: hidden ? C.textFaint : p.color,
                opacity: hidden ? 0.55 : 1,
                boxShadow: isSel && !hidden ? `0 0 0 1px ${p.color}55` : 'none',
                cursor: 'pointer',
              }}
              title="Click to focus · double-click to hide"
            >
              <span style={{ width: 8, height: 8, borderRadius: 4, background: hidden ? C.textFaint : p.color, display: 'inline-block' }} />
              {p.name}
              <span className="tabular-nums" style={{ color: hidden ? C.textFaint : p.color, opacity: 0.75 }}>{p.rating}</span>
            </button>
          );
        })}
      </div>

      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={steps} margin={{ top: 8, right: 14, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fill: C.textFaint, fontSize: 11 }}
            axisLine={{ stroke: C.border }} tickLine={false} minTickGap={44} padding={{ left: 8, right: 8 }} />
          <YAxis tick={{ fill: C.textFaint, fontSize: 11 }} axisLine={false} tickLine={false} width={40}
            domain={['dataMin - 40', 'dataMax + 40']} />
          <ReferenceLine y={1000} stroke={CHART.ref} strokeDasharray="4 4"
            label={{ value: 'start 1000', fill: C.textFaint, fontSize: 10, position: 'insideBottomLeft' }} />
          <Tooltip content={<RaceTooltip players={players} off={off} selected={selected} />}
            cursor={{ stroke: CHART.cursor, strokeWidth: 1, strokeDasharray: '4 4' }} />
          {players.map((p) => {
            const dim = selected != null && selected !== p.player_id;
            return (
              <Line
                key={p.player_id}
                type="monotone"
                dataKey={String(p.player_id)}
                name={p.name}
                stroke={p.color}
                strokeWidth={selected === p.player_id ? 3.25 : 2}
                strokeOpacity={off[p.player_id] ? 0 : dim ? 0.28 : 1}
                dot={false}
                activeDot={off[p.player_id] ? false : { r: 5, strokeWidth: 2, stroke: CHART.dotRing }}
                connectNulls
                hide={!!off[p.player_id]}
                isAnimationActive={false}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </Section>
  );
}

function RaceTooltip({ active, payload, label, players, off, selected }) {
  if (!active || !payload || !payload.length) return null;
  const nameById = Object.fromEntries(players.map((p) => [String(p.player_id), p]));
  let rows = payload
    .filter((r) => r.value != null && !off[r.dataKey])
    .map((r) => ({ ...r, player: nameById[r.dataKey] }))
    .sort((a, b) => b.value - a.value);
  if (selected != null) rows = rows.filter((r) => r.dataKey === String(selected)).concat(rows.filter((r) => r.dataKey !== String(selected)));
  const shown = rows.slice(0, 6);
  return (
    <div style={{ ...TOOLTIP_STYLE, padding: '10px 12px', minWidth: 150 }}>
      <div style={{ color: C.textMuted, marginBottom: 6, fontWeight: 600, fontSize: 12 }}>{label}</div>
      {shown.map((r, i) => (
        <div key={r.dataKey} className="flex items-center justify-between gap-4" style={{ marginBottom: 2 }}>
          <span className="flex items-center gap-1.5">
            {i === 0 ? <Crown size={12} color={C.gold} strokeWidth={2.5} /> : <span style={{ width: 8, height: 8, borderRadius: 4, background: r.color, display: 'inline-block' }} />}
            <span style={{ color: C.textSec, fontWeight: r.dataKey === String(selected) ? 700 : 500 }}>
              {r.player?.name || r.name}
            </span>
          </span>
          <span className="tabular-nums" style={{ color: C.text, fontWeight: 700 }}>{Math.round(r.value)}</span>
        </div>
      ))}
      {rows.length > shown.length && <div style={{ color: C.textFaint, fontSize: 11, marginTop: 2 }}>+{rows.length - shown.length} more</div>}
    </div>
  );
}

// ─── Chips per wind ───────────────────────────────────────────────────────────
// Per-game chips/wind (the great equalizer), with a 5-game form average so a
// hot night reads differently from a real trend.
export function ChipsPerWind({ timeline, color, name }) {
  const data = useMemo(() => {
    const rows = (timeline || []).map((t) => ({
      label: `G${t.seq}`, date: t.date,
      cpw: t.winds ? +(t.chips / t.winds).toFixed(1) : t.chips,
      chips: t.chips, winds: t.winds,
    }));
    const W = 5;
    return rows.map((r, i) => {
      const from = Math.max(0, i - W + 1);
      const slice = rows.slice(from, i + 1);
      return { ...r, avg: +(slice.reduce((s, x) => s + x.cpw, 0) / slice.length).toFixed(1) };
    });
  }, [timeline]);

  const lifetime = data.length ? +(data.reduce((s, x) => s + x.cpw, 0) / data.length).toFixed(1) : 0;

  return (
    <Section
      icon={Coins}
      title="Chips per wind"
      subtitle="Normalised so 4-wind and 7-wind games compare fairly"
      accent="#d97706"
      right={
        <span className="text-xs px-2 py-1 rounded-lg tabular-nums font-semibold"
          style={{ background: (lifetime >= 0 ? C.win : C.loss) + '14', color: lifetime >= 0 ? C.win : C.loss }}>
          avg {signed(lifetime, 1)}/wind
        </span>
      }
    >
      {data.length < 1 ? (
        <Empty msg="No rated games yet." />
      ) : (
        <ResponsiveContainer width="100%" height={230}>
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
            <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fill: C.textFaint, fontSize: 10.5 }} axisLine={false} tickLine={false} minTickGap={36} />
            <YAxis tick={{ fill: C.textFaint, fontSize: 10.5 }} axisLine={false} tickLine={false} width={34} />
            <ReferenceLine y={0} stroke={CHART.ref} strokeWidth={1.5} />
            <Tooltip content={<CpwTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
            <Bar dataKey="cpw" name="This game" radius={[3, 3, 0, 0]} maxBarSize={26} isAnimationActive={false}>
              {data.map((d, i) => <Cell key={i} fill={d.cpw >= 0 ? CHART.pos : CHART.neg} fillOpacity={0.55} />)}
            </Bar>
            <Line type="monotone" dataKey="avg" name="5-game form" stroke={color || C.gold} strokeWidth={2.5}
              dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: CHART.dotRing }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </Section>
  );
}

function CpwTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  return (
    <div style={{ ...TOOLTIP_STYLE, padding: '9px 12px' }}>
      <div style={{ color: C.textMuted, marginBottom: 4, fontWeight: 600, fontSize: 12 }}>{p.date} · {p.label}</div>
      <Row label="Chips/wind" value={signed(p.cpw, 1)} color={p.cpw >= 0 ? C.win : C.loss} />
      <Row label="5-game form" value={signed(p.avg, 1)} color={p.avg >= 0 ? C.win : C.loss} />
      <Row label="Net chips" value={`${signed(p.chips)} · ${p.winds}w`} color={C.textSec} />
    </div>
  );
}

// ─── Placement distribution ────────────────────────────────────────────────────
export function PlacementDistribution({ games, playerId, name }) {
  const { counts, total, avg, firstRate } = useMemo(() => computePlacement(games, playerId), [games, playerId]);
  const pieData = PLACE.map((p, i) => ({ ...p, value: counts[i] })).filter((d) => d.value > 0);

  return (
    <Section icon={Medal} title="Where they finish" subtitle="Placement by chips across every game in this pool" accent="#0284c7">
      {total === 0 ? (
        <Empty msg="No finishes recorded yet." />
      ) : (
        <div className="flex items-center gap-5">
          <div className="relative flex-shrink-0" style={{ width: 148, height: 148 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="label" cx="50%" cy="50%"
                  innerRadius={48} outerRadius={70} paddingAngle={3} stroke={C.card} strokeWidth={2} isAnimationActive={false}>
                  {pieData.map((d) => <Cell key={d.label} fill={d.color} />)}
                </Pie>
                <Tooltip content={<PlaceTooltip total={total} />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="tabular-nums font-bold leading-none font-display" style={{ fontSize: 26, color: C.text, letterSpacing: '-0.02em' }}>{avg.toFixed(2)}</span>
              <span style={{ fontSize: 10.5, color: C.textMuted, marginTop: 2 }}>avg place</span>
            </div>
          </div>

          <div className="flex-1 min-w-0 space-y-2">
            {PLACE.map((p, i) => {
              const n = counts[i];
              const pct = total ? Math.round((n / total) * 100) : 0;
              return (
                <div key={p.label} className="flex items-center gap-2.5">
                  <span className="tabular-nums text-xs font-semibold flex-shrink-0" style={{ width: 26, color: p.color }}>{p.label}</span>
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: C.bgSubtle }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: p.color, minWidth: n ? 4 : 0 }} />
                  </div>
                  <span className="tabular-nums text-xs flex-shrink-0" style={{ width: 54, textAlign: 'right', color: C.textMuted }}>
                    {n} · {pct}%
                  </span>
                </div>
              );
            })}
            <div className="pt-1.5 mt-1 text-xs" style={{ borderTop: `1px solid ${C.borderMuted}`, color: C.textMuted }}>
              Wins the table <span className="font-semibold tabular-nums" style={{ color: C.gold }}>{firstRate}%</span> of the time
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}

function computePlacement(games, playerId) {
  const counts = [0, 0, 0, 0];
  let total = 0, sumPlace = 0;
  for (const g of games || []) {
    const seats = g.seats || [];
    const me = seats.find((s) => s.player_id === playerId);
    if (!me) continue;
    const place = Math.min(4, 1 + seats.filter((s) => s.chips > me.chips).length);
    counts[place - 1]++; total++; sumPlace += place;
  }
  return {
    counts, total,
    avg: total ? sumPlace / total : 0,
    firstRate: total ? Math.round((counts[0] / total) * 100) : 0,
  };
}

function PlaceTooltip({ active, payload, total }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ ...TOOLTIP_STYLE, padding: '8px 11px' }}>
      <span style={{ color: d.color, fontWeight: 700 }}>{d.label}</span>
      <span style={{ color: C.textSec }}> — {d.value} game{d.value !== 1 ? 's' : ''} ({Math.round((d.value / total) * 100)}%)</span>
    </div>
  );
}

// ─── Luck vs Skill ─────────────────────────────────────────────────────────────
// Cumulative actual score minus what the table's ratings predicted. Above 0 =
// running hotter than your rating (luck banked); below = running cold.
export function LuckSkill({ data, color, name }) {
  const games = data?.games || [];
  const chart = useMemo(
    () => games.map((g) => ({ date: g.date, label: `G${g.seq}`, luck: +(g.cum_actual - g.cum_expected).toFixed(2), expected: g.cum_expected, actual: g.cum_actual })),
    [games]
  );

  if (games.length < 2) {
    return (
      <Section icon={Dices} title="Luck vs skill" subtitle="Your results against what the ratings predicted" accent="#7c3aed">
        <Empty msg="Needs a few more games in this pool to separate signal from swing." />
      </Section>
    );
  }

  const luck = data.luck;
  const recent = data.recent_luck;
  const hot = luck > 0.4, cold = luck < -0.4;
  const verdict = hot ? 'Running hot' : cold ? 'Running cold' : 'Right on rating';
  const verdictColor = hot ? '#22a06b' : cold ? '#e0574f' : '#9a978f';

  // Zero-crossing offset for the diverging green/red fill.
  const vals = chart.map((d) => d.luck);
  const max = Math.max(0, ...vals), min = Math.min(0, ...vals);
  const off = max + min === 0 ? 0.5 : max / (max - min);

  return (
    <Section
      icon={Dices}
      title="Luck vs skill"
      subtitle="Cumulative result vs what the table's ratings predicted — the gap is variance, and it regresses"
      accent="#7c3aed"
      right={
        <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg font-semibold"
          style={{ background: verdictColor + '14', color: verdictColor }}>
          {hot ? <TrendingUp size={13} /> : cold ? <TrendingDown size={13} /> : null}
          {verdict}
        </span>
      }
    >
      <div className="flex flex-wrap gap-x-8 gap-y-3 mb-5">
        <Stat label="Skill" value={data.games_played ? `${Math.round(games[games.length - 1].rating_before + games[games.length - 1].delta)}` : '—'} hint="current rating — the earned part" color={color || C.gold} />
        <Stat label="Expected score" value={data.expected_score.toFixed(1)} hint="what the ratings said you'd score" color={C.textSec} />
        <Stat label="Actual score" value={data.actual_score.toFixed(1)} hint="what you actually scored" color={C.text} />
        <Stat label="Luck" value={signed(luck, 1)} hint={`${signed(recent, 1)} over last 5`} color={luck >= 0 ? C.win : C.loss} />
      </div>

      <ResponsiveContainer width="100%" height={210}>
        <AreaChart data={chart} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="luckFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset={off} stopColor="#16a34a" stopOpacity={0.42} />
              <stop offset={off} stopColor="#dc2626" stopOpacity={0.42} />
            </linearGradient>
            <linearGradient id="luckStroke" x1="0" y1="0" x2="0" y2="1">
              <stop offset={off} stopColor="#15803d" stopOpacity={1} />
              <stop offset={off} stopColor="#dc2626" stopOpacity={1} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fill: C.textFaint, fontSize: 10.5 }} axisLine={false} tickLine={false} minTickGap={36} />
          <YAxis tick={{ fill: C.textFaint, fontSize: 10.5 }} axisLine={false} tickLine={false} width={34} />
          <ReferenceLine y={0} stroke={C.textFaint} strokeWidth={1.25}
            label={{ value: 'on rating', fill: C.textFaint, fontSize: 10, position: 'insideTopLeft' }} />
          <Tooltip content={<LuckTooltip />} cursor={{ stroke: CHART.cursor, strokeWidth: 1, strokeDasharray: '4 4' }} />
          <Area type="monotone" dataKey="luck" stroke="url(#luckStroke)" strokeWidth={2.5}
            fill="url(#luckFill)" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </Section>
  );
}

function LuckTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  return (
    <div style={{ ...TOOLTIP_STYLE, padding: '9px 12px' }}>
      <div style={{ color: C.textMuted, marginBottom: 4, fontWeight: 600, fontSize: 12 }}>{p.date} · {p.label}</div>
      <Row label="Luck banked" value={signed(p.luck, 1)} color={p.luck >= 0 ? C.win : C.loss} />
      <Row label="Actual" value={p.actual.toFixed(1)} color={C.text} />
      <Row label="Expected" value={p.expected.toFixed(1)} color={C.textSec} />
    </div>
  );
}

// ─── small shared bits ──────────────────────────────────────────────────────
function Row({ label, value, color }) {
  return (
    <div className="flex items-center justify-between gap-5">
      <span style={{ color: C.textSec }}>{label}</span>
      <span className="tabular-nums" style={{ color, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function Stat({ label, value, hint, color }) {
  return (
    <div>
      <div className="text-xs" style={{ color: C.textMuted }}>{label}</div>
      <div className="tabular-nums font-bold leading-tight font-display" style={{ fontSize: 24, color, letterSpacing: '-0.02em' }}>{value}</div>
      {hint && <div className="text-xs mt-0.5" style={{ color: C.textFaint }}>{hint}</div>}
    </div>
  );
}
