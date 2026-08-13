// =================================================================
// MAIN.JS LOAD WATCHDOG
// -----------------------------------------------------------------
// Loaded via a plain classic <script src="..."> tag, right before
// each page's own <script type="module" src=".../main.js">. Plain
// scripts run even if a module script on the same page fails
// entirely (404, wrong MIME type, blocked by an ad-blocker, ...) —
// and a failed module script fails SILENTLY, with no visible error,
// leaving the page showing only its static HTML. This tiny script
// checks a few seconds later whether main.js ever actually ran (it
// sets window.__siteMainRan = true right after its imports run — see
// main.js) and shows a plain-language banner if not, instead of a
// page that just looks broken with no clue why.
//
// Deliberately its own file rather than inlined on every page: it
// used to be copy-pasted into all ~24 HTML files, which meant fixing
// a typo or tweaking the wording meant editing all 24. One file,
// referenced with one script tag per page, keeps it in exactly one
// place. Only wired up on pages that also load main.js (see the
// same-directory rule below) — a page with no module script has
// nothing to watch for and doesn't include this file.
//
// Works from any page depth (root, games/, reizen/) because it never
// hardcodes a path itself — the browser only ever needs its own path
// (relative or not) to load THIS file; from there it just checks a
// global flag, which needs no path of its own.
// =================================================================

setTimeout(function () {
  if (window.__siteMainRan) return;
  var banner = document.createElement('div');
  banner.setAttribute('role', 'alert');
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#B00020;color:#fff;font:14px/1.5 system-ui,sans-serif;padding:10px 16px;text-align:center;';
  banner.textContent = 'Deze pagina kon assets/js/main.js niet laden (netwerkfout, verkeerd pad, of geblokkeerd script). Open de browserconsole (F12) voor details.';
  document.body && document.body.prepend(banner);
}, 4000);
