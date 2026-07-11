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
// IMAGES: for each gift, the browser never fetches the linked shop's
// image directly (that'd hit CORS walls constantly). Instead it asks
// the Worker for `${workerUrl}/gifts/image?id=<id>&url=<link>`, which
// returns a custom photo if you uploaded one to the R2 bucket, or
// tries to scrape the link's og:image, or 404s (shown as a plain
// gift-box icon).
//
// SYNC MODEL: same optimistic-update + polling approach as
// boodschappenlijst.js — see its top comment for the reasoning.
// =================================================================

import { siteConfig } from '../config.js';
import { qs, qsa, escapeHtml } from './utils.js';

const POLL_INTERVAL_MS = 8000;
const PERSONS = ['b', 'a']; // b (Kalina) left, a (Niels) right — matches the markup order

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

  // Tracks object URLs handed out by loadGiftImage() so they can be
  // revoked on the next render instead of leaking memory forever.
  let activeObjectUrls = [];

  // Errors are logged to the console (see loadGifts/saveGifts below)
  // rather than shown in the UI — there's no status line on this
  // page anymore.

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
        .map(
          (gift) => `
            <li class="gf-card" data-id="${escapeHtml(gift.id)}">
              <a class="gf-card-link" href="${escapeHtml(gift.url)}" target="_blank" rel="noopener noreferrer">
                <div class="gf-card-image gf-card-loading" data-gift-image aria-hidden="true">
                  <span class="gf-card-fallback">🎁</span>
                </div>
                <div class="gf-card-body">
                  <span class="gf-card-title">${escapeHtml(gift.title)}</span>
                  ${gift.note ? `<span class="gf-card-note">${escapeHtml(gift.note)}</span>` : ''}
                </div>
              </a>
              <button type="button" class="gf-delete" aria-label="${escapeHtml(gift.title)} verwijderen">✕</button>
            </li>
          `
        )
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

  async function addGift(person, { url, title, note }, formEls) {
    const trimmedUrl = url.trim();
    let trimmedTitle = title.trim();

    if (!trimmedTitle) {
      formEls.submitBtn.disabled = true;
      formEls.submitBtn.textContent = 'Bezig…';
      trimmedTitle = (await fetchTitleFor(trimmedUrl)) || trimmedUrl;
      formEls.submitBtn.disabled = false;
      formEls.submitBtn.textContent = 'Toevoegen';
    }

    gifts = [
      ...gifts,
      {
        id: crypto.randomUUID(),
        person,
        title: trimmedTitle,
        url: trimmedUrl,
        note: note.trim(),
        addedAt: Date.now(),
      },
    ];
    render();
    saveGifts();
  }

  function deleteGift(id) {
    gifts = gifts.filter((gift) => gift.id !== id);
    render();
    saveGifts();
  }

  // ---- Wiring ------------------------------------------------------

  PERSONS.forEach((person) => {
    const { form } = columnEls[person];
    const urlInput = qs('.gf-add-url', form);
    const titleInput = qs('.gf-add-title', form);
    const noteInput = qs('.gf-add-note', form);
    const errorEl = form.nextElementSibling; // .gf-add-error, right after the form
    const submitBtn = qs('button[type="submit"]', form);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      errorEl.textContent = '';

      const urlValue = urlInput.value;
      if (!urlValue.trim()) {
        errorEl.textContent = 'Vul eerst een link in.';
        return;
      }
      try {
        // eslint-disable-next-line no-new
        new URL(urlValue.trim());
      } catch {
        errorEl.textContent = 'Dat lijkt geen geldige link.';
        return;
      }

      addGift(
        person,
        { url: urlValue, title: titleInput.value, note: noteInput.value },
        { submitBtn }
      );
      form.reset();
      urlInput.focus();
    });
  });

  columnsEl.addEventListener('click', (event) => {
    const deleteBtn = event.target.closest('.gf-delete');
    if (!deleteBtn) return;
    const id = deleteBtn.closest('.gf-card')?.dataset.id;
    if (id) deleteGift(id);
  });

  // ---- Polling (picks up gifts added on the other person's device) ----

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      if (!saveInFlight) loadGifts({ silent: true });
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
      loadGifts({ silent: true });
      startPolling();
    }
  });

  // ---- Initial load --------------------------------------------------

  loadGifts();
  startPolling();
}
