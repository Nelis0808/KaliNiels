#!/usr/bin/env node
// =================================================================
// GROW THE SPIDERETTE SEED POOL
// -----------------------------------------------------------------
// The game (assets/js/modules/spiderette.js) ships with a bundled
// list of pre-verified, guaranteed-solvable deal seeds at
// assets/data/spiderette-seeds.json, so a new game loads instantly
// with zero solving in the browser. Each session shuffles that list
// and works through it without repeats before it needs to fall back
// to solving a fresh seed live (see generateSolvableDeal() in
// spiderette-solver.js) — so a bigger pool means more distinct games
// before that happens.
//
// This script grows that pool offline, where there's no rush: it
// tries random seeds, keeps every one the solver proves solvable
// (see spiderette-solver.js's solve() for how — same algorithm the
// browser uses live, just with a roomier time budget here since
// nothing is waiting on it), independently REPLAYS each accepted
// seed's solution move-by-move to confirm it's genuinely legal and
// really does clear the board (catches any solver bug, not just
// heuristic-scoring artifacts), and appends the new seeds to the
// existing JSON file (never removing what's already there).
//
// USAGE:
//   node tools/generate-spiderette-seeds.mjs [count] [secondsBudget]
//   npm run generate-spiderette-seeds -- 300 120
//
//   count           how many NEW solvable seeds to add (default 200)
//   secondsBudget   hard time cap for the whole run (default 180)
// =================================================================

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  dealFromSeed,
  solve,
  legalMovesDeduped,
  applyMove,
  sweepAll,
  dealWave,
} from '../assets/js/modules/spiderette-solver.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEEDS_PATH = join(__dirname, '..', 'assets', 'data', 'spiderette-seeds.json');

const targetNewCount = Number(process.argv[2]) || 200;
const secondsBudget = Number(process.argv[3]) || 180;

function movesEqual(a, b) {
  return a.from === b.from && a.start === b.start && a.to === b.to && a.runLen === b.runLen;
}

/** Independently replays a claimed solution move-by-move against the real move-legality/sweep rules — never trust the solver's own "solved" flag without this. */
function verifySolution(seed, path) {
  let { cols, stock } = dealFromSeed(seed);
  let waveIndex = 0;
  let cleared = 0;
  for (const step of path) {
    if (step.type === 'move') {
      const legal = legalMovesDeduped(cols);
      if (!legal.some((m) => movesEqual(m, step.move))) return false;
      const swept = sweepAll(applyMove(cols, step.move));
      cols = swept.cols;
      cleared += swept.cleared;
    } else {
      if (stock.length === 0) return false;
      const dealt = dealWave(cols, stock, waveIndex);
      const swept = sweepAll(dealt.cols);
      cols = swept.cols;
      stock = dealt.stock;
      waveIndex += 1;
      cleared += swept.cleared;
    }
  }
  return cleared === 4 && cols.every((pile) => pile.length === 0) && stock.length === 0;
}

const existing = existsSync(SEEDS_PATH) ? JSON.parse(readFileSync(SEEDS_PATH, 'utf8')) : [];
const existingSet = new Set(existing);
const found = [];

// Start seed search well above any existing seeds so re-runs don't waste time re-trying known seeds.
let seed = (existing.length ? Math.max(...existing) : 0) + Math.floor(Math.random() * 1000) + 1;
let tried = 0;
const startTime = Date.now();
const deadline = startTime + secondsBudget * 1000;

while (found.length < targetNewCount && Date.now() < deadline) {
  seed += 1;
  if (existingSet.has(seed)) continue;
  tried += 1;

  const { cols, stock } = dealFromSeed(seed);
  const result = solve(cols, stock, { nodeBudget: 150000, timeBudgetMs: 1200 });
  if (!result.solved) continue;
  if (!verifySolution(seed, result.path)) {
    console.warn(`seed ${seed}: solver claimed solved but replay verification failed — skipping (please report this)`);
    continue;
  }

  found.push(seed);
  existingSet.add(seed);
  if (found.length % 10 === 0) {
    console.log(`  ${found.length}/${targetNewCount} new seeds found (${tried} tried, ${((Date.now() - startTime) / 1000).toFixed(0)}s elapsed)`);
  }
}

const combined = [...existing, ...found];
writeFileSync(SEEDS_PATH, JSON.stringify(combined));

console.log(`\nDone: added ${found.length} new verified-solvable seeds (tried ${tried} candidates).`);
console.log(`Pool size: ${existing.length} -> ${combined.length}. Written to ${SEEDS_PATH}`);
if (found.length < targetNewCount) {
  console.log(`Stopped early — hit the ${secondsBudget}s time budget. Re-run for more.`);
}
