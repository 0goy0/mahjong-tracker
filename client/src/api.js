const BASE = '/api';

async function request(path, options = {}) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch {
      return { error: res.ok ? 'Server returned unexpected response' : `HTTP ${res.status} — server may need restart` };
    }
    if (!res.ok) return { error: data.error || `HTTP ${res.status}` };
    return data;
  } catch (err) {
    return { error: err.message };
  }
}

// Append ?pool= when a pool is selected. Everything is strictly pool-scoped now;
// a null/falsy pool means "no filter" (server returns all — the UI always sends
// a concrete pool once games exist).
function poolQ(pool) {
  return pool ? `?pool=${encodeURIComponent(pool)}` : '';
}

export const api = {
  // Players
  getPlayers: () => request('/players'),
  createPlayer: (body) => request('/players', { method: 'POST', body: JSON.stringify(body) }),
  updatePlayer: (id, body) => request(`/players/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deletePlayer: (id) => request(`/players/${id}`, { method: 'DELETE' }),
  uploadAvatar: (id, file) => {
    const form = new FormData();
    form.append('avatar', file);
    return fetch(`/api/players/${id}/avatar`, { method: 'POST', body: form })
      .then(r => r.json()).catch(err => ({ error: err.message }));
  },
  deleteAvatar: (id) => request(`/players/${id}/avatar`, { method: 'DELETE' }),
  getAchievements: (id) => request(`/players/${id}/achievements`),

  // Reactions
  getReactions: (gameId) => request(`/games/${gameId}/reactions`),
  addReaction: (gameId, emoji, reactor) => request(`/games/${gameId}/reactions`, { method: 'POST', body: JSON.stringify({ emoji, reactor }) }),
  removeReaction: (gameId, emoji, reactor) => request(`/games/${gameId}/reactions`, { method: 'DELETE', body: JSON.stringify({ emoji, reactor }) }),

  // Pools (the universe switcher)
  getPools: () => request('/pools'),

  // Games
  getGames: (pool) => request(`/games${poolQ(pool)}`),
  getGame: (id) => request(`/games/${id}`),
  createGame: (body) => request('/games', { method: 'POST', body: JSON.stringify(body) }),
  createGames: (games) => request('/games/batch', { method: 'POST', body: JSON.stringify({ games }) }),
  updateGame: (id, body) => request(`/games/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteGame: (id) => request(`/games/${id}`, { method: 'DELETE' }),

  // Stats (strictly per pool)
  getLeaderboard: (pool) => request(`/stats/leaderboard${poolQ(pool)}`),
  getPlayerStats: (id, pool) => request(`/stats/player/${id}${poolQ(pool)}`),
  getH2H: (id1, id2, pool) => request(`/stats/h2h/${id1}/${id2}${poolQ(pool)}`),
  getHistory: (pool) => request(`/stats/history${poolQ(pool)}`),

  // ELO ratings (per pool)
  getEloLeaderboard: (pool) => request(`/elo/leaderboard?pool=${encodeURIComponent(pool)}`),
  getEloPlayer: (id, pool) => request(`/elo/player/${id}?pool=${encodeURIComponent(pool)}`),

  // Backup / restore
  getBackup: () => request('/backup'),
  restore: (body) => request('/restore', { method: 'POST', body: JSON.stringify(body) }),
};
