// =================================================================
// WALLZ (9x9 two-player "race to the other side, block them with
// walls" game — Quoridor-style)
// -----------------------------------------------------------------
// Same-device two-player game on a 9x9 grid.
//
// COORDINATES: the rules are specified with (col,row), 1-indexed,
// bottom-left = (1,1), top-right = (9,9). Internally this file uses
// zero-indexed {r, c} where r=0/c=0 is that same bottom-left corner
// (r = row-1, c = col-1), and only converts to the 1-indexed
// (col,row) form for on-screen labels. The board is rendered with
// row 0 at the BOTTOM (CSS grid places row 0 at the top by default,
// so rendering flips r -> displayRow = 8 - r).
//
// PLAYERS: Player 1 (blue) starts at col 5, row 1 -> {r:0, c:4} and
// wins by reaching any cell in row 9 (r === 8). Player 2 (pink)
// starts at col 5, row 9 -> {r:8, c:4} and wins by reaching any
// cell in row 1 (r === 0). Row 1 (all of it) is tinted with
// player 1's color, row 9 with player 2's — see rule 6 in the
// project brief and .wallz-cell-p1-home / .wallz-cell-p2-home in
// wallz.css.
//
// TURNS: on their turn, a player does EXACTLY ONE of:
//   - move one step orthogonally (no diagonals) into an in-bounds
//     cell not separated from their current cell by a wall. Players
//     MAY share a cell (rule 11) — a special "both players here"
//     icon is shown in that case (see buildCellContent()).
//   - place one of their 10 remaining 2x1 walls, horizontal or
//     vertical.
//
// WALLS / GRID MODEL: a wall lives at an integer "joint" (gr, gc),
// gr/gc in 0..7, the corner shared by the 4 cells (gr,gc), (gr,gc+1),
// (gr+1,gc), (gr+1,gc+1). A HORIZONTAL wall at (gr,gc) blocks
// vertical movement between row gr and row gr+1 at BOTH column gc
// and column gc+1 (a 2-wide wall). A VERTICAL wall at (gr,gc) blocks
// horizontal movement between column gc and column gc+1 at BOTH row
// gr and row gr+1. Two lookup sets track this:
//   - rowBlock has "gr,gc" whenever movement between row gr/gr+1 at
//     column gc is blocked.
//   - colBlock has "gr,gc" whenever movement between column gc/gc+1
//     at row gr is blocked.
// A wall placement is rejected outright (rule 12, "hitbox") if any
// segment it needs is already occupied, OR if another wall (either
// orientation) already anchors the exact same joint (gr,gc) — two
// walls crossing through the same point.
//
// LEGALITY CHECK (rule 10): a wall placement is only allowed if,
// after placing it (hypothetically), BOTH players still have at
// least one path to their own goal row. This is checked with a
// small breadth-first search over the 9x9 grid using the same
// rowBlock/colBlock sets used for real movement. Areas that become
// permanently unreachable are fine (rule 10 explicitly allows that)
// as long as it doesn't happen to be the only path either player
// had left.
// =================================================================

import { qs, siteRootUrl } from './utils.js';

const SIZE = 9;
const TOTAL_WALLS = 10;

const AVATAR_SRC = {
  1: siteRootUrl('assets/icons/connect4/player-blue.svg'),
  2: siteRootUrl('assets/icons/connect4/player-pink.svg'),
};

export function initWallz() {
  const root = document.getElementById('wallzApp');
  if (!root) return; // not on this page

  const boardEl = qs('#wallzBoard', root);
  const statusEl = qs('#wallzStatus', root);
  const scoreP1El = qs('#wallzScoreP1', root);
  const scoreP2El = qs('#wallzScoreP2', root);
  const wallsP1El = qs('#wallzWallsP1', root);
  const wallsP2El = qs('#wallzWallsP2', root);
  const startBtn = qs('#wallzStart', root);
  const resetScoreBtn = qs('#wallzResetScore', root);
  const modeMoveBtn = qs('#wallzModeMove', root);
  const modeWallBtn = qs('#wallzModeWall', root);
  const orientationBtn = qs('#wallzOrientation', root);

  const score = { 1: 0, 2: 0 };

  // ---- Mutable game state (re-created each round in resetBoard()) ----
  let players; // { 1: {r,c}, 2: {r,c} }
  let wallsLeft; // { 1: n, 2: n }
  let rowBlock; // Set of "gr,gc"
  let colBlock; // Set of "gr,gc"
  let usedJoints; // Set of "gr,gc" — any wall anchored here, either orientation
  let turn; // 1 | 2
  let mode; // 'move' | 'wall'
  let orientation; // 'v' | 'h'
  let running = false;
  let gameOver = false;

  const cellEls = new Map(); // "r,c" -> button element
  const jointEls = new Map(); // "gr,gc" -> button element
  const wallBarsWrap = document.createElement('div');
  wallBarsWrap.className = 'wallz-walls-layer';

  function key(r, c) {
    return `${r},${c}`;
  }

  function inBounds(r, c) {
    return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
  }

  function toLabel(r, c) {
    return `(${c + 1},${r + 1})`;
  }

  // -----------------------------------------------------------------
  // BOARD CONSTRUCTION (built once; contents/classes updated per move)
  // -----------------------------------------------------------------
  function buildBoard() {
    boardEl.replaceChildren();
    cellEls.clear();
    jointEls.clear();

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'wallz-cell';
        cell.style.gridRow = String(17 - 2 * r);
        cell.style.gridColumn = String(2 * c + 1);
        cell.setAttribute('aria-label', `Vak ${toLabel(r, c)}`);
        cell.addEventListener('click', () => handleCellClick(r, c));
        boardEl.appendChild(cell);
        cellEls.set(key(r, c), cell);
      }
    }

    for (let gr = 0; gr < SIZE - 1; gr++) {
      for (let gc = 0; gc < SIZE - 1; gc++) {
        const joint = document.createElement('button');
        joint.type = 'button';
        joint.className = 'wallz-joint';
        joint.style.gridRow = String(16 - 2 * gr);
        joint.style.gridColumn = String(2 * gc + 2);
        joint.setAttribute('aria-label', `Muur plaatsen bij ${toLabel(gr, gc)}`);
        joint.addEventListener('click', () => handleJointClick(gr, gc));
        joint.addEventListener('mouseenter', () => previewWall(gr, gc, true));
        joint.addEventListener('mouseleave', () => previewWall(gr, gc, false));
        boardEl.appendChild(joint);
        jointEls.set(key(gr, gc), joint);
      }
    }

    boardEl.appendChild(wallBarsWrap);
  }

  // -----------------------------------------------------------------
  // MOVEMENT / CONNECTIVITY HELPERS
  // -----------------------------------------------------------------
  function isBlockedBetween(r, c, dr, dc) {
    if (dr === 1) return rowBlock.has(key(r, c)); // moving up (toward row 9)
    if (dr === -1) return rowBlock.has(key(r - 1, c)); // moving down
    if (dc === 1) return colBlock.has(key(r, c)); // moving right
    if (dc === -1) return colBlock.has(key(r, c - 1)); // moving left
    return false;
  }

  function neighbors(r, c) {
    const out = [];
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nr = r + dr;
      const nc = c + dc;
      if (inBounds(nr, nc) && !isBlockedBetween(r, c, dr, dc)) out.push({ r: nr, c: nc });
    }
    return out;
  }

  /** BFS: can `start` reach any cell in row `goalRow`? */
  function hasPathToRow(start, goalRow) {
    const seen = new Set([key(start.r, start.c)]);
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift();
      if (cur.r === goalRow) return true;
      for (const n of neighbors(cur.r, cur.c)) {
        const k = key(n.r, n.c);
        if (!seen.has(k)) {
          seen.add(k);
          queue.push(n);
        }
      }
    }
    return false;
  }

  // -----------------------------------------------------------------
  // WALL PLACEMENT
  // -----------------------------------------------------------------
  function wallSegmentsFor(orient, gr, gc) {
    return orient === 'h'
      ? { set: 'row', keys: [key(gr, gc), key(gr, gc + 1)] }
      : { set: 'col', keys: [key(gr, gc), key(gr + 1, gc)] };
  }

  function canPlaceWall(orient, gr, gc, player) {
    if (wallsLeft[player] <= 0) return { ok: false, reason: 'Geen muren meer over.' };
    if (usedJoints.has(key(gr, gc))) return { ok: false, reason: 'Daar ligt al een muur.' };

    const { set, keys } = wallSegmentsFor(orient, gr, gc);
    const target = set === 'row' ? rowBlock : colBlock;
    if (keys.some((k) => target.has(k))) return { ok: false, reason: 'Muren mogen elkaar niet overlappen.' };

    // Tentatively place, then verify both players still have a path.
    keys.forEach((k) => target.add(k));
    const p1Ok = hasPathToRow(players[1], SIZE - 1);
    const p2Ok = hasPathToRow(players[2], 0);
    keys.forEach((k) => target.delete(k));

    if (!p1Ok || !p2Ok) {
      return { ok: false, reason: 'Die muur blokkeert een speler volledig — niet toegestaan.' };
    }
    return { ok: true };
  }

  function placeWall(orient, gr, gc, player) {
    const { set, keys } = wallSegmentsFor(orient, gr, gc);
    const target = set === 'row' ? rowBlock : colBlock;
    keys.forEach((k) => target.add(k));
    usedJoints.add(key(gr, gc));
    wallsLeft[player] -= 1;

    const bar = document.createElement('div');
    bar.className = `wallz-wall wallz-wall-${orient} wallz-wall-p${player}`;
    if (orient === 'h') {
      bar.style.gridRow = String(16 - 2 * gr);
      bar.style.gridColumn = `${2 * gc + 1} / span 3`;
    } else {
      bar.style.gridRow = `${15 - 2 * gr} / span 3`;
      bar.style.gridColumn = String(2 * gc + 2);
    }
    wallBarsWrap.appendChild(bar);
  }

  // -----------------------------------------------------------------
  // RENDERING
  // -----------------------------------------------------------------
  function buildAvatar(player, extraClass) {
    const img = document.createElement('img');
    img.src = AVATAR_SRC[player];
    img.alt = '';
    img.className = `wallz-head-img ${extraClass}`;
    return img;
  }

  function renderCells() {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cell = cellEls.get(key(r, c));
        const classes = ['wallz-cell'];
        if (r === 0) classes.push('wallz-cell-p1-home');
        if (r === SIZE - 1) classes.push('wallz-cell-p2-home');

        const p1Here = players[1].r === r && players[1].c === c;
        const p2Here = players[2].r === r && players[2].c === c;
        if (p1Here && p2Here) classes.push('wallz-cell-both');
        else if (p1Here) classes.push('wallz-cell-p1');
        else if (p2Here) classes.push('wallz-cell-p2');

        cell.className = classes.join(' ');
        cell.replaceChildren();

        if (p1Here && p2Here) {
          cell.appendChild(buildAvatar(1, 'wallz-head-img-both wallz-head-img-both-a'));
          cell.appendChild(buildAvatar(2, 'wallz-head-img-both wallz-head-img-both-b'));
        } else if (p1Here) {
          cell.appendChild(buildAvatar(1, ''));
        } else if (p2Here) {
          cell.appendChild(buildAvatar(2, ''));
        }
      }
    }
  }

  function clearLegalMoveHighlights() {
    cellEls.forEach((cell) => cell.classList.remove('wallz-cell-legal-move'));
  }

  function highlightLegalMoves() {
    clearLegalMoveHighlights();
    if (!running || gameOver || mode !== 'move') return;
    const p = players[turn];
    neighbors(p.r, p.c).forEach((n) => {
      cellEls.get(key(n.r, n.c)).classList.add('wallz-cell-legal-move');
    });
  }

  function updateWallsUi() {
    wallsP1El.textContent = String(wallsLeft[1]);
    wallsP2El.textContent = String(wallsLeft[2]);
  }

  function updateModeUi() {
    modeMoveBtn.setAttribute('aria-pressed', String(mode === 'move'));
    modeWallBtn.setAttribute('aria-pressed', String(mode === 'wall'));
    orientationBtn.hidden = mode !== 'wall';
    orientationBtn.textContent = orientation === 'v' ? '↕️ Verticaal' : '↔️ Horizontaal';
    boardEl.classList.toggle('wallz-board-wall-mode', mode === 'wall');
    jointEls.forEach((joint) => {
      joint.tabIndex = mode === 'wall' ? 0 : -1;
    });
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function playerLabel(player) {
    return player === 1 ? 'Blauw' : 'Roze';
  }

  function turnStatusText() {
    return mode === 'wall'
      ? `${playerLabel(turn)} is aan de beurt — kies een hoekpunt om een muur te plaatsen.`
      : `${playerLabel(turn)} is aan de beurt — klik een gemarkeerd vak om te bewegen.`;
  }

  // -----------------------------------------------------------------
  // WALL HOVER PREVIEW
  // -----------------------------------------------------------------
  function previewWall(gr, gc, show) {
    if (!running || gameOver || mode !== 'wall') return;
    const joint = jointEls.get(key(gr, gc));
    if (!show) {
      joint.classList.remove('wallz-joint-preview-ok', 'wallz-joint-preview-bad');
      return;
    }
    const result = canPlaceWall(orientation, gr, gc, turn);
    joint.classList.toggle('wallz-joint-preview-ok', result.ok);
    joint.classList.toggle('wallz-joint-preview-bad', !result.ok);
  }

  // -----------------------------------------------------------------
  // INTERACTION
  // -----------------------------------------------------------------
  function handleCellClick(r, c) {
    if (!running || gameOver || mode !== 'move') return;
    const p = players[turn];
    const isLegal = neighbors(p.r, p.c).some((n) => n.r === r && n.c === c);
    if (!isLegal) return;

    p.r = r;
    p.c = c;
    renderCells();

    const goalRow = turn === 1 ? SIZE - 1 : 0;
    if (r === goalRow) {
      endRound(turn);
      return;
    }
    endTurn();
  }

  function handleJointClick(gr, gc) {
    if (!running || gameOver || mode !== 'wall') return;
    const result = canPlaceWall(orientation, gr, gc, turn);
    if (!result.ok) {
      setStatus(result.reason);
      return;
    }
    placeWall(orientation, gr, gc, turn);
    updateWallsUi();
    previewWall(gr, gc, false);
    endTurn();
  }

  function endTurn() {
    turn = turn === 1 ? 2 : 1;
    mode = 'move';
    updateModeUi();
    highlightLegalMoves();
    setStatus(turnStatusText());
  }

  function endRound(winner) {
    running = false;
    gameOver = true;
    clearLegalMoveHighlights();
    score[winner] += 1;
    scoreP1El.textContent = String(score[1]);
    scoreP2El.textContent = String(score[2]);
    setStatus(`${playerLabel(winner)} wint! ${winner === 1 ? '🔵' : '🩷'} Klik op "Nieuwe ronde" om opnieuw te spelen.`);
    startBtn.textContent = 'Nieuwe ronde';
    startBtn.disabled = false;
  }

  // -----------------------------------------------------------------
  // ROUND LIFECYCLE
  // -----------------------------------------------------------------
  function resetBoard() {
    players = {
      1: { r: 0, c: 4 },
      2: { r: SIZE - 1, c: 4 },
    };
    wallsLeft = { 1: TOTAL_WALLS, 2: TOTAL_WALLS };
    rowBlock = new Set();
    colBlock = new Set();
    usedJoints = new Set();
    turn = 1;
    mode = 'move';
    orientation = 'v';
    gameOver = false;

    wallBarsWrap.replaceChildren();
    updateWallsUi();
    updateModeUi();
    renderCells();
    highlightLegalMoves();
  }

  function startRound() {
    resetBoard();
    running = true;
    startBtn.disabled = true;
    setStatus(turnStatusText());
  }

  function resetScore() {
    score[1] = 0;
    score[2] = 0;
    scoreP1El.textContent = '0';
    scoreP2El.textContent = '0';
  }

  // -----------------------------------------------------------------
  // WIRE UP CONTROLS
  // -----------------------------------------------------------------
  modeMoveBtn.addEventListener('click', () => {
    if (!running || gameOver) return;
    mode = 'move';
    updateModeUi();
    highlightLegalMoves();
    setStatus(turnStatusText());
  });

  modeWallBtn.addEventListener('click', () => {
    if (!running || gameOver) return;
    if (wallsLeft[turn] <= 0) {
      setStatus(`${playerLabel(turn)} heeft geen muren meer over.`);
      return;
    }
    mode = 'wall';
    clearLegalMoveHighlights();
    updateModeUi();
    setStatus(turnStatusText());
  });

  orientationBtn.addEventListener('click', () => {
    orientation = orientation === 'v' ? 'h' : 'v';
    updateModeUi();
  });

  startBtn.addEventListener('click', startRound);
  resetScoreBtn.addEventListener('click', () => {
    resetScore();
    setStatus('Score gereset. Klik op "Start" om te beginnen.');
  });

  // ---- init ----
  buildBoard();
  resetBoard();
  setStatus('Klik op "Start" om te beginnen. Blauw start onderaan, Roze bovenaan.');
}
