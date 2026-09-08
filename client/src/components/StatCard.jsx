import React from 'react';

export default function StatCard({ label, value, sub, icon: Icon, iconColor }) {
  return (
    <div className="rounded-2xl border p-5 flex flex-col gap-2"
      style={{ background: '#111413', borderColor: '#262b28' }}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium" style={{ color: '#918c7f' }}>{label}</span>
        {Icon && (
          <div className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: (iconColor || '#e8b04b') + '18' }}>
            <Icon size={16} color={iconColor || '#e8b04b'} />
          </div>
        )}
      </div>
      <div className="text-2xl font-bold" style={{ color: '#f4efe4' }}>{value}</div>
      {sub && <div className="text-xs" style={{ color: '#6d6a60' }}>{sub}</div>}
    </div>
  );
}
