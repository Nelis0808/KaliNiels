// =================================================================
// COLLECTIBLES / REWARDS — shared engine
// -----------------------------------------------------------------
// Generic, data-driven "earn collectibles -> unlock a real gift"
// system. `siteConfig.collectibles` (assets/js/config.js) is the
// CONTENT config (which collections exist, how many items each has,
// how many reward rows, fallback prices, the euro-per-collectible
// rate) — this module is the RUNTIME half: where earned/collected
// counts and reward-gift choices actually get stored, and the reward
// math that turns "collected count + a gift's price" into a
// locked/progressing/unlocked state.
//
// PERSISTENCE: localStorage, one key, namespaced per logged-in
// person ('a'/'b' — see auth.js) exactly like the Studie Timer's own
// state (assets/js/modules/study-timer.js's KEY constant). This is a
// deliberate architecture match, not an oversight: the Studie Timer
// itself never synced its tree/growth progress to a Cloudflare
// Worker either, so collectible progress staying local-per-browser
// is consistent with how the one feature that FEEDS this system
// already behaves. See this project's ACTION-EXPANSION-PLAN.md if
// you ever want to move this to a Worker/KV later — the read/write
// functions below are the only two places that would need to change
// (see readStore/writeStore).
//
// WHO EARNS WHAT: every function here takes an explicit `who`
// ('a'/'b') rather than reading auth.js itself, so callers (the
// Studie Timer, the Collections page, the Cadeau Ideeën page) stay in
// control of which person's data they're touching — e.g. the
// Collections page reacts to onAuthChange() and re-reads for whoever
// is currently logged in, while the Studie Timer already knows who
// it's awarding a tree to from its own selectedWho.
//
// EXTENDING WITH A NEW COLLECTION: add an entry to
// `siteConfig.collectibles.collections` (see config.js's own comment
// there) and call awardCollectible(who, 'yourCollectionId', {...})
// from wherever that collection's collectibles get earned. Nothing
// in this file is Trees-specific.
// =================================================================

import { siteConfig } from '../config.js';

const KEY = 'collectiblesStateV1';

// Older key this system can seed from on first use, so someone who's
// already been growing trees before this feature existed doesn't
// lose that progress the moment they open the Collections page — see
// getCollectionState()'s migration note below.
const LEGACY_STUDY_TIMER_KEY = 'studyTimerStateV2';

function clone(value) { return structuredClone(value); }

// ---- Config accessors --------------------------------------------

/** Every configured collection, in config order. Never throws — returns [] if siteConfig.collectibles is missing/malformed. */
export function getCollections() {
  return Array.isArray(siteConfig.collectibles?.collections) ? siteConfig.collectibles.collections : [];
}

/** One collection's config by id, or null if it doesn't exist. */
export function getCollection(collectionId) {
  return getCollections().find((c) => c.id === collectionId) || null;
}

/** The euro value of a single collectible in this collection (collection-level override, else the site-wide default, else a safe fallback of 1). */
export function getCollectibleValueEUR(collection) {
  const perCollection = Number(collection?.valueEUR);
  if (Number.isFinite(perCollection) && perCollection > 0) return perCollection;
  const central = Number(siteConfig.collectibles?.collectibleValueEUR);
  return Number.isFinite(central) && central > 0 ? central : 1;
}

/** Renders the configured fallback-gift label for a given price (defaults to "€X cadeaubon" if config.js doesn't provide its own). */
export function fallbackGiftLabel(price) {
  const fn = siteConfig.collectibles?.fallbackGiftLabel;
  if (typeof fn === 'function') {
    try { return fn(price); } catch { /* fall through to default below */ }
  }
  return `€${price} cadeaubon`;
}

/**
 * Which gifts.html column ('a' or 'b') reward rows may be assigned
 * from — set via siteConfig.collectibles.rewardGiftPerson. Defaults
 * to 'b' (Kalina) if unset/invalid, since that's this site's actual
 * rule: reward gifts always come from Kalina's list, regardless of
 * who's the one earning the collectibles.
 */
export function getRewardGiftPerson() {
  const p = siteConfig.collectibles?.rewardGiftPerson;
  return (p === 'a' || p === 'b') ? p : 'b';
}

// ---- Persistence ----------------------------------------------------

function readStore() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}

function writeStore(store) {
  localStorage.setItem(KEY, JSON.stringify(store));
}

function readLegacyTreesCompleted(who) {
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_STUDY_TIMER_KEY) || '{}');
    const count = legacy?.[who]?.treesCompleted;
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  } catch {
    return 0;
  }
}

function defaultCollectionState() {
  return {
    collectedCount: 0,
    // Small history log (species/name at the time it was earned + a
    // personal nickname if one was given, e.g. the tree's final
    // name) — not required for the grid or reward math, but lets the
    // Collections page show a little more personality than just a
    // bare count. Capped defensively so this can never grow without
    // bound (see awardCollectible()).
    history: [],
    // Keyed by reward id — either one of collection.rewards[].id from
    // config.js, or one of extraRewards[].id below.
    rewards: {},
    // Reward rows created at RUNTIME (not in config.js) — see
    // addDynamicReward()'s comment for when/why these appear. Merged
    // with the config-defined rows by getAllRewardConfigs() so both
    // render/behave identically everywhere.
    extraRewards: [],
  };
}

function defaultRewardState() {
  return {
    // The person's chosen gift for this reward row, if any. Kept as a
    // snapshot (not just an id) so this reward row keeps working even
    // if that gift is later edited or removed on gifts.html — see
    // resolveRewardGift() below for exactly how snapshot vs. live
    // data is reconciled.
    giftId: null,
    giftSnapshot: null, // { title, price, url } at selection time
    unlocked: false,
    unlockedAt: null,
    // Frozen the moment this reward unlocks, so the celebration/passed
    // display never changes again even if the underlying gift is
    // later edited or deleted — "once unlocked, it stays unlocked"
    // applies to WHAT was unlocked, not just THAT it's unlocked.
    unlockedGiftSnapshot: null,
  };
}

/** Ensures `store[who][collectionId]` exists (creating/upgrading it as needed) and returns it. Mutates `store` in place; caller is responsible for persisting if needed. */
function ensureCollectionState(store, who, collectionId) {
  store[who] ||= {};
  if (!store[who][collectionId]) {
    const state = defaultCollectionState();
    // One-time migration: a 'trees' collection with nothing collected
    // yet inherits the Studie Timer's own already-completed tree
    // count, so existing progress isn't invisible the first time this
    // page is opened. Only ever runs once, since after this the
    // collectiblesStateV1 entry exists and this branch is skipped.
    if (collectionId === 'trees') {
      state.collectedCount = readLegacyTreesCompleted(who);
    }
    store[who][collectionId] = state;
  }
  const state = store[who][collectionId];
  state.collectedCount = Number.isFinite(state.collectedCount) ? Math.max(0, Math.floor(state.collectedCount)) : 0;
  state.history = Array.isArray(state.history) ? state.history : [];
  state.rewards ||= {};
  state.extraRewards = Array.isArray(state.extraRewards) ? state.extraRewards : [];
  return state;
}

/** Read-only snapshot of one person's progress in one collection: { collectedCount, history, rewards }. Safe to call for a collection/person with no data yet (returns sensible zeros). */
export function getCollectionState(who, collectionId) {
  if (!who || !collectionId) return defaultCollectionState();
  const store = readStore();
  return clone(ensureCollectionState(store, who, collectionId));
}

/** Read-only snapshot of one specific reward row's saved state (selection + unlock status). */
export function getRewardState(who, collectionId, rewardId) {
  const collectionState = getCollectionState(who, collectionId);
  return clone(collectionState.rewards[rewardId] || defaultRewardState());
}

// Safety cap on how many reward rows addDynamicReward() will create
// per person/collection — this should never realistically be hit
// (each one only ever comes from a deliberate gift assignment, see
// setRewardGift() below), it's just a defensive ceiling.
const MAX_DYNAMIC_REWARDS = 25;

/**
 * The full, ordered list of reward "templates" for a collection: the
 * ones defined in config.js (collection.rewards) FOLLOWED BY any
 * created at runtime for this specific person (see
 * addDynamicReward()). Both kinds have the identical shape ({ id,
 * fallbackPriceEUR }) and work identically everywhere — the
 * Collections page and the gifts.html 🎯 picker both call this
 * instead of reading collection.rewards directly, so a dynamically
 * created reward shows up in both automatically.
 */
export function getAllRewardConfigs(who, collectionId) {
  const collection = getCollection(collectionId);
  if (!collection) return [];
  const configRewards = Array.isArray(collection.rewards) ? collection.rewards : [];
  if (!who) return configRewards;
  const state = getCollectionState(who, collectionId);
  const dynamicRewards = (state.extraRewards || []).map((r) => ({ id: r.id, fallbackPriceEUR: r.fallbackPriceEUR }));
  return [...configRewards, ...dynamicRewards];
}

/**
 * Appends a brand-new, unassigned reward row (fallback price only, no
 * gift yet) to this person's own copy of a collection — used when
 * assigning a gift that's already fully affordable "spends" only
 * part of what's been earned so far (see setRewardGift()'s own
 * comment for the full "cash out early" flow this supports). Returns
 * the created { id, fallbackPriceEUR, createdAt }, or null if the
 * amount was invalid or the (extremely generous) safety cap was hit.
 */
export function addDynamicReward(who, collectionId, fallbackPriceEUR) {
  if (!who || !collectionId) return null;
  const price = Math.round(Number(fallbackPriceEUR));
  if (!Number.isFinite(price) || price <= 0) return null;
  const store = readStore();
  const state = ensureCollectionState(store, who, collectionId);
  if (state.extraRewards.length >= MAX_DYNAMIC_REWARDS) return null;
  const entry = { id: `extra-${state.extraRewards.length + 1}`, fallbackPriceEUR: price, createdAt: Date.now() };
  state.extraRewards.push(entry);
  writeStore(store);
  notify(who, collectionId);
  return entry;
}

/**
 * Previews, WITHOUT changing anything, what assigning a gift of
 * `giftPrice` to a reward in `collection` would do given
 * `collectedCount` already earned — used by the gift pickers (both
 * gifts.html's and the Collections page's own) to show a "this
 * unlocks immediately, €X rolls into a new reward" hint before the
 * person confirms. Mirrors the real logic in setRewardGift() exactly
 * (kept as two copies rather than one shared helper only because one
 * is pure/preview and the other actually persists — see that
 * function for the canonical version).
 */
export function previewAssignment(collection, collectedCount, giftPrice) {
  const value = getCollectibleValueEUR(collection);
  const price = Math.round(Number(giftPrice));
  if (!Number.isFinite(price) || price <= 0) return { willUnlockImmediately: false, remainingEUR: 0 };
  const totalEarned = collectedCount * value;
  const willUnlockImmediately = totalEarned >= price;
  return { willUnlockImmediately, remainingEUR: willUnlockImmediately ? Math.max(0, totalEarned - price) : 0 };
}

const MAX_HISTORY_ENTRIES = 200;

/**
 * Records that `who` just earned one more collectible in `collectionId`
 * (e.g. a tree finished growing). `label` is an optional personal
 * touch — e.g. the custom name the person gave that tree — stored
 * alongside the collectible's own configured slot name in history.
 * Returns the updated collection state.
 */
export function awardCollectible(who, collectionId, { label } = {}) {
  if (!who || !collectionId) return null;
  const store = readStore();
  const state = ensureCollectionState(store, who, collectionId);
  const collection = getCollection(collectionId);
  const slotIndex = state.collectedCount; // 0-based index of the slot this fills
  const slotItem = collection?.items?.[slotIndex] || null;
  state.collectedCount += 1;
  state.history.push({
    index: slotIndex,
    name: slotItem?.name || null,
    label: label ? String(label).slice(0, 60) : null,
    at: Date.now(),
  });
  if (state.history.length > MAX_HISTORY_ENTRIES) state.history = state.history.slice(-MAX_HISTORY_ENTRIES);
  writeStore(store);
  notify(who, collectionId);
  return clone(state);
}

/**
 * Sets (or clears, with giftSnapshot=null) which gift a not-yet-
 * unlocked reward row should use. Refuses to change anything once
 * that reward is already unlocked — "once unlocked, it stays
 * unlocked" includes the gift it was unlocked for, not just the
 * unlocked flag itself. Returns true if the change was applied.
 *
 * CASH OUT EARLY: if what's already been collected already covers
 * the assigned gift's price outright (collectedCount * value >=
 * price), this assignment effectively pays it out on the spot — the
 * actual unlock celebration still happens the normal way (see
 * collections.js), the very next time the Collections page renders
 * and finds this reward both eligible AND now carrying a real gift.
 * Whatever was collected BEYOND that gift's price doesn't just
 * vanish: a brand-new, unassigned reward row is created for exactly
 * that leftover amount (see addDynamicReward()), so progress already
 * banked keeps counting toward the next thing instead of being lost.
 */
export function setRewardGift(who, collectionId, rewardId, giftSnapshot) {
  if (!who || !collectionId || !rewardId) return false;
  const store = readStore();
  const state = ensureCollectionState(store, who, collectionId);
  const reward = (state.rewards[rewardId] ||= defaultRewardState());
  if (reward.unlocked) return false; // immutable once unlocked
  if (giftSnapshot) {
    reward.giftId = giftSnapshot.giftId || giftSnapshot.id || null;
    reward.giftSnapshot = {
      title: String(giftSnapshot.title || '').slice(0, 200),
      price: Number.isFinite(Number(giftSnapshot.price)) ? Math.round(Number(giftSnapshot.price)) : null,
      url: giftSnapshot.url || null,
    };

    const collection = getCollection(collectionId);
    const price = reward.giftSnapshot.price;
    if (collection && Number.isFinite(price) && price > 0) {
      const value = getCollectibleValueEUR(collection);
      const remaining = (state.collectedCount * value) - price;
      if (remaining > 0 && state.extraRewards.length < MAX_DYNAMIC_REWARDS) {
        state.extraRewards.push({
          id: `extra-${state.extraRewards.length + 1}`,
          fallbackPriceEUR: Math.round(remaining),
          createdAt: Date.now(),
        });
      }
    }
  } else {
    reward.giftId = null;
    reward.giftSnapshot = null;
  }
  writeStore(store);
  notify(who, collectionId);
  return true;
}

/**
 * Marks a reward as permanently unlocked (called by the Collections
 * page only AFTER its full showcase animation has finished playing —
 * see that page's module for why the order matters). No-op if
 * already unlocked, so this is safe to call defensively. Returns
 * true if this call is what actually unlocked it.
 */
export function markRewardUnlocked(who, collectionId, rewardId, giftSnapshotAtUnlock) {
  if (!who || !collectionId || !rewardId) return false;
  const store = readStore();
  const state = ensureCollectionState(store, who, collectionId);
  const reward = (state.rewards[rewardId] ||= defaultRewardState());
  if (reward.unlocked) return false;
  reward.unlocked = true;
  reward.unlockedAt = Date.now();
  reward.unlockedGiftSnapshot = giftSnapshotAtUnlock ? {
    title: String(giftSnapshotAtUnlock.title || '').slice(0, 200),
    price: Number.isFinite(Number(giftSnapshotAtUnlock.price)) ? Math.round(Number(giftSnapshotAtUnlock.price)) : null,
    url: giftSnapshotAtUnlock.url || null,
  } : null;
  writeStore(store);
  notify(who, collectionId);
  return true;
}

// ---- Reward math -----------------------------------------------------

/**
 * Resolves what a reward row should currently show/require, WITHOUT
 * mutating anything — pure function of the reward's config + its
 * saved runtime state + (optionally) the live gifts list.
 *
 *   rewardConfig:  one entry from getAllRewardConfigs(who, collectionId)
 *                  (a config.js-defined row, or a runtime-created one
 *                  from addDynamicReward() — both have the same shape)
 *   rewardState:   getRewardState(who, collectionId, rewardConfig.id)
 *   liveGiftsById: Map<giftId, {id,title,price,url,person}> | null —
 *                  pass the live-fetched gifts list so a still-locked
 *                  reward reflects price/title edits made on
 *                  gifts.html since it was selected; pass null/omit
 *                  if the Gifts Worker isn't reachable right now
 *                  (falls back to the saved snapshot).
 *
 * Returns:
 *   {
 *     price, title, url, isFallback, isLive,
 *     unlocked, unlockedAt,
 *     collectedCount, requiredCount, progress (0-1, clamped),
 *     euroProgress (0-1, clamped), eligible (collected*value >= price)
 *   }
 */
export function resolveRewardProgress(collection, collectedCount, rewardConfig, rewardState, liveGiftsById = null) {
  const value = getCollectibleValueEUR(collection);
  const unlocked = Boolean(rewardState?.unlocked);

  // Unlocked rewards are permanently frozen to whatever they were
  // unlocked with — never re-resolved against live/changing gift data.
  if (unlocked) {
    const snap = rewardState.unlockedGiftSnapshot;
    const price = snap?.price ?? rewardConfig.fallbackPriceEUR ?? 0;
    return {
      giftId: rewardState.giftId || null,
      price,
      title: snap?.title || fallbackGiftLabel(price),
      url: snap?.url || null,
      isFallback: !snap,
      isLive: false,
      unlocked: true,
      unlockedAt: rewardState.unlockedAt || null,
      collectedCount,
      requiredCount: value > 0 ? Math.ceil(price / value) : 0,
      progress: 1,
      euroProgress: 1,
      eligible: true,
    };
  }

  // Still locked: prefer live gift data (so editing a gift's price on
  // gifts.html is reflected here immediately), else the snapshot
  // taken at selection time, else the configured fallback.
  const liveGift = rewardState?.giftId && liveGiftsById ? liveGiftsById.get(rewardState.giftId) : null;
  const snapGift = rewardState?.giftSnapshot || null;
  const source = liveGift || snapGift;
  const fallbackPrice = Number.isFinite(Number(rewardConfig.fallbackPriceEUR)) ? Math.round(Number(rewardConfig.fallbackPriceEUR)) : 0;
  const price = Number.isFinite(Number(source?.price)) ? Math.round(Number(source.price)) : fallbackPrice;
  const title = source?.title || fallbackGiftLabel(fallbackPrice);
  const requiredCount = value > 0 ? Math.ceil(price / value) : 0;
  const progress = requiredCount > 0 ? Math.min(1, collectedCount / requiredCount) : (price <= 0 ? 1 : 0);
  const euroValue = collectedCount * value;
  const euroProgress = price > 0 ? Math.min(1, euroValue / price) : 1;

  return {
    giftId: liveGift?.id || rewardState?.giftId || null,
    price,
    title,
    url: source?.url || null,
    isFallback: !source,
    isLive: Boolean(liveGift),
    unlocked: false,
    unlockedAt: null,
    collectedCount,
    requiredCount,
    progress,
    euroProgress,
    eligible: euroValue >= price,
  };
}

// ---- Lightweight change notifications ---------------------------------
// Not required by any current page (the Studie Timer and Collections
// page are never open at once), but cheap to provide for whoever adds
// a header badge or a second simultaneous view later — see e.g.
// study-timer-badge.js for the kind of thing this could drive.

const listeners = new Set();

/** Subscribe to collectible changes. Returns an unsubscribe function. */
export function onCollectiblesChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(who, collectionId) {
  listeners.forEach((fn) => {
    try { fn({ who, collectionId }); } catch (error) { console.error('Collectibles listener error:', error); }
  });
}
