import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { C } from '../theme';
import { RANKS } from '../labels';

// Placeholder season ladder (Rank 1 = top) — mirrors server/season.js.
const SEASON_RANKS = [
  { min: 1240, title: '🐙 Kraken', color: '#f59e0b' },
  { min: 1160, title: '🦈 Megalodon', color: '#ef4444' },
  { min: 1090, title: '🦈 Shark', color: '#a855f7' },
  { min: 1030, title: '🐟 Barracuda', color: '#3b82f6' },
  { min: 970,  title: '🐟 Piranha', color: '#06b6d4' },
  { min: 910,  title: '🐡 Pufferfish', color: '#10b981' },
  { min: 840,  title: '🐠 Clownfish', color: '#84cc16' },
  { min: -Infinity, title: '🐠 Goldfish', color: '#6b7280' },
];

function AchievementRow({ a }) {
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const earned = a.holders.length;
  return (
    <div className="rounded-2xl border overflow-hidden" style={{ background: C.card, borderColor: C.border }}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-4 px-5 py-4 text-left"
        style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
        <div className="flex-shrink-0 flex items-center justify-center rounded-xl"
          style={{ width: 44, height: 44, fontSize: 22, background: C.bgSubtle, border: `1px solid ${C.border}` }}>{a.icon}</div>
        <div className="min-w-0 flex-1">
          <div className="font-bold" style={{ color: C.text }}>{a.glyph} {a.title}{a.repeatable && <span className="text-xs font-normal" style={{ color: C.textFaint }}> · repeatable</span>}</div>
          <div className="text-xs truncate" style={{ color: C.textMuted }}>{a.desc}</div>
        </div>
        <div className="flex-shrink-0 text-right">
          <div className="font-bold tabular-nums" style={{ color: earned ? C.gold : C.textFaint }}>{earned}</div>
          <div className="text-xs" style={{ color: C.textFaint }}>earned</div>
        </div>
        <span style={{ color: C.textFaint, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▸</span>
      </button>
      {open && (
        <div className="px-5 pb-4 pt-1 border-t" style={{ borderColor: C.borderMuted }}>
          {earned === 0 ? (
            <p className="text-sm py-2" style={{ color: C.textMuted }}>No one has earned this yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2 pt-3">
              {a.holders.map(h => (
                <button key={h.player_id} onClick={() => nav(`/players/${h.player_id}`)}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm hover:opacity-80"
                  style={{ background: C.bgSubtle, border: `1px solid ${C.border}`, cursor: 'pointer' }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: h.color, display: 'inline-block' }} />
                  <span style={{ color: C.text }}>{h.name}</span>
                  {h.count > 1 && <span className="font-bold" style={{ color: C.gold }}>×{h.count}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Ladder({ title, tiers }) {
  const rows = [...tiers]; // already top-first
  return (
    <div className="rounded-2xl border overflow-hidden" style={{ background: C.card, borderColor: C.border }}>
      <div className="px-5 py-3.5 border-b" style={{ borderColor: C.border, background: C.bgSubtle }}>
        <h3 className="font-semibold" style={{ color: C.text }}>{title}</h3>
      </div>
      <div className="p-4 space-y-2">
        {rows.map((r, i) => (
          <div key={r.title} className="flex items-center gap-3">
            <span className="text-sm font-bold" style={{ color: r.color, width: 130 }}>{r.chinese ? `${r.chinese} ` : ''}{r.title}</span>
            <span className="tabular-nums text-xs" style={{ color: C.textMuted }}>
              {r.min === -Infinity ? '< ' + rows[i - 1].min : `${r.min.toLocaleString()}+`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Achievements() {
  const [data, setData] = useState(null);
  useEffect(() => { api.getAchievementHolders().then(d => setData(d && !d.error ? d : { achievements: [] })); }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: C.text }}>Achievements</h1>
        <p className="text-sm mt-1" style={{ color: C.textMuted }}>Every badge — tap one to see who's earned it.</p>
      </div>

      {!data ? (
        <div className="rounded-2xl border p-10 text-center" style={{ background: C.card, borderColor: C.border }}>
          <p style={{ color: C.textMuted }}>Loading…</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.achievements.map(a => <AchievementRow key={a.key} a={a} />)}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Ladder title="🏛️ All-Time Rank Ladder" tiers={RANKS} />
        <Ladder title="📅 Season Rank Ladder" tiers={SEASON_RANKS} />
      </div>
    </div>
  );
}
