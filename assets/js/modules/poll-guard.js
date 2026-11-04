// =================================================================
// POLL GUARD — stops background refreshing when nobody is looking
// -----------------------------------------------------------------
// Several pages (lijstje, to-do, gifts, ...) re-fetch their list from a
// Cloudflare Worker every few seconds so two phones stay in sync. A tab
// that is left open (and visible) on a desk would otherwise keep asking
// all day, quietly eating the shared free quota of 100,000 Worker
// requests per day.
//
// isUserActive() is true while the tab is visible AND the person touched
// the screen / moved the mouse / pressed a key within IDLE_MS. Pages call
// it inside their poll timer and simply skip the refresh when it's false;
// onPollResume() lets them refresh immediately once the person is back.
// =================================================================

const IDLE_MS = 5 * 60 * 1000; // 5 minutes without any interaction = idle
const RESUME_EVENT = 'poll-guard:resume';

let lastActivity = Date.now();

function wasIdle() {
  return Date.now() - lastActivity >= IDLE_MS;
}

function markActive() {
  const idleBefore = wasIdle();
  lastActivity = Date.now();
  if (idleBefore && !document.hidden) window.dispatchEvent(new CustomEvent(RESUME_EVENT));
}

// Cheap throttle: pointermove/scroll fire many times per second.
let lastMark = 0;
function onActivity() {
  const now = Date.now();
  if (now - lastMark < 1000 && !wasIdle()) return;
  lastMark = now;
  markActive();
}

if (typeof window !== 'undefined' && !window.__pollGuardInstalled) {
  window.__pollGuardInstalled = true;
  ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'touchstart'].forEach((name) => {
    window.addEventListener(name, onActivity, { passive: true, capture: true });
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) markActive();
  });
}

/** True when it is worth refreshing in the background right now. */
export function isUserActive() {
  return !document.hidden && !wasIdle();
}

/** Calls `callback` when the person comes back after being idle (so the page can refresh at once). */
export function onPollResume(callback) {
  window.addEventListener(RESUME_EVENT, callback);
}
