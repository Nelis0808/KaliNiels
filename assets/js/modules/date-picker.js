// =================================================================
// DATE IDEA PICKER (date.html)
// -----------------------------------------------------------------
// Loads a JSON list of ideas and reveals a random one when its
// button is clicked, never repeating the immediately-previous pick.
//
// Data files live in assets/data/. Paths below are resolved with
// 'new URL(..., import.meta.url)' rather than a plain relative
// string — that resolves relative to THIS FILE's location, not the
// page that imported it, so this module keeps working unchanged
// no matter which page/folder depth imports it in the future.
//
// EXTENDING: to add a third category:
// 1. Add a new entry to CATEGORIES
// 2. A matching JSON file in assets/data/
// 3. A button + result container in the HTML with matching ids.
// =================================================================

import { escapeHtml } from './utils.js';

const CATEGORIES = {
  indoor: {
    dataUrl: new URL('../../data/date-ideas-indoor.json', import.meta.url),
    buttonId: 'btnBinnen',
    resultId: 'resultBinnen',
  },
  outdoor: {
    dataUrl: new URL('../../data/date-ideas-outdoor.json', import.meta.url),
    buttonId: 'btnBuiten',
    resultId: 'resultBuiten',
  },
};

const ideasCache = new Map(); // category -> string[]
const lastShown = new Map();  // category -> last idea shown, to avoid an immediate repeat

async function loadIdeas(category) {
  if (ideasCache.has(category)) return ideasCache.get(category);

  const response = await fetch(CATEGORIES[category].dataUrl);
  if (!response.ok) {
    throw new Error(`Could not load ideas for "${category}" (HTTP ${response.status})`);
  }

  const ideas = await response.json();
  ideasCache.set(category, ideas);
  return ideas;
}

function pickRandom(ideas, avoid) {
  if (ideas.length <= 1) return ideas[0];

  let choice;
  do {
    choice = ideas[Math.floor(Math.random() * ideas.length)];
  } while (choice === avoid);

  return choice;
}

async function revealRandomIdea(category) {
  const { resultId } = CATEGORIES[category];
  const container = document.getElementById(resultId);
  if (!container) return;

  container.setAttribute('aria-busy', 'true');

  try {
    const ideas = await loadIdeas(category);
    const idea = pickRandom(ideas, lastShown.get(category));
    lastShown.set(category, idea);

    container.innerHTML = `
      <div class="card reveal-card idea-card">
        <h3>${escapeHtml(idea)}</h3>
      </div>
    `;

    const card = container.querySelector('.reveal-card');
    // Double rAF so the browser registers the initial (hidden) state
    // before flipping to `.show`, guaranteeing the transition plays.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => card.classList.add('show'));
    });
  } catch (error) {
    container.textContent = 'Kon de ideeën niet laden. Probeer het opnieuw.';
    console.error(error);
  } finally {
    container.setAttribute('aria-busy', 'false');
  }
}

export function initDatePicker() {
  const buttons = Object.entries(CATEGORIES).filter(
    ([, config]) => document.getElementById(config.buttonId)
  );
  if (buttons.length === 0) return; // not on the date-ideas page

  buttons.forEach(([category, config]) => {
    document
      .getElementById(config.buttonId)
      .addEventListener('click', () => revealRandomIdea(category));
  });
}
