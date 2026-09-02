import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, TrendingUp, TrendingDown } from 'lucide-react';
import { api } from '../api';
import { usePool, currentPoolLabel } from '../PoolContext';
import { getRank } from '../labels';

const COLOR_PRESETS = [
  '#f59e0b', '#ef4444', '#22c55e', '#3b82f6', '#a855f7',
  '#ec4899', '#14b8a6', '#f97316', '#84cc16', '#06b6d4',
];

function initials(name) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

const C = {
  card: '#ffffff', border: '#e5e4e0', bg: '#fafaf8', bgSubtle: '#f5f5f2',
  text: '#0a0a0a', textSec: '#374151', textMuted: '#6b7280', textFaint: '#9ca3af',
  win: '#15803d', loss: '#dc2626',
};

const inputStyle = {
  background: '#ffffff', border: '1px solid #d4d3cf', borderRadius: 10,
  color: '#0a0a0a', padding: '8px 12px', outline: 'none', fontSize: 14, width: '100%',
};

function PlayerCard({ player, stats, elo }) {
  const navigate = useNavigate();
  const chips = stats?.total_chips ?? 0;
  const games = stats?.games_played ?? 0;
  const wins = stats?.wins ?? 0;
  const winRate = games ? Math.round((wins / games) * 100) : null;
  const rankInfo = getRank(elo?.rating);
  const delta = elo?.last_delta;

  return (
    <button
      onClick={() => navigate(`/players/${player.id}`)}
      className="rounded-2xl border text-left transition-all hover:shadow-md hover:-translate-y-0.5 cursor-pointer w-full"
      style={{ background: C.card, borderColor: rankInfo ? rankInfo.color + '44' : C.border }}
    >
      {/* Top accent strip */}
      <div className="h-1.5 rounded-t-2xl" style={{ background: rankInfo ? rankInfo.color : player.color }} />

      <div className="p-4 flex flex-col gap-3">
        {/* Avatar + name row */}
        <div className="flex items-center gap-3">
          {player.avatar ? (
            <img src={player.avatar} alt={player.name}
              className="w-12 h-12 rounded-full object-cover flex-shrink-0"
              style={{ border: `2px solid ${player.color}` }} />
          ) : (
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold flex-shrink-0"
              style={{ background: player.color, color: '#0a0a0a' }}>
              {initials(player.name)}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="font-bold text-sm truncate" style={{ color: C.text }}>{player.name}</div>
            {rankInfo ? (
              <div className="text-xs font-semibold mt-0.5 truncate" style={{ color: rankInfo.color }}>
                {rankInfo.chinese} {rankInfo.title}
              </div>
            ) : (
              <div className="text-xs mt-0.5" style={{ color: C.textFaint }}>Unranked</div>
            )}
          </div>
        </div>

        {/* Rating */}
        {elo?.rating != null ? (
          <div className="flex items-end justify-between">
            <div>
              <div className="text-2xl font-bold tabular-nums leading-none" style={{ color: C.text }}>
                {Math.round(elo.rating)}
              </div>
              <div className="text-xs mt-0.5" style={{ color: C.textMuted }}>ELO rating</div>
            </div>
            {delta != null && (
              <div className="flex items-center gap-1 text-sm font-semibold"
                style={{ color: delta >= 0 ? C.win : C.loss }}>
                {delta >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                {delta >= 0 ? '+' : ''}{Math.round(delta)}
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs" style={{ color: C.textFaint }}>No rated games yet</div>
        )}

        {/* Stats row */}
        <div className="flex items-center gap-3 pt-1 border-t" style={{ borderColor: C.border }}>
          <div className="flex-1 text-center">
            <div className="text-sm font-bold" style={{ color: C.text }}>{games}</div>
            <div className="text-xs" style={{ color: C.textFaint }}>games</div>
          </div>
          <div style={{ width: 1, height: 28, background: C.border }} />
          <div className="flex-1 text-center">
            <div className="text-sm font-bold" style={{ color: C.text }}>
              {winRate != null ? `${winRate}%` : '—'}
            </div>
            <div className="text-xs" style={{ color: C.textFaint }}>win rate</div>
          </div>
          <div style={{ width: 1, height: 28, background: C.border }} />
          <div className="flex-1 text-center">
            <div className="text-sm font-bold tabular-nums"
              style={{ color: chips > 0 ? C.win : chips < 0 ? C.loss : C.text }}>
              {chips > 0 ? '+' : ''}{chips}
            </div>
            <div className="text-xs" style={{ color: C.textFaint }}>chips</div>
          </div>
        </div>
      </div>
    </button>
  );
}

export default function Players() {
  const { pool, pools } = usePool();
  const [players, setPlayers] = useState([]);
  const [eloRows, setEloRows] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(COLOR_PRESETS[0]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  async function load() {
    const eloFetch = pool ? api.getEloLeaderboard(pool) : Promise.resolve([]);
    const [ps, lb, elo] = await Promise.all([api.getPlayers(), api.getLeaderboard(pool), eloFetch]);
    if (Array.isArray(ps)) setPlayers(ps);
    if (Array.isArray(lb)) setLeaderboard(lb);
    if (Array.isArray(elo)) setEloRows(elo);
  }

  useEffect(() => { load(); }, [pool]);

  const lbMap = Object.fromEntries(leaderboard.map(r => [r.id, r]));
  const eloMap = Object.fromEntries(eloRows.map(r => [r.player_id, r]));

  // Sort: rated players by rating desc, then unrated by name
  const sorted = [...players].sort((a, b) => {
    const ea = eloMap[a.id], eb = eloMap[b.id];
    if (ea && eb) return eb.rating - ea.rating;
    if (ea) return -1;
    if (eb) return 1;
    return a.name.localeCompare(b.name);
  });

  async function handleAdd(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setAdding(true);
    setError('');
    const result = await api.createPlayer({ name: newName.trim(), color: newColor });
    setAdding(false);
    if (result.error) setError(result.error);
    else { setNewName(''); setNewColor(COLOR_PRESETS[0]); setShowAdd(false); load(); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: C.text }}>Players</h1>
          <p className="text-sm mt-0.5" style={{ color: C.textMuted }}>
            {currentPoolLabel(pool, pools)}
          </p>
        </div>
        <button
          onClick={() => setShowAdd(v => !v)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
          style={{ background: showAdd ? C.bgSubtle : '#f59e0b', color: showAdd ? C.textMuted : '#0a0a0a', border: `1px solid ${showAdd ? C.border : '#f59e0b'}`, cursor: 'pointer' }}>
          <Plus size={16} /> Add Player
        </button>
      </div>

      {/* Add player panel */}
      {showAdd && (
        <div className="rounded-2xl border p-6 space-y-4" style={{ background: C.card, borderColor: C.border }}>
          <h2 className="font-semibold" style={{ color: C.text }}>New Player</h2>
          <form onSubmit={handleAdd} className="space-y-4">
            <div>
              <label className="block text-sm mb-2" style={{ color: C.textMuted }}>Name</label>
              <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="Player name" style={{ ...inputStyle, maxWidth: 320 }}
                autoFocus />
            </div>
            <div>
              <label className="block text-sm mb-2" style={{ color: C.textMuted }}>Color</label>
              <div className="flex gap-2 flex-wrap">
                {COLOR_PRESETS.map(c => (
                  <button key={c} type="button" onClick={() => setNewColor(c)}
                    className="w-8 h-8 rounded-full transition-transform"
                    style={{
                      background: c,
                      border: newColor === c ? '3px solid #0a0a0a' : '3px solid transparent',
                      transform: newColor === c ? 'scale(1.15)' : 'scale(1)',
                      cursor: 'pointer',
                    }} />
                ))}
              </div>
            </div>
            {error && <div className="text-sm" style={{ color: C.loss }}>{error}</div>}
            <div className="flex gap-2">
              <button type="submit" disabled={adding || !newName.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-opacity"
                style={{ background: '#f59e0b', color: '#0a0a0a', border: 'none', cursor: adding || !newName.trim() ? 'not-allowed' : 'pointer', opacity: adding || !newName.trim() ? 0.5 : 1 }}>
                <Plus size={16} />{adding ? 'Adding…' : 'Add Player'}
              </button>
              <button type="button" onClick={() => setShowAdd(false)}
                className="px-4 py-2 rounded-xl text-sm font-medium"
                style={{ background: C.bgSubtle, color: C.textMuted, border: `1px solid ${C.border}`, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Player grid */}
      {sorted.length === 0 ? (
        <div className="rounded-2xl border px-6 py-12 text-center"
          style={{ background: C.card, borderColor: C.border, color: C.textMuted }}>
          No players yet. Add one to get started.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {sorted.map(p => (
            <PlayerCard
              key={p.id}
              player={p}
              stats={lbMap[p.id]}
              elo={eloMap[p.id]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
