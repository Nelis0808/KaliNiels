// =================================================================
// GIFT IDEAS (gifts.html)
// -----------------------------------------------------------------
// Talks ONLY to the gifts Cloudflare Worker (see
// /cloudflare/cloudflare-worker-gifts + STAPPENPLAN-GIFTS.md), which
// stores the shared list in Cloudflare KV. No login — same reasoning
// as the boodschappenlijst Worker (see its top comment).
//
// TWO COLUMNS, ONE LIST: every gift has a `person` field ('a' =
// Niels, 'b' = Kalina, same convention as photos/blackjack). The
// list itself is one shared array (one KV key) — this module just
// splits it into the two columns when rendering, and tags new gifts
// with whichever column's add-form was used.
//
// EDITING: clicking the ✏️ button on a card opens the SAME form
// used for adding, but pre-filled and in "edit mode" — submitting it
// sends a PATCH to /gifts/:id (updating title/url/note/person) instead
// of appending a new entry. Cancelling restores the form to its
// normal "add" state. Only one card can be edited at a time (opening
// a second edit cancels the first) to keep the two-column layout from
// getting confusing with multiple forms mid-edit.
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
// boodschappenlijst.js — see its top comment for the reasoning.
// =================================================================

import { siteConfig } from '../config.js';
import { qs, qsa, escapeHtml } from './utils.js';

const POLL_INTERVAL_MS = 8000;
const PERSONS = ['b', 'a']; // b (Kalina) left, a (Niels) right — matches the markup order
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

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
          return `
            <li class="gf-card" data-id="${escapeHtml(gift.id)}">
              <${tag} class="gf-card-link${hasUrl ? '' : ' gf-card-link-nolink'}" ${linkAttrs}>
                <div class="gf-card-image gf-card-loading" data-gift-image aria-hidden="true">
                  <span class="gf-card-fallback">🎁</span>
                </div>
                <div class="gf-card-body">
                  <span class="gf-card-title">${escapeHtml(gift.title)}</span>
                  ${gift.note ? `<span class="gf-card-note">${escapeHtml(gift.note)}</span>` : ''}
                </div>
              </${tag}>
              <div class="gf-card-actions">
                <button type="button" class="gf-edit" aria-label="${escapeHtml(gift.title)} bewerken">✏️</button>
                <button type="button" class="gf-delete" aria-label="${escapeHtml(gift.title)} verwijderen">✕</button>
              </div>
            </li>
          `;
        })
        .join('');

      personGifts.forEach((gift) => {
        const card = list.querySelector(`.gf-card[data-id="${cssEscape(gift.id)}"] [data-gift-image]`);
        if (card) loadGiftImage(gift, card);
      });
    });
  }

  // A tiny CSS.escape fallback (crypto.randomUUID ids are safe as-is,
  // but this keeps the selector robust if that ever changes).
  function cssEscape(value) {
    return window.CSS && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
  }

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

  async function patchGift(id, patch) {
    try {
      const response = await fetch(`${workerUrl}/gifts/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      gifts = Array.isArray(data.gifts) ? data.gifts : gifts;
      render();
      return true;
    } catch (error) {
      console.error('Kon cadeau niet bijwerken:', error);
      await loadGifts({ silent: true });
      return false;
    }
  }

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

  async function addGift(person, { url, title, note, photoFile }, formEls) {
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
      { id, person, title: trimmedTitle, url: trimmedUrl, note: note.trim(), addedAt: Date.now() },
    ];
    render();
    await saveGifts();

    if (photoFile) {
      await uploadGiftPhoto(id, photoFile);
      render(); // re-fetch the thumbnail now that a custom photo exists
    }

    setFormBusy(formEls, false, 'Toevoegen');
  }

  async function saveEdit(id, { url, title, note, person, photoFile }, formEls) {
    setFormBusy(formEls, true, 'Opslaan…');

    const ok = await patchGift(id, { url: url.trim(), title: title.trim(), note: note.trim(), person });

    if (ok && photoFile) {
      await uploadGiftPhoto(id, photoFile);
      render();
    }

    setFormBusy(formEls, false, 'Toevoegen');
    return ok;
  }

  function setFormBusy(formEls, busy, label) {
    formEls.submitBtn.disabled = busy;
    formEls.submitBtn.textContent = label;
  }

  function deleteGift(id) {
    if (editingId === id) exitEditMode(columnEls[gifts.find((g) => g.id === id)?.person] || columnEls.a);
    gifts = gifts.filter((gift) => gift.id !== id);
    render();
    saveGifts();
  }

  // ---- Edit mode -----------------------------------------------------
  // Reuses each column's existing add-form: swapping its fields to the
  // gift's current values, changing the submit button's label, and
  // remembering `editingId` so the submit handler below knows to PATCH
  // instead of add. Only one edit can be open at once.

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
    const photoInput = qs('.gf-add-photo', form);
    const photoFilenameEl = qs('.gf-add-photo-filename', form);
    const errorEl = form.nextElementSibling; // .gf-add-error, right after the form
    const submitBtn = qs('button[type="submit"]', form);
    const cancelBtn = qs('.gf-edit-cancel', form);

    // Shows the chosen file's name next to the custom "Kies bestand"
    // button (replaces the browser's native, hidden filename text —
    // see .gf-add-photo-filename in gifts.css).
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

      const photoFile = photoInput?.files?.[0] || null;
      if (photoFile && photoFile.size > MAX_UPLOAD_BYTES) {
        errorEl.textContent = `Foto is te groot (max ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB).`;
        return;
      }

      const payload = { url: urlValue, title: titleInput.value, note: noteInput.value, photoFile, person };

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
    }
  });

  // ---- Polling (picks up gifts added on the other person's device) ----

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      // Also skip while an edit form is open, so we never blow away
      // in-progress form input with a fresh render from the poll.
      if (!saveInFlight && !editingId) loadGifts({ silent: true });
    }, POLL_INTERVAL_MS);
  }

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

  // ---- Initial load --------------------------------------------------

  loadGifts();
  startPolling();
}
