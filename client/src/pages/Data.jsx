import React, { useRef, useState } from 'react';
import { Download, Upload, AlertTriangle, CheckCircle, AlertCircle } from 'lucide-react';
import { api } from '../api';
import { usePool } from '../PoolContext';

import { C } from '../theme';

export default function Data() {
  const { refreshPools } = usePool();
  const fileRef = useRef(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleExport() {
    setBusy(true);
    setStatus(null);
    try {
      const data = await api.getBackup();
      if (!data || data.error) {
        setStatus({ type: 'error', msg: data?.error || 'Could not reach the server — is it running?' });
        return;
      }
      if (!Array.isArray(data.players) || !Array.isArray(data.games)) {
        setStatus({ type: 'error', msg: 'The server returned an unexpected backup format.' });
        return;
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mahjong-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke on a delay: revoking synchronously right after click cancels the
      // download in some browsers before they've finished reading the blob — this
      // was why the button could appear to "do nothing".
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setStatus({ type: 'success', msg: `Backup downloaded — ${data.players.length} players, ${data.games.length} games.` });
    } catch (err) {
      setStatus({ type: 'error', msg: `Export failed: ${err.message}` });
    } finally {
      setBusy(false);
    }
  }

  function pickFile() {
    setStatus(null);
    fileRef.current?.click();
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    let parsed;
    try { parsed = JSON.parse(await file.text()); } catch {
      setStatus({ type: 'error', msg: 'That file is not valid JSON.' });
      return;
    }
    if (parsed.app !== 'mahjong-tracker' || !Array.isArray(parsed.games)) {
      setStatus({ type: 'error', msg: 'That is not a Mahjong Tracker backup file.' });
      return;
    }
    const ok = window.confirm(
      `Restore this backup?\n\n${parsed.players?.length || 0} players and ${parsed.games.length} games will REPLACE everything currently stored. This cannot be undone.`
    );
    if (!ok) return;
    setBusy(true);
    const res = await api.restore(parsed);
    setBusy(false);
    if (res.error) { setStatus({ type: 'error', msg: res.error }); return; }
    await refreshPools();
    setStatus({ type: 'success', msg: `Restored — ${res.players} players, ${res.games} games. Ratings recomputed.` });
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: C.text }}>Data</h1>
        <p className="text-sm mt-1" style={{ color: C.textMuted }}>
          Back up your log to a file, or restore from one. Your games live only in a local database on this
          machine — export regularly to keep an off-laptop copy.
        </p>
      </div>

      {status && (
        <div className="flex items-center gap-3 rounded-xl px-4 py-3" style={{
          background: status.type === 'success' ? 'var(--tint-green)' : 'var(--tint-red)',
          border: `1px solid ${status.type === 'success' ? 'var(--tint-green)' : 'var(--tint-red)'}`,
        }}>
          {status.type === 'success'
            ? <CheckCircle size={18} color="#22c55e" />
            : <AlertCircle size={18} color="#ef4444" />}
          <span style={{ color: status.type === 'success' ? 'var(--win)' : 'var(--loss)', fontSize: 14 }}>{status.msg}</span>
        </div>
      )}

      {/* Export */}
      <div className="rounded-2xl border p-6" style={{ background: C.card, borderColor: C.border }}>
        <h3 className="font-semibold mb-1" style={{ color: C.text }}>Export backup</h3>
        <p className="text-sm mb-4" style={{ color: C.textMuted }}>
          Downloads everything in one click — every player (with avatar and Telegram link) and every game,
          including its seats and the full transfer ledger — as a single JSON file. Ratings aren't stored;
          they're recomputed exactly from the games on restore.
        </p>
        <button onClick={handleExport} disabled={busy}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold"
          style={{ background: '#e8b04b', color: '#0a0c0b', border: 'none', cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1 }}>
          <Download size={16} /> Download backup
        </button>
      </div>

      {/* Import */}
      <div className="rounded-2xl border p-6" style={{ background: C.card, borderColor: C.border }}>
        <h3 className="font-semibold mb-1" style={{ color: C.text }}>Restore from backup</h3>
        <div className="flex items-start gap-2 mb-4 rounded-xl px-3 py-2.5" style={{ background: 'var(--tint-red)', border: '1px solid var(--tint-red)' }}>
          <AlertTriangle size={16} color="#ef4444" className="flex-shrink-0 mt-0.5" />
          <p className="text-sm" style={{ color: 'var(--loss)' }}>
            Restoring <strong>replaces all current data</strong> with the file's contents. You'll be asked to
            confirm first.
          </p>
        </div>
        <input ref={fileRef} type="file" accept="application/json,.json" onChange={handleFile} style={{ display: 'none' }} />
        <button onClick={pickFile} disabled={busy}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold"
          style={{ background: C.bgSubtle, color: C.text, border: `1px solid ${C.border}`, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1 }}>
          <Upload size={16} /> Choose backup file…
        </button>
      </div>
    </div>
  );
}
