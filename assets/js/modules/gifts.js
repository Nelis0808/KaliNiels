// =================================================================
// GIFT IDEAS (gifts.html)
// -----------------------------------------------------------------
// Talks ONLY to the gifts Cloudflare Worker (see
// cloudflare/gifts/), which
// stores the shared list in Cloudflare KV. No login — same reasoning
// as the lijstje Worker (see its top comment).
//
// TWO COLUMNS, ONE LIST: every gift has a `person` field ('a' =
// Niels, 'b' = Kalina, same convention as photos/blackjack). The
// list itself is one shared array (one KV key) — this module just
// splits it into the two columns when rendering, and tags new gifts
// with whichever column's add-form was used.
//
// EDITING: clicking the ✏️ button on a card opens the SAME form
// used for adding, but pre-filled and in "edit mode". Submitting it
// saves the FULL gift list back via PUT /gifts (same call
// saveGifts() already uses for every other change here) rather than
// a partial PATCH — deliberately, so the newer `price` field (see
// below) round-trips correctly regardless of exactly which fields
// this project's deployed gifts Worker's PATCH route happens to
// whitelist; PUT /gifts stores whatever gift objects it's given
// as-is, no server-side schema, same as every other "read it all,
// write it all back" Worker in this project (see
// ACTION-EXPANSION-PLAN.md §1.1). Cancelling restores the form to
// its normal "add" state. Only one card can be edited at a time
// (opening a second edit cancels the first) to keep the two-column
// layout from getting confusing with multiple forms mid-edit.
//
// PRICE: every gift optionally has an integer `price` (whole euros).
// Optional, not required, so the existing "just paste a link and go"
// quick-add flow keeps working unchanged for anyone who doesn't care
// about the reward system below. A gift needs a price before it can
// be picked as a collectible reward (see "SET AS REWARD" below) —
// cards without one show a small "Prijs onbekend" hint instead of a
// price pill.
//
// SET AS REWARD: only Kalina's ('b') column can show this — see
// siteConfig.collectibles.rewardGiftPerson — since collectible
// rewards always come from her list regardless of who's earning the
// collectibles. Each of her cards has an optional 🎯 button (only
// shown once logged in, and only enabled once the gift has a price)
// that assigns this exact gift — id, title, price, url — as the
// chosen reward for one of the not-yet-unlocked reward rows across
// EVERY configured collection (siteConfig.collectibles.collections —
// picking the collection is part of the same picker once there's
// more than one). If what's already been earned in that collection
// already covers this gift's price outright, it's paid out
// immediately and whatever's left over rolls into a brand-new reward
// row automatically — see collectibles.js's setRewardGift() for that
// logic. This is a convenience shortcut for the SAME assignment the
// Collections page (collections.html) lets you make from the
// reward's own side — both call the identical
// assets/js/modules/collectibles.js setRewardGift(), so it doesn't
// matter which page you use.
//
// PHOTOS: the add/edit form has an optional file picker. If a file is
// chosen, it's uploaded to POST /gifts/upload?id=<id> right after the
// gift itself is saved (so the id is always known first) — the
// Worker stores it in R2 and it immediately takes priority over any
// scraped og:image for that gift (see the Worker's own comment).
//
// IMAGES: for each gift, the browser never fetches the linked shop's
// image directly (that'd hit CORS walls constantly). Instead it asks
// the Worker for `${workerUrl}/gifts/image?id=<id>&url=<link>`, which
// returns a custom photo if one was uploaded (dashboard OR this page
// now), or tries to scrape the link's og:image, or 404s (shown as a
// plain gift-box icon).
//
// SYNC MODEL: same optimistic-update + polling approach as
// lijstje.js — see its top comment for the reasoning.
// =================================================================

import { siteConfig } from '../config.js';
import { qs, qsa, escapeHtml } from './utils.js';
import { getAuth, onAuthChange } from './auth.js';
import { isUserActive, onPollResume } from './poll-guard.js';
import { getCollections, getCollection, getCollectionState, getRewardState, setRewardGift, getAllRewardConfigs, getRewardGiftPerson, previewAssignment } from './collectibles.js';

const POLL_INTERVAL_MS = 8000;
const PERSONS = ['b', 'a']; // b (Kalina) left, a (Niels) right — matches the markup order
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // same limit as the Worker (big photos are shrunk first, see prepareImage)
const MAX_IMAGE_DIMENSION = 1600;         // longest side after shrinking
const KEEP_AS_IS_BYTES = 400 * 1024;      // small photos are uploaded untouched
const UPLOAD_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const IMAGE_URL_PATTERN = /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i;
const MISSING_IMAGE_RETRY_MS = 10 * 60 * 1000;

// ---- Photo helpers (drag & drop, paste, shrinking) -------------------

// Shrinks a big photo (or converts e.g. an AVIF) to a JPEG of at most
// MAX_IMAGE_DIMENSION px, so phone photos of 5-10MB become ~300KB. Small
// files and GIFs go through untouched. Any failure just returns the original.
async function prepareImage(file) {
  const isGif = file.type === 'image/gif';
  const supported = UPLOAD_TYPES.has(file.type);
  if (isGif) return file;
  if (supported && file.size <= KEEP_AS_IS_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
    if (supported && scale === 1 && file.size <= 1.5 * 1024 * 1024) { bitmap.close?.(); return file; }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // JPEG has no transparency
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) return file;
    if (supported && blob.size >= file.size) return file;
    return new File([blob], (file.name || 'foto').replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

// What did the person drop on the form? A real file, a picture dragged
// out of another web page (its address), or just a link.
function extractDropped(dataTransfer) {
  const files = Array.from(dataTransfer.files || []).filter((f) => f.type.startsWith('image/'));
  if (files.length) return { file: files[0] };

  const html = dataTransfer.getData('text/html');
  if (html) {
    try {
      const img = new DOMParser().parseFromString(html, 'text/html').querySelector('img');
      const src = img && img.getAttribute('src');
      if (src && /^(https?:|data:image\/)/i.test(src)) return { src };
    } catch { /* fall through to the plain link below */ }
  }

  const raw = dataTransfer.getData('text/uri-list') || dataTransfer.getData('text/plain') || '';
  const link = raw.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith('#'));
  if (link && /^https?:\/\//i.test(link)) return IMAGE_URL_PATTERN.test(link) ? { src: link } : { link };
  return null;
}

// Parses a raw form value into a valid integer-euro price, or null if
// the field was left empty / isn't a usable number. Negative values
// and fractions are clamped/rounded rather than rejected outright —
// friendlier than an error for something this minor ("35.50" -> 36).
function parsePriceInput(rawValue) {
  const trimmed = String(rawValue ?? '').trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100000, Math.round(n)));
}

export function initGifts() {
  const root = document.getElementById('giftsApp');
  if (!root) return; // not on this page

  const workerUrl = siteConfig.gifts?.workerUrl || '';
  const personLabels = siteConfig.gifts?.personLabels || {};

  const configWarning = qs('#giftsConfigWarning', root);
  const columnsEl = qs('#giftsColumns', root);

  // Fill in the person names from config.js wherever the markup has a placeholder.
  qsa('[data-gifts-person-label]', root).forEach((el) => {
    const who = el.dataset.giftsPersonLabel;
    el.textContent = personLabels[who] || (who === 'a' ? 'Niels' : 'Kalina');
  });

  const columnEls = {
    a: { list: qs('#giftsListA', root), empty: qs('#giftsEmptyA', root), form: qs('#giftsAddFormA', root) },
    b: { list: qs('#giftsListB', root), empty: qs('#giftsEmptyB', root), form: qs('#giftsAddFormB', root) },
  };

  // True once config.js's gifts.workerUrl has been set to a real Worker URL
  function workerConfigured() {
    return workerUrl && !workerUrl.includes('YOUR-SUBDOMAIN');
  }

  if (!workerConfigured()) {
    configWarning.classList.remove('hidden');
    columnsEl.classList.add('hidden');
    return;
  }

  // Local copy of the list — source of truth for rendering; every
  // mutation updates it optimistically, then syncs to the Worker.
  let gifts = [];
  let pollTimer = null;
  let saveInFlight = false;

  // Which gift (if any) is currently being edited — only one at a
  // time, see file header.
  let editingId = null;

  // Tracks object URLs handed out by loadGiftImage() so they can be
  // revoked on the next render instead of leaking memory forever.
  let activeObjectUrls = [];

  // Thumbnails already downloaded, so a re-render (every save, every
  // change from the other person) never downloads them again. Key =
  // id|url|version; value = { blob|null, at }. A null blob means "no
  // picture found" and is only remembered for MISSING_IMAGE_RETRY_MS.
  const imageCache = new Map();
  // gift id -> timestamp of its last upload (cache-buster). Kept in localStorage too, so
  // after a page reload the browser doesn't fall back to an older cached answer for the
  // same address (e.g. the "no picture" reply from before the photo was uploaded).
  // Set by the dev page ("Cadeaus-cache wissen"): a timestamp that is added to every image/meta request,
  // so the browser AND the Worker's edge cache treat them as new addresses and fetch everything fresh.
  let cacheBust = 0;
  try { cacheBust = Number(localStorage.getItem('giftsCacheBustV1')) || 0; } catch { cacheBust = 0; }
  const VERSION_STORAGE_KEY = 'giftPhotoVersionsV1';
  let imageVersion = {};
  try { imageVersion = JSON.parse(localStorage.getItem(VERSION_STORAGE_KEY) || '{}') || {}; } catch { imageVersion = {}; }
  function rememberImageVersion(id) {
    imageVersion[id] = Date.now();
    try { localStorage.setItem(VERSION_STORAGE_KEY, JSON.stringify(imageVersion)); } catch { /* storage unavailable: in-memory only */ }
  }
  let lastSnapshot = ''; // JSON of the list as last rendered; poll skips a redraw when unchanged

  // One controller per column form for the photo that is waiting to be uploaded.
  const photoCtl = {};

  // ---- Rendering -----------------------------------------------------

  // Redraws both columns from `gifts`
  function render() {
    lastSnapshot = JSON.stringify(gifts);
    activeObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    activeObjectUrls = [];

    PERSONS.forEach((person) => {
      const { list, empty } = columnEls[person];
      const personGifts = gifts
        .filter((gift) => gift.person === person)
        .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)); // newest first

      if (personGifts.length === 0) {
        list.innerHTML = '';
        empty.classList.remove('hidden');
        return;
      }

      empty.classList.add('hidden');
      list.innerHTML = personGifts
        .map((gift) => {
          const hasUrl = Boolean(gift.url);
          // Same visual card either way — just <a> (clickable, opens the
          // link) when there IS a link, or a plain <div> (nothing to
          // click through to) when the gift has no link at all.
          const tag = hasUrl ? 'a' : 'div';
          const linkAttrs = hasUrl
            ? `href="${escapeHtml(gift.url)}" target="_blank" rel="noopener noreferrer"`
            : '';
          const hasPrice = Number.isFinite(gift.price);
          const priceMarkup = hasPrice
            ? `<span class="gf-card-price">€${escapeHtml(String(gift.price))}</span>`
            : `<span class="gf-card-price gf-card-price-unknown">Prijs onbekend</span>`;
          // Only the reward-eligible column (Kalina's, by default —
          // see siteConfig.collectibles.rewardGiftPerson) gets the 🎯
          // button at all; a gift that literally can't be picked as a
          // reward doesn't need a button implying otherwise.
          const rewardButtonMarkup = gift.person === getRewardGiftPerson()
            ? `<button type="button" class="gf-reward" aria-label="${escapeHtml(gift.title)} instellen als beloning" aria-haspopup="true" aria-expanded="false" title="Als beloning instellen">🎯</button>`
            : '';
          return `
            <li class="gf-card" data-id="${escapeHtml(gift.id)}">
              <div class="gf-card-row">
                <${tag} class="gf-card-link${hasUrl ? '' : ' gf-card-link-nolink'}" ${linkAttrs}>
                  <div class="gf-card-image gf-card-loading" data-gift-image aria-hidden="true">
                    <span class="gf-card-fallback">🎁</span>
                  </div>
                  <div class="gf-card-body">
                    <span class="gf-card-title">${escapeHtml(gift.title)}</span>
                    ${gift.note ? `<span class="gf-card-note">${escapeHtml(gift.note)}</span>` : ''}
                    ${priceMarkup}
                  </div>
                </${tag}>
                <div class="gf-card-actions">
                  ${rewardButtonMarkup}
                  <button type="button" class="gf-edit" aria-label="${escapeHtml(gift.title)} bewerken">✏️</button>
                  <button type="button" class="gf-delete" aria-label="${escapeHtml(gift.title)} verwijderen">✕</button>
                </div>
              </div>
              <div class="gf-reward-panel hidden" data-reward-panel></div>
            </li>
          `;
        })
        .join('');

      personGifts.forEach((gift) => {
        const card = list.querySelector(`.gf-card[data-id="${cssEscape(gift.id)}"] [data-gift-image]`);
        if (card) loadGiftImage(gift, card);
        updateRewardButtonState(gift);
      });
    });
  }

  // A tiny CSS.escape fallback (crypto.randomUUID ids are safe as-is,
  // but this keeps the selector robust if that ever changes).
  // Escapes a value for safe use inside a CSS attribute selector
  function cssEscape(value) {
    return window.CSS && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
  }

  // ---- "Set as reward" (🎯) ------------------------------------------
  // Lets a gift's own card assign itself as the chosen gift for one of
  // the not-yet-unlocked reward rows in siteConfig.collectibles (see
  // that config's comment, and assets/js/modules/collectibles.js).
  // Uses the site-wide shared login (auth.js) to know WHOSE collection
  // to assign into — there's no separate login on this page, but if a
  // session already exists (from Profiel elsewhere) this reads it the
  // same way every other gated feature does.

  // Every not-yet-unlocked reward row, across every collection (config-
  // defined AND any created dynamically — see getAllRewardConfigs()),
  // for whoever is currently logged in. Empty if nobody's logged in.
  function assignableRewardOptions() {
    const who = getAuth()?.who;
    if (!who) return [];
    const options = [];
    getCollections().forEach((collection) => {
      const rewardConfigs = getAllRewardConfigs(who, collection.id);
      rewardConfigs.forEach((rewardConfig, idx) => {
        const rewardState = getRewardState(who, collection.id, rewardConfig.id);
        if (rewardState.unlocked) return;
        const current = rewardState.giftSnapshot?.title || null;
        options.push({
          collectionId: collection.id,
          rewardId: rewardConfig.id,
          collectedCount: getCollectionState(who, collection.id).collectedCount,
          label: `${collection.emoji || ''} ${collection.name} — beloning ${idx + 1}${current ? ` (nu: ${current})` : ''}`.trim(),
        });
      });
    });
    return options;
  }

  // Enables/disables + labels a card's 🎯 button based on login state,
  // whether the gift has a price yet, and whether there's anything to
  // assign it to.
  function updateRewardButtonState(gift) {
    const card = qs(`.gf-card[data-id="${cssEscape(gift.id)}"]`, root);
    const button = card && qs('.gf-reward', card);
    if (!button) return;
    const who = getAuth()?.who;
    const hasPrice = Number.isFinite(gift.price);
    const options = who ? assignableRewardOptions() : [];
    if (!who) {
      button.disabled = true;
      button.title = 'Log in via Profiel om dit cadeau als beloning in te stellen.';
    } else if (!hasPrice) {
      button.disabled = true;
      button.title = 'Voeg eerst een prijs toe om dit cadeau als beloning te kunnen instellen.';
    } else if (options.length === 0) {
      button.disabled = true;
      button.title = 'Alle beloningen zijn al ontgrendeld — er is niets meer om aan toe te wijzen.';
    } else {
      button.disabled = false;
      button.title = 'Als beloning instellen';
    }
  }

  // Closes every open reward panel except (optionally) one.
  function closeRewardPanels(exceptPanel = null) {
    qsa('[data-reward-panel]', root).forEach((panel) => {
      if (panel !== exceptPanel) panel.classList.add('hidden');
    });
    qsa('.gf-reward', root).forEach((btn) => {
      if (!exceptPanel || btn.closest('.gf-card')?.querySelector('[data-reward-panel]') !== exceptPanel) {
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // Builds and opens the little "which reward row?" picker under a card
  function openRewardPanel(gift, panel, button) {
    const options = assignableRewardOptions();
    if (options.length === 0) { closeRewardPanels(); return; }
    panel.innerHTML = `
      <label class="gf-reward-label" for="gfRewardSelect-${escapeHtml(gift.id)}">Gebruik als beloning voor:</label>
      <select id="gfRewardSelect-${escapeHtml(gift.id)}" class="gf-reward-select">
        ${options.map((o) => `<option value="${escapeHtml(o.collectionId)}::${escapeHtml(o.rewardId)}" data-collected-count="${o.collectedCount}">${escapeHtml(o.label)}</option>`).join('')}
      </select>
      <p class="gf-reward-hint hidden" data-reward-hint aria-live="polite"></p>
      <div class="gf-reward-panel-buttons">
        <button type="button" class="btn btn-primary btn-sm gf-reward-confirm">Instellen</button>
        <button type="button" class="btn btn-ghost btn-sm gf-reward-cancel">Annuleren</button>
      </div>
      <p class="gf-reward-confirmed hidden" role="status">✅ Ingesteld als beloning.</p>
    `;
    panel.classList.remove('hidden');
    button.setAttribute('aria-expanded', 'true');
    updateRewardHint(gift, panel.querySelector('.gf-reward-select'));
  }

  // Shows a "this unlocks right away" hint under the picker's select
  // when the currently-highlighted reward row is already fully
  // affordable for this gift's price (see collectibles.js's
  // previewAssignment/setRewardGift for the actual cash-out +
  // rollover-into-a-new-reward logic this is just previewing).
  function updateRewardHint(gift, select) {
    const hintEl = select?.parentElement?.querySelector('[data-reward-hint]');
    if (!select || !hintEl || !Number.isFinite(gift.price)) return;
    const [collectionId] = String(select.value).split('::');
    const collection = getCollection(collectionId);
    const collectedCount = Number(select.selectedOptions[0]?.dataset.collectedCount) || 0;
    const { willUnlockImmediately, remainingEUR } = previewAssignment(collection, collectedCount, gift.price);
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

  // Fetches a gift's thumbnail (custom photo or the link's preview image) via the Worker
  async function loadGiftImage(gift, imageEl) {
    const version = Math.max(imageVersion[gift.id] || 0, cacheBust);
    const key = `${gift.id}|${gift.url}|${version}`;
    const showBlob = (blob) => {
      const objectUrl = URL.createObjectURL(blob);
      activeObjectUrls.push(objectUrl);
      imageEl.style.backgroundImage = `url('${objectUrl}')`;
      imageEl.classList.remove('gf-card-loading');
      imageEl.classList.add('gf-card-has-image');
    };

    const cached = imageCache.get(key);
    if (cached && (cached.blob || Date.now() - cached.at < MISSING_IMAGE_RETRY_MS)) {
      if (cached.blob) showBlob(cached.blob);
      else imageEl.classList.remove('gf-card-loading');
      return;
    }

    try {
      const response = await fetch(
        `${workerUrl}/gifts/image?id=${encodeURIComponent(gift.id)}&url=${encodeURIComponent(gift.url)}${version ? `&v=${version}` : ''}`
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const blob = await response.blob();
      imageCache.set(key, { blob, at: Date.now() });
      // The card may have been redrawn while we were downloading.
      if (imageEl.isConnected) showBlob(blob);
    } catch {
      // No custom photo, no usable preview image, or the link is down —
      // fine, the 🎁 fallback already in the markup just stays visible.
      imageCache.set(key, { blob: null, at: Date.now() });
      imageEl.classList.remove('gf-card-loading');
    }
  }

  // ---- Networking ------------------------------------------------

  // Fetches the shared gift list from the Worker
  async function loadGifts({ silent = false } = {}) {
    try {
      const response = await fetch(`${workerUrl}/gifts`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const next = Array.isArray(data.gifts) ? data.gifts : [];
      if (JSON.stringify(next) === lastSnapshot) return; // nothing changed: no redraw, no thumbnail reloads
      gifts = next;
      render();
    } catch (error) {
      console.error('Kon cadeaulijst niet laden:', error);
    }
  }

  // Pushes the current `gifts` array to the Worker, reloading on failure
  async function saveGifts() {
    saveInFlight = true;
    try {
      const response = await fetch(`${workerUrl}/gifts`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gifts }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      gifts = Array.isArray(data.gifts) ? data.gifts : gifts;
      render();
    } catch (error) {
      console.error('Kon wijziging niet opslaan:', error);
      await loadGifts({ silent: true });
    } finally {
      saveInFlight = false;
    }
  }

  // Uploads a custom photo for a gift, taking priority over any scraped image.
  // `photo` is { file } (raw bytes) or { src } (the Worker downloads that
  // image address itself). Returns '' on success, otherwise an error message.
  async function uploadGiftPhoto(id, photo) {
    try {
      const base = `${workerUrl}/gifts/upload?id=${encodeURIComponent(id)}`;
      const response = photo.file
        ? await fetch(base, { method: 'POST', headers: { 'Content-Type': photo.file.type }, body: photo.file })
        : await fetch(`${base}&src=${encodeURIComponent(photo.src)}`, { method: 'POST' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      rememberImageVersion(id); // new picture: skip the cached thumbnail and any browser-cached copy
      return '';
    } catch (error) {
      console.error('Kon foto niet uploaden:', error);
      return `Foto uploaden mislukt: ${error.message || 'onbekende fout'}`;
    }
  }

  // Best-effort: if the person left the title blank, ask the Worker
  // to peek at the link's <title>/og:title so they don't have to
  // type it themselves. Never blocks adding the gift — on any
  // failure we just fall back to the raw URL as the title.
  // Asks the Worker to scrape a page title for a pasted link, for auto-filling the title field
  // Asks the Worker what it can learn about a pasted link: { title, price, imageUrl } (all optional)
  async function fetchMetaFor(url) {
    try {
      // no-store: an older answer without price must never be reused from the browser's own cache
      const response = await fetch(`${workerUrl}/gifts/meta?url=${encodeURIComponent(url)}&v=3${cacheBust ? `&cb=${cacheBust}` : ''}`, { cache: 'no-store' });
      if (!response.ok) return {};
      return (await response.json()) || {};
    } catch {
      return {};
    }
  }

  // ---- Mutations ---------------------------------------------------

  // Adds a new gift (optimistically), then uploads its photo if one was chosen
  async function addGift(person, { url, title, note, price, photo }, formEls) {
    const trimmedUrl = url.trim();
    let trimmedTitle = title.trim();

    setFormBusy(formEls, true, 'Bezig…');

    // With a link, ask the Worker (once) for whatever the shop page tells: a title when none
    // was typed, a price when none was entered, and the product picture when no photo was
    // chosen (it is then stored as the gift's own photo, so it never has to be looked up again).
    let autoPhoto = false;
    if (trimmedUrl && (!trimmedTitle || !Number.isFinite(price) || !photo)) {
      const meta = await fetchMetaFor(trimmedUrl);
      if (!trimmedTitle && meta.title) trimmedTitle = meta.title;
      if (!Number.isFinite(price) && Number.isFinite(Number(meta.price)) && Number(meta.price) > 0) {
        price = Math.min(100000, Math.round(Number(meta.price)));
      }
      if (!photo && typeof meta.imageUrl === 'string' && /^https:\/\//.test(meta.imageUrl)) {
        photo = { src: meta.imageUrl };
        autoPhoto = true;
      }
    }
    if (!trimmedTitle) trimmedTitle = trimmedUrl;

    const id = crypto.randomUUID();
    gifts = [
      ...gifts,
      { id, person, title: trimmedTitle, url: trimmedUrl, note: note.trim(), price, addedAt: Date.now() },
    ];
    render();
    await saveGifts();

    if (photo) {
      const uploadError = await uploadGiftPhoto(id, photo);
      // A picture we found ourselves failing to store is no reason to bother anyone: the card just falls back to the normal lookup.
      if (uploadError && !autoPhoto && formEls.errorEl) formEls.errorEl.textContent = uploadError;
      render(); // re-fetch the thumbnail now that a custom photo exists
    }

    setFormBusy(formEls, false, 'Toevoegen');
  }

  // Saves an edited gift. Updates the LOCAL copy of the full gifts
  // array and pushes it via the same saveGifts() (PUT /gifts) every
  // other change here already uses, rather than patchGift() — see
  // this file's header for why: it's what makes the newer `price`
  // field reliably persist regardless of the deployed Worker's exact
  // PATCH schema, with no Cloudflare code changes required.
  async function saveEdit(id, { url, title, note, price, person, photo }, formEls) {
    setFormBusy(formEls, true, 'Opslaan…');

    const index = gifts.findIndex((gift) => gift.id === id);
    if (index === -1) { setFormBusy(formEls, false, 'Toevoegen'); return false; }
    gifts = gifts.map((gift, i) => (i === index ? { ...gift, url: url.trim(), title: title.trim(), note: note.trim(), price, person } : gift));
    render();
    await saveGifts();

    if (photo) {
      const uploadError = await uploadGiftPhoto(id, photo);
      if (uploadError && formEls.errorEl) formEls.errorEl.textContent = uploadError;
      render();
    }

    setFormBusy(formEls, false, 'Toevoegen');
    return true;
  }

  // Disables/re-labels a form's submit button while a save is in flight
  function setFormBusy(formEls, busy, label) {
    formEls.submitBtn.disabled = busy;
    formEls.submitBtn.textContent = label;
  }

  // Removes a gift (optimistically) and saves
  function deleteGift(id) {
    if (editingId === id) exitEditMode(columnEls[gifts.find((g) => g.id === id)?.person] || columnEls.a);
    gifts = gifts.filter((gift) => gift.id !== id);
    render();
    saveGifts();
  }

  // ---- Edit mode -----------------------------------------------------
  // Reuses each column's existing add-form: swapping its fields to the
  // gift's current values, changing the submit button's label, and
  // remembering `editingId` so the submit handler below knows to save
  // the edit instead of adding a new gift. Only one edit can be open
  // at once.

  // Pre-fills a column's add-form with a gift's data and switches it into edit mode
  function enterEditMode(gift) {
    if (editingId && editingId !== gift.id) {
      // Cancel whichever edit was already open first.
      const previousGift = gifts.find((g) => g.id === editingId);
      if (previousGift) exitEditMode(columnEls[previousGift.person]);
    }

    editingId = gift.id;
    const { form } = columnEls[gift.person];
    qs('.gf-add-url', form).value = gift.url;
    qs('.gf-add-title', form).value = gift.title;
    qs('.gf-add-note', form).value = gift.note || '';
    const priceEl = qs('.gf-add-price', form);
    if (priceEl) priceEl.value = Number.isFinite(gift.price) ? String(gift.price) : '';
    photoCtl[gift.person]?.clear();
    qs('button[type="submit"]', form).textContent = 'Wijzigingen opslaan';
    form.classList.add('gf-add-form-editing');

    const cancelBtn = qs('.gf-edit-cancel', form);
    if (cancelBtn) cancelBtn.classList.remove('hidden');

    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    qs('.gf-add-title', form).focus();
  }

  // Restores a column's form back to its normal "add" state
  function exitEditMode(columnConfig) {
    if (!columnConfig) return;
    editingId = null;
    const { form } = columnConfig;
    form.reset();
    photoCtl[Object.keys(columnEls).find((p) => columnEls[p] === columnConfig)]?.clear();
    qs('button[type="submit"]', form).textContent = 'Toevoegen';
    form.classList.remove('gf-add-form-editing');
    const cancelBtn = qs('.gf-edit-cancel', form);
    if (cancelBtn) cancelBtn.classList.add('hidden');
  }

  // ---- Wiring ------------------------------------------------------

  PERSONS.forEach((person) => {
    const { form } = columnEls[person];
    const urlInput = qs('.gf-add-url', form);
    const titleInput = qs('.gf-add-title', form);
    const noteInput = qs('.gf-add-note', form);
    const priceInput = qs('.gf-add-price', form);
    const photoInput = qs('.gf-add-photo', form);
    const photoFilenameEl = qs('.gf-add-photo-filename', form);
    const errorEl = form.nextElementSibling; // .gf-add-error, right after the form
    const submitBtn = qs('button[type="submit"]', form);
    const cancelBtn = qs('.gf-edit-cancel', form);

    // ---- Photo waiting to be uploaded: picked, dragged in, or pasted ----
    // `pending` is { file } (an image file, already shrunk by prepareImage)
    // or { src } (an address on another website, downloaded by the Worker).
    let pending = null;
    let previewObjectUrl = null;
    const previewEl = qs('.gf-photo-preview', form);
    const previewImg = qs('.gf-photo-preview-img', form);
    const clearPhotoBtn = qs('.gf-photo-clear', form);

    function releasePreview() {
      if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = null;
    }

    function showFilename(text) {
      if (photoFilenameEl) photoFilenameEl.textContent = text || photoFilenameEl.dataset.defaultText || 'Kies bestand';
    }

    function clearPhoto() {
      pending = null;
      releasePreview();
      if (photoInput) photoInput.value = '';
      if (previewImg) previewImg.removeAttribute('src');
      previewEl?.classList.add('hidden');
      showFilename('');
    }

    function showPreview(src) {
      if (!previewImg || !previewEl) return;
      previewImg.src = src;
      previewEl.classList.remove('hidden');
    }

    async function setPhotoFile(file) {
      errorEl.textContent = '';
      if (!file) { clearPhoto(); return; }
      const prepared = await prepareImage(file);
      if (!UPLOAD_TYPES.has(prepared.type)) {
        clearPhoto();
        errorEl.textContent = 'Alleen jpg, png, webp of gif (of een afbeelding die de browser kan omzetten).';
        return;
      }
      if (prepared.size > MAX_UPLOAD_BYTES) {
        clearPhoto();
        errorEl.textContent = `Foto is te groot (max ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB).`;
        return;
      }
      releasePreview();
      previewObjectUrl = URL.createObjectURL(prepared);
      pending = { file: prepared };
      showPreview(previewObjectUrl);
      showFilename(file.name || 'Geplakte afbeelding');
    }

    function setPhotoSrc(src) {
      errorEl.textContent = '';
      if (src.startsWith('data:')) {
        // Some pages hand over the picture itself instead of an address.
        fetch(src).then((r) => r.blob()).then((blob) => setPhotoFile(new File([blob], 'sleepfoto', { type: blob.type }))).catch(() => {
          errorEl.textContent = 'Kon die afbeelding niet lezen.';
        });
        return;
      }
      releasePreview();
      pending = { src };
      showPreview(src);
      showFilename('Afbeelding van website');
    }

    photoCtl[person] = { clear: clearPhoto };

    photoInput?.addEventListener('change', () => {
      setPhotoFile(photoInput.files?.[0] || null);
    });

    clearPhotoBtn?.addEventListener('click', clearPhoto);

    // Paste (Ctrl+V) an image while the form has focus
    form.addEventListener('paste', (event) => {
      const file = Array.from(event.clipboardData?.files || []).find((f) => f.type.startsWith('image/'));
      if (!file) return; // normal text paste into the inputs
      event.preventDefault();
      setPhotoFile(file);
    });

    // Drag & drop onto the form
    let dragDepth = 0;
    const carriesDroppable = (event) => {
      const types = Array.from(event.dataTransfer?.types || []);
      return types.includes('Files') || types.includes('text/uri-list') || types.includes('text/html');
    };
    form.addEventListener('dragenter', (event) => {
      if (!carriesDroppable(event)) return;
      event.preventDefault();
      dragDepth += 1;
      form.classList.add('gf-dropzone-active');
    });
    form.addEventListener('dragover', (event) => {
      if (!carriesDroppable(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    });
    form.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) form.classList.remove('gf-dropzone-active');
    });
    form.addEventListener('drop', (event) => {
      if (!carriesDroppable(event)) return;
      event.preventDefault();
      dragDepth = 0;
      form.classList.remove('gf-dropzone-active');
      const dropped = extractDropped(event.dataTransfer);
      if (!dropped) {
        errorEl.textContent = 'Daar kon ik geen afbeelding in vinden.';
        return;
      }
      if (dropped.file) setPhotoFile(dropped.file);
      else if (dropped.src) setPhotoSrc(dropped.src);
      else if (dropped.link) {
        // A page link rather than a picture: use it as the gift's link if that's still empty.
        if (!urlInput.value.trim()) {
          urlInput.value = dropped.link;
          errorEl.textContent = 'Link ingevuld. Sleep het plaatje zelf hierheen als je een eigen foto wilt.';
        } else {
          errorEl.textContent = 'Dat is een link, geen afbeelding. Sleep de afbeelding zelf (of sla hem eerst op).';
        }
      }
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      errorEl.textContent = '';

      const urlValue = urlInput.value;
      const trimmedUrlValue = urlValue.trim();
      if (trimmedUrlValue) {
        try {
          // eslint-disable-next-line no-new
          new URL(trimmedUrlValue);
        } catch {
          errorEl.textContent = 'Dat lijkt geen geldige link.';
          return;
        }
      } else if (!titleInput.value.trim()) {
        // Link is optional now, but without one there's nothing to
        // show on the card unless a title was typed in by hand.
        errorEl.textContent = 'Vul een titel of een link in.';
        return;
      }

      if (priceInput && priceInput.value.trim() && parsePriceInput(priceInput.value) === null) {
        errorEl.textContent = 'Prijs moet een geheel getal in euro\u2019s zijn.';
        return;
      }

      const price = priceInput ? parsePriceInput(priceInput.value) : null;
      const payload = { url: urlValue, title: titleInput.value, note: noteInput.value, price, photo: pending, person };

      if (editingId) {
        const ok = await saveEdit(editingId, payload, { submitBtn, errorEl });
        if (ok) exitEditMode(columnEls[person]);
      } else {
        await addGift(person, payload, { submitBtn, errorEl });
        form.reset();
        clearPhoto();
        urlInput.focus();
      }
    });

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => exitEditMode(columnEls[person]));
    }
  });

  columnsEl.addEventListener('change', (event) => {
    if (!event.target.matches('.gf-reward-select')) return;
    const card = event.target.closest('.gf-card');
    const gift = gifts.find((g) => g.id === card?.dataset.id);
    if (gift) updateRewardHint(gift, event.target);
  });

  columnsEl.addEventListener('click', (event) => {
    const deleteBtn = event.target.closest('.gf-delete');
    if (deleteBtn) {
      const id = deleteBtn.closest('.gf-card')?.dataset.id;
      if (id) deleteGift(id);
      return;
    }

    const editBtn = event.target.closest('.gf-edit');
    if (editBtn) {
      const id = editBtn.closest('.gf-card')?.dataset.id;
      const gift = gifts.find((g) => g.id === id);
      if (gift) enterEditMode(gift);
      return;
    }

    const rewardBtn = event.target.closest('.gf-reward');
    if (rewardBtn) {
      const card = rewardBtn.closest('.gf-card');
      const panel = card?.querySelector('[data-reward-panel]');
      const id = card?.dataset.id;
      const gift = gifts.find((g) => g.id === id);
      if (!gift || !panel || rewardBtn.disabled) return;
      const alreadyOpen = !panel.classList.contains('hidden');
      closeRewardPanels();
      if (!alreadyOpen) openRewardPanel(gift, panel, rewardBtn);
      return;
    }

    const rewardCancelBtn = event.target.closest('.gf-reward-cancel');
    if (rewardCancelBtn) { closeRewardPanels(); return; }

    const rewardConfirmBtn = event.target.closest('.gf-reward-confirm');
    if (rewardConfirmBtn) {
      const panel = rewardConfirmBtn.closest('[data-reward-panel]');
      const card = rewardConfirmBtn.closest('.gf-card');
      const select = panel?.querySelector('.gf-reward-select');
      const id = card?.dataset.id;
      const gift = gifts.find((g) => g.id === id);
      const who = getAuth()?.who;
      if (!gift || !select || !who) return;
      const [collectionId, rewardId] = String(select.value).split('::');
      const applied = setRewardGift(who, collectionId, rewardId, {
        giftId: gift.id, title: gift.title, price: gift.price, url: gift.url,
      });
      if (applied) {
        panel.querySelector('.gf-reward-confirmed')?.classList.remove('hidden');
        select.disabled = true;
        rewardConfirmBtn.disabled = true;
        setTimeout(() => { closeRewardPanels(); updateRewardButtonState(gift); }, 1400);
      } else {
        // Extremely rare race (the reward got unlocked in another tab
        // between opening this panel and confirming it) — just refresh
        // the picker so it drops the now-unlocked option.
        const button = card?.querySelector('.gf-reward');
        if (button) openRewardPanel(gift, panel, button);
      }
      return;
    }
  });

  // A picture dropped next to the form would make the browser open it and
  // leave the page — swallow those drops (drops ON a form are handled above).
  ['dragover', 'drop'].forEach((name) => {
    window.addEventListener(name, (event) => {
      if (Array.from(event.dataTransfer?.types || []).includes('Files') && !event.target.closest?.('.gf-add-form')) {
        event.preventDefault();
      }
    });
  });

  // Reward panels are per-page UI state, not tied to any one form —
  // close them on outside clicks, same UX as the nav dropdowns.
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.gf-card')) closeRewardPanels();
  });

  // ---- Polling (picks up gifts added on the other person's device) ----

  // Starts the periodic background refresh, pausing while the tab is hidden
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      // Also skip while an edit form is open, so we never blow away
      // in-progress form input with a fresh render from the poll.
      if (isUserActive() && !saveInFlight && !editingId) loadGifts({ silent: true });
    }, POLL_INTERVAL_MS);
  }

  // Stops the periodic background refresh
  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopPolling();
    } else {
      if (!editingId) loadGifts({ silent: true });
      startPolling();
    }
  });
  onPollResume(() => { if (!saveInFlight && !editingId) loadGifts({ silent: true }); });

  // Login/logout (via the shared "👤 Profiel" dropdown) changes which
  // reward rows are assignable and to whom, so re-evaluate every card's
  // 🎯 button and close any open picker rather than leaving it showing
  // stale options for the previous session.
  onAuthChange(() => {
    closeRewardPanels();
    gifts.forEach((gift) => updateRewardButtonState(gift));
  });

  // ---- Initial load --------------------------------------------------

  loadGifts();
  startPolling();
}
