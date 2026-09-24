// =================================================================
// DEV PAGE (dev.html) — hidden admin/testing tools
// -----------------------------------------------------------------
// See siteConfig.dev (assets/js/config.js) for the full writeup of
// this page's own login gate: a lightweight, purely client-side
// password check, deliberately separate from the shared "👤 Profiel"
// site login (auth.js) — NOT a real security boundary, just enough
// to keep this off the beaten path.
//
// Every section below reads/writes this browser's own localStorage
// directly (via collectibles.js / study-timer.js's own exports), and
// works the same whether or not anyone is logged in via "👤 Profiel"
// — EXCEPT the Chips section, which genuinely needs that session:
// chips live server-side (cloudflare/chips/chips_worker.js), and
// that Worker only ever lets a token adjust its OWN person's
// balance, never an arbitrary one picked from a dropdown here.
// =================================================================

import { siteConfig } from '../config.js';
import { escapeHtml } from './utils.js';
import { getAuth, onAuthChange, currentPersonLabel, logout as siteLogout } from './auth.js';
import {
  getCollections,
  getCollection,
  getCollectionState,
  setCollectedCount,
  resetCollectionProgress,
  resetCollectionRewards,
} from './collectibles.js';
import { resetStudyTimerState } from './study-timer.js';

const DEV_UNLOCK_KEY = 'devUnlockedV1';

function personLabel(who) {
  const labels = siteConfig.photos?.personLabels || {};
  return labels[who] || (who === 'a' ? 'Persoon A' : 'Persoon B');
}

export function initDevPage() {
  const root = document.getElementById('devApp');
  if (!root) return; // Not on this page

  const gate = document.getElementById('devGate');
  const gateForm = document.getElementById('devGateForm');
  const gateInput = document.getElementById('devGatePassword');
  const gateError = document.getElementById('devGateError');
  const content = document.getElementById('devContent');

  function isUnlocked() {
    return localStorage.getItem(DEV_UNLOCK_KEY) === '1';
  }

  function showUnlocked() {
    gate.classList.add('hidden');
    content.classList.remove('hidden');
    refreshChips();
    refreshCollectionProgress();
    renderSession();
  }

  function showLocked() {
    gate.classList.remove('hidden');
    content.classList.add('hidden');
  }

  // ---- Gate -----------------------------------------------------------

  gateForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const configured = siteConfig.dev?.password;
    if (!configured || configured === 'CHANGE-ME') {
      gateError.textContent = '⚠️ Nog geen wachtwoord ingesteld — zie siteConfig.dev.password in assets/js/config.js.';
      return;
    }
    if (gateInput.value === configured) {
      localStorage.setItem(DEV_UNLOCK_KEY, '1');
      gateError.textContent = '';
      gateInput.value = '';
      showUnlocked();
    } else {
      gateError.textContent = 'Onjuist wachtwoord.';
      gateInput.select();
    }
  });

  document.getElementById('devLockBtn')?.addEventListener('click', () => {
    localStorage.removeItem(DEV_UNLOCK_KEY);
    showLocked();
  });

  // NOTE: the initial isUnlocked() check that calls showUnlocked()/
  // showLocked() runs at the very end of this function (see bottom),
  // not here — showUnlocked() reaches into the Chips/Collecties/etc.
  // sections' `const`s further down, which don't exist yet at this
  // point in the module's execution (a plain ReferenceError, not
  // hoisting-related — function declarations ARE hoisted, but the
  // `const`s a hoisted function reads are still only initialized when
  // execution actually reaches their own declaration line).

  // ---- Chips ------------------------------------------------------------

  const chipsWorkerUrl = siteConfig.blackjack?.workerUrl; // same shared chips Worker as blackjack/spiderette
  function chipsWorkerConfigured() {
    return Boolean(chipsWorkerUrl) && !chipsWorkerUrl.includes('YOUR-SUBDOMAIN');
  }

  const chipsLoggedOutEl = document.getElementById('devChipsLoggedOut');
  const chipsLoggedInEl = document.getElementById('devChipsLoggedIn');
  const chipsWhoEl = document.getElementById('devChipsWho');
  const chipsCurrentEl = document.getElementById('devChipsCurrent');
  const chipsInput = document.getElementById('devChipsInput');
  const chipsForm = document.getElementById('devChipsForm');
  const chipsStatus = document.getElementById('devChipsStatus');

  async function refreshChips() {
    if (!isUnlocked()) return;
    const auth = getAuth();
    if (!auth) {
      chipsLoggedOutEl.classList.remove('hidden');
      chipsLoggedInEl.classList.add('hidden');
      return;
    }
    chipsLoggedOutEl.classList.add('hidden');
    chipsLoggedInEl.classList.remove('hidden');
    chipsWhoEl.textContent = currentPersonLabel();

    if (!chipsWorkerConfigured()) {
      chipsStatus.textContent = '⚠️ Chips-worker nog niet gekoppeld (zie siteConfig.blackjack.workerUrl).';
      return;
    }
    try {
      const response = await fetch(`${chipsWorkerUrl}/chips`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      chipsCurrentEl.textContent = data.chips;
      chipsInput.value = data.chips;
      chipsStatus.textContent = '';
    } catch (error) {
      console.error('Kon chips niet laden:', error);
      chipsStatus.textContent = `❌ Kon chips niet laden${error.message ? ` (${error.message})` : ''}.`;
    }
  }

  chipsForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const auth = getAuth();
    if (!auth || !chipsWorkerConfigured()) return;
    const value = Math.round(Number(chipsInput.value));
    if (!Number.isFinite(value) || value < 0) {
      chipsStatus.textContent = 'Vul een geldig aantal chips in (0 of hoger).';
      return;
    }
    chipsStatus.textContent = 'Opslaan…';
    try {
      const response = await fetch(`${chipsWorkerUrl}/chips`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
        body: JSON.stringify({ chips: value }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      chipsCurrentEl.textContent = data.chips;
      chipsStatus.textContent = '✅ Opgeslagen.';
    } catch (error) {
      console.error('Kon chips niet opslaan:', error);
      chipsStatus.textContent = `❌ ${error.message || 'Opslaan mislukt.'}`;
    }
  });

  onAuthChange(() => { refreshChips(); renderSession(); });

  // ---- Collecties ---------------------------------------------------------

  const collectionSelect = document.getElementById('devCollectionSelect');
  const personSelect = document.getElementById('devPersonSelect');
  const countInput = document.getElementById('devCountInput');
  const countForm = document.getElementById('devCountForm');
  const countStatus = document.getElementById('devCountStatus');
  const progressLabel = document.getElementById('devCollectionProgress');
  const resetItemsBtn = document.getElementById('devResetItemsBtn');
  const resetRewardsBtn = document.getElementById('devResetRewardsBtn');

  function populateCollectionSelect() {
    const collections = getCollections();
    collectionSelect.innerHTML = collections
      .map((c) => `<option value="${escapeHtml(c.id)}">${c.emoji ? `${escapeHtml(c.emoji)} ` : ''}${escapeHtml(c.name)}</option>`)
      .join('');
  }

  function refreshCollectionProgress() {
    if (!isUnlocked()) return;
    const collectionId = collectionSelect.value;
    const who = personSelect.value;
    const collection = getCollection(collectionId);
    if (!collection || !who) { progressLabel.textContent = ''; return; }
    const state = getCollectionState(who, collectionId);
    progressLabel.textContent = `${personLabel(who)}: ${state.collectedCount} / ${collection.items.length} verzameld.`;
    countInput.value = state.collectedCount;
    countInput.max = collection.items.length;
    countStatus.textContent = '';
  }

  populateCollectionSelect();

  collectionSelect.addEventListener('change', refreshCollectionProgress);
  personSelect.addEventListener('change', refreshCollectionProgress);

  countForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const collectionId = collectionSelect.value;
    const who = personSelect.value;
    const result = setCollectedCount(who, collectionId, countInput.value);
    if (result === null) {
      countStatus.textContent = '❌ Kon dit niet instellen.';
      return;
    }
    countStatus.textContent = `✅ Ingesteld op ${result}.`;
    refreshCollectionProgress();
  });

  resetItemsBtn?.addEventListener('click', () => {
    const collectionId = collectionSelect.value;
    const who = personSelect.value;
    const collection = getCollection(collectionId);
    if (!collection || !who) return;
    if (!confirm(`Items van "${collection.name}" voor ${personLabel(who)} resetten naar 0? Dit kan niet ongedaan worden gemaakt.`)) return;
    resetCollectionProgress(who, collectionId);
    countStatus.textContent = '✅ Items gereset.';
    refreshCollectionProgress();
  });

  resetRewardsBtn?.addEventListener('click', () => {
    const collectionId = collectionSelect.value;
    const who = personSelect.value;
    const collection = getCollection(collectionId);
    if (!collection || !who) return;
    if (!confirm(`Alle beloningen van "${collection.name}" voor ${personLabel(who)} resetten? Gekozen cadeaus en ontgrendelingen gaan verloren — dit kan niet ongedaan worden gemaakt.`)) return;
    resetCollectionRewards(who, collectionId);
    countStatus.textContent = '✅ Beloningen gereset.';
  });

  // ---- Studie Timer ---------------------------------------------------------

  const timerPersonSelect = document.getElementById('devTimerPersonSelect');
  const timerResetBtn = document.getElementById('devTimerResetBtn');
  const timerStatus = document.getElementById('devTimerStatus');

  timerResetBtn?.addEventListener('click', () => {
    const who = timerPersonSelect.value;
    if (!who) return;
    if (!confirm(`De hele Studie Timer van ${personLabel(who)} resetten (presets, groei, voltooide bomen, alles)? Dit kan niet ongedaan worden gemaakt.`)) return;
    resetStudyTimerState(who);
    timerStatus.textContent = '✅ Studie Timer gereset.';
  });

  // ---- Site-sessie ---------------------------------------------------------

  const sessionStatusEl = document.getElementById('devSessionStatus');
  const sessionLogoutBtn = document.getElementById('devSessionLogoutBtn');

  function renderSession() {
    const auth = getAuth();
    sessionStatusEl.textContent = auth ? `Ingelogd als ${currentPersonLabel()}.` : 'Niet ingelogd.';
    sessionLogoutBtn.classList.toggle('hidden', !auth);
  }

  sessionLogoutBtn?.addEventListener('click', () => {
    siteLogout();
  });

  renderSession();

  // ---- Alles wissen ---------------------------------------------------------

  document.getElementById('devWipeAllBtn')?.addEventListener('click', () => {
    if (!confirm('ALLE lokale gegevens van deze site in deze browser wissen (collecties, beloningen, Studie Timer, favorieten, instellingen, sessies — alles)? Dit kan niet ongedaan worden gemaakt.')) return;
    localStorage.clear();
    location.reload();
  });

  // Everything above is set up now — safe to do the initial render.
  if (isUnlocked()) showUnlocked(); else showLocked();
}
