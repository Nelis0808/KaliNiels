import { siteConfig } from '../config.js';
import { getAuth, currentPersonLabel, onAuthChange } from './auth.js';
import { escapeHtml } from './utils.js';

// Achter-de-schermen spelbalans. Niet als instellingen op de website tonen.
const REWARD_CONFIG = Object.freeze({
  MAX_POINTS_PER_TREE: 100,
  DIFFICULTY_POINTS: Object.freeze([0, 5, 10, 15, 20, 25]),
  RATING_MULTIPLIER: Object.freeze([0, 0.5, 0.75, 1, 1.15, 1.3]),
});

// Each stage has a single dominant "base" glyph (the seedling/sprout/
// trunk-and-canopy shape, rendered large and centered — see
// renderTreeGraphic()) plus zero or more small "accents" (fruit,
// blossom, decoration) that get positioned ON the base's canopy
// instead of laid out next to it. Previously a stage was just one
// flat emoji string (e.g. '🌳🍎🍎🌸'), which rendered as plain inline
// text: every glyph the same size, side by side, left-to-right — so
// on later stages the fruit landed to the RIGHT of the tree rather
// than looking like it was growing on it, and the shrink-to-fit sizing
// that kept 4-glyph stages from overflowing made the tree itself tiny
// too, even at stage "seed" with only one glyph. Splitting base vs.
// accents means the base can always render at one consistent large
// size (set via .tree-graphic's font-size in study-timer.css) and
// accents are layered on top of it via renderTreeGraphic()'s
// .tree-accent-emoji positioning.
//
// Max 5 accents per stage (see ACCENT_POSITIONS below, which only has
// 5 slots) — apple/cherry/pear build up steadily (1 accent partway
// through, then 3, then all 5 at "Volgroeid"); oak/pine hold off
// until later (0 accents until "Volle boom", then 3, then 5) to keep
// their slower/quieter feel. The trailing comment on each entry below
// lists other emoji that would also fit that tree if you want to swap
// or mix them in — they're not used by default, just handy options.
const TREE_CATALOG = [
  { id: 'apple', name: 'Appelboom', stages: [
    { base: '🌱', accents: [] },
    { base: '🌿', accents: [] },
    { base: '🌳', accents: [] },
    { base: '🌳', accents: ['🍎'] },
    { base: '🌳', accents: ['🍎', '🍎', '🍎'] },
    { base: '🌳', accents: ['🍎', '🍎', '🍎', '🍎', '🍎'] },
  ] }, // also handy: 🍏 (green apple), 🐛 (worm in one), 🐝/🦋 (pollinators, pairs well on the blossom-era stages), 🍯 (honey)
  { id: 'cherry', name: 'Kersenboom', stages: [
    { base: '🌱', accents: [] },
    { base: '🌿', accents: [] },
    { base: '🌳', accents: [] },
    { base: '🌳', accents: ['🌸'] },
    { base: '🌳', accents: ['🌸', '🌸', '🌸'] },
    { base: '🌳', accents: ['🌸', '🌸', '🌸', '🌸', '🌸'] },
  ] }, // also handy: 🍒 (actual cherries, if you'd rather show fruit than blossom), 🐝, 🦋
  { id: 'pear', name: 'Perenboom', stages: [
    { base: '🌱', accents: [] },
    { base: '🌿', accents: [] },
    { base: '🌳', accents: [] },
    { base: '🌳', accents: ['🍐'] },
    { base: '🌳', accents: ['🍐', '🍐', '🍐'] },
    { base: '🌳', accents: ['🍐', '🍐', '🍐', '🍐', '🍐'] },
  ] }, // also handy: 🐝, 🦋, 🍃
  { id: 'oak', name: 'Eik', stages: [
    { base: '🌱', accents: [] },
    { base: '🌿', accents: [] },
    { base: '🌳', accents: [] },
    { base: '🌳', accents: [] },
    { base: '🌳', accents: ['🍂', '🍂', '🍂'] },
    { base: '🌳', accents: ['🍂', '🍂', '🍂', '🍂', '🍂'] },
  ] }, // also handy: 🍁 (maple leaf, same autumn look), 🌰 (stands in for an acorn), 🐿️ (squirrel)
  { id: 'pine', name: 'Den', stages: [
    { base: '🌱', accents: [] },
    { base: '🌲', accents: [] },
    { base: '🌲', accents: [] },
    { base: '🌲', accents: [] },
    { base: '🌲', accents: ['❄️', '❄️', '❄️'] },
    { base: '🌲', accents: ['❄️', '❄️', '❄️', '❄️', '❄️'] },
  ] }, // also handy: ⭐ (tree topper), 🎁, 🔔, 🕯️ — a christmas-tree take on the same base glyph
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
/** Renders a "HH:MM:SS" string into #timerDisplay with each character
 * wrapped in its own fixed-width span. font-variant-numeric:tabular-nums
 * (still set in CSS as a first line of defense) only works if the
 * active font actually has real tabular-figure glyphs — Fraunces
 * does, but this page has no @font-face/Google Fonts link loading it
 * anywhere, so the display silently falls back to Georgia/Times New
 * Roman, which don't reliably honor that feature on every platform.
 * Giving every glyph (digits AND the ':' separators) the same
 * per-character box width — sized in JS from the widest digit the
 * current font actually renders — guarantees the display can never
 * shift horizontally as digits change, regardless of which font
 * ends up being used. */
function renderTimerDisplay(el, text) {
  const chars = text.split('');
  // Reuse existing spans when the length matches (always does, for
  // HH:MM:SS) instead of rebuilding the DOM every second.
  if (el.childElementCount !== chars.length || el.dataset.digitFormat !== 'v1') {
    el.textContent = '';
    el.dataset.digitFormat = 'v1';
    chars.forEach(() => el.appendChild(document.createElement('span')));
  }
  chars.forEach((ch, i) => {
    const span = el.children[i];
    if (span.textContent !== ch) span.textContent = ch;
    span.className = ch === ':' ? 'timer-digit timer-digit-colon' : 'timer-digit';
  });
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
    // 1x is already the loudest the <audio> element itself can go
  // (volume is clamped to [0,1]), so an actual 1.25x loudness boost
  // has to happen via a Web Audio GainNode inserted between the
  // element and the speakers instead of by setting .volume.
  const TIMER_SOUND_GAIN = 1.25;
  let audioCtx = null;
  let gainNode = null;
  function ensureGainChain() {
    if (gainNode) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return; // very old browser — falls back to un-boosted playback
    audioCtx = new Ctx();
    const source = audioCtx.createMediaElementSource(completeAudio);
    gainNode = audioCtx.createGain();
    gainNode.gain.value = TIMER_SOUND_GAIN;
    source.connect(gainNode).connect(audioCtx.destination);
  }
  function playCompleteSound() {
    stopCompleteSoundImmediately();
    if (!completeAudio) completeAudio = new Audio(TIMER_COMPLETE_SOUND_SRC);
    ensureGainChain();
    if (audioCtx?.state === 'suspended') audioCtx.resume().catch(() => {});
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
    $('#treeTitle').textContent = state.treeName || 'Mijn boom';
    // The tree's own visual size is driven by the CONTINUOUS progress
    // percentage (points / MAX_POINTS_PER_TREE), not by which of the 6
    // discrete stages it's in — so it keeps visibly growing smoothly
    // between stage changes too, not just in 6 abrupt jumps. See
    // renderTreeGraphic()'s progress param.
    renderTreeGraphic(tree.stages[stage], undefined, null, points / REWARD_CONFIG.MAX_POINTS_PER_TREE);
    $('#growthPoints').textContent = `${points} / ${REWARD_CONFIG.MAX_POINTS_PER_TREE} groei`;
    $('#treeCountText').textContent = tree.name;
    $('#growthBar').style.width = `${(points / REWARD_CONFIG.MAX_POINTS_PER_TREE) * 100}%`;
    $('#treeNameInput').value = state.treeName || '';
  }

  // Renders a stage ({ base, accents }) as a layered graphic instead
  // of one flat emoji string: the base glyph (seedling/sprout/tree) is
  // one big centered emoji filling most of #treeGraphic's box, and any
  // accent glyphs (fruit, blossom, decoration) are absolutely
  // positioned in fixed slots that sit ON the base's canopy — see
  // ACCENT_POSITIONS below, tuned by eye against the actual 🌳/🌲/🌸
  // glyph shapes so 1-5 accents land inside the leafy area rather than
  // beside it. Previously every glyph in a stage (tree AND fruit)
  // was plain inline text at the same size, which is what made fruit
  // render to the right of the tree instead of on it, and forced the
  // whole stage to shrink as glyphs were added — including the
  // single-glyph seedling stage, which is why the tree looked small
  // even before any fruit appeared.
  //
  // #treeGraphic's OWN box size (width + font-size, in study-timer.css)
  // is a fixed value that never changes — it is NOT what grows with
  // progress. Only the tree ITSELF (this function's <span> contents)
  // scales with growth, via a CSS transform on the whole element (see
  // below) — .tree-scene and .tree-card stay exactly as tall as their
  // CSS says regardless of growth, which is the fix for "de boom moet
  // gelijk scalen met de progressie, niet de hele tree-scene/container".
  // baseRem is only for one-off contexts that reuse this same
  // renderer outside that scene, like the tree-completed celebration
  // dialog's smaller, fixed-size showcase — passing it there sets an
  // inline font-size instead of relying on the scene's CSS.
  // A single ordered list of accent positions (NOT one separate list
  // per accent count, as before) — stage.accents.length just takes
  // the first N of these. That means each individual fruit keeps the
  // exact same spot as more fruit are added later, instead of every
  // already-placed fruit also jumping to a new spot the moment a new
  // one appears (which happened before, since the 1-accent and
  // 2-accent cases used entirely unrelated [x,y] arrays). Order: 1st
  // fruit lands mid-right toward the top of the canopy, 2nd mid-left,
  // 3rd bottom-right, 4th upper-center, 5th bottom-left — tuned by eye
  // against the actual 🌳/🌲/🌸 glyph shapes so all five sit inside the
  // leafy area, spread out, rather than piling on top of each other.
  // 5 is the max — see TREE_CATALOG above — so there's no 6th slot.
  const ACCENT_POSITIONS = [
    [66, 18], // 1st — mid-right, upper canopy
    [30, 42], // 2nd — mid-left
    [62, 54], // 3rd — bottom-right
    [46, 15], // 4th — upper-center
    [38, 58], // 5th — bottom-left
  ];
  // Per-glyph-type size multiplier, applied on top of whatever
  // .tree-graphic's own font-size is. Seedling/sprout are drawn small
  // relative to a full tree (they're meant to look like they've only
  // just emerged from the ground), while an actual tree canopy (🌳/🌲)
  // is drawn bigger so it dominates the scene once grown. Both mature
  // canopy glyphs share the same 1.5 multiplier so every tree in
  // TREE_CATALOG ends up the same size once fully grown — 🌲 used to
  // fall through to the 1x default below and render visibly smaller
  // than 🌳 at the same stage/points, which is also what made
  // .tree-graphic's box (see study-timer.css) size itself
  // inconsistently depending on which tree was currently active.
  const GLYPH_SCALE = { '🌱': 0.5, '🌿': 0.5, '🌳': 1.5, '🌲': 1.5 };
  // 🌿 (the sprout stage) is rotated so its stem reads as emerging at
  // an angle out of the ground rather than standing perfectly
  // upright — a small counter-clockwise tilt is what actually sells
  // "just sprouted" versus "fully planted sapling". Keyed by glyph so
  // it automatically follows 🌿 into whichever tree/stage uses it,
  // rather than being tied to a specific TREE_CATALOG entry.
  const GLYPH_ROTATE_DEG = { '🌿': -30 };
  // Small upward nudge, ONLY for the mature canopy glyphs (🌳/🌲) — at
  // GLYPH_SCALE's bigger 1.5x size, an emoji's own built-in padding
  // below its visible canopy/trunk scales up right along with the
  // font-size, which left a fully-grown tree looking like it was
  // rooted noticeably lower into the hill than the seedling (🌱,
  // GLYPH_SCALE 0.5, already sits correctly and is deliberately left
  // at 0 here — its bottom is the anchor point everything else should
  // match). Keyed by glyph, like GLYPH_ROTATE_DEG, so it follows
  // whichever tree/stage uses that base. This is an eyeballed
  // estimate — emoji rendering differs by OS/browser, so nudge the
  // percentage if a tree still doesn't look planted at the same spot
  // as the seedling.
  const GLYPH_LIFT_PCT = { '🌳': 6, '🌲': 6 };
  // Smallest the tree ever renders at, even at 0% progress — a literal
  // 0 scale would make the very first seedling invisible, which reads
  // as broken rather than "just planted".
  const MIN_PROGRESS_SCALE = 0.22;
  function renderTreeGraphic(stage, el = $('#treeGraphic'), baseRem = null, progress = 1) {
    el.innerHTML = '';
    el.classList.add('tree-graphic');
    if (baseRem) el.style.fontSize = `${baseRem}rem`;
    // Wrapping base+accents in one inner element and scaling THAT
    // (rather than scaling the base's font-size alone, as before) is
    // what keeps fruit locked onto the canopy at every size: the
    // accents' percentage-based left/top coordinates are relative to
    // this wrapper's own box, so shrinking the wrapper shrinks and
    // repositions base and accents together as one rigid unit instead
    // of the accents staying pinned to where a full-size canopy would
    // have been.
    const growthScale = Math.max(MIN_PROGRESS_SCALE, Math.min(1, progress));
    const wrap = document.createElement('div');
    wrap.className = 'tree-growth-wrap';
    wrap.style.transform = `scale(${growthScale.toFixed(4)})`;
    const base = document.createElement('span');
    base.className = 'tree-base-emoji';
    base.textContent = stage.base;
    const glyphScale = GLYPH_SCALE[stage.base] ?? 1;
    base.style.fontSize = `${glyphScale}em`;
    const rotateDeg = GLYPH_ROTATE_DEG[stage.base];
    const liftPct = GLYPH_LIFT_PCT[stage.base] ?? 0;
    const baseTransforms = [];
    if (rotateDeg) baseTransforms.push(`rotate(${rotateDeg}deg)`);
    if (liftPct) baseTransforms.push(`translateY(-${liftPct}%)`);
    if (baseTransforms.length) base.style.transform = baseTransforms.join(' ');
    wrap.append(base);
    const slots = ACCENT_POSITIONS.slice(0, stage.accents.length);
    stage.accents.forEach((accent, i) => {
      const [x, y] = slots[i] || [50, 30];
      const span = document.createElement('span');
      span.className = 'tree-accent-emoji';
      span.textContent = accent;
      span.style.left = `${x}%`;
      span.style.top = `${y}%`;
      wrap.append(span);
    });
    el.append(wrap);
  }

  function renderTimer() {
    const preset = selectedPreset();
    const step = preset?.steps[currentStep];
    if (!step) {
      $('#timerPhaseBadge').textContent = 'Klaar';
      $('#timerStepText').textContent = 'Vandaag';
      renderTimerDisplay($('#timerDisplay'), '00:00:00');
      // Geen actieve stap: de timer draait niet, dus de titel toont
      // geen tijd (die zou anders altijd "00:00:00" zijn, wat geen
      // nuttige informatie geeft).
      document.title = 'Studie Timer';
      $('#timerVisibilityHint').textContent = '';
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
    const displayTime = isHidden ? '00:00:00' : format(remaining);
    renderTimerDisplay($('#timerDisplay'), displayTime);
    // Er is een actieve stap (ongeacht of de timer nu loopt of
    // gepauzeerd is): zichtbaar toont de echte tijd, verborgen toont
    // "Verborgen" in plaats van de tijd zelf — het tabblad mag niet
    // alsnog de countdown lekken terwijl de persoon 'm bewust verborgen
    // heeft.
    document.title = isHidden ? 'Studie Timer — Verborgen' : `Studie Timer — ${displayTime}`;
    $('#timerVisibilityHint').textContent = '';
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
    // Remember which tree(s) just got completed BEFORE switching
    // treeIndex on to the next one, so the showcase (see
    // showTreeCompleted() below) can display the tree that was just
    // finished — its final, fully-grown stage and name — rather than
    // the new seedling that's already replaced it by the time the
    // rating modal closes and the UI re-renders.
    const completedTrees = [];
    while (state.growth >= REWARD_CONFIG.MAX_POINTS_PER_TREE) {
      // Any points earned beyond exactly what finished this tree are
      // discarded rather than carried into the next tree's growth
      // (previously `state.growth -= MAX_POINTS_PER_TREE`, which left
      // the remainder sitting in state.growth). That leftover made the
      // brand-new tree start partway grown — e.g. finishing an
      // Appelboom with 15 points to spare meant the next tree (a
      // Kersenboom) immediately rendered its stage-3 blossom instead
      // of a fresh seedling, which is the "kers emoji already added"
      // bug. Every tree now always starts at exactly 0.
      state.growth = 0;
      completedTrees.push({ tree: currentTree(), name: state.treeName || 'Mijn boom', number: state.treesCompleted + 1 });
      state.treesCompleted += 1;
      state.treeIndex = (state.treeIndex + 1) % TREE_CATALOG.length;
      state.claimed = [];
    }
    state.completed.push({ date: today(), minutes: step.minutes, rating, points: gain, preset: presetName(), task: step.name, at: Date.now() });
    return { gain, completedTrees };
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
      const { gain, completedTrees } = addTaskCompletion(step, Number(range.value));
      modal.remove();
      advanceStep();
      renderAll();
      // Show any just-finished tree(s) first, then the day reflection
      // (if applicable) once those are dismissed — see
      // showTreeCompleted()'s callback chaining below.
      const afterTreeShowcases = () => { if (isDayComplete()) showDayReflection(gain); };
      if (completedTrees.length) showTreeCompletedQueue(completedTrees, afterTreeShowcases);
      else afterTreeShowcases();
    });
  }

  // Displays one "🎉 boom voltooid" showcase per finished tree, one
  // after another (showcase → dismissed → next showcase → ... →
  // onAllDone), before handing off to whatever should happen after
  // (e.g. the day-reflection popup). Queued (rather than all at once)
  // because completing several trees from one single rating is rare
  // but possible, and showing them one at a time is much clearer than
  // stacking dialogs.
  function showTreeCompletedQueue(completedTrees, onAllDone) {
    const [next, ...rest] = completedTrees;
    if (!next) { onAllDone(); return; }
    showTreeCompleted(next, () => showTreeCompletedQueue(rest, onAllDone));
  }

  function showTreeCompleted({ tree, name, number }, onContinue) {
    const old = root.querySelector('.rating-modal'); if (old) old.remove();
    const modal = document.createElement('div');
    modal.className = 'rating-modal';
    modal.innerHTML = `<div class="rating-dialog tree-completed-dialog" role="dialog" aria-modal="true">
      <span class="eyebrow">Boom voltooid 🎉</span>
      <h2>${escapeHtml(name)} is uitgegroeid!</h2>
      <p>Je hebt boom #${number} (${escapeHtml(tree.name)}) volledig laten groeien. Mooi werk — tijd voor een nieuwe boom.</p>
      <div class="tree-completed-showcase" aria-hidden="true"></div>
      <label class="tree-final-name-label" for="treeFinalNameInput">Geef je boom een definitieve naam:</label>
      <input id="treeFinalNameInput" type="text" maxlength="30" class="tree-final-name-input" value="${escapeHtml(name)}" placeholder="Mijn boom">
      <div class="timer-actions"><button type="button" id="treeCompletedContinue" class="btn btn-primary">🗂️ Toevoegen aan collectie</button></div>
    </div>`;
    root.append(modal);
    // Same layered base+accents renderer as the live tree scene (see
    // renderTreeGraphic()), not a flat emoji string — this showcase
    // used to render the final stage as plain text (e.g. '🌳🍎🍎🌸',
    // four glyphs at up to 9rem each), which overflowed the dialog
    // and spilled fruit out past its edges instead of showing them
    // sitting on the tree.
    renderTreeGraphic(tree.stages[tree.stages.length - 1], modal.querySelector('.tree-completed-showcase'), 9);
    const finalNameInput = modal.querySelector('#treeFinalNameInput');
    // Same "click to select all" convenience as treeNameInput/presetName,
    // so overwriting the pre-filled name doesn't require manually
    // clearing it first.
    finalNameInput.addEventListener('focus', (event) => event.target.select());
    modal.querySelector('#treeCompletedContinue').addEventListener('click', () => {
      // Collection page doesn't exist yet — completed trees already
      // live in state.treesCompleted/lifetimePoints, so there's
      // nothing extra to persist here yet (the chosen final name is
      // only echoed back in this dialog's own heading for now; once
      // the collection page is built, this is where a completed-tree
      // record — including this final name — would get added to it).
      // The new tree that's already growing behind this dialog starts
      // fresh with the default name rather than inheriting the one
      // just finalized here.
      state.treeName = 'Mijn boom';
      save();
      renderTree();
      modal.remove();
      onContinue();
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
    const preset = sessionPreset || (id ? state.presets.find((p) => p.id === id) : { name: '', steps: [{ type: 'task', name: 'Nieuwe taak', minutes: 30, difficulty: 3 }] });
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

  // Selecting the full text of a .step-name field on focus, same as
  // treeNameInput/presetName, so overwriting an existing step name
  // doesn't require manually clearing it first. Delegated on `root`
  // (via the bubbling "focusin" rather than plain "focus", which
  // doesn't bubble) rather than bound directly to each .step-name
  // input, because renderStepEditor() rebuilds those inputs from
  // scratch on every render — a direct binding would be lost as soon
  // as a step is added, removed, or its type is switched.
  root.addEventListener('focusin', (event) => {
    if (event.target.matches('.step-name')) event.target.select();
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
    if (event.target.closest('#addStepBtn')) { const steps = readSteps(); steps.push({ type: 'task', name: 'Nieuwe taak', minutes: 30, difficulty: 3 }); renderStepEditor(steps); return; }
    if (event.target.closest('.remove-step')) { const steps = readSteps(); const i = Number(event.target.closest('.step-editor').dataset.index); steps.splice(i, 1); if (!steps.length) steps.push({ type: 'task', name: 'Nieuwe taak', minutes: 30, difficulty: 3 }); renderStepEditor(steps); }
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
    // Clicking (or tabbing) into the preset-name field selects its
    // full contents, so typing immediately replaces the existing name
    // instead of having to manually select/clear it first.
    $('#presetName').addEventListener('focus', (event) => event.target.select());
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
    title.textContent = state.treeName || 'Mijn boom';
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