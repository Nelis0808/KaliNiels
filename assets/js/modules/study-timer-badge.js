// =================================================================
// STUDY TIMER — HEADER BADGE + NOTIFICATIONS SETTING
// -----------------------------------------------------------------
// Two things live in this module:
//
// 1) The live "Timer" clock in the header (assets/partials/header.html,
//    every element marked data-study-timer-badge) that mirrors whatever
//    the study timer (study-timer.js, on timer.html) is doing — live
//    remaining time, and a red dot once it's hit 00:00:00 and is waiting
//    for you to come back and deal with it. There is exactly ONE clock
//    and it always sits directly left of the profile button (in
//    .nav-actions), never between the nav links. It has no link of its
//    own: the only reference to timer.html in the header is the
//    "Studie Timer" nav link.
//
//    It runs on EVERY page (wired up in main.js like any other site-wide
//    chrome piece), not just timer.html, by reading the same
//    localStorage key study-timer.js writes to (studyTimerStateV2)
//    rather than sharing any in-memory state with it — the two are
//    intentionally decoupled so this badge works even on pages that
//    never load study-timer.js at all.
//
//    NEVER SHIFTS THE NAV: the clock lives in the right-hand column of
//    the header grid (see navbar.css), which is as wide as the logo
//    column on the left, so the centred links stay exactly where they
//    are whether the clock is showing or not. While idle/hidden the
//    clock is display:none (.is-idle) and leaves no gap.
//
//    HIDDEN ("verborgen") STATE: the eye button on the Studie Timer
//    page hides the countdown there. That choice is stored here
//    (isTimerHidden()/setTimerHidden(), localStorage) and makes the
//    header clock disappear on every page too; un-hiding it brings the
//    clock straight back with the correct, current remaining time
//    (it's always computed from the running timer's absolute end
//    timestamp, never from a stored counter).
//
// 2) The "🔔 Meldingen" switch in the settings dropdown (same place
//    as dark mode / pink theme — see settings-dropdown.js and
//    theme.js, which this follows the same `.switch`/aria-checked
//    pattern as). Turning it on shows a real Windows/OS-level
//    notification when a step finishes while the tab is in the
//    background or the browser isn't focused — the in-page "session
//    done" popup in study-timer.js only helps if you're looking at
//    the tab, so this is the "you're on another tab / away" backstop.
//    The switch is the ONE place permission is ever requested: it's a
//    real, deliberate click on something clearly labelled as being
//    about notifications, which is both what browsers require to
//    even show their permission prompt and — just as importantly —
//    means the person understands why the prompt appeared, rather
//    than a mystery popup after some unrelated click that gets
//    reflexively (and often permanently) dismissed. Notifications keep
//    working while the clock is hidden.
// =================================================================

import { getAuth, onAuthChange } from './auth.js';

const KEY = 'studyTimerStateV2';
const NOTIFICATIONS_PREF_KEY = 'study-timer-notifications-enabled';
const HIDDEN_KEY = 'studyTimerHiddenV1';
const VISIBILITY_EVENT = 'study-timer:visibility';
const CHECK_INTERVAL_MS = 1000;

/** True when the person hid the timer with the eye button on the Studie Timer page. */
export function isTimerHidden() {
  try { return localStorage.getItem(HIDDEN_KEY) === 'true'; } catch { return false; }
}

/** Stores the hidden/visible choice and tells this tab's header clock right away (other tabs hear it via the `storage` event). */
export function setTimerHidden(hidden) {
  try {
    if (hidden) localStorage.setItem(HIDDEN_KEY, 'true');
    else localStorage.removeItem(HIDDEN_KEY);
  } catch { /* storage unavailable — the in-memory page state still works for this visit */ }
  window.dispatchEvent(new CustomEvent(VISIBILITY_EVENT, { detail: { hidden: Boolean(hidden) } }));
}

function today() { return new Date().toISOString().slice(0, 10); }

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}

function format(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// The switch's own on/off preference, separate from (but constrained
// by) the browser's actual Notification.permission — this is what
// lets the person turn the feature back off later without having to
// dig into their browser's site settings to revoke permission.
function notificationsWanted() {
  return localStorage.getItem(NOTIFICATIONS_PREF_KEY) === 'true';
}

function initNotificationsToggle() {
  const toggleBtn = document.getElementById('notificationsToggle');
  if (!toggleBtn) return; // page has no settings dropdown — nothing to wire up

  const notificationsSupported = 'Notification' in window;

  function applyToggleState() {
    // "On" in the UI only if the person wants it AND the browser has
    // actually granted permission — if permission was revoked from
    // outside the site (browser settings), the switch reflects that
    // truthfully rather than claiming to be on when it can't work.
    const on = notificationsSupported && notificationsWanted() && Notification.permission === 'granted';
    toggleBtn.setAttribute('aria-checked', String(on));
    toggleBtn.setAttribute('aria-label', on ? 'Zet meldingen uit' : 'Zet meldingen aan');
    toggleBtn.disabled = !notificationsSupported;
    toggleBtn.title = !notificationsSupported
      ? 'Meldingen worden niet ondersteund in deze browser.'
      : (Notification.permission === 'denied'
        ? 'Meldingen zijn geblokkeerd in je browser. Zet ze aan via het slotje/site-instellingen naast de adresbalk, herlaad de pagina, en probeer opnieuw.'
        : 'Krijg een Windows/OS-melding als je studietimer afloopt terwijl je op een ander tabblad zit.');
  }

  toggleBtn.addEventListener('click', async () => {
    const currentlyOn = toggleBtn.getAttribute('aria-checked') === 'true';
    if (currentlyOn) {
      // Turning off never needs the browser — just stop wanting it.
      localStorage.setItem(NOTIFICATIONS_PREF_KEY, 'false');
      applyToggleState();
      return;
    }
    if (Notification.permission === 'denied') {
      // JS can't re-prompt once denied — only the browser's own site
      // settings can. Explain that instead of silently doing nothing.
      alert('Meldingen zijn geblokkeerd voor deze site. Klik op het slotje (of "i") naast de adresbalk, zet Meldingen op "Toestaan", en herlaad de pagina.');
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      localStorage.setItem(NOTIFICATIONS_PREF_KEY, 'true');
      // Immediate confirmation so the person knows the click worked —
      // otherwise "did that do anything?" is a reasonable question
      // for an invisible feature like this one.
      try { new Notification('Meldingen aan ⏰', { body: 'Je krijgt nu een melding als je studietimer afloopt terwijl je op een ander tabblad zit.', tag: 'study-timer-notify-confirm' }); } catch { /* best-effort confirmation only */ }
    }
    applyToggleState();
  });

  applyToggleState();
}

export function initStudyTimerBadge() {
  initNotificationsToggle();

  const badges = Array.from(document.querySelectorAll('[data-study-timer-badge]'));
  if (badges.length === 0) return;

  let who = getAuth()?.who || null;
  // Tracks the specific running-timer instance (by its end timestamp)
  // we've already fired a "finished" notification for, so a finished
  // timer sitting at 00:00:00 doesn't re-notify every second while
  // waiting for the person to deal with it — only the transition into
  // "finished" notifies once.
  let notifiedEndsAt = null;

  // Paints the clock. `visible:false` removes it from the layout (.is-idle).
  function paint({ visible, text = '00:00:00', done = false, title = 'Studie timer' }) {
    badges.forEach((badge) => {
      badge.classList.toggle('is-idle', !visible);
      badge.setAttribute('aria-hidden', String(!visible));
      badge.title = title;
      const timeEl = badge.querySelector('[data-study-timer-time]');
      if (timeEl && timeEl.textContent !== text) timeEl.textContent = text;
      badge.querySelector('[data-study-timer-dot]')?.classList.toggle('is-done', done);
    });
  }

  function notifyStepFinished(label) {
    if (!('Notification' in window) || Notification.permission !== 'granted' || !notificationsWanted()) return;
    if (!document.hidden && document.hasFocus()) return; // only nudge when away from the tab
    try {
      // renotify:true is the fix for "only the first one ever shows
      // up": every call here uses the SAME tag ('study-timer-done')
      // on purpose, so a still-open previous notification gets
      // replaced instead of piling up — but per the Notification spec,
      // replacing a same-tag notification is SILENT (no sound, no
      // popup/toast) unless renotify is explicitly turned on. Without
      // it, only the very first notification of a session ever
      // actually alerts you; every one after that just swaps in
      // quietly in the background, which looks/feels like it got
      // muted. renotify:true keeps the one-at-a-time tag behavior but
      // makes every replacement alert again too.
      const n = new Notification('Studie timer klaar ⏰', { body: label ? `"${label}" is afgelopen.` : 'Je sessie is afgelopen.', tag: 'study-timer-done', renotify: true, icon: 'assets/icons/favicon.svg' });
      n.onclick = () => { window.focus(); n.close(); };
    } catch { /* Notification constructor can throw in odd embedded contexts — badge dot still covers it */ }
  }

  function currentRunningTimer() {
    if (!who) return null;
    const state = readAll()[who];
    return state?.runningTimer || null;
  }

  function stepLabelFor(runningTimer) {
    if (!who || !runningTimer) return '';
    const state = readAll()[who];
    if (!state) return '';
    const preset = runningTimer.sessionOnly
      ? (state.sessionOnlyPreset?.date === today() ? state.sessionOnlyPreset.preset : null)
      : state.presets?.find((p) => p.id === runningTimer.presetId);
    return preset?.steps?.[runningTimer.stepIndex]?.name || '';
  }

  function tick() {
    const runningTimer = currentRunningTimer();
    if (!runningTimer) {
      paint({ visible: false });
      notifiedEndsAt = null;
      return;
    }
    const remainingSeconds = (runningTimer.endsAt - Date.now()) / 1000;
    const finished = remainingSeconds <= 0;

    // Notifications don't depend on whether the clock is hidden.
    if (finished && notifiedEndsAt !== runningTimer.endsAt) {
      notifiedEndsAt = runningTimer.endsAt;
      notifyStepFinished(stepLabelFor(runningTimer));
    }

    // Hidden on the Studie Timer page -> hidden here too. The correct
    // time is simply recomputed from endsAt as soon as it's un-hidden.
    if (isTimerHidden()) {
      paint({ visible: false });
      return;
    }
    paint({
      visible: true,
      text: finished ? '00:00:00' : format(remainingSeconds),
      done: finished,
      title: finished ? 'Studie timer — klaar, ga terug naar de timer' : 'Studie timer loopt',
    });
  }

  tick();
  setInterval(tick, CHECK_INTERVAL_MS);

  // Cross-tab: if the timer is started/stopped/finished (or hidden/shown)
  // in another open tab, this tab's badge should catch up immediately
  // rather than waiting up to a second.
  window.addEventListener('storage', (event) => {
    if (event.key === KEY || event.key === HIDDEN_KEY) tick();
  });

  // Same tab: the eye button on timer.html (study-timer.js) calls setTimerHidden().
  window.addEventListener(VISIBILITY_EVENT, tick);

  onAuthChange((nextAuth) => {
    who = nextAuth?.who || null;
    notifiedEndsAt = null;
    tick();
  });
}
