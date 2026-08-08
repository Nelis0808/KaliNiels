// =================================================================
// LIJSTJE (lijstje.html)
// -----------------------------------------------------------------
// Talks ONLY to the lijstje Cloudflare Worker (see
// /cloudflare/cloudflare-worker-lijstje + STAPPENPLAN-LIJSTJE.md),
// which stores one or more named lists (categories) in Cloudflare
// KV. No login — see the worker's top comment for why that's fine
// here.
//
// MULTIPLE LISTS: the dropdown at the top (#slListSwitcher) lets you
// switch between categories (e.g. "Boodschappen", "Klussen") — each
// is its own list on the server, addressed by an id. "+ Nieuwe lijst
// toevoegen" always sits at the bottom of that dropdown and opens a
// small inline form to create another one. The last list you had
// open is remembered per-browser (localStorage), so this device
// reopens the same one next time.
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
const ACTIVE_LIST_STORAGE_KEY = 'lijstje-active-list-id';

export function initLijstje() {
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

  const switcherEl   = qs('#slListSwitcher', root);
  const switcherTrigger = qs('#slListTrigger', root);
  const switcherLabel   = qs('#slListTriggerLabel', root);
  const switcherMenu    = qs('#slListMenu', root);

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

  // Categories (separate lists). `lists` mirrors the server's index;
  // `activeListId` is whichever one is currently shown.
  let lists = [];
  let activeListId = localStorage.getItem(ACTIVE_LIST_STORAGE_KEY) || null;

  function setStatus(text, isError = false) {
    statusEl.textContent = text;
    statusEl.classList.toggle('sl-status-error', isError);
    statusEl.classList.remove('hidden');
  }

  function render() {
    const checkedCount = items.filter((item) => item.checked).length;

    if (items.length === 0) {
      listEl.innerHTML = '';
      emptyStateEl.classList.remove('hidden');
      statusEl.classList.add('hidden');
      return;
    }

    emptyStateEl.classList.add('hidden');

    // Only show the "x van y afgevinkt" line once everything on the
    // list has been crossed off, so it's a completion message
    // ("klaar!") rather than a running counter, but still hide it
    // entirely if nothing has been checked yet.
    const allChecked = checkedCount > 0 && checkedCount === items.length;
    if (allChecked) {
      setStatus(`${checkedCount} van ${items.length} afgevinkt`);
    } else {
      statusEl.classList.add('hidden');
    }

    listEl.innerHTML = items
      .map(
        (item) => `
          <li class="sl-item ${item.checked ? 'sl-item-checked' : ''}" data-id="${escapeHtml(item.id)}">
            <span class="sl-drag-handle" role="button" tabindex="0" aria-label="${escapeHtml(item.text)} verslepen om te herordenen (of vasthouden op de rij, of pijltje omhoog/omlaag)"></span>
            <label class="sl-item-label">
              <input type="checkbox" class="sl-checkbox" ${item.checked ? 'checked' : ''} aria-label="${escapeHtml(item.text)} afvinken">
              <span class="sl-item-text">${escapeHtml(item.text)}</span>
            </label>
            <div class="sl-item-actions">
              <button type="button" class="sl-rename" aria-label="${escapeHtml(item.text)} hernoemen">✏️</button>
              <button type="button" class="sl-delete" aria-label="${escapeHtml(item.text)} verwijderen">✕</button>
            </div>
          </li>
        `
      )
      .join('');
  }

  // ---- Networking ------------------------------------------------

  async function loadList({ silent = false } = {}) {
    if (!activeListId) return;
    if (!silent) setStatus('Laden…');
    try {
      const response = await fetch(`${workerUrl}/list?id=${encodeURIComponent(activeListId)}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      items = Array.isArray(data.items) ? data.items : [];
      render();
    } catch (error) {
      console.error('Kon lijstje niet laden:', error);
      if (!silent) setStatus('❌ Kon lijstje niet laden. Probeer het opnieuw.', true);
    }
  }

  // Pushes the current `items` to the worker. Optimistic — the
  // caller already updated `items`/the DOM before calling this; on
  // failure we reload the real state from the server so the UI
  // never stays out of sync with what's actually saved.
  async function saveList() {
    if (!activeListId) return;
    saveInFlight = true;
    try {
      const response = await fetch(`${workerUrl}/list?id=${encodeURIComponent(activeListId)}`, {
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

  // ---- Category switcher (multiple lists) ---------------------------

  function closeSwitcher() {
    switcherEl.classList.remove('open');
    switcherTrigger.setAttribute('aria-expanded', 'false');

    // Reset the "new list" inline form back to its collapsed state
    // (just the "+ Nieuwe lijst toevoegen" button) for next time it opens.
    const form = qs('#slNewListForm', switcherMenu);
    const addBtn = qs('#slNewListBtn', switcherMenu);
    if (form && addBtn) {
      form.classList.add('hidden');
      addBtn.classList.remove('hidden');
      qs('#slNewListInput', form).value = '';
    }
  }

  function toggleSwitcher() {
    const isOpen = switcherEl.classList.toggle('open');
    switcherTrigger.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) {
      const activeBtn = qs('.sl-list-menu-item.active', switcherMenu);
      (activeBtn || qs('.sl-list-menu-item', switcherMenu))?.focus();
    }
  }

  function renderSwitcher() {
    const active = lists.find((list) => list.id === activeListId);
    switcherLabel.textContent = active ? active.name : 'Lijstje';

    const listButtonsHtml = lists
      .map(
        (list) => `
          <button
            type="button"
            class="sl-list-menu-item ${list.id === activeListId ? 'active' : ''}"
            role="menuitemradio"
            aria-checked="${list.id === activeListId}"
            data-list-id="${escapeHtml(list.id)}"
          >${escapeHtml(list.name)}</button>
        `
      )
      .join('');

    switcherMenu.innerHTML = `
      ${listButtonsHtml}
      <div class="sl-list-menu-divider" role="separator"></div>
      <button type="button" id="slNewListBtn" class="sl-list-menu-item sl-list-menu-add" role="menuitem">
        ＋ Nieuwe lijst toevoegen
      </button>
      <form id="slNewListForm" class="sl-list-new-form hidden">
        <input
          type="text"
          id="slNewListInput"
          class="sl-list-new-input"
          placeholder="Naam van de lijst…"
          maxlength="60"
          aria-label="Naam van de nieuwe lijst"
        >
        <button type="submit" class="btn btn-primary btn-sm">Aanmaken</button>
      </form>
    `;
  }

  async function switchToList(listId) {
    if (listId === activeListId) {
      closeSwitcher();
      return;
    }
    activeListId = listId;
    localStorage.setItem(ACTIVE_LIST_STORAGE_KEY, listId);
    renderSwitcher();
    closeSwitcher();
    await loadList();
  }

  async function createList(name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const response = await fetch(`${workerUrl}/lists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const newList = await response.json();
      lists = [...lists, newList];
      await switchToList(newList.id);
    } catch (error) {
      console.error('Kon nieuwe lijst niet aanmaken:', error);
      setStatus('❌ Kon nieuwe lijst niet aanmaken. Probeer het opnieuw.', true);
    }
  }

  async function loadLists() {
    try {
      const response = await fetch(`${workerUrl}/lists`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      lists = Array.isArray(data.lists) ? data.lists : [];

      // Fall back to the first list if there's no (valid) remembered
      // selection yet — e.g. first visit ever, or a deleted list id.
      if (!activeListId || !lists.some((list) => list.id === activeListId)) {
        activeListId = lists[0]?.id || null;
        if (activeListId) localStorage.setItem(ACTIVE_LIST_STORAGE_KEY, activeListId);
      }

      renderSwitcher();
    } catch (error) {
      console.error('Kon lijsten niet laden:', error);
      setStatus('❌ Kon lijsten niet laden. Probeer het opnieuw.', true);
    }
  }

  switcherTrigger.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleSwitcher();
  });

  document.addEventListener('click', (event) => {
    if (!switcherEl.contains(event.target)) closeSwitcher();
  });

  switcherEl.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeSwitcher();
      switcherTrigger.focus();
    }
  });

  switcherMenu.addEventListener('click', (event) => {
    const listBtn = event.target.closest('.sl-list-menu-item[data-list-id]');
    if (listBtn) {
      switchToList(listBtn.dataset.listId);
      return;
    }

    const newListBtn = event.target.closest('#slNewListBtn');
    if (newListBtn) {
      const form = qs('#slNewListForm', switcherMenu);
      form.classList.remove('hidden');
      newListBtn.classList.add('hidden');
      qs('#slNewListInput', form).focus();
    }
  });

  switcherMenu.addEventListener('submit', (event) => {
    if (event.target.id !== 'slNewListForm') return;
    event.preventDefault();
    const input = qs('#slNewListInput', event.target);
    createList(input.value);
  });

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

  function renameItem(id, newText) {
    const trimmed = newText.trim();
    if (!trimmed) return;
    items = items.map((item) => (item.id === id ? { ...item, text: trimmed } : item));
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
      return;
    }

    const renameBtn = event.target.closest('.sl-rename');
    if (renameBtn) {
      const li = renameBtn.closest('.sl-item');
      if (li) startRename(li);
    }
  });

  // ---- Rename (inline edit) -----------------------------------------
  // Swaps the .sl-item-text <span> for a text <input> right in place,
  // pre-filled with the current text and focused/selected so typing
  // immediately replaces it. Enter or clicking away saves; Escape
  // cancels and restores the original text untouched.
  function startRename(li) {
    if (li.querySelector('.sl-rename-input')) return; // already editing this row
    const id = li.dataset.id;
    const item = items.find((it) => it.id === id);
    if (!item) return;

    const textEl = qs('.sl-item-text', li);
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'sl-rename-input';
    input.value = item.text;
    input.maxLength = 200;
    input.setAttribute('aria-label', `${item.text} hernoemen`);
    textEl.replaceWith(input);
    input.focus();
    input.select();

    let settled = false; // guards against both blur AND Enter firing the save

    function commit() {
      if (settled) return;
      settled = true;
      if (!input.value.trim()) {
        render(); // empty rename = no-op, just restore the original text
        return;
      }
      renameItem(id, input.value); // render() rebuilds the row, replacing this input
    }

    function cancel() {
      if (settled) return;
      settled = true;
      render(); // just redraw with the unchanged text, discarding the edit
    }

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    });
    input.addEventListener('blur', commit);
  }

  listEl.addEventListener('change', (event) => {
    if (event.target.classList.contains('sl-checkbox')) {
      const id = event.target.closest('.sl-item')?.dataset.id;
      if (id) toggleItem(id);
    }
  });

  // ---- Drag to reorder ----------------------------------------------
  // Pointer Events (not native HTML5 drag-and-drop, which touch
  // browsers don't reliably support) so the same code handles mouse
  // AND touch. Two ways to start a drag:
  //   1. The small grip handle (.sl-drag-handle) — starts INSTANTLY on
  //      pointerdown, no delay. Good for precise mouse use.
  //   2. Press-and-hold anywhere else on the row (LONG_PRESS_MS) —
  //      the more natural mobile gesture; a quick tap still reaches
  //      the checkbox/rename/delete controls normally, and a normal
  //      touch-scroll started on the row cancels the hold instead of
  //      accidentally kicking off a drag.
  //
  // While dragging, the item currently under the pointer is
  // physically moved in the DOM (no ghost element/animation) — as
  // soon as the pointer crosses another row's vertical midpoint, the
  // dragged row swaps to that position. Simple and reliable rather
  // than pixel-smooth, which is plenty for a short household list.
  const LONG_PRESS_MS = 350;
  const LONG_PRESS_MOVE_TOLERANCE = 10; // px of wiggle before a hold-in-progress is cancelled

  let draggingLi = null;
  let dragPointerId = null;
  let longPressTimer = null;
  let longPressStart = null; // { x, y, li, pointerId } while a hold is pending

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

  function beginDrag(li, pointerId) {
    draggingLi = li;
    dragPointerId = pointerId;
    draggingLi.classList.add('sl-item-dragging');
    listEl.classList.add('sl-list-reordering');
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

  function cancelPendingLongPress() {
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = null;
    longPressStart = null;
  }

  listEl.addEventListener('pointerdown', (event) => {
    const handle = event.target.closest('.sl-drag-handle');
    if (handle) {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      const li = handle.closest('.sl-item');
      if (!li) return;
      beginDrag(li, event.pointerId);
      handle.setPointerCapture(event.pointerId);
      event.preventDefault(); // stop touch-scroll/text-selection while dragging
      return;
    }

    // Long-press-anywhere path: skip interactive controls entirely so
    // taps on the checkbox/rename/delete buttons (or typing in an
    // active rename input) behave completely normally.
    if (event.target.closest('.sl-checkbox, .sl-rename, .sl-delete, .sl-rename-input')) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    const li = event.target.closest('.sl-item');
    if (!li) return;

    longPressStart = { x: event.clientX, y: event.clientY, li, pointerId: event.pointerId };
    longPressTimer = setTimeout(() => {
      if (!longPressStart) return;
      const { li: pendingLi, pointerId } = longPressStart;
      longPressTimer = null;
      longPressStart = null;
      beginDrag(pendingLi, pointerId);
      pendingLi.setPointerCapture(pointerId);
    }, LONG_PRESS_MS);
  });

  listEl.addEventListener('pointermove', (event) => {
    if (draggingLi && event.pointerId === dragPointerId) {
      moveDraggedRowTo(event.clientY);
      return;
    }
    // A hold is pending but the pointer moved too much before the
    // timer fired — this was a scroll/swipe attempt, not a hold, so
    // don't start a drag.
    if (longPressStart && event.pointerId === longPressStart.pointerId) {
      const dx = event.clientX - longPressStart.x;
      const dy = event.clientY - longPressStart.y;
      if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_TOLERANCE) cancelPendingLongPress();
    }
  });

  listEl.addEventListener('pointerup', (event) => {
    if (longPressStart && event.pointerId === longPressStart.pointerId) cancelPendingLongPress();
    if (event.pointerId !== dragPointerId) return;
    endDrag();
  });

  listEl.addEventListener('pointercancel', (event) => {
    if (longPressStart && event.pointerId === longPressStart.pointerId) cancelPendingLongPress();
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
      // change we just made ourselves. Also skip while a drag is in
      // progress: render() replaces the whole list's innerHTML, which
      // would orphan the row currently being dragged (it's still
      // referenced by draggingLi but no longer part of the live DOM)
      // — finishing the drag after that could re-insert it alongside
      // its freshly-rendered twin, showing the item twice.
      if (!saveInFlight && !draggingLi) loadList({ silent: true });
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

  (async function init() {
    await loadLists();
    await loadList();
    startPolling();
  })();
}
