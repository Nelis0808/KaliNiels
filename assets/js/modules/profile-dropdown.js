// =================================================================
// PROFILE DROPDOWN (top-right "👤" menu, every page)
// -----------------------------------------------------------------
// The ONE place to log in or out of the whole site — see
// assets/js/modules/auth.js for the shared session this drives.
// Logged out: shows a small passphrase form. Logged in: shows who's
// logged in + a logout button. Every gated feature (Onze Foto's,
// Onze Reizen, BlackJack, Spiderette) reflects this same session
// automatically via onAuthChange(), no separate login anywhere else.
// =================================================================

import { getAuth, login, logout, onAuthChange, currentPersonLabel } from './auth.js';
import { EXCLUSIVE_DROPDOWN_EVENT, announceDropdownOpen } from './utils.js';

const DROPDOWN_ID = 'profile';

// Builds and wires up the profile dropdown: login form, logged-in view, open/close.
export function initProfileDropdown() {
  const dropdown = document.getElementById('navProfileDropdown');
  const trigger = document.getElementById('navProfileBtn');
  const menu = document.getElementById('navProfileMenu');
  if (!dropdown || !trigger || !menu) return; // page has no profile menu — nothing to do

  const loggedOutView = document.getElementById('profileLoggedOut');
  const loggedInView = document.getElementById('profileLoggedIn');
  const loginForm = document.getElementById('profileLoginForm');
  const passphraseInput = document.getElementById('profilePassphrase');
  const loginError = document.getElementById('profileLoginError');
  const whoLabel = document.getElementById('profileWhoLabel');
  const logoutBtn = document.getElementById('profileLogoutBtn');
  const triggerIcon = document.getElementById('navProfileIcon');

  // Swaps between the logged-out (login form) and logged-in views
  function render() {
    const auth = getAuth();
    if (auth) {
      loggedOutView.classList.add('hidden');
      loggedInView.classList.remove('hidden');
      whoLabel.textContent = currentPersonLabel();
      if (triggerIcon) triggerIcon.textContent = '🔓';
      trigger.setAttribute('aria-label', `Profiel, ingelogd als ${currentPersonLabel()}`);
    } else {
      loggedOutView.classList.remove('hidden');
      loggedInView.classList.add('hidden');
      if (triggerIcon) triggerIcon.textContent = '👤';
      trigger.setAttribute('aria-label', 'Profiel, inloggen');
    }
  }

  // Closes the dropdown and updates aria-expanded
  function closeMenu() {
    dropdown.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
  }

  // Toggles the dropdown open/closed, focusing the passphrase field when opening logged-out
  function toggleMenu() {
    const isOpen = dropdown.classList.toggle('open');
    trigger.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) {
      announceDropdownOpen(DROPDOWN_ID); // tell the settings dropdown (or any other) to close
      if (!getAuth()) {
        loginError.textContent = '';
        passphraseInput.value = '';
        // Slight delay so the focus happens after the menu is actually visible.
        requestAnimationFrame(() => passphraseInput.focus());
      }
    }
  }

  trigger.addEventListener('click', (event) => {
    event.stopPropagation(); // don't let the document click-listener below close it immediately
    toggleMenu();
  });

  document.addEventListener('click', (event) => {
    if (!dropdown.contains(event.target)) closeMenu();
  });

  // Another exclusive dropdown (e.g. settings) just opened — close this one.
  document.addEventListener(EXCLUSIVE_DROPDOWN_EVENT, (event) => {
    if (event.detail?.source !== DROPDOWN_ID) closeMenu();
  });

  dropdown.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeMenu();
      trigger.focus();
    }
  });

  // Handles the login form submit: calls login(), shows any error, closes on success
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitBtn = loginForm.querySelector('button[type="submit"]');
    loginError.textContent = '';
    if (submitBtn) submitBtn.disabled = true;

    const result = await login(passphraseInput.value.trim());

    if (submitBtn) submitBtn.disabled = false;
    if (!result.ok) {
      loginError.textContent = result.error;
      return;
    }
    passphraseInput.value = '';
    closeMenu();
  });

  // Logs out and closes the menu
  logoutBtn.addEventListener('click', () => {
    logout();
    closeMenu();
  });

  onAuthChange(render);
  render();
}
