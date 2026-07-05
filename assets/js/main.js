// =================================================================
// MAIN ENTRY POINT
// -----------------------------------------------------------------
// Every HTML page loads this ONE script:
//   <script type="module" src="assets/js/main.js"></script>
//
// Each `init...()` function below independently checks whether the
// elements it needs exist, and does nothing if they don't. That
// means this same file safely runs on every page regardless of
// which components that page actually uses — no per-page script
// list to maintain, and no risk of one page's missing element
// crashing a totally unrelated feature on another page (see the
// README's "What changed from the original" section for the bug
// this specifically fixes).
//
// EXTENDING: adding a new interactive feature almost always means:
//   1. Create assets/js/modules/your-feature.js exporting an
//      initYourFeature() function that bails out early if its
//      elements aren't on the page.
//   2. Import it below and call it inside DOMContentLoaded.
// =================================================================

import { initTheme } from './modules/theme.js';
import { initMobileMenu, initScrolledShadow, initSmoothScroll, initBackToTop, initActiveNavLink } from './modules/navbar.js';
import { initRevealOnScroll } from './modules/reveal.js';
import { initCounters } from './modules/counters.js';
import { initTypewriter } from './modules/typewriter.js';
import { initFooterYear } from './modules/footer-year.js';
import { initDaysCounter } from './modules/days-counter.js';
import { initHomeCards } from './modules/home-cards.js';
import { initDatePicker } from './modules/date-picker.js';
import { initTournament } from './modules/tournament.js';

document.addEventListener('DOMContentLoaded', () => {
  // Site-wide chrome (safe no-ops on pages without these elements)
  initTheme();
  initMobileMenu();
  initScrolledShadow();
  initActiveNavLink();
  initSmoothScroll();
  initBackToTop();
  initRevealOnScroll();
  initCounters();
  initTypewriter();
  initFooterYear();

  // Page-specific features (each one bails out if not on that page)
  initDaysCounter();  // index.html
  initHomeCards();    // index.html
  initDatePicker();   // date.html
  initTournament();   // tournament.html

  console.log(`${document.title} — initialized ✅`);
});
