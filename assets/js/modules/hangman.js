// =================================================================
// GALGJE (Hangman)
// -----------------------------------------------------------------
// Local single-device word-guessing game (see
// assets/data/word-list.json, shared with wordle.js — same JSON,
// bucketed by length 4-10, then further grouped by starting letter:
//   { "4": { "A": [...], "B": [...], ... }, "5": { ... }, ... }
// Flattened into plain per-length arrays right after loading (see
// flattenWordData below), same as before. The player picks a word
// length with the length-picker pills, then guesses letters one at
// a time. 6 wrong guesses allowed, each one reveals another part of
// the drawing (assets/icons/hangman/stages, drawn inline as SVG —
// see HANGMAN_STAGES below).
//
// LANGUAGE: same EN/NL word-list toggle as wordle.js — see the
// LANGUAGE comment there for the full explanation. Defaults to the
// browser's language, overridable with the EN/NL pill, remembered in
// localStorage from then on (LANG_STORAGE_KEY below).
// =================================================================

const DATA_URLS = {
  en: new URL('../../data/word-list.json', import.meta.url),
  nl: new URL('../../data/word-list-nl.json', import.meta.url),
};
const MIN_LEN = 4;
const MAX_LEN = 10;
const MAX_WRONG = 6;
const LENGTH_STORAGE_KEY = 'hangmanLength';
const LANG_STORAGE_KEY = 'hangmanLang';

function detectDefaultLang() {
  const browserLang = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
  return browserLang.startsWith('nl') ? 'nl' : 'en';
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// Each stage adds one more body part / gallows piece on top of the
// previous one. Index = number of wrong guesses so far (0 = empty
// gallows, 6 = fully drawn figure = game over).
const HANGMAN_STAGES = [
  '', // 0 wrong: just the gallows (drawn as static "base" markup below)
  '<circle cx="140" cy="70" r="18" />',
  '<circle cx="140" cy="70" r="18" /><line x1="140" y1="88" x2="140" y2="140" />',
  '<circle cx="140" cy="70" r="18" /><line x1="140" y1="88" x2="140" y2="140" /><line x1="140" y1="100" x2="110" y2="125" />',
  '<circle cx="140" cy="70" r="18" /><line x1="140" y1="88" x2="140" y2="140" /><line x1="140" y1="100" x2="110" y2="125" /><line x1="140" y1="100" x2="170" y2="125" />',
  '<circle cx="140" cy="70" r="18" /><line x1="140" y1="88" x2="140" y2="140" /><line x1="140" y1="100" x2="110" y2="125" /><line x1="140" y1="100" x2="170" y2="125" /><line x1="140" y1="140" x2="115" y2="180" />',
  '<circle cx="140" cy="70" r="18" /><line x1="140" y1="88" x2="140" y2="140" /><line x1="140" y1="100" x2="110" y2="125" /><line x1="140" y1="100" x2="170" y2="125" /><line x1="140" y1="140" x2="115" y2="180" /><line x1="140" y1="140" x2="165" y2="180" />',
];

const GALLOWS_BASE = `
  <line x1="20" y1="230" x2="180" y2="230" />
  <line x1="60" y1="230" x2="60" y2="20" />
  <line x1="60" y1="20" x2="140" y2="20" />
  <line x1="140" y1="20" x2="140" y2="52" />
`;

const wordsCache = {}; // loaded once per language, cached — { en: {...}, nl: {...} }

/** { "4": { "A": [...], "B": [...] } } -> { "4": [...all merged...] } */
function flattenWordData(raw) {
  const flat = {};
  for (const [length, byLetter] of Object.entries(raw)) {
    flat[length] = Object.values(byLetter).flat();
  }
  return flat;
}

async function loadWords(lang) {
  if (wordsCache[lang]) return wordsCache[lang];
  const response = await fetch(DATA_URLS[lang]);
  if (!response.ok) throw new Error(`Kon woordenlijst niet laden (HTTP ${response.status})`);
  const raw = await response.json();
  wordsCache[lang] = flattenWordData(raw);
  return wordsCache[lang];
}

function pickWord(words) {
  return words[Math.floor(Math.random() * words.length)];
}

export function initHangman() {
  const root = document.getElementById('hangmanApp');
  if (!root) return; // not on the hangman page

  const lengthPicker = document.getElementById('hangmanLengthPicker');
  const langPicker = document.getElementById('hangmanLangPicker');
  const wordDisplay = document.getElementById('hangmanWord');
  const keyboard = document.getElementById('hangmanKeyboard');
  const statusEl = document.getElementById('hangmanStatus');
  const drawing = document.getElementById('hangmanDrawing');
  const wrongLettersEl = document.getElementById('hangmanWrongLetters');
  const newWordBtn = document.getElementById('hangmanNewWord');

  let wordLength = clampLength(Number(localStorage.getItem(LENGTH_STORAGE_KEY)) || 6);
  let lang = localStorage.getItem(LANG_STORAGE_KEY) || detectDefaultLang();
  let answer = '';
  let guessedLetters = new Set();
  let wrongCount = 0;
  let gameOver = false;
  let wordsByLength = null; // current language's flat arrays, keyed by length

  function clampLength(len) {
    return Math.min(MAX_LEN, Math.max(MIN_LEN, len));
  }

  function updateStatus(text) {
    statusEl.textContent = text;
  }

  function renderLangPicker() {
    if (!langPicker) return;
    langPicker.innerHTML = '';
    [
      { code: 'en', label: 'EN' },
      { code: 'nl', label: 'NL' },
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

  function renderDrawing() {
    drawing.innerHTML = `
      <g stroke="var(--color-text-muted)" stroke-width="4" stroke-linecap="round" fill="none">${GALLOWS_BASE}</g>
      <g stroke="var(--color-danger)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none">${HANGMAN_STAGES[wrongCount]}</g>
    `;
  }

  function renderWord() {
    wordDisplay.innerHTML = '';
    answer.split('').forEach((letter) => {
      const box = document.createElement('span');
      box.className = 'hangman-letter-box';
      box.textContent = guessedLetters.has(letter) ? letter : '';
      wordDisplay.appendChild(box);
    });
  }

  function renderWrongLetters() {
    const wrong = [...guessedLetters].filter((l) => !answer.includes(l));
    wrongLettersEl.textContent = wrong.length ? `Foute letters: ${wrong.join(', ')}` : '';
  }

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
        btn.blur(); // don't leave this button focused — see newWordBtn below for why
      });
      keyboard.appendChild(btn);
    });
  }

  function keyEl(letter) {
    return keyboard.querySelector(`.hangman-key[data-key="${letter}"]`);
  }

  function guessLetter(letter) {
    if (gameOver || guessedLetters.has(letter)) return;

    guessedLetters.add(letter);
    const key = keyEl(letter);

    if (answer.includes(letter)) {
      key?.classList.add('hangman-key-correct');
      renderWord();

      if (answer.split('').every((l) => guessedLetters.has(l))) {
        gameOver = true;
        updateStatus(`Goed geraden! Het woord was ${answer}. 🎉`);
      }
    } else {
      key?.classList.add('hangman-key-wrong');
      wrongCount += 1;
      renderDrawing();
      renderWrongLetters();

      if (wrongCount >= MAX_WRONG) {
        gameOver = true;
        renderWordRevealed();
        updateStatus(`Helaas! Het poppetje is af. Het woord was ${answer}.`);
      } else {
        updateStatus(`Nog ${MAX_WRONG - wrongCount} fout${MAX_WRONG - wrongCount === 1 ? '' : 'en'} toegestaan.`);
      }
    }

    if (key) key.disabled = true;
  }

  function renderWordRevealed() {
    wordDisplay.innerHTML = '';
    answer.split('').forEach((letter) => {
      const box = document.createElement('span');
      box.className = 'hangman-letter-box' + (guessedLetters.has(letter) ? '' : ' hangman-letter-box-revealed');
      box.textContent = letter;
      wordDisplay.appendChild(box);
    });
  }

  function handlePhysicalKeydown(event) {
    if (!root.isConnected) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (/^[a-zA-Z]$/.test(event.key)) guessLetter(event.key.toUpperCase());
  }

  function startNewGame() {
    const words = wordsByLength[String(wordLength)] || [];
    answer = pickWord(words);
    guessedLetters = new Set();
    wrongCount = 0;
    gameOver = false;

    renderDrawing();
    renderWord();
    renderKeyboard();
    renderWrongLetters();
    updateStatus(`Raad het woord van ${wordLength} letters. Je mag ${MAX_WRONG} keer fout gokken.`);
  }

  loadWords(lang)
    .then((words) => {
      wordsByLength = words;
      renderLengthPicker();
      renderLangPicker();
      startNewGame();
      newWordBtn.addEventListener('click', () => {
        startNewGame();
        newWordBtn.blur();
      });
      document.addEventListener('keydown', handlePhysicalKeydown);
    })
    .catch((error) => {
      updateStatus('Kon de woordenlijst niet laden. Probeer de pagina te herladen.');
      console.error(error);
    });
}
