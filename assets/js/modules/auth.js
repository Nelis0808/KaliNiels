// =================================================================
// SHARED SITE AUTH ("Profiel" in the sticky header)
// -----------------------------------------------------------------
// ONE login for the whole site. Before this module existed, every
// gated feature (Onze Foto's, Onze Reizen se steden-foto's,
// BlackJack, Spiderette) had its OWN login form on its OWN page,
// its own localStorage key, and — for BlackJack/Spiderette — even
// its own separate Cloudflare Worker. That meant logging in on
// photos.html didn't help you on reizen.html, and logging in for
// BlackJack didn't help on Spiderette: four independent sessions
// for what is really always the same two people.
//
// This module replaces all of that with a single session:
//   - ONE login form, which lives in the sticky header's "Profiel"
//     dropdown (assets/partials/header.html +
//     assets/js/modules/profile-dropdown.js) and is reachable from
//     every page.
//   - ONE localStorage key (AUTH_STORAGE_KEY below).
//   - ONE Cloudflare Worker for identity: the existing
//     "photo-gallery" worker's /login route (see
//     cloudflare/cloudflare-worker-photos/worker.js) — already knows
//     PASSPHRASE_A/PASSPHRASE_B for both of you, so nothing new to
//     deploy there.
//
// FEATURES THAT USED TO HAVE THEIR OWN LOGIN (photo-gallery.js,
// reizen-cities.js, blackjack.js, spiderette.js) now import
// `getAuth()`/`onAuthChange()` from here instead of keeping their
// own copy of the passphrase form. BlackJack and Spiderette's chip
// balance still lives in the separate "blackjack" Worker/KV
// namespace (no reason to move real money-like state) — but that
// Worker must now trust tokens signed by the shared identity
// Worker. Concretely: **set the "blackjack" Worker's TOKEN_SECRET,
// PASSPHRASE_A and PASSPHRASE_B secrets to the exact same values as
// the "photo-gallery" Worker's**. Both workers already use the
// identical signing scheme (base64url(payload) + "." +
// HMAC-SHA256), so a token signed by one verifies cleanly on the
// other once the secrets match — no code change needed in either
// worker for this, just matching secrets. See STAPPENPLAN-REIZEN.md
// / README for the full note.
//
// SESSION LENGTH: same ~30 days as before, controlled server-side by
// the photo-gallery Worker's /login response (`exp`), and enforced
// client-side too — readStoredAuth() below already discards a stored
// token once its `exp` has passed, without any network call. That's
// also why BlackJack/Spiderette's chip loader does NOT call logout()
// here on a 401 from the blackjack Worker's /chips: that Worker isn't
// the source of truth for whether the shared session is valid, only
// for that one Worker's own token check, and a 401 there essentially
// always means its TOKEN_SECRET doesn't match this Worker's (a
// misconfiguration, not an expired session) — logging the whole site
// out over it just forces a fresh login that gets signed with the
// exact same still-mismatched secret and 401s again, a repeating
// "keeps logging me out" loop that never actually fixes anything.
// =================================================================

import { siteConfig } from '../config.js';

export const AUTH_STORAGE_KEY = 'siteAuth';

// Small pub/sub so any module (profile dropdown, photo gallery,
// reizen, games, ...) can react the instant login/logout happens,
// without polling localStorage themselves.
const listeners = new Set();

function readStoredAuth() {
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

let currentAuth = readStoredAuth();

/** Current session, or null if logged out / expired: { token, who, exp }. */
export function getAuth() {
  return currentAuth;
}

export function isLoggedIn() {
  return Boolean(currentAuth);
}

/** Display name for the logged-in person, from siteConfig.photos.personLabels. */
export function currentPersonLabel() {
  if (!currentAuth) return '';
  const labels = siteConfig.photos?.personLabels || {};
  return labels[currentAuth.who] || (currentAuth.who === 'a' ? 'Persoon A' : 'Persoon B');
}

/** Subscribe to auth changes. Returns an unsubscribe function. */
export function onAuthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  listeners.forEach((fn) => {
    try {
      fn(currentAuth);
    } catch (error) {
      console.error('Auth listener error:', error);
    }
  });
}

function workerConfigured() {
  const url = siteConfig.photos?.workerUrl || '';
  return url && !url.includes('YOUR-SUBDOMAIN');
}

/**
 * Logs in against the shared photo-gallery Worker. Resolves to
 * { ok: true } on success, or { ok: false, error } on failure — the
 * caller (profile-dropdown.js) decides how to show that error, this
 * module stays UI-free on purpose so it can be reused anywhere.
 */
export async function login(passphrase) {
  if (!workerConfigured()) {
    return { ok: false, error: '⚠️ Nog geen Worker gekoppeld, zie PHOTO-GALLERY.md.' };
  }

  try {
    const response = await fetch(`${siteConfig.photos.workerUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase }),
    });
    const data = await response.json();

    if (!response.ok) {
      return { ok: false, error: data.error || 'Inloggen mislukt.' };
    }

    currentAuth = { token: data.token, who: data.who, exp: data.exp };
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(currentAuth));
    notify();
    return { ok: true, who: data.who };
  } catch (error) {
    console.error('Login error:', error);
    return { ok: false, error: 'Geen verbinding, probeer het later opnieuw.' };
  }
}

export function logout() {
  currentAuth = null;
  localStorage.removeItem(AUTH_STORAGE_KEY);
  notify();
}

// Cross-tab sync: logging in/out in one tab should reflect instantly
// in any other open tab (e.g. photos.html open in one tab, reizen.html
// in another).
window.addEventListener('storage', (event) => {
  if (event.key !== AUTH_STORAGE_KEY) return;
  currentAuth = readStoredAuth();
  notify();
});
