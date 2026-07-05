// =================================================================
// SHARED UTILITIES
// Small, dependency-free helpers used by more than one module.
// Keep this file boring on purpose — anything feature-specific
// belongs in its own module.
// =================================================================

/** querySelector shorthand. */
export const qs = (selector, scope = document) => scope.querySelector(selector);

/** querySelectorAll shorthand, returned as a real array (not a NodeList). */
export const qsa = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

/** True if the user's OS/browser is set to reduce motion. */
export const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Basic HTML-escaping for any user-facing text that gets inserted via innerHTML. */
export function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Delays calling `fn` until `wait` ms after the last call — handy for scroll/resize listeners. */
export function debounce(fn, wait = 150) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), wait);
  };
}
