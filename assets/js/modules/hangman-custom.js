// =================================================================
// GALGJE MET EIGEN WOORD (games/hangman-custom.html)
// -----------------------------------------------------------------
// Two-player, same-device variant of hangman.js: instead of picking
// a random word from word-list.json, Player 1 types in ANY word or
// phrase (spaces allowed — e.g. "PRINCESS BRIDE"), which is hidden
// from view immediately (masked <input type="password">-style entry
// so Player 2 can watch the screen without seeing it typed). Player
// 2 then guesses letters exactly like regular hangman.
//
// SPACES: treated as automatically "revealed" — they render as a
// visible gap in the word display from the start and never count
// against the guesser, matching how a phrase reads naturally (see
// buildLetterSlots()). Only guessable characters (A-Z) count toward
// the win condition and the on-screen keyboard.
//
// SETTING — MAX MISTAKES: a small stepper (3-10, default 6, same
// default as the classic version) lets the setter pick how forgiving
// the round is before starting; this count then drives BOTH the
// wrong-guess limit AND how many stages the hangman drawing is
// stretched across (see buildStages()) — so e.g. picking 3 shows a
// much faster, starker drawing progression than the default 6,
// rather than just cutting the classic 6-stage drawing short.
// =================================================================

const MIN_WORD_LEN = 2;
const MAX_WORD_LEN = 40;
const MIN_MISTAKES = 3;
const MAX_MISTAKES = 10;
const DEFAULT_MISTAKES = 6;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

const GALLOWS_BASE = `
  <line x1="20" y1="230" x2="180" y2="230" />
  <line x1="60" y1="230" x2="60" y2="20" />
  <line x1="60" y1="20" x2="140" y2="20" />
  <line x1="140" y1="20" x2="140" y2="52" />
`;

// The 6 classic body-part stages (head, body, arm, arm, leg, leg).
// When maxMistakes differs from 6, buildStages() below resamples
// this list down/up to exactly maxMistakes steps so the drawing
// always finishes exactly on the final allowed wrong guess.
const FULL_BODY_STAGES = [
  '<circle cx="140" cy="70" r="18" />',
  '<line x1="140" y1="88" x2="140" y2="140" />',
  '<line x1="140" y1="100" x2="110" y2="125" />',
  '<line x1="140" y1="100" x2="170" y2="125" />',
  '<line x1="140" y1="140" x2="115" y2="180" />',
  '<line x1="140" y1="140" x2="165" y2="180" />',
];

/** Builds an array of `maxMistakes` cumulative SVG snippets — index 0 is
 *  "just the gallows", index maxMistakes is the fully-drawn figure —
 *  by resampling FULL_BODY_STAGES so the drawing always exactly
 *  finishes when the guess count runs out, whatever maxMistakes is. */
function buildStages(maxMistakes) {
  const stages = [''];
  let cumulative = '';
  for (let i = 1; i <= maxMistakes; i++) {
    // Map this step (1..maxMistakes) onto FULL_BODY_STAGES' 6 parts,
    // so e.g. maxMistakes=3 shows 2 body parts per wrong guess instead
    // of just the first 3 of 6 (which would leave it looking unfinished).
    const partsToShow = Math.round((i / maxMistakes) * FULL_BODY_STAGES.length);
    cumulative = FULL_BODY_STAGES.slice(0, partsToShow).join('');
    stages.push(cumulative);
  }
  return stages;
}

export function initHangmanCustom() {
  const root = document.getElementById('hangmanCustomApp');
  if (!root) return; // not on this page

  const setupView = document.getElementById('hcSetup');
  const playView = document.getElementById('hcPlay');

  const mistakesInput = document.getElementById('hcMaxMistakes');
  const mistakesDisplay = document.getElementById('hcMaxMistakesDisplay');
  const wordInput = document.getElementById('hcWordInput');
  const wordError = document.getElementById('hcWordError');
  const startBtn = document.getElementById('hcStartBtn');

  const statusEl = document.getElementById('hcStatus');
  const drawing = document.getElementById('hcDrawing');
  const wrongLettersEl = document.getElementById('hcWrongLetters');
  const wordDisplay = document.getElementById('hcWord');
  const keyboard = document.getElementById('hcKeyboard');
  const newWordBtn = document.getElementById('hcNewWord');

  let maxMistakes = DEFAULT_MISTAKES;
  let stages = buildStages(maxMistakes);
  let answer = '';
  let guessedLetters = new Set();
  let wrongCount = 0;
  let gameOver = false;

  // ---- SETUP SCREEN ----
  // Updates the mistakes-stepper's numeric readout
  function updateMistakesDisplay() {
    mistakesDisplay.textContent = String(maxMistakes);
  }

  mistakesInput.min = String(MIN_MISTAKES);
  mistakesInput.max = String(MAX_MISTAKES);
  mistakesInput.value = String(DEFAULT_MISTAKES);
  updateMistakesDisplay();

  mistakesInput.addEventListener('input', () => {
    maxMistakes = Math.min(MAX_MISTAKES, Math.max(MIN_MISTAKES, Number(mistakesInput.value) || DEFAULT_MISTAKES));
    updateMistakesDisplay();
  });

  // Switches to the setup screen (Player 1 types the word)
  function showSetup() {
    setupView.classList.remove('hidden');
    playView.classList.add('hidden');
    wordInput.value = '';
    wordError.textContent = '';
    wordInput.focus();
  }

  // Switches to the play screen (Player 2 guesses)
  function showPlay() {
    setupView.classList.add('hidden');
    playView.classList.remove('hidden');
  }

  startBtn.addEventListener('click', () => {
    const raw = wordInput.value.trim().toUpperCase();
    wordError.textContent = '';

    if (raw.length < MIN_WORD_LEN) {
      wordError.textContent = `Vul een woord of zin van minstens ${MIN_WORD_LEN} tekens in.`;
      return;
    }
    if (raw.length > MAX_WORD_LEN) {
      wordError.textContent = `Maximaal ${MAX_WORD_LEN} tekens.`;
      return;
    }
    if (!/^[A-Z ]+$/.test(raw)) {
      wordError.textContent = 'Alleen letters (A-Z) en spaties zijn toegestaan.';
      return;
    }
    if (!/[A-Z]/.test(raw)) {
      wordError.textContent = 'Er moet minstens één letter in staan.';
      return;
    }

    stages = buildStages(maxMistakes);
    startRound(raw);
    showPlay();
  });

  // ---- PLAY SCREEN (same rendering approach as hangman.js) ----
  // Updates the status line text
  function updateStatus(text) {
    statusEl.textContent = text;
  }

  // Draws the gallows plus whichever resampled stage matches the wrong-guess count
  function renderDrawing() {
    drawing.innerHTML = `
      <g stroke="var(--color-text-muted)" stroke-width="4" stroke-linecap="round" fill="none">${GALLOWS_BASE}</g>
      <g stroke="var(--color-danger)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none">${stages[wrongCount]}</g>
    `;
  }

  /** Builds one slot per character of the answer — a letter box for
   *  A-Z, or a plain wider gap (no box, never guessable, always
   *  "revealed") for a space, so multi-word phrases read naturally. */
  function renderWord() {
    wordDisplay.innerHTML = '';
    answer.split('').forEach((char) => {
      if (char === ' ') {
        const gap = document.createElement('span');
        gap.className = 'hangman-word-space';
        gap.setAttribute('aria-hidden', 'true');
        wordDisplay.appendChild(gap);
        return;
      }
      const box = document.createElement('span');
      box.className = 'hangman-letter-box';
      box.textContent = guessedLetters.has(char) ? char : '';
      wordDisplay.appendChild(box);
    });
  }

  // Reveals the full word (marking never-guessed letters) after a loss
  function renderWordRevealed() {
    wordDisplay.innerHTML = '';
    answer.split('').forEach((char) => {
      if (char === ' ') {
        const gap = document.createElement('span');
        gap.className = 'hangman-word-space';
        gap.setAttribute('aria-hidden', 'true');
        wordDisplay.appendChild(gap);
        return;
      }
      const box = document.createElement('span');
      box.className = 'hangman-letter-box' + (guessedLetters.has(char) ? '' : ' hangman-letter-box-revealed');
      box.textContent = char;
      wordDisplay.appendChild(box);
    });
  }

  // Updates the "foute letters" list
  function renderWrongLetters() {
    const wrong = [...guessedLetters].filter((l) => !answer.includes(l));
    wrongLettersEl.textContent = wrong.length ? `Foute letters: ${wrong.join(', ')}` : '';
  }

  // Builds the on-screen A-Z keyboard
  function renderKeyboard() {
    keyboard.innerHTML = '';
    ALPHABET.forEach((letter) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hangman-key';
      btn.dataset.key = letter;
      btn.textContent = letter;
      btn.addEventListener('click', () => {
        guessLetter(letter);
        btn.blur();
      });
      keyboard.appendChild(btn);
    });
  }

  // Looks up an on-screen keyboard key's DOM element by letter
  function keyEl(letter) {
    return keyboard.querySelector(`.hangman-key[data-key="${letter}"]`);
  }

  /** True once every guessable (non-space) character has been guessed. */
  function isFullySolved() {
    return answer.split('').every((char) => char === ' ' || guessedLetters.has(char));
  }

  // Handles one letter guess: marks it correct/wrong and checks win/loss
  function guessLetter(letter) {
    if (gameOver || guessedLetters.has(letter)) return;

    guessedLetters.add(letter);
    const key = keyEl(letter);

    if (answer.includes(letter)) {
      key?.classList.add('hangman-key-correct');
      renderWord();

      if (isFullySolved()) {
        gameOver = true;
        updateStatus(`Goed geraden! Het antwoord was "${answer}". 🎉`);
      }
    } else {
      key?.classList.add('hangman-key-wrong');
      wrongCount += 1;
      renderDrawing();
      renderWrongLetters();

      if (wrongCount >= maxMistakes) {
        gameOver = true;
        renderWordRevealed();
        updateStatus(`Helaas! Het poppetje is af. Het antwoord was "${answer}".`);
      } else {
        updateStatus(`Nog ${maxMistakes - wrongCount} fout${maxMistakes - wrongCount === 1 ? '' : 'en'} toegestaan.`);
      }
    }

    if (key) key.disabled = true;
  }

  // Maps a physical A-Z keypress onto guessLetter(), only during play
  function handlePhysicalKeydown(event) {
    if (!root.isConnected) return;
    if (playView.classList.contains('hidden')) return; // don't hijack typing on the setup screen
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (/^[a-zA-Z]$/.test(event.key)) guessLetter(event.key.toUpperCase());
  }

  // Starts a round with Player 1's chosen word/phrase
  function startRound(word) {
    answer = word;
    guessedLetters = new Set();
    wrongCount = 0;
    gameOver = false;

    renderDrawing();
    renderWord();
    renderKeyboard();
    renderWrongLetters();
    updateStatus(`Speler 2, raad het woord! Je mag ${maxMistakes} keer fout gokken.`);
  }

  newWordBtn.addEventListener('click', () => {
    newWordBtn.blur();
    showSetup();
  });

  document.addEventListener('keydown', handlePhysicalKeydown);

  showSetup();
}
