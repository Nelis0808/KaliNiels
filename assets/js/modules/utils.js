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

// Matches an http(s) URL, stopping before any trailing punctuation
// that's more likely to be sentence punctuation than part of the URL
// itself (a closing paren/quote, a comma, a period, ...) — so
// "zie https://example.com/stad." linkifies without swallowing the
// trailing full stop into the href.
const URL_PATTERN = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g;

/**
 * Escapes `text` for safe HTML insertion (same rules as escapeHtml
 * above) AND turns any http(s) URL inside it into a clickable link
 * that opens in a new tab. Used anywhere user-authored free text
 * (e.g. a wishlist city's "description" in travel-countries.json)
 * might contain a link — plain escapeHtml() alone would leave it as
 * inert text.
 *
 * `target="_blank"` always comes with `rel="noopener noreferrer"` —
 * without `noopener`, the page opened in the new tab gets a
 * `window.opener` handle back to this one (a real, if niche,
 * security/perf footgun); `noreferrer` additionally drops the
 * Referer header.
 */
export function linkifyText(text) {
  const str = String(text ?? '');
  let result = '';
  let lastIndex = 0;
  for (const match of str.matchAll(URL_PATTERN)) {
    const url = match[0];
    result += escapeHtml(str.slice(lastIndex, match.index));
    const safeUrl = escapeHtml(url);
    result += `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeUrl}</a>`;
    lastIndex = match.index + url.length;
  }
  result += escapeHtml(str.slice(lastIndex));
  return result;
}

/**
 * Returns extra CSS classes for a map pin (.rz-pin) based purely on
 * its own %-position on the map, so a pin sitting near an edge
 * doesn't get its name label clipped by the map viewport's
 * `overflow: hidden` boundary, or visually buried under the
 * fixed-corner coord-badge (bottom-right) / hover-name badge
 * (bottom-left) — see .rz-pin-edge-* in assets/css/pages/reizen.css.
 * Geometry-based, not a per-country/city special case — ANY pin
 * that ends up near an edge (e.g. Miami on the US map) gets the fix
 * automatically, including future ones nobody has added yet.
 */
export function pinEdgeClasses(xPercent, yPercent) {
  const classes = [];
  if (yPercent > 82) classes.push('rz-pin-edge-bottom');
  if (xPercent < 12) classes.push('rz-pin-edge-left');
  else if (xPercent > 88) classes.push('rz-pin-edge-right');
  return classes;
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
// EXCLUSIVE DROPDOWN COORDINATION
// -----------------------------------------------------------------
// Several independent header dropdowns (profile "👤" and settings
// "⚙️" being the main ones) each manage their own open/closed state.
// Without coordination, opening one doesn't close the other, so both
// can end up open and overlapping at once.
//
// Fix: whenever a dropdown opens, it dispatches this event on
// `document` with its own id in `detail.source`. Every OTHER
// dropdown listens for it and closes itself if the event didn't
// come from itself — see profile-dropdown.js / settings-dropdown.js
// for the two current listeners. Add a new header dropdown later?
// Dispatch this same event on open and listen for it the same way
// to keep it playing nicely with the others.
// -----------------------------------------------------------------
export const EXCLUSIVE_DROPDOWN_EVENT = 'site-dropdown-open';

/** Tells every other exclusive dropdown to close. Call this right after a dropdown opens. */
export function announceDropdownOpen(source) {
  document.dispatchEvent(new CustomEvent(EXCLUSIVE_DROPDOWN_EVENT, { detail: { source } }));
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
