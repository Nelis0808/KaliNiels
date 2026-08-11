// =================================================================
// CLOTHING RATINGS (clothing.html)
// -----------------------------------------------------------------
// Two synced columns (Kalina left = person "b", Niels right =
// person "a" — same convention as gifts.js/todo.js/snack-rating.js).
// Each entry: a name, an optional link, a manually-typed size, an
// optional photo, a 0-5 star rating, and an optional description.
// All editable after the fact — each column's add-form doubles as
// its edit-form in place (see enterEditMode/exitEditMode), exactly
// like snack-rating.js.
//
// This module is a near-duplicate of snack-rating.js on purpose —
// same sync model, same card grid, same star picker, same photo
// resizing — with one extra "size" field threaded through. If you
// change one, check whether the same fix applies to the other.
//
// SYNC MODEL: identical to snack-rating.js/lijstje.js/
// todo.js — talks to the clothing Cloudflare Worker
// (cloudflare/clothing/), one shared array covering BOTH columns (each item
// carries a `person` field), saved optimistically and polled every
// few seconds.
//
// PHOTOS: downscaled + JPEG-compressed client-side (resizePhoto
// below) into a data URL before being sent to the Worker at all —
// see resizePhoto's comment for why (KV value size, request size).
// =================================================================

import { siteConfig } from '../config.js';
import { qs, qsa, escapeHtml } from './utils.js';

const POLL_INTERVAL_MS = 5000;
const MAX_STARS = 5;
const MAX_ORIGINAL_UPLOAD_BYTES = 15 * 1024 * 1024; // sanity cap before we even try to resize it
const RESIZE_MAX_DIMENSION = 640;
const RESIZE_JPEG_QUALITY = 0.8;

export function initClothing() {
  const root = document.getElementById('clothingApp');
  if (!root) return; // not on this page

  const workerUrl = siteConfig.clothing?.workerUrl || '';
  const personLabels = siteConfig.clothing?.personLabels || { a: 'Niels', b: 'Kalina' };

  // True once config.js's clothing.workerUrl has been set to a real Worker URL
  function workerConfigured() {
    return workerUrl && !workerUrl.includes('YOUR-SUBDOMAIN');
  }

  const configWarning = qs('#clothingConfigWarning', root);
  if (!workerConfigured()) {
    configWarning?.classList.remove('hidden');
    root.classList.add('sl-disabled');
    return;
  }

  qsa('[data-clothing-person-label]', root).forEach((el) => {
    const person = el.dataset.clothingPersonLabel;
    if (personLabels[person]) el.textContent = personLabels[person];
  });

  let items = []; // flat, both people
  let pollTimer = null;
  let saveInFlight = false;

  const statusEl = qs('#clothingStatus', root);

  // Updates the status line, optionally styled as an error
  function setStatus(text, isError = false) {
    statusEl.textContent = text;
    statusEl.classList.toggle('sl-status-error', isError);
    statusEl.classList.remove('hidden');
  }

  // ---- Networking (identical shape to snack-rating.js) ----------

  // Fetches every item (both people) from the Worker
  async function loadItems({ silent = false } = {}) {
    if (!silent) setStatus('Laden…');
    try {
      const response = await fetch(`${workerUrl}/clothing`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      items = Array.isArray(data.items) ? data.items : [];
      renderAll();
      statusEl.classList.add('hidden');
    } catch (error) {
      console.error('Kon kleding niet laden:', error);
      if (!silent) setStatus('❌ Kon lijstje niet laden. Probeer het opnieuw.', true);
    }
  }

  // Pushes the current items array to the Worker, reloading on failure
  async function saveItems() {
    saveInFlight = true;
    try {
      const response = await fetch(`${workerUrl}/clothing`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      items = Array.isArray(data.items) ? data.items : items;
      renderAll();
    } catch (error) {
      console.error('Kon wijziging niet opslaan:', error);
      setStatus('⚠️ Wijziging niet opgeslagen (mogelijk een te grote foto?), lijstje wordt hersteld…', true);
      await loadItems({ silent: true });
    } finally {
      saveInFlight = false;
    }
  }

  // ---- Star picker (used both in the add/edit form and read-only on cards) ----

  // Renders a clickable 0-5 star picker
  function renderStarPicker(container, rating, onChange) {
    container.innerHTML = '';
    container.dataset.rating = String(rating);
    const readOnly = !onChange;
    for (let i = 1; i <= MAX_STARS; i++) {
      const filled = i <= rating;
      if (readOnly) {
        const span = document.createElement('span');
        span.className = 'snack-star' + (filled ? ' snack-star-filled' : '');
        span.textContent = filled ? '★' : '☆';
        span.setAttribute('aria-hidden', 'true');
        container.appendChild(span);
      } else {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'snack-star snack-star-button' + (filled ? ' snack-star-filled' : '');
        btn.textContent = filled ? '★' : '☆';
        btn.setAttribute('role', 'radio');
        btn.setAttribute('aria-checked', String(filled && i === rating));
        btn.setAttribute('aria-label', `${i} van de ${MAX_STARS} sterren`);
        btn.addEventListener('click', () => {
          // Clicking the star that currently sets the rating again
          // resets to 0 — the only way to get back down to "0
          // sterren" with a click-based picker.
          const current = Number(container.dataset.rating) || 0;
          const next = current === i ? 0 : i;
          onChange(next);
          renderStarPicker(container, next, onChange);
        });
        container.appendChild(btn);
      }
    }
    if (readOnly) container.setAttribute('aria-label', `${rating} van de ${MAX_STARS} sterren`);
  }

  // ---- Photo resize (File -> compressed JPEG data URL) ---------------
  // A raw phone photo can be several MB; storing that directly in the
  // shared KV list (which every save PUTs in full, and every poll
  // GETs in full) would be slow and wasteful for both of you. Downscale
  // to a max 640px-wide JPEG first — a few dozen KB instead.
  // Downscales and JPEG-compresses an uploaded photo into a data URL client-side
  function resizePhoto(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Kon bestand niet lezen'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Kon geen geldige afbeelding lezen'));
        img.onload = () => {
          const scale = Math.min(1, RESIZE_MAX_DIMENSION / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', RESIZE_JPEG_QUALITY));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // Escapes a value for safe use inside a CSS attribute selector
  function cssEscape(value) {
    return window.CSS && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
  }

  // ---- Rendering -------------------------------------------------

  // Renders one clothing card's HTML
  function renderCard(item) {
    const hasUrl = Boolean(item.url);
    const nameHtml = escapeHtml(item.name);
    const sizeHtml = item.size ? escapeHtml(item.size) : '';
    return `
      <li class="snack-card" data-id="${escapeHtml(item.id)}">
        <div class="snack-card-image ${item.photo ? '' : 'snack-card-fallback'}">
          ${item.photo ? `<img src="${item.photo}" alt="" loading="lazy">` : '<span aria-hidden="true">👕</span>'}
        </div>
        <div class="snack-card-body">
          <div class="snack-card-title-row">
            ${hasUrl
              ? `<a class="snack-card-name" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${nameHtml}</a>`
              : `<span class="snack-card-name">${nameHtml}</span>`}
          </div>
          <div class="clothing-card-meta">
            <div class="snack-card-stars" data-stars></div>
            ${sizeHtml ? `<span class="clothing-card-size">Maat ${sizeHtml}</span>` : ''}
          </div>
          ${item.description ? `<p class="snack-card-desc">${escapeHtml(item.description)}</p>` : ''}
        </div>
        <div class="snack-card-actions">
          <button type="button" class="snack-edit" aria-label="${nameHtml} bewerken">✏️</button>
          <button type="button" class="snack-delete" aria-label="${nameHtml} verwijderen">✕</button>
        </div>
      </li>
    `;
  }

  const columns = ['a', 'b'].map((person) => setupColumn(person));

  // Re-renders both columns
  function renderAll() {
    columns.forEach((column) => column.render());
  }

  // Wires up one person's column: add/edit form, rendering
  function setupColumn(person) {
    const listEl = qs(`#clothingList${person.toUpperCase()}`, root);
    const emptyStateEl = qs(`#clothingEmpty${person.toUpperCase()}`, root);
    const form = qs(`#clothingAddForm${person.toUpperCase()}`, root);
    if (!listEl || !form) return { render() {} };

    const nameInput = qs('.clothing-add-name', form);
    const urlInput = qs('.clothing-add-url', form);
    const sizeInput = qs('.clothing-add-size', form);
    const descInput = qs('.clothing-add-desc', form);
    const starPicker = qs('.snack-star-picker', form);
    const photoInput = qs('.clothing-add-photo', form);
    const photoFilenameEl = qs('.snack-add-photo-filename', form);
    const errorEl = qs('.clothing-add-error', form);
    const submitBtn = qs('button[type="submit"]', form);
    const cancelBtn = qs('.clothing-edit-cancel', form);

    let editingId = null;
    let formRating = 0;

    // This person's items, in their stored order
    function personItems() {
      return items.filter((it) => it.person === person);
    }

    // Resets the "chosen file" label back to its placeholder text
    function resetPhotoFilename() {
      photoFilenameEl.textContent = photoFilenameEl.dataset.defaultText || 'Kies bestand';
    }

    photoInput.addEventListener('change', () => {
      photoFilenameEl.textContent = photoInput.files?.[0]?.name || photoFilenameEl.dataset.defaultText || 'Kies bestand';
    });

    // Redraws this column's card list from personItems()
    function render() {
      const list = personItems();

      if (list.length === 0) {
        listEl.innerHTML = '';
        emptyStateEl?.classList.remove('hidden');
        return;
      }
      emptyStateEl?.classList.add('hidden');

      // Highest-rated first, most-recently-added breaks ties.
      const sorted = [...list].sort(
        (a, b) => (b.rating || 0) - (a.rating || 0) || (b.addedAt || 0) - (a.addedAt || 0)
      );
      listEl.innerHTML = sorted.map(renderCard).join('');

      sorted.forEach((item) => {
        const starsContainer = listEl.querySelector(`.snack-card[data-id="${cssEscape(item.id)}"] [data-stars]`);
        if (starsContainer) renderStarPicker(starsContainer, item.rating || 0);
      });
    }

    // ---- Mutations for this column ------------------------------------

    // Adds a new item (optimistically) and saves
    async function addItem({ name, url, size, description, rating, photoFile }) {
      let photo = null;
      if (photoFile) {
        photo = await resizePhoto(photoFile).catch((error) => {
          console.error('Kon foto niet verwerken:', error);
          return null;
        });
      }
      items = [
        ...items,
        { id: crypto.randomUUID(), person, name, url, size, description, rating, photo, addedAt: Date.now() },
      ];
      renderAll();
      saveItems();
    }

    // Saves an edited item (optimistically) and saves
    async function saveEdit(id, { name, url, size, description, rating, photoFile }) {
      let photo = items.find((it) => it.id === id)?.photo || null;
      if (photoFile) {
        photo = await resizePhoto(photoFile).catch((error) => {
          console.error('Kon foto niet verwerken:', error);
          return photo;
        });
      }
      items = items.map((it) => (it.id === id ? { ...it, name, url, size, description, rating, photo } : it));
      renderAll();
      saveItems();
    }

    // Removes an item (optimistically) and saves
    function deleteItem(id) {
      items = items.filter((it) => it.id !== id);
      renderAll();
      saveItems();
    }

    // Pre-fills the column's form with an item's data and switches it into edit mode
    function enterEditMode(item) {
      editingId = item.id;
      nameInput.value = item.name;
      urlInput.value = item.url || '';
      sizeInput.value = item.size || '';
      descInput.value = item.description || '';
      formRating = item.rating || 0;
      renderStarPicker(starPicker, formRating, (value) => { formRating = value; });
      resetPhotoFilename();
      submitBtn.textContent = 'Opslaan';
      cancelBtn.classList.remove('hidden');
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      nameInput.focus();
    }

    // Restores the column's form back to its normal "add" state
    function exitEditMode() {
      editingId = null;
      form.reset();
      formRating = 0;
      renderStarPicker(starPicker, formRating, (value) => { formRating = value; });
      resetPhotoFilename();
      submitBtn.textContent = 'Toevoegen';
      cancelBtn.classList.add('hidden');
    }

    // ---- Wiring for this column --------------------------------------

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (errorEl) errorEl.textContent = "Er is iets niet goed gegaan.";

      const name = nameInput.value.trim();
      if (!name) {
        if (errorEl) errorEl.textContent = 'Vul een naam in voor het kledingstuk.';
        return;
      }

      const urlValue = urlInput.value.trim();
      if (urlValue) {
        try {
          // eslint-disable-next-line no-new
          new URL(urlValue);
        } catch {
          if (errorEl) errorEl.textContent = 'Dat lijkt geen geldige link.';
          return;
        }
      }

      const photoFile = photoInput.files?.[0] || null;
      if (photoFile && photoFile.size > MAX_ORIGINAL_UPLOAD_BYTES) {
        if (errorEl) errorEl.textContent = `Foto is te groot (max ${Math.floor(MAX_ORIGINAL_UPLOAD_BYTES / 1024 / 1024)}MB).`;
        return;
      }

      submitBtn.disabled = true;
      const payload = {
        name,
        url: urlValue,
        size: sizeInput.value.trim(),
        description: descInput.value.trim(),
        rating: formRating,
        photoFile,
      };

      if (editingId) {
        await saveEdit(editingId, payload);
        exitEditMode();
      } else {
        await addItem(payload);
        form.reset();
        formRating = 0;
        renderStarPicker(starPicker, formRating, (value) => { formRating = value; });
        resetPhotoFilename();
        nameInput.focus();
      }
      submitBtn.disabled = false;
    });

    cancelBtn.addEventListener('click', exitEditMode);

    listEl.addEventListener('click', (event) => {
      const deleteBtn = event.target.closest('.snack-delete');
      if (deleteBtn) {
        const id = deleteBtn.closest('.snack-card')?.dataset.id;
        if (id) deleteItem(id);
        return;
      }
      const editBtn = event.target.closest('.snack-edit');
      if (editBtn) {
        const id = editBtn.closest('.snack-card')?.dataset.id;
        const item = items.find((it) => it.id === id);
        if (item) enterEditMode(item);
      }
    });

    renderStarPicker(starPicker, formRating, (value) => { formRating = value; });
    return { render };
  }

  // ---- Polling (picks up changes made on the other person's device) ----

  // Starts the periodic background refresh, pausing while the tab is hidden
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      if (!saveInFlight) loadItems({ silent: true });
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
      loadItems({ silent: true });
      startPolling();
    }
  });

  // ---- Initial load --------------------------------------------------

  loadItems();
  startPolling();
}
