import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CheckCircle, AlertCircle, Plus, X, ArrowRight, Trash2, Layers } from 'lucide-react';
import { api } from '../api';
import { MODES, SEATS, poolLabel, poolKey } from '../labels';
import { usePool } from '../PoolContext';

const C = {
  card: '#ffffff', border: '#e5e4e0', borderMuted: '#ededeb',
  bg: '#fafaf8', bgSubtle: '#f5f5f2', textSec: '#374151',
  text: '#0a0a0a', textSec: '#374151', textMuted: '#6b7280', textFaint: '#9ca3af',
  win: '#15803d', loss: '#dc2626',
};

const inputStyle = {
  background: '#ffffff', border: '1px solid #d4d3cf', borderRadius: 10,
  color: '#0a0a0a', padding: '8px 12px', outline: 'none', fontSize: 14, width: '100%',
};
const labelStyle = { fontSize: 13, color: C.textMuted, fontWeight: 500, display: 'block', marginBottom: 6 };
const builtinValues = MODES.map(m => m.value);

function today() {
  return new Date().toISOString().slice(0, 10);
}

function deriveTransfers(rows, playerName) {
  const winners = rows.filter(s => s.chips > 0).map(s => ({ id: s.player_id, remaining: s.chips }));
  const losers = rows.filter(s => s.chips < 0).map(s => ({ id: s.player_id, remaining: -s.chips }));
  const transfers = [];
  let wi = 0;
  for (const l of losers) {
    while (l.remaining > 0 && wi < winners.length) {
      const w = winners[wi];
      const amt = Math.min(l.remaining, w.remaining);
      if (amt > 0) transfers.push({ from: playerName(l.id), to: playerName(w.id), amount: amt });
      l.remaining -= amt;
      w.remaining -= amt;
      if (w.remaining === 0) wi += 1;
    }
  }
  return transfers;
}

function emptySegment() {
  return { modes: ['vanilla'], customMode: '', hasTai: false, minTai: 0, maxTai: 5, rounds: 4, baseChips: 500, chips: ['', '', '', ''] };
}

function taiDefaults(modes) {
  const hasRestricted = modes.some(m => ['4_fei', '8_fei', '12_fei', 'guo_san'].includes(m));
  return hasRestricted ? { minTai: 2, maxTai: 6 } : { minTai: 0, maxTai: 5 };
}

export default function LogGame() {
  const { refreshPools } = usePool();
  const { id } = useParams();
  const navigate = useNavigate();
  const editing = Boolean(id);

  const [players, setPlayers] = useState([]);
  const [date, setDate] = useState(today());
  const [seats, setSeats] = useState(SEATS.map(s => ({ seat: s.value, player_id: '' })));
  const [segments, setSegments] = useState([emptySegment()]);
  const [duration, setDuration] = useState('');
  const [notes, setNotes] = useState('');
  const [doubleElo, setDoubleElo] = useState(false);
  const [status, setStatus] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.getPlayers().then(data => { if (Array.isArray(data)) setPlayers(data); });
  }, []);

  useEffect(() => {
    if (!id) return;
    api.getGame(id).then(g => {
      if (!g || g.error) { setStatus({ type: 'error', msg: (g && g.error) || 'Game not found' }); return; }
      setDate(g.date);
      const orderedSeats = SEATS.map(s => {
        const found = (g.seats || []).find(x => x.seat === s.value);
        return { seat: s.value, player_id: found ? String(found.player_id) : '' };
      });
      setSeats(orderedSeats);
      const gModes = Array.isArray(g.modes) && g.modes.length ? g.modes : ['vanilla'];
      const gMinTai = g.min_tai ?? 0;
      const gMaxTai = g.max_tai ?? 5;
      const gBase = g.base_chips ?? 0;
      setSegments([{
        modes: gModes,
        customMode: '',
        hasTai: gModes.includes('min_tai') || gModes.includes('max_tai') || gMinTai !== 0 || gMaxTai !== 5,
        minTai: gMinTai,
        maxTai: gMaxTai,
        rounds: g.rounds ?? 4,
        baseChips: gBase || 500,
        chips: orderedSeats.map(s => {
          const found = (g.seats || []).find(x => x.seat === s.seat);
          return found ? String(found.chips + (gBase || 0)) : '';
        }),
      }]);
      setDuration(g.duration_minutes ? String(g.duration_minutes) : '');
      setNotes(g.notes || '');
      setDoubleElo((g.rating_multiplier ?? 1) === 2);
    });
  }, [id]);

  const playerName = (pid) => {
    const p = players.find(pl => String(pl.id) === String(pid));
    return p ? p.name : `#${pid}`;
  };

  function updateSeatPlayer(idx, val) {
    setSeats(prev => prev.map((s, i) => (i === idx ? { ...s, player_id: val } : s)));
  }
  function patchSegment(i, patch) {
    setSegments(prev => prev.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  }
  function updateChip(i, seatIdx, val) {
    setSegments(prev => prev.map((s, k) => (k === i ? { ...s, chips: s.chips.map((c, j) => (j === seatIdx ? val : c)) } : s)));
  }
  function toggleMode(i, value) {
    const seg = segments[i];
    patchSegment(i, { modes: seg.modes.includes(value) ? seg.modes.filter(m => m !== value) : [...seg.modes, value] });
  }
  function toggleTai(i) {
    const seg = segments[i];
    if (seg.hasTai) {
      patchSegment(i, { hasTai: false });
    } else {
      patchSegment(i, { hasTai: true, ...taiDefaults(seg.modes) });
    }
  }
  function addCustomMode(i) {
    const seg = segments[i];
    const m = seg.customMode.trim();
    patchSegment(i, { modes: m && !seg.modes.includes(m) ? [...seg.modes, m] : seg.modes, customMode: '' });
  }
  function removeMode(i, value) {
    patchSegment(i, { modes: segments[i].modes.filter(m => m !== value) });
  }
  function addSegment() {
    setSegments(prev => [...prev, emptySegment()]);
  }
  function removeSegment(i) {
    setSegments(prev => prev.filter((_, k) => k !== i));
  }

  const allPlayersSelected = seats.every(s => s.player_id !== '');
  const playersDistinct = allPlayersSelected && new Set(seats.map(s => s.player_id)).size === 4;

  function segChipInfo(seg) {
    const base = parseInt(seg.baseChips) || 0;
    const target = base * 4;
    const vals = seg.chips.map(c => (c === '' ? null : parseInt(c)));
    const filledCount = vals.filter(v => v !== null && !isNaN(v)).length;
    const allFilled = filledCount === 4;
    const sum = filledCount > 0 ? vals.filter(v => v !== null && !isNaN(v)).reduce((a, b) => a + b, 0) : null;
    const autoFourth = filledCount === 3 ? target - sum : null;
    return { vals, allFilled, filledCount, sum, base, target, autoFourth };
  }
  function segValid(seg) {
    const { allFilled, sum, target } = segChipInfo(seg);
    return seg.modes.length > 0 && allFilled && sum === target;
  }

  const canSubmit = playersDistinct && segments.length > 0 && segments.every(segValid);

  function segToPayload(seg) {
    const base = parseInt(seg.baseChips) || 0;
    return {
      date,
      modes: seg.modes,
      rounds: seg.rounds,
      min_tai: seg.minTai,
      max_tai: seg.maxTai,
      base_chips: base,
      rating_multiplier: doubleElo ? 2 : 1,
      duration_minutes: duration ? parseInt(duration) : null,
      notes: notes || null,
      seats: seats.map((s, idx) => ({ seat: s.seat, player_id: parseInt(s.player_id), chips: parseInt(seg.chips[idx]) - base })),
    };
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setStatus(null);

    let result;
    if (editing) {
      result = await api.updateGame(id, segToPayload(segments[0]));
    } else {
      result = await api.createGames(segments.map(segToPayload));
    }
    setSubmitting(false);

    if (result.error) { setStatus({ type: 'error', msg: result.error }); return; }
    refreshPools();

    if (editing) {
      setStatus({ type: 'success', msg: 'Changes saved!' });
      navigate('/dashboard');
      return;
    }

    const n = result.count || segments.length;
    setStatus({ type: 'success', msg: `Logged ${n} game${n > 1 ? 's' : ''} from this session!` });
    setSeats(SEATS.map(s => ({ seat: s.value, player_id: '' })));
    setSegments([emptySegment()]);
    setDate(today());
    setDuration('');
    setNotes('');
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: C.text }}>{editing ? 'Edit Game' : 'Log Session'}</h1>
        <p className="text-sm mt-1" style={{ color: C.textMuted }}>
          {editing ? 'Update this logged game' : 'Record a sitting — add a segment for each ruleset you played.'}
        </p>
      </div>

      {status && (
        <div className="flex items-center gap-3 rounded-xl px-4 py-3" style={{
          background: status.type === 'success' ? '#f0fdf4' : '#fef2f2',
          border: `1px solid ${status.type === 'success' ? '#bbf7d0' : '#fecaca'}`,
        }}>
          {status.type === 'success' ? <CheckCircle size={18} color="#22c55e" /> : <AlertCircle size={18} color="#ef4444" />}
          <span style={{ color: status.type === 'success' ? '#15803d' : '#dc2626', fontSize: 14 }}>{status.msg}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Date */}
        <div>
          <label style={labelStyle}>Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            style={{ ...inputStyle, colorScheme: 'light' }} />
        </div>

        {/* Players */}
        <div>
          <label style={labelStyle}>Players (same seats all session)</label>
          <div className="space-y-3">
            {SEATS.map((seat, idx) => {
              const takenIds = new Set(seats.filter((_, i) => i !== idx).map(s => s.player_id).filter(Boolean));
              return (
                <div key={seat.value} className="flex items-center gap-3 rounded-xl p-3"
                  style={{ background: C.bgSubtle, border: `1px solid ${C.border}` }}>
                  <div className="w-20 text-sm font-semibold flex-shrink-0" style={{ color: '#f59e0b' }}>{seat.label}</div>
                  <select
                    value={seats[idx].player_id}
                    onChange={e => updateSeatPlayer(idx, e.target.value)}
                    style={{ ...inputStyle, width: undefined, flex: 1, cursor: 'pointer' }}
                  >
                    <option value="">Select player...</option>
                    {players.map(p => (
                      <option key={p.id} value={p.id} disabled={takenIds.has(String(p.id))}>
                        {p.name}{takenIds.has(String(p.id)) ? ' (already seated)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
          {!playersDistinct && allPlayersSelected && (
            <p className="text-xs mt-2" style={{ color: C.loss }}>Each seat must have a different player.</p>
          )}
        </div>

        {/* Segments */}
        {segments.map((seg, i) => {
          const { allFilled, sum, base, target, autoFourth, filledCount } = segChipInfo(seg);
          const customModes = seg.modes.filter(m => !builtinValues.includes(m) && m !== 'min_tai' && m !== 'max_tai');
          const settlement = (playersDistinct && allFilled && sum === target)
            ? deriveTransfers(seats.map((s, idx) => ({ player_id: s.player_id, chips: parseInt(seg.chips[idx]) - base })), playerName)
            : [];
          return (
            <div key={i} className="rounded-2xl border p-5 space-y-5" style={{ background: C.card, borderColor: C.border }}>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: C.text }}>
                  <Layers size={15} color="#f59e0b" /> {editing ? 'Ruleset' : `Segment ${i + 1}`}
                </span>
                {!editing && segments.length > 1 && (
                  <button type="button" onClick={() => removeSegment(i)} className="flex items-center gap-1 text-xs"
                    style={{ color: C.loss, background: 'none', border: 'none', cursor: 'pointer' }}>
                    <Trash2 size={13} /> Remove
                  </button>
                )}
              </div>

              {/* Modes */}
              <div>
                <label style={labelStyle}>Modes (pick one or more)</label>
                <div className="flex flex-wrap gap-2">
                  {MODES.map(m => {
                    const active = seg.modes.includes(m.value);
                    return (
                      <button key={m.value} type="button" onClick={() => toggleMode(i, m.value)}
                        className="px-4 py-2 rounded-xl text-sm font-medium transition-colors"
                        style={{
                          background: active ? '#f59e0b' : C.bgSubtle,
                          color: active ? '#0a0a0a' : C.textSec,
                          border: `1px solid ${active ? '#f59e0b' : C.border}`,
                          cursor: 'pointer',
                        }}>
                        {m.label}
                      </button>
                    );
                  })}
                </div>
                {customModes.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {customModes.map(m => (
                      <span key={m} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium"
                        style={{ background: '#f59e0b', color: '#0a0a0a' }}>
                        {m}
                        <button type="button" onClick={() => removeMode(i, m)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', color: '#0a0a0a' }}>
                          <X size={14} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 mt-3">
                  <input type="text" value={seg.customMode} onChange={e => patchSegment(i, { customMode: e.target.value })}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomMode(i); } }}
                    placeholder="Add a custom mode..." style={{ ...inputStyle, maxWidth: 260 }} />
                  <button type="button" onClick={() => addCustomMode(i)} disabled={!seg.customMode.trim()}
                    className="flex items-center gap-1 px-3 py-2 rounded-xl text-sm font-medium"
                    style={{
                      background: C.bgSubtle, border: `1px solid ${C.border}`,
                      color: seg.customMode.trim() ? '#f59e0b' : C.textFaint,
                      cursor: seg.customMode.trim() ? 'pointer' : 'not-allowed',
                    }}>
                    <Plus size={15} /> Add
                  </button>
                </div>
                {seg.modes.length === 0 && <p className="text-xs mt-2" style={{ color: C.loss }}>Select at least one mode.</p>}
                {seg.modes.length > 0 && (
                  <p className="text-xs mt-2" style={{ color: C.textFaint }}>
                    Rating pool: <span style={{ color: C.textSec, fontWeight: 500 }}>{poolLabel(poolKey(seg.modes, seg.minTai, seg.maxTai))}</span>
                  </p>
                )}
              </div>

              {/* Tai */}
              <div>
                <label style={labelStyle}>Tai restriction</label>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => toggleTai(i)}
                    className="px-4 py-2 rounded-xl text-sm font-medium"
                    style={{
                      background: seg.hasTai ? '#f59e0b' : C.bgSubtle,
                      color: seg.hasTai ? '#0a0a0a' : C.textSec,
                      border: `1px solid ${seg.hasTai ? '#f59e0b' : C.border}`,
                      cursor: 'pointer',
                    }}>
                    Tai
                  </button>
                  {seg.hasTai && (
                    <div className="flex items-center gap-2 flex-1">
                      <input type="number" min="0" value={seg.minTai} aria-label="Min tai"
                        onChange={e => patchSegment(i, { minTai: Math.max(0, parseInt(e.target.value) || 0) })}
                        style={{ ...inputStyle, width: 80, flex: 'none' }} placeholder="Min" />
                      <span style={{ color: C.textFaint, fontSize: 13 }}>–</span>
                      <input type="number" min="1" value={seg.maxTai} aria-label="Max tai"
                        onChange={e => patchSegment(i, { maxTai: Math.max(1, parseInt(e.target.value) || 1) })}
                        style={{ ...inputStyle, width: 80, flex: 'none' }} placeholder="Max" />
                    </div>
                  )}
                </div>
              </div>

              {/* Winds */}
              <div>
                <label style={labelStyle}>Winds (feng)</label>
                <div className="flex items-center gap-2">
                  {[4, 7].map(w => {
                    const active = seg.rounds === w;
                    return (
                      <button key={w} type="button" onClick={() => patchSegment(i, { rounds: w })}
                        className="px-4 py-2 rounded-xl text-sm font-medium transition-colors"
                        style={{
                          background: active ? '#f59e0b' : C.bgSubtle,
                          color: active ? '#0a0a0a' : C.textSec,
                          border: `1px solid ${active ? '#f59e0b' : C.border}`,
                          cursor: 'pointer',
                        }}>
                        {w} winds
                      </button>
                    );
                  })}
                  <input type="number" min="1" value={seg.rounds}
                    onChange={e => patchSegment(i, { rounds: Math.max(1, parseInt(e.target.value) || 1) })}
                    style={{ ...inputStyle, width: 90, flex: 'none' }} aria-label="Custom number of winds" />
                </div>
              </div>

              {/* Chips */}
              <div>
                <label style={labelStyle}>Chips</label>
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-sm flex-shrink-0" style={{ color: C.textMuted }}>Starting chips per player</span>
                  <input type="number" min="1" value={seg.baseChips}
                    onChange={e => patchSegment(i, { baseChips: parseInt(e.target.value) || 0 })}
                    style={{ ...inputStyle, width: 100, flex: 'none' }} placeholder="500" />
                </div>
                <div className="space-y-2">
                  {seats.map((s, idx) => {
                    const isLast = idx === 3;
                    const threeEntered = filledCount === 3 && (seg.chips[idx] === '' || seg.chips[idx] == null);
                    const autoVal = isLast && threeEntered ? autoFourth : null;
                    return (
                      <div key={s.seat} className="flex items-center gap-3 rounded-xl p-2.5"
                        style={{ background: C.bgSubtle, border: `1px solid ${C.border}` }}>
                        <div className="w-28 text-sm flex-shrink-0"
                          style={{ color: s.player_id ? C.text : C.textFaint }}>
                          {s.player_id ? playerName(s.player_id) : SEATS[idx].label}
                        </div>
                        <input type="number" placeholder={autoVal != null ? String(autoVal) : 'Final count'}
                          value={seg.chips[idx]}
                          onChange={e => updateChip(i, idx, e.target.value)}
                          style={{ ...inputStyle, width: 130, flex: 'none' }} />
                        {seg.chips[idx] !== '' && !isNaN(parseInt(seg.chips[idx])) && (
                          <span className="text-sm tabular-nums" style={{
                            color: parseInt(seg.chips[idx]) - base > 0 ? C.win : parseInt(seg.chips[idx]) - base < 0 ? C.loss : C.textMuted
                          }}>
                            {parseInt(seg.chips[idx]) - base > 0 ? '+' : ''}{parseInt(seg.chips[idx]) - base}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
                {(allFilled || (filledCount === 3 && autoFourth != null)) && (
                  <div className="flex items-center gap-2 rounded-xl px-3 py-2 mt-2" style={{
                    background: (allFilled && sum === target) ? '#f0fdf4' : '#fef2f2',
                    border: `1px solid ${(allFilled && sum === target) ? '#bbf7d0' : '#fecaca'}`,
                  }}>
                    {(allFilled && sum === target) ? <CheckCircle size={15} color="#22c55e" /> : <AlertCircle size={15} color="#ef4444" />}
                    <span style={{ fontSize: 13, color: (allFilled && sum === target) ? '#15803d' : '#dc2626' }}>
                      {allFilled && sum === target
                        ? `Total: ${sum} ✓`
                        : `Total must be ${target} (${base} × 4) — currently ${sum ?? '?'}`}
                    </span>
                  </div>
                )}
                {settlement.length > 0 && (
                  <div className="rounded-xl p-3 mt-2" style={{ background: C.bgSubtle, border: `1px solid ${C.border}` }}>
                    <div className="text-xs font-medium mb-2" style={{ color: C.textMuted }}>Settlement</div>
                    <div className="space-y-1.5">
                      {settlement.map((t, k) => (
                        <div key={k} className="flex items-center gap-2 text-sm">
                          <span style={{ color: C.loss, fontWeight: 500 }}>{t.from}</span>
                          <ArrowRight size={13} color={C.textFaint} />
                          <span style={{ color: C.win, fontWeight: 500 }}>{t.to}</span>
                          <span className="ml-auto font-semibold" style={{ color: '#f59e0b' }}>{t.amount}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {!editing && (
          <button type="button" onClick={addSegment}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium w-full justify-center"
            style={{ background: C.card, color: '#f59e0b', border: `1px dashed #f59e0b44`, cursor: 'pointer' }}>
            <Plus size={16} /> Add another ruleset segment
          </button>
        )}

        {/* Duration + notes */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label style={labelStyle}>Duration (minutes, optional)</label>
            <input type="number" min="1" value={duration} onChange={e => setDuration(e.target.value)}
              placeholder="e.g. 90" style={inputStyle} />
          </div>
        </div>
        <div>
          <label style={labelStyle}>Notes (optional)</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Any notes about this session..." rows={2}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={doubleElo} onChange={e => setDoubleElo(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: '#f59e0b', cursor: 'pointer' }} />
          <span style={{ fontSize: 14, color: doubleElo ? '#f59e0b' : '#6b7280', fontWeight: doubleElo ? 600 : 400 }}>
            ⚡ Double ELO day — all rating changes ×2
          </span>
        </label>

        <button type="submit" disabled={!canSubmit || submitting}
          className="w-full py-3 rounded-xl font-semibold text-sm transition-opacity"
          style={{
            background: canSubmit ? '#f59e0b' : C.bgSubtle,
            color: canSubmit ? '#0a0a0a' : C.textFaint,
            border: `1px solid ${canSubmit ? '#f59e0b' : C.border}`,
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            opacity: submitting ? 0.7 : 1,
          }}>
          {submitting
            ? (editing ? 'Saving...' : 'Logging...')
            : (editing ? 'Save Changes' : (segments.length > 1 ? `Log ${segments.length} games` : 'Log Game'))}
        </button>
      </form>
    </div>
  );
}
