// =================================================================
// DECISION TOURNAMENT (tournament.html)
// -----------------------------------------------------------------
// Single-elimination "bracket": take a list of options, shuffle it,
// and repeatedly ask the user to pick a winner between two options
// until only one remains. Works with any number of options — an
// odd one out at any round automatically gets a "bye" (advances
// without a match), so you don't need a power-of-two count.
//
// Reuses the same JSON idea files as date-picker.js as optional
// quick-start presets, to show how two features can share data.
//
// EXTENDING: want a different kind of "which one wins" tool (e.g.
// best-of-3 instead of single elimination)? Copy this module as a
// starting point — the shuffle/pair/advance logic below is the
// part you'd change; the setup/render/winner screens can mostly
// stay the same.
// =================================================================

import { qs, escapeHtml } from './utils.js';

const PRESET_FILES = {
  indoor: new URL('../../data/date-ideas-indoor.json', import.meta.url),
  outdoor: new URL('../../data/date-ideas-outdoor.json', import.meta.url),
};

/** Fisher–Yates shuffle — unbiased, unlike `array.sort(() => Math.random() - 0.5)`. */
function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

class Tournament {
  constructor(options) {
    this.totalContestants = options.length;
    this.currentRound = shuffle(options);
    this.nextRound = [];
    this.roundNumber = 1;
    this.history = []; // { round, a, b, winner } | { round, bye }
    this.currentMatch = null; // { a, b } while a match is awaiting a click
    this.winner = null;
  }

  /** Advances internal state until either a match is ready or a winner is found. */
  advance() {
    if (this.winner) return;

    if (this.currentRound.length === 0) {
      if (this.nextRound.length <= 1) {
        this.winner = this.nextRound[0] ?? null;
        return;
      }
      this.currentRound = this.nextRound;
      this.nextRound = [];
      this.roundNumber += 1;
    }

    if (this.currentRound.length === 1) {
      const byeItem = this.currentRound.pop();
      this.nextRound.push(byeItem);
      this.history.push({ round: this.roundNumber, bye: byeItem });
      this.advance(); // keep going — a bye isn't something the user acts on
      return;
    }

    const a = this.currentRound.pop();
    const b = this.currentRound.pop();
    this.currentMatch = { a, b };
  }

  /** Records the user's pick and moves on to the next match/round. */
  choose(winner) {
    this.nextRound.push(winner);
    this.history.push({ round: this.roundNumber, a: this.currentMatch.a, b: this.currentMatch.b, winner });
    this.currentMatch = null;
    this.advance();
  }

  /** How many options remain across the current + next round, for the progress readout. */
  remainingCount() {
    return this.currentRound.length + this.nextRound.length + (this.currentMatch ? 2 : 0);
  }
}

export function initTournament() {
  const root = document.getElementById('tournamentApp');
  if (!root) return; // not on this page

  const setupView = qs('#tournamentSetup', root);
  const matchView = qs('#tournamentMatch', root);
  const winnerView = qs('#tournamentWinner', root);
  const optionsInput = qs('#tournamentOptions', root);
  const startBtn = qs('#tournamentStart', root);
  const errorEl = qs('#tournamentError', root);
  const progressEl = qs('#tournamentProgress', root);
  const matchButtons = [qs('#matchOptionA', root), qs('#matchOptionB', root)];
  const restartBtn = qs('#tournamentRestart', root);
  const winnerNameEl = qs('#tournamentWinnerName', root);
  const historyList = qs('#tournamentHistory', root);

  let tournament = null;

  function showView(view) {
    [setupView, matchView, winnerView].forEach((v) => v.classList.toggle('hidden', v !== view));
  }

  function parseOptions(rawText) {
    return rawText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  async function loadPreset(category) {
    try {
      const response = await fetch(PRESET_FILES[category]);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const ideas = await response.json();
      optionsInput.value = ideas.join('\n');
      optionsInput.focus();
    } catch (error) {
      console.error(error);
      errorEl.textContent = 'Kon de voorbeeldlijst niet laden.';
    }
  }

  function renderMatch() {
    tournament.advance();

    if (tournament.winner) {
      renderWinner();
      return;
    }

    const { a, b } = tournament.currentMatch;
    matchButtons[0].textContent = a;
    matchButtons[1].textContent = b;
    progressEl.textContent = `Ronde ${tournament.roundNumber} · nog ${tournament.remainingCount()} opties over`;
    showView(matchView);
  }

  function renderWinner() {
    winnerNameEl.textContent = tournament.winner;
    historyList.innerHTML = tournament.history
      .map((entry) => {
        if (entry.bye) {
          return `<li>Ronde ${entry.round}: <strong>${escapeHtml(entry.bye)}</strong> kreeg een vrije doorgang</li>`;
        }
        return `<li>Ronde ${entry.round}: <strong>${escapeHtml(entry.winner)}</strong> versloeg ${escapeHtml(
          entry.winner === entry.a ? entry.b : entry.a
        )}</li>`;
      })
      .join('');
    showView(winnerView);
  }

  startBtn.addEventListener('click', () => {
    const options = parseOptions(optionsInput.value);
    errorEl.textContent = '';

    if (options.length < 2) {
      errorEl.textContent = 'Vul minstens 2 opties in (één per regel).';
      return;
    }

    tournament = new Tournament(options);
    renderMatch();
  });

  matchButtons.forEach((button) => {
    button.addEventListener('click', () => {
      tournament.choose(button.textContent);
      renderMatch();
    });
  });

  restartBtn.addEventListener('click', () => {
    tournament = null;
    showView(setupView);
  });

  qs('#presetIndoor', root)?.addEventListener('click', () => loadPreset('indoor'));
  qs('#presetOutdoor', root)?.addEventListener('click', () => loadPreset('outdoor'));
}
