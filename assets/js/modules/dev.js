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

  // ---- AH-recepten: alles in één keer ophalen -------------------------------
  // ÉÉN knop. Stap 1: een proefaanvraag via de Worker (live=1). Lukt dat, dan
  // loopt hij langs elke categorie + subcategorie uit config.js (ahRecipes) en
  // laat de Worker alles bij AH ophalen en als backup bewaren (rustig tempo;
  // mislukt iets, dan blijft de oude backup staan).
  // Stap 2, als AH de Worker blokkeert (meestal): het stappenplan hieronder
  // verschijnt. Je draait tools/ah-browser-export.js eenmalig op ah.nl in je
  // eigen browser (die wordt niet geblokkeerd), dat slaat een bestand op, en dit
  // scherm stuurt dat bestand in kleine stukjes naar de Worker (POST /import).
  const AH_PAGES_PER_LIST = 2;
  const AH_DELAY_MS = 2500;
  const AH_GIVE_UP_AFTER_FAILURES = 4; // vier mislukte pogingen achter elkaar = waarschijnlijk geblokkeerd

  const ahSyncBtn = document.getElementById('devAhSyncBtn');
  const ahStopBtn = document.getElementById('devAhSyncStopBtn');
  const ahProgress = document.getElementById('devAhSyncProgress');
  const ahStatus = document.getElementById('devAhSyncStatus');
  const ahBrowserBox = document.getElementById('devAhBrowserBox');
  const ahCopyBtn = document.getElementById('devAhCopyBtn');
  const ahCopyMsg = document.getElementById('devAhCopyMsg');
  const ahImportFile = document.getElementById('devAhImportFile');
  const ahScriptText = document.getElementById('devAhScriptText');
  const AH_IMPORT_DELAY_MS = 2300;            // de Worker staat 30 aanvragen per minuut toe
  const AH_IMPORT_PROGRESS_KEY = 'ahImportDoneV1'; // welke stukjes van welk bestand al binnen zijn
  const AH_DETAIL_BUCKETS = 48;
  const AH_MAX_PACK_BYTES = 650 * 1024;
  let ahStop = false;
  let ahRunning = false;

  function ahLists() {
    const lists = [];
    (siteConfig.ahRecipes?.categories || []).forEach((cat) => {
      lists.push({ label: cat.label, type: cat.type, query: '' });
      (cat.subcategories || []).forEach((sub) => lists.push({ label: `${cat.label} · ${sub.label}`, type: cat.type, query: sub.query }));
    });
    return lists;
  }

  // "Laatst opgehaald van AH.nl": komt uit de opgeslagen lijst (backupSavedAt). Staat alleen hier, niet op de AH-pagina zelf.
  const ahLastSavedEl = document.getElementById('devAhLastSaved');
  async function refreshAhLastSaved() {
    if (!ahLastSavedEl) return;
    const workerUrl = siteConfig.ahRecipes?.workerUrl || '';
    if (!workerUrl || workerUrl.includes('YOUR-SUBDOMAIN')) {
      ahLastSavedEl.textContent = '';
      return;
    }
    try {
      const first = (siteConfig.ahRecipes?.categories || [])[0];
      const params = new URLSearchParams({ page: '0' });
      if (first) params.set('type', first.type);
      const response = await fetch(`${workerUrl}/recipes?${params.toString()}`);
      const data = await response.json().catch(() => ({}));
      const when = data && data.backupSavedAt ? new Date(data.backupSavedAt) : null;
      ahLastSavedEl.textContent = when && !Number.isNaN(when.getTime())
        ? `Laatst opgehaald van AH.nl: ${when.toLocaleString('nl-NL', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}.`
        : 'Nog niets opgehaald van AH.nl.';
    } catch {
      ahLastSavedEl.textContent = '';
    }
  }

  async function ahFetchLive(workerUrl, list, page) {
    const params = new URLSearchParams({ page: String(page), type: list.type });
    if (list.query) params.set('query', list.query);
    params.set('live', '1');
    const response = await fetch(`${workerUrl}/recipes?${params.toString()}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    if (data.liveFailed) throw new Error(data.liveError || 'AH gaf geen nieuwe lijst');
    return data;
  }

  // KEEP IDENTICAL to detailBucket() in cloudflare/ah-recepten/ah_recepten_worker.js:
  // decides in which stored "pack" a recipe's details live.
  function detailBucket(id) {
    const digits = String(id).replace(/\D/g, '');
    const n = digits ? parseInt(digits.slice(-9), 10) : Array.from(String(id)).reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
    return n % AH_DETAIL_BUCKETS;
  }

  const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Tekst van het script voor in de console: de lijsten uit config.js + tools/ah-browser-export.js
  async function buildAhScript() {
    const source = await fetch(new URL('../../../tools/ah-browser-export.js', import.meta.url)).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    });
    const lists = ahLists().map(({ label, type, query }) => ({ label, type, query }));
    return `window.__AH_LISTS = ${JSON.stringify(lists)};\n${source}`;
  }

  async function showAhBrowserBox(reason) {
    ahBrowserBox.classList.remove('hidden');
    if (reason) ahStatus.textContent = reason;
    try {
      ahScriptText.value = await buildAhScript();
    } catch (error) {
      ahScriptText.value = '';
      ahCopyMsg.textContent = `⚠️ Kon het script niet laden (${error.message}).`;
    }
  }

  ahCopyBtn?.addEventListener('click', async () => {
    if (!ahScriptText.value) await showAhBrowserBox();
    if (!ahScriptText.value) return;
    try {
      await navigator.clipboard.writeText(ahScriptText.value);
      ahCopyMsg.textContent = '✅ Gekopieerd. Ga naar stap 2.';
    } catch {
      ahScriptText.closest('details').open = true;
      ahScriptText.select();
      ahCopyMsg.textContent = 'Selecteer het script hieronder en kopieer met Ctrl+C.';
    }
  });

  function readImportProgress(exportedAt) {
    try {
      const saved = JSON.parse(localStorage.getItem(AH_IMPORT_PROGRESS_KEY) || 'null');
      if (saved && saved.exportedAt === exportedAt && Array.isArray(saved.done)) return new Set(saved.done);
    } catch { /* ignore */ }
    return new Set();
  }

  function writeImportProgress(exportedAt, done) {
    try { localStorage.setItem(AH_IMPORT_PROGRESS_KEY, JSON.stringify({ exportedAt, done: Array.from(done) })); } catch { /* ignore */ }
  }

  // Stuurt het export-bestand in kleine stukjes naar de Worker: één bericht per
  // lijst-pagina en één per "pakket" recepten (= precies één KV-schrijfactie elk).
  async function importAhFile(file) {
    const workerUrl = siteConfig.ahRecipes?.workerUrl || '';
    if (!workerUrl || workerUrl.includes('YOUR-SUBDOMAIN')) {
      ahStatus.textContent = '⚠️ Nog geen AH-recepten-Worker ingesteld in config.js.';
      return;
    }
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      ahStatus.textContent = '⚠️ Dat bestand is geen geldige JSON. Kies ah-recepten-export.json.';
      return;
    }
    if (!data || data.app !== 'kalininiels-ah-export' || !Array.isArray(data.lists) || typeof data.details !== 'object') {
      ahStatus.textContent = '⚠️ Dit is niet het export-bestand van het AH-script.';
      return;
    }

    // Stukjes: eerst alle lijsten, dan de recept-pakketten.
    const units = data.lists.map((l) => ({ key: `L|${l.type}|${l.query}|${l.page}`, body: { kind: 'list', type: l.type, query: l.query, page: l.page, payload: l.payload }, recipes: (l.payload?.recipes || []).length, isList: true }));
    const buckets = new Map();
    Object.entries(data.details || {}).forEach(([id, detail]) => {
      const b = detailBucket(id);
      if (!buckets.has(b)) buckets.set(b, {});
      buckets.get(b)[id] = detail;
    });
    let trimmed = 0;
    Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]).forEach(([bucket, items]) => {
      let ids = Object.keys(items);
      let size = JSON.stringify(items).length;
      while (size > AH_MAX_PACK_BYTES && ids.length > 1) { // te groot voor één opslag-stap: laatste recepten laten vallen
        delete items[ids.pop()];
        trimmed += 1;
        size = JSON.stringify(items).length;
      }
      units.push({ key: `D|${bucket}`, body: { kind: 'details', bucket, items }, recipes: Object.keys(items).length, isList: false });
    });

    const done = readImportProgress(data.exportedAt);
    const todo = units.filter((u) => !done.has(u.key));
    if (todo.length === 0) {
      ahStatus.textContent = '✅ Dit bestand is al volledig geïmporteerd.';
      return;
    }
    const minutes = Math.ceil((todo.length * AH_IMPORT_DELAY_MS) / 60000);
    if (!confirm(`${todo.length} stukjes importeren (${units.filter((u) => u.isList).length} lijst-pagina's, ${buckets.size} recept-pakketten, ${Object.keys(data.details || {}).length} recepten)? Dit duurt ± ${minutes} minuten. Laat dit tabblad open staan.`)) return;

    ahRunning = true;
    ahStop = false;
    ahSyncBtn.disabled = true;
    ahStopBtn.disabled = false;
    ahStopBtn.classList.remove('hidden');
    ahProgress.classList.remove('hidden');
    ahProgress.max = todo.length;
    ahProgress.value = 0;

    let okLists = 0;
    let okRecipes = 0;
    let failures = 0;
    let consecutive = 0;
    let stopReason = '';

    for (let i = 0; i < todo.length && !ahStop && !stopReason; i += 1) {
      const unit = todo[i];
      ahStatus.textContent = `Importeren… ${i + 1} van ${todo.length}`;
      let attempt = 0;
      for (;;) {
        attempt += 1;
        let response;
        let reply = {};
        try {
          response = await fetch(`${workerUrl}/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(unit.body) });
          reply = await response.json().catch(() => ({}));
        } catch (error) {
          reply = { error: error.message };
        }
        if (response && response.ok) {
          done.add(unit.key);
          writeImportProgress(data.exportedAt, done);
          if (unit.isList) okLists += 1; else okRecipes += unit.recipes;
          consecutive = 0;
          break;
        }
        if (response && response.status === 429 && /Daglimiet/i.test(reply.error || '')) {
          stopReason = 'De daglimiet van de Worker is bereikt. Kies morgen hetzelfde bestand opnieuw: het gaat verder waar het bleef.';
          break;
        }
        if (response && response.status === 429 && attempt <= 3) {
          ahStatus.textContent = `Importeren… even wachten (te veel aanvragen per minuut), ${i + 1} van ${todo.length}`;
          await sleepMs(65000);
          continue;
        }
        failures += 1;
        consecutive += 1;
        if (consecutive >= 5) stopReason = `Vijf keer achter elkaar mislukt (${reply.error || 'onbekende fout'}).`;
        break;
      }
      ahProgress.value = i + 1;
      await sleepMs(AH_IMPORT_DELAY_MS);
    }

    const summary = `${okLists} lijst-pagina's en ${okRecipes} recepten opgeslagen${failures ? `, ${failures} stukje(s) mislukt` : ''}${trimmed ? `, ${trimmed} recepten te groot voor opslag en overgeslagen` : ''}.`;
    if (stopReason) ahStatus.textContent = `⚠️ Gestopt: ${stopReason} ${summary}`;
    else if (ahStop) ahStatus.textContent = `⏹️ Gestopt (wat al binnen is blijft staan; kies het bestand later opnieuw om verder te gaan). ${summary}`;
    else ahStatus.textContent = `✅ Klaar. ${summary} Open nu de AH-Recepten pagina.`;

    ahRunning = false;
    ahSyncBtn.disabled = false;
    ahStopBtn.classList.add('hidden');
    ahProgress.classList.add('hidden');
    refreshAhLastSaved();
  }

  refreshAhLastSaved();

  ahImportFile?.addEventListener('change', async () => {
    const file = ahImportFile.files?.[0];
    if (!file || ahRunning) return;
    await importAhFile(file);
    ahImportFile.value = '';
  });

  ahStopBtn?.addEventListener('click', () => { ahStop = true; ahStopBtn.disabled = true; });

  ahSyncBtn?.addEventListener('click', async () => {
    if (ahRunning) return;
    const workerUrl = siteConfig.ahRecipes?.workerUrl || '';
    if (!workerUrl || workerUrl.includes('YOUR-SUBDOMAIN')) {
      ahStatus.textContent = '⚠️ Nog geen AH-recepten-Worker ingesteld in config.js.';
      return;
    }
    const lists = ahLists();
    if (!confirm(`Nu alle ${lists.length} lijsten bij AH.nl ophalen? Eerst probeer ik het rechtstreeks (± ${Math.ceil((lists.length * 1.6 * AH_DELAY_MS) / 60000)} minuten). Blokkeert AH dat, dan krijg je een stappenplan om het één keer in je eigen browser te doen.`)) return;

    // Proefaanvraag: werkt de Worker bij AH? Zo niet, dan meteen het stappenplan.
    ahStatus.textContent = 'Proefaanvraag bij AH…';
    ahSyncBtn.disabled = true;
    try {
      await ahFetchLive(workerUrl, lists[0], 0);
    } catch (error) {
      ahSyncBtn.disabled = false;
      await showAhBrowserBox(`AH laat de server niet binnen (${error.message}). Dat verwachtten we al; volg het stappenplan hieronder, het is eenmalig.`);
      return;
    }

    ahRunning = true;
    ahStop = false;
    ahStopBtn.disabled = false;
    ahSyncBtn.disabled = true;
    ahStopBtn.classList.remove('hidden');
    ahProgress.classList.remove('hidden');
    ahProgress.max = lists.length;
    ahProgress.value = 0;

    let saved = 0;
    let failedLists = 0;
    let recipeCount = 0;
    let consecutiveFailures = 0;
    let gaveUpBecause = '';

    for (let i = 0; i < lists.length && !ahStop && !gaveUpBecause; i += 1) {
      const list = lists[i];
      ahStatus.textContent = `Bezig… ${i + 1} van ${lists.length}: ${list.label}`;
      let pages = AH_PAGES_PER_LIST;
      let listOk = false;
      for (let page = 0; page < pages && !ahStop; page += 1) {
        try {
          const data = await ahFetchLive(workerUrl, list, page);
          const got = Array.isArray(data.recipes) ? data.recipes.length : 0;
          if (got === 0) break; // geen verdere pagina's
          saved += 1;
          recipeCount += got;
          listOk = true;
          consecutiveFailures = 0;
          // Zijn er volgens AH minder recepten dan 2 pagina's, dan is 1 pagina genoeg.
          if (page === 0 && data.count && data.count <= got) pages = 1;
        } catch (error) {
          consecutiveFailures += 1;
          if (/Daglimiet/i.test(error.message)) gaveUpBecause = 'De daglimiet van de Worker is bereikt. Probeer het morgen verder.';
          else if (consecutiveFailures >= AH_GIVE_UP_AFTER_FAILURES) gaveUpBecause = `AH reageert niet meer (${error.message}). Wat al opgeslagen was blijft staan.`;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, AH_DELAY_MS));
      }
      if (!listOk && !gaveUpBecause) failedLists += 1;
      ahProgress.value = i + 1;
      await new Promise((resolve) => setTimeout(resolve, AH_DELAY_MS));
    }

    const summary = `${saved} pagina's opgeslagen (${recipeCount} recepten)${failedLists ? `, ${failedLists} lijst(en) overgeslagen/mislukt` : ''}.`;
    if (gaveUpBecause) ahStatus.textContent = `⚠️ Gestopt: ${gaveUpBecause} ${summary}`;
    else if (ahStop) ahStatus.textContent = `⏹️ Gestopt. ${summary}`;
    else ahStatus.textContent = `✅ Klaar. ${summary} Open nu de AH-Recepten pagina.`;

    ahRunning = false;
    ahSyncBtn.disabled = false;
    ahStopBtn.classList.add('hidden');
    ahProgress.classList.add('hidden');
    refreshAhLastSaved();
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

  // ---- Cadeaus-cache wissen ---------------------------------------------------
  // Only sets a timestamp: gifts.js adds it to every image/meta request, which makes the browser's
  // and the Worker's cached answers unreachable (new address = fresh lookup). Nothing is deleted.
  document.getElementById('devGiftsCacheBtn')?.addEventListener('click', async () => {
    const status = document.getElementById('devGiftsCacheStatus');
    try {
      localStorage.setItem('giftsCacheBustV1', String(Date.now()));
      if (window.caches && caches.keys) {
        const names = await caches.keys();
        await Promise.all(names.map((name) => caches.delete(name)));
      }
      if (status) status.textContent = '✅ Cache gewist. Open de cadeaus-pagina (of ververs hem); alles wordt opnieuw opgehaald.';
    } catch {
      if (status) status.textContent = '❌ Kon de cache niet wissen (opslag niet beschikbaar in deze browser).';
    }
  });

  // ---- Alles wissen ---------------------------------------------------------

  document.getElementById('devWipeAllBtn')?.addEventListener('click', () => {
    if (!confirm('ALLE lokale gegevens van deze site in deze browser wissen (collecties, beloningen, Studie Timer, favorieten, instellingen, sessies — alles)? Dit kan niet ongedaan worden gemaakt.')) return;
    localStorage.clear();
    location.reload();
  });

  // Everything above is set up now — safe to do the initial render.
  if (isUnlocked()) showUnlocked(); else showLocked();
}
