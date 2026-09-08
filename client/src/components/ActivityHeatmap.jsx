import React from 'react';

// GitHub-style activity heatmap with month (x) and weekday (y) labels.
// `calendar` = [{ date: 'YYYY-MM-DD', games, net? }].
const CELL = 12, GAP = 3, LABEL_W = 26;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MUTED = '#6d6a60';

const localISO = dt =>
  `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

export default function ActivityHeatmap({ calendar = [], palette }) {
  const colors = palette || ['#1d221f', '#f0c674', '#e8b04b', '#e8b04b'];
  if (!calendar.length) {
    return <p style={{ color: '#918c7f', fontSize: 14 }}>No activity yet.</p>;
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

  const shade = n => (!n ? colors[0] : n >= 3 ? colors[3] : n === 2 ? colors[2] : colors[1]);

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
                    style={{ width: CELL, height: CELL, borderRadius: 3, background: shade(cell.data?.games || 0) }} />
                ))}
              </div>
            ))}
          </div>
        </div>
        {/* Legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, marginLeft: LABEL_W, fontSize: 11, color: MUTED }}>
          <span>Less</span>
          {colors.map(c => (
            <span key={c} style={{ width: CELL, height: CELL, borderRadius: 3, background: c, display: 'inline-block' }} />
          ))}
          <span>More</span>
        </div>
      </div>
    </div>
  );
}
