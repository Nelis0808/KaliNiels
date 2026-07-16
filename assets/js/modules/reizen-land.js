// =================================================================
// ONZE REIZEN — COUNTRY VIEW (reizen/land.html)
// -----------------------------------------------------------------
// Reads ?iso=XX from the URL (an ISO 3166-1 alpha-2 code — see
// reizen.js, which links here from its country modal's "Volledige
// pagina" button, or bookmark/share this URL directly), renders
// that country's own high-detail outline from
// assets/data/countries/<ISO>.json (assets/js/modules/geo-render.js
// — real Natural Earth geometry, no external site involved), then:
//
//   1. Fits a projection to the country's own bounding box and
//      draws it as an SVG path, pannable/zoomable
//      (assets/js/modules/map-pan-zoom.js).
//   2. Asks the photo-gallery Cloudflare Worker's PUBLIC "/travel"
//      endpoint for every distinct city that appears in
//      captions.json for that country (see that worker's own
//      comment + STAPPENPLAN-REIZEN.md), and positions each one
//      either at a manually-measured real {lon,lat} from
//      travel-countries.json's "cityPins" (projected through the
//      exact same projection as the country outline, so it's always
//      pixel-perfect) or a deterministic radial fallback — see
//      reizen-cities.js.
//
// PRIVATE PAGE: unlike its previous "public map, gated photos"
// design, the ENTIRE "Onze Reizen" section (this page included) is
// now hidden behind the shared "👤 Profiel" login — see
// assets/js/modules/page-gate.js (wired up in main.js) and
// assets/js/modules/auth.js. This module doesn't need to check that
// itself: page-gate.js hides the whole #reizenLandApp container
// until you're logged in.
//
// The /travel endpoint this module calls (city names + counts, no
// filenames/bytes) is still technically public at the Worker level
// — see cloudflare-worker-photos/worker.js's own comment — but that
// no longer matters in practice since the page around it is gated
// client-side too.
//
// LOGIN REUSES the exact same shared session as every other gated
// feature on the site (photos.html, BlackJack, Spiderette) — log in
// once via the header, everything unlocks together.
// =================================================================

import { siteConfig } from '../config.js';
import { qs, escapeHtml, siteRootUrl } from './utils.js';
import { initPanZoom } from './map-pan-zoom.js';
import { loadCountryData, makeFitProjection, geometryToPathD } from './geo-render.js';
import { loadCities, positionCities, renderCityPins, loadCityPhotos } from './reizen-cities.js';
import { attachCoordHover } from './map-coord-hover.js';

const COUNTRIES_URL = new URL('../../data/travel-countries.json', import.meta.url);

export function initReizenLand() {
  const root = document.getElementById('reizenLandApp');
  if (!root) return; // not on this page

  const workerUrl = siteConfig.photos?.workerUrl || '';

  const headingEl = qs('#reizenLandHeading'); // lives in #hero, outside #reizenLandApp — query globally, not scoped to root
  const subEl = qs('#reizenLandSub', root);
  const statusEl = qs('#reizenLandStatus', root);
  const viewport = qs('#reizenLandMapViewport', root);
  const mapFrame = qs('#reizenLandMapFrame', root);
  const cityPanel = qs('#reizenCityPanel', root);
  const cityPanelTitle = qs('#reizenCityPanelTitle', root);
  const cityPhotosEl = qs('#reizenCityPhotos', root);
  const lockedNote = qs('#reizenLockedNote', root);

  const params = new URLSearchParams(window.location.search);
  const iso = (params.get('iso') || '').toUpperCase();

  if (!iso) {
    statusEl.textContent = 'Geen land gekozen — ga terug naar de kaart.';
    return;
  }

  let cities = [];
  let currentProjection = null;

  const zoom = initPanZoom(viewport, mapFrame, {
    onTap: (event) => {
      const pin = event.target.closest?.('.rz-pin[data-city]');
      if (!pin) return;
      const city = cities.find((c) => c.name === pin.dataset.city);
      if (city) selectCity(city, pin);
    },
  });
  qs('#reizenLandZoomIn', root)?.addEventListener('click', () => zoom.zoomIn());
  qs('#reizenLandZoomOut', root)?.addEventListener('click', () => zoom.zoomOut());
  qs('#reizenLandZoomReset', root)?.addEventListener('click', () => zoom.reset());
  attachCoordHover(viewport, zoom, () => currentProjection);

  async function selectCity(city, pinEl) {
    mapFrame.querySelector('.rz-pin-selected')?.classList.remove('rz-pin-selected');
    pinEl.classList.add('rz-pin-selected');

    cityPanel.classList.remove('hidden');
    cityPanelTitle.textContent = `📍 ${city.name}`;

    await loadCityPhotos({
      workerUrl,
      city,
      countryLower: city.__countryLower,
      iso,
      targetEl: cityPhotosEl,
      lockedNoteEl: lockedNote,
    });
  }

  // ---- Render the country's own outline (local data, no network round-trip beyond this one static file) ----
  async function loadBackground(displayName) {
    let feature;
    try {
      feature = await loadCountryData(iso);
    } catch (error) {
      console.error(`Kon geo-data voor "${iso}" niet laden:`, error);
    }

    if (!feature) {
      mapFrame.insertAdjacentHTML('afterbegin', `<p class="rz-map-bg-loading">❌ Kon de kaart van ${escapeHtml(displayName)} niet laden (assets/data/countries/${escapeHtml(iso)}.json ontbreekt of is corrupt).</p>`);
      return null;
    }

    const projection = makeFitProjection(feature.geometry, { targetWidth: 900 });
    currentProjection = projection;
    viewport.style.aspectRatio = projection.aspectRatio;
    mapFrame.insertAdjacentHTML('afterbegin', `<svg viewBox="${projection.viewBox}" class="rz-country-svg" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Kaart van ${escapeHtml(displayName)}"><path d="${geometryToPathD(feature.geometry, projection.project)}" class="rz-country-shape"></path></svg>`);
    return projection;
  }

  // ---- Load country display name (static, always available) ----
  // IMPORTANT: this also decides what we ask the /travel Worker for.
  // It only ever compares against whatever string is literally typed
  // in captions.json's 3rd field (see STAPPENPLAN-REIZEN.md — that's
  // usually a full name like "Portugal", not the two-letter "PT"
  // used in the URL), so we query by the resolved display NAME here,
  // falling back to the raw ?iso= value only if the country isn't in
  // the config file.
  fetch(COUNTRIES_URL)
    .then((response) => response.json())
    .then(async (data) => {
      const country = (data.countries || []).find((c) => c.iso.toUpperCase() === iso);
      const displayName = country?.name || iso;
      headingEl.textContent = `🌍 ${displayName}`;
      document.title = `${displayName} — Onze Reizen`;

      const projection = await loadBackground(displayName);
      loadCitiesForCountry(displayName, country?.cityPins || {}, projection);
    })
    .catch(async () => {
      headingEl.textContent = `🌍 ${iso}`;
      const projection = await loadBackground(iso);
      loadCitiesForCountry(iso, {}, projection);
    });

  // ---- Load cities for this country from the public travel endpoint ----
  function loadCitiesForCountry(countryQuery, cityPins, projection) {
    if (!workerUrl || workerUrl.includes('YOUR-SUBDOMAIN')) {
      statusEl.textContent = '⚠️ Nog geen Worker gekoppeld. Zie STAPPENPLAN-REIZEN.md.';
      subEl.textContent = '';
      return;
    }

    statusEl.textContent = 'Steden laden…';

    loadCities(workerUrl, countryQuery)
      .then((rawCities) => {
        if (rawCities.length === 0) {
          statusEl.textContent = 'Nog geen steden gecatalogiseerd voor dit land. Voeg "Land"/"Plaats" toe aan foto-bijschriften in captions.json.';
          subEl.textContent = '';
          return;
        }
        const countryLower = countryQuery.toLowerCase();
        cities = positionCities(rawCities, cityPins, projection?.project, projection).map((c) => ({ ...c, __countryLower: countryLower }));

        const visitedCount = cities.filter((c) => c.visited).length;
        const preciseCount = cities.filter((c) => c.precise).length;
        statusEl.textContent = `${cities.length} plek${cities.length === 1 ? '' : 'ken'} gevonden — klik op een pin voor de foto's.`;
        subEl.textContent = preciseCount > 0
          ? `${visitedCount} van ${cities.length} al bezocht · ${preciseCount} precies geplaatst.`
          : `${visitedCount} van ${cities.length} al bezocht.`;

        renderCityPins(mapFrame, cities, (city, pinEl) => selectCity(city, pinEl));
      })
      .catch((error) => {
        console.error('Kon steden niet laden:', error);
        statusEl.textContent = '❌ Kon steden niet laden van de Worker.';
        subEl.textContent = '';
      });
  }
}
