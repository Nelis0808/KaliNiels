// =================================================================
// GAMES HUB
// -----------------------------------------------------------------
// Renders the grid of game-cards on games-hub.html. Same
// pattern as home-cards.js: one array here is the single source of
// truth, add a new game by adding an entry to `games` below.
//   - status: 'available'   -> renders as a clickable link
//   - status: 'coming-soon' -> renders disabled, "Binnenkort" badge
// =================================================================

import { escapeHtml, siteRootUrl } from './utils.js';

// Plain emoji per game — matches the original, simple hub style. The
// exceptions are connect4/snake/wallz: there's no "pink circle" emoji
// to pair with blue's 🔵, so each uses its own matched-scale SVG pair
// (assets/icons/connect4, assets/icons/snake, assets/icons/wallz —
// identical viewBox, radius, and ring style, so they line up
// pixel-for-pixel at any size via the .emoji-icon class).
const games = [
  {
    title: 'Boter, Kaas & Eieren',
    description: 'Het klassieke tic-tac-toe. Met eigen icoontjes.',
    href: 'games/tictactoe.html',
    emoji: '❌⭕',
    status: 'available',
  },
  {
    title: 'Vier op een Rij',
    description: 'Het klassieke vier op een rij. Met eigen icoontjes.',
    href: 'games/connect4.html',
    emoji: `${get_emoji('connect4/player-blue.png', 'connect4/player-blue.svg')}
            ${get_emoji('connect4/player-pink.png', 'connect4/player-pink.svg')}`,
    status: 'available',
  },
  {
    title: 'Snake',
    description: 'Laat je tegenstander in je spoor crashen. Toetsenbord vereist!',
    href: 'games/snake.html',
    emoji: `${get_emoji('snake/player-blue.png', 'snake/player-blue.svg')}
            ${get_emoji('snake/player-pink.png', 'snake/player-pink.svg')}`,
    status: 'available',
  },
  {
    title: 'Wallz',
    description: 'Beweeg en soboteer om als eerst naar de overkant te komen.',
    href: 'games/wallz.html',
    emoji: `${get_emoji('wallz/player-blue.png', 'wallz/player-blue.svg')}
            ${get_emoji('wallz/player-pink.png', 'wallz/player-pink.svg')}`,
    status: 'available',
  },
  {
    title: 'Wordle NL/EN',
    description: 'Raad het Engelse woord.',
    href: 'games/wordle.html',
    emoji: '🟩🟨',
    status: 'available',
  },
  {
    title: 'Galgje Engels',
    description: 'Raad het woord voordat...',
    href: 'games/hangman.html',
    emoji: '✏️',
    status: 'available',
  },
  {
    title: 'Galgje met eigen woord',
    description: 'Speler 1 verzint, speler 2 raadt.',
    href: 'games/hangman-custom.html',
    emoji: '🙈',
    status: 'available',
  },
  {
    title: 'BlackJack',
    description: 'Kom zo dicht mogelijk bij 21.',
    href: 'games/blackjack.html',
    emoji: '🃏',
    status: 'available',
  },
  {
    title: 'Spiderette',
    description: 'Los alle vier de reeksen op.',
    href: 'games/spiderette.html',
    emoji: '🕷️',
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

function get_emoji(local_path, local_backup = '') {
  const path    = 'assets/icons/' + local_path
  const primary = siteRootUrl(path);

  if (!local_backup) {
    return `<img src="${primary}" alt="" class="emoji-icon">`;
  }

  const backup   = 'assets/icons/' + local_backup
  const fallback = siteRootUrl(backup);

  return `<img src="${primary}" alt="" class="emoji-icon"
      onerror="this.onerror=null;this.src='${fallback}'">`;
}

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
