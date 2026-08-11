// =================================================================
// WORDLE
// -----------------------------------------------------------------
// Local single-device word-guessing game, English words (see
// assets/data/word-list.json — a curated common-English word list,
// bucketed by length 4-10, then further grouped by starting letter
// for easy browsing/editing). The player picks a word length with
// the length-picker pills; the game then behaves like classic
// Wordle: length+1 guesses, green/yellow/gray feedback, on-screen +
// physical keyboard support.
//
// INVALID-WORD FEEDBACK: submitting a full-length guess that isn't a
// real word does two things at once — the row's cells get a
// persistent red border (markRowInvalid, cleared the moment the
// player edits that row again — see clearInvalidRow), AND the Enter
// key itself briefly flashes red (flashEnterInvalid) so the
// rejection is obviously tied to the action that triggered it, not
// just something that happened somewhere on the board.
//
// Data file is shared with hangman.js (assets/js/modules/hangman.js)
// — same JSON, same shape:
//   { "4": { "A": [...], "B": [...], ... }, "5": { ... }, ... }
// Both modules flatten each length's letter-groups into one array
// right after loading (see flattenWordData below), so the rest of
// the game logic just deals with plain arrays, same as before.
//
// LANGUAGE: two word lists exist side by side — the original English
// one (word-list.json) and a Dutch one (word-list-nl.json, same
// shape, no accented letters so it works with the plain A-Z on-screen
// keyboard). Dutch (NL) is the default the first time the page is
// opened, and the NL pill is listed first — then can be flipped with
// the NL/EN pill next to the length picker — that manual choice is
// remembered in localStorage from then on, same pattern as the
// length picker itself (see LANG_STORAGE_KEY).
// =================================================================

const DATA_URLS = {
  en: new URL('../../data/word-list.json', import.meta.url),
  nl: new URL('../../data/word-list-nl.json', import.meta.url),
};
const MIN_LEN = 4;
const MAX_LEN = 10;
const LENGTH_STORAGE_KEY = 'wordleLength';
const LANG_STORAGE_KEY = 'wordleLang';
const ENTER_FLASH_MS = 500;

// Default language for a first-time visitor (NL)
function detectDefaultLang() {
  return 'nl';
}

const KEYBOARD_ROWS = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
];

const wordsCache = {}; // loaded once per language, cached — { en: {...}, nl: {...} }

/** { "4": { "A": [...], "B": [...] } } -> { "4": [...all merged...] } */
// Merges each length's per-letter word groups into one flat array
function flattenWordData(raw) {
  const flat = {};
  for (const [length, byLetter] of Object.entries(raw)) {
    flat[length] = Object.values(byLetter).flat();
  }
  return flat;
}

// Fetches (and caches) a language's word list, flattened
async function loadWords(lang) {
  if (wordsCache[lang]) return wordsCache[lang];
  const response = await fetch(DATA_URLS[lang]);
  if (!response.ok) throw new Error(`Kon woordenlijst niet laden (HTTP ${response.status})`);
  const raw = await response.json();
  wordsCache[lang] = flattenWordData(raw);
  return wordsCache[lang];
}

// Picks a random word from a list
function pickWord(words) {
  return words[Math.floor(Math.random() * words.length)];
}

/** Classic two-pass Wordle scoring: greens first, then yellows against what's left, so duplicate letters are handled correctly. */
function scoreGuess(guess, answer) {
  const result = Array(guess.length).fill('absent');
  const answerLetters = answer.split('');
  const used = Array(answer.length).fill(false);

  for (let i = 0; i < guess.length; i++) {
    if (guess[i] === answerLetters[i]) {
      result[i] = 'correct';
      used[i] = true;
    }
  }

  for (let i = 0; i < guess.length; i++) {
    if (result[i] === 'correct') continue;
    const idx = answerLetters.findIndex((letter, j) => letter === guess[i] && !used[j]);
    if (idx !== -1) {
      result[i] = 'present';
      used[idx] = true;
    }
  }

  return result;
}

export function initWordle() {
  const root = document.getElementById('wordleApp');
  if (!root) return; // not on the wordle page

  const lengthPicker = document.getElementById('wordleLengthPicker');
  const langPicker = document.getElementById('wordleLangPicker');
  const grid = document.getElementById('wordleGrid');
  const keyboard = document.getElementById('wordleKeyboard');
  const statusEl = document.getElementById('wordleStatus');
  const newWordBtn = document.getElementById('wordleNewWord');

  let wordLength = clampLength(Number(localStorage.getItem(LENGTH_STORAGE_KEY)) || 5);
  let lang = localStorage.getItem(LANG_STORAGE_KEY) || detectDefaultLang();
  let maxGuesses = wordLength + 1;
  let answer = '';
  let currentGuess = '';
  let guessRow = 0;
  let gameOver = false;
  let validGuesses = new Set();
  let wordsByLength = null; // current language's flat arrays, keyed by length

  // Clamps a requested word length to the supported MIN_LEN..MAX_LEN range
  function clampLength(len) {
    return Math.min(MAX_LEN, Math.max(MIN_LEN, len));
  }

  // Updates the status line text
  function updateStatus(text) {
    statusEl.textContent = text;
  }

  // Renders the NL/EN language pills
  function renderLangPicker() {
    if (!langPicker) return;
    langPicker.innerHTML = '';
    [
      { code: 'nl', label: 'NL' },
      { code: 'en', label: 'EN' },
    ].forEach(({ code, label }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wordle-length-pill' + (code === lang ? ' wordle-length-pill-active' : '');
      btn.textContent = label;
      btn.setAttribute('aria-pressed', String(code === lang));
      btn.addEventListener('click', () => {
        btn.blur();
        if (code === lang) return;
        lang = code;
        localStorage.setItem(LANG_STORAGE_KEY, code);
        renderLangPicker();
        updateStatus('Woordenlijst laden…');
        loadWords(lang)
          .then((words) => {
            wordsByLength = words;
            startNewGame();
          })
          .catch((error) => {
            updateStatus('Kon de woordenlijst niet laden. Probeer de pagina te herladen.');
            console.error(error);
          });
      });
      langPicker.appendChild(btn);
    });
  }

  // Renders the word-length pills (4-10)
  function renderLengthPicker() {
    lengthPicker.innerHTML = '';
    for (let len = MIN_LEN; len <= MAX_LEN; len++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wordle-length-pill' + (len === wordLength ? ' wordle-length-pill-active' : '');
      btn.textContent = String(len);
      btn.setAttribute('aria-pressed', String(len === wordLength));
      btn.addEventListener('click', () => {
        btn.blur(); // don't leave this button focused — see newWordBtn below for why
        if (len === wordLength) return;
        wordLength = len;
        localStorage.setItem(LENGTH_STORAGE_KEY, String(len));
        renderLengthPicker();
        startNewGame();
      });
      lengthPicker.appendChild(btn);
    }
  }

  // Builds the empty guess grid for the current word length/guess count
  function renderGrid() {
    grid.innerHTML = '';
    grid.style.setProperty('--wordle-cols', String(wordLength));

    for (let row = 0; row < maxGuesses; row++) {
      for (let col = 0; col < wordLength; col++) {
        const cell = document.createElement('div');
        cell.className = 'wordle-cell';
        cell.dataset.row = String(row);
        cell.dataset.col = String(col);
        grid.appendChild(cell);
      }
    }
  }

  // Builds the on-screen A-Z keyboard plus Enter/Backspace keys
  function renderKeyboard() {
    keyboard.innerHTML = '';
    KEYBOARD_ROWS.forEach((row) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'wordle-key-row';
      row.forEach((key) => {
        const keyBtn = document.createElement('button');
        keyBtn.type = 'button';
        keyBtn.dataset.key = key;
        keyBtn.className = 'wordle-key';
        keyBtn.textContent = key;
        keyBtn.addEventListener('click', () => {
          handleKey(key);
          keyBtn.blur(); // don't leave this button focused — see newWordBtn below for why
        });
        rowEl.appendChild(keyBtn);
      });
      keyboard.appendChild(rowEl);
    });

    // Enter + backspace get their own row, big touch targets in the
    // site's brand-color gradient (auto-adapts to the blue/pink theme),
    // Enter taking 75% of the width and Backspace the remaining 25%.
    const actionRow = document.createElement('div');
    actionRow.className = 'wordle-key-row wordle-key-row-actions';

    const enterBtn = document.createElement('button');
    enterBtn.type = 'button';
    enterBtn.dataset.key = 'ENTER';
    enterBtn.className = 'wordle-key wordle-key-action wordle-key-enter';
    enterBtn.textContent = 'Enter';
    enterBtn.addEventListener('click', () => {
      handleKey('ENTER');
      enterBtn.blur();
    });

    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.dataset.key = 'BACK';
    backBtn.className = 'wordle-key wordle-key-action wordle-key-back';
    backBtn.textContent = '⌫';
    backBtn.addEventListener('click', () => {
      handleKey('BACK');
      backBtn.blur();
    });

    actionRow.appendChild(enterBtn);
    actionRow.appendChild(backBtn);
    keyboard.appendChild(actionRow);
  }

  // Looks up a grid cell's DOM element by row/col
  function cellAt(row, col) {
    return grid.querySelector(`.wordle-cell[data-row="${row}"][data-col="${col}"]`);
  }

  // Looks up the Enter key's DOM element
  function enterKeyEl() {
    return keyboard.querySelector('.wordle-key-enter');
  }

  // Redraws the row being typed with the current guess's letters
  function updateCurrentRow() {
    for (let col = 0; col < wordLength; col++) {
      const cell = cellAt(guessRow, col);
      cell.textContent = currentGuess[col] || '';
      cell.classList.toggle('wordle-cell-filled', Boolean(currentGuess[col]));
    }
  }

  // Plays a one-off shake animation on the current row (e.g. too short)
  function shakeCurrentRow() {
    for (let col = 0; col < wordLength; col++) {
      const cell = cellAt(guessRow, col);
      cell.classList.add('wordle-cell-shake');
      cell.addEventListener('animationend', () => cell.classList.remove('wordle-cell-shake'), { once: true });
    }
  }

  /** Persistent red border on every cell of the current row — stays put until the guess is edited (see clearInvalidRow), unlike the shake above, which is a one-off animation. */
  function markRowInvalid() {
    for (let col = 0; col < wordLength; col++) {
      cellAt(guessRow, col).classList.add('wordle-cell-invalid');
    }
  }

  // Clears the persistent invalid-word red border from the current row
  function clearInvalidRow() {
    for (let col = 0; col < wordLength; col++) {
      cellAt(guessRow, col).classList.remove('wordle-cell-invalid');
    }
  }

  /** Brief red-border flash directly on the Enter key itself, so the
   *  rejection reads as "that Enter press didn't work" rather than
   *  only showing up somewhere else on the board. Self-clears after
   *  ENTER_FLASH_MS — deliberately NOT persistent like markRowInvalid,
   *  since the key itself isn't in a stuck/invalid state, only that
   *  one press was rejected. */
  function flashEnterInvalid() {
    const enterKey = enterKeyEl();
    if (!enterKey) return;
    enterKey.classList.remove('wordle-key-enter-invalid'); // restart the animation if still mid-flash from a rapid double Enter
    void enterKey.offsetWidth; // force reflow so re-adding the class below re-triggers the CSS transition
    enterKey.classList.add('wordle-key-enter-invalid');
    setTimeout(() => enterKey.classList.remove('wordle-key-enter-invalid'), ENTER_FLASH_MS);
  }

  // Looks up an on-screen keyboard key's DOM element by letter
  function keyEl(letter) {
    return keyboard.querySelector(`.wordle-key[data-key="${letter}"]`);
  }

  // Validates and scores the current guess, or rejects it with feedback
  function submitGuess() {
    if (gameOver) return;
    if (currentGuess.length !== wordLength) {
      updateStatus(`Woord moet ${wordLength} letters lang zijn.`);
      shakeCurrentRow();
      flashEnterInvalid();
      return;
    }
    if (!validGuesses.has(currentGuess)) {
      // Only reachable once the row is filled to wordLength (see the
      // length check above), so this is exactly the "full row, unknown
      // word" case — mark it with a red border, not just the shake.
      updateStatus('Onbekend woord, probeer een ander.');
      shakeCurrentRow();
      markRowInvalid();
      flashEnterInvalid();
      return;
    }

    const result = scoreGuess(currentGuess, answer);

    result.forEach((state, col) => {
      const cell = cellAt(guessRow, col);
      cell.classList.add(`wordle-cell-${state}`);
      cell.classList.add('wordle-cell-reveal');
      cell.style.animationDelay = `${col * 0.12}s`;

      const key = keyEl(currentGuess[col]);
      if (!key) return;
      const rank = { absent: 0, present: 1, correct: 2 };
      const currentRank = rank[key.dataset.state] ?? -1;
      if (rank[state] > currentRank) {
        key.dataset.state = state;
        key.classList.remove('wordle-key-absent', 'wordle-key-present', 'wordle-key-correct');
        key.classList.add(`wordle-key-${state}`);
      }
    });

    if (currentGuess === answer) {
      gameOver = true;
      updateStatus(`Goed geraden! Het woord was ${answer}. 🎉`);
      return;
    }

    guessRow += 1;
    currentGuess = '';

    if (guessRow >= maxGuesses) {
      gameOver = true;
      updateStatus(`Helaas! Het woord was ${answer}.`);
      return;
    }

    updateStatus(`Nog ${maxGuesses - guessRow} poging${maxGuesses - guessRow === 1 ? '' : 'en'}.`);
  }

  // Routes one key press (letter, BACK, or ENTER) to the right handler
  function handleKey(key) {
    if (gameOver) {
      // Round is over — Enter starts the next one instead of doing nothing.
      if (key === 'ENTER') startNewGame();
      return;
    }

    if (key === 'ENTER') {
      submitGuess();
      return;
    }
    if (key === 'BACK') {
      currentGuess = currentGuess.slice(0, -1);
      clearInvalidRow();
      updateCurrentRow();
      checkLiveValidity();
      return;
    }
    if (currentGuess.length < wordLength) {
      currentGuess += key;
      clearInvalidRow();
      updateCurrentRow();
      checkLiveValidity();
    }
  }

  /** Runs after every keystroke (letter or backspace), not just on
   *  Enter. As soon as the row is filled to wordLength, checks the
   *  word against the dictionary right away — if it's not a real
   *  word, the red border appears immediately instead of waiting for
   *  the player to press Enter. A row that isn't full yet, or one
   *  that already matches a real word (e.g. the correct answer),
   *  never gets marked — clearInvalidRow() above already handles
   *  wiping the border the moment the player edits the row. */
  function checkLiveValidity() {
    if (currentGuess.length === wordLength && !validGuesses.has(currentGuess)) {
      markRowInvalid();
    }
  }

  // Maps a physical keyboard keydown onto the same handleKey() path
  function handlePhysicalKeydown(event) {
    if (!root.isConnected) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    const key = event.key;
    // Without preventDefault, a plain Enter/Space keypress ALSO triggers a
    // native click on whatever button currently has focus (e.g. "Nieuw
    // woord", or a length pill). That's the "new round" bug: click "Nieuw
    // woord", it keeps keyboard focus, then the very next Enter you press
    // to submit a guess silently re-clicks it and restarts the round
    // instead of submitting. Blurring those buttons after click (below)
    // avoids it too, but preventDefault here is the actual, direct fix.
    if (key === 'Enter') { event.preventDefault(); handleKey('ENTER'); return; }
    if (key === 'Backspace') { event.preventDefault(); handleKey('BACK'); return; }
    if (/^[a-zA-Z]$/.test(key)) { event.preventDefault(); handleKey(key.toUpperCase()); }
  }

  // Picks a new answer and resets the grid/keyboard/status for a fresh round
  function startNewGame() {
    const words = wordsByLength[String(wordLength)] || [];
    validGuesses = new Set(words);
    answer = pickWord(words);
    maxGuesses = wordLength + 1;
    currentGuess = '';
    guessRow = 0;
    gameOver = false;

    renderGrid();
    renderKeyboard();
    updateStatus(`Raad het woord van ${wordLength} letters. Je hebt ${maxGuesses} pogingen.`);
  }

  loadWords(lang)
    .then((words) => {
      wordsByLength = words;
      renderLengthPicker();
      renderLangPicker();
      startNewGame();
      newWordBtn.addEventListener('click', () => {
        startNewGame();
        newWordBtn.blur(); // see handlePhysicalKeydown for why this matters
      });
      document.addEventListener('keydown', handlePhysicalKeydown);
    })
    .catch((error) => {
      updateStatus('Kon de woordenlijst niet laden. Probeer de pagina te herladen.');
      console.error(error);
    });
}
