// =================================================================
// SCROLL REVEAL
// Adds `.visible` to any `.fade-up` element the moment it enters
// the viewport (see the fade-up styles in assets/css/utilities.css).
// =================================================================

import { qsa, prefersReducedMotion } from './utils.js';

const threshold = 0.2;

export function initRevealOnScroll() {
  const items = qsa('.fade-up');
  if (items.length === 0) return;

  if (prefersReducedMotion()) {
    // Skip the animation entirely and just show the content.
    items.forEach((item) => item.classList.add('visible'));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: threshold }
  );

  items.forEach((item) => observer.observe(item));
}
