// =================================================================
// VIER OP EEN RIJ (Connect 4)
// -----------------------------------------------------------------
// Local two-player, same-device game. 7 columns x 6 rows, classic
// rules: click/tap a column to drop a disc into its lowest empty
// slot, first to connect 4 in a row (horizontal, vertical, or
// diagonal) wins. Keeps a running score across rounds, same pattern
// as tictactoe.js.
//
// PLAYER AVATARS — same layered fallback as tictactoe.js (see the
// big comment block there): photo -> custom SVG -> emoji, tried in
// that order via <img onerror>. Blue vs pink, same pairing as the
// tictactoe X/O colors, for a consistent look across both games.
// To use REAL photos later, just replace
// assets/icons/connect4/player-blue.png and player-pink.png with
// actual photos (same filenames). Nothing else needs to change —
// just make sure both files end up the same dimensions/aspect ratio
// as each other, or the loser of that comparison will look visibly
// squashed/stretched next to the other player's avatar.
//
// Pink's SVG/emoji fallback tiers are visually matched to blue's:
// same circle SVG shape (assets/icons/connect4/player-pink.svg vs
// player-blue.svg, identical viewBox/radius/ring), and — because no
// "pink circle" emoji exists in Unicode, only a pink HEART (🩷),
// which some devices don't render — the in-page status text
// ("Roze ... is aan de beurt") uses that same pink circle SVG
// inline instead of the heart, so it always looks identical in
// shape to blue's plain-text 🔵, never a mismatched glyph.
// =================================================================

import { siteRootUrl } from './utils.js';

const COLS = 7;
const ROWS = 6;

const AVATARS = {
  B: {
    photo: siteRootUrl('assets/icons/connect4/player-blue.png'),
    svg: siteRootUrl('assets/icons/connect4/player-blue.svg'),
    emoji: '🔵',
    alt: 'Speler Blauw',
  },
  P: {
    photo: siteRootUrl('assets/icons/connect4/player-pink.png'),
    svg: siteRootUrl('assets/icons/connect4/player-pink.svg'),
    emoji: '🩷',
    alt: 'Speler Roze',
  },
};

/** Builds an <img> that quietly degrades: photo -> custom SVG -> emoji span, entirely via onerror (no network probing, no flicker on the happy path). Identical pattern for blue and pink — see tictactoe.js. */
function buildAvatarImg(player, className) {
  const avatar = AVATARS[player];
  const img = document.createElement('img');
  img.src = avatar.photo;
  img.alt = avatar.alt;
  img.className = className;
  img.dataset.stage = 'photo';

  img.addEventListener('error', () => {
    if (img.dataset.stage === 'photo') {
      // Photo missing/failed to load — drop to the custom SVG.
      img.dataset.stage = 'svg';
      img.src = avatar.svg;
      return;
    }
    // SVG failed too — replace the <img> with a plain emoji span,
    // which can't fail to render.
    const fallback = document.createElement('span');
    fallback.className = className + ' c4-avatar-emoji';
    fallback.textContent = avatar.emoji;
    fallback.setAttribute('aria-hidden', 'true');
    img.replaceWith(fallback);
  });

  return img;
}

function mountAvatar(placeholder, player, className) {
  if (!placeholder) return;
  placeholder.replaceChildren(buildAvatarImg(player, className));
}

// -----------------------------------------------------------------
// WIN DETECTION
// grid is a flat array of length COLS*ROWS, index = row * COLS + col,
// row 0 = bottom row (so gravity just means "first free row from 0 up").
// -----------------------------------------------------------------
const DIRECTIONS = [
  [1, 0],  // horizontal
  [0, 1],  // vertical
  [1, 1],  // diagonal /
  [1, -1], // diagonal \
];

function findWinningLine(grid, lastRow, lastCol, player) {
  for (const [dc, dr] of DIRECTIONS) {
    const line = [[lastRow, lastCol]];

    for (let step = 1; step < 4; step++) {
      const r = lastRow + dr * step;
      const c = lastCol + dc * step;
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) break;
      if (grid[r * COLS + c] !== player) break;
      line.push([r, c]);
    }
    for (let step = 1; step < 4; step++) {
      const r = lastRow - dr * step;
      const c = lastCol - dc * step;
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) break;
      if (grid[r * COLS + c] !== player) break;
      line.push([r, c]);
    }

    if (line.length >= 4) return line;
  }
  return null;
}

export function initConnect4() {
  const board = document.getElementById('c4Board');
  if (!board) return; // not on the connect4 page

  const statusEl = document.getElementById('c4Status');
  const scoreBEl = document.getElementById('scoreBlue');
  const scorePEl = document.getElementById('scorePink');
  const scoreDrawEl = document.getElementById('scoreDrawC4');
  const newRoundBtn = document.getElementById('c4NewRound');
  const resetScoreBtn = document.getElementById('c4ResetScore');

  mountAvatar(document.getElementById('avatarBlue'), 'B', 'c4-score-avatar-img');
  mountAvatar(document.getElementById('avatarPink'), 'P', 'c4-score-avatar-img');

  // Build the 7x6 grid of column-drop buttons once, top row (game
  // row 5) first down to bottom row (game row 0) last. CSS grid
  // places elements in that same document order top-to-bottom, so
  // row 0 — where gravity fills first — correctly ends up at the
  // bottom of the board (see connect4.css).
  const cells = [];
  for (let row = ROWS - 1; row >= 0; row--) {
    for (let col = 0; col < COLS; col++) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'c4-cell';
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('aria-label', `Rij ${row + 1}, kolom ${col + 1}`);
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);
      cell.addEventListener('click', () => handleColumnClick(col));
      board.appendChild(cell);
      cells.push(cell);
    }
  }

  function cellAt(row, col) {
    return cells.find((c) => Number(c.dataset.row) === row && Number(c.dataset.col) === col);
  }

  let grid = Array(COLS * ROWS).fill(null);
  let currentPlayer = 'B';
  let roundOver = false;
  const score = { B: 0, P: 0, draw: 0 };

  function playerLabel(player) {
    return player === 'B'
      ? 'Blauw <img src="' + siteRootUrl('assets/icons/connect4/player-blue.svg') + '" alt="" class="emoji-icon">'
      : 'Roze <img src="'  + siteRootUrl('assets/icons/connect4/player-pink.svg') + '" alt="" class="emoji-icon">';
  }

  // innerHTML (not textContent) because playerLabel() drops in a
  // pink <img> for the status text — see the top-of-file comment
  // for why (no reliable "pink circle" emoji to use as plain text).
  function updateStatus(html) {
    statusEl.innerHTML = html;
  }

  function updateScoreboard() {
    scoreBEl.textContent = String(score.B);
    scorePEl.textContent = String(score.P);
    scoreDrawEl.textContent = String(score.draw);
  }

  function lowestFreeRow(col) {
    for (let row = 0; row < ROWS; row++) {
      if (!grid[row * COLS + col]) return row;
    }
    return -1; // column full
  }

  function endRound({ winner, line }) {
    roundOver = true;
    board.classList.add('c4-board-over');

    if (winner) {
      score[winner] += 1;
      updateStatus(`${playerLabel(winner)} wint deze ronde! 🎉`);
      line.forEach(([r, c]) => cellAt(r, c)?.classList.add('c4-cell-win'));
    } else {
      score.draw += 1;
      updateStatus('Gelijkspel! Het bord zit vol.');
    }

    updateScoreboard();
  }

  function handleColumnClick(col) {
    if (roundOver) return;

    const row = lowestFreeRow(col);
    if (row === -1) return; // column full

    grid[row * COLS + col] = currentPlayer;
    const cell = cellAt(row, col);
    mountAvatar(cell, currentPlayer, 'c4-cell-avatar-img');
    cell.classList.add(currentPlayer === 'B' ? 'c4-cell-blue' : 'c4-cell-pink');
    cell.classList.add('c4-cell-drop');

    const winningLine = findWinningLine(grid, row, col, currentPlayer);
    if (winningLine) {
      endRound({ winner: currentPlayer, line: winningLine });
      return;
    }

    if (grid.every(Boolean)) {
      endRound({ winner: null, line: null });
      return;
    }

    currentPlayer = currentPlayer === 'B' ? 'P' : 'B';
    updateStatus(`${playerLabel(currentPlayer)} is aan de beurt`);
  }

  function startNewRound() {
    grid = Array(COLS * ROWS).fill(null);
    currentPlayer = currentPlayer === 'B' ? 'P' : 'B';
    roundOver = false;
    board.classList.remove('c4-board-over');

    cells.forEach((cell) => {
      cell.replaceChildren();
      cell.className = 'c4-cell';
    });

    updateStatus(`${playerLabel(currentPlayer)} is aan de beurt`);
  }

  function resetScore() {
    score.B = 0;
    score.P = 0;
    score.draw = 0;
    updateScoreboard();
    startNewRound();
  }

  newRoundBtn.addEventListener('click', startNewRound);
  resetScoreBtn.addEventListener('click', resetScore);

  updateStatus(`${playerLabel(currentPlayer)} is aan de beurt`);
  updateScoreboard();
}
