// =================================================================
// NAV "MEER" DROPDOWN
// -----------------------------------------------------------------
// Renders every page from siteConfig.pages that ISN'T one of the
// permanent nav links (Home / Date Ideeën / Ticketmaster) into a
// dropdown — including "coming soon" placeholders, shown disabled.
// Add a new page to config.js's `pages` array and it appears here
// automatically; no HTML edits needed for that part.
// =================================================================

import { siteConfig } from '../config.js';
import { qsa, escapeHtml, siteRootUrl } from './utils.js';

// hrefs that already have their own permanent link in the nav —
// keep this in sync with the <nav> markup in every HTML file.
const PERMANENT_LINKS = new Set(['index.html', 'date.html', 'ticketmaster.html']);

function renderItem(page) {
  const isAvailable = page.status === 'available' && page.href;

  if (isAvailable) {
    return `<a href="${siteRootUrl(page.href)}" role="menuitem">${escapeHtml(page.title)}</a>`;
  }

  return `
    <span class="dropdown-item-disabled" role="menuitem" aria-disabled="true">
      ${escapeHtml(page.title)}
      <span class="dropdown-badge">Binnenkort</span>
    </span>
  `;
}

export function initNavDropdown() {
  const dropdown = document.getElementById('navMoreDropdown');
  const trigger = document.getElementById('navMoreBtn');
  const menu = document.getElementById('navMoreMenu');
  if (!dropdown || !trigger || !menu) return; // page has no dropdown — nothing to do

  const extraPages = siteConfig.pages.filter((page) => !PERMANENT_LINKS.has(page.href));
  menu.innerHTML = extraPages.map(renderItem).join('');

  // Nothing extra to show yet? Hide the whole "Meer" entry rather
  // than displaying an empty button.
  if (extraPages.length === 0) {
    dropdown.classList.add('hidden');
    return;
  }

  function closeMenu() {
    dropdown.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
  }

  function toggleMenu() {
    const isOpen = dropdown.classList.toggle('open');
    trigger.setAttribute('aria-expanded', String(isOpen));
  }

  trigger.addEventListener('click', (event) => {
    event.stopPropagation(); // don't let the document click-listener below close it immediately
    toggleMenu();
  });

  // Click anywhere outside the dropdown closes it.
  document.addEventListener('click', (event) => {
    if (!dropdown.contains(event.target)) closeMenu();
  });

  // Escape closes it and returns focus to the trigger button.
  dropdown.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeMenu();
      trigger.focus();
    }
  });

  // Clicking a real (available) link inside it closes the dropdown too.
  qsa('a', menu).forEach((link) => link.addEventListener('click', closeMenu));
}