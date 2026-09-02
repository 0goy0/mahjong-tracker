import React from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { Home, PlusCircle, Users, BarChart2, Swords, Layers, Trophy, Database, ClipboardList } from 'lucide-react';
import { usePool } from '../PoolContext';

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

function PoolFilterBar() {
  const { pool, setPool, pools } = usePool();
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 px-4 md:px-8 py-2.5 border-b backdrop-blur overflow-x-auto"
      style={{ background: 'rgba(250,250,248,0.92)', borderColor: '#e5e4e0', scrollbarWidth: 'none' }}>
      <Layers size={14} color="#9ca3af" style={{ flexShrink: 0 }} />
      <span className="text-xs font-medium mr-1" style={{ color: '#9ca3af', flexShrink: 0 }}>Pool</span>
      {pools.length === 0 ? (
        <span className="text-xs" style={{ color: '#c4c3bf' }}>No games logged yet</span>
      ) : (
        <div className="flex items-center gap-1.5">
          {pools.map(p => {
            const active = pool === p.pool_key;
            return (
              <button
                key={p.pool_key}
                onClick={() => setPool(p.pool_key)}
                className="px-3 py-1 rounded-lg text-xs font-medium transition-colors"
                style={{
                  background: active ? '#f59e0b' : '#f0efed',
                  color: active ? '#0a0a0a' : '#374151',
                  border: `1px solid ${active ? '#f59e0b' : '#e5e4e0'}`,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                {p.label}
                <span style={{ opacity: 0.55, marginLeft: 5 }}>{p.games}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  return (
    <div className="flex min-h-screen" style={{ background: '#fafaf8' }}>
      {/* Sidebar — desktop only */}
      <aside className="hidden md:flex w-56 flex-shrink-0 flex-col border-r"
        style={{ background: '#2c2c32', borderColor: '#3a3a42', position: 'sticky', top: 0, height: '100vh' }}>
        <div className="flex items-center gap-3 px-4 py-5 border-b" style={{ borderColor: '#3a3a42' }}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-xl select-none"
            style={{ background: '#f59e0b', color: '#0a0a0a', boxShadow: '0 0 16px #f59e0b44' }}>
            麻
          </div>
          <div>
            <div className="font-bold text-sm" style={{ color: '#f5f5f7', letterSpacing: '-0.01em' }}>Mahjong</div>
            <div className="text-xs" style={{ color: '#7c7c8a', marginTop: -1 }}>Tracker</div>
          </div>
        </div>

        <nav className="flex-1 px-2.5 py-4 flex flex-col gap-0.5">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  isActive ? 'bg-amber-500/15' : 'hover:bg-white/5'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={15} color={isActive ? '#f59e0b' : '#8888a0'} />
                  <span style={{ color: isActive ? '#f59e0b' : '#a0a0b8' }}>{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="px-4 py-4 border-t" style={{ borderColor: '#3a3a42' }}>
          <div className="text-xs" style={{ color: '#5a5a6a' }}>v1.0</div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 flex flex-col" style={{ background: '#fafaf8' }}>
        <PoolFilterBar />
        <div className="p-4 md:p-8 pb-24 md:pb-8">
          <Outlet />
        </div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="flex md:hidden fixed bottom-0 left-0 right-0 z-50 border-t"
        style={{ background: '#2c2c32', borderColor: '#3a3a42' }}>
        {mobileNavItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            style={{ flex: 1 }}
          >
            {({ isActive }) => (
              <div className="flex flex-col items-center justify-center py-2 gap-0.5">
                <Icon size={20} color={isActive ? '#f59e0b' : '#8888a0'} />
                <span className="text-xs font-medium" style={{ color: isActive ? '#f59e0b' : '#8888a0' }}>{label}</span>
              </div>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
