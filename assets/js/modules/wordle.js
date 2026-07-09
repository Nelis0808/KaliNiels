// =================================================================
// WORDLE
// -----------------------------------------------------------------
// Local single-device word-guessing game, English words (see
// assets/data/word-list.json — a curated common-English word list,
// bucketed by length 4-10). The player picks a word length with the
// length-picker pills; the game then behaves like classic Wordle:
// length+1 guesses, green/yellow/gray feedback, on-screen + physical
// keyboard support.
//
// Data file is shared with hangman.js (assets/js/modules/hangman.js)
// — same JSON, same shape: { "4": [...], "5": [...], ... }.
// =================================================================

const DATA_URL = new URL('../../data/word-list.json', import.meta.url);
const MIN_LEN = 4;
const MAX_LEN = 10;
const LENGTH_STORAGE_KEY = 'wordleLength';

const KEYBOARD_ROWS = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['ENTER', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'BACK'],
];

let wordsByLength = null; // loaded once, cached

async function loadWords() {
  if (wordsByLength) return wordsByLength;
  const response = await fetch(DATA_URL);
  if (!response.ok) throw new Error(`Kon woordenlijst niet laden (HTTP ${response.status})`);
  wordsByLength = await response.json();
  return wordsByLength;
}

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
  const grid = document.getElementById('wordleGrid');
  const keyboard = document.getElementById('wordleKeyboard');
  const statusEl = document.getElementById('wordleStatus');
  const newWordBtn = document.getElementById('wordleNewWord');

  let wordLength = clampLength(Number(localStorage.getItem(LENGTH_STORAGE_KEY)) || 5);
  let maxGuesses = wordLength + 1;
  let answer = '';
  let currentGuess = '';
  let guessRow = 0;
  let gameOver = false;
  let validGuesses = new Set();

  function clampLength(len) {
    return Math.min(MAX_LEN, Math.max(MIN_LEN, len));
  }

  function updateStatus(text) {
    statusEl.textContent = text;
  }

  function renderLengthPicker() {
    lengthPicker.innerHTML = '';
    for (let len = MIN_LEN; len <= MAX_LEN; len++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wordle-length-pill' + (len === wordLength ? ' wordle-length-pill-active' : '');
      btn.textContent = String(len);
      btn.setAttribute('aria-pressed', String(len === wordLength));
      btn.addEventListener('click', () => {
        if (len === wordLength) return;
        wordLength = len;
        localStorage.setItem(LENGTH_STORAGE_KEY, String(len));
        renderLengthPicker();
        startNewGame();
      });
      lengthPicker.appendChild(btn);
    }
  }

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

  function renderKeyboard() {
    keyboard.innerHTML = '';
    KEYBOARD_ROWS.forEach((row) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'wordle-key-row';
      row.forEach((key) => {
        const keyBtn = document.createElement('button');
        keyBtn.type = 'button';
        keyBtn.dataset.key = key;
        keyBtn.className = 'wordle-key' + (key === 'ENTER' || key === 'BACK' ? ' wordle-key-wide' : '');
        keyBtn.textContent = key === 'BACK' ? '⌫' : key === 'ENTER' ? 'Enter' : key;
        keyBtn.addEventListener('click', () => handleKey(key));
        rowEl.appendChild(keyBtn);
      });
      keyboard.appendChild(rowEl);
    });
  }

  function cellAt(row, col) {
    return grid.querySelector(`.wordle-cell[data-row="${row}"][data-col="${col}"]`);
  }

  function updateCurrentRow() {
    for (let col = 0; col < wordLength; col++) {
      const cell = cellAt(guessRow, col);
      cell.textContent = currentGuess[col] || '';
      cell.classList.toggle('wordle-cell-filled', Boolean(currentGuess[col]));
    }
  }

  function shakeCurrentRow() {
    for (let col = 0; col < wordLength; col++) {
      const cell = cellAt(guessRow, col);
      cell.classList.add('wordle-cell-shake');
      cell.addEventListener('animationend', () => cell.classList.remove('wordle-cell-shake'), { once: true });
    }
  }

  function keyEl(letter) {
    return keyboard.querySelector(`.wordle-key[data-key="${letter}"]`);
  }

  function submitGuess() {
    if (gameOver) return;
    if (currentGuess.length !== wordLength) {
      updateStatus(`Woord moet ${wordLength} letters lang zijn.`);
      shakeCurrentRow();
      return;
    }
    if (!validGuesses.has(currentGuess)) {
      updateStatus('Onbekend woord — probeer een ander.');
      shakeCurrentRow();
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

  function handleKey(key) {
    if (gameOver) return;

    if (key === 'ENTER') {
      submitGuess();
      return;
    }
    if (key === 'BACK') {
      currentGuess = currentGuess.slice(0, -1);
      updateCurrentRow();
      return;
    }
    if (currentGuess.length < wordLength) {
      currentGuess += key;
      updateCurrentRow();
    }
  }

  function handlePhysicalKeydown(event) {
    if (!root.isConnected) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    const key = event.key;
    if (key === 'Enter') { handleKey('ENTER'); return; }
    if (key === 'Backspace') { handleKey('BACK'); return; }
    if (/^[a-zA-Z]$/.test(key)) { handleKey(key.toUpperCase()); }
  }

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

  loadWords()
    .then((data) => {
      wordsByLength = data;
      renderLengthPicker();
      startNewGame();
      newWordBtn.addEventListener('click', startNewGame);
      document.addEventListener('keydown', handlePhysicalKeydown);
    })
    .catch((error) => {
      updateStatus('Kon de woordenlijst niet laden. Probeer de pagina te herladen.');
      console.error(error);
    });
}
