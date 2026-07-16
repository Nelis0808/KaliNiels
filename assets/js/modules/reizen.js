// =================================================================
// ONZE REIZEN — WORLD MAP (reizen.html)
// -----------------------------------------------------------------
// Renders every country in assets/data/world-map.json as an SVG
// outline (Natural Earth data, see assets/js/modules/geo-render.js),
// pannable/zoomable via assets/js/modules/map-pan-zoom.js, with one
// pin per entry in assets/data/travel-countries.json. A pin's
// position is computed automatically from real geography — that
// country's mainland centroid by default, or a manually-set
// {lon,lat} (e.g. its capital) if travel-countries.json has a "pin"
// override — projected through the exact same projection used to
// draw the map, so it always lines up pixel-perfectly. No manual
// pixel-percentage guessing, ever.
//
// INTERACTION: tap/click a pin (drags don't count — see
// map-pan-zoom.js) opens a modal that renders that country's own
// high-detail outline (assets/data/countries/<ISO>.json) and shows
// its cities as pins on top of it — same idea as reizen/land.html's
// full-page version but without leaving the world map. Because this
// is all local static data, opening a country is instant: no
// network round-trip, nothing that can be blocked or rate-limited.
//
// PRIVATE PAGE: the ENTIRE "Onze Reizen" page (this map, every pin,
// the city names, and of course the real photo thumbnails) is
// hidden behind the shared "👤 Profiel" login — see
// assets/js/modules/page-gate.js (wired up in main.js) and
// assets/js/modules/auth.js. This module (reizen.js) itself doesn't
// need to know or check that: page-gate.js hides the whole
// #reizenApp container until you're logged in, so nothing in here
// is ever visible to a logged-out visitor.
// =================================================================

import { siteConfig } from '../config.js';
import { qs, escapeHtml, siteRootUrl } from './utils.js';
import { initPanZoom } from './map-pan-zoom.js';
import { loadWorldData, loadCountryData, makeWorldProjection, makeFitProjection, geometryToPathD } from './geo-render.js';
import { loadCities, positionCities, renderCityPins, loadCityPhotos } from './reizen-cities.js';
import { attachCoordHover } from './map-coord-hover.js';

const DATA_URL = new URL('../../data/travel-countries.json', import.meta.url);
const WORLD_SVG_WIDTH = 2000;

export function initReizen() {
  const root = document.getElementById('reizenApp');
  if (!root) return; // not on this page

  const viewport = qs('#reizenMapViewport', root);
  const mapFrame = qs('#reizenMapFrame', root);
  const statusEl = qs('#reizenStatus', root);

  const modal = qs('#reizenCountryModal');
  const modalClose = qs('#reizenCountryModalClose', modal);
  const modalTitle = qs('#reizenCountryModalTitle', modal);
  const modalMeta = qs('#reizenCountryModalMeta', modal);
  const modalStatus = qs('#reizenCountryModalStatus', modal);
  const modalViewport = qs('#reizenCountryModalViewport', modal);
  const modalFrame = qs('#reizenCountryModalFrame', modal);
  const modalFull = qs('#reizenCountryModalFull', modal);
  const modalCityPanel = qs('#reizenModalCityPanel', modal);
  const modalCityPanelTitle = qs('#reizenModalCityPanelTitle', modal);
  const modalCityPhotos = qs('#reizenModalCityPhotos', modal);
  const modalLockedNote = qs('#reizenModalLockedNote', modal);

  const photosWorkerUrl = siteConfig.photos?.workerUrl || '';

  let countries = [];
  let openRequestId = 0; // guards against a slow load resolving after the modal was closed/reopened
  let activeCountry = null; // whichever country the modal is currently showing — read by modalPanZoom's onTap
  let worldProjection = null;
  let modalProjection = null;

  const worldZoom = initPanZoom(viewport, mapFrame, {
    onTap: (event) => {
      const pin = event.target.closest?.('.rz-pin');
      if (!pin) return;
      const iso = pin.dataset.iso;
      const country = countries.find((c) => c.iso === iso);
      if (country) openCountryModal(country, pin);
    },
  });
  qs('#reizenZoomIn', root)?.addEventListener('click', () => worldZoom.zoomIn());
  qs('#reizenZoomOut', root)?.addEventListener('click', () => worldZoom.zoomOut());
  qs('#reizenZoomReset', root)?.addEventListener('click', () => worldZoom.reset());
  attachCoordHover(viewport, worldZoom, () => worldProjection);

  const modalPanZoom = initPanZoom(modalViewport, modalFrame, {
    onTap: (event) => {
      const cityPin = event.target.closest?.('.rz-pin[data-city]');
      if (!cityPin) return;
      const city = activeCountry?.__cities?.find((c) => c.name === cityPin.dataset.city);
      if (city) selectModalCity(city);
    },
  });
  attachCoordHover(modalViewport, modalPanZoom, () => modalProjection);

  function closeModal() {
    modal.classList.add('hidden');
    document.body.classList.remove('rz-modal-locked');
    activeCountry = null;
    modalProjection = null;
    modalFrame.innerHTML = '';
    modalCityPanel.classList.add('hidden');
  }

  modalClose.addEventListener('click', closeModal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.classList.contains('hidden')) closeModal();
  });

  // ---- World map render + pins ------------------------------------------

  function renderWorldMap(worldFeatures) {
    const projection = makeWorldProjection(WORLD_SVG_WIDTH);
    worldProjection = projection;
    viewport.style.aspectRatio = projection.aspectRatio;
    const byIso = new Map(worldFeatures.map((f) => [f.properties.iso2, f]));

    const pathMarkup = worldFeatures
      .map((f) => `<path d="${geometryToPathD(f.geometry, projection.project)}" class="rz-country-shape" data-iso2="${f.properties.iso2}"></path>`)
      .join('');
    const svg = `<svg viewBox="${projection.viewBox}" class="rz-world-svg" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Wereldkaart">${pathMarkup}</svg>`;
    mapFrame.insertAdjacentHTML('afterbegin', svg);

    countries.forEach((country) => {
      const feature = byIso.get(country.iso.toUpperCase());
      const lonLat = country.pin && Number.isFinite(country.pin.lon) && Number.isFinite(country.pin.lat)
        ? [country.pin.lon, country.pin.lat]
        : feature?.properties?.centroid;
      if (!lonLat) {
        console.warn(`Geen geo-data gevonden voor land "${country.iso}" — niet op de kaart geplaatst.`);
        return;
      }
      const [x, y] = projection.project(lonLat[0], lonLat[1]);
      country.__x = (x / projection.width) * 100;
      country.__y = (y / projection.height) * 100;
      renderPin(country);
    });
  }

  function renderPin(country) {
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.dataset.iso = country.iso;
    pin.className = `rz-pin rz-pin-${country.status === 'visited' ? 'visited' : 'wishlist'}`;
    pin.style.left = `${country.__x}%`;
    pin.style.top = `${country.__y}%`;
    pin.setAttribute('aria-label', `${country.name} — klik om de landkaart te bekijken`);

    pin.innerHTML = `
      <span class="rz-pin-scaler">
        <span class="rz-pin-dot" aria-hidden="true"></span>
        <span class="rz-pin-label">${escapeHtml(country.name)}</span>
      </span>
    `;

    pin.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openCountryModal(country, pin);
      }
    });

    mapFrame.appendChild(pin);
  }

  // ---- Country modal ---------------------------------------------------

  async function selectModalCity(city) {
    qs('.rz-pin-selected', modalFrame)?.classList.remove('rz-pin-selected');
    modalFrame.querySelector(`.rz-pin[data-city="${CSS.escape(city.name)}"]`)?.classList.add('rz-pin-selected');

    modalCityPanel.classList.remove('hidden');
    modalCityPanelTitle.textContent = `📍 ${city.name}`;

    await loadCityPhotos({
      workerUrl: photosWorkerUrl,
      city,
      countryLower: city.__countryLower,
      iso: city.__iso,
      targetEl: modalCityPhotos,
      lockedNoteEl: modalLockedNote,
    });
  }

  async function openCountryModal(country, pinEl) {
    qs('.rz-pin-selected', mapFrame)?.classList.remove('rz-pin-selected');
    pinEl.classList.add('rz-pin-selected');

    const requestId = ++openRequestId;
    activeCountry = country;

    modal.classList.remove('hidden');
    document.body.classList.add('rz-modal-locked');
    modalTitle.textContent = country.name;
    modalMeta.textContent = country.status === 'visited' ? 'Hier zijn we al geweest ✅' : 'Nog op het verlanglijstje ✨';
    modalStatus.textContent = 'Landkaart laden…';
    modalFrame.innerHTML = '';
    modalCityPanel.classList.add('hidden');
    modalFull.href = siteRootUrl(`reizen/land.html?iso=${encodeURIComponent(country.iso)}`);
    modalProjection = null;
    modalViewport.style.aspectRatio = '4 / 3';
    modalPanZoom.reset();

    let feature;
    try {
      feature = await loadCountryData(country.iso);
    } catch (error) {
      console.error(`Kon geo-data voor "${country.iso}" niet laden:`, error);
    }

    if (requestId !== openRequestId) return; // modal was closed/reopened while we waited

    if (!feature) {
      modalStatus.textContent = `❌ Kon de kaart van ${country.name} niet laden (assets/data/countries/${country.iso}.json ontbreekt of is corrupt).`;
      return;
    }

    const projection = makeFitProjection(feature.geometry, { targetWidth: 1000 });
    modalProjection = projection;
    modalViewport.style.aspectRatio = projection.aspectRatio;
    modalFrame.insertAdjacentHTML('afterbegin', `<svg viewBox="${projection.viewBox}" class="rz-country-svg" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Kaart van ${escapeHtml(country.name)}"><path d="${geometryToPathD(feature.geometry, projection.project)}" class="rz-country-shape"></path></svg>`);

    if (!photosWorkerUrl || photosWorkerUrl.includes('YOUR-SUBDOMAIN')) {
      modalStatus.textContent = '⚠️ Nog geen photo-gallery Worker gekoppeld, dus geen steden. Zie STAPPENPLAN-REIZEN.md.';
      return;
    }

    modalStatus.textContent = 'Steden laden…';
    try {
      const cities = await loadCities(photosWorkerUrl, country.name);
      if (requestId !== openRequestId) return;

      if (cities.length === 0) {
        modalStatus.textContent = 'Nog geen steden gecatalogiseerd voor dit land.';
        return;
      }

      const positioned = positionCities(cities, country.cityPins || {}, projection.project, projection).map((c) => ({
        ...c,
        __countryLower: country.name.toLowerCase(),
        __iso: country.iso,
      }));
      country.__cities = positioned;

      const preciseCount = positioned.filter((c) => c.precise).length;
      modalStatus.textContent = preciseCount > 0
        ? `${positioned.length} plek${positioned.length === 1 ? '' : 'ken'} — klik op een pin voor de foto's.`
        : `${positioned.length} plek${positioned.length === 1 ? '' : 'ken'} (bij benadering geplaatst) — klik op een pin voor de foto's.`;

      renderCityPins(modalFrame, positioned, (city) => selectModalCity(city));
    } catch (error) {
      console.error('Kon steden niet laden:', error);
      modalStatus.textContent = '❌ Kon steden niet laden van de Worker.';
    }
  }

  // ---- Boot --------------------------------------------------------

  Promise.all([
    fetch(DATA_URL).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    }),
    loadWorldData(),
  ])
    .then(([data, worldData]) => {
      countries = Array.isArray(data.countries) ? data.countries : [];

      if (countries.length === 0) {
        statusEl.textContent = 'Nog geen landen toegevoegd aan assets/data/travel-countries.json.';
        return;
      }
      statusEl.textContent = `${countries.length} landen op de kaart — sleep om te verschuiven, scroll/knijp om te zoomen, klik een pin voor de landkaart.`;
      renderWorldMap(worldData.features);
    })
    .catch((error) => {
      console.error('Kon reisdata niet laden:', error);
      statusEl.textContent = '❌ Kon de kaart niet laden.';
    });
}
