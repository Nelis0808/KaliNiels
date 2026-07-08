// =================================================================
// NAVBAR BEHAVIOUR
// -----------------------------------------------------------------
// Every function here checks that its element exists before doing
// anything. That guard is deliberate: this same file is imported
// on every page, but not every page has every element (e.g. only
// template.html currently has #backToTop). Without the guard, a
// missing element on one page would throw and silently stop every
// later line in the file from running.
// =================================================================

import { qsa } from './utils.js';

/** Hamburger button <-> collapsible mobile nav panel. */
export function initMobileMenu() {
  const menuBtn  = document.getElementById('menuBtn');
  const navLinks = document.getElementById('navLinks');
  if (!menuBtn || !navLinks) return;

  menuBtn.addEventListener('click', () => {
    const isOpen = navLinks.classList.toggle('show');
    menuBtn.setAttribute('aria-expanded', String(isOpen));
  });

  // Close the mobile panel after tapping any link inside it.
  qsa('a', navLinks).forEach((link) => {
    link.addEventListener('click', () => {
      navLinks.classList.remove('show');
      menuBtn.setAttribute('aria-expanded', 'false');
    });
  });
}

/** Adds aria-current + an '.active' class to whichever nav link matches the current page. */
export function initActiveNavLink() {
  const navLinks = document.getElementById('navLinks');
  if (!navLinks) return;

  const currentPage = window.location.pathname.split('/').pop() || 'index.html';

  qsa('a', navLinks).forEach((link) => {
    // href is now an absolute URL (rewritten in layout.js so subfolder
    // pages resolve correctly), so compare just the filename portion
    // instead of the raw attribute string.
    const linkPage = new URL(link.getAttribute('href'), window.location.href).pathname.split('/').pop();
    if (linkPage === currentPage) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    }
  });
}

/** Adds a subtle shadow to the sticky navbar once the page has scrolled. */
export function initScrolledShadow() {
  const navbar = document.querySelector('.navbar');
  if (!navbar) return;

  window.addEventListener(
    'scroll',
    () => navbar.classList.toggle('scrolled', window.scrollY > 20),
    { passive: true }
  );
}

/** Smooth-scrolls for any in-page `#anchor` link. */
export function initSmoothScroll() {
  qsa('a[href^="#"]').forEach((link) => {
    link.addEventListener('click', (event) => {
      const targetId = link.getAttribute('href');
      if (!targetId || targetId === '#') return;

      const target = document.querySelector(targetId);
      if (!target) return; // not every "#something" link necessarily has a matching element

      event.preventDefault();
      target.scrollIntoView({ behavior: 'smooth' });
    });
  });
}

/** Floating "back to top" button: appears after scrolling, scrolls smoothly to top on click. */
export function initBackToTop() {
  const topBtn = document.getElementById('backToTop');
  if (!topBtn) return;

  window.addEventListener(
    'scroll',
    () => topBtn.classList.toggle('show', window.scrollY > 500),
    { passive: true }
  );

  topBtn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}
