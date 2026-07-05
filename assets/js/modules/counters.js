// =================================================================
// ANIMATED COUNTERS
// Counts any element with a `data-target="1234"` attribute up from
// 0 the first time it scrolls into view. Used by the stats section
// in the reusable page template.
// =================================================================

import { qsa, prefersReducedMotion } from './utils.js';

function animateCounter(el) {
  const target = Number(el.dataset.target);
  if (Number.isNaN(target)) return;

  if (prefersReducedMotion()) {
    el.textContent = target.toLocaleString();
    return;
  }

  const durationMs = 1500;
  const startTime = performance.now();

  function tick(now) {
    const progress = Math.min((now - startTime) / durationMs, 1);
    el.textContent = Math.floor(progress * target).toLocaleString();
    if (progress < 1) requestAnimationFrame(tick);
    else el.textContent = target.toLocaleString();
  }

  requestAnimationFrame(tick);
}

export function initCounters() {
  const counters = qsa('[data-target]');
  if (counters.length === 0) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.3 }
  );

  counters.forEach((counter) => observer.observe(counter));
}
