// ─── Jade Table — the dark visual world ───────────────────────────────────────
// One source of truth for colour across the app. Pages import `C` instead of
// hardcoding a local palette, so the whole surface stays cohesive. Mood:
// near-black jade felt, gold + jade accents, ivory tile-white text.

export const C = {
  // Surfaces (deepest → most raised)
  bg:            '#0a0c0b', // app background — deep near-black jade
  card:          '#111413', // panels / cards
  cardRaised:    '#171b18', // hover / elevated / table headers
  bgSubtle:      '#161a18', // subtle fills, striped rows
  bgSoft:        '#161a18', // alias of bgSubtle

  // Lines
  border:        '#262b28', // ~ivory @ 9%
  borderMuted:   '#1d221f', // ~ivory @ 5%
  borderStrong:  '#313733',

  // Ink (ivory family)
  text:          '#f4efe4', // primary — warm ivory
  textSec:       '#c7c2b4',
  textMuted:     '#918c7f',
  textFaint:     '#6d6a60',

  // Accents
  gold:          '#e8b04b', // primary — mahjong gold
  goldDim:       '#a9843a',
  goldSoft:      'rgba(232,176,75,0.14)',
  jade:          '#46b884', // secondary — jade

  // Semantics (brightened for dark)
  win:           '#34d399',
  loss:          '#f87171',
};

// Dark-glass tooltip used by every Recharts surface.
export const TOOLTIP_STYLE = {
  background: 'rgba(19,23,21,0.97)',
  border: '1px solid rgba(255,255,255,0.10)',
  color: C.text,
  borderRadius: 12,
  fontSize: 13,
  boxShadow: '0 16px 40px -12px rgba(0,0,0,0.7)',
};

// Chart chrome — the bit people forget to theme.
export const CHART = {
  grid:   'rgba(244,239,228,0.06)',
  axis:   '#6d6a60',
  ref:    'rgba(244,239,228,0.14)',
  cursor: 'rgba(244,239,228,0.16)',
  dotRing: C.card,   // "punch-out" ring around active dots on dark
  pos:    '#34d399',
  neg:    '#f87171',
};

// Multi-series palette for lines/bars that need distinct, dark-friendly hues.
export const SERIES = ['#e8b04b', '#46b884', '#60a5fa', '#c084fc', '#f472b6', '#2dd4bf', '#fb923c', '#a3e635', '#38bdf8', '#fb7185'];
