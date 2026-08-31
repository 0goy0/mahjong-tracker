import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
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
  text: '#0a0a0a', textSec: '#374151', textMuted: '#6b7280',
  win: '#15803d', loss: '#dc2626',
};

const inputStyle = {
  background: '#ffffff', border: '1px solid #d4d3cf', borderRadius: 10,
  color: '#0a0a0a', padding: '8px 12px', outline: 'none', fontSize: 14, width: '100%',
};

export default function Players() {
  const navigate = useNavigate();
  const { pool, pools } = usePool();
  const [players, setPlayers] = useState([]);
  const [eloRows, setEloRows] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(COLOR_PRESETS[0]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

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

  async function handleAdd(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setAdding(true);
    setError('');
    const result = await api.createPlayer({ name: newName.trim(), color: newColor });
    setAdding(false);
    if (result.error) setError(result.error);
    else { setNewName(''); setNewColor(COLOR_PRESETS[0]); load(); }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: C.text }}>Players</h1>
        <p className="text-sm mt-1" style={{ color: C.textMuted }}>
          Manage your players · {currentPoolLabel(pool, pools)}
        </p>
      </div>

      {/* Add player */}
      <div className="rounded-2xl border p-6 space-y-4" style={{ background: C.card, borderColor: C.border }}>
        <h2 className="font-semibold" style={{ color: C.text }}>Add Player</h2>
        <form onSubmit={handleAdd} className="space-y-4">
          <div>
            <label className="block text-sm mb-2" style={{ color: C.textMuted }}>Name</label>
            <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="Player name" style={{ ...inputStyle, maxWidth: 320 }} />
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
          <button type="submit" disabled={adding || !newName.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-opacity"
            style={{ background: '#f59e0b', color: '#0a0a0a', border: 'none', cursor: adding || !newName.trim() ? 'not-allowed' : 'pointer', opacity: adding || !newName.trim() ? 0.5 : 1 }}>
            <Plus size={16} />{adding ? 'Adding…' : 'Add Player'}
          </button>
        </form>
      </div>

      {/* Player grid */}
      {players.length === 0 ? (
        <div className="rounded-2xl border px-6 py-12 text-center"
          style={{ background: C.card, borderColor: C.border, color: C.textMuted }}>
          No players yet. Add one above to get started.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {players.map(p => {
            const stats = lbMap[p.id] || {};
            const elo = eloMap[p.id];
            const chips = stats.total_chips ?? 0;
            const rankInfo = getRank(elo?.rating);
            return (
              <button key={p.id} onClick={() => navigate(`/players/${p.id}`)}
                className="rounded-2xl border p-5 flex flex-col items-center gap-3 text-center transition-all hover:shadow-sm hover:border-amber-200 cursor-pointer"
                style={{ background: C.card, borderColor: C.border, width: '100%' }}>
                <div className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold"
                  style={{ background: p.color, color: '#0a0a0a' }}>
                  {initials(p.name)}
                </div>
                <div>
                  <div className="font-semibold text-sm" style={{ color: C.text }}>{p.name}</div>
                  {rankInfo && (
                    <div className="text-xs font-medium mt-0.5" style={{ color: rankInfo.color }}>{rankInfo.chinese} {rankInfo.title}</div>
                  )}
                  {elo?.rating != null && (
                    <div className="text-lg font-bold tabular-nums mt-1" style={{ color: C.text }}>{elo.rating}</div>
                  )}
                  <div className="text-xs mt-0.5" style={{ color: C.textMuted }}>{stats.games_played || 0} games</div>
                  <div className="text-sm font-semibold mt-1"
                    style={{ color: chips > 0 ? C.win : chips < 0 ? C.loss : C.textMuted }}>
                    {chips > 0 ? '+' : ''}{chips} chips
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
