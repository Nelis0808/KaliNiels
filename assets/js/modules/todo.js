// =================================================================
// TODO LIJST (todo.html)
// -----------------------------------------------------------------
// Two synced columns (Kalina left = person "b", Niels right =
// person "a" — same convention as gifts.js), each independently
// checkable / renamable / priority-tagged / drag-reorderable, plus a
// running index number per column.
//
// SYNC MODEL: identical to boodschappenlijst.js — talks to the todo
// Cloudflare Worker (cloudflare/cloudflare-worker-todo +
// STAPPENPLAN-TODO-SNACKS.md), one shared array in Cloudflare KV
// covering BOTH columns (each item carries a `person` field), saved
// optimistically on every change and polled every few seconds so a
// change on the other person's device shows up here too. See
// boodschappenlijst.js's file header for the fuller reasoning (no
// login, not real-time, last-write-wins) — all of that applies here
// unchanged.
//
// DRAG-REORDER ACROSS TWO COLUMNS: `items` is one flat array (both
// people, in the order the Worker returns/stores them) — each column
// just filters it down for rendering. Dragging within a column only
// ever needs to reorder THAT person's subsequence of the array while
// leaving the other person's items exactly where they were — see
// reorderPerson() for how that's done generically without needing
// two separate arrays.
// =================================================================

import { siteConfig } from '../config.js';
import { qs, qsa, escapeHtml } from './utils.js';

const POLL_INTERVAL_MS = 5000;
const LONG_PRESS_MS = 350;
const LONG_PRESS_MOVE_TOLERANCE = 10;

// Cycle order the priority swatch button on each row steps through.
const PRIORITIES = [
  { level: 'high', label: 'Hoog', dot: '🔴' },
  { level: 'medium', label: 'Gemiddeld', dot: '🟠' },
  { level: 'low', label: 'Laag', dot: '🟡' },
  { level: 'none', label: 'Geen', dot: '⚪' },
];
const PRIORITY_BY_LEVEL = Object.fromEntries(PRIORITIES.map((p) => [p.level, p]));
const DEFAULT_PRIORITY = 'none';

export function initTodo() {
  const root = document.getElementById('todoApp');
  if (!root) return; // not on this page

  const workerUrl = siteConfig.todo?.workerUrl || '';
  const personLabels = siteConfig.todo?.personLabels || { a: 'Niels', b: 'Kalina' };

  function workerConfigured() {
    return workerUrl && !workerUrl.includes('YOUR-SUBDOMAIN');
  }

  const configWarning = qs('#todoConfigWarning', root);
  if (!workerConfigured()) {
    configWarning?.classList.remove('hidden');
    root.classList.add('sl-disabled');
    return;
  }

  // Fill in the person-name spans (data-todo-person-label="a"/"b"),
  // same idea as gifts.js, in case a display name is ever customised
  // in config.js.
  qsa('[data-todo-person-label]', root).forEach((el) => {
    const person = el.dataset.todoPersonLabel;
    if (personLabels[person]) el.textContent = personLabels[person];
  });

  let items = []; // flat, both people — see file header
  let pollTimer = null;
  let saveInFlight = false;
  const newItemPriority = { a: DEFAULT_PRIORITY, b: DEFAULT_PRIORITY };

  const statusEl = qs('#todoStatus', root);

  function setStatus(text, isError = false) {
    statusEl.textContent = text;
    statusEl.classList.toggle('sl-status-error', isError);
    statusEl.classList.remove('hidden');
  }

  // ---- Networking (identical shape to boodschappenlijst.js) ----------

  async function loadItems({ silent = false } = {}) {
    if (!silent) setStatus('Laden…');
    try {
      const response = await fetch(`${workerUrl}/todos`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      items = Array.isArray(data.items) ? data.items : [];
      renderAll();
    } catch (error) {
      console.error('Kon TODO-lijst niet laden:', error);
      if (!silent) setStatus('❌ Kon lijstje niet laden. Probeer het opnieuw.', true);
    }
  }

  async function saveItems() {
    saveInFlight = true;
    try {
      const response = await fetch(`${workerUrl}/todos`, {
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
      setStatus('⚠️ Wijziging niet opgeslagen, lijstje wordt hersteld…', true);
      await loadItems({ silent: true });
    } finally {
      saveInFlight = false;
    }
  }

  // ---- Mutations (operate on the whole `items` array by id) ----------

  function addItem(person, text, priority) {
    const trimmed = text.trim();
    if (!trimmed) return;
    items = [...items, { id: crypto.randomUUID(), person, text: trimmed, priority, checked: false }];
    renderAll();
    saveItems();
  }

  function toggleItem(id) {
    items = items.map((item) => (item.id === id ? { ...item, checked: !item.checked } : item));
    renderAll();
    saveItems();
  }

  function deleteItem(id) {
    items = items.filter((item) => item.id !== id);
    renderAll();
    saveItems();
  }

  function renameItem(id, newText) {
    const trimmed = newText.trim();
    if (!trimmed) return;
    items = items.map((item) => (item.id === id ? { ...item, text: trimmed } : item));
    renderAll();
    saveItems();
  }

  function cyclePriority(id) {
    items = items.map((item) => {
      if (item.id !== id) return item;
      const currentIndex = PRIORITIES.findIndex((p) => p.level === (item.priority || DEFAULT_PRIORITY));
      const next = PRIORITIES[(currentIndex + 1) % PRIORITIES.length];
      return { ...item, priority: next.level };
    });
    renderAll();
    saveItems();
  }

  /** Reorders just `person`'s subsequence of `items` to `newOrderIds`,
   *  leaving the other person's items in their existing positions —
   *  see file header for why this is safe/sufficient. */
  function reorderPerson(person, newOrderIds) {
    const byId = new Map(items.filter((item) => item.person === person).map((item) => [item.id, item]));
    let cursor = 0;
    items = items.map((item) => {
      if (item.person !== person) return item;
      const replacement = byId.get(newOrderIds[cursor]);
      cursor += 1;
      return replacement || item;
    });
    saveItems();
  }

  /** Keyboard-only reorder (ArrowUp/ArrowDown) — moves one item within its own person's subsequence. */
  function reorderItemByKeyboard(id, direction) {
    const person = items.find((item) => item.id === id)?.person;
    if (!person) return;
    const personIds = items.filter((item) => item.person === person).map((item) => item.id);
    const fromIndex = personIds.indexOf(id);
    if (fromIndex === -1) return;
    const targetIndex = Math.max(0, Math.min(personIds.length - 1, fromIndex + direction));
    if (targetIndex === fromIndex) return;
    const reordered = [...personIds];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    reorderPerson(person, reordered);
    renderAll();
  }

  // ---- Rendering -------------------------------------------------

  function renderRow(item, index) {
    const priority = PRIORITY_BY_LEVEL[item.priority] || PRIORITY_BY_LEVEL[DEFAULT_PRIORITY];
    return `
      <li class="sl-item todo-item todo-item-${priority.level} ${item.checked ? 'sl-item-checked' : ''}" data-id="${escapeHtml(item.id)}">
        <span class="sl-drag-handle" role="button" tabindex="0" aria-label="${escapeHtml(item.text)} verslepen om te herordenen (of vasthouden op de rij, of pijltje omhoog/omlaag)"></span>
        <span class="todo-index" aria-hidden="true">${index + 1}.</span>
        <label class="sl-item-label">
          <input type="checkbox" class="sl-checkbox" ${item.checked ? 'checked' : ''} aria-label="${escapeHtml(item.text)} afvinken">
          <span class="sl-item-text">${escapeHtml(item.text)}</span>
        </label>
        <div class="sl-item-actions">
          <button type="button" class="todo-priority-swatch" aria-label="Prioriteit van ${escapeHtml(item.text)}: ${priority.label}. Klik om te wijzigen.">${priority.dot}</button>
          <button type="button" class="sl-rename" aria-label="${escapeHtml(item.text)} hernoemen">✏️</button>
          <button type="button" class="sl-delete" aria-label="${escapeHtml(item.text)} verwijderen">✕</button>
        </div>
      </li>
    `;
  }

  const columns = ['a', 'b'].map((person) => setupColumn(person));

  function renderAll() {
    columns.forEach((column) => column.render());
  }

  function setupColumn(person) {
    const listEl = qs(`#todoList${person.toUpperCase()}`, root);
    const emptyStateEl = qs(`#todoEmpty${person.toUpperCase()}`, root);
    const addForm = qs(`#todoAddForm${person.toUpperCase()}`, root);
    if (!listEl || !addForm) return { render() {} }; // markup missing — bail quietly

    const addInput = qs('.todo-add-input', addForm);
    const addError = qs('.todo-add-error', addForm);
    const priorityPicker = qs('.todo-priority-picker', addForm);

    function personItems() {
      return items.filter((item) => item.person === person);
    }

    function renderPriorityPicker() {
      priorityPicker.innerHTML = '';
      PRIORITIES.forEach(({ level, label, dot }) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `todo-priority-pill todo-priority-pill-${level}` + (level === newItemPriority[person] ? ' todo-priority-pill-active' : '');
        btn.textContent = `${dot} ${label}`;
        btn.setAttribute('aria-pressed', String(level === newItemPriority[person]));
        btn.addEventListener('click', () => {
          btn.blur();
          newItemPriority[person] = level;
          renderPriorityPicker();
        });
        priorityPicker.appendChild(btn);
      });
    }

    function render() {
      const list = personItems();

      if (list.length === 0) {
        listEl.innerHTML = '';
        emptyStateEl?.classList.remove('hidden');
      } else {
        emptyStateEl?.classList.add('hidden');
        listEl.innerHTML = list.map(renderRow).join('');
      }
    }

    // ---- Wiring for this column --------------------------------------

    addForm.addEventListener('submit', (event) => {
      event.preventDefault();
      if (addError) addError.textContent = '';

      const value = addInput.value;
      if (!value.trim()) {
        if (addError) addError.textContent = 'Vul eerst iets in.';
        return;
      }

      addItem(person, value, newItemPriority[person]);
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

      const priorityBtn = event.target.closest('.todo-priority-swatch');
      if (priorityBtn) {
        const id = priorityBtn.closest('.sl-item')?.dataset.id;
        if (id) cyclePriority(id);
        return;
      }

      const renameBtn = event.target.closest('.sl-rename');
      if (renameBtn) {
        const li = renameBtn.closest('.sl-item');
        if (li) startRename(li);
      }
    });

    listEl.addEventListener('change', (event) => {
      if (event.target.classList.contains('sl-checkbox')) {
        const id = event.target.closest('.sl-item')?.dataset.id;
        if (id) toggleItem(id);
      }
    });

    function startRename(li) {
      if (li.querySelector('.sl-rename-input')) return;
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

      let settled = false;
      function commit() {
        if (settled) return;
        settled = true;
        if (!input.value.trim()) {
          renderAll();
          return;
        }
        renameItem(id, input.value);
      }
      function cancel() {
        if (settled) return;
        settled = true;
        renderAll();
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

    // ---- Drag to reorder (scoped to this column's <ul> only) ------------
    let draggingLi = null;
    let dragPointerId = null;
    let longPressTimer = null;
    let longPressStart = null;

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

      const newOrderIds = itemElements().map((el) => el.dataset.id);
      reorderPerson(person, newOrderIds);
      renderAll(); // refresh index numbers immediately to match the new order

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
        event.preventDefault();
        return;
      }

      if (event.target.closest('.sl-checkbox, .sl-rename, .sl-delete, .sl-rename-input, .todo-priority-swatch')) return;
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

    listEl.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      const handle = event.target.closest('.sl-drag-handle');
      if (!handle) return;
      event.preventDefault();
      const id = handle.closest('.sl-item')?.dataset.id;
      if (!id) return;
      reorderItemByKeyboard(id, event.key === 'ArrowUp' ? -1 : 1);
      listEl.querySelector(`.sl-item[data-id="${id}"] .sl-drag-handle`)?.focus();
    });

    renderPriorityPicker();
    return { render };
  }

  // ---- Polling (picks up changes made on the other person's device) ----

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => {
      if (!saveInFlight) loadItems({ silent: true });
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
      loadItems({ silent: true });
      startPolling();
    }
  });

  // ---- Initial load --------------------------------------------------

  loadItems();
  startPolling();
}
