// =================================================================
// PRIVATE PHOTO GALLERY (photos.html)
// -----------------------------------------------------------------
// Talks ONLY to the photo-gallery Cloudflare Worker (see
// /cloudflare-worker-photos + STAPPENPLAN-FOTOS.md) — never directly
// to any storage. The real photos live in a private R2 bucket that
// only that worker can read; this module never sees them until the
// worker has verified a passphrase and handed back a signed token.
//
// SESSION: on successful login, the token is kept in localStorage
// (~30 days, per the "blijf ingelogd" choice) so you don't have to
// re-enter your passphrase on every visit from the same device/
// browser. Logging out, or the token expiring, clears it.
//
// EXTENDING: want a 3rd person? Add a PASSPHRASE_C secret + a 'c'
// branch in the worker's /login handler, and add 'c' to
// `siteConfig.photos.personLabels` here on the site side.
// =================================================================

import { siteConfig } from '../config.js';
import { qs } from './utils.js';

const AUTH_STORAGE_KEY = 'photoGalleryAuth';

export function initPhotoGallery() {
  const root = document.getElementById('photoGalleryApp');
  if (!root) return; // not on this page

  const workerUrl = siteConfig.photos?.workerUrl || '';
  const personLabels = siteConfig.photos?.personLabels || {};

  const loginForm = qs('#pgLoginForm', root);
  const passphraseInput = qs('#pgPassphrase', root);
  const loginError = qs('#pgLoginError', root);
  const loggedInBar = qs('#pgLoggedInBar', root);
  const loggedInLabel = qs('#pgLoggedInLabel', root);
  const logoutBtn = qs('#pgLogoutBtn', root);
  const placeholderGrid = qs('#pgPlaceholder', root);
  const resultsGrid = qs('#pgResults', root);
  const statusEl = qs('#pgStatus', root);

  // ---- Local session helpers -----------------------------------

  function getStoredAuth() {
    try {
      const raw = localStorage.getItem(AUTH_STORAGE_KEY);
      if (!raw) return null;
      const auth = JSON.parse(raw);
      // Quick client-side expiry check, purely for UX (so we don't
      // even try a request we know is stale). The worker re-verifies
      // the signature + expiry server-side on every call regardless —
      // this local check can't be used to forge access.
      if (!auth?.token || !auth?.exp || auth.exp * 1000 < Date.now()) return null;
      return auth;
    } catch {
      return null;
    }
  }

  function storeAuth(auth) {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
  }

  function clearAuth() {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }

  // ---- View toggling ----------------------------------------------

  function showLoggedOut(message) {
    loginForm.classList.remove('hidden');
    loggedInBar.classList.add('hidden');
    placeholderGrid.classList.remove('hidden');
    resultsGrid.classList.add('hidden');
    resultsGrid.innerHTML = '';
    statusEl.textContent = message || '';
  }

  function showLoggedIn(who) {
    loginForm.classList.add('hidden');
    loggedInBar.classList.remove('hidden');
    placeholderGrid.classList.add('hidden');
    resultsGrid.classList.remove('hidden');
    loggedInLabel.textContent = personLabels[who] || (who === 'a' ? 'Persoon A' : 'Persoon B');
    loginError.textContent = '';
  }

  function workerConfigured() {
    return workerUrl && !workerUrl.includes('YOUR-SUBDOMAIN');
  }

  // ---- Networking ---------------------------------------------------

  async function login(passphrase) {
    if (!workerConfigured()) {
      loginError.textContent = '⚠️ Geen worker geconfigureerd — zie STAPPENPLAN-FOTOS.md.';
      return;
    }

    loginError.textContent = '';
    try {
      const response = await fetch(`${workerUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase }),
      });
      const data = await response.json();

      if (!response.ok) {
        loginError.textContent = data.error || 'Inloggen mislukt.';
        return;
      }

      storeAuth({ token: data.token, who: data.who, exp: data.exp });
      passphraseInput.value = '';
      showLoggedIn(data.who);
      await loadPhotos(data.token);
    } catch (error) {
      console.error('Login error:', error);
      loginError.textContent = 'Kon geen verbinding maken. Probeer het later opnieuw.';
    }
  }

  async function loadPhotos(token) {
    statusEl.textContent = 'Foto\u2019s laden…';
    resultsGrid.innerHTML = '';

    try {
      const response = await fetch(`${workerUrl}/photos`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.status === 401) {
        clearAuth();
        showLoggedOut('Sessie verlopen — log opnieuw in.');
        return;
      }

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

      if (data.photos.length === 0) {
        statusEl.textContent = 'Nog geen foto\u2019s geüpload. Zie STAPPENPLAN-FOTOS.md om er een paar toe te voegen.';
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

        const imageDiv = document.createElement('div');
        imageDiv.className = 'pg-card-image pg-card-loading';
        imageDiv.setAttribute('aria-hidden', 'true');
        figure.appendChild(imageDiv);

        if (photo.caption) {
          const caption = document.createElement('figcaption');
          caption.textContent = photo.caption; // textContent — never innerHTML
          figure.appendChild(caption);
        }

        resultsGrid.appendChild(figure);
        return { photo, imageDiv };
      });

      await Promise.all(cardRefs.map(({ photo, imageDiv }) => loadPhotoImage(photo, imageDiv, token)));
    } catch (error) {
      console.error('Photo list error:', error);
      statusEl.textContent = `❌ Kon foto's niet laden (${error.message}).`;
    }
  }

  async function loadPhotoImage(photo, imageDiv, token) {
    try {
      const response = await fetch(`${workerUrl}/photos/object?key=${encodeURIComponent(photo.key)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      imageDiv.style.backgroundImage = `url('${objectUrl}')`;
      imageDiv.classList.remove('pg-card-loading');
    } catch (error) {
      console.error(`Kon foto "${photo.key}" niet laden:`, error);
      imageDiv.classList.remove('pg-card-loading');
      imageDiv.classList.add('pg-card-error');
    }
  }

  // ---- Wiring ------------------------------------------------------

  loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const passphrase = passphraseInput.value.trim();
    if (!passphrase) return;
    login(passphrase);
  });

  logoutBtn.addEventListener('click', () => {
    clearAuth();
    showLoggedOut('Uitgelogd.');
  });

  // ---- Initial state -------------------------------------------------

  const storedAuth = getStoredAuth();
  if (storedAuth) {
    showLoggedIn(storedAuth.who);
    loadPhotos(storedAuth.token);
  } else {
    showLoggedOut();
  }
}
