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
//                           from travel-countries.json's "visitedCityPins"
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

import { escapeHtml, linkifyText, pinEdgeClasses } from './utils.js';
import { getAuth } from './auth.js';

/**
 * Title-cases a visitedCityPins/unvisitedCityPins lookup key for display
 * (those keys are stored lowercase purely for case-insensitive
 * matching, e.g. "schwäbisch hall" -> "Schwäbisch Hall").
 *
 * Deliberately NOT `\b\p{L}` — JS regex word-boundary (\b) is
 * ASCII-only under the hood, so on a name with a non-ASCII letter
 * (a diacritic like "ä", "á", "ë", ...) it misfires mid-word and
 * capitalizes the letter right AFTER the diacritic instead of the
 * word's actual first letter (e.g. "schwäbisch hall" was coming out
 * as "SchwÄBisch Hall"). Matching on an explicit boundary set
 * (start-of-string, space, slash, hyphen) instead sidesteps that
 * entirely and works correctly for every alphabet.
 */
function titleCaseCityName(key) {
  return key.replace(/(^|[\s/-])(\p{L})/gu, (_, boundary, letter) => boundary + letter.toUpperCase());
}

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

// Opens the lightbox with a given image + caption. The caption is
// rendered via linkifyText() (not textContent) so a working http(s)
// link inside a captions.json "longer description" — real photo or
// stock/moodboard photo alike — actually becomes clickable here.
function openPhotoLightbox(imageUrl, caption) {
  const els = getLightboxEls();
  if (!els) return;
  lastFocusedTrigger = document.activeElement;
  els.image.src = imageUrl;
  els.image.alt = caption || '';
  els.caption.innerHTML = linkifyText(caption || '');
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
 * Merge manually-measured pin coordinates (visitedCityPins from
 * travel-countries.json — real {lon,lat}, e.g. looked up on
 * Wikipedia) with a deterministic radial fallback for every city
 * that doesn't have one set yet. `project` is the SAME per-country
 * fit projection (assets/js/modules/geo-render.js) used to draw
 * that country's outline, so a precise city pin always lands
 * exactly where it should relative to the rendered borders.
 *
 * `cities` only contains cities the /travel Worker knows about (i.e.
 * ones with at least one captioned photo). Any city listed in
 * `visitedCityPins` that ISN'T in that list yet (no photos catalogued for
 * it so far) is synthesised here as a zero-photo entry, so it still
 * gets a pin on the map — clicking it just shows a "no photos yet"
 * hint (see loadCityPhotos in this file) instead of a photo grid.
 */
export function positionCities(cities, visitedCityPins = {}, project, projectionSize) {
  // A city only belongs on the "visited" side if EITHER the Worker
  // reports a real photo count > 0, OR it's explicitly listed in
  // visitedCityPins — the latter is what makes a city you've
  // manually pinned as visited (travel-countries.json) render green
  // immediately, even before you've catalogued/captioned a single
  // photo for it yet.
  //
  // A city that appears in the /travel response ONLY because of a
  // public stock/moodboard photo (count 0, not in visitedCityPins)
  // is skipped here entirely — it belongs on the wishlist side
  // (positionWishlistCities), which has its own real {lon,lat} for
  // it. Including it here too used to render a second "phantom" pin
  // for the same city, at a random radial-fallback position (no
  // {lon,lat} override exists for it in visitedCityPins) instead of
  // the correct spot — e.g. a wishlist Porto with stock photos was
  // showing up twice: once correctly (from unvisitedCityPins) and
  // once scattered randomly (from here).
  const known = new Map();
  cities.forEach((city) => {
    const key = city.name.trim().toLowerCase();
    const hasRealPhotos = (city.count || 0) > 0;
    const isManuallyVisited = Object.prototype.hasOwnProperty.call(visitedCityPins, key);
    if (!hasRealPhotos && !isManuallyVisited) return;
    known.set(key, { ...city, visited: true });
  });
  Object.keys(visitedCityPins).forEach((key) => {
    if (!known.has(key)) {
      // Title-case for display (visitedCityPins keys are lowercase for
      // matching purposes only) — see titleCaseCityName() above.
      const name = titleCaseCityName(key);
      known.set(key, { name, count: 0, visited: true });
    }
  });
  const allCities = Array.from(known.values());

  const unpositioned = [];
  const positioned = [];

  allCities.forEach((city) => {
    const override = visitedCityPins[city.name.trim().toLowerCase()];
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

/**
 * Positions "would like to visit" cities (unvisitedCityPins from
 * travel-countries.json) through the same per-country projection as
 * positionCities() above, so they land in the right spot on the map
 * too. Cities without a project/projectionSize (shouldn't normally
 * happen, since unvisitedCityPins always supplies real coordinates)
 * are skipped rather than guessed at with a radial fallback — a
 * wishlist pin in the wrong place is worse than no pin at all.
 *
 * Each entry is pinned by real {lon, lat} from travel-countries.json
 * — that file is ONLY ever responsible for the pin's position.
 * `cities` is the very same /travel response positionCities() above
 * uses, which (as of the Worker's stock-photo support) already
 * carries a `stockPhotos` array per place — matched here by name so
 * a wishlist pin's moodboard (short caption, click-to-enlarge with a
 * longer, linkified caption — see loadCityPhotos below) comes from
 * captions.json exactly like a real photo does, instead of being a
 * separate one-off field on this file.
 */
export function positionWishlistCities(unvisitedCityPins = {}, cities = [], project, projectionSize) {
  if (!project || !projectionSize) return [];
  const stockPhotosByName = new Map(cities.map((city) => [city.name.trim().toLowerCase(), city.stockPhotos || []]));
  return Object.entries(unvisitedCityPins)
    .filter(([, coords]) => Number.isFinite(coords.lon) && Number.isFinite(coords.lat))
    .map(([key, coords]) => {
      const [x, y] = project(coords.lon, coords.lat);
      const name = titleCaseCityName(key);
      return {
        name,
        wishlist: true,
        stockPhotos: stockPhotosByName.get(key.trim().toLowerCase()) || [],
        x: (x / projectionSize.width) * 100,
        y: (y / projectionSize.height) * 100,
        precise: true,
      };
    });
}

/** Renders pins into `frame`, wiring each to `onSelect(city, pinEl)`. Clears any previous city pins first. */
export function renderCityPins(frame, cities, onSelect) {
  frame.querySelectorAll('.rz-pin[data-city]').forEach((el) => el.remove());

  cities.forEach((city) => {
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.dataset.city = city.name;
    // Base .rz-pin-city color (--color-secondary, blue) already IS
    // the "Op verlanglijstje" legend dot — a wishlist city just
    // never gets .rz-pin-visited added, same as any other
    // not-yet-visited city pin.
    // Edge classes (see pinEdgeClasses() in utils.js) flip/shift the
    // label for any city pin that lands near the country map's
    // border — e.g. Miami on the US map — so the label never gets
    // clipped by the viewport or buried under the fixed
    // coord-badge/hover-label corners. Purely geometric, so it
    // applies to every country automatically.
    const classes = ['rz-pin', 'rz-pin-city', ...pinEdgeClasses(city.x, city.y)];
    if (city.visited) classes.push('rz-pin-visited');
    pin.className = classes.join(' ');
    pin.style.left = `${city.x}%`;
    pin.style.top = `${city.y}%`;
    pin.setAttribute('aria-label', city.wishlist
      ? `${city.name} (op verlanglijstje)`
      : `${city.name} (${city.count} foto${city.count === 1 ? '' : "'s"})`);

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

// Generic "nothing to show here" state — used for BOTH a visited
// city with no matching real photos yet AND a wishlist city with no
// stock photos yet. Deliberately terse (no captions.json/field-name
// instructions) — that's implementation detail, not something a
// visitor to the page needs to see. Centered via the existing
// .rz-city-panel-empty rule.
const NO_PHOTOS_HTML = `<p class="rz-city-panel-empty">Geen foto's beschikbaar.</p>`;

/**
 * Builds the shared "figure > button(.trigger > .image) + figcaption"
 * DOM structure for one photo card — used for BOTH real (private,
 * fetched via /photos + /photos/object) and stock/moodboard (public,
 * already-known URL) photos, so the two look and behave identically:
 * a short caption under the thumbnail, click it to open the lightbox
 * full-size with the longer (linkified) caption. Starts disabled/
 * shimmering; call fillPhotoCard() once the image URL is known.
 */
function buildPhotoCard(shortCaption) {
  const figure = document.createElement('figure');
  figure.className = 'rz-city-photo';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'rz-city-photo-trigger';
  trigger.disabled = true;
  trigger.setAttribute('aria-label', shortCaption ? `Vergroot: ${shortCaption}` : 'Foto vergroten');

  const image = document.createElement('span');
  image.className = 'rz-city-photo-image rz-city-photo-loading';
  image.setAttribute('aria-hidden', 'true');
  trigger.appendChild(image);
  figure.appendChild(trigger);

  if (shortCaption) {
    const figcaption = document.createElement('figcaption');
    figcaption.textContent = shortCaption;
    figure.appendChild(figcaption);
  }

  return { figure, trigger, image };
}

/** Reveals a photo card once its image URL is known, and wires its click-to-lightbox behavior with the given (longer) caption. */
function fillPhotoCard(card, imageUrl, longCaption) {
  card.image.style.backgroundImage = `url('${imageUrl}')`;
  card.image.classList.remove('rz-city-photo-loading');
  card.trigger.disabled = false;
  card.trigger.addEventListener('click', () => openPhotoLightbox(imageUrl, longCaption));
}

/** Marks a photo card as failed to load (real-photo fetch error) — stays disabled, shows the ⚠️ overlay. */
function failPhotoCard(card) {
  card.image.classList.remove('rz-city-photo-loading');
  card.image.classList.add('rz-city-photo-error');
}

/**
 * Renders a wishlist city's moodboard: its public stock photos
 * (city.stockPhotos — from captions.json via the Worker's /travel
 * endpoint, see positionWishlistCities() above), using the exact
 * same card/lightbox treatment as a real photo. Not gated behind
 * login: these are public stock photos illustrating a place we
 * haven't been yet, not private trip photos.
 */
function renderWishlistMoodboard(city, targetEl) {
  const stockPhotos = Array.isArray(city.stockPhotos) ? city.stockPhotos : [];

  if (stockPhotos.length === 0) {
    targetEl.innerHTML = NO_PHOTOS_HTML;
    return;
  }

  // No separate "op verlanglijstje" note above the grid — the panel
  // title above this (#reizenCityPanelTitle, set in reizen-land.js)
  // already shows "📍 <stad>", so this would've just repeated it.
  targetEl.innerHTML = '<div class="rz-city-photos"></div>';
  const grid = targetEl.querySelector('.rz-city-photos');

  stockPhotos.forEach(({ url, caption, captionLong }) => {
    const card = buildPhotoCard(caption);
    grid.appendChild(card.figure);

    // The URL is already public and directly usable — no fetch/auth
    // round-trip needed like the real-photo branch below — but it's
    // still an external hotlink that could 404/break, so probe it
    // with a throwaway Image() first rather than trusting it blindly
    // (same "skeleton first, fill in once confirmed" feel as real
    // photos, and a broken one just quietly drops its card).
    const probe = new Image();
    probe.onload = () => fillPhotoCard(card, url, captionLong || caption || city.name);
    probe.onerror = () => card.figure.remove();
    probe.src = url;
  });
}

/** Renders the (already-loaded) HTML for one city's photo grid into `targetEl`, or a locked/empty state. */
export async function loadCityPhotos({ workerUrl, city, countryLower, iso, targetEl, lockedNoteEl }) {
  targetEl.innerHTML = '';
  lockedNoteEl.classList.add('hidden');

  // Wishlist cities (travel-countries.json's unvisitedCityPins) are
  // places we'd like to go, not places we've catalogued real photos
  // for — their (public, unauthenticated) stock photos already came
  // back with the /travel city list, so there's no further /photos
  // lookup to do at all here.
  if (city.wishlist) {
    renderWishlistMoodboard(city, targetEl);
    return;
  }

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
      // Covers both "this city has real photos in R2 but none are
      // tagged with a country/place caption yet" AND "this pin only
      // exists because of a visitedCityPins coordinate override, the
      // Worker never even reported it" (see positionCities in this
      // file) — either way, nothing to show yet.
      targetEl.innerHTML = NO_PHOTOS_HTML;
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
      const longCaption = photo.captionLong || photo.caption || city.name;
      const card = buildPhotoCard(photo.caption);
      grid.appendChild(card.figure);
      return { photo, card, longCaption };
    });

    await Promise.all(cardRefs.map(async ({ photo, card, longCaption }) => {
      try {
        const imgResponse = await fetch(`${workerUrl}/photos/object?key=${encodeURIComponent(photo.key)}`, {
          headers: { Authorization: `Bearer ${auth.token}` },
        });
        if (!imgResponse.ok) throw new Error(`HTTP ${imgResponse.status}`);
        const blob = await imgResponse.blob();
        const objectUrl = URL.createObjectURL(blob);
        fillPhotoCard(card, objectUrl, longCaption);
      } catch (error) {
        console.error(`Kon foto "${photo.key}" niet laden:`, error);
        failPhotoCard(card);
      }
    }));
  } catch (error) {
    console.error('Kon foto\u2019s voor deze stad niet laden:', error);
    targetEl.innerHTML = `<p class="rz-city-panel-empty">❌ Kon foto's niet laden.</p>`;
  }
}
