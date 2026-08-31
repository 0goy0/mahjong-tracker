// Built-in game modes. Custom modes are free-text strings the user adds.
// min_tai / max_tai are kept in MODE_LABELS for display of old data but are no
// longer shown as mode buttons — tai is a separate toggle with min/max inputs.
export const MODES = [
  { value: 'vanilla', label: 'Vanilla' },
  { value: '4_fei',   label: '4 Fei' },
  { value: '8_fei',   label: '8 Fei' },
  { value: '12_fei',  label: '12 Fei' },
  { value: 'guo_san', label: 'Guo San' },
];

const _allModeLabels = [
  ...MODES,
  { value: 'min_tai', label: 'Min Tai' },
  { value: 'max_tai', label: 'Max Tai' },
];

export const MODE_LABELS = _allModeLabels.reduce((acc, m) => {
  acc[m.value] = m.label;
  return acc;
}, {});

// Falls back to the raw string for custom modes.
export function modeLabel(m) {
  return MODE_LABELS[m] || m;
}

export function modesLabel(modes) {
  if (!modes || modes.length === 0) return '—';
  return modes.map(modeLabel).join(' + ');
}

// Canonical pool identity — MUST match server/elo.js poolKey exactly. A mode-SET
// + tai bounds is its own rating universe; winds are normalized away, not part
// of identity.
export function poolKey(modes, minTai, maxTai) {
  const set = [...new Set(modes)].sort().join('+');
  return `${set}|${minTai}-${maxTai}`;
}

// Human label for a pool key, e.g. "8 Fei + Guo San · 1–6 tai".
export function poolLabel(key) {
  const [modesPart, taiPart] = String(key).split('|');
  const label = modesPart.split('+').map(modeLabel).join(' + ');
  return taiPart ? `${label} · ${taiPart.replace('-', '–')} tai` : label;
}

// Rank ladder — highest threshold first so find() returns the correct tier.
export const RANKS = [
  { min: 2800, title: 'Legend',   chinese: '天胡',  color: '#f59e0b' },
  { min: 2300, title: 'Molester', chinese: '满台',  color: '#ef4444' },
  { min: 1900, title: 'Beater',   chinese: '大牌',  color: '#a855f7' },
  { min: 1600, title: 'Stroker',  chinese: '一色',  color: '#3b82f6' },
  { min: 1350, title: 'Boner',    chinese: '半色',  color: '#22c55e' },
  { min: 1150, title: 'Pervert',  chinese: '碰碰',  color: '#14b8a6' },
  { min: 1000, title: 'Wanker',   chinese: '一台',  color: '#6b7280' },
  { min: 0,    title: 'Gooner',   chinese: '炸胡',  color: '#78716c' },
];

export function getRank(rating) {
  if (rating == null) return null;
  return RANKS.find(r => rating >= r.min) || RANKS[RANKS.length - 1];
}

export const SEAT_LABELS = { dong: '东 Dong', nan: '南 Nan', xi: '西 Xi', bei: '北 Bei' };

export const SEATS = [
  { value: 'dong', label: '东 Dong' },
  { value: 'nan', label: '南 Nan' },
  { value: 'xi', label: '西 Xi' },
  { value: 'bei', label: '北 Bei' },
];
