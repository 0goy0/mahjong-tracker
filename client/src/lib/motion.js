// ─── Global motion layer ──────────────────────────────────────────────────────
// One place that makes the whole app feel alive: Lenis smooth scroll synced to
// GSAP ScrollTrigger, per-page staggered entrances + scroll reveals, and count-up
// on the big scoreboard numbers. Wired once into the shell (Layout), so every
// route gets it for free. Honours prefers-reduced-motion.
//
// Because most pages fetch their data async (content mounts AFTER the route
// effect fires), a debounced MutationObserver keeps revealing blocks as they
// arrive, then disconnects once the page has settled.

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
  const seen = new WeakSet();     // blocks already revealed
  const counted = new WeakSet();  // numbers already counting/counted
  let timer = null;
  let observer = null;

  const ctx = gsap.context(() => {}, root);

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
      const above = [];
      fresh.forEach((el) => {
        seen.add(el);
        if (el.getBoundingClientRect().top < vh() * 0.94) {
          above.push(el);
        } else {
          gsap.set(el, { opacity: 0, y: 30 });
          ScrollTrigger.create({
            trigger: el, start: 'top 90%', once: true,
            onEnter: () => gsap.to(el, { opacity: 1, y: 0, duration: 0.75, ease: 'power3.out' }),
          });
        }
      });
      if (above.length) {
        gsap.from(above, { opacity: 0, y: 24, duration: 0.7, ease: 'power3.out', stagger: 0.07 });
      }

      // Count-up big scoreboard numbers as they appear.
      root.querySelectorAll('.font-display').forEach((el) => {
        if (counted.has(el) || el.children.length) return;
        const m = el.textContent.trim().match(NUM_RE);
        if (!m) return; // not a number yet (e.g. still "—") — try again next mutation
        const target = parseFloat((m[2] + (m[3] || '')).replace(/,/g, ''));
        if (!isFinite(target) || target === 0) return;
        counted.add(el);
        const dec = m[3] ? m[3].length - 1 : 0;
        const prefix = m[1], suffix = m[4] || '';
        const fmt = (v) => prefix + v.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec }) + suffix;
        const o = { v: 0 };
        gsap.to(o, {
          v: target, duration: 1.1, ease: 'power2.out',
          scrollTrigger: { trigger: el, start: 'top 94%', once: true },
          onUpdate: () => { el.textContent = fmt(o.v); },
          onComplete: () => { el.textContent = fmt(target); },
        });
      });

      ScrollTrigger.refresh();
    });
  }

  try {
    process();
    observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(process, 70); });
    observer.observe(root, { childList: true, subtree: true });
    // Content has settled — stop watching.
    setTimeout(() => { observer && observer.disconnect(); }, 4500);
  } catch (err) {
    // Failsafe: never leave content stuck hidden.
    console.warn('[motion] animatePage failed, revealing all', err);
    root.querySelectorAll('*').forEach((el) => { el.style.opacity = ''; el.style.transform = ''; });
  }

  return () => {
    clearTimeout(timer);
    if (observer) observer.disconnect();
    ctx.revert();
  };
}
