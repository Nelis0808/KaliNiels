// =================================================================
// SHARED SITE AUTH ("Profiel" in the sticky header)
// -----------------------------------------------------------------
// ONE login, ONE session, for the whole site:
//   - ONE login form, in the sticky header's "Profiel" dropdown
//     (assets/partials/header.html + profile-dropdown.js), reachable
//     from every page.
//   - ONE localStorage key (AUTH_STORAGE_KEY below).
//   - ONE Cloudflare Worker for identity: the "photo-gallery" worker's
//     /login route (cloudflare/gallery/gallery_worker.js) — it holds
//     PASSPHRASE_A/PASSPHRASE_B for both people.
//
// Every gated feature (Onze Foto's, Onze Reizen's city photos,
// BlackJack, Spiderette) imports `getAuth()`/`onAuthChange()` from
// here rather than keeping its own login form. BlackJack/Spiderette's
// chip balance still lives in its own separate "blackjack" Worker/KV
// namespace, but that Worker must trust tokens signed by this same
// identity Worker — so its TOKEN_SECRET, PASSPHRASE_A and
// PASSPHRASE_B secrets must be set to the exact same values as the
// "photo-gallery" Worker's. Both workers sign tokens the same way
// (base64url(payload) + "." + HMAC-SHA256), so a token from one
// verifies cleanly on the other once the secrets match — see
// ACTION-EXPANSION-PLAN.md for the full setup note.
//
// SESSION LENGTH: ~30 days, controlled server-side by the
// photo-gallery Worker's /login response (`exp`), and enforced
// client-side too — readStoredAuth() discards a stored token once its
// `exp` has passed, with no network call needed. That's also why the
// BlackJack/Spiderette chip loader does NOT call logout() on a 401
// from the blackjack Worker's /chips: that Worker isn't the source of
// truth for whether the shared session is valid, only for its own
// token check, and a 401 there usually just means its TOKEN_SECRET
// doesn't match this Worker's — logging the whole site out over it
// would only force a re-login that gets signed with the same
// mismatched secret and 401s again.
// =================================================================

import { siteConfig } from '../config.js';

export const AUTH_STORAGE_KEY = 'siteAuth';

// Small pub/sub so any module (profile dropdown, photo gallery,
// reizen, games, ...) can react the instant login/logout happens,
// without polling localStorage themselves.
const listeners = new Set();

// Reads and validates the stored session, discarding it if expired/corrupt
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

// True if there's a valid current session
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

// Calls every subscribed listener with the current auth state
function notify() {
  listeners.forEach((fn) => {
    try {
      fn(currentAuth);
    } catch (error) {
      console.error('Auth listener error:', error);
    }
  });
}

// True once config.js's photos.workerUrl has been set to a real Worker URL
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
    return { ok: false, error: '⚠️ Nog geen Worker gekoppeld, zie ACTION-EXPANSION-PLAN.md.' };
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

// Clears the current session and notifies listeners
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
