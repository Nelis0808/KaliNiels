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

// -----------------------------------------------------------------
// SITE ROOT PATH HELPER
// -----------------------------------------------------------------
// Config data (siteConfig.pages, siteConfig.nav, ...) stores hrefs
// as root-relative strings like "index.html" or "games-hub.html".
// That's correct when a page lives at the site root, but breaks for
// pages nested in a subfolder (e.g. games/tictactoe.html), where the
// browser would instead resolve "index.html" against games/.
//
// This module (utils.js) always lives at assets/js/modules/utils.js
// — exactly 3 folders below the site root — so climbing up 3 levels
// from its own URL reliably gives the site root, however deep the
// page importing it happens to be.
// -----------------------------------------------------------------
const SITE_ROOT = new URL('../../../', import.meta.url).href;

/** Resolves a root-relative path (e.g. "index.html", "assets/x.svg") to a URL that works from any page depth. */
export function siteRootUrl(relativePath) {
  return new URL(relativePath, SITE_ROOT).href;
}
