import { siteConfig } from '../config.js';
import { getAuth, currentPersonLabel, onAuthChange } from './auth.js';
import { escapeHtml } from './utils.js';

// Achter-de-schermen spelbalans. Niet als instellingen op de website tonen.
const REWARD_CONFIG = Object.freeze({
  MAX_POINTS_PER_TREE: 100,
  DIFFICULTY_POINTS: Object.freeze([0, 5, 10, 15, 20, 25]),
  RATING_MULTIPLIER: Object.freeze([0, 0.5, 0.75, 1, 1.15, 1.3]),
});

// Voeg later eenvoudig bomen toe aan deze lijst. Na de laatste begint de cyclus opnieuw.
const TREE_CATALOG = [
  { id: 'apple', name: 'Appelboom', stages: ['🌱','🌿','🌳','🌳🍎','🌳🍎🍎','🌳🍎🍎🌸'] },
  { id: 'cherry', name: 'Kersenboom', stages: ['🌱','🌿','🌸','🌸🌸','🌳🌸🌸','🌳🌸🌸🌸'] },
  { id: 'pear', name: 'Perenboom', stages: ['🌱','🌿','🌳','🌳🍐','🌳🍐🍐','🌳🍐🍐🌼'] },
  { id: 'oak', name: 'Eik', stages: ['🌱','🌿','🌳','🌳','🌳🍂','🌳🍂🍂'] },
  { id: 'pine', name: 'Den', stages: ['🌱','🌲','🌲','🌲🌲','🌲🌲🌲','🌲🌲🌲❄️'] },
];

const TREE_STAGES = ['Zaadje','Spruitje','Jong boompje','Bloeiende boom','Volle boom','Volgroeid'];
const RATING_LABELS = ['Niet goed','Kon beter','Neutraal','Degelijk','Goed'];
const KEY = 'studyTimerStateV2';
const DEFAULT_PRESET = {
  id: 'studiedag',
  name: 'Studiedag',
  steps: [
    { type: 'task',  name: 'Werk 1', minutes: 60, difficulty: 3 },
    { type: 'break', name: 'Pauze 1', minutes: 15 },
    { type: 'task',  name: 'Werk 2', minutes: 60, difficulty: 3 },
    { type: 'break', name: 'Pauze 2', minutes: 15 },
    { type: 'task',  name: 'Werk 3', minutes: 60, difficulty: 3 },
    { type: 'break', name: 'Lange pauze', minutes: 45 },
    { type: 'task',  name: 'Werk 4', minutes: 60, difficulty: 3 },
    { type: 'break', name: 'Pauze 4', minutes: 15 },
    { type: 'task',  name: 'Werk 5', minutes: 60, difficulty: 3 },
    { type: 'break', name: 'Pauze 5', minutes: 15 },
  ],
};
const DEFAULT_OTHER_PRESET = {
  id: 'anders',
  name: 'Anders',
  steps: [
    { type: 'task', name: 'Taak 1', minutes: 15, difficulty: 3 },
    { type: 'task', name: 'Taak 2', minutes: 15, difficulty: 3 },
    { type: 'task', name: 'Taak 3', minutes: 15, difficulty: 3 },
    { type: 'task', name: 'Taak 4', minutes: 15, difficulty: 3 },
    { type: 'break', name: 'Pauze 1', minutes: 15 },
    { type: 'task', name: 'Taak 5', minutes: 15, difficulty: 3 },
    { type: 'task', name: 'Taak 6', minutes: 15, difficulty: 3 },
    { type: 'task', name: 'Taak 7', minutes: 15, difficulty: 3 },
    { type: 'task', name: 'Taak 8', minutes: 15, difficulty: 3 },
    { type: 'break', name: 'Pauze 2', minutes: 15 },
    { type: 'task', name: 'Taak 9', minutes: 15, difficulty: 3 },
    { type: 'task', name: 'Taak 10', minutes: 15, difficulty: 3 },
    { type: 'task', name: 'Taak 11', minutes: 15, difficulty: 3 },
    { type: 'task', name: 'Taak 12', minutes: 15, difficulty: 3 },
    { type: 'break', name: 'Pauze 3', minutes: 15 },
  ],
};

// Sound that plays when a timer step finishes (see finishStep() below).
// Fades out and stops as soon as the "session done" rating popup it
// belongs to is closed — see the MutationObserver set up in
// initStudyTimer() below.
const TIMER_COMPLETE_SOUND_SRC = new URL('../../audio/timer-complete.mp4', import.meta.url).href;
const TIMER_SOUND_FADE_MS = 600;

function clone(value) { return structuredClone(value); }
function today() { return new Date().toISOString().slice(0, 10); }
function format(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
/** Formats a duration given in (possibly fractional) minutes as e.g. "1u 5min", "45 min", "90 sec" — used for the preset-card totals. */
function formatDuration(totalMinutes) {
  const totalSeconds = Math.max(0, Math.round(totalMinutes * 60));
  if (totalSeconds < 60) return `${totalSeconds} sec`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours) parts.push(`${hours}u`);
  if (minutes || (!hours && !seconds)) parts.push(`${minutes}min`);
  if (seconds) parts.push(`${seconds}s`);
  return parts.join(' ');
}
function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
function ensureUser(store, who) {
  if (!store[who]) {
    store[who] = {
      presets: [clone(DEFAULT_PRESET), clone(DEFAULT_OTHER_PRESET)],
      growth: 0,
      lifetimePoints: 0,
      treeIndex: 0,
      treesCompleted: 0,
      completed: [],
      claimed: [],
      treeName: 'Mijn boom',
      dailyPlan: null,
      reflections: {},
      sessionOnlyPreset: null,
      runningTimer: null,
    };
  }
  // Upgrade older saved state without losing user content.
  store[who].presets ||= [clone(DEFAULT_PRESET), clone(DEFAULT_OTHER_PRESET)];
  if (!store[who].presets.some((p) => p.id === DEFAULT_PRESET.id)) store[who].presets.unshift(clone(DEFAULT_PRESET));
  if (!store[who].presets.some((p) => p.id === DEFAULT_OTHER_PRESET.id)) store[who].presets.splice(1, 0, clone(DEFAULT_OTHER_PRESET));
  store[who].presets.forEach((p) => { p.steps = (p.steps || []).map((step) => step.type === 'break' ? { type: 'break', name: step.name, minutes: step.minutes } : { ...step, difficulty: Number(step.difficulty) || 3 }); });
  store[who].completed ||= [];
  store[who].claimed ||= [];
  store[who].reflections ||= {};
  store[who].sessionOnlyPreset ||= null;
  store[who].runningTimer ||= null;
  store[who].treeIndex = Number.isFinite(store[who].treeIndex) ? store[who].treeIndex : 0;
  store[who].growth = Number.isFinite(store[who].growth) ? store[who].growth : 0;
  store[who].treesCompleted = Number.isFinite(store[who].treesCompleted) ? store[who].treesCompleted : 0;
  store[who].lifetimePoints = Number.isFinite(store[who].lifetimePoints) ? store[who].lifetimePoints : (store[who].treesCompleted * REWARD_CONFIG.MAX_POINTS_PER_TREE + store[who].growth);
  store[who].treeName ||= 'Mijn boom';
  return store[who];
}

export function initStudyTimer() {
  const root = document.getElementById('studyTimerApp');
  if (!root) return;

  // Kept so we can restore the full app markup after logging in — see
  // renderAuthState() below, which replaces root.innerHTML with a
  // "please log in" message while logged out.
  const loggedOutMarkup = `<div class="study-login card-like"><h1>Studie Timer</h1><p>Log in via <strong>Profiel</strong> rechtsboven om je eigen studieplanning en boom te gebruiken.</p></div>`;
  const loggedInMarkup = root.innerHTML;

  let all = readAll();
  const auth = getAuth();
  let selectedWho = auth?.who || null;
  let state = selectedWho ? ensureUser(all, selectedWho) : null;
  let interval = null;
  let selectedPresetId = state?.dailyPlan?.presetId || state?.presets?.[0]?.id || null;
  let currentStep = state?.dailyPlan?.currentStep ?? 0;
  // The running timer is tracked as an absolute end-of-step timestamp
  // (endsAt) rather than a plain "seconds remaining" counter that ticks
  // down every second. That's what lets the timer survive a refresh, a
  // switch to another tab (where setInterval gets throttled and a
  // counter would drift), or the browser closing entirely: as long as
  // endsAt is saved, `remaining` can always be recomputed from
  // Date.now() on the next load, no matter how much time actually
  // passed — no background worker needed. It also means "continuing
  // into another day" just works: the step keeps counting down past
  // midnight exactly like it would within the same day.
  let remaining = 3600;
  let running = false;
  let editorId = null;
  let editingSessionOnly = false;
  let sessionOnlyPreset = null;

  const $ = (selector) => root.querySelector(selector);

  // --- Timer-complete sound: plays when a step finishes, fades out and
  // stops as soon as the "session done" popup it belongs to closes
  // (see the MutationObserver a bit further down). ---
  let completeAudio = null;
  let fadeInterval = null;
  function stopCompleteSoundImmediately() {
    if (fadeInterval) { clearInterval(fadeInterval); fadeInterval = null; }
    if (completeAudio) { completeAudio.pause(); completeAudio.currentTime = 0; }
  }
  function fadeOutAndStopCompleteSound() {
    if (!completeAudio || completeAudio.paused) return;
    if (fadeInterval) return; // already fading
    const steps = 12;
    const startVolume = completeAudio.volume;
    let step = 0;
    fadeInterval = setInterval(() => {
      step += 1;
      completeAudio.volume = Math.max(0, startVolume * (1 - step / steps));
      if (step >= steps) {
        clearInterval(fadeInterval);
        fadeInterval = null;
        stopCompleteSoundImmediately();
        completeAudio.volume = startVolume;
      }
    }, TIMER_SOUND_FADE_MS / steps);
  }
  function playCompleteSound() {
    stopCompleteSoundImmediately();
    if (!completeAudio) completeAudio = new Audio(TIMER_COMPLETE_SOUND_SRC);
    completeAudio.currentTime = 0;
    completeAudio.volume = 1;
    completeAudio.play().catch(() => {}); // ignore autoplay-policy rejections
  }
  // Leaving the "session done" rating popup (however that happens: the
  // save button, or any other future way to close it) fades the sound
  // out and stops it — watching for the .rating-modal node being
  // removed from `root` covers every dismissal path in one place,
  // rather than having to remember to call this at each one.
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.removedNodes) {
        if (node.nodeType === 1 && node.classList?.contains('rating-modal')) {
          fadeOutAndStopCompleteSound();
          return;
        }
      }
    }
  }).observe(root, { childList: true });

  const save = () => {
    if (!selectedWho || !state) return;
    all[selectedWho] = state;
    localStorage.setItem(KEY, JSON.stringify(all));
  };

  function selectedPreset() {
    if (sessionOnlyPreset && sessionOnlyPreset.id === selectedPresetId) return sessionOnlyPreset;
    return state?.presets.find((p) => p.id === selectedPresetId) || state?.presets[0] || null;
  }

  function taskCount(preset) { return (preset?.steps || []).filter((s) => s.type === 'task').length; }
  function completedToday() {
    return state?.completed.filter((x) => x.date === today()) || [];
  }

  function setRemainingFromStep() {
    const step = selectedPreset()?.steps[currentStep];
    const totalMinutes = Number.isFinite(step?.minutes) ? step.minutes : 60;
    remaining = Math.max(1, Math.round(totalMinutes * 60));
  }

  // Persists the running timer as an absolute end timestamp so it can
  // be reconstructed after a refresh/new day (see the comment on the
  // `remaining`/`endsAt` design near the top of initStudyTimer()).
  function persistRunningTimer(endsAt) {
    if (!state) return;
    state.runningTimer = endsAt ? { presetId: selectedPresetId, stepIndex: currentStep, endsAt, sessionOnly: Boolean(sessionOnlyPreset) } : null;
    save();
  }

  function renderAuthState() {
    const isShowingLoggedOut = root.querySelector('.study-login') !== null;
    if (!state) {
      if (!isShowingLoggedOut) root.innerHTML = loggedOutMarkup;
      return false;
    }
    if (isShowingLoggedOut) {
      // Coming back from the logged-out message: restore the full app
      // markup and rebind its element-scoped listeners (the ones bound
      // once below, right after initStudyTimer's declarations, only ran
      // against the ORIGINAL elements — those were destroyed above).
      root.innerHTML = loggedInMarkup;
      bindStaticListeners();
    }
    return true;
  }

  function currentTree() { return TREE_CATALOG[state.treeIndex % TREE_CATALOG.length]; }

  function renderTree() {
    const tree = currentTree();
    const points = Math.max(0, Math.min(REWARD_CONFIG.MAX_POINTS_PER_TREE, state.growth));
    const stage = Math.min(TREE_STAGES.length - 1, Math.floor((points / REWARD_CONFIG.MAX_POINTS_PER_TREE) * TREE_STAGES.length));
    $('#treeTitle').textContent = state.treeName || `Mijn ${tree.name.toLowerCase()}`;
    $('#treeGraphic').textContent = tree.stages[stage];
    $('#growthPoints').textContent = `${points} / ${REWARD_CONFIG.MAX_POINTS_PER_TREE} groei`;
    $('#treeCountText').textContent = tree.name;
    $('#growthBar').style.width = `${(points / REWARD_CONFIG.MAX_POINTS_PER_TREE) * 100}%`;
    $('#treeNameInput').value = state.treeName || '';
  }

  function renderTimer() {
    const preset = selectedPreset();
    const step = preset?.steps[currentStep];
    if (!step) {
      $('#timerPhaseBadge').textContent = 'Klaar';
      $('#timerStepText').textContent = 'Vandaag';
      $('#timerDisplay').textContent = '00:00:00';
      $('#currentTaskName').textContent = 'Maak eerst een preset';
      $('#currentTaskMeta').textContent = '';
      $('#timerToggle').disabled = true;
      $('#timerToggle').textContent = '▶ Start';
      $('#timerToggle').classList.remove('btn-ghost'); $('#timerToggle').classList.add('btn-primary');
      $('#skipStep').classList.add('hidden');
      return;
    }
    $('#timerPhaseBadge').textContent = step.type === 'break' ? 'Pauze' : 'Taak';
    const taskSteps = preset.steps.filter((s) => s.type === 'task');
    const tasksDone = preset.steps.slice(0, currentStep).filter((s) => s.type === 'task').length;
    $('#timerStepText').textContent = `${tasksDone} / ${taskSteps.length} taken gedaan`;
    const isHidden = root.classList.contains('timer-blurred');
    $('#timerDisplay').textContent = isHidden ? '00:00:00' : format(remaining);
    $('#currentTaskName').textContent = step.name;
    $('#currentTaskMeta').textContent = step.type === 'task' ? `Moeilijkheid ${step.difficulty} / 5` : 'Even opladen voor de volgende taak';
    const toggleBtn = $('#timerToggle');
    toggleBtn.disabled = false;
    toggleBtn.textContent = running ? 'Ⅱ Pauze' : '▶ Start';
    toggleBtn.classList.toggle('btn-primary', !running);
    toggleBtn.classList.toggle('btn-ghost', running);
    const skipBtn = $('#skipStep');
    skipBtn.textContent = step.type === 'break' ? '⏭ Pauze overslaan' : '⏭ Taak overslaan';
    skipBtn.classList.toggle('hidden', !running);
  }

  function renderPresets() {
    const list = $('#presetList');
    const sessionCard = sessionOnlyPreset ? `<div class="preset-item selected preset-item-session">
        <div class="preset-info"><strong>${escapeHtml(sessionOnlyPreset.name)} <span class="session-tag">(alleen nu)</span></strong><small>${taskCount(sessionOnlyPreset)} taken · ${formatDuration(sessionOnlyPreset.steps.reduce((s, x) => s + x.minutes, 0))}</small></div>
        <div class="preset-buttons">
          <span class="btn btn-primary btn-sm" aria-hidden="true">✓ Actief</span>
          <button type="button" class="btn btn-sm" data-edit-session title="Bewerken">✏️ Wijzig</button>
        </div>
      </div>` : '';
    list.innerHTML = sessionCard + (state.presets || []).map((p) => {
      const tasks = taskCount(p);
      const total = p.steps.reduce((sum, s) => sum + s.minutes, 0);
      const fixed = p.id === DEFAULT_PRESET.id || p.id === DEFAULT_OTHER_PRESET.id;
      const isActive = !sessionOnlyPreset && p.id === selectedPresetId;
      return `<div class="preset-item ${isActive ? 'selected' : ''}">
        <div class="preset-info"><strong>${escapeHtml(p.name)}</strong><small>${tasks} taken · ${formatDuration(total)}</small></div>
        <div class="preset-buttons">
          <button type="button" class="btn btn-primary btn-sm" data-select-preset="${escapeHtml(p.id)}">${isActive ? '✓ Actief' : 'Gebruik'}</button>
          <button type="button" class="btn btn-sm" data-edit="${escapeHtml(p.id)}" title="Bewerken">✏️ Wijzig</button>
          ${fixed ? '' : `<button type="button" class="btn btn-ghost btn-sm" data-delete="${escapeHtml(p.id)}" title="Verwijderen">✕</button>`}
        </div>
      </div>`;
    }).join('');
  }
  function renderAll() {
    if (!renderAuthState()) return;
    renderTree(); renderPresets(); renderTimer();
  }

  // "Alleen deze sessie gebruiken" presets survive a page refresh (so
  // reloading mid-session doesn't lose your plan) but only for the rest
  // of the calendar day — past midnight (or on any later refresh) they
  // silently expire and the app falls back to a saved preset again, so
  // they never linger like a "hidden" permanent preset would.
  function persistSessionOnlyPreset() {
    if (!selectedWho || !state) return;
    state.sessionOnlyPreset = sessionOnlyPreset ? { date: today(), preset: sessionOnlyPreset } : null;
    save();
  }
  function loadSessionOnlyPreset() {
    const saved = state?.sessionOnlyPreset;
    sessionOnlyPreset = saved && saved.date === today() ? saved.preset : null;
    if (state && saved && saved.date !== today()) { state.sessionOnlyPreset = null; save(); }
  }

  function setPreset(id) {
    const p = state.presets.find((x) => x.id === id);
    if (!p) return;
    clearInterval(interval); running = false;
    persistRunningTimer(null);
    sessionOnlyPreset = null;
    persistSessionOnlyPreset();
    selectedPresetId = id;
    currentStep = 0;
    setRemainingFromStep();
    state.dailyPlan = { date: today(), presetId: id, currentStep: 0 };
    save(); renderAll();
  }

  function useSessionOnly(preset) {
    clearInterval(interval); running = false;
    persistRunningTimer(null);
    sessionOnlyPreset = preset;
    persistSessionOnlyPreset();
    selectedPresetId = preset.id;
    currentStep = 0;
    setRemainingFromStep();
    renderAll();
  }

  function start() {
    if (!state || running) return;
    const preset = selectedPreset();
    const step = preset?.steps[currentStep];
    if (!step) return;
    if (!sessionOnlyPreset && (!state.dailyPlan || state.dailyPlan.date !== today() || state.dailyPlan.presetId !== preset.id)) {
      state.dailyPlan = { date: today(), presetId: preset.id, currentStep };
      save();
    }
    running = true;
    const endsAt = Date.now() + remaining * 1000;
    persistRunningTimer(endsAt);
    renderTimer();
    tickFrom(endsAt);
  }

  // Drives the countdown from an absolute end timestamp instead of
  // decrementing a counter each tick, so a throttled/suspended
  // background tab (or a tick that's simply a bit late) never causes
  // drift — `remaining` is always recomputed from the actual clock.
  function tickFrom(endsAt) {
    clearInterval(interval);
    const tick = () => {
      remaining = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
      if (remaining <= 0) {
        // Deliberately NOT clearing the persisted runningTimer here:
        // it stays saved (as "finished", endsAt in the past) until the
        // person actually deals with the step via advanceStep() —
        // e.g. by saving a rating, skipping, or finishing a break.
        // That's what keeps the header badge's red dot (see
        // study-timer-badge.js) showing "still needs attention"
        // rather than quietly disappearing the moment the countdown
        // hits zero, even if nobody's looking at this tab right now.
        clearInterval(interval); running = false; finishStep();
      }
      renderTimer();
    };
    tick();
    interval = setInterval(tick, 1000);
  }

  function pause() {
    running = false;
    clearInterval(interval);
    persistRunningTimer(null);
    renderTimer();
  }

  // Called once on load (and after switching day/user) to pick back up
  // a timer that was running when the tab was last open — including
  // across a full browser close, or into the next calendar day. If the
  // saved end time has already passed, the step is simply treated as
  // finished right now (rather than trying to silently fast-forward
  // through however many steps "should" have completed while nobody
  // was watching), which then plays the normal finish flow.
  function resumeRunningTimerIfAny() {
    const saved = state?.runningTimer;
    if (!saved) return;
    const presetForTimer = saved.sessionOnly ? sessionOnlyPreset : state.presets.find((p) => p.id === saved.presetId);
    if (!presetForTimer || presetForTimer.id !== saved.presetId || !presetForTimer.steps[saved.stepIndex]) {
      state.runningTimer = null; save();
      return;
    }
    selectedPresetId = saved.presetId;
    currentStep = saved.stepIndex;
    if (saved.endsAt <= Date.now()) {
      // Already finished while we were away (possibly on another day
      // entirely) — leave state.runningTimer in place (the badge's red
      // dot depends on it) and show the step as finished right now,
      // same as if the countdown had just hit zero in this tab.
      remaining = 0;
      finishStep();
      return;
    }
    running = true;
    tickFrom(saved.endsAt);
  }

  function advanceStep() {
    const preset = selectedPreset();
    if (!preset?.steps.length) return;
    currentStep = (currentStep + 1) % preset.steps.length;
    setRemainingFromStep();
    persistRunningTimer(null);
    if (!sessionOnlyPreset) {
      state.dailyPlan = { date: today(), presetId: preset.id, currentStep };
      save();
    }
    renderTimer();
  }

  function confirmSkipTask(step) {
    const old = root.querySelector('.rating-modal'); if (old) old.remove();
    const modal = document.createElement('div');
    modal.className = 'rating-modal';
    modal.innerHTML = `<div class="rating-dialog" role="dialog" aria-modal="true">
      <span class="eyebrow">Taak overslaan</span>
      <h2>Weet je het zeker?</h2>
      <p>Je slaat <strong>${escapeHtml(step.name)}</strong> over zonder deze af te ronden. Je krijgt hier geen groei voor.</p>
      <div class="timer-actions">
        <button type="button" id="skipTaskConfirmNo" class="btn btn-ghost">Nee</button>
        <button type="button" id="skipTaskConfirmYes" class="btn btn-primary">Ja, overslaan</button>
      </div>
    </div>`;
    root.append(modal);
    modal.querySelector('#skipTaskConfirmNo').addEventListener('click', () => modal.remove());
    modal.querySelector('#skipTaskConfirmYes').addEventListener('click', () => {
      modal.remove();
      clearInterval(interval); running = false; persistRunningTimer(null);
      advanceStep();
    });
  }

  function finishStep() {
    const preset = selectedPreset();
    const step = preset?.steps[currentStep];
    if (!step) return;
    playCompleteSound();
    if (step.type === 'break') { advanceStep(); return; }
    showSessionRating(step);
  }

  function addTaskCompletion(step, rating) {
    const base = REWARD_CONFIG.DIFFICULTY_POINTS[step.difficulty] || REWARD_CONFIG.DIFFICULTY_POINTS[3];
    const gain = Math.max(1, Math.round(base * REWARD_CONFIG.RATING_MULTIPLIER[rating]));
    state.growth += gain;
    state.lifetimePoints += gain;
    while (state.growth >= REWARD_CONFIG.MAX_POINTS_PER_TREE) {
      state.growth -= REWARD_CONFIG.MAX_POINTS_PER_TREE;
      state.treesCompleted += 1;
      state.treeIndex = (state.treeIndex + 1) % TREE_CATALOG.length;
      state.claimed = [];
    }
    state.completed.push({ date: today(), minutes: step.minutes, rating, points: gain, preset: presetName(), task: step.name, at: Date.now() });
    return gain;
  }

  function presetName() { return selectedPreset()?.name || ''; }

  function showSessionRating(step) {
    const old = root.querySelector('.rating-modal'); if (old) old.remove();
    const modal = document.createElement('div');
    modal.className = 'rating-modal';
    modal.innerHTML = `<div class="rating-dialog" role="dialog" aria-modal="true">
      <span class="eyebrow">Sessie afgerond ✨</span>
      <h2>Hoe ging het?</h2>
      <p><strong>${escapeHtml(step.name)}</strong> is klaar.</p>
      <div class="rating-label-row"><span>Niet goed</span><output id="sessionRatingValue">3 / 5 · Neutraal</output><span>Goed</span></div>
      <input id="sessionRating" class="full-range" type="range" min="1" max="5" step="1" value="3">
      <div class="timer-actions"><button type="button" id="ratingSave" class="btn btn-primary">🌱 Groei opslaan</button></div>
    </div>`;
    root.append(modal);
    const range = modal.querySelector('#sessionRating');
    const output = modal.querySelector('#sessionRatingValue');
    const update = () => { const n = Number(range.value); output.textContent = `${n} / 5 · ${RATING_LABELS[n - 1]}`; };
    range.addEventListener('input', update);
    modal.querySelector('#ratingSave').addEventListener('click', () => {
      const gain = addTaskCompletion(step, Number(range.value));
      modal.remove();
      advanceStep();
      renderAll();
      if (isDayComplete()) showDayReflection(gain);
    });
  }

  function isDayComplete() {
    const preset = selectedPreset();
    const total = taskCount(preset);
    return total > 0 && completedToday().filter((x) => x.preset === preset.name).length >= total;
  }

  function showDayReflection() {
    const old = root.querySelector('.rating-modal'); if (old) old.remove();
    const existing = state.reflections[today()];
    const modal = document.createElement('div');
    modal.className = 'rating-modal';
    modal.innerHTML = `<div class="rating-dialog" role="dialog" aria-modal="true">
      <span class="eyebrow">Dag afgerond 🌙</span>
      <h2>Hoe ging je dag?</h2>
      <p>Je hebt alle taken van deze planning afgerond. Geef je dag een korte reflectie.</p>
      <div class="rating-label-row"><span>Niet goed</span><output id="dayRatingValue">${existing?.rating || 3} / 5 · ${RATING_LABELS[(existing?.rating || 3) - 1]}</output><span>Goed</span></div>
      <input id="dayRating" class="full-range" type="range" min="1" max="5" step="1" value="${existing?.rating || 3}">
      <textarea id="dayReflection" rows="3" maxlength="500" placeholder="Wat ging goed? Wat wil je morgen anders doen?">${escapeHtml(existing?.text || '')}</textarea>
      <div class="timer-actions"><button type="button" id="dayReflectionSave" class="btn btn-primary">Dag opslaan</button></div>
    </div>`;
    root.append(modal);
    const range = modal.querySelector('#dayRating'); const output = modal.querySelector('#dayRatingValue');
    range.addEventListener('input', () => { const n = Number(range.value); output.textContent = `${n} / 5 · ${RATING_LABELS[n - 1]}`; });
    modal.querySelector('#dayReflectionSave').addEventListener('click', () => {
      const rating = Number(range.value);
      state.reflections[today()] = { rating, text: modal.querySelector('#dayReflection').value.trim(), at: Date.now() };
      save(); modal.remove();
    });
  }

  function openEditor(id = null, sessionPreset = null) {
    editorId = id;
    editingSessionOnly = Boolean(sessionPreset);
    const preset = sessionPreset || (id ? state.presets.find((p) => p.id === id) : { name: '', steps: [{ type: 'task', name: 'Nieuwe taak', minutes: 25, difficulty: 3 }] });
    $('#editorTitle').textContent = editingSessionOnly ? 'Sessiepreset bewerken' : (id ? 'Preset bewerken' : 'Nieuwe preset');
    $('#presetName').value = preset.name;
    renderStepEditor(preset.steps);
    // Editing the current "alleen deze sessie" preset: saving it again as
    // session-only would just create a second, redundant temporary
    // preset, so that action is disabled here — submitting the form
    // (which updates the existing session-only preset in place) or
    // closing the editor are the only ways forward.
    const useOnceBtn = $('#useOnceBtn');
    useOnceBtn.disabled = editingSessionOnly;
    useOnceBtn.title = editingSessionOnly ? 'Je bewerkt al de sessie-only preset — sla je wijzigingen op met "Preset opslaan".' : '';
    $('#presetEditor').classList.remove('hidden');
    $('#presetEditor').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderStepEditor(steps) {
    $('#stepEditorList').innerHTML = steps.map((s, i) => {
      const totalSeconds = Math.max(1, Math.round((s.minutes || 0) * 60));
      const mins = Math.floor(totalSeconds / 60);
      const secs = totalSeconds % 60;
      return `<div class="step-editor" data-index="${i}">
      <label>Type<select class="step-type"><option value="task" ${s.type === 'task' ? 'selected' : ''}>Taak</option><option value="break" ${s.type === 'break' ? 'selected' : ''}>Pauze</option></select></label>
      <label>Naam<input class="step-name" maxlength="60" value="${escapeHtml(s.name)}"></label>
      <div class="duration-field">
        <span class="duration-field-label">Duur</span>
        <div class="duration-inputs">
          <label class="duration-subfield"><input class="step-min" type="number" min="0" max="600" value="${mins}"><span>min</span></label>
          <label class="duration-subfield"><input class="step-sec" type="number" min="0" max="59" value="${secs}"><span>sec</span></label>
        </div>
      </div>
      ${s.type === 'task' ? `<div class="difficulty-field"><div class="range-label-row"><label for="step-diff-${i}">Moeilijkheid</label><output class="step-diff-value">${s.difficulty || 3} / 5</output></div><input id="step-diff-${i}" class="step-diff full-range" type="range" min="1" max="5" step="1" value="${s.difficulty || 3}"></div>` : '<div class="difficulty-field empty-field" aria-hidden="true"></div>'}
      <button type="button" class="btn btn-ghost remove-step" title="Verwijderen">✕</button>
    </div>`;
    }).join('');
  }
  function readSteps() {
    return [...$('#stepEditorList').querySelectorAll('.step-editor')].map((row) => {
      const mins = Math.max(0, Math.min(600, Number(row.querySelector('.step-min').value) || 0));
      const secs = Math.max(0, Math.min(59, Number(row.querySelector('.step-sec').value) || 0));
      const totalMinutes = Math.max(1 / 60, mins + secs / 60); // at least 1 second
      return {
        type: row.querySelector('.step-type').value,
        name: row.querySelector('.step-name').value.trim() || 'Stap',
        minutes: totalMinutes,
        ...(row.querySelector('.step-type').value === 'task' ? { difficulty: Math.max(1, Math.min(5, Number(row.querySelector('.step-diff')?.value) || 3)) } : {}),
      };
    });
  }

  root.addEventListener('input', (event) => {
    if (event.target.matches('.step-diff')) {
      const row = event.target.closest('.step-editor');
      row.querySelector('.step-diff-value').textContent = `${event.target.value} / 5`;
    }
  });

  // Number inputs (e.g. .step-min) silently bump their value by 1 per
  // wheel tick when focused and the mouse happens to be over them — a
  // browser default that's easy to trigger by accident while scrolling
  // the page (typing "60", then scrolling down past the field nudges it
  // to 58). Blur on wheel so scrolling the page never changes the value;
  // the person can still edit it by clicking back in and typing/using
  // the spinner arrows.
  root.addEventListener('wheel', (event) => {
    if (event.target.matches('input[type="number"]') && document.activeElement === event.target) {
      event.target.blur();
    }
  }, { passive: true });

  root.addEventListener('change', (event) => {
    if (event.target.matches('.step-type')) {
      const steps = readSteps();
      const row = event.target.closest('.step-editor');
      const i = Number(row.dataset.index);
      steps[i].type = event.target.value;
      if (steps[i].type === 'break') delete steps[i].difficulty;
      else steps[i].difficulty = 3;
      renderStepEditor(steps);
    }
  });

  root.addEventListener('click', (event) => {
    const startBtn = event.target.closest('[data-start]');
    if (startBtn) { setPreset(startBtn.dataset.start); start(); return; }
    const selectPresetBtn = event.target.closest('[data-select-preset]');
    if (selectPresetBtn) { setPreset(selectPresetBtn.dataset.selectPreset); return; }
    const editBtn = event.target.closest('[data-edit]');
    if (editBtn) { openEditor(editBtn.dataset.edit); return; }
    if (event.target.closest('[data-edit-session]')) { openEditor(null, sessionOnlyPreset); return; }
    const deleteBtn = event.target.closest('[data-delete]');
    if (deleteBtn) {
      if (deleteBtn.dataset.delete === DEFAULT_PRESET.id || deleteBtn.dataset.delete === DEFAULT_OTHER_PRESET.id) { alert('Studiedag en Anders blijven altijd beschikbaar.'); return; }
      if (confirm('Deze preset verwijderen?')) {
        state.presets = state.presets.filter((p) => p.id !== deleteBtn.dataset.delete);
        if (selectedPresetId === deleteBtn.dataset.delete) { selectedPresetId = state.presets[0].id; currentStep = 0; setRemainingFromStep(); }
        save(); renderAll();
      }
      return;
    }
    if (event.target.closest('#timerToggle')) { running ? pause() : start(); return; }
    if (event.target.closest('#timerReset')) { running = false; clearInterval(interval); persistRunningTimer(null); setRemainingFromStep(); renderTimer(); return; }
    if (event.target.closest('#skipStep')) {
      const preset = selectedPreset();
      const step = preset?.steps[currentStep];
      if (!step) return;
      if (step.type === 'break') {
        // Skipping a break needs no confirmation — nothing is lost by
        // cutting a rest period short.
        clearInterval(interval); running = false; persistRunningTimer(null); advanceStep();
      } else {
        // Skipping a task discards progress on it, so confirm first
        // (see confirmSkipTask() below) — breaks don't need this.
        confirmSkipTask(step);
      }
      return;
    }
    if (event.target.closest('#timerVisibility')) {
      root.classList.toggle('timer-blurred');
      const hidden = root.classList.contains('timer-blurred');
      const button = $('#timerVisibility');
      button.setAttribute('aria-label', hidden ? 'Timer tonen' : 'Timer verbergen');
      button.title = hidden ? 'Timer tonen' : 'Timer verbergen';
      renderTimer();
      return;
    }
    if (event.target.closest('#newPresetBtn')) { openEditor(); return; }
    if (event.target.closest('#closeEditorBtn')) { $('#presetEditor').classList.add('hidden'); return; }
    if (event.target.closest('#addStepBtn')) { const steps = readSteps(); steps.push({ type: 'task', name: 'Nieuwe taak', minutes: 25, difficulty: 3 }); renderStepEditor(steps); return; }
    if (event.target.closest('.remove-step')) { const steps = readSteps(); const i = Number(event.target.closest('.step-editor').dataset.index); steps.splice(i, 1); if (!steps.length) steps.push({ type: 'task', name: 'Nieuwe taak', minutes: 25, difficulty: 3 }); renderStepEditor(steps); }
  });

  // Listeners bound directly to specific elements (rather than delegated
  // via `root`'s click/input/change listeners further below) need to be
  // re-attached whenever renderAuthState() restores the app markup after
  // a fresh login, since that innerHTML swap destroys the old elements
  // those listeners were attached to.
  function bindStaticListeners() {
    $('#treeTitle').addEventListener('click', startTreeNameEdit);
    $('#treeTitle').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); startTreeNameEdit(); }
    });
    $('#treeNameInput').addEventListener('blur', () => stopTreeNameEdit(true));
    $('#treeNameInput').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); stopTreeNameEdit(true); }
      if (event.key === 'Escape') { event.preventDefault(); stopTreeNameEdit(false); }
    });
    $('#presetForm').addEventListener('submit', (event) => {
      event.preventDefault();
      if (editingSessionOnly) {
        // Update the existing session-only preset in place — it must
        // never become a second permanent preset (see openEditor()).
        sessionOnlyPreset = { ...sessionOnlyPreset, name: $('#presetName').value.trim() || sessionOnlyPreset.name, steps: readSteps() };
        persistSessionOnlyPreset();
        currentStep = 0; setRemainingFromStep();
        $('#presetEditor').classList.add('hidden'); renderAll();
        return;
      }
      const preset = { id: editorId || crypto.randomUUID(), name: $('#presetName').value.trim() || 'Nieuwe preset', steps: readSteps() };
      if (editorId) state.presets = state.presets.map((p) => p.id === editorId ? preset : p);
      else state.presets.push(preset);
      sessionOnlyPreset = null;
      selectedPresetId = preset.id; currentStep = 0; setRemainingFromStep(); state.dailyPlan = { date: today(), presetId: preset.id, currentStep: 0 };
      save(); $('#presetEditor').classList.add('hidden'); renderAll();
    });
    $('#useOnceBtn').addEventListener('click', () => {
      const name = $('#presetName').value.trim() || 'Sessie preset';
      const preset = { id: `session-${crypto.randomUUID()}`, name, steps: readSteps() };
      $('#presetEditor').classList.add('hidden');
      useSessionOnly(preset);
    });
  }

  function startTreeNameEdit() {
    const title = $('#treeTitle');
    const input = $('#treeNameInput');
    input.value = state.treeName || '';
    title.classList.add('hidden');
    input.classList.remove('hidden');
    input.focus();
    input.select();
  }
  function stopTreeNameEdit(commit) {
    const title = $('#treeTitle');
    const input = $('#treeNameInput');
    if (commit) {
      state.treeName = input.value.trim();
      save();
    }
    title.textContent = state.treeName || `Mijn ${currentTree().name.toLowerCase()}`;
    input.classList.add('hidden');
    title.classList.remove('hidden');
  }
  bindStaticListeners();

  onAuthChange((nextAuth) => {
    clearInterval(interval); running = false;
    stopCompleteSoundImmediately();
    selectedWho = nextAuth?.who || null;
    state = selectedWho ? ensureUser(all, selectedWho) : null;
    loadSessionOnlyPreset();
    selectedPresetId = sessionOnlyPreset?.id || state?.dailyPlan?.presetId || state?.presets?.[0]?.id || null;
    currentStep = state?.dailyPlan?.currentStep ?? 0;
    setRemainingFromStep();
    resumeRunningTimerIfAny();
    renderAll();
  });

  if (state) {
    loadSessionOnlyPreset();
    if (sessionOnlyPreset) {
      selectedPresetId = sessionOnlyPreset.id;
      currentStep = 0;
    } else {
      selectedPresetId = state.dailyPlan?.date === today() ? state.dailyPlan.presetId : state.presets[0]?.id;
      currentStep = state.dailyPlan?.date === today() ? (state.dailyPlan.currentStep || 0) : 0;
    }
    setRemainingFromStep();
    resumeRunningTimerIfAny();
  }
  renderAll();
}
