// =================================================================
// SPIDERETTE — DEAL GENERATION + SOLVER (pure game logic, no DOM)
// -----------------------------------------------------------------
// WHY THIS FILE EXISTS
// Deals used to be built "backwards" from an already-solved board
// (start with 4 complete King-to-Ace runs, then undo random legal
// moves to scramble them). That guaranteed solvability perfectly,
// but it had a hidden cost: because every legal move in this
// variant places a card on a destination that is EXACTLY one rank
// higher (see canDrop()'s rule in spiderette.js — any suit, just
// rank+1), any tableau reachable by chaining legal moves from a
// solved board is unavoidably rank-sorted, card by card, top to
// bottom, in every column. So the very first deal was already
// "solved-looking": flip a card, and the one underneath was
// (almost always) exactly one rank higher — trivial to read, no
// real puzzle. This was measured directly: ~100% of vertically
// adjacent card pairs in the old generator's deals satisfied
// "one rank higher", versus ~7.7% for a genuinely random shuffle
// (1-in-13 chance).
//
// THE FIX — Method 1 from the project notes: shuffle for real, then
// verify solvability with an actual solver, and only keep the deal
// if the solver proves it clearable. Reject and reshuffle otherwise.
// This is the standard approach used by real solitaire generators
// (e.g. how Microsoft's Spider/FreeCell verify their daily deals):
//
//   repeat
//     seed = random()
//     game = dealFromSeed(seed)
//   until solve(game).solved
//   return seed
//
// SOLVER: this is a randomized best-first DFS with backtracking,
// bounded by a node budget and a time budget (see solve() below). A
// few implementation choices that mattered a lot for how often it
// actually finds a solution in reasonable time:
//   - Moves that drop a run onto an EMPTY column are deduplicated:
//     if there are 3 empty columns, only one destination move is
//     generated (not 3 structurally-identical branches) — this cut
//     the effective branching factor a lot.
//   - Candidate moves are scored by a cheap heuristic (reward: newly
//     completed sequences, long same-colour runs sitting on top of a
//     pile, matching-suit adjacency, empty columns) and only the
//     top few candidates are explored at each depth, deepest-first —
//     this is what makes it fast enough to run in a browser at all,
//     at the cost of not being a *complete* solver (a "no" from
//     solve() means "didn't find one in budget", not "provably
//     unsolvable" — which is fine here, since the caller's response
//     to "no" is just "try a different seed").
// Measured: ~45-50% of random seeds solve within a 150,000-node /
// ~1 second budget. That's good enough to solve live in a browser
// (a handful of attempts, well under a second on average) — see
// generateSolvableDeal() below — and is what tools/generate-
// spiderette-seeds.js used offline to build the bundled seed pool
// at assets/data/spiderette-seeds.json (instant, zero solving, for
// the common case).
// =================================================================

export const COLUMN_COUNT = 7;
export const STOCK_WAVE_SIZES = [7, 7, 7, 3];
export const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
export const RED_SUITS = new Set(['hearts', 'diamonds']);
export const CLASSIC_COLUMN_SIZES = [1, 2, 3, 4, 5, 6, 7];
export const RANKS = ['ace', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king'];

export function cardColour(suit) {
  return RED_SUITS.has(suit) ? 'red' : 'black';
}

/** Deterministic PRNG (mulberry32) — same seed always produces the same shuffle, which is what makes a "seed" a meaningful, shareable, cacheable thing. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A full 52-card deck in "solver card" shape: { rank: 0-12 (0=ace .. 12=king), colour, suit }. */
function buildDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (let r = 0; r <= 12; r++) deck.push({ rank: r, colour: cardColour(suit), suit });
  }
  return deck;
}

function shuffledDeckFromSeed(seed) {
  const deck = buildDeck();
  const rand = mulberry32(seed);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/** Deals a seed into the classic {1,2,3,4,5,6,7}-column tableau + 24-card stock, in "solver card" shape (no faceUp — that's added by the caller once a deal is accepted, see spiderette.js's solverCardsToReal()). */
export function dealFromSeed(seed) {
  const deck = shuffledDeckFromSeed(seed);
  const cols = [];
  let idx = 0;
  for (let c = 0; c < COLUMN_COUNT; c++) {
    const size = CLASSIC_COLUMN_SIZES[c];
    cols.push(deck.slice(idx, idx + size));
    idx += size;
  }
  return { cols, stock: deck.slice(idx) };
}

// -----------------------------------------------------------------
// Move generation / application — mirrors the real game's canDrop()
// (any suit, exactly one rank higher, or an empty pile) and
// isMovableRun() (same-colour strictly-descending run) exactly.
// -----------------------------------------------------------------
export function legalMovesDeduped(cols) {
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
      let emptyUsed = false;
      for (let to = 0; to < cols.length; to++) {
        if (to === from) continue;
        const destPile = cols[to];
        if (destPile.length === 0) {
          if (emptyUsed || start === 0) continue; // dedupe identical empty destinations; moving a whole pile to an empty pile is a no-op
          emptyUsed = true;
          moves.push({ from, start, to, runLen });
        } else if (destPile[destPile.length - 1].rank === movingRank + 1) {
          moves.push({ from, start, to, runLen });
        }
      }
    }
  }
  return moves;
}

export function applyMove(cols, move) {
  const next = cols.map((pile) => pile.slice());
  const run = next[move.from].splice(move.start);
  next[move.to].push(...run);
  return next;
}

export function isCompleteRun(pile) {
  if (pile.length !== 13 || pile[0].rank !== 12) return false;
  const colour0 = pile[0].colour;
  for (let i = 1; i < 13; i++) {
    if (pile[i].colour !== colour0) return false;
    if (pile[i - 1].rank !== pile[i].rank + 1) return false;
  }
  return true;
}

/** Sweeps every pile that's topped by a complete King-to-Ace run. Returns the new columns and how many sequences were cleared this call. */
export function sweepAll(cols) {
  let cleared = 0;
  const out = new Array(cols.length);
  for (let i = 0; i < cols.length; i++) {
    let pile = cols[i];
    while (pile.length >= 13 && isCompleteRun(pile.slice(pile.length - 13))) {
      pile = pile.slice(0, pile.length - 13);
      cleared++;
    }
    out[i] = pile;
  }
  return { cols: out, cleared };
}

export function dealWave(cols, stock, waveIndex) {
  const dealCount = Math.min(stock.length, STOCK_WAVE_SIZES[waveIndex] ?? stock.length, COLUMN_COUNT);
  const next = cols.map((pile) => pile.slice());
  for (let i = 0; i < dealCount; i++) next[i].push(stock[i]);
  return { cols: next, stock: stock.slice(dealCount) };
}

function suitAdjacencyScore(cols) {
  let same = 0;
  let total = 0;
  for (const pile of cols) {
    for (let i = 1; i < pile.length; i++) {
      total++;
      if (pile[i - 1].suit === pile[i].suit) same++;
    }
  }
  return total ? same / total : 0;
}

/** Heuristic "how promising is this state" score used to order candidate moves — see the file header for what each term rewards. Higher is better. */
function scoreCols(cols, clearedTotal) {
  let runBonus = 0;
  let emptyCols = 0;
  for (const pile of cols) {
    if (!pile.length) {
      emptyCols++;
      continue;
    }
    let runLen = 1;
    for (let i = pile.length - 1; i > 0; i--) {
      if (pile[i - 1].colour === pile[i].colour && pile[i - 1].rank === pile[i].rank + 1) runLen++;
      else break;
    }
    runBonus += runLen * runLen;
  }
  return clearedTotal * 50000 + runBonus * 4 + suitAdjacencyScore(cols) * 100 + emptyCols * 25;
}

function stateKey(cols, stockLen, waveIndex) {
  let key = '';
  for (const pile of cols) {
    for (const c of pile) key += c.rank + c.colour[0];
    key += '|';
  }
  return key + stockLen + '#' + waveIndex;
}

/**
 * Attempts to find a full clearing sequence for a dealt position.
 * Returns { solved, path, nodes, timeMs }. `path` is an array of
 * { type: 'move', move } / { type: 'deal' } steps, in order, that
 * clears the board — the exact winning line, if one was found.
 * A `solved: false` result means "none found within budget", not a
 * proof of unsolvability — see the file header.
 */
export function solve(initialCols, initialStock, opts = {}) {
  const nodeBudget = opts.nodeBudget || 150000;
  const timeBudgetMs = opts.timeBudgetMs || 900;
  const start = Date.now();
  let nodes = 0;
  const visited = new Set();
  let outOfBudget = false;

  function dfs(cols, stock, waveIndex, cleared, depth, path) {
    nodes++;
    if (nodes > nodeBudget || (nodes % 2048 === 0 && Date.now() - start > timeBudgetMs)) {
      outOfBudget = true;
      return null;
    }
    if (cleared >= 4) return path;

    const key = stateKey(cols, stock.length, waveIndex);
    if (visited.has(key)) return null;
    visited.add(key);

    const moves = legalMovesDeduped(cols);
    const candidates = [];
    for (const move of moves) {
      const nextCols = applyMove(cols, move);
      const swept = sweepAll(nextCols);
      candidates.push({
        kind: 'move',
        move,
        cols: swept.cols,
        clearedDelta: swept.cleared,
        score: scoreCols(swept.cols, cleared + swept.cleared),
      });
    }
    if (stock.length > 0) {
      const dealt = dealWave(cols, stock, waveIndex);
      const swept = sweepAll(dealt.cols);
      candidates.push({
        kind: 'deal',
        stock: dealt.stock,
        cols: swept.cols,
        clearedDelta: swept.cleared,
        score: scoreCols(swept.cols, cleared + swept.cleared) - 8, // mild preference for tableau progress before burning a wave
      });
    }
    if (!candidates.length) return null;

    candidates.sort((a, b) => b.score - a.score);
    const breadth = Math.min(candidates.length, depth < 10 ? 5 : depth < 40 ? 3 : 2);

    for (let i = 0; i < breadth; i++) {
      if (outOfBudget) return null;
      const c = candidates[i];
      const nextWaveIndex = c.kind === 'deal' ? waveIndex + 1 : waveIndex;
      const nextStock = c.kind === 'deal' ? c.stock : stock;
      const result = dfs(
        c.cols,
        nextStock,
        nextWaveIndex,
        cleared + c.clearedDelta,
        depth + 1,
        path.concat([c.kind === 'deal' ? { type: 'deal' } : { type: 'move', move: c.move }])
      );
      if (result) return result;
    }
    return null;
  }

  const path = dfs(initialCols, initialStock, 0, 0, 0, []);
  return { solved: !!path, path, nodes, timeMs: Date.now() - start };
}

/**
 * Tries random seeds (via `randomSeed()`, injected so the browser and
 * a Node CLI can each supply their own randomness source) until one
 * verifiably solves, or `maxAttempts` is exhausted. This is the live,
 * in-browser fallback for when the bundled seed pool
 * (assets/data/spiderette-seeds.json) is unavailable or exhausted —
 * see spiderette.js's dealNewGame() for how the two are combined.
 * Typically finds a solvable seed in 1-3 attempts (measured ~45-50%
 * solve rate per attempt at the default budget).
 */
export function generateSolvableDeal(randomSeed, opts = {}) {
  const maxAttempts = opts.maxAttempts || 12;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const seed = randomSeed();
    const { cols, stock } = dealFromSeed(seed);
    const result = solve(cols, stock, opts);
    if (result.solved) {
      return { seed, cols, stock };
    }
  }
  return null;
}
