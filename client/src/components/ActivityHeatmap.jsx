import React from 'react';

// GitHub-style activity heatmap with month (x) and weekday (y) labels.
// `calendar` = [{ date: 'YYYY-MM-DD', games, net? }].
const CELL = 12, GAP = 3, LABEL_W = 26;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MUTED = 'var(--text-faint)';

const localISO = dt =>
  `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

// A proper heat ramp — yellow → orange → red — so each level is distinct and
// pops on any background (the old gold-on-gold blended together and levels 2/3
// were the same colour). Empty cells keep a muted fill.
const HEAT = ['var(--border-muted)', '#ffd24a', '#f6851f', '#d7263d'];
// Subtle outline so every cell (even empty/low) has a visible edge.
const CELL_BORDER = 'inset 0 0 0 1px rgba(120,120,120,0.25)';

export default function ActivityHeatmap({ calendar = [], palette }) {
  const colors = palette || HEAT;
  if (!calendar.length) {
    return <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>No activity yet.</p>;
  }
  const map = Object.fromEntries(calendar.map(d => [d.date, d]));

  const [fy, fm, fd] = calendar[0].date.split('-').map(Number);
  let start = new Date(fy, fm - 1, fd);
  start.setDate(start.getDate() - start.getDay()); // back to Sunday
  const end = new Date();
  end.setDate(end.getDate() + (6 - end.getDay())); // forward to Saturday
  const minStart = new Date(end); minStart.setDate(minStart.getDate() - 53 * 7);
  if (start < minStart) start = minStart;

  // Build week columns (each = 7 days, Sun..Sat) and month-label positions.
  const weeks = [];
  const monthAt = [];
  const cur = new Date(start);
  let lastMonth = -1;
  while (cur <= end) {
    const col = [];
    for (let i = 0; i < 7; i++) {
      const iso = localISO(cur);
      col.push({ iso, data: map[iso] });
      cur.setDate(cur.getDate() + 1);
    }
    const mo = Number(col[0].iso.slice(5, 7));
    monthAt.push(mo !== lastMonth ? MONTHS[mo - 1] : '');
    lastMonth = mo;
    weeks.push(col);
  }

  // Shade relative to the busiest day so the scale never saturates: split the
  // observed range into thirds (a fixed 1/2/3+ ramp made every busy league day
  // look identical). The busiest day is always the hottest colour.
  const maxGames = Math.max(1, ...calendar.map(d => d.games || 0));
  const shade = n => {
    if (!n) return colors[0];
    if (maxGames <= 3) return n >= 3 ? colors[3] : n === 2 ? colors[2] : colors[1];
    if (n <= maxGames / 3) return colors[1];
    if (n <= (maxGames * 2) / 3) return colors[2];
    return colors[3];
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'inline-flex', flexDirection: 'column' }}>
        {/* Month labels */}
        <div style={{ display: 'flex', marginLeft: LABEL_W }}>
          {weeks.map((_, wi) => (
            <div key={wi} style={{ width: CELL + GAP, fontSize: 10, color: MUTED, whiteSpace: 'nowrap', overflow: 'visible' }}>
              {monthAt[wi]}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex' }}>
          {/* Weekday labels */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: GAP, width: LABEL_W, marginTop: 2 }}>
            {['', 'Mon', '', 'Wed', '', 'Fri', ''].map((d, i) => (
              <div key={i} style={{ height: CELL, fontSize: 9, color: MUTED, lineHeight: `${CELL}px` }}>{d}</div>
            ))}
          </div>
          {/* Grid */}
          <div style={{ display: 'flex', gap: GAP, marginTop: 2 }}>
            {weeks.map((col, wi) => (
              <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: GAP }}>
                {col.map(cell => (
                  <div key={cell.iso}
                    title={cell.data
                      ? `${cell.iso}: ${cell.data.games} game${cell.data.games === 1 ? '' : 's'}${cell.data.net != null ? `, net ${cell.data.net > 0 ? '+' : ''}${cell.data.net}` : ''}`
                      : cell.iso}
                    style={{ width: CELL, height: CELL, borderRadius: 3, background: shade(cell.data?.games || 0), boxShadow: CELL_BORDER }} />
                ))}
              </div>
            ))}
          </div>
        </div>
        {/* Legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, marginLeft: LABEL_W, fontSize: 11, color: MUTED }}>
          <span>Less</span>
          {colors.map(c => (
            <span key={c} style={{ width: CELL, height: CELL, borderRadius: 3, background: c, display: 'inline-block', boxShadow: CELL_BORDER }} />
          ))}
          <span>More</span>
        </div>
      </div>
    </div>
  );
}
