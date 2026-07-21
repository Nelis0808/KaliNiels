// =================================================================
// SNACK RATINGS (snack-rating.html)
// -----------------------------------------------------------------
// Two synced columns (Kalina left = person "b", Niels right =
// person "a" — same convention as gifts.js/todo.js). Each entry: a
// name, an optional link, an optional photo, a 0-5 star rating, and
// an optional description. All editable after the fact — each
// column's add-form doubles as its edit-form in place (see
// enterEditMode/exitEditMode), exactly like gifts.js.
//
// SYNC MODEL: identical to boodschappenlijst.js/todo.js — talks to
// the snacks Cloudflare Worker (cloudflare/cloudflare-worker-snacks +
// STAPPENPLAN-TODO-SNACKS.md), one shared array covering BOTH
// columns (each item carries a `person` field), saved optimistically
// and polled every few seconds.
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

export function initSnackRating() {
  const root = document.getElementById('snackApp');
  if (!root) return; // not on this page

  const workerUrl = siteConfig.snackRatings?.workerUrl || '';
  const personLabels = siteConfig.snackRatings?.personLabels || { a: 'Niels', b: 'Kalina' };

  function workerConfigured() {
    return workerUrl && !workerUrl.includes('YOUR-SUBDOMAIN');
  }

  const configWarning = qs('#snackConfigWarning', root);
  if (!workerConfigured()) {
    configWarning?.classList.remove('hidden');
    root.classList.add('sl-disabled');
    return;
  }

  qsa('[data-snack-person-label]', root).forEach((el) => {
    const person = el.dataset.snackPersonLabel;
    if (personLabels[person]) el.textContent = personLabels[person];
  });

  let snacks = []; // flat, both people
  let pollTimer = null;
  let saveInFlight = false;

  const statusEl = qs('#snackStatus', root);

  function setStatus(text, isError = false) {
    statusEl.textContent = text;
    statusEl.classList.toggle('sl-status-error', isError);
    statusEl.classList.remove('hidden');
  }

  // ---- Networking (identical shape to boodschappenlijst.js) ----------

  async function loadSnacks({ silent = false } = {}) {
    if (!silent) setStatus('Laden…');
    try {
      const response = await fetch(`${workerUrl}/snacks`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      snacks = Array.isArray(data.items) ? data.items : [];
      renderAll();
      statusEl.classList.add('hidden');
    } catch (error) {
      console.error('Kon snack-ratings niet laden:', error);
      if (!silent) setStatus('❌ Kon lijstje niet laden. Probeer het opnieuw.', true);
    }
  }

  async function saveSnacks() {
    saveInFlight = true;
    try {
      const response = await fetch(`${workerUrl}/snacks`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: snacks }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      snacks = Array.isArray(data.items) ? data.items : snacks;
      renderAll();
    } catch (error) {
      console.error('Kon wijziging niet opslaan:', error);
      setStatus('⚠️ Wijziging niet opgeslagen (mogelijk een te grote foto?), lijstje wordt hersteld…', true);
      await loadSnacks({ silent: true });
    } finally {
      saveInFlight = false;
    }
  }

  // ---- Star picker (used both in the add/edit form and read-only on cards) ----

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

  function cssEscape(value) {
    return window.CSS && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
  }

  // ---- Rendering -------------------------------------------------

  function renderCard(snack) {
    const hasUrl = Boolean(snack.url);
    const nameHtml = escapeHtml(snack.name);
    return `
      <li class="snack-card" data-id="${escapeHtml(snack.id)}">
        <div class="snack-card-image ${snack.photo ? '' : 'snack-card-fallback'}">
          ${snack.photo ? `<img src="${snack.photo}" alt="" loading="lazy">` : '<span aria-hidden="true">🍿</span>'}
        </div>
        <div class="snack-card-body">
          <div class="snack-card-title-row">
            ${hasUrl
              ? `<a class="snack-card-name" href="${escapeHtml(snack.url)}" target="_blank" rel="noopener noreferrer">${nameHtml}</a>`
              : `<span class="snack-card-name">${nameHtml}</span>`}
          </div>
          <div class="snack-card-stars" data-stars></div>
          ${snack.description ? `<p class="snack-card-desc">${escapeHtml(snack.description)}</p>` : ''}
        </div>
        <div class="snack-card-actions">
          <button type="button" class="snack-edit" aria-label="${nameHtml} bewerken">✏️</button>
          <button type="button" class="snack-delete" aria-label="${nameHtml} verwijderen">✕</button>
        </div>
      </li>
    `;
  }

  const columns = ['a', 'b'].map((person) => setupColumn(person));

  function renderAll() {
    columns.forEach((column) => column.render());
  }

  function setupColumn(person) {
    const listEl = qs(`#snackList${person.toUpperCase()}`, root);
    const emptyStateEl = qs(`#snackEmpty${person.toUpperCase()}`, root);
    const form = qs(`#snackAddForm${person.toUpperCase()}`, root);
    if (!listEl || !form) return { render() {} };

    const nameInput = qs('.snack-add-name', form);
    const urlInput = qs('.snack-add-url', form);
    const descInput = qs('.snack-add-desc', form);
    const starPicker = qs('.snack-star-picker', form);
    const photoInput = qs('.snack-add-photo', form);
    const photoFilenameEl = qs('.snack-add-photo-filename', form);
    const errorEl = qs('.snack-add-error', form);
    const submitBtn = qs('button[type="submit"]', form);
    const cancelBtn = qs('.snack-edit-cancel', form);

    let editingId = null;
    let formRating = 0;

    function personSnacks() {
      return snacks.filter((s) => s.person === person);
    }

    function resetPhotoFilename() {
      photoFilenameEl.textContent = photoFilenameEl.dataset.defaultText || 'Kies bestand';
    }

    photoInput.addEventListener('change', () => {
      photoFilenameEl.textContent = photoInput.files?.[0]?.name || photoFilenameEl.dataset.defaultText || 'Kies bestand';
    });

    function render() {
      const list = personSnacks();

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

      sorted.forEach((snack) => {
        const starsContainer = listEl.querySelector(`.snack-card[data-id="${cssEscape(snack.id)}"] [data-stars]`);
        if (starsContainer) renderStarPicker(starsContainer, snack.rating || 0);
      });
    }

    // ---- Mutations for this column ------------------------------------

    async function addSnack({ name, url, description, rating, photoFile }) {
      let photo = null;
      if (photoFile) {
        photo = await resizePhoto(photoFile).catch((error) => {
          console.error('Kon foto niet verwerken:', error);
          return null;
        });
      }
      snacks = [
        ...snacks,
        { id: crypto.randomUUID(), person, name, url, description, rating, photo, addedAt: Date.now() },
      ];
      renderAll();
      saveSnacks();
    }

    async function saveEdit(id, { name, url, description, rating, photoFile }) {
      let photo = snacks.find((s) => s.id === id)?.photo || null;
      if (photoFile) {
        photo = await resizePhoto(photoFile).catch((error) => {
          console.error('Kon foto niet verwerken:', error);
          return photo;
        });
      }
      snacks = snacks.map((s) => (s.id === id ? { ...s, name, url, description, rating, photo } : s));
      renderAll();
      saveSnacks();
    }

    function deleteSnack(id) {
      snacks = snacks.filter((s) => s.id !== id);
      renderAll();
      saveSnacks();
    }

    function enterEditMode(snack) {
      editingId = snack.id;
      nameInput.value = snack.name;
      urlInput.value = snack.url || '';
      descInput.value = snack.description || '';
      formRating = snack.rating || 0;
      renderStarPicker(starPicker, formRating, (value) => { formRating = value; });
      resetPhotoFilename();
      submitBtn.textContent = 'Opslaan';
      cancelBtn.classList.remove('hidden');
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      nameInput.focus();
    }

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
        if (errorEl) errorEl.textContent = 'Vul een naam in voor de snack.';
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
      const payload = { name, url: urlValue, description: descInput.value.trim(), rating: formRating, photoFile };

      if (editingId) {
        await saveEdit(editingId, payload);
        exitEditMode();
      } else {
        await addSnack(payload);
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
        if (id) deleteSnack(id);
        return;
      }
      const editBtn = event.target.closest('.snack-edit');
      if (editBtn) {
        const id = editBtn.closest('.snack-card')?.dataset.id;
        const snack = snacks.find((s) => s.id === id);
        if (snack) enterEditMode(snack);
      }
    });

    renderStarPicker(starPicker, formRating, (value) => { formRating = value; });
    return { render };
  }

  // ---- Polling (picks up changes made on the other person's device) ----

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      if (!saveInFlight) loadSnacks({ silent: true });
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
      loadSnacks({ silent: true });
      startPolling();
    }
  });

  // ---- Initial load --------------------------------------------------

  loadSnacks();
  startPolling();
}
