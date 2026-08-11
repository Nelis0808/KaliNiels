// =================================================================
// ONZE REIZEN — shared city-pin helpers
// -----------------------------------------------------------------
// Used by the full country page (reizen/land.html via
// reizen-land.js). Three jobs:
//
//   1. loadCities()      — ask the photo-gallery Worker's public
//                           /travel endpoint which cities exist for
//                           a country (see that worker's own
//                           comment + ACTION-EXPANSION-PLAN.md).
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
//                           gated behind the SAME site-wide session
//                           as photos.html (see assets/js/modules/
//                           auth.js — one login in the sticky
//                           header, not a separate one per page).
//                           Each thumbnail is a button — click it to
//                           open the #reizenPhotoLightbox (markup in
//                           reizen/land.html) full-size with its
//                           longer caption, same pattern as
//                           photo-gallery.js's #pgLightbox.
// =================================================================

import { escapeHtml } from './utils.js';
import { getAuth } from './auth.js';

// ---- Photo lightbox (click a thumbnail to see it full-size with its
// longer caption) — lazily wired up on first use, since the markup
// (#reizenPhotoLightbox) only exists on reizen/land.html. ----------
let lightboxEls = null;
let lastFocusedTrigger = null;

// Finds (or lazily caches) the lightbox elements and wires up its close handlers
function getLightboxEls() {
  if (lightboxEls) return lightboxEls;
  const lightbox = document.getElementById('reizenPhotoLightbox');
  if (!lightbox) return null; // not on this page

  lightboxEls = {
    lightbox,
    image: document.getElementById('reizenPhotoLightboxImage'),
    caption: document.getElementById('reizenPhotoLightboxCaption'),
    close: document.getElementById('reizenPhotoLightboxClose'),
  };

  lightboxEls.close.addEventListener('click', closePhotoLightbox);
  lightbox.addEventListener('click', (event) => {
    if (event.target === lightbox) closePhotoLightbox();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !lightbox.classList.contains('hidden')) closePhotoLightbox();
  });

  return lightboxEls;
}

// Opens the lightbox with a given image + caption
function openPhotoLightbox(imageUrl, caption) {
  const els = getLightboxEls();
  if (!els) return;
  lastFocusedTrigger = document.activeElement;
  els.image.src = imageUrl;
  els.image.alt = caption || '';
  els.caption.textContent = caption || '';
  els.lightbox.classList.remove('hidden');
  document.body.classList.add('rz-photo-lightbox-locked'); // prevents background scroll
  els.close.focus();
}

// Closes the lightbox and returns focus to whatever triggered it
function closePhotoLightbox() {
  if (!lightboxEls) return;
  lightboxEls.lightbox.classList.add('hidden');
  document.body.classList.remove('rz-photo-lightbox-locked');
  lightboxEls.image.src = '';
  if (lastFocusedTrigger) lastFocusedTrigger.focus();
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

  const auth = getAuth();
  if (!auth) {
    lockedNoteEl.innerHTML = `Log in via <strong>👤 Profiel</strong> (rechtsboven) om de echte foto's van ${escapeHtml(city.name)} hier te zien.`;
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

    targetEl.innerHTML = '<div class="rz-city-photos"></div>';
    const grid = targetEl.querySelector('.rz-city-photos');

    // Build skeleton cards first, in the right order (DOM refs kept
    // directly, no re-querying by key needed), then fill each one in
    // as its bytes arrive, in parallel — same pattern as
    // photo-gallery.js's loadPhotos().
    const cardRefs = matches.map((photo) => {
      // Long caption (shown in the lightbox) falls back to the short
      // one if captions.json didn't provide a longer variant.
      const longCaption = photo.captionLong || photo.caption;

      const figure = document.createElement('figure');
      figure.className = 'rz-city-photo';

      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'rz-city-photo-trigger';
      trigger.disabled = true;
      trigger.setAttribute('aria-label', photo.caption ? `Vergroot: ${photo.caption}` : 'Foto vergroten');

      const image = document.createElement('span');
      image.className = 'rz-city-photo-image rz-city-photo-loading';
      image.setAttribute('aria-hidden', 'true');
      trigger.appendChild(image);
      trigger.addEventListener('click', () => {
        if (trigger.dataset.imageUrl) openPhotoLightbox(trigger.dataset.imageUrl, longCaption || city.name);
      });
      figure.appendChild(trigger);

      if (photo.caption) {
        const caption = document.createElement('figcaption');
        caption.textContent = photo.caption;
        figure.appendChild(caption);
      }

      grid.appendChild(figure);
      return { photo, image, trigger };
    });

    await Promise.all(cardRefs.map(async ({ photo, image, trigger }) => {
      try {
        const imgResponse = await fetch(`${workerUrl}/photos/object?key=${encodeURIComponent(photo.key)}`, {
          headers: { Authorization: `Bearer ${auth.token}` },
        });
        if (!imgResponse.ok) throw new Error(`HTTP ${imgResponse.status}`);
        const blob = await imgResponse.blob();
        const objectUrl = URL.createObjectURL(blob);
        image.style.backgroundImage = `url('${objectUrl}')`;
        image.classList.remove('rz-city-photo-loading');
        trigger.dataset.imageUrl = objectUrl;
        trigger.disabled = false;
      } catch (error) {
        console.error(`Kon foto "${photo.key}" niet laden:`, error);
        image.classList.remove('rz-city-photo-loading');
        image.classList.add('rz-city-photo-error');
      }
    }));
  } catch (error) {
    console.error('Kon foto\u2019s voor deze stad niet laden:', error);
    targetEl.innerHTML = `<p class="rz-city-panel-empty">❌ Kon foto's niet laden.</p>`;
  }
}
