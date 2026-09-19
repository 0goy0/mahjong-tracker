import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { C } from '../theme';

// Cross-mode all-time records. Not pool-scoped — these are the group's greatest
// hits across every universe. Same data as the bot's /halloffame.
export default function HallOfFame() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.getHallOfFame().then(d => setData(d && !d.error ? d : { records: [], totalGames: 0 }));
  }, []);

  const records = data?.records || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: C.text }}>Hall of Fame</h1>
        <p className="text-sm mt-1" style={{ color: C.textMuted }}>
          All-time records across every mode.
          {data && (
            <> {' '}<span style={{ color: C.gold, fontWeight: 600 }}>{data.totalGames.toLocaleString()}</span> ranked games played all-time.</>
          )}
        </p>
      </div>

      {!data ? (
        <div className="rounded-2xl border p-10 text-center" style={{ background: C.card, borderColor: C.border }}>
          <p style={{ color: C.textMuted }}>Loading…</p>
        </div>
      ) : records.length === 0 ? (
        <div className="rounded-2xl border p-10 text-center" style={{ background: C.card, borderColor: C.border }}>
          <p style={{ color: C.textMuted }}>No games logged yet — go make some history.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {records.map(r => (
            <div key={r.key} className="rounded-2xl border p-5 flex items-center gap-4"
              style={{ background: C.card, borderColor: C.border }}>
              <div className="flex-shrink-0 flex items-center justify-center rounded-xl"
                style={{ width: 48, height: 48, fontSize: 25, background: C.bgSubtle, border: `1px solid ${C.border}` }}>
                {r.icon}
              </div>
              <div className="min-w-0">
                <div className="uppercase tracking-wider font-medium" style={{ color: C.textFaint, fontSize: 10.5 }}>{r.label}</div>
                <div className="font-bold truncate" style={{ color: C.text, fontSize: 16 }}>{r.name}</div>
                <div className="tabular-nums font-bold" style={{ color: C.gold, fontSize: 17 }}>{r.value}</div>
                {r.sub && <div className="text-xs truncate mt-0.5" style={{ color: C.textMuted }}>{r.sub}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
