import React from 'react';

export default function StatCard({ label, value, sub, icon: Icon, iconColor }) {
  return (
    <div className="rounded-2xl border p-5 flex flex-col gap-2"
      style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>{label}</span>
        {Icon && (
          <div className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: (iconColor || '#e8b04b') + '18' }}>
            <Icon size={16} color={iconColor || '#e8b04b'} />
          </div>
        )}
      </div>
      <div className="text-2xl font-bold" style={{ color: 'var(--text)' }}>{value}</div>
      {sub && <div className="text-xs" style={{ color: 'var(--text-faint)' }}>{sub}</div>}
    </div>
  );
}
