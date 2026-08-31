import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Trash2 } from 'lucide-react';
import { api } from '../api';
import { modesLabel } from '../labels';
import { usePool, currentPoolLabel } from '../PoolContext';

const C = {
  card: '#ffffff', border: '#e5e4e0', borderMuted: '#ededeb',
  bg: '#fafaf8', bgSubtle: '#f5f5f2',
  text: '#0a0a0a', textSec: '#374151', textMuted: '#6b7280', textFaint: '#9ca3af',
  win: '#15803d', loss: '#dc2626',
};

export default function History() {
  const { pool, pools } = usePool();
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.getGames(pool).then(gs => {
      setGames(Array.isArray(gs) ? gs : []);
      setLoading(false);
    });
  }, [pool]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(game) {
    const names = game.seats.map(s => s.player_name).join(', ');
    const confirmed = window.confirm(
      `Delete game from ${game.date}?\n${modesLabel(game.modes)} — ${names}\n\nThis cannot be undone.`
    );
    if (!confirmed) return;
    setDeleting(game.id);
    await api.deleteGame(game.id);
    setDeleting(null);
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: C.text }}>Game History</h1>
        <p className="text-sm mt-1" style={{ color: C.textMuted }}>
          {currentPoolLabel(pool, pools)} · {games.length} game{games.length !== 1 ? 's' : ''}
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40" style={{ color: C.textMuted }}>Loading…</div>
      ) : games.length === 0 ? (
        <div className="rounded-2xl border px-6 py-16 text-center" style={{ background: C.card, borderColor: C.border }}>
          <p style={{ color: C.textMuted }}>No games logged yet.</p>
          <Link to="/log" className="text-sm font-medium mt-2 inline-block" style={{ color: '#f59e0b' }}>
            Log your first game →
          </Link>
        </div>
      ) : (
        <div className="rounded-2xl border overflow-hidden" style={{ background: C.card, borderColor: C.border }}>
          <div className="divide-y" style={{ borderColor: C.borderMuted }}>
            {games.map(game => (
              <div key={game.id} className="px-6 py-4">
                {/* Header row */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <span className="font-semibold text-sm" style={{ color: C.text }}>{game.date}</span>
                    <span className="text-xs px-2 py-0.5 rounded-md font-medium"
                      style={{ background: C.bgSubtle, color: C.textSec, border: `1px solid ${C.border}` }}>
                      {modesLabel(game.modes)}
                    </span>
                    {game.notes && (
                      <span className="text-xs italic truncate max-w-xs" style={{ color: C.textFaint }}>
                        "{game.notes}"
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <Link to={`/log/${game.id}`}
                      className="flex items-center gap-1 text-xs font-medium hover:opacity-70 transition-opacity"
                      style={{ color: C.textMuted }}>
                      <Pencil size={12} /> Edit
                    </Link>
                    <button
                      onClick={() => handleDelete(game)}
                      disabled={deleting === game.id}
                      className="flex items-center gap-1 text-xs font-medium hover:opacity-70 transition-opacity"
                      style={{ color: C.loss, background: 'none', border: 'none', cursor: 'pointer', opacity: deleting === game.id ? 0.4 : 1 }}>
                      <Trash2 size={12} /> {deleting === game.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>

                {/* Seats grid */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[...game.seats].sort((a, b) => b.chips - a.chips).map(s => (
                    <div key={s.id} className="flex items-center justify-between rounded-xl px-3 py-2.5"
                      style={{ background: C.bgSubtle, border: `1px solid ${C.borderMuted}` }}>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold"
                          style={{ background: s.player_color, color: '#0a0a0a' }}>
                          {s.player_name.charAt(0).toUpperCase()}
                        </span>
                        <span className="text-sm truncate" style={{ color: C.textSec }}>{s.player_name}</span>
                      </div>
                      <div className="text-right ml-2 flex-shrink-0">
                        <div className="text-sm font-bold tabular-nums"
                          style={{ color: s.chips > 0 ? C.win : s.chips < 0 ? C.loss : C.textMuted }}>
                          {s.chips > 0 ? '+' : ''}{s.chips}
                        </div>
                        {s.elo_delta != null && (
                          <div className="text-xs tabular-nums"
                            style={{ color: s.elo_delta >= 0 ? C.win : C.loss }}>
                            {s.elo_delta >= 0 ? '+' : ''}{s.elo_delta}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
