// =================================================================
// PRIVATE PHOTO GALLERY (photos.html)
// -----------------------------------------------------------------
// Talks ONLY to the photo-gallery Cloudflare Worker (see
// /cloudflare-worker-photos + PHOTO-GALLERY.md) — never directly
// to any storage. The real photos live in a private R2 bucket that
// only that worker can read; this module never sees them until a
// valid session token has been handed back by the worker.
//
// LOGIN: there is no login form on this page anymore. Logging in
// happens ONCE, site-wide, via the "👤 Profiel" dropdown in the
// sticky header (assets/js/modules/auth.js +
// assets/js/modules/profile-dropdown.js) — the exact same session
// also unlocks the real photo thumbnails on Onze Reizen
// (reizen-cities.js) and the extra features on BlackJack/Spiderette.
// This module just listens for that shared session via
// onAuthChange() and shows/hides the gallery accordingly.
//
// CAPTIONS: each photo can carry two captions — `caption` (short,
// always shown under the thumbnail) and `captionLong` (shown in the
// lightbox when you click the photo, falls back to `caption` if not
// set). Both come from captions.json in the R2 bucket via the worker
// — see cloudflare-worker-photos/captions.example.json for the format.
//
// EXTENDING: want a 3rd person? Add a PASSPHRASE_C secret + a 'c'
// branch in the worker's /login handler, and add 'c' to
// `siteConfig.photos.personLabels` here on the site side.
// =================================================================

import { siteConfig } from '../config.js';
import { qs } from './utils.js';
import { getAuth, onAuthChange, currentPersonLabel } from './auth.js';

export function initPhotoGallery() {
  const root = document.getElementById('photoGalleryApp');
  if (!root) return; // not on this page

  const workerUrl = siteConfig.photos?.workerUrl || '';

  const loggedOutNote     = qs('#pgLoggedOutNote', root);
  const loggedInBar       = qs('#pgLoggedInBar', root);
  const loggedInLabel     = qs('#pgLoggedInLabel', root);
  const placeholderGrid   = qs('#pgPlaceholder', root);
  const resultsGrid       = qs('#pgResults', root);
  const statusEl          = qs('#pgStatus', root);

  const lightbox        = qs('#pgLightbox', root);
  const lightboxImage   = qs('#pgLightboxImage', lightbox);
  const lightboxCaption = qs('#pgLightboxCaption', lightbox);
  const lightboxClose   = qs('#pgLightboxClose', lightbox);

  // ---- View toggling ----------------------------------------------
  function showLoggedOut(message) {
    loggedOutNote.classList.remove('hidden');
    loggedInBar.classList.add('hidden');
    placeholderGrid.classList.remove('hidden');
    resultsGrid.classList.add('hidden');
    resultsGrid.innerHTML = '';
    statusEl.textContent = message || '';
  }

  function showLoggedIn() {
    loggedOutNote.classList.add('hidden');
    loggedInBar.classList.remove('hidden');
    placeholderGrid.classList.add('hidden');
    resultsGrid.classList.remove('hidden');
    loggedInLabel.textContent = currentPersonLabel();
  }

  function workerConfigured() {
    return workerUrl && !workerUrl.includes('YOUR-SUBDOMAIN');
  }

  // ---- Networking ---------------------------------------------------
  async function loadPhotos(token) {
    statusEl.textContent = 'Loading photo\u2019s';
    resultsGrid.innerHTML = '';

    try {
      const response = await fetch(`${workerUrl}/photos`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.status === 401) {
        showLoggedOut('Sessie verlopen, log opnieuw in via je profiel.');
        return;
      }

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

      if (data.photos.length === 0) {
        statusEl.textContent = 'No photo has been uploaded\u2019s. See PHOTO-GALLERY.md how to add.';
        return;
      }

      statusEl.textContent = `${data.photos.length} foto's`;

      // Build skeleton cards first (DOM refs kept directly — no
      // querying by filename needed, so odd characters in filenames
      // are never a problem), then fill each one in as its bytes
      // arrive, in parallel.
      const cardRefs = data.photos.map((photo) => {
        const figure = document.createElement('figure');
        figure.className = 'pg-card';

        // Long caption (shown in the lightbox) falls back to the short
        // one if the worker/captions.json didn't provide a longer variant.
        const longCaption = photo.captionLong || photo.caption;

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'pg-card-trigger';
        trigger.disabled = true;
        trigger.setAttribute('aria-label', photo.caption ? `Vergroot: ${photo.caption}` : 'Foto vergroten');

        const imageDiv = document.createElement('div');
        imageDiv.className = 'pg-card-image pg-card-loading';
        imageDiv.setAttribute('aria-hidden', 'true');
        trigger.appendChild(imageDiv);
        trigger.addEventListener('click', () => {
          if (trigger.dataset.imageUrl) openLightbox(trigger.dataset.imageUrl, longCaption);
        });
        figure.appendChild(trigger);

        if (photo.caption) {
          const caption = document.createElement('figcaption');
          caption.textContent = photo.caption;
          figure.appendChild(caption);
        }

        resultsGrid.appendChild(figure);
        return { photo, imageDiv, trigger };
      });

      await Promise.all(cardRefs.map(({ photo, imageDiv, trigger }) => loadPhotoImage(photo, imageDiv, trigger, token)));
    } catch (error) {
      console.error('Photo list error:', error);
      statusEl.textContent = `❌ Could not load photo due to: ${error.message}.`;
    }
  }

  async function loadPhotoImage(photo, imageDiv, trigger, token) {
    try {
      const response = await fetch(`${workerUrl}/photos/object?key=${encodeURIComponent(photo.key)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      imageDiv.style.backgroundImage = `url('${objectUrl}')`;
      imageDiv.classList.remove('pg-card-loading');
      trigger.dataset.imageUrl = objectUrl;
      trigger.disabled = false;
    } catch (error) {
      console.error(`Kon foto "${photo.key}" niet laden:`, error);
      imageDiv.classList.remove('pg-card-loading');
      imageDiv.classList.add('pg-card-error');
    }
  }

  // ---- Lightbox ------------------------------------------------------
  // Click (or Enter/Space, since it's a real <button>) any loaded photo
  // to see it full-size with its caption; the rest of the page dims via
  // the semi-opaque backdrop. Escape, the ✕ button, or a click outside
  // the photo all close it again.

  let lastFocusedTrigger = null;

  function openLightbox(imageUrl, caption) {
    lastFocusedTrigger = document.activeElement;
    lightboxImage.src = imageUrl;
    lightboxImage.alt = caption || '';
    lightboxCaption.textContent = caption || '';
    lightbox.classList.remove('hidden');
    document.body.classList.add('pg-lightbox-locked'); // prevents background scroll
    lightboxClose.focus();
  }

  function closeLightbox() {
    lightbox.classList.add('hidden');
    document.body.classList.remove('pg-lightbox-locked');
    lightboxImage.src = '';
    if (lastFocusedTrigger) lastFocusedTrigger.focus();
  }

  lightboxClose.addEventListener('click', closeLightbox);

  // Click on the dimmed backdrop (i.e. not on the photo/caption itself) closes it.
  lightbox.addEventListener('click', (event) => {
    if (event.target === lightbox) closeLightbox();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !lightbox.classList.contains('hidden')) closeLightbox();
  });

  // ---- React to the shared header login/logout -----------------------
  function syncWithAuth(auth) {
    if (!workerConfigured()) {
      statusEl.textContent = '⚠️ No worker configurated, see PHOTO-GALLERY.md for help.';
      return;
    }
    if (auth) {
      showLoggedIn();
      loadPhotos(auth.token);
    } else {
      showLoggedOut();
    }
  }

  onAuthChange(syncWithAuth);
  syncWithAuth(getAuth());
}
