import React from 'react';

export default function StatCard({ label, value, sub, icon: Icon, iconColor }) {
  return (
    <div className="rounded-2xl border p-5 flex flex-col gap-2"
      style={{ background: '#ffffff', borderColor: '#e5e4e0' }}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium" style={{ color: '#6b7280' }}>{label}</span>
        {Icon && (
          <div className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: (iconColor || '#f59e0b') + '18' }}>
            <Icon size={16} color={iconColor || '#f59e0b'} />
          </div>
        )}
      </div>
      <div className="text-2xl font-bold" style={{ color: '#0a0a0a' }}>{value}</div>
      {sub && <div className="text-xs" style={{ color: '#9ca3af' }}>{sub}</div>}
    </div>
  );
}
