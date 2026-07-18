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
// map-pan-zoom.js) navigates straight to that country's own full
// page (reizen/land.html?iso=XX) — no intermediate modal/preview.
//
// PRIVATE PAGE: the ENTIRE "Onze Reizen" page (this map and every
// pin) is hidden behind the shared "👤 Profiel" login — see
// assets/js/modules/page-gate.js (wired up in main.js) and
// assets/js/modules/auth.js. This module (reizen.js) itself doesn't
// need to know or check that: page-gate.js hides the whole
// #reizenApp container until you're logged in, so nothing in here
// is ever visible to a logged-out visitor.
// =================================================================

import { qs, escapeHtml, siteRootUrl } from './utils.js';
import { initPanZoom } from './map-pan-zoom.js';
import { loadWorldData, makeWorldProjection, geometryToPathD } from './geo-render.js';
import { attachCoordHover } from './map-coord-hover.js';

const DATA_URL = new URL('../../data/travel-countries.json', import.meta.url);
const WORLD_SVG_WIDTH = 2000;

export function initReizen() {
  const root = document.getElementById('reizenApp');
  if (!root) return; // not on this page

  const viewport = qs('#reizenMapViewport', root);
  const mapFrame = qs('#reizenMapFrame', root);
  const statusEl = qs('#reizenStatus', root);

  let countries = [];
  let worldProjection = null;
  const isoNameMap = new Map(); // iso2 -> country name, from world-map.json

  // ---- Bottom-left "which country is this?" hover label -----------------
  const hoverLabel = document.createElement('div');
  hoverLabel.className = 'rz-hover-label hidden';
  viewport.appendChild(hoverLabel);

  function showHoverName(name) {
    if (!name) { hoverLabel.classList.add('hidden'); return; }
    hoverLabel.textContent = name;
    hoverLabel.classList.remove('hidden');
  }

  viewport.addEventListener('pointerover', (event) => {
    const shape = event.target.closest?.('.rz-country-shape');
    if (shape) {
      showHoverName(isoNameMap.get(shape.dataset.iso2));
      return;
    }
    const pin = event.target.closest?.('.rz-pin');
    if (pin) {
      const country = countries.find((c) => c.iso === pin.dataset.iso);
      showHoverName(country?.name);
    }
  });

  viewport.addEventListener('pointerout', (event) => {
    // Only hide if we're not moving to another shape/pin (avoids flicker
    // when crossing straight from one country's border into another's).
    const stillOnShape = event.relatedTarget?.closest?.('.rz-country-shape');
    const stillOnPin = event.relatedTarget?.closest?.('.rz-pin');
    if (!stillOnShape && !stillOnPin) hoverLabel.classList.add('hidden');
  });

  function goToCountry(country) {
    window.location.href = siteRootUrl(`reizen/land.html?iso=${encodeURIComponent(country.iso)}`);
  }

  const worldZoom = initPanZoom(viewport, mapFrame, {
    onTap: (event) => {
      const pin = event.target.closest?.('.rz-pin');
      if (!pin) return;
      const iso = pin.dataset.iso;
      const country = countries.find((c) => c.iso === iso);
      if (country) goToCountry(country);
    },
  });
  qs('#reizenZoomIn', root)?.addEventListener('click', () => worldZoom.zoomIn());
  qs('#reizenZoomOut', root)?.addEventListener('click', () => worldZoom.zoomOut());
  qs('#reizenZoomReset', root)?.addEventListener('click', () => worldZoom.reset());
  attachCoordHover(viewport, worldZoom, () => worldProjection);

  // ---- World map render + pins ------------------------------------------

  function renderWorldMap(worldFeatures) {
    const projection = makeWorldProjection(WORLD_SVG_WIDTH);
    worldProjection = projection;
    viewport.style.aspectRatio = projection.aspectRatio;
    const byIso = new Map(worldFeatures.map((f) => [f.properties.iso2, f]));
    worldFeatures.forEach((f) => isoNameMap.set(f.properties.iso2, f.properties.name));

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
    pin.setAttribute('aria-label', `${country.name} — klik om naar de landkaart te gaan`);

    pin.innerHTML = `
      <span class="rz-pin-scaler">
        <span class="rz-pin-dot" aria-hidden="true"></span>
        <span class="rz-pin-label">${escapeHtml(country.name)}</span>
      </span>
    `;

    pin.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        goToCountry(country);
      }
    });

    mapFrame.appendChild(pin);
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
      statusEl.textContent = `${countries.length} landen op de kaart — sleep om te verschuiven, scroll/knijp om te zoomen, klik een pin om naar dat land te gaan.`;
      renderWorldMap(worldData.features);
    })
    .catch((error) => {
      console.error('Kon reisdata niet laden:', error);
      statusEl.textContent = '❌ Kon de kaart niet laden.';
    });
}
