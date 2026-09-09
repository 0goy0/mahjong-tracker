// ─── Confetti ──────────────────────────────────────────────────────────────────
// A short, tasteful confetti burst in the tracker's tile colours — gold, jade,
// lantern red, paper — fired from the two lower corners like party poppers. Pure
// canvas, zero dependencies, self-cleaning, and silent under reduced motion.

const COLORS = ['#e8b04b', '#c68a1e', '#2f8f66', '#46b884', '#dc2626', '#f4efe4'];

export function fireConfetti({ count = 120, power = 1 } = {}) {
  if (typeof window === 'undefined') return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const W = window.innerWidth;
  const H = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const canvas = document.createElement('canvas');
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  Object.assign(canvas.style, {
    position: 'fixed', inset: '0', width: '100%', height: '100%',
    pointerEvents: 'none', zIndex: '9999',
  });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // Two poppers from the lower corners, angled inward and up.
  const origins = [
    { x: W * 0.12, y: H + 8, a: -Math.PI / 2.5 },
    { x: W * 0.88, y: H + 8, a: -Math.PI + Math.PI / 2.5 },
  ];
  const parts = [];
  for (let i = 0; i < count; i++) {
    const o = origins[i % origins.length];
    const spread = (Math.random() - 0.5) * 0.9;
    const speed = (9 + Math.random() * 9) * power;
    parts.push({
      x: o.x, y: o.y,
      vx: Math.cos(o.a + spread) * speed + (Math.random() - 0.5) * 2,
      vy: Math.sin(o.a + spread) * speed - Math.random() * 4,
      w: 6 + Math.random() * 6, h: 4 + Math.random() * 5,
      rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
      color: COLORS[(Math.random() * COLORS.length) | 0],
      life: 0, ttl: 90 + Math.random() * 50,
    });
  }

  let raf = 0;
  function frame() {
    ctx.clearRect(0, 0, W, H);
    let alive = false;
    for (const p of parts) {
      if (p.life > p.ttl) continue;
      alive = true;
      p.life++;
      p.vy += 0.28;   // gravity
      p.vx *= 0.99;   // drag
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, 1 - p.life / p.ttl);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (alive) {
      raf = requestAnimationFrame(frame);
    } else {
      cancelAnimationFrame(raf);
      canvas.remove();
    }
  }
  raf = requestAnimationFrame(frame);
}
