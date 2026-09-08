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
  let observer = null;
  let processTimer = null;
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

  function process() {
    ctx.add(() => {
      const fresh = topLevelBlocks().filter((el) => !seen.has(el));
      if (fresh.length) {
        const h = vh();
        const above = [], below = [];
        fresh.forEach((el) => {
          seen.add(el); managed.push(el);
          (el.getBoundingClientRect().top < h * 0.95 ? above : below).push(el);
        });
        // In-view blocks animate in immediately — self-completing gsap.from, so
        // there is no trigger to miss and they can never get stuck hidden. The
        // stagger is capped in TOTAL time (`amount`) so a big roster still reveals
        // quickly instead of trailing a long "barely showing" tail.
        if (above.length) {
          gsap.from(above, {
            opacity: 0, y: 18, duration: 0.5, ease: 'power3.out', overwrite: 'auto',
            stagger: { amount: Math.min(0.45, above.length * 0.05) },
          });
        }
        // Below-the-fold blocks reveal on scroll (still gsap.from → ends visible).
        below.forEach((el) => gsap.from(el, {
          opacity: 0, y: 24, duration: 0.55, ease: 'power3.out', overwrite: 'auto',
          scrollTrigger: { trigger: el, start: 'top 92%', once: true },
        }));
      }

      // Count-up big scoreboard numbers as they appear (via nodeValue, see notes).
      root.querySelectorAll('.font-display').forEach((el) => {
        if (counted.has(el) || el.children.length) return;
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

  // Never let an in-view block stay hidden (guards against a missed trigger).
  function failsafe() {
    const h = vh();
    managed.forEach((el) => {
      if (!el.isConnected) return;
      const r = el.getBoundingClientRect();
      const inView = r.top < h && r.bottom > 0;
      if (inView && parseFloat(getComputedStyle(el).opacity) < 0.9) {
        gsap.to(el, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out', overwrite: true });
      }
    });
  }

  try {
    process();
    observer = new MutationObserver(() => {
      clearTimeout(processTimer);
      processTimer = setTimeout(process, 80);
    });
    observer.observe(root, { childList: true, subtree: true });
    // Content settles → stop watching; then two failsafe sweeps.
    setTimeout(() => { observer && observer.disconnect(); }, 4500);
    // Sweep a few times so an in-view block can never linger faded, whatever the
    // device does with animation timing.
    failsafeTimer = setTimeout(() => { failsafe(); setTimeout(failsafe, 1500); setTimeout(failsafe, 3300); }, 1200);
  } catch (err) {
    console.warn('[motion] animatePage failed, revealing all', err);
    root.querySelectorAll('*').forEach((el) => { el.style.opacity = ''; el.style.transform = ''; });
  }

  return () => {
    clearTimeout(processTimer);
    clearTimeout(refreshTimer);
    clearTimeout(failsafeTimer);
    if (observer) observer.disconnect();
    ctx.revert();
  };
}
