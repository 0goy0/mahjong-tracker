import React, { useEffect } from 'react';
import { C } from '../theme';

// A pop-in banner for a celebratory moment. It does NOT fire confetti itself —
// callers own that (via lib/celebrate) so they can size the burst — this only
// renders the card and auto-dismisses. `celebration` = { title, subtitle,
// variant: 'big' | 'small' } | null.
export default function CelebrationBanner({ celebration, onDone, duration = 3800 }) {
  useEffect(() => {
    if (!celebration) return undefined;
    const t = setTimeout(() => onDone && onDone(), duration);
    return () => clearTimeout(t);
  }, [celebration, onDone, duration]);

  if (!celebration) return null;
  const small = celebration.variant === 'small';
  return (
    <div className="fixed inset-0 z-[9998] flex items-start justify-center"
      style={{ paddingTop: small ? '11vh' : '15vh', pointerEvents: 'none' }}>
      <div key={celebration.id ?? celebration.title} className="mj-pop rounded-2xl text-center"
        style={{
          background: C.card,
          border: `1px solid ${small ? C.border : C.gold}`,
          boxShadow: small
            ? '0 16px 40px -18px rgba(25,23,20,0.40)'
            : '0 30px 70px -20px rgba(25,23,20,0.55)',
          padding: small ? '12px 22px' : '20px 32px',
        }}>
        <div className="font-bold" style={{ color: C.text, fontSize: small ? 15 : 22, letterSpacing: '-0.02em' }}>
          {celebration.title}
        </div>
        {celebration.subtitle && (
          <div className="mt-1 font-semibold" style={{ color: C.gold, fontSize: small ? 12 : 14 }}>
            {celebration.subtitle}
          </div>
        )}
      </div>
    </div>
  );
}
