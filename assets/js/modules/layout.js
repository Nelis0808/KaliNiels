// =================================================================
// LAYOUT LOADER
// -----------------------------------------------------------------
// The navbar (and the tiny "back to top" button) look identical on
// every page, so instead of pasting that HTML into every .html file,
// each page just has one empty placeholder:
//
//   <div data-include="header"></div>
//   ...
//   <div data-include="chrome-end"></div>
//
// This module fetches the matching partial from assets/partials/
// and swaps it in. It MUST finish before any other module that
// touches header elements (navbar, dropdowns, dark mode, etc.) runs
// — main.js awaits initLayout() first, before anything else.
//
// EXTENDING: adding a new shared block (e.g. a real footer later)?
// 1. Create assets/partials/your-block.html
// 2. Drop <div data-include="your-block"></div> where it belongs
// 3. Nothing else to wire up — the loop below picks it up automatically.
//
// NOTE: this relies on fetch(), which needs the page to be served
// over http(s) (GitHub Pages, `npm start`, VS Code Live Server, ...).
// Opening an .html file directly via file:// will NOT load the
// header — always run this through a local server while developing.
//
// SUBFOLDER PAGES (e.g. games/tictactoe.html): the partials above
// contain root-relative links like href="index.html". Loaded as-is
// from a subfolder, the browser would resolve those against the
// *current* page (games/index.html — wrong). To fix this generically
// (so any future page, at any depth, "just works"), we:
//   1. Work out the site root from this very script's own URL
//      (assets/js/modules/layout.js is always the same distance
//      from the root, so import.meta.url is a reliable anchor).
//   2. Fetch the partial using that root, instead of a bare relative
//      path.
//   3. After injecting the partial's HTML, rewrite every relative
//      href/src in it to be prefixed with that root, so links,
//      the logo, and icons work no matter how deep the page lives.
// =================================================================

import { siteConfig } from '../config.js';
import { siteRootUrl } from './utils.js';

// Rewrites root-relative attributes (href/src) inside a freshly
// injected partial so they resolve correctly regardless of how deep
// the current page is nested. Skips anything that's already
// absolute (http(s)://, //, #, mailto:, tel:, data:) since those
// don't need adjusting.
function rewriteRelativeLinks(container) {
  const ATTRS = ['href', 'src'];
  const SKIP_PREFIX = /^(https?:)?\/\/|^#|^mailto:|^tel:|^data:/i;

  ATTRS.forEach((attr) => {
    container.querySelectorAll(`[${attr}]`).forEach((el) => {
      const value = el.getAttribute(attr);
      if (!value || SKIP_PREFIX.test(value)) return;
      el.setAttribute(attr, siteRootUrl(value));
    });
  });
}

export async function initLayout() {
  const placeholders = Array.from(document.querySelectorAll('[data-include]'));
  if (placeholders.length === 0) return; // page has no includes — nothing to do

  await Promise.all(
    placeholders.map(async (placeholder) => {
      const name = placeholder.getAttribute('data-include');
      try {
        const response = await fetch(siteRootUrl(`assets/partials/${name}.html`));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();

        // Use a template so we can rewrite links BEFORE the markup
        // touches the live DOM (outerHTML would fire it in place
        // with the wrong links for a brief moment otherwise).
        const template = document.createElement('template');
        template.innerHTML = html;
        rewriteRelativeLinks(template.content);

        placeholder.replaceWith(template.content);
      } catch (error) {
        console.error(`Kon partial "${name}" niet laden:`, error);
      }
    })
  );

  // Fill in the one bit of the header that comes from config rather
  // than being static markup: the site name next to the ❤️ logo.
  document.querySelectorAll('[data-site-name]').forEach((el) => {
    el.textContent = siteConfig.siteName;
  });
}
