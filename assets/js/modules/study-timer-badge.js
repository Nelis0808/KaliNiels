// =================================================================
// STUDY TIMER — HEADER BADGE
// -----------------------------------------------------------------
// A small always-visible clock in the navbar (see assets/partials/
// header.html, #studyTimerBadge) that mirrors whatever the study
// timer (study-timer.js, on timer.html) is doing — live remaining
// time, and a red dot once it's hit 00:00:00 and is waiting for you
// to come back and deal with it. It runs on EVERY page (wired up in
// main.js like any other site-wide chrome piece), not just
// timer.html, by reading the same localStorage key study-timer.js
// writes to (studyTimerStateV2) rather than sharing any in-memory
// state with it — the two are intentionally decoupled so this badge
// works even on pages that never load study-timer.js at all.
//
// It also offers a desktop/OS notification when a step finishes
// while the tab is in the background or the browser isn't focused —
// the in-page "session done" popup in study-timer.js only helps if
// you're looking at the tab, so this is the "you're on another tab /
// away" backstop. Browsers only grant notification permission from a
// real, deliberate click on something that's clearly asking for it —
// silently requesting it on the first random click anywhere on the
// site is both against browser policy in most cases and, worse,
// trains people to reflexively dismiss a popup they don't understand
// the reason for, often permanently blocking it by accident. Instead,
// #studyTimerNotifyBtn (the 🔔 button next to the badge) is the ONE
// explicit, visible way to turn this on — see wireNotifyButton().
// =================================================================

import { getAuth, onAuthChange } from './auth.js';

const KEY = 'studyTimerStateV2';
const CHECK_INTERVAL_MS = 1000;

function today() { return new Date().toISOString().slice(0, 10); }

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}

function format(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function initStudyTimerBadge() {
  const badge = document.getElementById('studyTimerBadge');
  const timeEl = document.getElementById('studyTimerBadgeTime');
  const dotEl = document.getElementById('studyTimerBadgeDot');
  const notifyBtn = document.getElementById('studyTimerNotifyBtn');
  if (!badge || !timeEl || !dotEl) return;

  let who = getAuth()?.who || null;
  // Tracks the specific running-timer instance (by its end timestamp)
  // we've already fired a "finished" notification for, so a finished
  // timer sitting at 00:00:00 doesn't re-notify every second while
  // waiting for the person to deal with it — only the transition into
  // "finished" notifies once.
  let notifiedEndsAt = null;

  const notificationsSupported = 'Notification' in window;

  // Reflects the actual permission state in the 🔔 button: hidden once
  // granted (nothing left to do), a plain bell when it's still
  // possible to ask, and a crossed-out/"blocked" look with an
  // explanatory title when the person (or browser) has denied it —
  // that state can only be undone from the browser's own site
  // settings, not by JS, so the button becomes a hint instead of an
  // action in that case.
  function updateNotifyButton() {
    if (!notifyBtn) return;
    if (!notificationsSupported) { notifyBtn.classList.add('hidden'); return; }
    const permission = Notification.permission;
    if (permission === 'granted') {
      notifyBtn.classList.add('hidden');
      return;
    }
    notifyBtn.classList.remove('hidden');
    if (permission === 'denied') {
      notifyBtn.classList.add('is-blocked');
      notifyBtn.title = 'Meldingen zijn geblokkeerd in je browser. Zet ze aan via het slotje/site-instellingen naast de adresbalk om een melding te krijgen als je studietimer afloopt.';
      notifyBtn.setAttribute('aria-label', notifyBtn.title);
    } else {
      notifyBtn.classList.remove('is-blocked');
      notifyBtn.title = 'Meldingen aanzetten voor de studie timer';
      notifyBtn.setAttribute('aria-label', notifyBtn.title);
    }
  }

  // The ONLY place permission is requested — a real click on a button
  // that's clearly labelled as being about notifications, so the
  // browser's native permission prompt makes sense in context instead
  // of appearing out of nowhere.
  function wireNotifyButton() {
    if (!notifyBtn || !notificationsSupported) return;
    notifyBtn.addEventListener('click', async () => {
      if (Notification.permission === 'denied') {
        // JS can't re-prompt once denied — only the browser's own site
        // settings can. Explain that instead of silently doing
        // nothing when clicked.
        alert('Meldingen zijn geblokkeerd voor deze site. Klik op het slotje (of "i") naast de adresbalk, zet Meldingen op "Toestaan", en herlaad de pagina.');
        return;
      }
      await Notification.requestPermission();
      updateNotifyButton();
      if (Notification.permission === 'granted') {
        // Immediate confirmation so the person knows the click worked
        // — otherwise "did that do anything?" is a reasonable
        // question with an invisible feature like this one.
        try { new Notification('Meldingen aan ⏰', { body: 'Je krijgt nu een melding als je studietimer afloopt terwijl je op een ander tabblad zit.', tag: 'study-timer-notify-confirm' }); } catch { /* best-effort confirmation only */ }
      }
    });
  }

  function notifyStepFinished(label) {
    if (!notificationsSupported || Notification.permission !== 'granted') return;
    if (!document.hidden && document.hasFocus()) return; // only nudge when away from the tab
    try {
      const n = new Notification('Studie timer klaar ⏰', { body: label ? `"${label}" is afgelopen.` : 'Je sessie is afgelopen.', tag: 'study-timer-done', icon: 'assets/icons/favicon.svg' });
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
      badge.classList.add('hidden');
      notifiedEndsAt = null;
      return;
    }
    badge.classList.remove('hidden');
    const remainingSeconds = (runningTimer.endsAt - Date.now()) / 1000;
    const finished = remainingSeconds <= 0;
    timeEl.textContent = finished ? '00:00:00' : format(remainingSeconds);
    dotEl.classList.toggle('is-done', finished);
    badge.title = finished ? 'Studie timer — klaar, ga terug naar de timer' : 'Studie timer loopt';
    if (finished && notifiedEndsAt !== runningTimer.endsAt) {
      notifiedEndsAt = runningTimer.endsAt;
      notifyStepFinished(stepLabelFor(runningTimer));
    }
  }

  wireNotifyButton();
  updateNotifyButton();
  tick();
  setInterval(tick, CHECK_INTERVAL_MS);

  // Cross-tab: if the timer is started/stopped/finished in another
  // open tab, this tab's badge should catch up immediately rather
  // than waiting up to a second.
  window.addEventListener('storage', (event) => {
    if (event.key === KEY) tick();
  });

  onAuthChange((nextAuth) => {
    who = nextAuth?.who || null;
    notifiedEndsAt = null;
    tick();
  });
}
