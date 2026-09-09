// ─── Theme ─────────────────────────────────────────────────────────────────────
// Colour is driven by CSS variables (see index.css) so the app can flip between
// dark ("Jade Table") and light at runtime. `C` holds var() references, so any
// inline style or module-level style object themes automatically. Recharts chart
// chrome is themed by CSS rules on the .recharts-* classes (charts don't need to
// know about the theme). ThemeProvider/useTheme own the mode + toggle.

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

// Palette — every value is a CSS variable, resolved per data-theme on <html>.
export const C = {
  bg: 'var(--bg)', card: 'var(--card)', cardRaised: 'var(--card-raised)',
  bgSubtle: 'var(--bg-subtle)', bgSoft: 'var(--bg-subtle)',
  border: 'var(--border)', borderMuted: 'var(--border-muted)', borderStrong: 'var(--border-strong)',
  text: 'var(--text)', textSec: 'var(--text-sec)', textMuted: 'var(--text-muted)', textFaint: 'var(--text-faint)',
  gold: 'var(--gold)', goldDim: 'var(--gold-dim)', goldSoft: 'var(--gold-soft)', jade: 'var(--jade)',
  win: 'var(--win)', loss: 'var(--loss)',
};

// Tooltip container (an HTML element in both custom and default Recharts tooltips,
// so var() resolves). Themes automatically.
export const TOOLTIP_STYLE = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  borderRadius: 12,
  fontSize: 13,
  boxShadow: '0 16px 40px -12px rgba(0,0,0,0.5)',
};

// Chart chrome fallbacks (valid colours for the initial SVG attributes; the CSS
// .recharts-* rules override these per theme). pos/neg bar fills read fine on both
// themes so they stay fixed.
export const CHART = {
  grid: 'var(--chart-grid)', axis: 'var(--chart-axis)', ref: 'var(--chart-ref)',
  cursor: 'var(--chart-cursor)', dotRing: 'var(--chart-dot-ring)',
  pos: '#34d399', neg: '#f87171',
};

// Distinct, theme-independent series hues for multi-line/bar charts.
export const SERIES = ['#e8b04b', '#46b884', '#60a5fa', '#c084fc', '#f472b6', '#2dd4bf', '#fb923c', '#a3e635', '#38bdf8', '#fb7185'];

// ─── Runtime theme (dark default) ───────────────────────────────────────────────
const STORAGE_KEY = 'mj-theme-v2'; // v2: light is the default; only persist on explicit toggle

export function readStoredMode() {
  if (typeof window === 'undefined') return 'light';
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch (_) { /* ignore */ }
  return 'light';
}

// Apply immediately (call before React renders to avoid a flash).
export function applyMode(mode) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', mode);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', mode === 'light' ? '#faf9f6' : '#0a0c0b');
}

const ThemeContext = createContext({ mode: 'light', toggle: () => {}, setMode: () => {} });

export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(readStoredMode);

  useEffect(() => { applyMode(mode); }, [mode]);

  const persist = (m) => { try { localStorage.setItem(STORAGE_KEY, m); } catch (_) { /* ignore */ } };
  const setMode = useCallback((m) => { const v = m === 'dark' ? 'dark' : 'light'; persist(v); setModeState(v); }, []);
  const toggle = useCallback(() => setModeState((m) => { const v = m === 'light' ? 'dark' : 'light'; persist(v); return v; }), []);

  return React.createElement(ThemeContext.Provider, { value: { mode, toggle, setMode } }, children);
}

export function useTheme() { return useContext(ThemeContext); }
