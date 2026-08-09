// =================================================================
// TICKETMASTER (ticketmaster.html)
// -----------------------------------------------------------------
// Shows live concert data from the Ticketmaster Discovery API in
// four modes:
//   - "favorites" : concerts for every artist in the saved favorites
//                    list (see FAVORITES below) — the default tab
//   - "upcoming"  : general upcoming concerts (any artist)
//   - "sales"     : concerts whose public onsale hasn't started yet
//   - "search"    : concerts matching a specific artist/act name
// All four can be filtered by country.
//
// SECURITY NOTE: this module never talks to Ticketmaster directly
// and never touches an API key. It only calls the small serverless
// proxy configured as `siteConfig.ticketmaster.workerUrl` (a
// Cloudflare Worker — see /cloudflare-worker + STAPPENPLAN.md at the
// repo root). The proxy holds the real Ticketmaster key as a secret
// on Cloudflare's side. Since this repo is public, putting the real
// key directly in this file (or config.js) would let anyone reading
// the source, or GitHub Pages' shipped JS, use up your daily quota.
//
// FAVORITES: a SEPARATE small Worker
// (siteConfig.ticketmaster.favoriteArtistsWorkerUrl, see
// /cloudflare/cloudflare-worker-favorite-artists +
// STAPPENPLAN-TICKETMASTER-FAVORIETEN.md) stores just the list of
// saved artist NAMES, shared across every device — add "Coldplay" on
// your phone, it's there on the laptop too. It does not know
// anything about concerts itself. When the favorites tab is active,
// this module fires one `mode=search` request per saved artist at
// the EXISTING Ticketmaster proxy (same one "Zoek op naam" uses),
// then merges + sorts all the results by date client-side. That
// keeps the Ticketmaster proxy itself completely unchanged.
//
// Because merging N artists' results means N independent Ticketmaster
// pages rather than one, the favorites tab intentionally shows a
// single page per artist (see FAVORITES_PAGE_SIZE) and has no "Meer
// laden" button, rather than building real cross-artist pagination —
// simpler, and plenty for "did anyone I like just announce a show".
//
// EXTENDING: want a 5th mode (e.g. "by venue")? Add it to the
// `MODES` set below, add a matching tab button in ticketmaster.html,
// and handle it the same way "search" is handled here.
// =================================================================

import { siteConfig } from '../config.js';
import { qs, qsa, escapeHtml, debounce } from './utils.js';

const PAGE_SIZE = 12;
const FAVORITES_PAGE_SIZE = 6; // per artist, since results from every saved artist get merged into one list

const COUNTRY_LABELS = {
  NL: 'Nederland',
  BE: 'België',
  DE: 'Duitsland',
  GB: 'Verenigd Koninkrijk',
  FR: 'Frankrijk',
  US: 'Verenigde Staten',
  '': 'alle landen',
};

export function initTicketmaster() {
  const root = document.getElementById('ticketmasterApp');
  if (!root) return; // not on this page

  const tabs = {
    favorites: qs('#tmTabFavorites', root),
    upcoming:  qs('#tmTabUpcoming', root),
    sales:     qs('#tmTabSales', root),
    search:    qs('#tmTabSearch', root),
  };
  const searchRow     = qs('#tmSearchRow', root);
  const searchInput   = qs('#tmSearchInput', root);
  const searchBtn     = qs('#tmSearchBtn', root);
  const countrySelect = qs('#tmCountry', root);
  const refreshBtn    = qs('#tmRefresh', root);
  const statusEl      = qs('#tmStatus', root);
  const resultsEl     = qs('#tmResults', root);
  const loadMoreBtn   = qs('#tmLoadMore', root);

  const favoritesRow   = qs('#tmFavoritesRow', root);
  const favoriteInput  = qs('#tmFavoriteInput', root);
  const favoriteAddBtn = qs('#tmFavoriteAddBtn', root);
  const favoritesChips = qs('#tmFavoritesChips', root);

  const workerUrl = siteConfig.ticketmaster?.workerUrl || '';
  const favoriteArtistsWorkerUrl = siteConfig.ticketmaster?.favoriteArtistsWorkerUrl || '';
  countrySelect.value = siteConfig.ticketmaster?.defaultCountry ?? 'NL';

  // The saved favorites list itself (artist names) — separate from
  // `state` below, which describes the current query/results. Starts
  // empty and is filled in by loadFavoriteArtists() during init.
  let favoriteArtists = [];

  // Current query state — rebuilt whenever a tab, filter, or search changes.
  let state = { mode: 'favorites', keyword: '', page: 0, loading: false };

  function setMode(mode) {
    state = { ...state, mode, page: 0 };
    Object.entries(tabs).forEach(([key, btn]) => {
      btn.setAttribute('aria-selected', String(key === mode));
    });
    searchRow.classList.toggle('hidden', mode !== 'search');
    favoritesRow.classList.toggle('hidden', mode !== 'favorites');
    favoritesChips.classList.toggle('hidden', mode !== 'favorites');

    if (mode === 'search') {
      searchInput.focus();
      if (!state.keyword) {
        resultsEl.innerHTML = '';
        statusEl.textContent = 'Typ een artiest- of bandnaam en druk op zoeken.';
        loadMoreBtn.classList.add('hidden');
        return;
      }
    }

    if (mode === 'favorites' && favoriteArtists.length === 0) {
      resultsEl.innerHTML = '';
      statusEl.textContent = 'Nog geen favorieten opgeslagen — voeg hierboven een artiest toe.';
      loadMoreBtn.classList.add('hidden');
      return;
    }

    runQuery({ replace: true });
  }

  function buildUrl(page, { mode = state.mode, keyword = state.keyword, size = PAGE_SIZE } = {}) {
    const params = new URLSearchParams({
      mode: mode === 'favorites' ? 'search' : mode, // favorites has no server-side "mode" of its own — it's N search calls merged client-side
      page: String(page),
      size: String(size),
    });
    if (countrySelect.value) params.set('countryCode', countrySelect.value);
    if (mode === 'search' || mode === 'favorites') params.set('keyword', keyword);
    return `${workerUrl}?${params.toString()}`;
  }

  async function runQuery({ replace }) {
    if (!workerUrl || workerUrl.includes('YOUR-SUBDOMAIN')) {
      statusEl.textContent =
        '⚠️ Geen worker geconfigureerd. Zet je Cloudflare Worker-URL in assets/js/config.js (ticketmaster.workerUrl), zie STAPPENPLAN.md.';
      resultsEl.innerHTML = '';
      loadMoreBtn.classList.add('hidden');
      return;
    }

    if (state.mode === 'favorites') {
      await runFavoritesQuery();
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
      const response = await fetch(buildUrl(state.page));
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || body.fault?.faultstring || `HTTP ${response.status}`);
      }

      const data = await response.json();
      // Ticketmaster still returns cancelled/postponed shows (e.g. Anouk's
      // cancelled dates) mixed in with the rest — filter those out before
      // rendering so "aankomende sales" only shows shows that are actually
      // still happening.
      const events = (data._embedded?.events ?? []).filter(isStillHappening);
      const pageInfo = data.page ?? { number: 0, totalPages: 0, totalElements: 0 };

      if (replace && events.length === 0) {
        resultsEl.innerHTML = '';
        statusEl.textContent = emptyMessage(state.mode);
        loadMoreBtn.classList.add('hidden');
        return;
      }

      resultsEl.insertAdjacentHTML('beforeend', events.map(renderCard).join(''));
      qsa('.fade-up', resultsEl).forEach((el) => el.classList.add('visible')); // already-fetched cards don't need scroll-reveal delay

      // Count the cards actually shown (not pageInfo.totalElements — that
      // count comes straight from Ticketmaster and still includes the
      // cancelled/postponed shows we just filtered out above).
      const shownCount = resultsEl.children.length;
      const countryLabel = COUNTRY_LABELS[countrySelect.value] ?? countrySelect.value;
      statusEl.textContent = `${shownCount} resultaten in ${countryLabel}${
        state.mode === 'search' ? ` voor “${state.keyword}”` : ''
      }.`;

      const hasMore = pageInfo.number < pageInfo.totalPages - 1;
      loadMoreBtn.classList.toggle('hidden', !hasMore);
    } catch (error) {
      console.error('Ticketmaster proxy error:', error);
      statusEl.textContent = `❌ Kon geen data ophalen (${error.message}). Probeer het later opnieuw.`;
      loadMoreBtn.classList.add('hidden');
    } finally {
      state.loading = false;
    }
  }

  // ---- Favorites: fan-out one search per saved artist, then merge ----
  // No "Meer laden" here (see the module header comment for why) —
  // every call below already asks for a full page (FAVORITES_PAGE_SIZE)
  // per artist, so this is inherently a "replace everything" query.
  async function runFavoritesQuery() {
    if (state.loading) return;
    state.loading = true;
    resultsEl.innerHTML = '';
    loadMoreBtn.classList.add('hidden');
    statusEl.textContent = `Bezig met laden voor ${favoriteArtists.length} favoriet${favoriteArtists.length === 1 ? '' : 'en'}…`;

    try {
      const results = await Promise.allSettled(
        favoriteArtists.map((artist) =>
          fetch(buildUrl(0, { mode: 'favorites', keyword: artist, size: FAVORITES_PAGE_SIZE })).then(async (response) => {
            if (!response.ok) {
              const body = await response.json().catch(() => ({}));
              throw new Error(body.error || body.fault?.faultstring || `HTTP ${response.status}`);
            }
            return response.json();
          })
        )
      );

      // Partial failure (one artist's request fails, e.g. a transient
      // network blip) shouldn't blank out results for every other
      // artist that DID succeed — collect events from whichever calls
      // came back, and only surface an error if literally all of them
      // failed.
      const allEvents = [];
      let failures = 0;
      for (const result of results) {
        if (result.status === 'fulfilled') {
          const events = (result.value._embedded?.events ?? []).filter(isStillHappening);
          allEvents.push(...events);
        } else {
          failures += 1;
          console.error('Ticketmaster proxy error (favorites):', result.reason);
        }
      }

      if (failures === results.length) {
        throw new Error(results[0].reason?.message || 'Onbekende fout');
      }

      // De-dupe (the same show can legitimately come back twice if two
      // saved artists are both playing it, e.g. a festival lineup) and
      // sort everything into one chronological list across all artists.
      const seenIds = new Set();
      const deduped = allEvents.filter((event) => {
        if (!event.id || seenIds.has(event.id)) return false;
        seenIds.add(event.id);
        return true;
      });
      deduped.sort((a, b) => eventTimestamp(a) - eventTimestamp(b));

      if (deduped.length === 0) {
        resultsEl.innerHTML = '';
        statusEl.textContent = 'Geen aankomende concerten gevonden voor je favorieten in dit land.';
        return;
      }

      resultsEl.insertAdjacentHTML('beforeend', deduped.map(renderCard).join(''));
      qsa('.fade-up', resultsEl).forEach((el) => el.classList.add('visible'));

      const countryLabel = COUNTRY_LABELS[countrySelect.value] ?? countrySelect.value;
      const failureNote = failures > 0 ? ` (${failures} favoriet${failures === 1 ? '' : 'en'} kon niet geladen worden)` : '';
      statusEl.textContent = `${deduped.length} resultaten in ${countryLabel} voor ${favoriteArtists.length} favoriet${
        favoriteArtists.length === 1 ? '' : 'en'
      }${failureNote}.`;
    } catch (error) {
      console.error('Ticketmaster proxy error (favorites):', error);
      statusEl.textContent = `❌ Kon geen data ophalen (${error.message}). Probeer het later opnieuw.`;
    } finally {
      state.loading = false;
    }
  }

  function eventTimestamp(event) {
    const start = event.dates?.start;
    if (!start?.localDate) return Number.POSITIVE_INFINITY; // undated shows sort last
    return new Date(`${start.localDate}T${start.localTime ?? '00:00:00'}`).getTime();
  }

  /** Skip events Ticketmaster marks as cancelled or postponed — they're
   *  not something you can actually still buy tickets for. */
  function isStillHappening(event) {
    const statusCode = event.dates?.status?.code;
    return statusCode !== 'cancelled' && statusCode !== 'postponed';
  }

  function emptyMessage(mode) {
    if (mode === 'sales') return 'Geen aankomende ticketverkoop gevonden voor dit land.';
    if (mode === 'search') return `Geen concerten gevonden voor “${state.keyword}”.`;
    return 'Geen aankomende concerten gevonden voor dit land.';
  }

  // ---- Rendering -------------------------------------------------

  function renderCard(event) {
    const venue = event._embedded?.venues?.[0];
    const dateLabel = formatEventDate(event.dates);
    const locationLabel = venue
      ? `${escapeHtml(venue.name)}, ${escapeHtml(venue.city?.name ?? '')}${
          venue.country?.countryCode ? ` (${venue.country.countryCode})` : ''
        }`
      : 'Locatie onbekend';

    const image = pickImage(event.images);
    const priceLabel = formatPriceRange(event.priceRanges);
    const saleBadges = renderSaleBadges(event.sales);

    return `
      <article class="tm-card fade-up visible">
        ${image ? `<div class="tm-card-image" style="background-image:url('${escapeHtml(image)}')" role="img" aria-label="${escapeHtml(event.name)}"></div>` : ''}
        <div class="tm-card-body">
          <h3>${escapeHtml(event.name)}</h3>
          <p class="tm-card-meta">📅 ${dateLabel}</p>
          <p class="tm-card-meta">📍 ${locationLabel}</p>
          ${saleBadges}
          ${priceLabel ? `<p class="tm-card-price">${priceLabel}</p>` : ''}
          <a href="${escapeHtml(event.url ?? '#')}" target="_blank" rel="noopener noreferrer" class="btn btn-outline btn-sm mt-1">
            Bekijk op Ticketmaster
          </a>
        </div>
      </article>
    `;
  }

  function renderSaleBadges(sales) {
    if (!sales) return '<p class="tm-badge tm-badge-muted">ℹ️ Verkoopinfo onbekend</p>';

    const badges = [];
    const publicSale = sales.public;

    if (publicSale?.startDateTime) {
      const start = new Date(publicSale.startDateTime);
      if (start.getTime() > Date.now()) {
        badges.push(`<p class="tm-badge tm-badge-upcoming">🟡 Verkoop start op ${formatDateTime(publicSale.startDateTime)}</p>`);
      } else {
        badges.push('<p class="tm-badge tm-badge-onsale">🟢 Nu in verkoop</p>');
      }
    } else if (publicSale?.startTBD || publicSale?.startTBA) {
      badges.push('<p class="tm-badge tm-badge-muted">🟡 Verkoopdatum nog niet bekend</p>');
    }

    const nextPresale = (sales.presales ?? [])
      .filter((presale) => new Date(presale.startDateTime).getTime() > Date.now())
      .sort((a, b) => new Date(a.startDateTime) - new Date(b.startDateTime))[0];

    if (nextPresale) {
      const label = nextPresale.name ? escapeHtml(nextPresale.name) : 'Presale';
      badges.push(`<p class="tm-badge tm-badge-presale">🔵 ${label} start op ${formatDateTime(nextPresale.startDateTime)}</p>`);
    }

    return badges.join('') || '<p class="tm-badge tm-badge-muted">ℹ️ Verkoopinfo onbekend</p>';
  }

  function pickImage(images) {
    if (!images || images.length === 0) return null;
    const wide = images.find((img) => img.ratio === '16_9' && img.width >= 400);
    return (wide ?? images[0]).url;
  }

  function formatPriceRange(priceRanges) {
    const range = priceRanges?.[0];
    if (!range) return null;
    const currency = range.currency === 'EUR' ? '€' : `${range.currency} `;
    if (range.min === range.max) return `${currency}${range.min}`;
    return `${currency}${range.min} – ${currency}${range.max}`;
  }

  function formatEventDate(dates) {
    const start = dates?.start;
    if (!start?.localDate) return 'Datum onbekend';
    const date = new Date(`${start.localDate}T${start.localTime ?? '00:00:00'}`);
    const dateStr = date.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
    if (start.noSpecificTime || !start.localTime) return dateStr;
    const timeStr = date.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
    return `${dateStr} · ${timeStr}`;
  }

  function formatDateTime(isoString) {
    return new Date(isoString).toLocaleString('nl-NL', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // ---- Favorites list (shared across devices) -----------------------
  // Talks to a SEPARATE Worker from the Ticketmaster proxy above — see
  // the module header comment. GET on init, PUT (whole list) on every
  // add/remove — same "send the whole array back" pattern as
  // lijstje.js's item saves, appropriate here too since this list is
  // small (tens of names, not thousands, see MAX_ARTISTS server-side).

  function renderFavoritesChips() {
    if (favoriteArtists.length === 0) {
      favoritesChips.innerHTML = '<p class="tm-favorites-empty-hint">Nog geen favorieten — voeg er hierboven een toe.</p>';
      return;
    }
    favoritesChips.innerHTML = favoriteArtists
      .map(
        (artist) => `
          <span class="tm-favorite-chip" data-artist="${escapeHtml(artist)}">
            ${escapeHtml(artist)}
            <button type="button" class="tm-favorite-chip-remove" aria-label="${escapeHtml(artist)} verwijderen uit favorieten">✕</button>
          </span>
        `
      )
      .join('');
  }

  async function loadFavoriteArtists() {
    if (!favoriteArtistsWorkerUrl || favoriteArtistsWorkerUrl.includes('YOUR-SUBDOMAIN')) {
      favoritesChips.innerHTML =
        '<p class="tm-favorites-empty-hint">⚠️ Geen favorieten-worker geconfigureerd. Zet favoriteArtistsWorkerUrl in assets/js/config.js, zie STAPPENPLAN-TICKETMASTER-FAVORIETEN.md.</p>';
      return;
    }
    try {
      const response = await fetch(`${favoriteArtistsWorkerUrl}/artists`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      favoriteArtists = Array.isArray(data.artists) ? data.artists : [];
    } catch (error) {
      console.error('Kon favoriete artiesten niet laden:', error);
      favoritesChips.innerHTML = '<p class="tm-favorites-empty-hint">❌ Kon favorieten niet laden. Probeer het later opnieuw.</p>';
      return;
    }
    renderFavoritesChips();
  }

  /** Sends the whole current `favoriteArtists` array to the Worker. On
   *  failure, rolls back to `previous` both locally and on screen —
   *  same optimistic-with-rollback pattern lijstje.js uses. */
  async function saveFavoriteArtists(previous) {
    try {
      const response = await fetch(`${favoriteArtistsWorkerUrl}/artists`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artists: favoriteArtists }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (Array.isArray(data.artists)) favoriteArtists = data.artists;
      renderFavoritesChips();
      return true;
    } catch (error) {
      console.error('Kon favoriete artiesten niet opslaan:', error);
      favoriteArtists = previous;
      renderFavoritesChips();
      statusEl.textContent = '❌ Kon favoriet niet opslaan. Probeer het opnieuw.';
      return false;
    }
  }

  async function addFavoriteArtist(name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (favoriteArtists.some((artist) => artist.toLowerCase() === trimmed.toLowerCase())) {
      favoriteInput.value = '';
      return; // already saved, nothing to do
    }

    const previous = favoriteArtists;
    favoriteArtists = [...favoriteArtists, trimmed];
    renderFavoritesChips();
    favoriteInput.value = '';

    const saved = await saveFavoriteArtists(previous);
    if (saved && state.mode === 'favorites') runQuery({ replace: true });
  }

  async function removeFavoriteArtist(name) {
    const previous = favoriteArtists;
    favoriteArtists = favoriteArtists.filter((artist) => artist !== name);
    renderFavoritesChips();

    const saved = await saveFavoriteArtists(previous);
    if (saved && state.mode === 'favorites') {
      if (favoriteArtists.length === 0) {
        resultsEl.innerHTML = '';
        statusEl.textContent = 'Nog geen favorieten opgeslagen — voeg hierboven een artiest toe.';
        loadMoreBtn.classList.add('hidden');
      } else {
        runQuery({ replace: true });
      }
    }
  }

  // ---- Wiring ------------------------------------------------------

  tabs.favorites.addEventListener('click', () => setMode('favorites'));
  tabs.upcoming.addEventListener('click', () => setMode('upcoming'));
  tabs.sales.addEventListener('click', () => setMode('sales'));
  tabs.search.addEventListener('click', () => setMode('search'));

  countrySelect.addEventListener('change', () => runQuery({ replace: true }));
  refreshBtn.addEventListener('click', () => runQuery({ replace: true }));
  loadMoreBtn.addEventListener('click', () => {
    state.page += 1;
    runQuery({ replace: false });
  });

  function triggerSearch() {
    const keyword = searchInput.value.trim();
    if (!keyword) return;
    state = { ...state, mode: 'search', keyword, page: 0 };
    runQuery({ replace: true });
  }

  searchBtn.addEventListener('click', triggerSearch);
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') triggerSearch();
  });
  // Debounced live search as the person types (3+ characters), on top of
  // the explicit button/Enter above for people who prefer that.
  searchInput.addEventListener(
    'input',
    debounce(() => {
      if (searchInput.value.trim().length >= 3) triggerSearch();
    }, 500)
  );

  favoriteAddBtn.addEventListener('click', () => addFavoriteArtist(favoriteInput.value));
  favoriteInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addFavoriteArtist(favoriteInput.value);
    }
  });
  favoritesChips.addEventListener('click', (event) => {
    const removeBtn = event.target.closest('.tm-favorite-chip-remove');
    if (!removeBtn) return;
    const artist = removeBtn.closest('.tm-favorite-chip')?.dataset.artist;
    if (artist) removeFavoriteArtist(artist);
  });

  // Initial load: fetch the saved favorites list first so the default
  // "favorites" tab has something to query — setMode('favorites') below
  // reads favoriteArtists synchronously, so it has to run after this
  // await resolves, not in parallel with it.
  (async function init() {
    await loadFavoriteArtists();
    setMode('favorites');
  })();
}
