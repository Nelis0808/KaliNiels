// =================================================================
// LIJSTJE (lijstje.html)
// -----------------------------------------------------------------
// Talks ONLY to the lijstje Cloudflare Worker (see
// cloudflare/lijstje/ + ACTION-EXPANSION-PLAN.md),
// which stores one or more named lists (categories) in Cloudflare
// KV. No login — see the worker's top comment for why that's fine
// here.
//
// MULTIPLE LISTS: the dropdown at the top (#slListSwitcher) lets you
// switch between categories (e.g. "Boodschappen", "Klussen") — each
// is its own list on the server, addressed by an id. "+ Nieuwe lijst"
// always sits at the bottom of that dropdown and opens a small inline
// form to create another one. The last list you had open is
// remembered per-browser (localStorage), so this device reopens the
// same one next time.
//
// EDITING LISTS: with 2+ lists, a "Lijsten wijzigen" button also sits
// at the bottom of the dropdown. Clicking it swaps the dropdown into
// an edit view — each list becomes a row with a drag handle (reorder),
// a ✏️ rename button, and a ✕ delete button — until "Klaar" is
// clicked again. Same drag mechanics (Pointer Events, long-press or
// handle-drag, ArrowUp/ArrowDown keyboard fallback) as reordering
// items within a list, just scoped to the dropdown instead.
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

// A 404/405 on PATCH/DELETE/PUT /lists specifically (as opposed to a
// network error, 500, etc.) almost always means one thing: the
// worker.js deployed on Cloudflare is still the older version that
// only knew about items inside a single list, and doesn't have the
// rename/delete/reorder routes yet — see cloudflare/lijstje/. Any
// other status is a genuine runtime error and gets the plain message
// instead.
// Explains a 404/405 on the /lists API as an outdated Worker deploy
function describeListsApiError(response) {
  if (response && (response.status === 404 || response.status === 405)) {
    return 'moet je de Cloudflare Worker opnieuw deployen (zie cloudflare/lijstje/ bovenaan)';
  }
  return 'probeer het opnieuw';
}

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

  // True once config.js's shoppingList.workerUrl has been set to a real Worker URL
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
  let renamingItemId = null; // set while an item's rename <input> is open, so polling doesn't clobber it

  // Categories (separate lists). `lists` mirrors the server's index;
  // `activeListId` is whichever one is currently shown.
  let lists = [];
  let activeListId = localStorage.getItem(ACTIVE_LIST_STORAGE_KEY) || null;

  // Updates the status line, optionally styled as an error
  function setStatus(text, isError = false) {
    statusEl.textContent = text;
    statusEl.classList.toggle('sl-status-error', isError);
    statusEl.classList.remove('hidden');
  }

  // Redraws the whole item list from `items`, or the empty state if there are none
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

  // Fetches the active list's items from the Worker
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

  // Whether the dropdown is currently showing the "Lijsten wijzigen"
  // edit view (drag handle + rename + delete per list) instead of
  // the normal pick-a-list view. Reset to false whenever the
  // dropdown closes, so it always reopens in the normal view.
  let listsEditMode = false;

  // Closes the list-switcher dropdown and resets its "new list" form
  function closeSwitcher() {
    switcherEl.classList.remove('open');
    switcherTrigger.setAttribute('aria-expanded', 'false');
    listsEditMode = false;

    // Reset the "new list" inline form back to its collapsed state
    // (just the "+ Nieuwe lijst" button) for next time it opens.
    const form = qs('#slNewListForm', switcherMenu);
    const addBtn = qs('#slNewListBtn', switcherMenu);
    if (form && addBtn) {
      form.classList.add('hidden');
      addBtn.classList.remove('hidden');
      qs('#slNewListInput', form).value = '';
    }
    renderSwitcher();
  }

  // Opens/closes the list-switcher dropdown
  function toggleSwitcher() {
    const isOpen = switcherEl.classList.toggle('open');
    switcherTrigger.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) {
      const activeBtn = qs('.sl-list-menu-item.active', switcherMenu);
      (activeBtn || qs('.sl-list-menu-item', switcherMenu))?.focus();
    } else if (listsEditMode) {
      listsEditMode = false;
      renderSwitcher(); // otherwise the edit-mode rows (with now-stale click targets) linger until reopened
    }
  }

  // Renders the dropdown's normal (pick-a-list) view, or delegates to edit mode
  function renderSwitcher() {
    const active = lists.find((list) => list.id === activeListId);
    switcherLabel.textContent = active ? active.name : 'Lijstje';

    if (listsEditMode) {
      renderSwitcherEditMode();
      return;
    }

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
        + Nieuwe lijst
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
      <button type="button" id="slEditListsBtn" class="sl-list-menu-item sl-list-menu-add" role="menuitem">
        Lijsten wijzigen
      </button>
    `;
  }

  // ---- "Lijsten wijzigen" edit view ----------------------------------
  // Each list becomes a row with a drag handle (reorder, same
  // pointer-events approach as the item rows further down this
  // file), a rename (✏️) button, and a delete (✕) button.
  function renderSwitcherEditMode() {
    const rowsHtml = lists
      .map(
        (list) => `
          <div class="sl-list-edit-row" data-list-id="${escapeHtml(list.id)}">
            <span class="sl-list-drag-handle" role="button" tabindex="0" aria-label="${escapeHtml(list.name)} verslepen om te herordenen (of vasthouden, of pijltje omhoog/omlaag)"></span>
            <span class="sl-list-edit-name">${escapeHtml(list.name)}</span>
            <div class="sl-list-edit-actions">
              <button type="button" class="sl-list-rename-btn" aria-label="${escapeHtml(list.name)} hernoemen">✏️</button>
              <button type="button" class="sl-list-delete-btn" aria-label="${escapeHtml(list.name)} verwijderen" ${lists.length <= 1 ? 'disabled' : ''}>✕</button>
            </div>
          </div>
        `
      )
      .join('');

    switcherMenu.innerHTML = `
      ${rowsHtml}
      <div class="sl-list-menu-divider" role="separator"></div>
      <button type="button" id="slEditListsBtn" class="sl-list-menu-item sl-list-menu-add sl-editing" role="menuitem">
        Klaar
      </button>
    `;
  }

  // Switches the active list and reloads its items
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

  // Creates a new list on the Worker and switches to it
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

  // Fetches every list's name/id from the Worker
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

  // Renames a list (optimistically), rolling back on failure
  async function renameList(id, newName) {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const previous = lists;
    lists = lists.map((list) => (list.id === id ? { ...list, name: trimmed } : list));
    renderSwitcher();
    try {
      const response = await fetch(`${workerUrl}/lists?id=${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!response.ok) {
        const err = new Error(`HTTP ${response.status}`);
        err.response = response;
        throw err;
      }
    } catch (error) {
      console.error('Kon lijst niet hernoemen:', error);
      setStatus(`❌ Kon lijst niet hernoemen — ${describeListsApiError(error.response)}.`, true);
      lists = previous; // roll back the optimistic rename
      renderSwitcher();
    }
  }

  // Deletes a list (optimistically), rolling back on failure
  async function deleteList(id) {
    if (lists.length <= 1) return; // worker rejects this too; guard here so the UI never even tries
    const previous = lists;
    lists = lists.filter((list) => list.id !== id);
    renderSwitcher();
    try {
      const response = await fetch(`${workerUrl}/lists?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!response.ok) {
        const err = new Error(`HTTP ${response.status}`);
        err.response = response;
        throw err;
      }
      if (id === activeListId) {
        activeListId = lists[0]?.id || null;
        if (activeListId) {
          localStorage.setItem(ACTIVE_LIST_STORAGE_KEY, activeListId);
          await loadList();
        }
      }
    } catch (error) {
      console.error('Kon lijst niet verwijderen:', error);
      setStatus(`❌ Kon lijst niet verwijderen — ${describeListsApiError(error.response)}.`, true);
      lists = previous; // roll back
      renderSwitcher();
    }
  }

  // Persists a new list order (drag-and-drop in edit mode). Optimistic,
  // same pattern as saveList()/reorderItem() below — the DOM/array is
  // already in the new order before this is called.
  async function saveListOrder() {
    try {
      const response = await fetch(`${workerUrl}/lists`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: lists.map((list) => list.id) }),
      });
      if (!response.ok) {
        const err = new Error(`HTTP ${response.status}`);
        err.response = response;
        throw err;
      }
      const data = await response.json();
      if (Array.isArray(data.lists)) lists = data.lists;
    } catch (error) {
      console.error('Kon volgorde van lijsten niet opslaan:', error);
      setStatus(`⚠️ Volgorde niet opgeslagen (${describeListsApiError(error.response)}) — wordt hersteld…`, true);
      await loadLists();
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
    // Stopped here, not just relied on switcherEl.contains() in the
    // document listener below: several branches in this handler (new
    // list, edit-mode toggle, rename, delete) rewrite switcherMenu's
    // innerHTML synchronously. That detaches the exact node that was
    // clicked from the DOM, so by the time the document-level
    // listener runs on the same click, .contains(event.target) on
    // the now-detached node returns false and closeSwitcher() fires
    // right after — which looked like "clicking anything in here
    // just closes the dropdown and does nothing."
    event.stopPropagation();

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
      return;
    }

    const editListsBtn = event.target.closest('#slEditListsBtn');
    if (editListsBtn) {
      listsEditMode = !listsEditMode;
      renderSwitcher();
      return;
    }

    const deleteListBtn = event.target.closest('.sl-list-delete-btn');
    if (deleteListBtn) {
      const id = deleteListBtn.closest('.sl-list-edit-row')?.dataset.listId;
      if (id) deleteList(id);
      return;
    }

    const renameListBtn = event.target.closest('.sl-list-rename-btn');
    if (renameListBtn) {
      const row = renameListBtn.closest('.sl-list-edit-row');
      if (row) startListRename(row);
    }
  });

  // ---- Rename a list (inline edit, edit mode) ------------------------
  // Same swap-span-for-input pattern as startRename() for items below:
  // Enter or blur commits, Escape cancels. Doesn't touch `renamingItemId`
  // (that guard is specifically for item rows) — the switcher dropdown
  // has its own polling-independent lifecycle, so there's no refresh
  // racing this input while the dropdown is open.
  // Swaps a list-edit row into an inline rename <input>
  function startListRename(row) {
    if (row.querySelector('.sl-list-rename-input')) return; // already editing this row
    const id = row.dataset.listId;
    const list = lists.find((l) => l.id === id);
    if (!list) return;

    const nameEl = qs('.sl-list-edit-name', row);
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'sl-list-rename-input';
    input.value = list.name;
    input.maxLength = 60;
    input.setAttribute('aria-label', `${list.name} hernoemen`);
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    let settled = false;

    // Commits the typed rename
    function commit() {
      if (settled) return;
      settled = true;
      if (!input.value.trim() || input.value.trim() === list.name) {
        renderSwitcher(); // no real change = no-op, just restore
        return;
      }
      renameList(id, input.value); // renderSwitcher() rebuilds the row, replacing this input
    }

    // Cancels the rename, restoring the plain name text
    function cancel() {
      if (settled) return;
      settled = true;
      renderSwitcher();
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
    // Dropdown-wide Escape (see switcherEl's keydown listener) would
    // otherwise close the whole dropdown while renaming — stop it
    // from bubbling there so Escape only cancels this input.
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') event.stopPropagation();
    });
  }

  switcherMenu.addEventListener('submit', (event) => {
    if (event.target.id !== 'slNewListForm') return;
    event.preventDefault();
    const input = qs('#slNewListInput', event.target);
    createList(input.value);
  });

  // ---- Mutations ---------------------------------------------------

  // Adds a new item (optimistically) and saves
  function addItem(text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    items = [...items, { id: crypto.randomUUID(), text: trimmed, checked: false }];
    render();
    saveList();
  }

  // Toggles an item's checked state (optimistically) and saves
  function toggleItem(id) {
    items = items.map((item) => (item.id === id ? { ...item, checked: !item.checked } : item));
    render();
    saveList();
  }

  // Removes an item (optimistically) and saves
  function deleteItem(id) {
    items = items.filter((item) => item.id !== id);
    render();
    saveList();
  }

  // Renames an item (optimistically) and saves
  function renameItem(id, newText) {
    const trimmed = newText.trim();
    if (!trimmed) return;
    items = items.map((item) => (item.id === id ? { ...item, text: trimmed } : item));
    render();
    saveList();
  }

  /** Moves the item with `id` to `targetIndex` in the list, then persists the new order. */
  // Moves an item to a new position (optimistically) and saves
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
  // Swaps an item row into an inline rename <input>
  function startRename(li) {
    if (li.querySelector('.sl-rename-input')) return; // already editing this row
    const id = li.dataset.id;
    const item = items.find((it) => it.id === id);
    if (!item) return;

    // While this input is open, the background poll (every few
    // seconds) is skipped — otherwise it would call render(), which
    // rebuilds the whole list's innerHTML and wipes out whatever the
    // person is mid-typing here, well before they hit Enter.
    renamingItemId = id;

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
      renamingItemId = null;
      if (!input.value.trim()) {
        render(); // empty rename = no-op, just restore the original text
        return;
      }
      renameItem(id, input.value); // render() rebuilds the row, replacing this input
    }

    function cancel() {
      if (settled) return;
      settled = true;
      renamingItemId = null;
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

  // Every item <li> currently in the DOM, in order
  function itemElements() {
    return Array.from(listEl.querySelectorAll('.sl-item'));
  }

  // Repositions the dragged item row to match a pointer's Y position
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

  // Starts dragging an item row
  function beginDrag(li, pointerId) {
    draggingLi = li;
    dragPointerId = pointerId;
    draggingLi.classList.add('sl-item-dragging');
    listEl.classList.add('sl-list-reordering');
  }

  // Ends the item drag, committing the new order if it changed
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

  // Cancels a pending long-press-to-drag timer for an item row
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

  // ---- Drag to reorder the LISTS themselves (edit mode) ---------------
  // Same Pointer Events approach as the item drag above (works for
  // mouse and touch alike), scoped to switcherMenu instead of listEl,
  // and only ever live while listsEditMode is on — the rows with
  // .sl-list-drag-handle only exist in that view.
  let draggingListRow = null;
  let listDragPointerId = null;
  let listLongPressTimer = null;
  let listLongPressStart = null;

  // Every list-edit row currently in the DOM, in order
  function listRowElements() {
    return Array.from(switcherMenu.querySelectorAll('.sl-list-edit-row'));
  }

  // Repositions the dragged list row to match a pointer's Y position
  function moveDraggedListRowTo(clientY) {
    const siblings = listRowElements().filter((el) => el !== draggingListRow);
    for (const sibling of siblings) {
      const rect = sibling.getBoundingClientRect();
      const middle = rect.top + rect.height / 2;
      if (clientY < middle) {
        if (sibling.previousElementSibling !== draggingListRow) {
          switcherMenu.insertBefore(draggingListRow, sibling);
        }
        return;
      }
    }
    // Below every other row — but never past the divider/"Klaar" button
    // that follow the rows, so insert before the first non-row element.
    const firstNonRow = switcherMenu.querySelector(':scope > :not(.sl-list-edit-row)');
    if (firstNonRow && firstNonRow.previousElementSibling !== draggingListRow) {
      switcherMenu.insertBefore(draggingListRow, firstNonRow);
    }
  }

  // Starts dragging a list row (in "Lijsten wijzigen" edit mode)
  function beginListDrag(row, pointerId) {
    draggingListRow = row;
    listDragPointerId = pointerId;
    draggingListRow.classList.add('sl-list-edit-row-dragging');
  }

  // Ends the list drag, committing the new order if it changed
  function endListDrag() {
    if (!draggingListRow) return;
    draggingListRow.classList.remove('sl-list-edit-row-dragging');

    const newOrderIds = listRowElements().map((el) => el.dataset.listId);
    lists = newOrderIds.map((id) => lists.find((list) => list.id === id)).filter(Boolean);
    saveListOrder();

    draggingListRow = null;
    listDragPointerId = null;
  }

  // Cancels a pending long-press-to-drag timer for a list row
  function cancelPendingListLongPress() {
    if (listLongPressTimer) clearTimeout(listLongPressTimer);
    listLongPressTimer = null;
    listLongPressStart = null;
  }

  switcherMenu.addEventListener('pointerdown', (event) => {
    if (!listsEditMode) return;

    const handle = event.target.closest('.sl-list-drag-handle');
    if (handle) {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      const row = handle.closest('.sl-list-edit-row');
      if (!row) return;
      beginListDrag(row, event.pointerId);
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }

    // Long-press-anywhere path, skipping the rename/delete buttons so
    // taps there still work normally — same idea as the item list.
    if (event.target.closest('.sl-list-rename-btn, .sl-list-delete-btn, .sl-list-rename-input')) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    const row = event.target.closest('.sl-list-edit-row');
    if (!row) return;

    listLongPressStart = { x: event.clientX, y: event.clientY, row, pointerId: event.pointerId };
    listLongPressTimer = setTimeout(() => {
      if (!listLongPressStart) return;
      const { row: pendingRow, pointerId } = listLongPressStart;
      listLongPressTimer = null;
      listLongPressStart = null;
      beginListDrag(pendingRow, pointerId);
      pendingRow.setPointerCapture(pointerId);
    }, LONG_PRESS_MS);
  });

  switcherMenu.addEventListener('pointermove', (event) => {
    if (draggingListRow && event.pointerId === listDragPointerId) {
      moveDraggedListRowTo(event.clientY);
      return;
    }
    if (listLongPressStart && event.pointerId === listLongPressStart.pointerId) {
      const dx = event.clientX - listLongPressStart.x;
      const dy = event.clientY - listLongPressStart.y;
      if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_TOLERANCE) cancelPendingListLongPress();
    }
  });

  switcherMenu.addEventListener('pointerup', (event) => {
    if (listLongPressStart && event.pointerId === listLongPressStart.pointerId) cancelPendingListLongPress();
    if (event.pointerId !== listDragPointerId) return;
    endListDrag();
  });

  switcherMenu.addEventListener('pointercancel', (event) => {
    if (listLongPressStart && event.pointerId === listLongPressStart.pointerId) cancelPendingListLongPress();
    if (event.pointerId !== listDragPointerId) return;
    endListDrag();
  });

  // Keyboard fallback, same idea as the items' ArrowUp/ArrowDown handling.
  switcherMenu.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    const handle = event.target.closest('.sl-list-drag-handle');
    if (!handle) return;
    event.preventDefault();

    const id = handle.closest('.sl-list-edit-row')?.dataset.listId;
    if (!id) return;
    const fromIndex = lists.findIndex((list) => list.id === id);
    if (fromIndex === -1) return;
    const targetIndex = Math.max(0, Math.min(fromIndex + (event.key === 'ArrowUp' ? -1 : 1), lists.length - 1));
    if (targetIndex === fromIndex) return;

    const reordered = [...lists];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    lists = reordered;
    renderSwitcher();
    saveListOrder();
    // renderSwitcher() just rebuilt the rows, so refocus the (new) handle.
    switcherMenu.querySelector(`.sl-list-edit-row[data-list-id="${id}"] .sl-list-drag-handle`)?.focus();
  });

  // ---- Polling (picks up changes made on the other person's device) ----

  // Starts the periodic background refresh, pausing while the tab is hidden
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
      // its freshly-rendered twin, showing the item twice. Same idea
      // for renamingItemId: render() would blow away the open rename
      // <input> (and whatever's been typed into it) before Enter/blur
      // ever commits it.
      if (!saveInFlight && !draggingLi && !renamingItemId) loadList({ silent: true });
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
