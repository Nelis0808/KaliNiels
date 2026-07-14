// =================================================================
// ONZE REIZEN — shared city-pin helpers
// -----------------------------------------------------------------
// Used by BOTH the quick country modal on the world map (reizen.js)
// and the full country page (reizen/land.html via reizen-land.js),
// so the two never drift apart. Three jobs:
//
//   1. loadCities()      — ask the photo-gallery Worker's public
//                           /travel endpoint which cities exist for
//                           a country (see that worker's own
//                           comment + STAPPENPLAN-REIZEN.md).
//   2. positionCities()  — decide where each city's pin goes: a
//                           manually-measured real-world {lon,lat}
//                           from travel-countries.json's "cityPins"
//                           (see that file's comment), projected
//                           through the country's own fit projection
//                           (assets/js/modules/geo-render.js) so it
//                           lines up exactly with the rendered
//                           borders — or a deterministic radial
//                           fallback when no coordinates are set,
//                           so pins never overlap even with zero
//                           manual data.
//   3. loadCityPhotos()  — fetch + decrypt-free-load the actual
//                           thumbnails for one city from the Worker,
//                           gated behind the same login as
//                           photos.html (see photo-gallery.js).
// =================================================================

import { escapeHtml, siteRootUrl } from './utils.js';

const AUTH_STORAGE_KEY = 'photoGalleryAuth'; // same key photo-gallery.js uses — shared session

export function getStoredPhotoAuth() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const auth = JSON.parse(raw);
    if (!auth?.token || !auth?.exp || auth.exp * 1000 < Date.now()) return null;
    return auth;
  } catch {
    return null;
  }
}

export async function loadCities(workerUrl, countryQuery) {
  const response = await fetch(`${workerUrl}/travel?country=${encodeURIComponent(countryQuery)}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return Array.isArray(data.cities) ? data.cities : [];
}

/**
 * Merge manually-measured pin coordinates (cityPins from
 * travel-countries.json — real {lon,lat}, e.g. looked up on
 * Wikipedia) with a deterministic radial fallback for every city
 * that doesn't have one set yet. `project` is the SAME per-country
 * fit projection (assets/js/modules/geo-render.js) used to draw
 * that country's outline, so a precise city pin always lands
 * exactly where it should relative to the rendered borders.
 */
export function positionCities(cities, cityPins = {}, project, projectionSize) {
  const unpositioned = [];
  const positioned = [];

  cities.forEach((city) => {
    const override = cityPins[city.name.trim().toLowerCase()];
    if (override && Number.isFinite(override.lon) && Number.isFinite(override.lat) && project && projectionSize) {
      const [x, y] = project(override.lon, override.lat);
      positioned.push({
        ...city,
        x: (x / projectionSize.width) * 100,
        y: (y / projectionSize.height) * 100,
        precise: true,
      });
    } else {
      unpositioned.push(city);
    }
  });

  const count = unpositioned.length;
  unpositioned.forEach((city, index) => {
    const angle = (index / Math.max(count, 1)) * Math.PI * 2 + 0.4;
    const radius = 28 + ((index * 37) % 18); // slight radius jitter, still deterministic
    const x = 50 + Math.cos(angle) * radius;
    const y = 50 + Math.sin(angle) * radius * 0.55; // flatten vertically to fit a wide frame
    positioned.push({
      ...city,
      x: Math.min(94, Math.max(6, x)),
      y: Math.min(90, Math.max(10, y)),
      precise: false,
    });
  });

  return positioned;
}

/** Renders pins into `frame`, wiring each to `onSelect(city, pinEl)`. Clears any previous city pins first. */
export function renderCityPins(frame, cities, onSelect) {
  frame.querySelectorAll('.rz-pin[data-city]').forEach((el) => el.remove());

  cities.forEach((city) => {
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.dataset.city = city.name;
    pin.className = `rz-pin rz-pin-city ${city.visited ? 'rz-pin-visited' : ''}`;
    pin.style.left = `${city.x}%`;
    pin.style.top = `${city.y}%`;
    pin.setAttribute('aria-label', `${city.name} (${city.count} foto${city.count === 1 ? '' : "'s"})`);

    pin.innerHTML = `
      <span class="rz-pin-scaler">
        <span class="rz-pin-dot" aria-hidden="true"></span>
        <span class="rz-pin-label">${escapeHtml(city.name)}</span>
      </span>
    `;

    frame.appendChild(pin);
    onSelect && pin.addEventListener('click', () => onSelect(city, pin));
  });
}

/** Renders the (already-loaded) HTML for one city's photo grid into `targetEl`, or a locked/empty state. */
export async function loadCityPhotos({ workerUrl, city, countryLower, iso, targetEl, lockedNoteEl }) {
  targetEl.innerHTML = '';
  lockedNoteEl.classList.add('hidden');

  const auth = getStoredPhotoAuth();
  if (!auth) {
    lockedNoteEl.innerHTML = `Log in via <a href="${siteRootUrl('photos.html')}">Onze Foto's</a> om de echte foto's van ${escapeHtml(city.name)} hier te zien.`;
    lockedNoteEl.classList.remove('hidden');
    return;
  }

  if (!workerUrl) return;

  try {
    const response = await fetch(`${workerUrl}/photos`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    const cityNameLower = city.name.trim().toLowerCase();
    const matches = (data.photos || []).filter((photo) => {
      const photoCountryLower = (photo.country || '').trim().toLowerCase();
      const photoPlaceLower = (photo.place || '').trim().toLowerCase();
      const countryMatches = photoCountryLower === iso.toLowerCase() || photoCountryLower === countryLower;
      return countryMatches && photoPlaceLower === cityNameLower;
    });

    if (matches.length === 0) {
      targetEl.innerHTML = `<p class="rz-city-panel-empty">Geen foto's gevonden voor ${escapeHtml(city.name)}.</p>`;
      return;
    }

    const cards = await Promise.all(matches.map(async (photo) => {
      const imgResponse = await fetch(`${workerUrl}/photos/object?key=${encodeURIComponent(photo.key)}`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!imgResponse.ok) return '';
      const blob = await imgResponse.blob();
      const objectUrl = URL.createObjectURL(blob);
      return `
        <figure class="rz-city-photo">
          <img src="${objectUrl}" alt="${escapeHtml(photo.caption || city.name)}">
          ${photo.caption ? `<figcaption>${escapeHtml(photo.caption)}</figcaption>` : ''}
        </figure>
      `;
    }));

    targetEl.innerHTML = `<div class="rz-city-photos">${cards.join('')}</div>`;
  } catch (error) {
    console.error('Kon foto\u2019s voor deze stad niet laden:', error);
    targetEl.innerHTML = `<p class="rz-city-panel-empty">❌ Kon foto's niet laden.</p>`;
  }
}
