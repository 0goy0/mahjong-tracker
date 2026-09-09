// ─── Global motion layer ──────────────────────────────────────────────────────
// Lenis smooth scroll synced to GSAP ScrollTrigger, per-page staggered entrances
// + scroll reveals, and count-up on the big scoreboard numbers. Wired once into
// the shell (Layout) so every route gets it. Honours prefers-reduced-motion.
//
// Robustness notes (learned the hard way on the Players grid):
//  • Count-up writes to the text node's nodeValue, NOT textContent — writing
//    textContent replaces the node (a childList mutation) which would retrigger
//    the MutationObserver and cause a ScrollTrigger.refresh() storm mid-reveal.
//  • ScrollTrigger.refresh() is debounced, never called per-mutation.
//  • A failsafe force-reveals any managed block that ends up hidden while it is
//    actually inside the viewport, so nothing can get stuck "barely showing".

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger);

export const reduceMotion =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let lenis = null;

export function initSmoothScroll() {
  if (lenis || reduceMotion || typeof window === 'undefined') return;
  lenis = new Lenis({
    duration: 1.05,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
  });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
}

export function scrollToTop() {
  if (lenis) lenis.scrollTo(0, { immediate: true });
  else if (typeof window !== 'undefined') window.scrollTo(0, 0);
}

const NUM_RE = /^([+\-]?)(\d[\d,]*)(\.\d+)?(%|yr|\+|k)?$/;

export function animatePage(root) {
  if (!root || reduceMotion) return () => {};

  const vh = () => window.innerHeight || 800;
  const seen = new WeakSet();
  const counted = new WeakSet();
  const managed = [];
  const pending = new Set();      // hidden, awaiting their reveal animation
  let observer = null;
  let revealRaf = 0;
  let refreshTimer = null;
  let failsafeTimer = null;

  const ctx = gsap.context(() => {}, root);

  const scheduleRefresh = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => ScrollTrigger.refresh(), 180);
  };

  function topLevelBlocks() {
    const pageRoot = root.firstElementChild || root;
    let blocks = Array.from(pageRoot.children);
    if (blocks.length === 1 && blocks[0].children.length > 1) blocks = Array.from(blocks[0].children);
    let els = blocks.flatMap((el) =>
      el.matches('[class*="grid"], [class*="space-y"]') && el.children.length > 1
        ? Array.from(el.children)
        : [el]
    );
    return els.filter((el) => el && el.nodeType === 1 && el.offsetParent !== null);
  }

  // HIDE — runs synchronously in the observer's pre-paint microtask (and in the
  // pre-paint useLayoutEffect for the first render), so a block never paints
  // visible before its reveal. This is what kills the "appears then vanishes"
  // flash on async-mounted grids like Players.
  function hideNew() {
    topLevelBlocks().forEach((el) => {
      if (seen.has(el) || pending.has(el)) return;
      pending.add(el);
      gsap.set(el, { opacity: 0, y: 12 });
    });
  }

  // REVEAL — debounced; fade the pending blocks in. In-view ones play now (with a
  // total-time-capped stagger); below-the-fold ones wait for a scroll trigger.
  function revealPending() {
    ctx.add(() => {
      const fresh = Array.from(pending).filter((el) => el.isConnected && el.offsetParent !== null);
      pending.clear();
      if (fresh.length) {
        const h = vh();
        const above = [], below = [];
        fresh.forEach((el) => {
          seen.add(el); managed.push(el);
          (el.getBoundingClientRect().top < h * 0.96 ? above : below).push(el);
        });
        if (above.length) {
          gsap.to(above, {
            opacity: 1, y: 0, duration: 0.42, ease: 'power2.out', overwrite: 'auto',
            stagger: { amount: Math.min(0.26, above.length * 0.036) },
          });
        }
        below.forEach((el) => ScrollTrigger.create({
          trigger: el, start: 'top 92%', once: true,
          onEnter: () => gsap.to(el, { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out', overwrite: 'auto' }),
        }));
      }

      // Count-up big scoreboard numbers as they appear (via nodeValue, see notes).
      // Opt out with [data-no-countup] (e.g. dense grids of many numbers, where a
      // ~1s climb per value just reads as lag) — those show their real value at once.
      root.querySelectorAll('.font-display').forEach((el) => {
        if (counted.has(el) || el.children.length) return;
        if (el.closest('[data-no-countup]')) return;
        const m = el.textContent.trim().match(NUM_RE);
        if (!m) return;
        const target = parseFloat((m[2] + (m[3] || '')).replace(/,/g, ''));
        if (!isFinite(target) || target === 0) return;
        counted.add(el);
        const dec = m[3] ? m[3].length - 1 : 0;
        const prefix = m[1], suffix = m[4] || '';
        const setText = (v) => {
          const s = prefix + v.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec }) + suffix;
          const n = el.firstChild;
          if (n && n.nodeType === 3) n.nodeValue = s; else el.textContent = s;
        };
        const o = { v: 0 };
        gsap.to(o, {
          v: target, duration: 1.1, ease: 'power2.out',
          scrollTrigger: { trigger: el, start: 'top 96%', once: true },
          onUpdate: () => setText(o.v),
          onComplete: () => setText(target),
        });
      });

      scheduleRefresh();
    });
  }

  // Never let an in-view block stay hidden (guards against a missed trigger or an
  // odd animation clock on some device).
  function failsafe() {
    const h = vh();
    const show = (el) => {
      if (!el.isConnected) return;
      const r = el.getBoundingClientRect();
      if (r.top < h && r.bottom > 0 && parseFloat(getComputedStyle(el).opacity) < 0.9) {
        seen.add(el);
        gsap.to(el, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out', overwrite: true });
      }
    };
    managed.forEach(show);
    pending.forEach(show);
  }

  try {
    hideNew();        // hide first-render content pre-paint
    revealPending();  // then reveal it
    observer = new MutationObserver(() => {
      hideNew();      // synchronous, pre-paint — async content never flashes
      cancelAnimationFrame(revealRaf);
      revealRaf = requestAnimationFrame(revealPending); // reveal on the next frame → no visible gap
    });
    observer.observe(root, { childList: true, subtree: true });
    // Content settles → stop watching; then a few failsafe sweeps.
    setTimeout(() => { observer && observer.disconnect(); }, 4500);
    failsafeTimer = setTimeout(() => { failsafe(); setTimeout(failsafe, 1500); setTimeout(failsafe, 3300); }, 1200);
  } catch (err) {
    console.warn('[motion] animatePage failed, revealing all', err);
    root.querySelectorAll('*').forEach((el) => { el.style.opacity = ''; el.style.transform = ''; });
  }

  return () => {
    cancelAnimationFrame(revealRaf);
    clearTimeout(refreshTimer);
    clearTimeout(failsafeTimer);
    if (observer) observer.disconnect();
    ctx.revert();
  };
}
