import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Home, PlusCircle, Users, BarChart2, Swords, Layers, Trophy, Database, ClipboardList, Sun, Moon } from 'lucide-react';
import { usePool } from '../PoolContext';
import { C, useTheme } from '../theme';
import { initSmoothScroll, scrollToTop, animatePage } from '../lib/motion';

function ThemeToggle() {
  const { mode, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      title={mode === 'light' ? 'Switch to dark' : 'Switch to light'}
      aria-label="Toggle light / dark"
      className="flex-shrink-0 flex items-center justify-center rounded-lg transition-colors"
      style={{ width: 32, height: 32, background: C.cardRaised, border: `1px solid ${C.border}`, color: C.textSec, cursor: 'pointer' }}
    >
      {mode === 'light' ? <Moon size={15} /> : <Sun size={15} />}
    </button>
  );
}

// Re-runs the page motion (entrance + scroll reveals + count-ups) on every route.
function PageMotion() {
  const { pathname } = useLocation();
  const ref = useRef(null);
  useLayoutEffect(() => {
    scrollToTop();
    const cleanup = animatePage(ref.current);
    return cleanup;
  }, [pathname]);
  return (
    <div ref={ref}>
      <Outlet />
    </div>
  );
}

const navItems = [
  { to: '/', icon: Home, label: 'Home' },
  { to: '/log', icon: PlusCircle, label: 'Log Game' },
  { to: '/history', icon: ClipboardList, label: 'History' },
  { to: '/players', icon: Users, label: 'Players' },
  { to: '/ratings', icon: Trophy, label: 'Ratings' },
  { to: '/analytics', icon: BarChart2, label: 'Analytics' },
  { to: '/h2h', icon: Swords, label: 'H2H' },
  { to: '/data', icon: Database, label: 'Data' },
];

const mobileNavItems = [
  { to: '/', icon: Home, label: 'Home' },
  { to: '/ratings', icon: Trophy, label: 'Ratings' },
  { to: '/log', icon: PlusCircle, label: 'Log' },
  { to: '/players', icon: Users, label: 'Players' },
  { to: '/history', icon: ClipboardList, label: 'History' },
];

const SIDEBAR = 'var(--sidebar)'; // a touch deeper than the content for separation

function PoolFilterBar() {
  const { pool, setPool, pools } = usePool();
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 px-4 md:px-8 py-2.5 border-b backdrop-blur-md"
      style={{ background: 'var(--bar-bg)', borderColor: C.border }}>
      <Layers size={14} color={C.textFaint} style={{ flexShrink: 0 }} />
      <span className="text-xs font-medium mr-1 uppercase tracking-wider" style={{ color: C.textFaint, flexShrink: 0, fontSize: 10.5 }}>Pool</span>
      {pools.length === 0 ? (
        <span className="text-xs" style={{ color: C.textFaint }}>No games logged yet</span>
      ) : (
        <div className="flex items-center gap-1.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {pools.map(p => {
            const active = pool === p.pool_key;
            return (
              <button
                key={p.pool_key}
                onClick={() => setPool(p.pool_key)}
                className="px-3 py-1 rounded-lg text-xs font-medium transition-colors"
                style={{
                  background: active ? C.gold : C.cardRaised,
                  color: active ? '#0a0c0b' : C.textSec,
                  border: `1px solid ${active ? C.gold : C.border}`,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                {p.label}
                <span style={{ opacity: active ? 0.65 : 0.5, marginLeft: 5 }}>{p.games}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="ml-auto pl-2 flex-shrink-0"><ThemeToggle /></div>
    </div>
  );
}

export default function Layout() {
  const progressRef = useRef(null);
  useEffect(() => {
    initSmoothScroll();
    const anim = gsap.fromTo(
      progressRef.current,
      { scaleX: 0 },
      { scaleX: 1, ease: 'none', scrollTrigger: { start: 0, end: () => document.body.scrollHeight - window.innerHeight, scrub: 0.25 } }
    );
    return () => { anim.scrollTrigger && anim.scrollTrigger.kill(); anim.kill(); };
  }, []);
  return (
    <div className="flex min-h-screen" style={{ background: C.bg }}>
      {/* Scroll progress */}
      <div className="fixed top-0 left-0 right-0 z-[60] h-[2.5px]" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div ref={progressRef} className="h-full origin-left" style={{ background: C.gold, transform: 'scaleX(0)' }} />
      </div>
      {/* Sidebar — desktop only */}
      <aside className="hidden md:flex w-56 flex-shrink-0 flex-col border-r"
        style={{ background: SIDEBAR, borderColor: C.border, position: 'sticky', top: 0, height: '100vh' }}>
        <div className="relative flex items-center gap-3 px-4 py-5 border-b overflow-hidden" style={{ borderColor: C.border }}>
          {/* soft gold glow behind the mark */}
          <div className="absolute pointer-events-none" style={{ top: -30, left: -18, width: 120, height: 120, background: 'radial-gradient(circle, rgba(232,176,75,0.22), transparent 65%)' }} />
          <div className="relative w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-xl select-none"
            style={{ background: C.gold, color: '#0a0a0a', boxShadow: '0 6px 20px -4px rgba(232,176,75,0.55)' }}>
            麻
          </div>
          <div className="relative">
            <div className="font-bold text-sm" style={{ color: C.text, letterSpacing: '-0.01em' }}>Mahjong</div>
            <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.gold, marginTop: 0, fontSize: 10 }}>Ranked</div>
          </div>
        </div>

        <nav className="flex-1 px-2.5 py-4 flex flex-col gap-0.5">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors"
              style={({ isActive }) => ({
                background: isActive ? C.goldSoft : 'transparent',
                color: isActive ? C.gold : C.textMuted,
              })}
            >
              {({ isActive }) => (
                <>
                  <Icon size={16} color={isActive ? C.gold : C.textMuted} strokeWidth={isActive ? 2.4 : 2} />
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="px-4 py-4 border-t" style={{ borderColor: C.border }}>
          <div className="text-xs" style={{ color: C.textFaint }}>Singapore Mahjong · v1.0</div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 flex flex-col" style={{ background: C.bg }}>
        <PoolFilterBar />
        <div className="p-4 md:p-8 pb-24 md:pb-8">
          <PageMotion />
        </div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="flex md:hidden fixed bottom-0 left-0 right-0 z-50 border-t backdrop-blur-md"
        style={{ background: 'var(--nav-bg)', borderColor: C.border }}>
        {mobileNavItems.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} end={to === '/'} style={{ flex: 1 }}>
            {({ isActive }) => (
              <div className="flex flex-col items-center justify-center py-2 gap-0.5">
                <Icon size={20} color={isActive ? C.gold : C.textMuted} strokeWidth={isActive ? 2.4 : 2} />
                <span className="text-xs font-medium" style={{ color: isActive ? C.gold : C.textMuted }}>{label}</span>
              </div>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
