// =================================================================
// TYPEWRITER EFFECT
// Animates the main `.hero h1` heading, typing it out character by
// character. Skipped entirely for prefers-reduced-motion users, and
// the full text is exposed via aria-label immediately so screen
// readers never have to "wait" for the animation to finish.
// =================================================================

import { prefersReducedMotion } from './utils.js';

export function initTypewriter() {
  const heading = document.querySelector('.hero h1');
  if (!heading) return;

  const fullText = heading.textContent;
  heading.setAttribute('aria-label', fullText);

  if (prefersReducedMotion()) return; // leave the text static

  heading.textContent = '';
  let i = 0;

  function typeNextChar() {
    if (i <= fullText.length) {
      heading.textContent = fullText.slice(0, i);
      i += 1;
      setTimeout(typeNextChar, 45);
    }
  }

  typeNextChar();
}
