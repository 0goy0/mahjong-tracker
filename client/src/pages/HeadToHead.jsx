import React, { useEffect, useState } from 'react';
import { Swords, ArrowRight } from 'lucide-react';
import { api } from '../api';
import { modesLabel } from '../labels';
import { usePool, currentPoolLabel } from '../PoolContext';

const C = {
  card: '#ffffff', border: '#e5e4e0', borderMuted: '#ededeb',
  bg: '#fafaf8', bgSubtle: '#f5f5f2',
  text: '#0a0a0a', textSec: '#374151', textMuted: '#6b7280', textFaint: '#9ca3af',
  win: '#15803d', loss: '#dc2626',
};

function chipColor(v) {
  return v > 0 ? C.win : v < 0 ? C.loss : C.textMuted;
}

function signed(v) {
  return (v > 0 ? '+' : '') + v;
}

function initial(name) {
  return name.charAt(0).toUpperCase();
}

const selectStyle = {
  background: '#ffffff', border: '1px solid #d4d3cf', borderRadius: 10,
  color: '#0a0a0a', padding: '8px 12px', outline: 'none',
  fontSize: 14, cursor: 'pointer', minWidth: 180,
};

export default function HeadToHead() {
  const { pool, pools } = usePool();
  const [players, setPlayers] = useState([]);
  const [id1, setId1] = useState('');
  const [id2, setId2] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.getPlayers().then(ps => { if (Array.isArray(ps)) setPlayers(ps); });
  }, []);

  useEffect(() => {
    if (id1 && id2 && id1 !== id2) {
      setLoading(true);
      api.getH2H(id1, id2, pool).then(res => {
        setData(res && !res.error ? res : null);
        setLoading(false);
      });
    } else {
      setData(null);
    }
  }, [id1, id2, pool]);

  const p1 = players.find(p => String(p.id) === String(id1));
  const p2 = players.find(p => String(p.id) === String(id2));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: C.text }}>Head to Head</h1>
        <p className="text-sm mt-1" style={{ color: C.textMuted }}>
          Direct chip flow between two players · <span style={{ color: '#f59e0b', fontWeight: 600 }}>{currentPoolLabel(pool, pools)}</span>
        </p>
      </div>

      {/* Selectors */}
      <div className="rounded-2xl border p-6 flex flex-wrap items-center gap-4" style={{ background: C.card, borderColor: C.border }}>
        <select value={id1} onChange={e => setId1(e.target.value)} style={selectStyle}>
          <option value="">Player 1...</option>
          {players.map(p => (
            <option key={p.id} value={p.id} disabled={String(p.id) === String(id2)}>{p.name}</option>
          ))}
        </select>
        <Swords size={20} color="#f59e0b" />
        <select value={id2} onChange={e => setId2(e.target.value)} style={selectStyle}>
          <option value="">Player 2...</option>
          {players.map(p => (
            <option key={p.id} value={p.id} disabled={String(p.id) === String(id1)}>{p.name}</option>
          ))}
        </select>
      </div>

      {loading && (
        <div className="flex items-center justify-center h-40">
          <span style={{ color: C.textMuted }}>Loading...</span>
        </div>
      )}

      {!loading && id1 && id2 && data && (
        data.gamesCount === 0 ? (
          <div className="rounded-2xl border px-6 py-12 text-center" style={{ background: C.card, borderColor: C.border, color: C.textMuted }}>
            {p1?.name} and {p2?.name} have no shared games in {currentPoolLabel(pool, pools)}.
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border p-6 flex flex-col items-center gap-3" style={{ background: C.card, borderColor: C.border }}>
                <div className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold" style={{ background: p1?.color, color: '#0a0a0a' }}>
                  {p1 ? initial(p1.name) : '?'}
                </div>
                <div className="font-semibold" style={{ color: C.text }}>{p1?.name}</div>
                <div className="text-2xl font-bold tabular-nums" style={{ color: chipColor(data.p1Chips) }}>{signed(data.p1Chips)}</div>
                <div className="text-xs" style={{ color: C.textMuted }}>{data.p1Wins} games came out ahead</div>
              </div>

              <div className="rounded-2xl border p-6 flex flex-col items-center justify-center gap-2" style={{ background: '#fffbeb', borderColor: '#f59e0b33' }}>
                <div className="text-xs uppercase tracking-wider font-medium" style={{ color: C.textFaint }}>Shared Games</div>
                <div className="text-3xl font-bold tabular-nums" style={{ color: '#f59e0b' }}>{data.gamesCount}</div>
                <div className="text-sm font-medium text-center" style={{ color: C.textSec }}>
                  {data.p1Chips === 0
                    ? 'Dead even'
                    : `${(data.p1Chips > 0 ? p1 : p2)?.name} is up ${Math.abs(data.p1Chips)}`}
                </div>
              </div>

              <div className="rounded-2xl border p-6 flex flex-col items-center gap-3" style={{ background: C.card, borderColor: C.border }}>
                <div className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold" style={{ background: p2?.color, color: '#0a0a0a' }}>
                  {p2 ? initial(p2.name) : '?'}
                </div>
                <div className="font-semibold" style={{ color: C.text }}>{p2?.name}</div>
                <div className="text-2xl font-bold tabular-nums" style={{ color: chipColor(data.p2Chips) }}>{signed(data.p2Chips)}</div>
                <div className="text-xs" style={{ color: C.textMuted }}>{data.p2Wins} games came out ahead</div>
              </div>
            </div>

            {/* Shared games table */}
            <div className="rounded-2xl border overflow-hidden" style={{ background: C.card, borderColor: C.border }}>
              <div className="px-6 py-4 border-b" style={{ borderColor: C.border, background: C.bgSubtle }}>
                <h2 className="font-semibold text-base" style={{ color: C.text }}>Shared Games</h2>
                <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>
                  Direct flow = chips that passed between {p1?.name} and {p2?.name} in that game.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                      {['Date', 'Modes', p1?.name || 'P1 net', p2?.name || 'P2 net', 'Direct Flow'].map(h => (
                        <th key={h} className="px-4 py-3 text-left font-medium" style={{ color: C.textFaint, fontSize: 11 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.games.map(game => {
                      const s1 = game.seats.find(s => String(s.player_id) === String(id1));
                      const s2 = game.seats.find(s => String(s.player_id) === String(id2));
                      const flow = game.p1vsP2;
                      return (
                        <tr key={game.id} style={{ borderBottom: `1px solid ${C.borderMuted}` }} className="hover:bg-stone-50 transition-colors">
                          <td className="px-4 py-3 font-medium" style={{ color: C.text }}>{game.date}</td>
                          <td className="px-4 py-3">
                            <span className="text-xs px-2 py-0.5 rounded-md font-medium"
                              style={{ background: C.bgSubtle, color: C.textSec, border: `1px solid ${C.border}` }}>
                              {modesLabel(game.modes)}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-semibold tabular-nums" style={{ color: chipColor(s1 ? s1.chips : 0) }}>
                            {s1 ? signed(s1.chips) : '—'}
                          </td>
                          <td className="px-4 py-3 font-semibold tabular-nums" style={{ color: chipColor(s2 ? s2.chips : 0) }}>
                            {s2 ? signed(s2.chips) : '—'}
                          </td>
                          <td className="px-4 py-3">
                            {flow === 0 ? (
                              <span style={{ color: C.textFaint }}>none</span>
                            ) : (
                              <span className="flex items-center gap-1.5 font-medium">
                                <span style={{ color: C.loss }}>{flow > 0 ? p2?.name : p1?.name}</span>
                                <ArrowRight size={13} color={C.textFaint} />
                                <span style={{ color: C.win }}>{flow > 0 ? p1?.name : p2?.name}</span>
                                <span className="ml-1 font-bold" style={{ color: '#f59e0b' }}>{Math.abs(flow)}</span>
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )
      )}

      {!loading && (!id1 || !id2) && (
        <div className="rounded-2xl border px-6 py-12 text-center" style={{ background: C.card, borderColor: C.border, color: C.textMuted }}>
          Select two players to compare their head-to-head record.
        </div>
      )}
    </div>
  );
}
