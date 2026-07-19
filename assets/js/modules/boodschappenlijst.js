// =================================================================
// BOODSCHAPPENLIJSTJE (boodschappenlijst.html)
// -----------------------------------------------------------------
// Talks ONLY to the boodschappenlijst Cloudflare Worker (see
// /cloudflare/cloudflare-worker-boodschappen + STAPPENPLAN-BOODSCHAPPEN.md),
// which stores the shared list in Cloudflare KV. No login — see the
// worker's top comment for why that's fine here.
//
// SYNC MODEL: every local change (add/check/delete) is sent to the
// worker immediately (optimistic UI — the change shows instantly,
// and rolls back with an error message if the save fails). On top
// of that, the page polls the worker every few seconds so a change
// your girlfriend makes on her phone shows up here soon after too,
// without needing a refresh. Polling pauses while the tab is hidden
// (no point burning requests on a background tab) and resumes, with
// an immediate refresh, the moment it's visible again.
//
// Deliberately NOT real-time (no websockets) — for a two-person
// grocery list, "soon" (a few seconds) is plenty, and polling is a
// lot less to deploy/maintain than a persistent connection.
// =================================================================

import { siteConfig } from '../config.js';
import { qs, escapeHtml } from './utils.js';

const POLL_INTERVAL_MS = 5000;

export function initBoodschappenlijst() {
  const root = document.getElementById('shoppingListApp');
  if (!root) return; // not on this page

  const workerUrl = siteConfig.shoppingList?.workerUrl || '';

  const listEl      = qs('#slItems', root);
  const emptyStateEl = qs('#slEmptyState', root);
  const statusEl     = qs('#slStatus', root);
  const addForm      = qs('#slAddForm', root);
  const addInput      = qs('#slAddInput', root);
  const addError       = qs('#slAddError', root);
  const configWarning  = qs('#slConfigWarning', root);

  function workerConfigured() {
    return workerUrl && !workerUrl.includes('YOUR-SUBDOMAIN');
  }

  if (!workerConfigured()) {
    configWarning.classList.remove('hidden');
    root.classList.add('sl-disabled');
    return;
  }

  // Local copy of the list. `items` is the source of truth for
  // rendering; every mutation updates it optimistically, then syncs.
  let items = [];
  let pollTimer = null;
  let saveInFlight = false; // avoids overlapping PUTs stomping on each other

  function setStatus(text, isError = false) {
    statusEl.textContent = text;
    statusEl.classList.toggle('sl-status-error', isError);
  }

  function render() {
    const checkedCount = items.filter((item) => item.checked).length;

    if (items.length === 0) {
      listEl.innerHTML = '';
      emptyStateEl.classList.remove('hidden');
      setStatus('Lijstje is leeg.');
      return;
    }

    emptyStateEl.classList.add('hidden');
    setStatus(`${checkedCount} van ${items.length} afgevinkt`);

    listEl.innerHTML = items
      .map(
        (item) => `
          <li class="sl-item ${item.checked ? 'sl-item-checked' : ''}" data-id="${escapeHtml(item.id)}">
            <span class="sl-drag-handle" role="button" tabindex="0" aria-label="${escapeHtml(item.text)} verslepen om te herordenen, of pijltje omhoog/omlaag"></span>
            <label class="sl-item-label">
              <input type="checkbox" class="sl-checkbox" ${item.checked ? 'checked' : ''} aria-label="${escapeHtml(item.text)} afvinken">
              <span class="sl-item-text">${escapeHtml(item.text)}</span>
            </label>
            <button type="button" class="sl-delete" aria-label="${escapeHtml(item.text)} verwijderen">✕</button>
          </li>
        `
      )
      .join('');
  }

  // ---- Networking ------------------------------------------------

  async function loadList({ silent = false } = {}) {
    if (!silent) setStatus('Laden…');
    try {
      const response = await fetch(`${workerUrl}/list`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      items = Array.isArray(data.items) ? data.items : [];
      render();
    } catch (error) {
      console.error('Kon boodschappenlijst niet laden:', error);
      if (!silent) setStatus('❌ Kon lijstje niet laden. Probeer het opnieuw.', true);
    }
  }

  // Pushes the current `items` to the worker. Optimistic — the
  // caller already updated `items`/the DOM before calling this; on
  // failure we reload the real state from the server so the UI
  // never stays out of sync with what's actually saved.
  async function saveList() {
    saveInFlight = true;
    try {
      const response = await fetch(`${workerUrl}/list`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      items = Array.isArray(data.items) ? data.items : items;
      render();
    } catch (error) {
      console.error('Kon wijziging niet opslaan:', error);
      setStatus('⚠️ Wijziging niet opgeslagen, lijstje wordt hersteld…', true);
      await loadList({ silent: true });
    } finally {
      saveInFlight = false;
    }
  }

  // ---- Mutations ---------------------------------------------------

  function addItem(text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    items = [...items, { id: crypto.randomUUID(), text: trimmed, checked: false }];
    render();
    saveList();
  }

  function toggleItem(id) {
    items = items.map((item) => (item.id === id ? { ...item, checked: !item.checked } : item));
    render();
    saveList();
  }

  function deleteItem(id) {
    items = items.filter((item) => item.id !== id);
    render();
    saveList();
  }

  /** Moves the item with `id` to `targetIndex` in the list, then persists the new order. */
  function reorderItem(id, targetIndex) {
    const fromIndex = items.findIndex((item) => item.id === id);
    if (fromIndex === -1) return;
    const clampedTarget = Math.max(0, Math.min(targetIndex, items.length - 1));
    if (clampedTarget === fromIndex) return;

    const reordered = [...items];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(clampedTarget, 0, moved);
    items = reordered;
    render();
    saveList();
  }

  // ---- Wiring ------------------------------------------------------

  addForm.addEventListener('submit', (event) => {
    event.preventDefault();
    addError.textContent = '';

    const value = addInput.value;
    if (!value.trim()) {
      addError.textContent = 'Vul eerst iets in.';
      return;
    }

    addItem(value);
    addInput.value = '';
    addInput.focus();
  });

  listEl.addEventListener('click', (event) => {
    const deleteBtn = event.target.closest('.sl-delete');
    if (deleteBtn) {
      const id = deleteBtn.closest('.sl-item')?.dataset.id;
      if (id) deleteItem(id);
    }
  });

  listEl.addEventListener('change', (event) => {
    if (event.target.classList.contains('sl-checkbox')) {
      const id = event.target.closest('.sl-item')?.dataset.id;
      if (id) toggleItem(id);
    }
  });

  // ---- Drag to reorder ----------------------------------------------
  // Pointer Events (not native HTML5 drag-and-drop, which touch
  // browsers don't reliably support) so the same code handles mouse
  // AND touch. Only the small grip handle (.sl-drag-handle) starts a
  // drag — the rest of the row stays dedicated to check/delete, so a
  // normal tap never accidentally triggers a reorder.
  //
  // While dragging, the item currently under the pointer is
  // physically moved in the DOM (no ghost element/animation) — as
  // soon as the pointer crosses another row's vertical midpoint, the
  // dragged row swaps to that position. Simple and reliable rather
  // than pixel-smooth, which is plenty for a short household list.
  let draggingLi = null;
  let dragPointerId = null;

  function itemElements() {
    return Array.from(listEl.querySelectorAll('.sl-item'));
  }

  function moveDraggedRowTo(clientY) {
    const siblings = itemElements().filter((el) => el !== draggingLi);
    for (const sibling of siblings) {
      const rect = sibling.getBoundingClientRect();
      const middle = rect.top + rect.height / 2;
      if (clientY < middle) {
        if (sibling.previousElementSibling !== draggingLi) {
          listEl.insertBefore(draggingLi, sibling);
        }
        return;
      }
    }
    // Pointer is below every other row — send it to the end.
    if (listEl.lastElementChild !== draggingLi) {
      listEl.appendChild(draggingLi);
    }
  }

  function endDrag() {
    if (!draggingLi) return;
    draggingLi.classList.remove('sl-item-dragging');
    listEl.classList.remove('sl-list-reordering');

    // The DOM order is already correct (we moved the row live during
    // the drag) — read it back into `items` and persist that order.
    const newOrderIds = itemElements().map((el) => el.dataset.id);
    items = newOrderIds
      .map((id) => items.find((item) => item.id === id))
      .filter(Boolean);
    saveList();

    draggingLi = null;
    dragPointerId = null;
  }

  listEl.addEventListener('pointerdown', (event) => {
    const handle = event.target.closest('.sl-drag-handle');
    if (!handle) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    draggingLi = handle.closest('.sl-item');
    if (!draggingLi) return;
    dragPointerId = event.pointerId;
    draggingLi.classList.add('sl-item-dragging');
    listEl.classList.add('sl-list-reordering');
    handle.setPointerCapture(event.pointerId);
    event.preventDefault(); // stop touch-scroll/text-selection while dragging
  });

  listEl.addEventListener('pointermove', (event) => {
    if (!draggingLi || event.pointerId !== dragPointerId) return;
    moveDraggedRowTo(event.clientY);
  });

  listEl.addEventListener('pointerup', (event) => {
    if (event.pointerId !== dragPointerId) return;
    endDrag();
  });

  listEl.addEventListener('pointercancel', (event) => {
    if (event.pointerId !== dragPointerId) return;
    endDrag();
  });

  // ---- Keyboard fallback (drag handles aren't reachable by mouse-less
  // input) — focus a handle, then ArrowUp/ArrowDown moves that item. ----
  listEl.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    const handle = event.target.closest('.sl-drag-handle');
    if (!handle) return;
    event.preventDefault();

    const id = handle.closest('.sl-item')?.dataset.id;
    if (!id) return;
    const currentIndex = items.findIndex((item) => item.id === id);
    if (currentIndex === -1) return;

    reorderItem(id, currentIndex + (event.key === 'ArrowUp' ? -1 : 1));
    // render() just rebuilt the list, so refocus the (new) handle for this item.
    listEl.querySelector(`.sl-item[data-id="${id}"] .sl-drag-handle`)?.focus();
  });

  // ---- Polling (picks up changes made on the other person's device) ----

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      // Skip a tick if a save is still in flight, so we never
      // overwrite `items` with stale server data right after a
      // change we just made ourselves.
      if (!saveInFlight) loadList({ silent: true });
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
      loadList({ silent: true });
      startPolling();
    }
  });

  // ---- Initial load --------------------------------------------------

  loadList();
  startPolling();
}
