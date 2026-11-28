// =================================================================
// AH-RECEPTEN (ah-recepten.html)
// -----------------------------------------------------------------
// Browses Albert Heijn / Allerhande recipes by "soort gerecht" through
// the Cloudflare Worker configured as siteConfig.ahRecipes.workerUrl
// (see cloudflare/ah-recepten/ + ACTION-EXPANSION-PLAN.md). There is
// no official AH recipe API — the Worker reads the same public
// ah.nl/allerhande pages a browser would, with a fallback to AH's own
// (unofficial, reverse-engineered) mobile-app API when ah.nl itself
// blocks the request; see that Worker's file header for exactly how,
// and for what "fallbackUsed" in a response means (a curated category
// slug didn't match AH's own, so it fell back to a plain keyword
// search instead of showing nothing).
//
// This is a SEPARATE page + Worker from recepten.html — that one now
// reads TheMealDB (English, ah.nl blocks Cloudflare's IP range for
// plain HTML scraping too often to rely on it alone). This page is
// the "exactly like before" AH version, kept alongside it.
//
// THREE "TABS" (siteConfig.ahRecipes.categories drives the food ones):
//   - one per configured category (Pasta, Rijst, Taco's, Wrap's, ...),
//     each with its own optional subcategory chips ("Alles" + a few
//     curated keywords, e.g. Pasta -> Kip/Vegetarisch/Romig)
//   - "Zoeken": free text across all of Allerhande, no category filter
//   - "Favorieten": a shared, synced list of saved recipes (its own
//     small KV list on the SAME Worker, same "read it all, write it
//     all back" pattern as ticketmaster_favorite-artists) — no AH
//     re-fetch needed for the grid, only when a card is opened.
// The free-text search box is always available and doubles as an
// extra keyword refinement ON TOP of a category+subcategory (e.g.
// "Pasta" + "Kip" + "pittig"), not just the Zoeken tab's main input.
//
// SERVINGS / SCALING: siteConfig has no servings setting — it's a
// personal, per-browser preference (see SERVINGS_STORAGE_KEY),
// exactly like theme.js's dark-mode toggle. The toolbar's "aantal
// personen" input is only ever a DEFAULT that pre-fills the modal's
// own stepper when a recipe is opened; the modal's stepper can then
// be adjusted per recipe without changing that default. Scaling
// itself (ratio = gewenst aantal / AH's eigen aantal) happens
// entirely client-side in renderScaledIngredients() — the Worker
// already sends each ingredient pre-split into a scalable `quantity`
// (or null, for things like "snufje zout" that don't have one) and
// the rest of the line as free text.
//
// DETAIL FETCH ON CLICK: the listing/search/favorites grid only ever
// shows image + name + category (cheap to scrape, always available).
// Ingredients + bereidingswijze are fetched fresh from AH only once
// a card is actually opened — see openRecipeDetail(). If that fetch
// fails (AH changed something, or the page briefly doesn't respond),
// the modal still offers a direct "Bekijk op AH.nl" link rather than
// a dead end.
//
// BACKUP, NOT AUTO-REFRESH: this page never goes to ah.nl by itself and
// has no retrieve button. What you see is the BACKUP — the last
// successful retrieval of exactly that list (kept in the Worker's KV, so
// both people see the same one, and in localStorage on this device as a
// fallback). The backups are filled by ONE button on dev.html ("Alles
// ophalen van AH.nl"), which walks over every category and subcategory.
// If AH blocks the Worker, nothing here changes: the backup stays.
// All stored pages are shown at once (no "Meer laden"). Opening a
// recipe uses its own backup too: only the very first time a recipe is
// opened does the Worker fetch its details from AH (and keeps them).
// See ah_recepten_worker.js for the other half.
// =================================================================

import { siteConfig } from '../config.js';
import { qs, qsa, escapeHtml, debounce, preventNumberInputScroll } from './utils.js';
import { setupRecipeToList } from './recipe-to-list.js';

const SERVINGS_STORAGE_KEY = 'ah-recepten-personen';
const MIN_SERVINGS = 1;
const MAX_SERVINGS = 20;

// Common fractions AH itself uses when it displays a scaled amount
// (e.g. "1½ el") — used to make our own scaled amounts look the same
// instead of ugly repeating decimals.
const FRACTION_GLYPHS = [
  [0.25, '¼'],
  [1 / 3, '⅓'],
  [0.5, '½'],
  [2 / 3, '⅔'],
  [0.75, '¾'],
];

function clampServings(value) {
  const n = Number.isFinite(value) ? Math.round(value) : 4;
  return Math.min(MAX_SERVINGS, Math.max(MIN_SERVINGS, n));
}

function loadDefaultServings() {
  const stored = parseInt(localStorage.getItem(SERVINGS_STORAGE_KEY), 10);
  return Number.isFinite(stored) ? clampServings(stored) : 4;
}

function saveDefaultServings(value) {
  localStorage.setItem(SERVINGS_STORAGE_KEY, String(value));
}

// Formats a scaled ingredient amount the way AH itself would (nice
// fractions instead of long decimals), e.g. 1.5 -> "1½", 0.333 -> "⅓".
function formatQuantity(n) {
  if (n == null || !Number.isFinite(n)) return '';
  const rounded = Math.round(n * 100) / 100;
  const whole = Math.floor(rounded + 1e-9);
  const frac = rounded - whole;

  if (Math.abs(frac) < 0.06) return String(whole);

  for (const [value, glyph] of FRACTION_GLYPHS) {
    if (Math.abs(frac - value) < 0.06) {
      return whole > 0 ? `${whole}${glyph}` : glyph;
    }
  }

  return rounded.toFixed(2).replace(/0$/, '').replace(/\.$/, '').replace('.', ',');
}

// ---- Client-side backup (localStorage) ------------------------------
// The device's own copy of the last successful retrieval. NO expiry: it is
// only replaced by a newer successful retrieval (so it also keeps working
// when AH blocks the Worker, or the Worker itself is unreachable).
// Only used for AH-scraped data (recipe lists + recipe detail) — favorites
// are live shared user data and always fetched fresh.
const BACKUP_PREFIX = 'ah-recepten-backup-v1:';
// Older automatic-cache formats: ignored and removed by pruneOldCaches().
const LEGACY_CACHE_PREFIXES = ['recepten-cache:', 'ah-recepten-cache-v1:'];

function readBackup(key) {
  try {
    const raw = localStorage.getItem(BACKUP_PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    return entry && entry.payload ? entry : null;
  } catch {
    return null; // private browsing / storage disabled / corrupted entry — just skip it
  }
}

function writeBackup(key, payload, savedAt) {
  try {
    localStorage.setItem(BACKUP_PREFIX + key, JSON.stringify({ savedAt: savedAt || Date.now(), payload }));
  } catch {
    // storage full or unavailable — the Worker's own backup still exists
  }
}

// Removes the old auto-expiring cache entries (once per page load).
function pruneOldCaches() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key && LEGACY_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix))) localStorage.removeItem(key);
    }
  } catch {
    // purely housekeeping, never worth failing the page over
  }
}

// Text from AH sometimes arrives with HTML entities ("&#x27;Soto ayam&#x27;").
// Decoded here, once, for every list/detail that comes in (Worker or this
// device's own backup), so older stored data is shown correctly too.
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€', eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', agrave: 'à', aacute: 'á', acirc: 'â', auml: 'ä', iuml: 'ï', icirc: 'î', ouml: 'ö', ocirc: 'ô', uuml: 'ü', ucirc: 'û', ccedil: 'ç', ntilde: 'ñ', deg: '°', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', frac12: '½', frac14: '¼', frac34: '¾', times: '×' };

export function decodeEntities(text) {
  return String(text).replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z][a-z0-9]*));/gi, (whole, hex, dec, name) => {
    if (hex || dec) {
      const code = hex ? parseInt(hex, 16) : parseInt(dec, 10);
      try {
        return code === 160 ? ' ' : String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    const known = NAMED_ENTITIES[name] ?? NAMED_ENTITIES[name.toLowerCase()];
    return known === undefined ? whole : known;
  });
}

function decodeDeep(value) {
  if (typeof value === 'string') return value.includes('&') ? decodeEntities(value) : value;
  if (Array.isArray(value)) return value.map(decodeDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, inner] of Object.entries(value)) out[key] = decodeDeep(inner);
    return out;
  }
  return value;
}

async function requestJson(url) {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data.error || `HTTP ${response.status}`);
    err.sourceUrl = data.sourceUrl;
    throw err;
  }
  return decodeDeep(data);
}

// GET /recipes: the stored backup of one list — never AH itself. The Worker's
// copy (shared by both people) first, else this device's own, else an empty
// `noBackup` answer. `hasMore` = the next page is stored too.
async function fetchRecipeList(workerUrl, params) {
  const key = `list:${params.toString()}`;
  const local = readBackup(key);

  const nextParams = new URLSearchParams(params);
  nextParams.set('page', String((Number(params.get('page')) || 0) + 1));
  const localHasMore = () => {
    const next = readBackup(`list:${nextParams.toString()}`);
    return Boolean(next && Array.isArray(next.payload.recipes) && next.payload.recipes.length);
  };
  const fromLocal = () => decodeDeep({ ...local.payload, fromBackup: true, backupSavedAt: local.savedAt, source: 'local', hasMore: localHasMore() });

  try {
    const data = await requestJson(`${workerUrl}/recipes?${params.toString()}`);
    if (Array.isArray(data.recipes) && data.recipes.length > 0) {
      writeBackup(key, data, data.backupSavedAt);
      return data;
    }
    return local ? fromLocal() : data; // Worker has nothing stored (yet) -> this device's copy, if any
  } catch (error) {
    if (local) return fromLocal();
    throw error;
  }
}

// GET /recipe (one recipe's full detail). This device's backup first (no
// request at all), then the Worker (its backup, or — first time ever — AH).
async function fetchRecipeDetailData(workerUrl, path) {
  const key = `detail:${path}`;
  const local = readBackup(key);
  if (local) return decodeDeep(local.payload);

  const data = await requestJson(`${workerUrl}/recipe?url=${encodeURIComponent(path)}`);
  writeBackup(key, data);
  return data;
}

// ---- Zoeken in de opgeslagen lijsten --------------------------------
// De backups zijn per exacte selectie bewaard (categorie [+ subcategorie]),
// dus een vrije zoekterm als "kip" bestaat daar nooit als eigen lijst. Daarom
// wordt er bij een zoekterm NIET naar een (niet bestaande) opgeslagen lijst
// gevraagd, maar worden alle relevante opgeslagen lijsten samengevoegd en
// hier in de browser op woorden doorzocht.

const SEARCH_MAX_PAGES = 12;

// Zelfde volgorde van parameters als buildParams() (de backup-sleutel is de
// letterlijke querystring, dus de volgorde moet kloppen).
function listParams(type, query, page) {
  const params = new URLSearchParams({ page: String(page) });
  if (type) params.set('type', type);
  if (query) params.set('query', query);
  return params;
}

// Alle pagina's van één opgeslagen lijst. Eerst de kopie op dit apparaat
// (geen netwerk), anders de Worker.
async function loadWholeStoredList(workerUrl, type, query) {
  const recipes = [];
  for (let page = 0; page < SEARCH_MAX_PAGES; page += 1) {
    const params = listParams(type, query, page);
    const local = readBackup(`list:${params.toString()}`);
    let data;
    if (local && Array.isArray(local.payload.recipes) && local.payload.recipes.length) {
      const next = readBackup(`list:${listParams(type, query, page + 1).toString()}`);
      data = decodeDeep({ ...local.payload, hasMore: Boolean(next && next.payload.recipes?.length) });
    } else {
      try {
        data = await fetchRecipeList(workerUrl, params);
      } catch {
        break;
      }
    }
    const batch = Array.isArray(data.recipes) ? data.recipes : [];
    if (batch.length === 0) break;
    recipes.push(...batch);
    if (!data.hasMore) break;
  }
  return recipes;
}

function normalizeText(value) {
  return String(value ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function numberOf(value) {
  const n = parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function initAhRecepten() {
  // See the comment on <section id="ahReceptenApp"> in ah-recepten.html
  // for why this must NOT be 'receptenApp' (recepten.js's own root id).
  const root = document.getElementById('ahReceptenApp');
  if (!root) return; // not on this page

  const workerUrl = siteConfig.ahRecipes?.workerUrl || '';
  const categories = siteConfig.ahRecipes?.categories || [];

  const configWarning = qs('#reptConfigWarning', root);
  const mainEl = qs('#reptMain', root);

  function workerConfigured() {
    return workerUrl && !workerUrl.includes('YOUR-SUBDOMAIN');
  }

  if (!workerConfigured()) {
    configWarning.classList.remove('hidden');
    mainEl.classList.add('hidden');
    return;
  }

  const tabsEl = qs('#reptCategoryTabs', root);
  const subcatsEl = qs('#reptSubcategoryRow', root);
  const searchRowEl = qs('#reptSearchRow', root);
  const searchInput = qs('#reptSearchInput', root);
  const searchBtn = qs('#reptSearchBtn', root);
  const servingsInput = qs('#reptServingsInput', root);
  const statusEl = qs('#reptStatus', root);
  const resultsEl = qs('#reptResults', root);
  const sortRowEl = qs('#reptSortRow', root);
  const sortSelect = qs('#reptSortSelect', root);
  const filterFastBtn = qs('#reptFilterFast', root);
  const filterLightBtn = qs('#reptFilterLight', root);

  const modalOverlay = document.getElementById('reptModalOverlay');
  const modalClose = document.getElementById('reptModalClose');
  const modalLoading = document.getElementById('reptModalLoading');
  const modalContent = document.getElementById('reptModalContent');
  const modalError = document.getElementById('reptModalError');
  const modalImageEl = document.getElementById('reptModalImage');
  const modalTitleEl = document.getElementById('reptModalTitle');
  const modalFavoriteBtn = document.getElementById('reptModalFavorite');
  const modalDescriptionEl = document.getElementById('reptModalDescription');
  const modalMetaEl = document.getElementById('reptModalMeta');
  const modalServingsInput = document.getElementById('reptModalServings');
  const modalServingsMinus = document.getElementById('reptModalServingsMinus');
  const modalServingsPlus = document.getElementById('reptModalServingsPlus');
  const modalServingsHint = document.getElementById('reptModalServingsHint');
  const ingredientsListEl = document.getElementById('reptModalIngredients');
  const stepsListEl = document.getElementById('reptModalSteps');
  const sourceLinkEl = document.getElementById('reptModalSourceLink');

  // ---- State -----------------------------------------------------

  let defaultServings = loadDefaultServings();
  servingsInput.value = defaultServings;

  let favorites = []; // [{id,url,title,image,category,addedAt}] — shared across devices
  let recipesById = new Map(); // last-rendered recipe cards, id -> {id,url,title,image,category,subcategory}
  let currentDetail = null; // full detail payload for whichever recipe the modal currently shows

  let state = {
    mode: 'category', // 'category' | 'search' | 'favorites'
    categoryId: categories[0]?.id || null,
    subcategoryId: 'all',
    query: '',
    page: 0,
    loading: false,
  };

  function activeCategory() {
    return categories.find((c) => c.id === state.categoryId) || null;
  }

  function isFavorite(id) {
    return favorites.some((f) => f.id === id);
  }

  // ---- Tabs + subcategory chips -----------------------------------

  function renderTabs() {
    const favTab = `<button type="button" class="rpt-tab" data-mode="favorites" role="tab" aria-selected="${state.mode === 'favorites'}">❤️ Favorieten</button>`;
    const categoryTabs = categories
      .map(
        (cat) => `
          <button type="button" class="rpt-tab" data-mode="category" data-category="${escapeHtml(cat.id)}" role="tab"
                  aria-selected="${state.mode === 'category' && state.categoryId === cat.id}">
            ${cat.emoji ? `${cat.emoji} ` : ''}${escapeHtml(cat.label)}
          </button>
        `
      )
      .join('');
    const searchTab = `<button type="button" class="rpt-tab" data-mode="search" role="tab" aria-selected="${state.mode === 'search'}">🔎 Zoeken</button>`;

    tabsEl.innerHTML = favTab + categoryTabs + searchTab;
  }

  function renderSubcategoryChips() {
    const cat = activeCategory();
    if (state.mode !== 'category' || !cat || !cat.subcategories?.length) {
      subcatsEl.classList.add('hidden');
      subcatsEl.innerHTML = '';
      return;
    }
    subcatsEl.classList.remove('hidden');
    const allChip = `<button type="button" class="rpt-chip" data-subcategory="all" aria-selected="${state.subcategoryId === 'all'}">Alles</button>`;
    const chips = cat.subcategories
      .map(
        (sub) =>
          `<button type="button" class="rpt-chip" data-subcategory="${escapeHtml(sub.id)}" aria-selected="${state.subcategoryId === sub.id}">${escapeHtml(sub.label)}</button>`
      )
      .join('');
    subcatsEl.innerHTML = allChip + chips;
  }

  function setMode(mode, categoryId) {
    state = { ...state, mode, categoryId: categoryId ?? state.categoryId, subcategoryId: 'all', query: '', page: 0 };
    searchInput.value = '';
    renderTabs();
    renderSubcategoryChips();
    searchRowEl.classList.toggle('hidden', mode === 'favorites');
    sortRowEl.classList.toggle('hidden', mode === 'favorites');

    if (mode === 'favorites') {
      renderFavoritesView();
      return;
    }

    if (mode === 'search') {
      currentRecipes = [];
      searchInput.focus();
      statusEl.textContent = 'Typ een zoekterm en druk op zoeken.';
      resultsEl.innerHTML = '';
      return;
    }

    runQuery();
  }

  // ---- Querying the Worker -----------------------------------------

  function buildParams() {
    const cat = state.mode === 'category' ? activeCategory() : null;
    const subcat = cat?.subcategories?.find((s) => s.id === state.subcategoryId);

    const queryParts = [];
    if (subcat) queryParts.push(subcat.query);
    if (state.query) queryParts.push(state.query);

    const params = new URLSearchParams({ page: String(state.page) });
    if (cat) params.set('type', cat.type);
    const query = queryParts.join(' ').trim();
    if (query) params.set('query', query);
    return params;
  }

  // Short, human description of what is currently selected ("Pasta · Kip", "kip pittig", ...)
  function describeSelection() {
    const cat = state.mode === 'category' ? activeCategory() : null;
    const subcat = cat?.subcategories?.find((sub) => sub.id === state.subcategoryId);
    return [cat?.label, subcat?.label, state.query].filter(Boolean).join(' · ') || 'je selectie';
  }

  // Shows the stored backup of the current selection: ALL stored pages at once
  // (AH itself is never contacted from here). A newer selection cancels an
  // older one that is still loading. With a search word: see runSearch().
  let queryToken = 0;
  const MAX_PAGES = 12; // safety net; the lists are normally 1-3 pages

  // What is currently loaded (before sorting/filtering) + how to describe it.
  let currentRecipes = [];
  let currentMeta = { count: 0, fallbackUsed: false, emptyMessage: '' };

  // Sorteren + snelfilters (alleen voor wat nu op het scherm staat).
  const FAST_MAX_MINUTES = 30;
  const LIGHT_MAX_KCAL = 500;
  const sortState = { key: 'default', fast: false, light: false };

  const poolCache = new Map(); // "type|query" -> recipes of that stored list

  function syncSortControls() {
    sortSelect.value = sortState.key;
    filterFastBtn.setAttribute('aria-pressed', String(sortState.fast));
    filterLightBtn.setAttribute('aria-pressed', String(sortState.light));
  }

  // Applies filters + sort to `currentRecipes` and draws the cards + status.
  function renderResults() {
    currentRecipes.forEach((recipe) => recipesById.set(recipe.id, recipe));

    if (currentRecipes.length === 0) {
      resultsEl.innerHTML = '';
      statusEl.textContent = currentMeta.emptyMessage || 'Geen recepten gevonden.';
      return;
    }

    let list = currentRecipes.slice();
    if (sortState.fast) list = list.filter((r) => { const m = numberOf(r.cookTimeMinutes); return m !== null && m <= FAST_MAX_MINUTES; });
    if (sortState.light) list = list.filter((r) => { const k = numberOf(r.kcal); return k !== null && k <= LIGHT_MAX_KCAL; });

    const valueOf = { kcal: (r) => numberOf(r.kcal), time: (r) => numberOf(r.cookTimeMinutes) }[sortState.key];
    let missing = 0;
    if (valueOf) {
      list = list
        .map((recipe, index) => ({ recipe, index, value: valueOf(recipe) }))
        .sort((x, y) => {
          if (x.value === null && y.value === null) return x.index - y.index;
          if (x.value === null) return 1;
          if (y.value === null) return -1;
          return x.value - y.value || x.index - y.index;
        })
        .map((entry) => { if (entry.value === null) missing += 1; return entry.recipe; });
    } else if (sortState.key === 'title') {
      list.sort((x, y) => String(x.title).localeCompare(String(y.title), 'nl'));
    }

    if (list.length === 0) {
      resultsEl.innerHTML = '';
      statusEl.textContent = 'Geen recepten voldoen aan de gekozen filters. Zet een filter uit om weer recepten te zien.';
      return;
    }

    resultsEl.innerHTML = list.map(renderCard).join('');
    qsa('.fade-up', resultsEl).forEach((el) => el.classList.add('visible'));

    const total = currentRecipes.length;
    const filtered = list.length !== total;
    let text = `${list.length} recept${list.length === 1 ? '' : 'en'}${filtered ? ` (van ${total})` : ''}`;
    if (!filtered && currentMeta.count > total) text += ` (van ${currentMeta.count.toLocaleString('nl-NL')} totaal bij AH)`;
    text += '.';
    if (missing) text += ` ${missing} zonder ${sortState.key === 'kcal' ? 'kcal-gegevens' : 'tijd'} staan onderaan.`;
    if (currentMeta.fallbackUsed) text += ' Categorie niet exact herkend bij AH — er is op trefwoord gezocht.';
    statusEl.textContent = text;
  }

  async function runQuery() {
    if (state.mode === 'favorites') {
      renderFavoritesView();
      return;
    }
    if (state.query) {
      runSearch();
      return;
    }
    const token = (queryToken += 1);
    resultsEl.innerHTML = '';
    statusEl.textContent = 'Bezig met laden…';

    try {
      const collected = [];
      let count = 0;
      let fallbackUsed = false;
      let noBackup = false;

      for (let page = 0; page < MAX_PAGES; page += 1) {
        state.page = page;
        const data = await fetchRecipeList(workerUrl, buildParams());
        if (token !== queryToken) return; // another selection was made meanwhile
        const recipes = Array.isArray(data.recipes) ? data.recipes : [];
        if (page === 0) {
          noBackup = Boolean(data.noBackup);
          count = Number(data.count) || 0;
          fallbackUsed = Boolean(data.fallbackUsed);
        }
        if (recipes.length === 0) break;
        collected.push(...recipes);
        if (!data.hasMore) break;
      }

      currentRecipes = collected;
      currentMeta = {
        count,
        fallbackUsed,
        emptyMessage: noBackup
          ? `Nog niets opgeslagen voor ${describeSelection()}. Haal de recepten op via de dev-pagina (“Alles ophalen van AH.nl”).`
          : 'Geen recepten gevonden. Probeer een andere subcategorie of zoekterm.',
      };
      renderResults();
    } catch (error) {
      if (token !== queryToken) return;
      console.error('Recepten worker error:', error);
      statusEl.textContent = `❌ Kon geen recepten laden (${error.message}). Probeer het later opnieuw.`;
    }
  }

  // Which stored lists to search through for the current screen:
  //  - a category + subcategory chosen -> just that stored list
  //  - a category                       -> its main list + all its subcategories
  //  - the Zoeken tab                   -> every category (main list + subcategories)
  // `tag` = extra words a recipe of that list counts as matching (a recipe
  // from the "Pasta · kip" list is a chicken recipe even if its title says
  // something else), so "kip" also finds those.
  function searchSpecs() {
    const cat = state.mode === 'category' ? activeCategory() : null;
    const sub = cat?.subcategories?.find((s) => s.id === state.subcategoryId);
    if (cat && sub) return [{ type: cat.type, query: sub.query, tag: `${sub.query} ${sub.label}` }];

    const specs = [];
    (cat ? [cat] : categories).forEach((c) => {
      specs.push({ type: c.type, query: '', tag: c.label });
      (c.subcategories || []).forEach((s) => specs.push({ type: c.type, query: s.query, tag: `${s.query} ${s.label}` }));
    });
    return specs;
  }

  async function runSearch() {
    const token = (queryToken += 1);
    resultsEl.innerHTML = '';
    const words = normalizeText(state.query).split(/\s+/).filter(Boolean);
    const specs = searchSpecs();
    const pool = new Map(); // id -> { recipe, hay }

    try {
      let done = 0;
      statusEl.textContent = `Doorzoeken… (0/${specs.length} lijsten)`;
      for (let i = 0; i < specs.length; i += 4) {
        const chunk = specs.slice(i, i + 4);
        const lists = await Promise.all(chunk.map(async (spec) => {
          const key = `${spec.type}|${spec.query}`;
          if (!poolCache.has(key)) poolCache.set(key, await loadWholeStoredList(workerUrl, spec.type, spec.query));
          return { spec, recipes: poolCache.get(key) };
        }));
        if (token !== queryToken) return;
        lists.forEach(({ spec, recipes }) => {
          recipes.forEach((recipe) => {
            const extra = `${spec.tag} ${recipe.title} ${recipe.category || ''} ${recipe.subcategory || ''}`;
            const entry = pool.get(recipe.id);
            if (entry) entry.hay += ` ${spec.tag}`;
            else pool.set(recipe.id, { recipe, hay: extra });
          });
        });
        done += chunk.length;
        statusEl.textContent = `Doorzoeken… (${done}/${specs.length} lijsten)`;
      }

      const matches = [];
      pool.forEach(({ recipe, hay }) => {
        const haystack = normalizeText(hay);
        if (words.every((word) => haystack.includes(word))) matches.push(recipe);
      });

      currentRecipes = matches;
      currentMeta = {
        count: 0,
        fallbackUsed: false,
        emptyMessage: pool.size === 0
          ? 'Er is nog niets opgeslagen om in te zoeken. Haal de recepten op via de dev-pagina (“Alles ophalen van AH.nl”).'
          : `Geen recepten gevonden voor “${state.query}”. Probeer een ander woord.`,
      };
      renderResults();
    } catch (error) {
      if (token !== queryToken) return;
      console.error('Zoeken mislukt:', error);
      statusEl.textContent = `❌ Zoeken mislukt (${error.message}). Probeer het later opnieuw.`;
    }
  }

  // ---- Rendering: cards ---------------------------------------------

  function renderCard(recipe) {
    const fav = isFavorite(recipe.id);
    const tagBits = [recipe.category, recipe.subcategory].filter(Boolean);
    const metaBits = [];
    if (recipe.cookTimeMinutes) metaBits.push(`⏱️ ${recipe.cookTimeMinutes} min`);
    if (recipe.kcal) metaBits.push(`🔥 ${recipe.kcal} kcal`);

    return `
      <article class="rpt-card fade-up visible" data-id="${escapeHtml(recipe.id)}">
        <button type="button" class="rpt-card-favorite" data-id="${escapeHtml(recipe.id)}" aria-pressed="${fav}" aria-label="${fav ? 'Verwijder uit favorieten' : 'Toevoegen aan favorieten'}">${fav ? '❤️' : '🤍'}</button>
        <div class="rpt-card-image" role="img" aria-label="${escapeHtml(recipe.title)}">
          ${recipe.image ? `<img src="${escapeHtml(recipe.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'; this.nextElementSibling.style.display='';">` : ''}
          <span class="rpt-card-fallback" aria-hidden="true" style="${recipe.image ? 'display:none' : ''}">🍽️</span>
        </div>
        <div class="rpt-card-body">
          <h3 class="rpt-card-title">${escapeHtml(recipe.title)}</h3>
          ${tagBits.length ? `<p class="rpt-card-tag">${escapeHtml(tagBits.join(' · '))}</p>` : ''}
          ${metaBits.length ? `<p class="rpt-card-meta">${escapeHtml(metaBits.join(' · '))}</p>` : ''}
        </div>
      </article>
    `;
  }

  // ---- Favorites -----------------------------------------------------

  async function loadFavorites() {
    try {
      const response = await fetch(`${workerUrl}/favorites`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      favorites = Array.isArray(data.favorites) ? data.favorites : [];
    } catch (error) {
      console.error('Kon favorieten niet laden:', error);
      favorites = [];
    }
  }

  async function saveFavorites(previous) {
    try {
      const response = await fetch(`${workerUrl}/favorites`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ favorites }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (Array.isArray(data.favorites)) favorites = data.favorites;
      return true;
    } catch (error) {
      console.error('Kon favorieten niet opslaan:', error);
      favorites = previous;
      return false;
    }
  }

  function renderFavoritesView() {
    if (favorites.length === 0) {
      resultsEl.innerHTML = '';
      statusEl.textContent = 'Nog geen favorieten opgeslagen — klik op het hartje bij een recept.';
      return;
    }
    favorites.forEach((recipe) => recipesById.set(recipe.id, recipe));
    resultsEl.innerHTML = favorites.map(renderCard).join('');
    qsa('.fade-up', resultsEl).forEach((el) => el.classList.add('visible'));
    statusEl.textContent = `${favorites.length} favoriet${favorites.length === 1 ? '' : 'en'}.`;
  }

  function updateFavoriteButtonsFor(id) {
    const fav = isFavorite(id);
    qsa('.rpt-card-favorite', resultsEl).forEach((btn) => {
      if (btn.dataset.id !== id) return;
      btn.textContent = fav ? '❤️' : '🤍';
      btn.setAttribute('aria-pressed', String(fav));
      btn.setAttribute('aria-label', fav ? 'Verwijder uit favorieten' : 'Toevoegen aan favorieten');
    });
    if (currentDetail && currentDetail.id === id) {
      modalFavoriteBtn.textContent = fav ? '❤️' : '🤍';
      modalFavoriteBtn.setAttribute('aria-pressed', String(fav));
    }
  }

  async function toggleFavorite(recipeMeta) {
    const previous = favorites;
    const exists = isFavorite(recipeMeta.id);
    favorites = exists
      ? favorites.filter((f) => f.id !== recipeMeta.id)
      : [
          ...favorites,
          {
            id: recipeMeta.id,
            url: recipeMeta.url,
            title: recipeMeta.title,
            image: recipeMeta.image || null,
            category: recipeMeta.category || null,
            addedAt: Date.now(),
          },
        ];

    updateFavoriteButtonsFor(recipeMeta.id);
    if (state.mode === 'favorites') renderFavoritesView();

    const saved = await saveFavorites(previous);
    if (!saved) {
      updateFavoriteButtonsFor(recipeMeta.id);
      if (state.mode === 'favorites') renderFavoritesView();
      statusEl.textContent = '❌ Kon favoriet niet opslaan. Probeer het opnieuw.';
    }
  }

  // ---- Detail modal ----------------------------------------------------

  function openRecipeDetail(recipeMeta) {
    modalOverlay.classList.remove('hidden');
    document.body.classList.add('rpt-modal-open');
    modalLoading.classList.remove('hidden');
    modalContent.classList.add('hidden');
    modalError.classList.add('hidden');
    modalServingsInput.value = defaultServings;
    fetchRecipeDetail(recipeMeta.url);
  }

  function closeModal() {
    modalOverlay.classList.add('hidden');
    document.body.classList.remove('rpt-modal-open');
    currentDetail = null;
  }

  async function fetchRecipeDetail(path) {
    try {
      const data = await fetchRecipeDetailData(workerUrl, path);
      currentDetail = data;
      modalLoading.classList.add('hidden');
      modalContent.classList.remove('hidden');
      renderModalContent(data);
    } catch (error) {
      console.error('Recept detail error:', error);
      currentDetail = null;
      modalLoading.classList.add('hidden');
      modalError.classList.remove('hidden');
      const fallbackUrl = error.sourceUrl || `https://www.ah.nl${path}`;
      modalError.innerHTML = `❌ Kon de volledige receptgegevens niet laden (${escapeHtml(error.message)}). <a href="${escapeHtml(fallbackUrl)}" target="_blank" rel="noopener noreferrer">Bekijk dit recept rechtstreeks op AH.nl</a>.`;
    }
  }

  function renderModalContent(data) {
    // Real <img> (see recepten.html) rather than a CSS background so a
    // failed/blocked load can be caught via onerror (falls back to
    // hiding the element, same idea as the card grid's fallback icon —
    // see renderCard()) instead of just silently showing nothing.
    // referrerpolicy="no-referrer" is set once in the HTML; it matters
    // here specifically because some image hosts (AH's included)
    // refuse a hotlinked image whose Referer header names a different
    // site than their own.
    modalImageEl.onerror = () => { modalImageEl.classList.add('hidden'); };
    if (data.image) {
      modalImageEl.classList.remove('hidden');
      modalImageEl.src = data.image;
    } else {
      modalImageEl.removeAttribute('src');
      modalImageEl.classList.add('hidden');
    }
    modalImageEl.alt = data.title || '';
    modalTitleEl.textContent = data.title || 'Recept';

    modalDescriptionEl.textContent = data.description || '';
    modalDescriptionEl.classList.toggle('hidden', !data.description);

    const metaBits = [];
    if (data.totalTimeMinutes) metaBits.push(`⏱️ ${data.totalTimeMinutes} min`);
    if (data.nutrition?.calories) metaBits.push(`🔥 ${data.nutrition.calories}`);
    if (data.category) metaBits.push(`🍽️ ${data.category}`);
    if (data.cuisine) metaBits.push(`🌍 ${data.cuisine}`);
    if (data.rating?.value) metaBits.push(`⭐ ${data.rating.value.toFixed(1)}${data.rating.count ? ` (${data.rating.count})` : ''}`);
    modalMetaEl.innerHTML = metaBits.map((bit) => `<span class="rpt-meta-pill">${escapeHtml(bit)}</span>`).join('');

    modalServingsHint.textContent = data.servingsEstimated
      ? `AH geeft voor dit recept geen aantal personen op — we gaan uit van ${data.servings}.`
      : `Bij AH is dit recept voor ${data.servings} personen.`;

    sourceLinkEl.href = data.sourceUrl || '#';

    updateFavoriteButtonsFor(data.id);
    renderScaledIngredients();
    renderSteps(data.steps);
  }

  function renderScaledIngredients() {
    if (!currentDetail) return;
    const target = clampServings(parseInt(modalServingsInput.value, 10));
    const ratio = target / (currentDetail.servings || 4);

    const items = (currentDetail.ingredients || []).map((ingredient) => {
      if (ingredient.quantity == null) {
        return `<li>${escapeHtml(ingredient.raw)}</li>`;
      }
      const scaled = ingredient.quantity * ratio;
      return `<li><strong>${escapeHtml(formatQuantity(scaled))}</strong> ${escapeHtml(ingredient.rest)}</li>`;
    });

    ingredientsListEl.innerHTML = items.join('') || '<li class="rpt-empty">Geen ingrediënten gevonden.</li>';
  }

  function renderSteps(steps) {
    stepsListEl.innerHTML =
      steps && steps.length
        ? steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')
        : '<li class="rpt-empty">Geen bereidingswijze gevonden.</li>';
  }

  // ---- Wiring ------------------------------------------------------

  tabsEl.addEventListener('click', (event) => {
    const btn = event.target.closest('.rpt-tab');
    if (!btn) return;
    const mode = btn.dataset.mode;
    if (mode === 'category') setMode('category', btn.dataset.category);
    else setMode(mode);
  });

  subcatsEl.addEventListener('click', (event) => {
    const chip = event.target.closest('.rpt-chip');
    if (!chip) return;
    state.subcategoryId = chip.dataset.subcategory;
    renderSubcategoryChips();
    runQuery();
  });

  function triggerSearch() {
    state.query = searchInput.value.trim();
    if (state.mode === 'search' && !state.query) {
      statusEl.textContent = 'Typ een zoekterm en druk op zoeken.';
      resultsEl.innerHTML = '';
        return;
    }
    runQuery();
  }

  searchBtn.addEventListener('click', triggerSearch);
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      triggerSearch();
    }
  });
  searchInput.addEventListener(
    'input',
    debounce(() => {
      if (searchInput.value.trim().length === 0 || searchInput.value.trim().length >= 3) triggerSearch();
    }, 600)
  );

  sortSelect.addEventListener('change', () => {
    sortState.key = sortSelect.value;
    if (state.mode !== 'favorites') renderResults();
  });
  filterFastBtn.addEventListener('click', () => {
    sortState.fast = !sortState.fast;
    syncSortControls();
    if (state.mode !== 'favorites') renderResults();
  });
  filterLightBtn.addEventListener('click', () => {
    sortState.light = !sortState.light;
    syncSortControls();
    if (state.mode !== 'favorites') renderResults();
  });

  // Native number inputs also change value on mouse-wheel scroll while
  // focused, and browsers already draw their own up/down arrows on top
  // of the custom −/+ buttons here — neither is wanted (see recepten.css
  // for the arrows). See preventNumberInputScroll() in utils.js.
  preventNumberInputScroll(servingsInput);
  preventNumberInputScroll(modalServingsInput);

  servingsInput.addEventListener('change', () => {
    defaultServings = clampServings(parseInt(servingsInput.value, 10));
    servingsInput.value = defaultServings;
    saveDefaultServings(defaultServings);
  });

  resultsEl.addEventListener('click', (event) => {
    const favBtn = event.target.closest('.rpt-card-favorite');
    const card = event.target.closest('.rpt-card');
    if (!card) return;
    const recipe = recipesById.get(card.dataset.id);
    if (!recipe) return;

    if (favBtn) {
      event.stopPropagation();
      toggleFavorite(recipe);
      return;
    }
    openRecipeDetail(recipe);
  });

  modalClose.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', (event) => {
    if (event.target === modalOverlay) closeModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modalOverlay.classList.contains('hidden')) closeModal();
  });

  modalFavoriteBtn.addEventListener('click', () => {
    if (!currentDetail) return;
    toggleFavorite({
      id: currentDetail.id,
      url: currentDetail.url,
      title: currentDetail.title,
      image: currentDetail.image,
      category: currentDetail.category,
    });
  });

  modalServingsInput.addEventListener('input', () => {
    modalServingsInput.value = clampServings(parseInt(modalServingsInput.value, 10));
    renderScaledIngredients();
  });
  modalServingsMinus.addEventListener('click', () => {
    modalServingsInput.value = clampServings(parseInt(modalServingsInput.value, 10) - 1);
    renderScaledIngredients();
  });
  modalServingsPlus.addEventListener('click', () => {
    modalServingsInput.value = clampServings(parseInt(modalServingsInput.value, 10) + 1);
    renderScaledIngredients();
  });

  // 🛒 Dit gerecht als nieuw boodschappenlijstje (dialoog + bevestiging +
  // melding): zie recipe-to-list.js. Gebruikt de hoeveelheden zoals ze nu
  // in de popup staan (al geschaald naar het gekozen aantal personen).
  setupRecipeToList({
    button: document.getElementById('reptModalAddToList'),
    getRecipe: () => {
      if (!currentDetail) return null;
      const target = clampServings(parseInt(modalServingsInput.value, 10));
      const ratio = target / (currentDetail.servings || 4);
      return {
        title: currentDetail.title || 'Recept',
        servings: target,
        lines: (currentDetail.ingredients || []).map((ingredient) => (
          ingredient.quantity == null
            ? String(ingredient.raw || '').trim()
            : `${formatQuantity(ingredient.quantity * ratio)} ${ingredient.rest || ''}`.trim()
        )).filter(Boolean),
      };
    },
  });


  // ---- Initial load --------------------------------------------------
  // Favorites are fetched in parallel instead of awaited first: a slow or
  // failing favorites request must never hold up the recipe grid itself.
  (function init() {
    pruneOldCaches();
    syncSortControls();
    renderTabs();
    renderSubcategoryChips();
    runQuery();
    loadFavorites().then(() => {
      // Sync the hearts on whatever is already on screen (or re-render the
      // Favorieten tab if that's the one that's open by now).
      if (state.mode === 'favorites') renderFavoritesView();
      else favorites.forEach((fav) => updateFavoriteButtonsFor(fav.id));
    });
  })();
}
