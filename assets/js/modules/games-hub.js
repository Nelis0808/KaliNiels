// =================================================================
// GAMES HUB
// -----------------------------------------------------------------
// Renders the grid of game-cards on games-hub.html. Same
// pattern as home-cards.js: one array here is the single source of
// truth, add a new game by adding an entry to `games` below.
//   - status: 'available'   -> renders as a clickable link
//   - status: 'coming-soon' -> renders disabled, "Binnenkort" badge
// =================================================================

import { escapeHtml } from './utils.js';

const games = [
  {
    title: 'Boter, Kaas & Eieren',
    description: 'Het klassieke tic-tac-toe. Speel zo vaak als je wilt, terug-en-weer.',
    href: 'games/tictactoe.html',
    emoji: '❌⭕',
    status: 'available',
  },
  {
    title: 'Vier op een Rij',
    description: 'Wie krijgt er als eerste vier schijven op een rij?',
    href: 'games/connect4.html',
    emoji: '🔵',
    status: 'available',
  },
  {
    title: 'Wordle',
    description: 'Raad het Engelse woord. Kies zelf hoeveel letters (4 t/m 10).',
    href: 'games/wordle.html',
    emoji: '🟩🟨',
    status: 'available',
  },
  {
    title: 'Galgje',
    description: 'Raad het woord voordat het poppetje af is.',
    href: 'games/hangman.html',
    emoji: '✏️',
    status: 'available',
  },
  {
    title: 'Geheugenspel',
    description: 'Draai de kaartjes om en vind alle paren.',
    emoji: '🧠',
    status: 'coming-soon',
  },
  {
    title: 'Quiz',
    description: 'Test elkaar met leuke weetjes en vragen.',
    emoji: '❓',
    status: 'coming-soon',
  },
];

function renderCard(game) {
  const isAvailable = game.status === 'available' && game.href;

  const inner = `
    <div class="card-icon" aria-hidden="true">${game.emoji}</div>
    <div>
      <h4>${escapeHtml(game.title)}</h4>
      <p>${escapeHtml(game.description)}</p>
      ${!isAvailable ? '<span class="badge">Binnenkort</span>' : ''}
    </div>
  `;

  if (isAvailable) {
    return `<a href="${game.href}" class="card">${inner}</a>`;
  }

  return `<div class="card card-disabled" aria-disabled="true">${inner}</div>`;
}

export function initGamesHub() {
  const grid = document.getElementById('gamesGrid');
  if (!grid) return; // not on the games hub page

  grid.innerHTML = games.map(renderCard).join('');
}
