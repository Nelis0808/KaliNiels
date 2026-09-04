// =================================================================
// COLLECTIES PAGE (collections.html)
// -----------------------------------------------------------------
// Renders every configured collection from siteConfig.collectibles
// (assets/js/config.js) — the item grid (rows of `itemsPerRow`,
// "[?]" until collected), and each collection's reward rows (locked
// with collectible + € progress, or permanently "passed" once
// unlocked). All the actual math/persistence lives in
// assets/js/modules/collectibles.js; this module is purely
// rendering + the reward-gift picker + the unlock showcase.
//
// GATED: this page requires login (see the lock-screen markup in
// collections.html, driven by page-gate.js) because collectible
// progress is personal, same as the Studie Timer. By the time
// initCollections() below actually renders anything, someone should
// already be logged in — but every render function still guards for
// a missing `who` defensively (e.g. a session expiring mid-visit).
//
// GIFT DATA: fetched once up front (and re-polled, same interval as
// gifts.js) from siteConfig.gifts.workerUrl so reward rows reflect
// live prices/titles/photos — but every reward still works even with
// the Worker unreachable/unconfigured, falling back to whatever was
// snapshotted at selection time, or the collection's own configured
// fallback (see collectibles.js's resolveRewardProgress for exactly
// how that fallback chain works).
//
// THE UNLOCK SHOWCASE: whenever a render finds a reward that's
// eligible (collected*value >= price) but not yet marked unlocked,
// it's queued (queueUnlock) rather than shown as unlocked
// immediately — playUnlockAnimation() shows the full-screen reveal
// first, and ONLY once that's been dismissed does markRewardUnlocked()
// get called (making it permanent) and the page re-render to move it
// into the grayed-out "passed" state below. This ordering is what
// guarantees a reward is never shown as already-unlocked before its
// animation has played, and that refreshing mid-animation can't skip
// it either (still eligible + still not unlocked -> queued again).
// =================================================================

import { siteConfig } from '../config.js';
import { qs, qsa, escapeHtml, prefersReducedMotion } from './utils.js';
import { getAuth, onAuthChange } from './auth.js';
import {
  getCollections,
  getCollection,
  getCollectionState,
  getRewardState,
  getAllRewardConfigs,
  getRewardGiftPerson,
  previewAssignment,
  resolveRewardProgress,
  markRewardUnlocked,
  setRewardGift,
  getCollectibleValueEUR,
} from './collectibles.js';

const POLL_INTERVAL_MS = 8000;

export function initCollections() {
  const root = document.getElementById('collectionsApp');
  if (!root) return; // Not on this page

  const emptyEl = document.getElementById('collectionsEmpty');
  const mainEl = document.getElementById('collectionsMain');
  const tabsEl = document.getElementById('collectionsTabs');
  const panelEl = document.getElementById('collectionsPanel');

  const collections = getCollections();
  if (collections.length === 0) {
    emptyEl.classList.remove('hidden');
    mainEl.classList.add('hidden');
    return;
  }
  emptyEl.classList.add('hidden');
  mainEl.classList.remove('hidden');

  const workerUrl = siteConfig.gifts?.workerUrl;
  const personLabels = siteConfig.gifts?.personLabels || {};
  function workerConfigured() {
    return Boolean(workerUrl) && !workerUrl.includes('YOUR-SUBDOMAIN');
  }

  let liveGifts = [];
  let liveGiftsById = new Map();
  let activeCollectionId = collections[0].id;
  let openPickerRewardId = null; // at most one reward-gift picker open at a time
  const unlockQueue = [];
  let animating = false;
  let pollTimer = null;
  let activeObjectUrls = [];

  function who() {
    return getAuth()?.who || null;
  }

  function revokeObjectUrls() {
    activeObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    activeObjectUrls = [];
  }

  // ---- Live gift data ----------------------------------------------

  async function loadLiveGifts({ silent = false } = {}) {
    if (!workerConfigured()) { liveGifts = []; liveGiftsById = new Map(); return; }
    try {
      const response = await fetch(`${workerUrl}/gifts`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      liveGifts = Array.isArray(data.gifts) ? data.gifts : [];
      liveGiftsById = new Map(liveGifts.map((g) => [g.id, g]));
    } catch (error) {
      if (!silent) console.error('Kon cadeau-ideeën niet laden voor beloningen:', error);
      // Keep whatever we had before (better a stale list than none)
    }
  }

  // Fetches a gift's thumbnail as an object URL, same Worker endpoint
  // gifts.js itself uses. Returns null on any failure (no custom
  // photo, no scrapable og:image, link down, or no id/url to ask
  // for) — every caller already treats "no image" as a normal,
  // silently-handled outcome.
  async function loadImageObjectUrl(giftId, giftUrl) {
    if (!workerConfigured() || !giftId || !giftUrl) return null;
    try {
      const response = await fetch(`${workerUrl}/gifts/image?id=${encodeURIComponent(giftId)}&url=${encodeURIComponent(giftUrl)}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      activeObjectUrls.push(objectUrl);
      return objectUrl;
    } catch {
      return null;
    }
  }

  // ---- Tabs ----------------------------------------------------------

  function buildTabs() {
    if (collections.length <= 1) { tabsEl.classList.add('hidden'); tabsEl.innerHTML = ''; return; }
    tabsEl.classList.remove('hidden');
    tabsEl.innerHTML = collections.map((c) => {
      const selected = c.id === activeCollectionId;
      return `<button type="button" class="col-tab" role="tab" id="colTab-${escapeHtml(c.id)}" aria-controls="collectionsPanel" aria-selected="${selected}" tabindex="${selected ? '0' : '-1'}" data-collection-id="${escapeHtml(c.id)}">${escapeHtml(c.emoji || '')} ${escapeHtml(c.name)}</button>`;
    }).join('');
  }

  tabsEl.addEventListener('click', (event) => {
    const btn = event.target.closest('.col-tab');
    if (btn) switchCollection(btn.dataset.collectionId);
  });

  // Standard roving-tabindex arrow-key navigation for the tablist
  tabsEl.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = qsa('.col-tab', tabsEl);
    if (tabs.length === 0) return;
    const currentIndex = tabs.findIndex((t) => t.dataset.collectionId === activeCollectionId);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    event.preventDefault();
    switchCollection(tabs[nextIndex].dataset.collectionId);
    qs(`[data-collection-id="${tabs[nextIndex].dataset.collectionId}"]`, tabsEl)?.focus();
  });

  function switchCollection(collectionId) {
    if (!getCollection(collectionId)) return;
    activeCollectionId = collectionId;
    openPickerRewardId = null;
    buildTabs();
    renderPanel();
  }

  // ---- Panel rendering ------------------------------------------------

  function renderPanel() {
    revokeObjectUrls();
    const collection = getCollection(activeCollectionId);
    const w = who();
    if (!collection || !w) { panelEl.innerHTML = ''; return; }

    const state = getCollectionState(w, collection.id);
    const total = collection.items.length;
    const displayCollected = Math.min(state.collectedCount, total);
    const perRow = Math.max(1, collection.itemsPerRow || 7);

    const gridItems = collection.items.map((item, i) => {
      const collected = i < state.collectedCount;
      const historyEntry = collected ? [...state.history].reverse().find((h) => h.index === i) : null;
      // The tree's own personal name (given in the Studie Timer's
      // "geef je boom een naam" step) takes the catalog slot name's
      // EXACT place once collected — a generic "Kersenboom IV" isn't
      // interesting once the person actually named their tree, so it
      // isn't shown alongside it, only as a fallback if no name was
      // ever recorded (and as a hover tooltip either way, for the
      // underlying slot identity).
      const customName = historyEntry?.label?.trim() || null;
      const displayName = customName || item.name;
      const tooltip = customName ? `${item.name} — ${customName}` : item.name;
      return `
        <li class="col-item ${collected ? 'col-item-collected' : 'col-item-locked'}" ${collected ? `title="${escapeHtml(tooltip)}"` : ''}>
          <div class="col-item-slot" aria-hidden="true">${collected ? escapeHtml(item.emoji || '🎁') : '<span class="col-item-q">[?]</span>'}</div>
          <span class="col-item-name">${collected ? escapeHtml(displayName) : ''}</span>
        </li>
      `;
    }).join('');

    const rewards = getAllRewardConfigs(w, collection.id);
    const rewardsMarkup = rewards.length
      ? rewards.map((rewardConfig, idx) => {
        const rewardState = getRewardState(w, collection.id, rewardConfig.id);
        const progress = resolveRewardProgress(collection, state.collectedCount, rewardConfig, rewardState, liveGiftsById);
        return renderRewardRow(collection, rewardConfig, rewardState, progress, idx);
      }).join('')
      : '<p class="empty-state">Nog geen beloningen geconfigureerd voor deze collectie.</p>';

    panelEl.innerHTML = `
      <div class="col-panel" role="tabpanel" id="collectionsPanel-${escapeHtml(collection.id)}" aria-labelledby="colTab-${escapeHtml(collection.id)}">
        <header class="col-panel-header">
          <h2>${escapeHtml(collection.emoji || '')} ${escapeHtml(collection.name)}</h2>
          <p class="col-panel-count">${displayCollected}<span class="col-panel-count-sep">/</span>${total}</p>
        </header>
        ${(collection.description || collection.source) ? `
        <div class="col-panel-intro">
          ${collection.description ? `<p class="col-panel-desc">${escapeHtml(collection.description)}</p>` : ''}
          ${collection.source ? `<p class="col-panel-source">Verdien ${escapeHtml(collection.name.toLowerCase())} via <a href="${escapeHtml(collection.source.href)}">${escapeHtml(collection.source.label)}</a>.</p>` : ''}
        </div>` : ''}
        ${total > 0
          ? `<ul class="col-grid" style="--col-per-row:${perRow}">${gridItems}</ul>`
          : '<p class="empty-state">Nog geen collectibles geconfigureerd voor deze collectie.</p>'}
        <section class="col-rewards" aria-label="Beloningen">
          <h3 class="col-rewards-heading">🎁 Beloningen</h3>
          ${rewardsMarkup}
        </section>
      </div>
    `;

    // Thumbnails + unlock detection happen after the markup exists
    if (openPickerRewardId) {
      const openSelect = qs(`#colRewardSelect-${openPickerRewardId}`, panelEl);
      if (openSelect) updatePickerHint(openSelect);
    }
    rewards.forEach((rewardConfig) => {
      const rewardState = getRewardState(w, collection.id, rewardConfig.id);
      const progress = resolveRewardProgress(collection, state.collectedCount, rewardConfig, rewardState, liveGiftsById);
      loadRewardThumbnail(rewardConfig.id, progress);
      // Only a reward that actually carries a real, deliberately-
      // assigned gift can trigger the showcase — a still-unassigned
      // fallback ("€X cadeaubon") reward can sit at 100% progress
      // (e.g. right after a cheaper gift's payout rolled its leftover
      // into a fresh reward row here) without auto-celebrating an
      // anonymous gift card nobody actually chose.
      if (!rewardState.unlocked && rewardState.giftId && progress.eligible) {
        queueUnlock(w, collection, rewardConfig, progress);
      }
    });

    processUnlockQueue();
  }

  function loadRewardThumbnail(rewardId, progress) {
    if (progress.isFallback || !progress.url) return;
    const imgEl = qs(`[data-reward-img="${rewardId}"]`, panelEl);
    if (!imgEl) return;
    loadImageObjectUrl(progress.giftId, progress.url).then((objectUrl) => {
      if (!objectUrl) return;
      // The panel may have been re-rendered (or switched away from)
      // by the time this resolves — bail rather than writing into a
      // detached/stale element.
      const stillThere = qs(`[data-reward-img="${rewardId}"]`, panelEl);
      if (stillThere) stillThere.src = objectUrl;
    });
  }

  function renderRewardRow(collection, rewardConfig, rewardState, progress, idx) {
    const value = getCollectibleValueEUR(collection);
    const rowLabel = `Beloning ${idx + 1}`;

    if (progress.unlocked) {
      return `
        <div class="col-reward-row col-reward-unlocked">
          <div class="col-reward-icon" aria-hidden="true">
            ${progress.url ? `<img class="col-reward-img" data-reward-img="${escapeHtml(rewardConfig.id)}" alt="">` : '<span class="col-reward-fallback">🏆</span>'}
          </div>
          <div class="col-reward-info">
            <p class="col-reward-eyebrow">${escapeHtml(rowLabel)} · ontgrendeld ✅</p>
            <p class="col-reward-title">${escapeHtml(progress.title)}</p>
            <p class="col-reward-meta">€${progress.price} — bereikt met ${progress.collectedCount} ${escapeHtml(collection.name.toLowerCase())}</p>
          </div>
        </div>
      `;
    }

    const pct = Math.max(0, Math.min(100, Math.round(progress.euroProgress * 100)));
    const remaining = Math.max(0, progress.requiredCount - progress.collectedCount);
    const euroSoFar = Math.min(progress.collectedCount * value, progress.price);
    const pickerOpen = openPickerRewardId === rewardConfig.id;

    return `
      <div class="col-reward-row col-reward-locked" data-reward-id="${escapeHtml(rewardConfig.id)}">
        <div class="col-reward-icon" aria-hidden="true">
          ${(!progress.isFallback && progress.url) ? `<img class="col-reward-img" data-reward-img="${escapeHtml(rewardConfig.id)}" alt="">` : '<span class="col-reward-fallback">🎁</span>'}
        </div>
        <div class="col-reward-info">
          <p class="col-reward-eyebrow">${escapeHtml(rowLabel)}${progress.isFallback ? ' · nog geen cadeau gekozen' : ''}</p>
          <p class="col-reward-title">${escapeHtml(progress.title)}</p>
          <div class="col-progress-track" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Voortgang naar ${escapeHtml(progress.title)}">
            <div class="col-progress-fill" style="width:${pct}%"></div>
          </div>
          <p class="col-reward-meta">${progress.collectedCount}/${progress.requiredCount} ${escapeHtml(collection.name.toLowerCase())} · €${euroSoFar}/€${progress.price}${remaining > 0 ? ` · nog ${remaining} te gaan` : ''}</p>
        </div>
        <div class="col-reward-actions">
          <button type="button" class="btn btn-ghost btn-sm col-reward-pick" data-reward-id="${escapeHtml(rewardConfig.id)}" aria-expanded="${pickerOpen}">${rewardState.giftId ? 'Wijzig cadeau' : 'Kies cadeau'}</button>
          ${rewardState.giftId ? `<button type="button" class="btn btn-ghost btn-sm col-reward-clear" data-reward-id="${escapeHtml(rewardConfig.id)}">Loskoppelen</button>` : ''}
        </div>
        <div class="col-reward-picker ${pickerOpen ? '' : 'hidden'}" data-reward-picker="${escapeHtml(rewardConfig.id)}">
          ${pickerOpen ? renderPickerContents(rewardConfig, collection, progress.collectedCount) : ''}
        </div>
      </div>
    `;
  }

  function renderPickerContents(rewardConfig, collection, collectedCount) {
    const rewardPerson = getRewardGiftPerson();
    const eligibleGifts = liveGifts.filter((g) => g.person === rewardPerson);
    if (eligibleGifts.length === 0) {
      const personLabel = personLabels[rewardPerson] || (rewardPerson === 'a' ? 'Niels' : 'Kalina');
      return `<p class="col-reward-picker-empty">Nog geen cadeau-ideeën voor ${escapeHtml(personLabel)} beschikbaar. Voeg er eerst een toe op <a href="gifts.html">Cadeau Ideeën</a>.</p>`;
    }
    const options = eligibleGifts
      .slice()
      .sort((a, b) => (a.title || '').localeCompare(b.title || ''))
      .map((g) => {
        const priceLabel = Number.isFinite(g.price) ? `€${g.price}` : 'prijs onbekend';
        return `<option value="${escapeHtml(g.id)}">${escapeHtml(g.title)} — ${priceLabel}</option>`;
      })
      .join('');
    return `
      <label class="col-reward-picker-label" for="colRewardSelect-${escapeHtml(rewardConfig.id)}">Kies een cadeau uit Kalina's lijstje:</label>
      <select id="colRewardSelect-${escapeHtml(rewardConfig.id)}" class="col-reward-select" data-collection-id="${escapeHtml(collection.id)}" data-collected-count="${collectedCount}">${options}</select>
      <p class="col-reward-picker-hint hidden" data-picker-hint aria-live="polite"></p>
      <div class="col-reward-picker-buttons">
        <button type="button" class="btn btn-primary btn-sm col-reward-confirm" data-reward-id="${escapeHtml(rewardConfig.id)}">Instellen</button>
        <button type="button" class="btn btn-outline btn-sm col-reward-cancel">Annuleren</button>
      </div>
    `;
  }

  // Shows a "this unlocks right away" hint under the picker's select
  // when the currently-highlighted gift is already fully affordable
  // (see collectibles.js's previewAssignment/setRewardGift for the
  // actual cash-out + rollover logic this is just previewing).
  function updatePickerHint(select) {
    const hintEl = select.parentElement?.querySelector('[data-picker-hint]');
    if (!hintEl) return;
    const chosen = liveGifts.find((g) => g.id === select.value);
    const collection = getCollection(select.dataset.collectionId);
    const collectedCount = Number(select.dataset.collectedCount) || 0;
    if (!chosen || !collection || !Number.isFinite(chosen.price)) {
      hintEl.classList.add('hidden');
      hintEl.textContent = '';
      return;
    }
    const { willUnlockImmediately, remainingEUR } = previewAssignment(collection, collectedCount, chosen.price);
    if (!willUnlockImmediately) {
      hintEl.classList.add('hidden');
      hintEl.textContent = '';
      return;
    }
    hintEl.textContent = remainingEUR > 0
      ? `🎉 Dit cadeau is al bereikt en wordt meteen uitgekeerd! De resterende €${remainingEUR} start automatisch een nieuwe beloning.`
      : '🎉 Dit cadeau is al bereikt en wordt meteen uitgekeerd!';
    hintEl.classList.remove('hidden');
  }

  panelEl.addEventListener('change', (event) => {
    if (event.target.matches('.col-reward-select')) updatePickerHint(event.target);
  });

  panelEl.addEventListener('click', (event) => {
    const pickBtn = event.target.closest('.col-reward-pick');
    if (pickBtn) {
      const rewardId = pickBtn.dataset.rewardId;
      openPickerRewardId = openPickerRewardId === rewardId ? null : rewardId;
      renderPanel();
      return;
    }

    const cancelBtn = event.target.closest('.col-reward-cancel');
    if (cancelBtn) { openPickerRewardId = null; renderPanel(); return; }

    const clearBtn = event.target.closest('.col-reward-clear');
    if (clearBtn) {
      const w = who();
      const rewardId = clearBtn.dataset.rewardId;
      if (w && rewardId) {
        setRewardGift(w, activeCollectionId, rewardId, null);
        openPickerRewardId = null;
        renderPanel();
      }
      return;
    }

    const confirmBtn = event.target.closest('.col-reward-confirm');
    if (confirmBtn) {
      const rewardId = confirmBtn.dataset.rewardId;
      const select = qs(`#colRewardSelect-${rewardId}`, panelEl);
      const w = who();
      const chosen = liveGifts.find((g) => g.id === select?.value);
      if (!w || !chosen) return;
      setRewardGift(w, activeCollectionId, rewardId, {
        giftId: chosen.id, title: chosen.title, price: chosen.price, url: chosen.url,
      });
      openPickerRewardId = null;
      renderPanel();
      return;
    }
  });

  // ---- Unlock showcase --------------------------------------------

  // Reward keys whose animation failed outright (unexpected error) —
  // tracked so a persistently-broken one (e.g. a corrupted config
  // entry) gets retried a few times, once per render, rather than
  // looping forever. In practice this should never trigger; it's a
  // safety net, not an expected code path.
  const failedUnlockAttempts = new Map();
  const MAX_UNLOCK_ATTEMPTS = 3;

  // Every reward key currently either sitting in unlockQueue OR
  // actively being shown/animated. renderPanel() re-scans and calls
  // queueUnlock() on EVERY render (including ones that fire while an
  // earlier unlock is still mid-animation, e.g. a poll tick or the
  // initial gifts fetch resolving) — without this guard, the same
  // still-not-yet-persisted-as-unlocked reward would get queued
  // again on each of those renders, showing the showcase a second
  // time right after the first is dismissed.
  const pendingUnlockKeys = new Set();

  function queueUnlock(w, collection, rewardConfig, progress) {
    const key = `${collection.id}::${rewardConfig.id}`;
    if ((failedUnlockAttempts.get(key) || 0) >= MAX_UNLOCK_ATTEMPTS) return;
    if (pendingUnlockKeys.has(key)) return;
    pendingUnlockKeys.add(key);
    unlockQueue.push({ key, who: w, collection, rewardConfig, progress });
  }

  async function processUnlockQueue() {
    if (animating || unlockQueue.length === 0) return;
    animating = true;
    const next = unlockQueue.shift();
    let ok = true;
    try {
      await playUnlockAnimation(next);
      // Freeze exactly what was shown — a later gift edit/deletion on
      // gifts.html must never retroactively change what this reward
      // was unlocked for (see collectibles.js's markRewardUnlocked).
      markRewardUnlocked(next.who, next.collection.id, next.rewardConfig.id, {
        title: next.progress.title, price: next.progress.price, url: next.progress.url,
      });
    } catch (error) {
      ok = false;
      failedUnlockAttempts.set(next.key, (failedUnlockAttempts.get(next.key) || 0) + 1);
      console.error('Kon de ontgrendel-animatie niet volledig afspelen:', error);
    } finally {
      // No longer in-flight — safe for a future render to re-evaluate
      // it (it'll either see unlocked:true and skip, or retry on
      // failure, up to MAX_UNLOCK_ATTEMPTS).
      pendingUnlockKeys.delete(next.key);
    }
    animating = false;
    // Deferred (never a direct synchronous call) so a reward that
    // somehow keeps failing can never spiral into runaway recursion
    // between this and renderPanel() — worst case it's retried once
    // per task-queue turn, up to MAX_UNLOCK_ATTEMPTS.
    queueMicrotask(() => {
      if (ok && next.collection.id === activeCollectionId) renderPanel();
      else processUnlockQueue(); // keep draining even if viewing a different tab (or after a failure)
    });
  }

  const overlay = document.getElementById('rewardUnlockOverlay');
  const overlayImage = document.getElementById('rewardUnlockImage');
  const overlayFallbackIcon = document.getElementById('rewardUnlockFallbackIcon');
  const overlayTitle = document.getElementById('rewardUnlockTitle');
  const overlayPrice = document.getElementById('rewardUnlockPrice');
  const overlayContinue = document.getElementById('rewardUnlockContinue');

  function playUnlockAnimation({ collection, progress }) {
    overlayTitle.textContent = progress.title;
    overlayPrice.textContent = `Ontgrendeld voor €${progress.price} — ${progress.collectedCount} ${collection.name.toLowerCase()}`;
    overlayImage.classList.add('hidden');
    overlayImage.removeAttribute('src');
    overlayFallbackIcon.classList.remove('hidden');
    overlayFallbackIcon.textContent = collection.emoji || '🎁';

    if (!progress.isFallback && progress.url) {
      loadImageObjectUrl(progress.giftId, progress.url).then((objectUrl) => {
        if (!objectUrl || overlay.classList.contains('hidden')) return;
        overlayImage.src = objectUrl;
        overlayImage.classList.remove('hidden');
        overlayFallbackIcon.classList.add('hidden');
      });
    }

    overlay.classList.remove('hidden');
    try {
      overlay.classList.toggle('col-reduced-motion', prefersReducedMotion());
    } catch {
      // matchMedia unavailable for some reason — fall back to the
      // full animation rather than letting this abort the showcase.
    }
    // Two rAFs so the browser commits the "hidden -> visible" state
    // before adding the class that drives the entrance transition —
    // otherwise the transition can get skipped entirely.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      overlay.classList.add('col-unlock-overlay-show');
    }));
    document.body.classList.add('col-modal-open');
    overlayContinue.focus();

    return new Promise((resolve) => {
      function close() {
        overlayContinue.removeEventListener('click', close);
        document.removeEventListener('keydown', onKeydown);
        overlay.classList.remove('col-unlock-overlay-show');
        overlay.classList.add('hidden');
        document.body.classList.remove('col-modal-open');
        resolve();
      }
      function onKeydown(event) {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'Escape') { event.preventDefault(); close(); }
      }
      overlayContinue.addEventListener('click', close);
      document.addEventListener('keydown', onKeydown);
    });
  }

  // ---- Auth reactivity + polling --------------------------------------

  onAuthChange(() => {
    openPickerRewardId = null;
    if (getCollection(activeCollectionId)) renderPanel();
  });

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(async () => {
      if (openPickerRewardId || animating) return; // don't yank the picker/animation out from under the person
      await loadLiveGifts({ silent: true });
      renderPanel();
    }, POLL_INTERVAL_MS);
  }
  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopPolling();
    else { loadLiveGifts({ silent: true }).then(renderPanel); startPolling(); }
  });

  // ---- Initial load ----------------------------------------------------

  buildTabs();
  renderPanel(); // paint immediately with fallback data, then refine once gifts load
  loadLiveGifts().then(renderPanel);
  startPolling();
}
