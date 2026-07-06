// =================================================================
// TICKETMASTER (ticketmaster.html)
// -----------------------------------------------------------------
// Shows live concert data from the Ticketmaster Discovery API in
// three modes:
//   - "upcoming" : general upcoming concerts (any artist)
//   - "sales"    : concerts whose public onsale hasn't started yet
//   - "search"   : concerts matching a specific artist/act name
// All three can be filtered by country.
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
// EXTENDING: want a 4th mode (e.g. "by venue")? Add it to the
// `MODES` set below, add a matching tab button in ticketmaster.html,
// and handle it the same way "search" is handled here.
// =================================================================

import { siteConfig } from '../config.js';
import { qs, qsa, escapeHtml, debounce } from './utils.js';

const PAGE_SIZE = 12;

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
    upcoming: qs('#tmTabUpcoming', root),
    sales: qs('#tmTabSales', root),
    search: qs('#tmTabSearch', root),
  };
  const searchRow = qs('#tmSearchRow', root);
  const searchInput = qs('#tmSearchInput', root);
  const searchBtn = qs('#tmSearchBtn', root);
  const countrySelect = qs('#tmCountry', root);
  const refreshBtn = qs('#tmRefresh', root);
  const statusEl = qs('#tmStatus', root);
  const resultsEl = qs('#tmResults', root);
  const loadMoreBtn = qs('#tmLoadMore', root);

  const workerUrl = siteConfig.ticketmaster?.workerUrl || '';
  countrySelect.value = siteConfig.ticketmaster?.defaultCountry ?? 'NL';

  // Current query state — rebuilt whenever a tab, filter, or search changes.
  let state = { mode: 'upcoming', keyword: '', page: 0, loading: false };

  function setMode(mode) {
    state = { ...state, mode, page: 0 };
    Object.entries(tabs).forEach(([key, btn]) => {
      btn.setAttribute('aria-selected', String(key === mode));
    });
    searchRow.classList.toggle('hidden', mode !== 'search');

    if (mode === 'search') {
      searchInput.focus();
      if (!state.keyword) {
        resultsEl.innerHTML = '';
        statusEl.textContent = 'Typ een artiest- of bandnaam en druk op zoeken.';
        loadMoreBtn.classList.add('hidden');
        return;
      }
    }
    runQuery({ replace: true });
  }

  function buildUrl(page) {
    const params = new URLSearchParams({
      mode: state.mode,
      page: String(page),
      size: String(PAGE_SIZE),
    });
    if (countrySelect.value) params.set('countryCode', countrySelect.value);
    if (state.mode === 'search') params.set('keyword', state.keyword);
    return `${workerUrl}?${params.toString()}`;
  }

  async function runQuery({ replace }) {
    if (!workerUrl || workerUrl.includes('YOUR-SUBDOMAIN')) {
      statusEl.textContent =
        '⚠️ Geen worker geconfigureerd. Zet je Cloudflare Worker-URL in assets/js/config.js (ticketmaster.workerUrl) — zie STAPPENPLAN.md.';
      resultsEl.innerHTML = '';
      loadMoreBtn.classList.add('hidden');
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
      const events = data._embedded?.events ?? [];
      const pageInfo = data.page ?? { number: 0, totalPages: 0, totalElements: 0 };

      if (replace && events.length === 0) {
        resultsEl.innerHTML = '';
        statusEl.textContent = emptyMessage(state.mode);
        loadMoreBtn.classList.add('hidden');
        return;
      }

      resultsEl.insertAdjacentHTML('beforeend', events.map(renderCard).join(''));
      qsa('.fade-up', resultsEl).forEach((el) => el.classList.add('visible')); // already-fetched cards don't need scroll-reveal delay

      const countryLabel = COUNTRY_LABELS[countrySelect.value] ?? countrySelect.value;
      statusEl.textContent = `${pageInfo.totalElements} resultaten in ${countryLabel}${
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

  // ---- Wiring ------------------------------------------------------

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

  // Initial load.
  setMode('upcoming');
}
