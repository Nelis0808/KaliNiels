// =================================================================
// SNAKE (Tron-lightcycle style trail game)
// -----------------------------------------------------------------
// Same-device two-player grid game: both players constantly move in
// a direction on a grid, leaving a solid trail behind them. Whoever
// crashes into any trail (their own, the other player's, or the
// arena edge) first loses; if both crash the same tick, it's a
// draw. Player 1 = blue (WASD), Player 2 = pink (arrow keys),
// matching Connect 4's blue/pink pairing and avatar assets.
//
// NOTE: this file used to be assets/js/modules/wallz.js. It was
// renamed to Snake because that's what this game actually is — the
// "wallz" name/module now belongs to the real Wallz game (a 9x9
// Quoridor-style wall-blocking game), see wallz.js.
//
// GRID/RENDERING: a plain CSS-grid board of divs (same technique as
// connect4.js), redrawn each tick rather than using <canvas> — the
// grid here (default 30x20) is small enough that this stays cheap
// and keeps everything consistent with the rest of the site's
// (non-canvas) game pages.
//
// AVATARS: reuses connect4's exact blue/pink SVG icon pair
// (assets/icons/connect4/player-blue.svg / player-pink.svg) for the
// player heads before falling back to a plain colored square if
// those ever fail to load — see buildHeadCell(). The trail/head
// cell colors are FIXED brand colors (not the theme-swappable
// --color-secondary/--color-accent tokens), so they always match
// the blue/pink avatars regardless of which color theme (blue or
// pink) is active — see snake.css.
// =================================================================

import { qs, siteRootUrl } from './utils.js';

const COLS = 30;
const ROWS = 20;
const TICK_MS = 110;

const DIRECTIONS = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

const KEY_MAP = {
  // Player 1 — WASD
  KeyW: { player: 1, dir: 'up' },
  KeyS: { player: 1, dir: 'down' },
  KeyA: { player: 1, dir: 'left' },
  KeyD: { player: 1, dir: 'right' },
  // Player 2 — arrow keys
  ArrowUp: { player: 2, dir: 'up' },
  ArrowDown: { player: 2, dir: 'down' },
  ArrowLeft: { player: 2, dir: 'left' },
  ArrowRight: { player: 2, dir: 'right' },
};

function isOpposite(dirA, dirB) {
  const a = DIRECTIONS[dirA];
  const b = DIRECTIONS[dirB];
  return a.dx === -b.dx && a.dy === -b.dy;
}

export function initSnake() {
  const root = document.getElementById('snakeApp');
  if (!root) return; // not on this page

  const boardEl = qs('#snakeBoard', root);
  const statusEl = qs('#snakeStatus', root);
  const scoreP1El = qs('#snakeScoreP1', root);
  const scoreP2El = qs('#snakeScoreP2', root);
  const scoreDrawEl = qs('#snakeScoreDraw', root);
  const startBtn = qs('#snakeStart', root);
  const resetScoreBtn = qs('#snakeResetScore', root);

  // ---- Build the grid once; cells are addressed by index, never rebuilt ----
  const cells = [];
  boardEl.style.setProperty('--snake-cols', String(COLS));
  boardEl.style.setProperty('--snake-rows', String(ROWS));
  for (let i = 0; i < COLS * ROWS; i++) {
    const cell = document.createElement('div');
    cell.className = 'snake-cell';
    boardEl.appendChild(cell);
    cells.push(cell);
  }

  function cellIndex(x, y) {
    return y * COLS + x;
  }

  function inBounds(x, y) {
    return x >= 0 && x < COLS && y >= 0 && y < ROWS;
  }

  // ---- Game state ----
  let walls = new Set(); // "x,y" strings occupied by any trail
  let players = null; // { 1: {x,y,dir,alive}, 2: {...} }
  let running = false;
  let tickTimer = null;
  const score = { 1: 0, 2: 0, draw: 0 };

  function key(x, y) {
    return `${x},${y}`;
  }

  function resetBoard() {
    cells.forEach((cell) => {
      cell.className = 'snake-cell';
      cell.replaceChildren();
    });
    walls = new Set();

    players = {
      1: { x: Math.floor(COLS * 0.25), y: Math.floor(ROWS / 2), dir: 'right', alive: true },
      2: { x: Math.floor(COLS * 0.75), y: Math.floor(ROWS / 2), dir: 'left', alive: true },
    };

    walls.add(key(players[1].x, players[1].y));
    walls.add(key(players[2].x, players[2].y));
    buildHeadCell(players[1].x, players[1].y, 1);
    buildHeadCell(players[2].x, players[2].y, 2);
  }

  function paintCell(x, y, className) {
    if (!inBounds(x, y)) return;
    cells[cellIndex(x, y)].className = `snake-cell ${className}`;
  }

  function buildHeadCell(x, y, player) {
    const cell = cells[cellIndex(x, y)];
    cell.className = `snake-cell snake-cell-p${player}-head`;
    cell.replaceChildren();

    const avatarSrc = player === 1
      ? siteRootUrl('assets/icons/connect4/player-blue.svg')
      : siteRootUrl('assets/icons/connect4/player-pink.svg');

    const img = document.createElement('img');
    img.src = avatarSrc;
    img.alt = '';
    img.className = 'snake-head-img';
    img.addEventListener('error', () => img.remove(), { once: true }); // falls back to the plain CSS-colored cell background
    cell.appendChild(img);
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function updateScoreboard() {
    scoreP1El.textContent = String(score[1]);
    scoreP2El.textContent = String(score[2]);
    scoreDrawEl.textContent = String(score.draw);
  }

  function tick() {
    if (!running) return;

    const p1 = players[1];
    const p2 = players[2];

    const move1 = DIRECTIONS[p1.dir];
    const move2 = DIRECTIONS[p2.dir];
    const next1 = { x: p1.x + move1.dx, y: p1.y + move1.dy };
    const next2 = { x: p2.x + move2.dx, y: p2.y + move2.dy };

    const p1HitsWall = !inBounds(next1.x, next1.y) || walls.has(key(next1.x, next1.y));
    const p2HitsWall = !inBounds(next2.x, next2.y) || walls.has(key(next2.x, next2.y));
    // Head-on into the exact same cell always counts as a crash for both.
    const headOnCollision = next1.x === next2.x && next1.y === next2.y;

    const p1Dies = p1HitsWall || headOnCollision;
    const p2Dies = p2HitsWall || headOnCollision;

    if (!p1Dies) {
      walls.add(key(p1.x, p1.y)); // old head becomes a trail cell
      paintCell(p1.x, p1.y, 'snake-cell-p1-trail');
      p1.x = next1.x;
      p1.y = next1.y;
      buildHeadCell(p1.x, p1.y, 1);
    }
    if (!p2Dies) {
      walls.add(key(p2.x, p2.y));
      paintCell(p2.x, p2.y, 'snake-cell-p2-trail');
      p2.x = next2.x;
      p2.y = next2.y;
      buildHeadCell(p2.x, p2.y, 2);
    }

    if (p1Dies || p2Dies) {
      endRound(p1Dies, p2Dies);
      return;
    }

    tickTimer = setTimeout(tick, TICK_MS);
  }

  function endRound(p1Dies, p2Dies) {
    running = false;
    clearTimeout(tickTimer);

    if (p1Dies && p2Dies) {
      score.draw += 1;
      setStatus('Gelijkspel! Jullie botsten allebei tegelijk. 🤝');
    } else if (p1Dies) {
      score[2] += 1;
      setStatus('Speler Roze wint! Speler Blauw crashte. 🩷');
    } else {
      score[1] += 1;
      setStatus('Speler Blauw wint! Speler Roze crashte. 🔵');
    }

    updateScoreboard();
    startBtn.textContent = 'Nieuwe ronde';
    startBtn.disabled = false;
  }

  function startRound() {
    resetBoard();
    running = true;
    startBtn.disabled = true;
    setStatus('Blauw (WASD) vs Roze (pijltjestoetsen) — ga!');
    tickTimer = setTimeout(tick, TICK_MS);
  }

  function handleKeydown(event) {
    if (!running || !players) return;
    const mapping = KEY_MAP[event.code];
    if (!mapping) return;

    event.preventDefault();
    const player = players[mapping.player];
    // Ignore a 180-degree reversal in one tick — that would be an
    // instant, unavoidable self-collision, which reads as a bug
    // rather than a real player mistake.
    if (isOpposite(player.dir, mapping.dir)) return;
    player.dir = mapping.dir;
  }

  function resetScore() {
    score[1] = 0;
    score[2] = 0;
    score.draw = 0;
    updateScoreboard();
  }

  startBtn.addEventListener('click', startRound);
  resetScoreBtn.addEventListener('click', () => {
    resetScore();
    setStatus('Score gereset. Klik op "Start" om te beginnen.');
  });
  document.addEventListener('keydown', handleKeydown);

  // ---- init ----
  resetBoard();
  updateScoreboard();
  setStatus('Klik op "Start" om te beginnen. Blauw: WASD, Roze: pijltjestoetsen.');
}
