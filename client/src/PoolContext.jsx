import React, { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api';
import { poolLabel } from './labels';

// The global "which universe am I viewing" selection. A pool = a sorted mode-set
// + tai bounds (see labels.poolKey). This replaced the old loose per-mode filter:
// every stat/chart/rating is strictly scoped to one pool — universes never mix.
const PoolContext = createContext({ pool: null, setPool: () => {}, pools: [], refreshPools: () => {} });

export function PoolProvider({ children }) {
  const [pool, setPool] = useState(null);
  const [pools, setPools] = useState([]); // [{ pool_key, label, games, players }]

  async function refreshPools() {
    const data = await api.getPools();
    if (!Array.isArray(data)) return;
    setPools(data);
    // Keep the current selection if it still exists; otherwise default to the
    // busiest pool (or null when there are no games yet).
    setPool(prev => (prev && data.some(p => p.pool_key === prev) ? prev : (data[0]?.pool_key ?? null)));
  }

  useEffect(() => { refreshPools(); }, []);

  return (
    <PoolContext.Provider value={{ pool, setPool, pools, refreshPools }}>
      {children}
    </PoolContext.Provider>
  );
}

export function usePool() {
  return useContext(PoolContext);
}

// Human label for the currently-selected pool.
export function currentPoolLabel(pool, pools) {
  if (!pool) return 'No pool';
  const found = pools && pools.find(p => p.pool_key === pool);
  return found ? found.label : poolLabel(pool);
}
