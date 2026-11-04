// =================================================================
// RECEPTEN (recepten.html)
// -----------------------------------------------------------------
// Browses recipes from TheMealDB (free, English) through the Cloudflare
// Worker configured as siteConfig.recipes.workerUrl (see
// cloudflare/recepten/ + ACTION-EXPANSION-PLAN.md). This used to read
// Albert Heijn's Allerhande, but ah.nl blocks Cloudflare's servers with
// a 403 — see the Worker's file header for what the new source can and
// can't do, and for what "fallbackUsed" in a response means (nothing
// matched inside the category, so plain keyword results are shown).
//
// THREE "TABS" (siteConfig.recipes.categories drives the food ones):
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
// CACHING: "fresh" above still means at most once a day. Every call
// to AH-scraped data (listing + detail, NOT /favorites) goes through
// fetchRecipeList()/fetchRecipeDetailData() further down, which check
// localStorage first (CLIENT_CACHE_TTL_MS, 24h) before ever touching
// the Worker — and the Worker has an identical 24h cache of its own,
// shared across both people/devices. See the big comment above
// CACHE_TTL_MS in recepten_worker.js for the full picture.
// =================================================================

import { siteConfig } from '../config.js';
import { qs, qsa, escapeHtml, debounce, preventNumberInputScroll } from './utils.js';

const SERVINGS_STORAGE_KEY = 'recepten-personen';
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

// ---- Client-side ("local") cache -----------------------------------
// AH is only meant to be scraped once a day (see CACHE_TTL_MS in
// recepten_worker.js) — this is the other half of that: before asking
// the Worker for a recipe list or a recipe's detail, check localStorage
// first. A hit here means the Worker (and ah.nl) isn't even contacted.
// A miss falls through to the Worker, which has an identical 24h cache
// of its own shared across every device/person, so the *actual* AH
// fetch only happens for whoever is first to ask about a given
// query/recipe on a given day. Only used for AH-scraped data (recipe
// lists + recipe detail) — favorites are live shared user data and
// are always fetched fresh so both people see each other's changes.
// "v2": bumped when a bad/empty Worker answer got cached for a full day
// and made the page look permanently broken. Entries from the old
// "recepten-cache:" prefix are ignored and removed by pruneClientCache().
const CLIENT_CACHE_PREFIX = 'recepten-cache-v2:';
const LEGACY_CACHE_PREFIXES = ['recepten-cache:'];
const CLIENT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // keep in sync with the Worker's CACHE_TTL_MS

function readClientCache(key) {
  try {
    const raw = localStorage.getItem(CLIENT_CACHE_PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (Date.now() - entry.savedAt > CLIENT_CACHE_TTL_MS) return null;
    return entry.payload;
  } catch {
    return null; // private browsing / storage disabled / corrupted entry — just skip the cache
  }
}

function writeClientCache(key, payload) {
  try {
    localStorage.setItem(CLIENT_CACHE_PREFIX + key, JSON.stringify({ savedAt: Date.now(), payload }));
  } catch {
    // storage full or unavailable — degrade silently, the Worker's own 24h cache still applies
  }
}

// Removes only our own expired entries so localStorage doesn't grow
// forever. Cheap enough to just run once per page load.
function pruneClientCache() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (LEGACY_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        localStorage.removeItem(key); // old format — drop it
        continue;
      }
      if (!key.startsWith(CLIENT_CACHE_PREFIX)) continue;
      try {
        const entry = JSON.parse(localStorage.getItem(key));
        if (Date.now() - entry.savedAt > CLIENT_CACHE_TTL_MS) localStorage.removeItem(key);
      } catch {
        localStorage.removeItem(key); // corrupted entry — drop it
      }
    }
  } catch {
    // ignore — purely a housekeeping nicety, never worth failing the page over
  }
}

// Cache-aware fetch for GET /recipes (a listing/search result page).
async function fetchRecipeList(workerUrl, params) {
  const cacheKey = `list:${params.toString()}`;
  const cached = readClientCache(cacheKey);
  if (cached && Array.isArray(cached.recipes) && cached.recipes.length > 0) return cached;

  const response = await fetch(`${workerUrl}/recipes?${params.toString()}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  // Only remember lists that actually contain recipes: caching an empty
  // answer (AH hiccup, changed markup, ...) would keep the page empty for
  // the full 24h even after the problem is fixed.
  if (Array.isArray(data.recipes) && data.recipes.length > 0) writeClientCache(cacheKey, data);
  return data;
}

// Cache-aware fetch for GET /recipe (one recipe's full detail).
async function fetchRecipeDetailData(workerUrl, path) {
  const cacheKey = `detail:${path}`;
  const cached = readClientCache(cacheKey);
  if (cached) return cached;

  const response = await fetch(`${workerUrl}/recipe?url=${encodeURIComponent(path)}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data.error || `HTTP ${response.status}`);
    err.sourceUrl = data.sourceUrl;
    throw err;
  }
  writeClientCache(cacheKey, data);
  return data;
}

export function initRecepten() {
  const root = document.getElementById('receptenApp');
  if (!root) return; // not on this page

  const workerUrl = siteConfig.recipes?.workerUrl || '';
  const categories = siteConfig.recipes?.categories || [];

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
  const loadMoreBtn = qs('#reptLoadMore', root);

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

    if (mode === 'favorites') {
      renderFavoritesView();
      return;
    }

    if (mode === 'search') {
      searchInput.focus();
      statusEl.textContent = 'Typ een zoekterm en druk op zoeken.';
      resultsEl.innerHTML = '';
      loadMoreBtn.classList.add('hidden');
      return;
    }

    runQuery({ replace: true });
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

  async function runQuery({ replace }) {
    if (state.mode === 'favorites') {
      renderFavoritesView();
      return;
    }
    if (state.loading) return;
    state.loading = true;

    if (replace) {
      resultsEl.innerHTML = '';
      state.page = 0;
    }

    statusEl.textContent = 'Bezig met laden…';
    loadMoreBtn.classList.add('hidden');

    try {
      const params = buildParams();
      const data = await fetchRecipeList(workerUrl, params);
      const recipes = Array.isArray(data.recipes) ? data.recipes : [];

      if (recipes.length === 0) {
        if (replace) {
          resultsEl.innerHTML = '';
          statusEl.textContent = 'Geen recepten gevonden. Probeer een andere subcategorie of zoekterm.';
        } else {
          statusEl.textContent = 'Geen recepten meer.';
        }
        loadMoreBtn.classList.add('hidden');
        return;
      }

      recipes.forEach((recipe) => recipesById.set(recipe.id, recipe));
      resultsEl.insertAdjacentHTML('beforeend', recipes.map(renderCard).join(''));
      qsa('.fade-up', resultsEl).forEach((el) => el.classList.add('visible'));

      const shownCount = resultsEl.children.length;
      let statusText = `${shownCount} recept${shownCount === 1 ? '' : 'en'} getoond${data.count ? ` (van ${data.count.toLocaleString('nl-NL')} totaal)` : ''}.`;
      if (data.fallbackUsed) statusText += ' Niets gevonden binnen deze categorie — er is op trefwoord gezocht.';
      statusEl.textContent = statusText;
      // "Meer laden" only while there is more to load: fewer shown than the total, and this page was full.
      const more = data.count ? shownCount < data.count : recipes.length > 0;
      loadMoreBtn.classList.toggle('hidden', !more);
    } catch (error) {
      console.error('Recepten worker error:', error);
      statusEl.textContent = `❌ Kon geen recepten ophalen (${error.message}). Probeer het later opnieuw.`;
      loadMoreBtn.classList.add('hidden');
    } finally {
      state.loading = false;
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
    loadMoreBtn.classList.add('hidden');
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
      modalError.innerHTML = `❌ Kon de volledige receptgegevens niet laden (${escapeHtml(error.message)}).${
        error.sourceUrl ? ` <a href="${escapeHtml(error.sourceUrl)}" target="_blank" rel="noopener noreferrer">Bekijk het originele recept</a>.` : ''
      }`;
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
      ? `De bron geeft geen aantal personen op — we gaan uit van ${data.servings} (hoeveelheden zijn dus een schatting).`
      : `Dit recept is voor ${data.servings} personen.`;

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
    runQuery({ replace: true });
  });

  function triggerSearch() {
    state.query = searchInput.value.trim();
    if (state.mode === 'search' && !state.query) {
      statusEl.textContent = 'Typ een zoekterm en druk op zoeken.';
      resultsEl.innerHTML = '';
      loadMoreBtn.classList.add('hidden');
      return;
    }
    runQuery({ replace: true });
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

  loadMoreBtn.addEventListener('click', () => {
    state.page += 1;
    runQuery({ replace: false });
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

  // ---- Initial load --------------------------------------------------
  // Favorites are fetched in parallel instead of awaited first: a slow or
  // failing favorites request must never hold up the recipe grid itself.
  (function init() {
    pruneClientCache();
    renderTabs();
    renderSubcategoryChips();
    runQuery({ replace: true });
    loadFavorites().then(() => {
      // Sync the hearts on whatever is already on screen (or re-render the
      // Favorieten tab if that's the one that's open by now).
      if (state.mode === 'favorites') renderFavoritesView();
      else favorites.forEach((fav) => updateFavoriteButtonsFor(fav.id));
    });
  })();
}
