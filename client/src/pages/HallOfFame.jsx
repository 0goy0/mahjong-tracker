import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { C } from '../theme';

// Reusable record grid — shared by Hall of Fame (all-time) and Season of Fame.
function RecordGrid({ records }) {
  if (!records.length) {
    return (
      <div className="rounded-2xl border p-10 text-center" style={{ background: C.card, borderColor: C.border }}>
        <p style={{ color: C.textMuted }}>No games logged yet — go make some history.</p>
      </div>
    );
  }
  return (
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
  );
}

export default function HallOfFame() {
  const [tab, setTab] = useState('all');            // 'all' | 'season'
  const [allTime, setAllTime] = useState(null);
  const [season, setSeason] = useState(null);
  const [seasons, setSeasons] = useState([]);
  const [seasonId, setSeasonId] = useState(null);

  useEffect(() => {
    api.getHallOfFame().then(d => setAllTime(d && !d.error ? d : { records: [], totalGames: 0 }));
    api.getSeasons().then(d => { if (d && !d.error) { setSeasons(d.seasons || []); setSeasonId(d.current?.id || null); } });
  }, []);

  useEffect(() => {
    setSeason(null);
    api.getSeasonFame(seasonId).then(d => setSeason(d && !d.error ? d : { records: [], totalGames: 0, season: null }));
  }, [seasonId]);

  const data = tab === 'all' ? allTime : season;
  const records = data?.records || [];
  const seasonLabel = (seasons.find(s => s.id === seasonId) || {}).label || season?.season?.label || 'Season';

  const Tab = ({ id, children }) => (
    <button onClick={() => setTab(id)} className="px-4 py-2 rounded-xl text-sm font-semibold"
      style={{
        background: tab === id ? C.gold : C.card,
        color: tab === id ? '#1a1a1a' : C.textMuted,
        border: `1px solid ${tab === id ? C.gold : C.border}`,
      }}>
      {children}
    </button>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: C.text }}>{tab === 'all' ? 'Hall of Fame' : 'Season of Fame'}</h1>
        <p className="text-sm mt-1" style={{ color: C.textMuted }}>
          {tab === 'all'
            ? <>All-time records across every mode.{allTime && <> {' '}<span style={{ color: C.gold, fontWeight: 600 }}>{allTime.totalGames.toLocaleString()}</span> ranked games all-time.</>}</>
            : <>{seasonLabel} records.{season && <> {' '}<span style={{ color: C.gold, fontWeight: 600 }}>{(season.totalGames || 0).toLocaleString()}</span> games this season.</>}</>}
        </p>
      </div>

      <div className="flex gap-2 items-center flex-wrap">
        <Tab id="all">🏛️ Hall of Fame</Tab>
        <Tab id="season">🌸 Season of Fame</Tab>
        {tab === 'season' && seasons.length > 0 && (
          <select value={seasonId || ''} onChange={e => setSeasonId(e.target.value)}
            className="px-3 py-2 rounded-xl text-sm font-semibold"
            style={{ background: C.card, color: C.text, border: `1px solid ${C.border}`, cursor: 'pointer' }}>
            {seasons.map(s => <option key={s.id} value={s.id}>{s.label}{s.current ? ' (current)' : ''}</option>)}
          </select>
        )}
      </div>

      {!data ? (
        <div className="rounded-2xl border p-10 text-center" style={{ background: C.card, borderColor: C.border }}>
          <p style={{ color: C.textMuted }}>Loading…</p>
        </div>
      ) : (
        <RecordGrid records={records} />
      )}
    </div>
  );
}
