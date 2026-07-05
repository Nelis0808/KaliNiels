// =================================================================
// HOME HUB CARDS
// -----------------------------------------------------------------
// Renders the grid of page-cards on index.html from siteConfig.pages
// (assets/js/config.js). This is the main "add a new feature" entry
// point of the whole site: shipping a new page almost always starts
// with adding one object to that array, not editing this file.
// =================================================================

import { siteConfig } from '../config.js';
import { escapeHtml } from './utils.js';

function renderCard(page) {
  const isAvailable = page.status === 'available';

  const inner = `
    <div class="card-icon" aria-hidden="true">${page.emoji}</div>
    <div>
      <h4>${escapeHtml(page.title)}</h4>
      <p>${escapeHtml(page.description)}</p>
      ${!isAvailable ? '<span class="badge">Komt nog</span>' : ''}
    </div>
  `;

  if (isAvailable) {
    return `<a href="${page.href}" class="card">${inner}</a>`;
  }

  return `<div class="card card-disabled" aria-disabled="true">${inner}</div>`;
}

export function initHomeCards() {
  const grid = document.getElementById('pageCardsGrid');
  if (!grid) return; // not on the home page

  grid.innerHTML = siteConfig.pages.map(renderCard).join('');
}
