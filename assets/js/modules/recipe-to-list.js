// =================================================================
// RECEPT -> BOODSCHAPPENLIJSTJE (gedeeld door recepten.js en ah-recepten.js)
// -----------------------------------------------------------------
// De knop "🛒 Zet op boodschappenlijstje" in de receptpopup maakt van het
// geopende gerecht een NIEUW lijstje op lijstje.html (zelfde Worker als
// die pagina: siteConfig.shoppingList.workerUrl).
//
// STAPPEN
//   1. Dialoog "Wil je nog iets aanpassen?": naam van het lijstje wijzigen,
//      ingrediënten uitzetten (= niet toevoegen), tekst/hoeveelheid
//      aanpassen of zelf iets bijvoegen.
//   2. Bevestigen ("Zeker weten?") met een korte samenvatting.
//   3. Lijstje + items worden aangemaakt (POST /lists, daarna PUT /list).
//      De dialoog sluit, je bent terug in de receptpopup en rechtsboven,
//      onder de navbar, verschijnt een melding. Klik je daarop dan ga je
//      naar lijstje.html met precies dit nieuwe lijstje open.
//
// `getRecipe()` levert { title, servings, lines: ['2 el olie', ...] } met de
// hoeveelheden zoals ze op dat moment in de popup staan (dus al geschaald
// naar het gekozen aantal personen).
// =================================================================

import { siteConfig } from '../config.js';
import { escapeHtml } from './utils.js';

// Moet gelijk zijn aan ACTIVE_LIST_STORAGE_KEY in lijstje.js: zo opent
// lijstje.html meteen het zojuist gemaakte lijstje.
const ACTIVE_LIST_STORAGE_KEY = 'lijstje-active-list-id';
const TOAST_MS = 9000;

let activeToast = null;

function listWorkerUrl() {
  const url = siteConfig.shoppingList?.workerUrl || '';
  return url && !url.includes('YOUR-SUBDOMAIN') ? url : '';
}

function showToast(list, count) {
  activeToast?.remove();
  const toast = document.createElement('div');
  toast.className = 'rpt-toast';
  toast.setAttribute('role', 'status');
  toast.innerHTML = `
    <a href="lijstje.html" aria-label="Open lijstje ${escapeHtml(list.name)}">
      <strong>✅ Lijstje aangemaakt</strong>
      <small>“${escapeHtml(list.name)}” · ${count} item${count === 1 ? '' : 's'} — klik om het te openen</small>
    </a>
    <button type="button" aria-label="Melding sluiten">✕</button>`;

  // Onder de navbar, ook als die (sticky) een andere hoogte heeft.
  const nav = document.querySelector('.navbar, header');
  const navBottom = nav ? Math.max(0, nav.getBoundingClientRect().bottom) : 0;
  toast.style.top = `${navBottom + 12}px`;

  toast.querySelector('a').addEventListener('click', () => {
    try { localStorage.setItem(ACTIVE_LIST_STORAGE_KEY, list.id); } catch { /* geen opslag: dan opent het eerste lijstje */ }
  });
  toast.querySelector('button').addEventListener('click', () => toast.remove());
  document.body.appendChild(toast);
  activeToast = toast;
  setTimeout(() => { if (activeToast === toast) toast.remove(); }, TOAST_MS);
}

async function createListWithItems(name, texts) {
  const base = listWorkerUrl();
  if (!base) throw new Error('Nog geen boodschappenlijstje-Worker ingesteld');

  const created = await fetch(`${base}/lists`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!created.ok) throw new Error(`Lijst aanmaken mislukt (HTTP ${created.status})`);
  const list = await created.json();

  const items = texts.map((text) => ({ id: crypto.randomUUID(), text, checked: false }));
  const saved = await fetch(`${base}/list?id=${encodeURIComponent(list.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  if (!saved.ok) throw new Error(`Items opslaan mislukt (HTTP ${saved.status})`);
  return { id: list.id, name: list.name || name };
}

function openDialog(recipe) {
  const overlay = document.createElement('div');
  overlay.className = 'rpt-list-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Naar boodschappenlijstje');

  const card = document.createElement('div');
  card.className = 'rpt-list-card';
  overlay.appendChild(card);

  const rows = recipe.lines.map((text) => ({ text, on: true }));
  let name = recipe.title;
  let busy = false;

  function close() {
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
  }
  function onKey(event) {
    if (event.key !== 'Escape') return;
    event.stopPropagation(); // sluit alleen deze dialoog, niet ook de receptpopup eronder
    if (!busy) close();
  }
  document.addEventListener('keydown', onKey, true);
  overlay.addEventListener('click', (event) => { if (event.target === overlay && !busy) close(); });

  // ---- Stap 1: aanpassen -----------------------------------------
  function renderEdit(error = '') {
    card.innerHTML = `
      <h3>🛒 Naar boodschappenlijstje</h3>
      <p class="rpt-list-intro">Er wordt een <strong>nieuw lijstje</strong> aangemaakt met de ingrediënten van dit gerecht. Wil je eerst iets aanpassen? Haal een vinkje weg om een ingrediënt niet toe te voegen, pas een regel aan, of voeg zelf iets toe.</p>
      <label class="rpt-list-label" for="rptListName">Naam van het lijstje</label>
      <input type="text" id="rptListName" maxlength="80" value="${escapeHtml(name)}">
      <ul class="rpt-list-rows" aria-label="Ingrediënten">
        ${rows.map((row, i) => `
          <li class="rpt-list-row${row.on ? '' : ' is-off'}" data-i="${i}">
            <input type="checkbox" data-role="on" ${row.on ? 'checked' : ''} aria-label="Toevoegen">
            <input type="text" data-role="text" maxlength="200" value="${escapeHtml(row.text)}" aria-label="Ingrediënt">
          </li>`).join('')}
      </ul>
      <button type="button" class="btn btn-outline btn-sm" data-act="add">➕ Zelf iets toevoegen</button>
      <p class="rpt-list-error" aria-live="polite">${escapeHtml(error)}</p>
      <div class="rpt-list-actions">
        <button type="button" class="btn btn-outline" data-act="cancel">Annuleren</button>
        <button type="button" class="btn btn-primary" data-act="next">Volgende →</button>
      </div>`;
  }

  card.addEventListener('input', (event) => {
    const row = event.target.closest('.rpt-list-row');
    if (event.target.id === 'rptListName') { name = event.target.value; return; }
    if (!row) return;
    if (event.target.dataset.role === 'text') rows[Number(row.dataset.i)].text = event.target.value;
  });
  card.addEventListener('change', (event) => {
    const row = event.target.closest('.rpt-list-row');
    if (!row || event.target.dataset.role !== 'on') return;
    rows[Number(row.dataset.i)].on = event.target.checked;
    row.classList.toggle('is-off', !event.target.checked);
  });

  // ---- Stap 2: bevestigen ----------------------------------------
  function selectedTexts() {
    return rows.filter((r) => r.on).map((r) => r.text.trim()).filter(Boolean);
  }

  function renderConfirm(error = '') {
    const texts = selectedTexts();
    card.innerHTML = `
      <h3>Zeker weten?</h3>
      <p class="rpt-list-intro">Er wordt een nieuw boodschappenlijstje <strong>“${escapeHtml(name.trim())}”</strong> aangemaakt met <strong>${texts.length} item${texts.length === 1 ? '' : 's'}</strong>.</p>
      <ul class="rpt-list-summary">
        ${texts.slice(0, 6).map((t) => `<li>${escapeHtml(t)}</li>`).join('')}
        ${texts.length > 6 ? `<li>… en nog ${texts.length - 6}</li>` : ''}
      </ul>
      <p class="rpt-list-error" aria-live="polite">${escapeHtml(error)}</p>
      <div class="rpt-list-actions">
        <button type="button" class="btn btn-outline" data-act="back">← Terug</button>
        <button type="button" class="btn btn-primary" data-act="confirm">✅ Lijstje aanmaken</button>
      </div>`;
  }

  card.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-act]');
    if (!btn || busy) return;
    const act = btn.dataset.act;

    if (act === 'cancel') close();
    else if (act === 'back') renderEdit();
    else if (act === 'add') {
      rows.push({ text: '', on: true });
      renderEdit();
      const inputs = card.querySelectorAll('.rpt-list-row input[data-role="text"]');
      inputs[inputs.length - 1]?.focus();
    } else if (act === 'next') {
      if (!name.trim()) { renderEdit('Geef het lijstje een naam.'); return; }
      if (selectedTexts().length === 0) { renderEdit('Er is niets om toe te voegen: zet minstens één regel aan.'); return; }
      renderConfirm();
    } else if (act === 'confirm') {
      busy = true;
      btn.disabled = true;
      btn.textContent = 'Bezig…';
      const texts = selectedTexts();
      try {
        const list = await createListWithItems(name.trim(), texts);
        busy = false;
        close();
        showToast(list, texts.length);
      } catch (error) {
        console.error('Recept naar lijstje mislukt:', error);
        busy = false;
        renderConfirm(`❌ ${error.message}. Probeer het opnieuw.`);
      }
    }
  });

  renderEdit();
  document.body.appendChild(overlay);
  overlay.querySelector('#rptListName')?.focus();
}

export function setupRecipeToList({ button, getRecipe }) {
  if (!button) return;
  button.addEventListener('click', () => {
    const recipe = getRecipe();
    if (!recipe || !recipe.lines.length) {
      window.alert('Er zijn geen ingrediënten om toe te voegen.');
      return;
    }
    openDialog(recipe);
  });
}
