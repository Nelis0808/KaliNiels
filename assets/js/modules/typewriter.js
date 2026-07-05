// =================================================================
// TYPEWRITER EFFECT
// Animates any heading marked with `data-typewriter`, typing it out
// character by character. Opt-in on purpose — not every hero heading
// should have this effect, so it only runs where you explicitly add
// the attribute in the HTML, e.g.:
//
//   <h1 data-typewriter>Example</h1>
//
// Skipped entirely for prefers-reduced-motion users, and the full
// text is exposed via aria-label immediately so screen readers never
// have to "wait" for the animation to finish.
// =================================================================

import { qsa, prefersReducedMotion } from './utils.js';

function typewrite(heading) {
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

export function initTypewriter() {
  qsa('[data-typewriter]').forEach(typewrite);
}