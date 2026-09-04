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
import { getCollections, getCollection, getCollectionState, getRewardState, setRewardGift, getAllRewardConfigs, getRewardGiftPerson, previewAssignment } from './collectibles.js';

const POLL_INTERVAL_MS = 8000;
const PERSONS = ['b', 'a']; // b (Kalina) left, a (Niels) right — matches the markup order
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

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

  // ---- Rendering -----------------------------------------------------

  // Redraws both columns from `gifts`
  function render() {
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

  // Fetches a gift's thumbnail (custom photo or scraped og:image) via the Worker
  async function loadGiftImage(gift, imageEl) {
    try {
      const response = await fetch(
        `${workerUrl}/gifts/image?id=${encodeURIComponent(gift.id)}&url=${encodeURIComponent(gift.url)}`
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      activeObjectUrls.push(objectUrl);
      imageEl.style.backgroundImage = `url('${objectUrl}')`;
      imageEl.classList.remove('gf-card-loading');
      imageEl.classList.add('gf-card-has-image');
    } catch {
      // No custom photo, no scrapable og:image, or the link is down —
      // fine, the 🎁 fallback already in the markup just stays visible.
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
      gifts = Array.isArray(data.gifts) ? data.gifts : [];
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

  // Uploads a custom photo for a gift, taking priority over any scraped image
  async function uploadGiftPhoto(id, file) {
    try {
      const response = await fetch(`${workerUrl}/gifts/upload?id=${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      return true;
    } catch (error) {
      console.error('Kon foto niet uploaden:', error);
      return false;
    }
  }

  // Best-effort: if the person left the title blank, ask the Worker
  // to peek at the link's <title>/og:title so they don't have to
  // type it themselves. Never blocks adding the gift — on any
  // failure we just fall back to the raw URL as the title.
  // Asks the Worker to scrape a page title for a pasted link, for auto-filling the title field
  async function fetchTitleFor(url) {
    try {
      const response = await fetch(`${workerUrl}/gifts/meta?url=${encodeURIComponent(url)}`);
      if (!response.ok) return '';
      const data = await response.json();
      return data.title || '';
    } catch {
      return '';
    }
  }

  // ---- Mutations ---------------------------------------------------

  // Adds a new gift (optimistically), then uploads its photo if one was chosen
  async function addGift(person, { url, title, note, price, photoFile }, formEls) {
    const trimmedUrl = url.trim();
    let trimmedTitle = title.trim();

    setFormBusy(formEls, true, 'Bezig…');

    if (!trimmedTitle) {
      // Only worth asking the Worker to peek at the link's title when
      // there IS a link — the form guarantees at least a title OR a
      // link was provided (see the submit handler), so if we get here
      // with no title, trimmedUrl is guaranteed non-empty.
      trimmedTitle = (await fetchTitleFor(trimmedUrl)) || trimmedUrl;
    }

    const id = crypto.randomUUID();
    gifts = [
      ...gifts,
      { id, person, title: trimmedTitle, url: trimmedUrl, note: note.trim(), price, addedAt: Date.now() },
    ];
    render();
    await saveGifts();

    if (photoFile) {
      await uploadGiftPhoto(id, photoFile);
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
  async function saveEdit(id, { url, title, note, price, person, photoFile }, formEls) {
    setFormBusy(formEls, true, 'Opslaan…');

    const index = gifts.findIndex((gift) => gift.id === id);
    if (index === -1) { setFormBusy(formEls, false, 'Toevoegen'); return false; }
    gifts = gifts.map((gift, i) => (i === index ? { ...gift, url: url.trim(), title: title.trim(), note: note.trim(), price, person } : gift));
    render();
    await saveGifts();

    if (photoFile) {
      await uploadGiftPhoto(id, photoFile);
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
    qs('.gf-add-photo', form).value = '';
    const editFilenameEl = qs('.gf-add-photo-filename', form);
    if (editFilenameEl) editFilenameEl.textContent = editFilenameEl.dataset.defaultText || 'Kies bestand';
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
    const exitFilenameEl = qs('.gf-add-photo-filename', form);
    if (exitFilenameEl) exitFilenameEl.textContent = exitFilenameEl.dataset.defaultText || 'Kies bestand';
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

    // Shows the chosen file's name next to the custom "Kies bestand"
    // button (replaces the browser's native, hidden filename text —
    // see .gf-add-photo-filename in gifts.css).
    // Resets the "chosen file" label back to its placeholder text
    function resetPhotoFilename() {
      if (photoFilenameEl) photoFilenameEl.textContent = photoFilenameEl.dataset.defaultText || 'Kies bestand';
    }

    photoInput?.addEventListener('change', () => {
      if (photoFilenameEl) {
        photoFilenameEl.textContent = photoInput.files?.[0]?.name || photoFilenameEl.dataset.defaultText || 'Kies bestand';
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

      const photoFile = photoInput?.files?.[0] || null;
      if (photoFile && photoFile.size > MAX_UPLOAD_BYTES) {
        errorEl.textContent = `Foto is te groot (max ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB).`;
        return;
      }

      const price = priceInput ? parsePriceInput(priceInput.value) : null;
      const payload = { url: urlValue, title: titleInput.value, note: noteInput.value, price, photoFile, person };

      if (editingId) {
        const ok = await saveEdit(editingId, payload, { submitBtn });
        if (ok) exitEditMode(columnEls[person]);
      } else {
        await addGift(person, payload, { submitBtn });
        form.reset();
        resetPhotoFilename();
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
      if (!saveInFlight && !editingId) loadGifts({ silent: true });
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
