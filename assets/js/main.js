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
// crashing a totally unrelated feature on another page.
//
// EXTENDING: adding a new interactive feature almost always means:
//   1. Create assets/js/modules/your-feature.js exporting an
//      initYourFeature() function that bails out early if its
//      elements aren't on the page.
//   2. Import it below and call it inside DOMContentLoaded.
//
// NOTE: initLayout() (assets/js/modules/layout.js) runs first and is
// awaited — it injects the shared header/back-to-top HTML from
// assets/partials/ into every page. Everything else assumes that
// HTML already exists, so don't move it below the other init calls.
// =================================================================

import { initLayout } from './modules/layout.js';
import { initTheme, initColorTheme } from './modules/theme.js';
import { initMobileMenu, initScrolledShadow, initSmoothScroll, initBackToTop, initActiveNavLink } from './modules/navbar.js';
import { initNavDropdown } from './modules/nav-dropdown.js';
import { initSettingsDropdown } from './modules/settings-dropdown.js';
import { initProfileDropdown } from './modules/profile-dropdown.js';
import { initRevealOnScroll } from './modules/reveal.js';
import { initCounters } from './modules/counters.js';
import { initTypewriter } from './modules/typewriter.js';
import { initFooterYear } from './modules/footer-year.js';
import { initDaysCounter } from './modules/days-counter.js';
import { initHomeCards } from './modules/home-cards.js';
import { initDatePicker } from './modules/date-picker.js';
import { initTournament } from './modules/tournament.js';
import { initTicketmaster } from './modules/ticketmaster.js';
import { initPhotoGallery } from './modules/photo-gallery.js';
import { initLijstje } from './modules/lijstje.js';
import { initTodo } from './modules/todo.js';
import { initSnackRating } from './modules/snack-rating.js';
import { initClothing } from './modules/clothing.js';
import { initGifts } from './modules/gifts.js';
import { initReizen } from './modules/reizen.js';
import { initReizenLand } from './modules/reizen-land.js';
import { initPageGate } from './modules/page-gate.js';
import { initGamesHub } from './modules/games-hub.js';
import { initTicTacToe } from './modules/tictactoe.js';
import { initConnect4 } from './modules/connect4.js';
import { initWordle } from './modules/wordle.js';
import { initHangman } from './modules/hangman.js';
import { initHangmanCustom } from './modules/hangman-custom.js';
import { initBlackjack } from './modules/blackjack.js';
import { initSpiderette } from './modules/spiderette.js';
import { initSnake } from './modules/snake.js';
import { initWallz } from './modules/wallz.js';
import { initValentine } from './modules/valentine.js';

// Tells the plain <script> watchdog in every page's HTML (right
// before this script's own <script type="module"> tag) that this
// module actually loaded and started running — see that inline
// script's comment for why it exists.
window.__siteMainRan = true;

// Surfaces any error that would otherwise fail completely silently —
// most importantly, a module import itself throwing (bad JSON in
// config.js, a broken import path, ...), which happens BEFORE
// DOMContentLoaded even fires and so can't be caught by the
// try/catch in safeInit() below. Without this, a hosting quirk that
// breaks one file (wrong MIME type, a stale cached copy, a
// case-sensitive path mismatch — GitHub Pages is case-sensitive even
// when your local dev machine isn't) can silently leave the page
// showing nothing beyond its static HTML, with no clue in the UI
// about why. This only ever adds a small, dismissible banner — it
// never blocks or replaces the page's own content.
window.addEventListener('error', (event) => {
  showFatalErrorBanner(event.error || event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  showFatalErrorBanner(event.reason);
});

function showFatalErrorBanner(error) {
  if (document.getElementById('siteFatalErrorBanner')) return; // only show once
  const banner = document.createElement('div');
  banner.id = 'siteFatalErrorBanner';
  banner.setAttribute('role', 'alert');
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#B00020;color:#fff;font:14px/1.5 system-ui,sans-serif;padding:10px 16px;text-align:center;';
  banner.textContent = `Er ging iets mis bij het laden van deze pagina (${error && error.message ? error.message : error}). Open de browserconsole voor details.`;
  document.body?.prepend(banner);
}

// One feature throwing must never block every feature after it in
// the list below — otherwise a single bug (or a one-off network
// hiccup fetching a page's own JSON data) on ANY page would blank
// out the header, counters, and every other page's features too,
// since they all run from this one shared list. Wraps a call so it
// logs and moves on instead of stopping the chain; awaits the result
// either way so an async init's rejection is caught too.
async function safeInit(name, fn) {
  try {
    await fn();
  } catch (error) {
    console.error(`[main] ${name}() failed — continuing with the rest of the page:`, error);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Load the shared header/back-to-top partials FIRST — every module
  // below reaches for elements (navbar, dropdowns, ...) that only
  // exist once this has finished.
  await safeInit('initLayout', initLayout);

  // Site-wide chrome (safe no-ops on pages without these elements)
  safeInit('initTheme', initTheme);
  safeInit('initColorTheme', initColorTheme);
  safeInit('initNavDropdown', initNavDropdown);        /* Must run before initMobileMenu*/
  safeInit('initSettingsDropdown', initSettingsDropdown);
  safeInit('initProfileDropdown', initProfileDropdown);
  safeInit('initMobileMenu', initMobileMenu);
  safeInit('initScrolledShadow', initScrolledShadow);
  safeInit('initActiveNavLink', initActiveNavLink);
  safeInit('initSmoothScroll', initSmoothScroll);
  safeInit('initBackToTop', initBackToTop);
  safeInit('initRevealOnScroll', initRevealOnScroll);
  safeInit('initCounters', initCounters);
  safeInit('initTypewriter', initTypewriter);
  safeInit('initFooterYear', initFooterYear);

  // Page-specific features (each one bails out if not on that page)
  safeInit('initDaysCounter', initDaysCounter);     // index.html
  safeInit('initHomeCards', initHomeCards);         // index.html
  safeInit('initDatePicker', initDatePicker);       // date.html
  safeInit('initTournament', initTournament);       // tournament.html
  safeInit('initTicketmaster', initTicketmaster);   // ticketmaster.html
  safeInit('initPhotoGallery', initPhotoGallery);   // photos.html
  safeInit('initLijstje', initLijstje);             // lijstje.html
  safeInit('initTodo', initTodo);                   // todo.html
  safeInit('initSnackRating', initSnackRating);     // snack-rating.html
  safeInit('initClothing', initClothing);           // clothing.html
  safeInit('initGifts', initGifts);                 // gifts.html
  safeInit('initPageGate', initPageGate);           // reizen.html + reizen/land.html — hides the whole page until logged in
  safeInit('initReizen', initReizen);               // reizen.html
  safeInit('initReizenLand', initReizenLand);       // reizen/land.html
  safeInit('initGamesHub', initGamesHub);           // games-hub.html
  safeInit('initTicTacToe', initTicTacToe);         // tictactoe.html
  safeInit('initConnect4', initConnect4);           // connect4.html
  safeInit('initWordle', initWordle);               // wordle.html
  safeInit('initHangman', initHangman);             // hangman.html
  safeInit('initHangmanCustom', initHangmanCustom); // games/hangman-custom.html
  safeInit('initBlackjack', initBlackjack);         // games/blackjack.html
  safeInit('initSpiderette', initSpiderette);       // games/spiderette.html
  safeInit('initSnake', initSnake);                 // games/snake.html
  safeInit('initWallz', initWallz);                 // games/wallz.html
  safeInit('initValentine', initValentine);         // valentine.html

  console.log(`${document.title} — initialized ✅`);
});
