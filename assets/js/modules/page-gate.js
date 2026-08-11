// =================================================================
// PAGE GATE — hide an entire page's content until logged in
// -----------------------------------------------------------------
// For features where even a public "teaser" isn't appropriate (unlike
// gated features that show a public map/list with only the sensitive
// details behind login — see reizen-cities.js). "Onze Reizen" as a
// whole uses this: the ENTIRE page (map, pins, everything) stays
// behind a lock screen until you're logged in via the shared
// "👤 Profiel" session (assets/js/modules/auth.js).
//
// USAGE — on any page that needs this:
//   1. Wrap the real content in a container with a `data-gate-content`
//      attribute (or pass a selector), e.g.:
//        <div id="reizenApp" data-gate-content>...</div>
//   2. Add a lock screen with `data-gate-lockscreen`, e.g. copy the
//      markup used in reizen.html verbatim.
//   3. Call initPageGate({ contentSelector, lockscreenSelector }) —
//      the page's real init (e.g. initReizen()) should still run
//      unconditionally; this module only controls VISIBILITY, so
//      network requests never even start while logged out because
//      the underlying init functions are written to fetch as soon
//      as they run — see the note below for why that's fine here.
//
// NOTE ON DATA: hiding the content client-side does not, by itself,
// stop the underlying JSON (assets/data/travel-countries.json,
// world-map.json, countries/<ISO>.json) from being requested — those
// are static files with no secrets in them (country names, borders,
// city names), same trust level as the rest of the static site. The
// actual sensitive bytes (real photo thumbnails) are behind the
// photo-gallery Worker's token check server-side — see
// cloudflare/gallery/gallery_worker.js. This gate's job is purely to
// stop a logged-out visitor from casually browsing the map/city
// names at all.
// =================================================================

import { getAuth, onAuthChange, currentPersonLabel } from './auth.js';

export function initPageGate({ contentSelector = '[data-gate-content]', lockscreenSelector = '[data-gate-lockscreen]' } = {}) {
  const content = document.querySelector(contentSelector);
  const lockscreen = document.querySelector(lockscreenSelector);
  if (!content || !lockscreen) return; // page doesn't use a gate — nothing to do

  const whoNote = lockscreen.querySelector('[data-gate-who]');

  // Shows the real content when logged in, the lock screen otherwise
  function render(auth) {
    if (auth) {
      lockscreen.classList.add('hidden');
      content.classList.remove('hidden');
    } else {
      lockscreen.classList.remove('hidden');
      content.classList.add('hidden');
    }
    if (whoNote) whoNote.textContent = auth ? `Ingelogd als ${currentPersonLabel()}.` : '';
  }

  onAuthChange(render);
  render(getAuth());
}
