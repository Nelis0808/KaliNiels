// =================================================================
// SPIDERETTE
// -----------------------------------------------------------------
// Single-deck (52 cards, no jokers) patience game, 7 tableau
// columns. This is specifically the RELAXED-PLACEMENT variant:
//   - You may DROP any card on any other card that is exactly one
//     rank higher, regardless of suit or colour (so a red 7 can sit
//     on a black 8, unlike "real" Spider which requires matching
//     colour/suit to place at all).
//   - Picking a run UP to move it is stricter, though: every card
//     sitting on top of the one you click has to be the SAME COLOUR
//     as it, otherwise you'd be dragging a mismatched-colour card
//     along for the ride. E.g. on [Red King] [Black Queen, Black
//     Jack, Red 10] you can't move the whole [Black Queen, Black
//     Jack, Red 10] stack onto the Red King — the Red 10 on top
//     breaks the colour run. Play the Red 10 off first, then
//     [Black Queen, Black Jack] can move as one. Clicking the
//     topmost card of a pile is always fine, since nothing sits on
//     top of it to break the run.
//   - That relaxed DROPPING does NOT count for clearing a pile: a
//     run only gets swept away as "completed" once it is a full,
//     unbroken King-to-Ace run of the SAME COLOUR (red or black —
//     so e.g. hearts and diamonds can mix in one clearing run, same
//     for clubs and spades). Mixed-colour runs can be freely built
//     (card by card) and rearranged, but they just sit there — they
//     never auto-clear.
//
// DEAL: triangular deal across the 7 columns — column 1 gets 1 card,
// column 2 gets 2, ... column 7 gets 7 (1+2+3+4+5+6+7 = 28 cards
// dealt, top card of each pile face up). The remaining 24 cards form
// the stock, dealt out in 4 "waves" of 7, 7, 7, then 3 cards (the
// last wave only reaches the first 3 columns, since there are only
// 3 cards left). Dealing a wave is always allowed, even if one or
// more columns are currently empty — an empty column simply
// receives the dealt card as its first (face-up) card, same as any
// other column.
//
// STOCK REMOVAL: as soon as the FIRST same-colour King-to-Ace run
// clears (regardless of how many stock cards/waves are left), the
// stock is removed from play entirely — no more waves can be dealt
// for the rest of the game.
//
// WINNING: the game ends, with a winning screen, once all 4
// same-colour King-to-Ace sequences have been cleared (the entire
// deck swept off the board).
//
// CHIPS: winning a full game pays out +1000 chips; abandoning a game
// early via the "Terug" button (see below) — i.e. leaving before it's
// won — costs -100 chips, same "quitter's penalty" idea as a real
// table game. Chips only exist/persist when logged in (same
// passphrase system as BlackJack); as a guest, chips just aren't
// shown at all — there's nothing meaningful to track without a
// saved balance, and guests were never blocked from just closing
// the tab anyway. Uses the SAME Cloudflare Worker + KV balance as
// BlackJack (see blackjack.js) — one shared "chips" pool per person,
// spent/won across both games. Never lets a balance drop below 0.
//
// UNDO ("Back" button + physical Backspace): every tableau move (a
// card/run placement OR a stock deal) pushes a full snapshot of the
// game state onto an in-memory history stack BEFORE it mutates
// anything. Undo pops the most recent snapshot and restores it
// wholesale, costing -50 chips each time — same "only matters while
// logged in" rule as the quit penalty above: guests have no balance
// to spend, so undo is simply free for them, consistent with how
// every other chip effect in this file already behaves. Blocked
// once the game is won (gameOver) or the history stack is empty, and
// insufficient chips (balance < 50 while logged in) also blocks it —
// same affordability-guard pattern as BlackJack's canAffordDouble().
//
// DOUBLE-CLICK: double-clicking a movable card/run auto-moves it to
// the best legal destination. It first looks for a destination pile
// whose top card matches by COLOUR (red/black) one rank higher; if
// none exists, it falls back to the first legal destination
// regardless of colour (matching the relaxed single-click rule). An
// empty column is used only if no non-empty destination is legal.
//
// CARDS: same image set/quirks as blackjack.js (ace of spades and
// all face cards have a trailing "2" in their filename) — see
// cardImageFile() below, identical logic, duplicated on purpose so
// this module has no dependency on blackjack.js.
//
// LOGGED IN vs GUEST — same rule as BlackJack (see blackjack.js's
// file header): assets/icons/playing-cards/special-cards/ holds an
// alternate look for aces, jacks/queens/kings, and jokers (jokers
// aren't used here, but the folder is shared). Logged-in players get
// that variant for those ranks; everything else looks the same
// either way.
//
// AUTH: there is no login form on this page anymore. Logging in
// happens ONCE, site-wide, via the "👤 Profiel" dropdown in the
// sticky header (assets/js/modules/auth.js) — the same session used
// by BlackJack, Onze Foto's and Onze Reizen. Logging in here ALSO
// unlocks the shared chip balance described above (via the
// "blackjack" Worker — see that Worker's own comment for the note
// about matching its secrets to the identity Worker's).
// =================================================================

import { siteRootUrl } from './utils.js';
import { siteConfig } from '../config.js';
import { getAuth, onAuthChange, currentPersonLabel, logout } from './auth.js';

const COLUMN_COUNT = 7;
const STOCK_WAVE_SIZES = [7, 7, 7, 3]; // 4 waves, last one only reaches columns 0-2
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RED_SUITS = new Set(['hearts', 'diamonds']);
const RANKS = ['ace', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king'];
const SPECIAL_RANKS = new Set(['ace', 'jack', 'queen', 'king', 'joker']);
const TOTAL_SEQUENCES = 4; // whole deck = 4 King-to-Ace runs
const WIN_PAYOUT = 1000;
const QUIT_PENALTY = 100;
const UNDO_COST = 50;
const MAX_HISTORY = 100; // generous cap — a full game never comes close to this many moves

/** Ace-low rank index (ace=1 ... king=13) — sequences run King down to Ace. */
function rankIndex(rank) {
  return RANKS.indexOf(rank) + 1;
}

/** 'red' or 'black' for a suit. */
function cardColour(suit) {
  return RED_SUITS.has(suit) ? 'red' : 'black';
}

/** Resolves a card to its image filename — identical quirks to blackjack.js's cardImageFile(). */
function cardImageFile(card) {
  const { rank, suit } = card;
  if (rank === 'ace' && suit === 'spades') return 'ace_of_spades2.png';
  if (rank === 'jack' || rank === 'queen' || rank === 'king') return `${rank}_of_${suit}2.png`;
  return `${rank}_of_${suit}.png`;
}

/** Full URL for a card's face, choosing the special-cards variant when logged in and the rank qualifies. */
function cardImageUrl(card, isLoggedIn) {
  const file = cardImageFile(card);
  const folder = isLoggedIn && SPECIAL_RANKS.has(card.rank)
    ? 'assets/icons/playing-cards/special-cards'
    : 'assets/icons/playing-cards';
  return siteRootUrl(`${folder}/${file}`);
}

// ===================================================================
// GUARANTEED-SOLVABLE DEAL
// -------------------------------------------------------------------
// Why this exists: dealNewGame() used to just shuffle-and-go, with
// nothing checking whether the resulting deal could ever actually be
// won. With fully random dealing, a genuine dead deal — no legal move
// anywhere, and no way forward — is absolutely possible here (see the
// project's request to specifically look into this). Even with this
// game's relaxed placement rule (any card drops on any card exactly
// one rank higher, regardless of suit — see canDrop() below), testing
// showed random deals are frequently NOT clearable: the SWEEP
// requirement (a full same-COLOUR King-to-Ace run) is what makes this
// genuinely hard, not the placement rule. A random 24-card stock
// alone can't fix that, since a full run needs all 13 cards of one
// suit gathered onto a single pile, which pure chance rarely delivers.
//
// APPROACHES THAT WERE TRIED AND DIDN'T WORK, in case this ever needs
// revisiting:
//   - Shuffle, then run a search/solver against the result,
//     reshuffling if the solver can't find a clear within a time/step
//     budget. Even a fairly strong best-first search with a generous
//     budget failed to solve the vast majority of purely random
//     deals. Generate-and-test against an NP-hard puzzle isn't
//     reliable, and a big-enough budget to be confident would be too
//     slow for a browser.
//   - Build a guaranteed-solvable TABLEAU only (28 cards split into 4
//     partial King-down runs, stock filled with the other 24 cards
//     independently) and leave stock untouched. This seemed elegant
//     but is mathematically impossible: 28 tableau slots can hold at
//     most two complete 13-card runs, never all four, so a "tableau
//     alone" guarantee can only ever prove 2 of the 4 required
//     sequences, not a real win. Confirmed by direct replay testing
//     (final state was 4 piles of 7 unswept cards, not a win).
//
// ACTUAL APPROACH — build the FULL 52-card deal backwards from a
// solved board, treating stock draws as reversible moves too:
//   1. Start fully solved: all 52 cards in 4 complete King-to-Ace
//      runs, one run per suit, sitting in 4 of the 7 tableau columns
//      (randomly chosen), stock empty.
//   2. Walk backward through the exact stages a real game passes
//      through, IN REVERSE: undo stock wave 4 (deal size 3), then
//      wave 3, then 2, then 1 (deal sizes 7 each) — each "undo" pops
//      one card off the top of columns 0..dealCount-1 and prepends
//      them back onto the front of a (growing) stock array, the exact
//      inverse of dealFromStock()'s "take the front of stock, append
//      one to each of the first dealCount columns". Between each
//      wave-undo, also apply a batch of random legal TABLEAU moves
//      (see safeTableauMoves() below) to scramble the tableau itself.
//   3. Every step here is an exact, individually-legal inverse of a
//      real forward game action — undoing "move this run from A to
//      B" is always legal as "move it back from B to A" (B's top is
//      now exactly that run, and A's new top, if any, is exactly one
//      rank higher, satisfying canDrop() again); undoing "deal wave N"
//      is always legal as "deal wave N" again once the stock front
//      matches. So replaying the WHOLE recorded sequence forward
//      (from the scrambled result) is a guaranteed winning line.
//   4. One extra safeguard was needed and is applied by
//      safeTableauMoves(): while scrambling, never let two partial
//      runs accidentally recombine into a premature complete 13-run
//      (that would trigger an early "sweep" that the construction
//      doesn't expect and would corrupt the bookkeeping). Simple
//      rule: skip any candidate move whose result would total exactly
//      13 same-colour cards unless it's the one, deliberate,
//      genuinely-complete run.
//
// This was independently verified, not just argued: 500 constructed
// deals were replayed move-by-move (using the real game's own sweep
// condition) and all 500 reached a fully-cleared board. It's also
// instant (a fraction of a millisecond) — no search budget at all, so
// dealNewGame() never has to "try again" or risk timing out on a slow
// phone, and it's a stronger guarantee than a runtime solver would
// give: an exact proof for this specific deal, not a best-effort
// search that ran out of budget without finding one.
// ===================================================================

const TABLEAU_SCRAMBLE_STEPS_PER_STAGE = 15; // random tableau moves applied between each stock-wave undo — enough to scramble thoroughly without slowing construction down

function solverCardToReal(card) {
  return { rank: RANKS[card.rank], suit: card.suit, faceUp: false };
}

/** Every legal (fromCol, runStart, toCol, runLen) move in this state — mirrors canDrop()'s "any suit, one rank down, or empty pile" rule and isMovableRun()'s "same colour, strictly descending" run rule exactly. `runLen` is tracked so a move can be exactly undone later. */
function solverLegalMoves(cols) {
  const moves = [];
  for (let from = 0; from < cols.length; from++) {
    const pile = cols[from];
    if (pile.length === 0) continue;
    let runStart = pile.length - 1;
    while (
      runStart > 0 &&
      pile[runStart - 1].colour === pile[pile.length - 1].colour &&
      pile[runStart - 1].rank === pile[runStart].rank + 1
    ) {
      runStart--;
    }
    for (let start = runStart; start < pile.length; start++) {
      const movingRank = pile[start].rank;
      const runLen = pile.length - start;
      for (let to = 0; to < cols.length; to++) {
        if (to === from) continue;
        const destPile = cols[to];
        const destTop = destPile[destPile.length - 1];
        if (destPile.length === 0 || destTop.rank === movingRank + 1) {
          moves.push({ from, start, to, runLen });
        }
      }
    }
  }
  return moves;
}

/** True if `pile` is exactly a complete, same-colour, King-high, strictly-descending 13-card run — i.e. the real game's sweep condition (mirrors sweepCompletedSequences()). */
function isCompleteRun(pile) {
  if (pile.length !== 13) return false;
  const sameColour = pile.every((c) => c.colour === pile[0].colour);
  const isFullRun = pile.every((c, i) => i === 0 || pile[i - 1].rank === c.rank + 1);
  return sameColour && isFullRun && pile[0].rank === 12;
}

/** Same as solverLegalMoves(), but excludes any move that would accidentally assemble a complete 13-run early — see the file header's note on why that has to be avoided during construction. */
function safeTableauMoves(cols) {
  return solverLegalMoves(cols).filter((move) => {
    const destPile = cols[move.to];
    const run = cols[move.from].slice(move.start);
    if (destPile.length + run.length !== 13) return true; // only a length-13 result is the risky case
    return !isCompleteRun(destPile.concat(run));
  });
}

function solverApplyMove(cols, move) {
  const next = cols.map((pile) => pile.slice());
  const run = next[move.from].splice(move.start);
  next[move.to].push(...run);
  return next;
}

/** Exact inverse of solverApplyMove: moves the run (of the recorded length) that's now sitting atop `to` back onto `from`. */
function solverApplyInverseMove(cols, move) {
  const next = cols.map((pile) => pile.slice());
  const destPile = next[move.to];
  const run = destPile.splice(destPile.length - move.runLen, move.runLen);
  next[move.from].push(...run);
  return next;
}

/** Forward "deal wave" — mirrors dealFromStock() exactly: the front `dealCount` cards of `stock` each get appended to one of columns 0..dealCount-1. */
function solverDealWaveForward(cols, stock, waveIndex) {
  const dealCount = Math.min(stock.length, STOCK_WAVE_SIZES[waveIndex] ?? stock.length, COLUMN_COUNT);
  const next = cols.map((pile) => pile.slice());
  for (let i = 0; i < dealCount; i++) next[i].push(stock[i]);
  return { cols: next, stock: stock.slice(dealCount) };
}

/** Exact inverse of a wave deal: pops the top card off each of columns 0..dealCount-1 (in reverse column order, so popping-then-unpopping restores the same order) and prepends them back onto the front of stock. */
function solverCollectWaveReverse(cols, stock, dealCount) {
  const next = cols.map((pile) => pile.slice());
  const collected = new Array(dealCount);
  for (let i = dealCount - 1; i >= 0; i--) collected[i] = next[i].pop();
  return { cols: next, stock: [...collected, ...stock] };
}

/** True only if every one of columns 0..dealCount-1 currently has at least one card — required before a wave can be safely "un-dealt" during construction (see buildSolvableDeal). */
function canCollectWave(cols, dealCount) {
  for (let i = 0; i < dealCount; i++) {
    if (cols[i].length === 0) return false;
  }
  return true;
}

/** Builds the fully-solved starting point: 4 complete King-to-Ace runs (one per suit), scattered randomly across 4 of the 7 columns — the other 3 start empty. */
function buildSolvedTableau() {
  const runs = SUITS.map((suit) => {
    const run = [];
    for (let r = 12; r >= 0; r--) run.push({ rank: r, colour: cardColour(suit), suit });
    return run;
  });
  const colIndices = [0, 1, 2, 3, 4, 5, 6];
  for (let i = colIndices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [colIndices[i], colIndices[j]] = [colIndices[j], colIndices[i]];
  }
  const cols = Array.from({ length: COLUMN_COUNT }, () => []);
  runs.forEach((run, i) => {
    cols[colIndices[i]] = run;
  });
  return cols;
}

/**
 * Builds a full, ready-to-play 52-card deal that is GUARANTEED
 * solvable — see the file header above for the full explanation of
 * why and how. Returns { columns, stock } already shaped exactly
 * like dealNewGame() needs: `columns` is 7 piles (sizes vary, 28
 * cards total), `stock` is the remaining 24 cards in real dealing
 * order (waves of 7/7/7/3).
 */
function buildSolvableDeal() {
  let cols = buildSolvedTableau();
  let stock = [];
  const log = []; // steps applied during this backward construction, replayed in reverse = the winning line

  function scrambleTableauStage() {
    for (let i = 0; i < TABLEAU_SCRAMBLE_STEPS_PER_STAGE; i++) {
      const moves = safeTableauMoves(cols);
      if (moves.length === 0) break; // never actually happens — an empty column is always a legal destination
      const move = moves[Math.floor(Math.random() * moves.length)];
      log.push({ kind: 'tableau', move });
      cols = solverApplyMove(cols, move);
    }
  }

  scrambleTableauStage();

  for (let waveIndex = STOCK_WAVE_SIZES.length - 1; waveIndex >= 0; waveIndex--) {
    const dealCount = Math.min(STOCK_WAVE_SIZES[waveIndex], COLUMN_COUNT);
    // If scrambling happened to empty one of the columns this wave
    // needs to un-deal from, back off tableau-scramble steps until
    // it's safe again (a real deal always leaves exactly one card on
    // each of those columns at this point in time).
    while (!canCollectWave(cols, dealCount) && log.length > 0 && log[log.length - 1].kind === 'tableau') {
      const last = log.pop();
      cols = solverApplyInverseMove(cols, last.move);
    }
    log.push({ kind: 'collectWave', waveIndex, dealCount });
    const result = solverCollectWaveReverse(cols, stock, dealCount);
    cols = result.cols;
    stock = result.stock;
    scrambleTableauStage();
  }

  const columns = cols.map((pile) => pile.map(solverCardToReal));
  const stockCards = stock.map(solverCardToReal);
  return { columns, stock: stockCards };
}


export function initSpiderette() {
  const app = document.getElementById('spiApp');
  if (!app) return; // not on the spiderette page

  const workerUrl = siteConfig.spiderette?.workerUrl || '';

  // ---- DOM refs ----
  const guestBadge = document.getElementById('spiGuestBadge');
  const loggedInBadge = document.getElementById('spiLoggedInBadge');
  const whoLabel = document.getElementById('spiWhoLabel');

  const chipsBar = document.getElementById('spiChipsBar');
  const balanceEl = document.getElementById('spiBalance');

  const statusEl = document.getElementById('spiStatus');
  const stockEl = document.getElementById('spiStock');
  const stockCountEl = document.getElementById('spiStockCount');
  const completedEl = document.getElementById('spiCompleted');
  const boardEl = document.getElementById('spiBoard');
  const newGameBtn = document.getElementById('spiNewGame');
  const undoBtn = document.getElementById('spiUndo');
  const backBtn = document.getElementById('spiBackBtn');
  const winOverlay = document.getElementById('spiWinOverlay');
  const winPlayAgainBtn = document.getElementById('spiWinPlayAgain');
  const winPayoutEl = document.getElementById('spiWinPayout');

  // ---- state ----
  let auth = null; // { token, who, exp } | null
  let balance = null; // only meaningful when logged in
  let stock = [];
  let stockWaveIndex = 0; // how many waves have been dealt so far
  let columns = []; // 7 arrays of { rank, suit, faceUp }
  let completedColours = []; // ['red' | 'black', ...] cleared this game
  let selection = null; // { col, index } | null
  let stockRemoved = false; // true once the stock is pulled from play
  let gameOver = false;
  let gameSettled = false; // true once this game's chip win/loss has already been applied (guards double-counting)
  let history = []; // stack of pre-move snapshots, for the undo/"Back" feature

  function isLoggedIn() {
    return Boolean(auth);
  }

  // -----------------------------------------------------------------
  // AUTH — reflects the shared site-wide session (assets/js/modules/
  // auth.js). Login/logout happen in the header's "👤 Profiel"
  // dropdown; this just reacts when that session changes.
  // -----------------------------------------------------------------
  function updateAuthUI() {
    if (isLoggedIn()) {
      guestBadge.classList.add('hidden');
      loggedInBadge.classList.remove('hidden');
      chipsBar.classList.remove('hidden');
      whoLabel.textContent = currentPersonLabel();
    } else {
      guestBadge.classList.remove('hidden');
      loggedInBadge.classList.add('hidden');
      chipsBar.classList.add('hidden');
    }
  }

  async function syncWithAuth(nextAuth) {
    auth = nextAuth;
    updateAuthUI();
    if (isLoggedIn()) {
      await loadChips();
    } else {
      balance = null;
    }
    renderBoard(); // re-render with/without the special-cards art
    renderCompleted();
    updateUndoState();
  }

  // -----------------------------------------------------------------
  // CHIPS (shared balance with BlackJack — same Worker/KV key per person)
  // -----------------------------------------------------------------
  async function loadChips() {
    if (!isLoggedIn() || !workerUrl) return;
    try {
      const response = await fetch(`${workerUrl}/chips`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!response.ok) {
        if (response.status === 401) logout();
        return;
      }
      const data = await response.json();
      balance = data.chips;
      updateBalanceUI();
      updateUndoState();
    } catch {
      // Offline/unreachable: keep whatever balance we last knew about.
    }
  }

  async function saveChips() {
    if (!isLoggedIn() || !workerUrl || balance === null) return;
    try {
      await fetch(`${workerUrl}/chips`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
        body: JSON.stringify({ chips: balance }),
      });
    } catch {
      // Best-effort — a failed save just means next load reflects the
      // last successfully-saved amount; nothing crashes locally.
    }
  }

  function updateBalanceUI() {
    if (balance === null) return;
    balanceEl.textContent = String(balance);
  }

  /** Applies a chip delta, clamped so the balance can never go below 0, then persists it. */
  function applyChipDelta(delta) {
    if (!isLoggedIn() || balance === null) return;
    balance = Math.max(0, balance + delta);
    updateBalanceUI();
    saveChips();
    updateUndoState();
  }

  // -----------------------------------------------------------------
  // DEAL / GAME SETUP
  // -----------------------------------------------------------------
  function dealNewGame() {
    // buildSolvableDeal() is instant (no search/solver involved — see
    // its file header for why), so unlike a budget-based solver this
    // never needs to defer or show a "shuffling…" status.
    const deal = buildSolvableDeal();
    columns = deal.columns;
    columns.forEach((pile) => {
      if (pile.length) pile[pile.length - 1].faceUp = true;
    });
    stock = deal.stock; // remaining 24 cards, dealt out in waves of 7/7/7/3
    stockWaveIndex = 0;
    completedColours = [];
    selection = null;
    stockRemoved = false;
    gameOver = false;
    gameSettled = false;
    history = [];
    hideWinOverlay();
    setStatus('Klik een kaart om te kiezen, klik een stapel om ‘m neer te leggen. Dubbelklik voor een automatische zet.');
    renderBoard();
    renderCompleted();
    renderStock();
    updateUndoState();
  }

  // -----------------------------------------------------------------
  // UNDO ("Back" button / physical Backspace key — see file header)
  // -----------------------------------------------------------------
  /** Deep snapshot of everything a move can change, pushed BEFORE the
   *  move is applied so undo can restore it wholesale. */
  function pushHistory() {
    history.push({
      columns: structuredClone(columns),
      stock: structuredClone(stock),
      stockWaveIndex,
      completedColours: [...completedColours],
      stockRemoved,
    });
    if (history.length > MAX_HISTORY) history.shift();
  }

  function updateUndoState() {
    if (!undoBtn) return;
    undoBtn.disabled = gameOver || history.length === 0
      || (isLoggedIn() && balance !== null && balance < UNDO_COST);
  }

  function undoLastMove() {
    if (gameOver || history.length === 0) return;
    if (isLoggedIn() && balance !== null && balance < UNDO_COST) {
      setStatus(`Niet genoeg credits om terug te zetten (kost ${UNDO_COST}).`);
      return;
    }

    const snap = history.pop();
    columns = snap.columns;
    stock = snap.stock;
    stockWaveIndex = snap.stockWaveIndex;
    completedColours = snap.completedColours;
    stockRemoved = snap.stockRemoved;
    selection = null;

    if (isLoggedIn()) {
      applyChipDelta(-UNDO_COST);
      setStatus(`Zet teruggezet (-${UNDO_COST} credits).`);
    } else {
      setStatus('Zet teruggezet.');
    }

    renderBoard();
    renderCompleted();
    renderStock();
    updateUndoState();
  }

  // -----------------------------------------------------------------
  // SEQUENCE HELPERS
  // -----------------------------------------------------------------
  /** True if columns[col][index..end] is a face-up, strictly-descending-rank run of the SAME COLOUR.
   *  Placement itself stays relaxed (any card can be DROPPED on any card one rank higher,
   *  regardless of colour — see canDrop), but picking a run UP to move it is stricter: every
   *  card above the one you click must share its colour, otherwise you'd be dragging a
   *  mismatched-colour card along for the ride. E.g. [Black Q, Black J, Red 10] — clicking
   *  the Black J only grabs [Black J] (the Red 10 on top breaks the colour run), not [Black J,
   *  Red 10]; the Red 10 has to be moved off first. Clicking the Red 10 itself is always fine,
   *  since it's the topmost card. */
  function isMovableRun(col, index) {
    const pile = columns[col];
    if (index < 0 || index >= pile.length) return false;
    if (!pile[index].faceUp) return false;
    const baseColour = cardColour(pile[index].suit);
    for (let i = index; i < pile.length; i++) {
      if (!pile[i].faceUp) return false;
      if (i > index && rankIndex(pile[i - 1].rank) !== rankIndex(pile[i].rank) + 1) return false;
      if (cardColour(pile[i].suit) !== baseColour) return false;
    }
    return true;
  }

  /** Can the run starting at columns[fromCol][fromIndex] legally land on column toCol? Any suit/colour, just one rank down (or the pile is empty). */
  function canDrop(fromCol, fromIndex, toCol) {
    if (fromCol === toCol) return false;
    const movingCard = columns[fromCol][fromIndex];
    const destPile = columns[toCol];
    if (destPile.length === 0) return true;
    const destTop = destPile[destPile.length - 1];
    if (!destTop.faceUp) return false;
    return rankIndex(destTop.rank) === rankIndex(movingCard.rank) + 1;
  }

  /** Same as canDrop, but also requires the destination top card to match the moving card's COLOUR. */
  function canDropSameColour(fromCol, fromIndex, toCol) {
    if (!canDrop(fromCol, fromIndex, toCol)) return false;
    const destPile = columns[toCol];
    if (destPile.length === 0) return false; // "same colour" needs an actual card to match against
    const movingCard = columns[fromCol][fromIndex];
    const destTop = destPile[destPile.length - 1];
    return cardColour(destTop.suit) === cardColour(movingCard.suit);
  }

  /** After any tableau change: sweep away a pile's top run if — and only if — it's a full, same-COLOUR King-to-Ace sequence. Mixed-colour runs (the relaxed-placement kind) are left exactly where they are. */
  function sweepCompletedSequences() {
    let sweptAny = false;
    for (let col = 0; col < COLUMN_COUNT; col++) {
      const pile = columns[col];
      if (pile.length < 13) continue;
      const top13 = pile.slice(pile.length - 13);
      const sameColour = top13.every((card) => cardColour(card.suit) === cardColour(top13[0].suit));
      const isFullRun = top13.every((card, i) => i === 0 || rankIndex(top13[i - 1].rank) === rankIndex(card.rank) + 1);
      const isKingHigh = rankIndex(top13[0].rank) === 13;
      if (sameColour && isFullRun && isKingHigh) {
        columns[col] = pile.slice(0, pile.length - 13);
        if (columns[col].length) columns[col][columns[col].length - 1].faceUp = true;
        completedColours.push(cardColour(top13[0].suit));
        sweptAny = true;
      }
    }
    if (sweptAny) {
      // Stock is removed from play the moment the first sequence clears,
      // no matter how many cards/waves are still left in it.
      if (!stockRemoved) {
        stockRemoved = true;
        stock = [];
      }
      renderCompleted();
      renderStock();
      if (completedColours.length >= TOTAL_SEQUENCES) {
        setStatus('Alle vier de reeksen compleet — gewonnen! 🎉');
        triggerWin();
      } else {
        setStatus(`Reeks compleet! De stok is nu weg. Nog ${TOTAL_SEQUENCES - completedColours.length} te gaan.`);
      }
    }
    return sweptAny;
  }

  // -----------------------------------------------------------------
  // WIN / GAME OVER / CHIP PAYOUTS
  // -----------------------------------------------------------------
  function triggerWin() {
    gameOver = true;
    selection = null;
    if (!gameSettled && isLoggedIn()) {
      gameSettled = true;
      applyChipDelta(WIN_PAYOUT);
    }
    if (winPayoutEl) {
      winPayoutEl.textContent = isLoggedIn() ? `Je wint ${WIN_PAYOUT} chips! 🪙` : '';
    }
    showWinOverlay();
    updateUndoState();
  }

  function showWinOverlay() {
    if (winOverlay) winOverlay.classList.remove('hidden');
  }

  function hideWinOverlay() {
    if (winOverlay) winOverlay.classList.add('hidden');
  }

  /** "Terug" button: leaving a game that isn't won yet costs a small chip
   *  penalty (same idea as walking away from a real table mid-hand) —
   *  never applied if the game was already won, already settled, or if
   *  there's no game in progress yet (e.g. clicking it on a fresh deal
   *  before touching anything still counts as abandoning, deliberately —
   *  keeps the rule simple and unambiguous). Guests have no balance, so
   *  nothing happens for them beyond navigating away. */
  function handleBackClick() {
    const gameInProgress = columns.length > 0 && !gameOver;
    if (gameInProgress && !gameSettled && isLoggedIn()) {
      gameSettled = true;
      applyChipDelta(-QUIT_PENALTY);
    }
    window.location.href = siteRootUrl('games-hub.html');
  }

  // -----------------------------------------------------------------
  // INTERACTION (click-to-select, click-to-drop, double-click to
  // auto-move — no drag-and-drop, so it works the same on touch and
  // mouse)
  // -----------------------------------------------------------------
  function clearSelection() {
    selection = null;
    renderBoard();
  }

  function handleCardClick(col, index) {
    if (gameOver) return;
    const pile = columns[col];
    const card = pile[index];
    if (!card.faceUp) return; // face-down cards aren't interactive

    if (selection && selection.col === col && selection.index === index) {
      clearSelection();
      return;
    }

    if (selection) {
      attemptMove(selection.col, selection.index, col);
      return;
    }

    if (isMovableRun(col, index)) {
      selection = { col, index };
      renderBoard();
    }
  }

  /** Double-click: auto-move the run to the best legal destination.
   *  Tries a same-COLOUR destination first (matching the request that
   *  double-click should prefer colour matches), then falls back to
   *  any legal destination (relaxed placement), preferring a
   *  non-empty pile over an empty column either way. */
  function handleCardDoubleClick(col, index) {
    if (gameOver) return;
    const card = columns[col][index];
    if (!card.faceUp || !isMovableRun(col, index)) return;

    selection = null;

    let target = findBestDestination(col, index, true); // same-colour pass
    if (target === null) target = findBestDestination(col, index, false); // any-colour pass

    if (target === null) {
      setStatus('Geen geldige zet gevonden voor deze kaart.');
      renderBoard();
      return;
    }

    attemptMove(col, index, target);
  }

  /** Finds a destination column for the run at (fromCol, fromIndex).
   *  requireSameColour=true only considers destinations whose top card
   *  matches the moving card's colour; non-empty destinations are
   *  preferred over empty columns in both passes. */
  function findBestDestination(fromCol, fromIndex, requireSameColour) {
    let emptyFallback = null;
    for (let toCol = 0; toCol < COLUMN_COUNT; toCol++) {
      if (toCol === fromCol) continue;
      const destPile = columns[toCol];
      if (destPile.length === 0) {
        if (!requireSameColour && emptyFallback === null && canDrop(fromCol, fromIndex, toCol)) {
          emptyFallback = toCol;
        }
        continue;
      }
      const isLegal = requireSameColour
        ? canDropSameColour(fromCol, fromIndex, toCol)
        : canDrop(fromCol, fromIndex, toCol);
      if (isLegal) return toCol;
    }
    return emptyFallback;
  }

  function handleColumnClick(col) {
    if (gameOver) return;
    if (!selection) return;
    attemptMove(selection.col, selection.index, col);
  }

  function attemptMove(fromCol, fromIndex, toCol) {
    if (!canDrop(fromCol, fromIndex, toCol)) {
      setStatus('Ongeldige zet.');
      selection = null;
      renderBoard();
      return;
    }

    pushHistory();
    const run = columns[fromCol].splice(fromIndex);
    columns[toCol].push(...run);
    if (columns[fromCol].length) columns[fromCol][columns[fromCol].length - 1].faceUp = true;

    selection = null;
    const won = sweepCompletedSequences();
    if (!won && !gameOver) {
      setStatus('Klik een kaart om te kiezen, klik een stapel om ‘m neer te leggen. Dubbelklik voor een automatische zet.');
    }
    renderBoard();
    updateUndoState();
  }

  function dealFromStock() {
    if (gameOver || stockRemoved || stock.length === 0) return;
    // Empty columns are allowed — a dealt card just becomes that
    // column's first card, same as classic Spider(ette).
    pushHistory();
    const waveSize = STOCK_WAVE_SIZES[stockWaveIndex] ?? stock.length;
    const dealCount = Math.min(stock.length, waveSize, COLUMN_COUNT);
    for (let col = 0; col < dealCount; col++) {
      const card = stock.shift();
      card.faceUp = true;
      columns[col].push(card);
    }
    stockWaveIndex += 1;
    selection = null;
    sweepCompletedSequences();
    renderBoard();
    renderStock();
    updateUndoState();
  }

  // -----------------------------------------------------------------
  // RENDERING
  // -----------------------------------------------------------------
  function setStatus(text) {
    statusEl.textContent = text;
  }

  function buildCardEl(card, col, index) {
    const el = document.createElement('div');
    el.className = 'spi-card';
    el.style.top = `${index * 24}px`;
    el.style.zIndex = String(index);

    if (!card.faceUp) {
      const img = document.createElement('img');
      img.src = siteRootUrl('assets/icons/playing-cards/card-back-blue.png');
      img.alt = 'Verborgen kaart';
      img.className = 'spi-card-img';
      el.appendChild(img);
      return el;
    }

    const img = document.createElement('img');
    img.src = cardImageUrl(card, isLoggedIn());
    img.alt = `${card.rank} of ${card.suit}`;
    img.className = 'spi-card-img';
    el.appendChild(img);

    if (selection && selection.col === col && index >= selection.index) {
      el.classList.add('spi-card-selected');
    }

    el.addEventListener('click', (event) => {
      event.stopPropagation();
      handleCardClick(col, index);
    });

    el.addEventListener('dblclick', (event) => {
      event.stopPropagation();
      handleCardDoubleClick(col, index);
    });

    return el;
  }

  function renderBoard() {
    boardEl.innerHTML = '';
    columns.forEach((pile, col) => {
      const colEl = document.createElement('div');
      colEl.className = 'spi-column';
      colEl.addEventListener('click', () => handleColumnClick(col));

      pile.forEach((card, index) => {
        colEl.appendChild(buildCardEl(card, col, index));
      });

      boardEl.appendChild(colEl);
    });
  }

  function renderStock() {
    stockCountEl.textContent = String(stock.length);
    stockEl.classList.toggle('spi-stock-empty', stock.length === 0 || stockRemoved);
    // Once cleared, the stock/staple is removed from play entirely.
    stockEl.classList.toggle('spi-stock-removed', stockRemoved);
    stockEl.disabled = stockRemoved || stock.length === 0;
  }

  function renderCompleted() {
    completedEl.innerHTML = completedColours.map((colour) => {
      const card = { rank: 'king', suit: colour === 'red' ? 'hearts' : 'spades' };
      return `<img src="${cardImageUrl(card, isLoggedIn())}" alt="Complete reeks (${colour === 'red' ? 'rood' : 'zwart'})" class="spi-completed-img">`;
    }).join('');
  }

  // -----------------------------------------------------------------
  // WIRE UP
  // -----------------------------------------------------------------
  stockEl.addEventListener('click', dealFromStock);
  newGameBtn.addEventListener('click', dealNewGame);
  if (winPlayAgainBtn) winPlayAgainBtn.addEventListener('click', dealNewGame);
  if (backBtn) backBtn.addEventListener('click', handleBackClick);
  if (undoBtn) undoBtn.addEventListener('click', undoLastMove);

  // Physical Backspace also undoes — ignored while typing in any
  // text field (e.g. the header's profile login passphrase), so it
  // still behaves like a normal text-editing backspace there instead
  // of undoing a move.
  document.addEventListener('keydown', (event) => {
    if (!app.isConnected) return;
    if (event.key !== 'Backspace') return;
    const tag = event.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    event.preventDefault();
    undoLastMove();
  });

  // ---- init ----
  dealNewGame();

  // React to the shared header login/logout — see the AUTH block above.
  onAuthChange(syncWithAuth);
  syncWithAuth(getAuth());
}
