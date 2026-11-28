// =================================================================
// DEALTJES (dealtjes.html)
// -----------------------------------------------------------------
// Kortingen/acties, gegroepeerd per CATEGORIE (bv. "Tanken" met
// daarin Tinq en Esso).
//
// DATAMODEL (alles in één document, zoals de andere pagina's):
//   { categories: [ {
//       id, name, emoji,
//       fields: [ { id, label, type, visible } ],   <- het "soort item"
//       items:  [ { id, values: { <fieldId>: waarde }, addedAt } ]
//   } ] }
//
// VELDTYPES (FIELD_TYPES hieronder — een nieuw type toevoegen =
// een regel daar + een case in renderFieldValue / buildFieldInput /
// readFieldValue):
//   text      één regel tekst (het eerste zichtbare tekstveld is de titel)
//   longtext  beschrijving
//   link      https-link, getoond als knop (logo wordt dan ook klikbaar)
//   image     afbeelding: link naar een plaatje OF upload/slepen/plakken
//   days      ma t/m zo (leeg = elke dag)
//   tags      labels, komma-gescheiden
//
// "Soort item kiezen" = de sjablonen in config.js (siteConfig.dealtjes
// .templates). Bij het aanmaken wordt het gekozen sjabloon gekopieerd
// naar de categorie, daarna per categorie aan te passen via ✏️ (velden
// toevoegen/hernoemen/verplaatsen/verbergen/verwijderen).
//
// OPSLAG: Worker + KV (cloudflare/dealtjes/) als config.js een echte
// workerUrl heeft, anders localStorage (alleen dit apparaat).
// Uploads worden eerst klein gemaakt (resizeImage) en als data-URL in
// het document bewaard, net als bij snack-rating/kleding.
// =================================================================

import { siteConfig } from '../config.js';
import { qs, qsa, escapeHtml } from './utils.js';
import { isUserActive, onPollResume } from './poll-guard.js';
import { setupPhotoField } from './photo-field.js';

const POLL_INTERVAL_MS = 15000;
const LOCAL_KEY = 'dealtjes-data-v1';
const MAX_ORIGINAL_UPLOAD_BYTES = 15 * 1024 * 1024;
const RESIZE_MAX_DIMENSION = 512;
const DAYS = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'];
const DAYS_LONG = ['Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag', 'Zondag'];

const FIELD_TYPES = {
  text: 'Tekst (1 regel)',
  longtext: 'Beschrijving (lange tekst)',
  link: 'Link',
  image: 'Afbeelding / logo',
  days: 'Dagen',
  tags: 'Labels',
};

const FALLBACK_TEMPLATES = [
  {
    id: 'deal', emoji: '🏷️', label: 'Dealtje', description: 'Naam, logo, link, beschrijving en dagen',
    fields: [
      { label: 'Naam', type: 'text', visible: true },
      { label: 'Logo', type: 'image', visible: true },
      { label: 'Link', type: 'link', visible: true },
      { label: 'Beschrijving', type: 'longtext', visible: true },
      { label: 'Dagen', type: 'days', visible: true },
    ],
  },
];

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const todayIndex = () => (new Date().getDay() + 6) % 7; // 0 = maandag

function safeUrl(value) {
  try {
    const u = new URL(String(value || '').trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
  } catch {
    return '';
  }
}

function safeImage(value) {
  const v = String(value || '').trim();
  if (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(v)) return v;
  return safeUrl(v);
}

function cloneFields(fields) {
  return fields.map((f) => ({ id: f.id || `f_${newId().slice(0, 8)}`, label: f.label || '', type: FIELD_TYPES[f.type] ? f.type : 'text', visible: f.visible !== false }));
}

// File -> kleine data-URL. Houdt transparantie (logo's!) vast door WebP/PNG
// te gebruiken voor png/webp/gif, en JPEG voor foto's.
function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Kon bestand niet lezen'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Kon geen geldige afbeelding lezen'));
      img.onload = () => {
        const w = img.naturalWidth || img.width || 300;
        const h = img.naturalHeight || img.height || 300;
        const scale = Math.min(1, RESIZE_MAX_DIMENSION / Math.max(w, h));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const keepAlpha = /png|webp|gif|svg/.test(file.type);
        resolve(keepAlpha ? canvas.toDataURL('image/webp', 0.9) : canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export function initDealtjes() {
  const root = document.getElementById('dealtjesApp');
  if (!root) return; // not on this page

  const workerUrl = siteConfig.dealtjes?.workerUrl || '';
  const templates = siteConfig.dealtjes?.templates?.length ? siteConfig.dealtjes.templates : FALLBACK_TEMPLATES;
  const remote = Boolean(workerUrl) && !workerUrl.includes('YOUR-SUBDOMAIN');

  const statusEl = qs('#dlStatus', root);
  const listEl = qs('#dlCategories', root);
  const emptyEl = qs('#dlEmpty', root);
  const todayBtn = qs('#dlTodayToggle', root);
  const viewCategoriesBtn = qs('#dlViewCategories', root);
  const viewAllBtn = qs('#dlViewAll', root);
  const addCategoryBtn = qs('#dlAddCategory', root);
  const overlay = document.getElementById('dlModalOverlay');
  const modalTitle = document.getElementById('dlModalTitle');
  const modalBody = document.getElementById('dlModalBody');
  const modalClose = document.getElementById('dlModalClose');

  let data = { categories: [] };
  let updatedAt = null;
  let saving = false;
  let savePending = false;
  let todayOnly = false;
  // Eén dagkeuze voor ALLES (Per categorie én Alles samen): 'all' | 0..6.
  // "Alleen vandaag" gaat boven deze keuze (zie effectiveDay()).
  let selectedDay = 'all';
  let viewMode = 'categories'; // 'categories' = één blok per categorie | 'all' = alles samen in één blok
  const editing = new Set(); // categoryId (of ALL_KEY): ✏️ Wijzigen staat daar aan
  const ALL_KEY = '__all';

  if (!remote) qs('#dlLocalNotice', root)?.classList.remove('hidden');

  function setStatus(text, isError = false) {
    statusEl.textContent = text;
    statusEl.classList.toggle('dl-status-error', isError);
    statusEl.classList.toggle('hidden', !text);
  }

  // ---- Opslag -----------------------------------------------------

  function normalize(raw) {
    const cats = Array.isArray(raw?.categories) ? raw.categories : [];
    return {
      categories: cats.map((c) => ({
        id: c.id || newId(),
        name: c.name || 'Categorie',
        emoji: c.emoji || '',
        fields: cloneFields(Array.isArray(c.fields) ? c.fields : []),
        items: (Array.isArray(c.items) ? c.items : []).map((it) => ({ id: it.id || newId(), values: it.values || {}, addedAt: it.addedAt || 0 })),
      })),
    };
  }

  async function load({ silent = false } = {}) {
    if (!remote) {
      try { data = normalize(JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null')); } catch { data = { categories: [] }; }
      render();
      return;
    }
    if (!silent) setStatus('Laden…');
    try {
      const url = `${workerUrl}/dealtjes${silent && updatedAt ? `?since=${encodeURIComponent(updatedAt)}` : ''}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload.unchanged) {
        data = normalize(payload.data);
        updatedAt = payload.updatedAt || null;
        render();
      }
      setStatus('');
    } catch (error) {
      console.error('Kon dealtjes niet laden:', error);
      if (!silent) setStatus('❌ Kon dealtjes niet laden. Probeer het opnieuw.', true);
    }
  }

  async function persist() {
    if (!remote) {
      try {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
        setStatus('');
      } catch {
        setStatus('⚠️ Opslaan mislukt: de browser-opslag zit vol (te veel/grote afbeeldingen?).', true);
      }
      return;
    }
    if (saving) { savePending = true; return; }
    saving = true;
    try {
      const response = await fetch(`${workerUrl}/dealtjes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      updatedAt = payload.updatedAt || updatedAt;
      setStatus('');
    } catch (error) {
      console.error('Kon wijziging niet opslaan:', error);
      setStatus('⚠️ Wijziging niet opgeslagen (te grote afbeelding?), laatste versie wordt hersteld…', true);
      updatedAt = null;
      await load({ silent: true });
    } finally {
      saving = false;
      if (savePending) { savePending = false; persist(); }
    }
  }

  function commit() {
    render();
    persist();
  }

  // ---- Helpers over categorieën/items -----------------------------

  const getCat = (id) => data.categories.find((c) => c.id === id);
  const daysField = (cat) => cat.fields.find((f) => f.type === 'days');

  function itemTitle(cat, item) {
    const f = cat.fields.find((x) => x.type === 'text' && String(item.values[x.id] || '').trim());
    return f ? String(item.values[f.id]).trim() : 'dealtje';
  }

  const effectiveDay = () => (todayOnly ? todayIndex() : selectedDay);

  function matchesFilter(cat, item, filter) {
    if (filter === 'all') return true;
    const f = daysField(cat);
    const picked = Array.isArray(item.values[f.id]) ? item.values[f.id] : [];
    return picked.includes(filter); // "Alle" = alle 7 dagen aangevinkt
  }

  // Alle items van alle categorieën die bij de gekozen dag horen (voor de gecombineerde weergave).
  function combinedItems() {
    const filter = effectiveDay();
    const out = [];
    data.categories.forEach((cat) => {
      cat.items.forEach((item) => {
        if (filter === 'all' || (daysField(cat) && matchesFilter(cat, item, filter))) out.push({ cat, item });
      });
    });
    return out;
  }

  // ---- Rendering ----------------------------------------------------

  function renderFieldValue(field, value, ctx) {
    if (value == null || value === '' || (Array.isArray(value) && !value.length)) return '';
    switch (field.type) {
      case 'text': {
        const text = escapeHtml(value);
        if (!ctx.titleDone) { ctx.titleDone = true; return `<h3 class="dl-card-title">${text}</h3>`; }
        return `<p class="dl-card-line">${text}</p>`;
      }
      case 'longtext':
        return `<p class="dl-card-desc">${escapeHtml(value)}</p>`;
      case 'link': {
        const href = safeUrl(value);
        return href ? `<a class="btn btn-outline btn-sm dl-card-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">🔗 ${escapeHtml(field.label || 'Link')}</a>` : '';
      }
      case 'image': {
        const src = safeImage(value);
        return src ? `<img class="dl-card-extra-img" src="${escapeHtml(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '';
      }
      case 'days': {
        const picked = (Array.isArray(value) ? value : []).filter((d) => d >= 0 && d <= 6).sort();
        if (!picked.length) return '';
        const t = todayIndex();
        if (new Set(picked).size === 7) {
          return `<div class="dl-days" aria-label="${escapeHtml(field.label)}"><span class="dl-day dl-day-all dl-day-today" title="Elke dag">Alle</span></div>`;
        }
        return `<div class="dl-days" aria-label="${escapeHtml(field.label)}">${picked
          .map((d) => `<span class="dl-day${d === t ? ' dl-day-today' : ''}" title="${DAYS_LONG[d]}">${DAYS[d]}</span>`).join('')}</div>`;
      }
      case 'tags': {
        const tags = String(Array.isArray(value) ? value.join(',') : value).split(',').map((t) => t.trim()).filter(Boolean);
        return tags.length ? `<div class="dl-tags">${tags.map((t) => `<span class="dl-tag">${escapeHtml(t)}</span>`).join('')}</div>` : '';
      }
      default:
        return '';
    }
  }

  function renderCard(cat, item, { editable = false, showCategory = false } = {}) {
    const visible = cat.fields.filter((f) => f.visible !== false);
    const firstImageField = visible.find((f) => f.type === 'image' && safeImage(item.values[f.id]));

    // Een link die NIET op de kaart staat (Tonen uit) maakt het logo klikbaar.
    // Een link met Tonen aan wordt een knop met de veldnaam (bv. "Google Maps").
    // Staat er alleen een zichtbare link, dan is het logo daar ook klikbaar.
    const linkValue = (f) => (f.type === 'link' ? safeUrl(item.values[f.id]) : '');
    const hiddenLink = cat.fields.find((f) => f.visible === false && linkValue(f));
    const shownLink = visible.find((f) => linkValue(f));
    const href = hiddenLink ? linkValue(hiddenLink) : (shownLink ? linkValue(shownLink) : '');

    let imageHtml = '';
    if (firstImageField) {
      const img = `<img src="${escapeHtml(safeImage(item.values[firstImageField.id]))}" alt="${escapeHtml(itemTitle(cat, item))}" loading="lazy" referrerpolicy="no-referrer">`;
      imageHtml = href
        ? `<a class="dl-card-image" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${img}</a>`
        : `<div class="dl-card-image">${img}</div>`;
    }

    const ctx = { titleDone: false };
    const body = visible
      .filter((f) => f !== firstImageField)
      .map((f) => renderFieldValue(f, item.values[f.id], ctx))
      .join('');

    const title = escapeHtml(itemTitle(cat, item));
    const catTag = showCategory
      ? `<p class="dl-card-cat">${cat.emoji ? `${escapeHtml(cat.emoji)} ` : ''}${escapeHtml(cat.name)}</p>`
      : '';
    return `
      <article class="dl-card" data-item="${escapeHtml(item.id)}" data-cat="${escapeHtml(cat.id)}">
        ${imageHtml}
        <div class="dl-card-body">${catTag}${body || (imageHtml ? '' : '<p class="dl-card-line">(leeg)</p>')}</div>
        ${editable ? `<div class="dl-card-actions">
          <button type="button" class="dl-icon-btn" data-action="edit-item" aria-label="${title} bewerken">✏️</button>
          <button type="button" class="dl-icon-btn dl-danger" data-action="delete-item" aria-label="${title} verwijderen">✕</button>
        </div>` : ''}
      </article>`;
  }

  function dayChips(filter) {
    return `<div class="dl-day-filter" role="tablist" aria-label="Dag kiezen">
        <button type="button" class="dl-chip" role="tab" data-action="filter" data-day="all" aria-selected="${filter === 'all'}">Alle dagen</button>
        ${DAYS.map((d, i) => `<button type="button" class="dl-chip" role="tab" data-action="filter" data-day="${i}" aria-selected="${filter === i}" title="${DAYS_LONG[i]}">${d}</button>`).join('')}
      </div>`;
  }

  function footButtons(key, addAction, addLabel) {
    const on = editing.has(key);
    return `<div class="dl-category-foot">
        <button type="button" class="btn btn-outline" data-action="${addAction}">${addLabel}</button>
        <button type="button" class="btn btn-outline dl-edit-toggle" data-action="toggle-edit" aria-pressed="${on}">✏️ Wijzigen</button>
      </div>`;
  }

  function renderCategory(cat, index) {
    const hasDays = Boolean(daysField(cat));
    const filter = effectiveDay();
    // Zelfde regel als in "Alles samen": bij een gekozen dag alleen items met die dag.
    const shown = cat.items.filter((it) => filter === 'all' || (hasDays && matchesFilter(cat, it, filter)));

    const chips = hasDays ? dayChips(filter) : '';
    const editable = editing.has(cat.id);

    let content;
    if (cat.items.length === 0) content = '<p class="dl-no-items">Nog geen dealtjes in deze categorie.</p>';
    else if (shown.length === 0) content = '<p class="dl-no-items">Geen dealtjes op deze dag.</p>';
    else content = `<div class="dl-grid">${shown.map((it) => renderCard(cat, it, { editable })).join('')}</div>`;

    const name = escapeHtml(cat.name);
    return `
      <section class="dl-category" data-cat="${escapeHtml(cat.id)}" aria-label="${name}">
        <div class="dl-category-head">
          <h2 class="dl-category-title">${cat.emoji ? `${escapeHtml(cat.emoji)} ` : ''}${name}</h2>
          <div class="dl-category-actions">
            <button type="button" class="dl-icon-btn" data-action="cat-up" aria-label="${name} omhoog" ${index === 0 ? 'disabled' : ''}>↑</button>
            <button type="button" class="dl-icon-btn" data-action="cat-down" aria-label="${name} omlaag" ${index === data.categories.length - 1 ? 'disabled' : ''}>↓</button>
            <button type="button" class="dl-icon-btn" data-action="edit-cat" aria-label="Categorie ${name} aanpassen">✏️</button>
          </div>
        </div>
        ${chips}
        ${content}
        ${footButtons(cat.id, 'add-item', `➕ Toevoegen aan ${name}`)}
      </section>`;
  }

  // "Alles samen": één groot blok met de items van alle categorieën voor de gekozen dag.
  function renderCombined() {
    const filter = effectiveDay();
    const items = combinedItems();
    const editable = editing.has(ALL_KEY);
    const title = filter === 'all'
      ? 'Alle dagen'
      : `${DAYS_LONG[filter]}${filter === todayIndex() ? ' (vandaag)' : ''}`;
    const content = items.length
      ? `<div class="dl-grid">${items.map(({ cat, item }) => renderCard(cat, item, { editable, showCategory: true })).join('')}</div>`
      : '<p class="dl-no-items">Geen dealtjes op deze dag.</p>';
    return `
      <section class="dl-category" data-combined="1" aria-label="${escapeHtml(title)}">
        <div class="dl-category-head">
          <h2 class="dl-category-title">🗓️ ${escapeHtml(title)}</h2>
        </div>
        ${dayChips(filter)}
        ${content}
        ${footButtons(ALL_KEY, 'add-any', '➕ Toevoegen')}
      </section>`;
  }

  function render() {
    emptyEl.classList.toggle('hidden', data.categories.length > 0);
    listEl.innerHTML = data.categories.length === 0
      ? ''
      : (viewMode === 'all' ? renderCombined() : data.categories.map(renderCategory).join(''));
    todayBtn.setAttribute('aria-pressed', String(todayOnly));
    viewCategoriesBtn.setAttribute('aria-pressed', String(viewMode === 'categories'));
    viewAllBtn.setAttribute('aria-pressed', String(viewMode === 'all'));
  }

  // ---- Popup basis --------------------------------------------------

  function openModal(title, node) {
    modalTitle.textContent = title;
    modalBody.innerHTML = '';
    modalBody.appendChild(node);
    overlay.classList.remove('hidden');
    document.body.classList.add('dl-modal-open');
    overlay.scrollTop = 0;
  }
  function closeModal() {
    overlay.classList.add('hidden');
    document.body.classList.remove('dl-modal-open');
    modalBody.innerHTML = '';
  }
  modalClose.addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.classList.contains('hidden')) closeModal(); });

  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  // ---- Popup: categorie kiezen (bij "Toevoegen" in de weergave Alles samen) --

  function openCategoryPicker() {
    const node = el(`
      <div class="dl-form">
        <p class="dl-hint dl-center-text">In welke categorie wil je iets toevoegen?</p>
        <div class="dl-picker">
          ${data.categories.map((c) => `<button type="button" class="dl-template dl-picker-btn" data-cat="${escapeHtml(c.id)}"><strong>${c.emoji ? `${escapeHtml(c.emoji)} ` : ''}${escapeHtml(c.name)}</strong><span>${c.items.length} item${c.items.length === 1 ? '' : 's'}</span></button>`).join('')}
        </div>
        <div class="dl-form-buttons"><button type="button" class="btn btn-outline" data-cancel>Annuleren</button></div>
      </div>`);
    qsa('[data-cat]', node).forEach((b) => b.addEventListener('click', () => openItemModal(b.dataset.cat, null)));
    qs('[data-cancel]', node).addEventListener('click', closeModal);
    openModal('Toevoegen aan…', node);
  }

  // ---- Popup: categorie aanmaken / aanpassen ---------------------------

  function openCategoryModal(catId) {
    const existing = catId ? getCat(catId) : null;
    const work = {
      name: existing?.name || '',
      emoji: existing?.emoji || '',
      fields: cloneFields(existing ? existing.fields : templates[0].fields),
      templateId: existing ? null : templates[0].id,
    };
    if (!existing && !work.emoji) work.emoji = templates[0].emoji || '';

    const form = el(`
      <form class="dl-form" novalidate>
        <div class="dl-field">
          <span class="dl-label">Naam en icoontje</span>
          <div class="dl-row">
            <input type="text" class="dl-emoji-input" maxlength="4" placeholder="Icoon" title="Leeg laten = geen icoon" aria-label="Icoon (emoji), leeg laten voor geen icoon" value="${escapeHtml(work.emoji)}">
            <input type="text" class="dl-name-input" maxlength="80" placeholder="Naam (bv. Tanken)" aria-label="Naam van de categorie" value="${escapeHtml(work.name)}">
          </div>
        </div>
        ${existing ? '' : `
        <div class="dl-field">
          <span class="dl-label">Wat voor soort items komen hierin?</span>
          <div class="dl-templates">
            ${templates.map((t) => `<button type="button" class="dl-template" data-template="${escapeHtml(t.id)}" aria-pressed="${t.id === work.templateId}"><strong>${escapeHtml(t.emoji || '')} ${escapeHtml(t.label)}</strong><span>${escapeHtml(t.description || '')}</span></button>`).join('')}
          </div>
        </div>`}
        <div class="dl-field">
          <span class="dl-label">Velden van elk item (je kunt dit altijd later nog aanpassen)</span>
          <div class="dl-fields"></div>
          <div class="dl-center"><button type="button" class="btn btn-outline btn-sm" data-add-field>➕ Veld toevoegen</button></div>
        </div>
        <p class="dl-form-error" aria-live="polite"></p>
        <div class="dl-form-buttons">
          <button type="submit" class="btn btn-primary">${existing ? 'Opslaan' : 'Categorie aanmaken'}</button>
          <button type="button" class="btn btn-outline" data-cancel>Annuleren</button>
        </div>
        ${existing ? '<div class="dl-form-buttons"><button type="button" class="btn btn-outline dl-btn-danger" data-delete>🗑️ Categorie verwijderen</button></div>' : ''}
      </form>`);

    const fieldsEl = qs('.dl-fields', form);
    const errorEl = qs('.dl-form-error', form);
    const nameInput = qs('.dl-name-input', form);
    const emojiInput = qs('.dl-emoji-input', form);

    function renderFields() {
      fieldsEl.innerHTML = work.fields.map((f, i) => `
        <div class="dl-field-row" data-i="${i}">
          <div class="dl-field-move">
            <button type="button" class="dl-icon-btn" data-act="up" aria-label="Veld omhoog" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button type="button" class="dl-icon-btn" data-act="down" aria-label="Veld omlaag" ${i === work.fields.length - 1 ? 'disabled' : ''}>↓</button>
          </div>
          <div class="dl-field-row-main">
            <input type="text" data-prop="label" maxlength="40" placeholder="Veldnaam" aria-label="Veldnaam" value="${escapeHtml(f.label)}">
            <select data-prop="type" aria-label="Soort veld">
              ${Object.entries(FIELD_TYPES).map(([k, v]) => `<option value="${k}" ${k === f.type ? 'selected' : ''}>${v}</option>`).join('')}
            </select>
            <label class="dl-check"><input type="checkbox" data-prop="visible" ${f.visible ? 'checked' : ''}> Tonen</label>
          </div>
          <button type="button" class="dl-icon-btn dl-danger" data-act="remove" aria-label="Veld verwijderen">✕</button>
        </div>`).join('') || '<p class="dl-hint">Nog geen velden. Voeg er minstens één toe.</p>';
    }
    renderFields();

    fieldsEl.addEventListener('input', (e) => {
      const row = e.target.closest('.dl-field-row');
      if (!row || e.target.dataset.prop !== 'label') return;
      work.fields[Number(row.dataset.i)].label = e.target.value;
    });
    fieldsEl.addEventListener('change', (e) => {
      const row = e.target.closest('.dl-field-row');
      const prop = e.target.dataset.prop;
      if (!row || !prop || prop === 'label') return;
      const f = work.fields[Number(row.dataset.i)];
      if (prop === 'visible') f.visible = e.target.checked;
      if (prop === 'type') f.type = e.target.value;
    });
    fieldsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const i = Number(btn.closest('.dl-field-row').dataset.i);
      const act = btn.dataset.act;
      if (act === 'remove') work.fields.splice(i, 1);
      if (act === 'up' && i > 0) [work.fields[i - 1], work.fields[i]] = [work.fields[i], work.fields[i - 1]];
      if (act === 'down' && i < work.fields.length - 1) [work.fields[i + 1], work.fields[i]] = [work.fields[i], work.fields[i + 1]];
      renderFields();
    });

    qs('[data-add-field]', form).addEventListener('click', () => {
      work.fields.push({ id: `f_${newId().slice(0, 8)}`, label: '', type: 'text', visible: true });
      renderFields();
      fieldsEl.querySelector('.dl-field-row:last-child input[type="text"]')?.focus();
    });

    qsa('[data-template]', form).forEach((btn) => btn.addEventListener('click', () => {
      const t = templates.find((x) => x.id === btn.dataset.template);
      if (!t) return;
      work.templateId = t.id;
      work.fields = cloneFields(t.fields.map((f) => ({ ...f, id: undefined })));
      qsa('[data-template]', form).forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      if (!emojiInput.value.trim() || templates.some((x) => x.emoji === emojiInput.value.trim())) emojiInput.value = t.emoji || '';
      renderFields();
    }));

    qs('[data-cancel]', form).addEventListener('click', closeModal);

    qs('[data-delete]', form)?.addEventListener('click', () => {
      if (!window.confirm(`Categorie “${existing.name}” met alle ${existing.items.length} items verwijderen?`)) return;
      data.categories = data.categories.filter((c) => c.id !== existing.id);
      closeModal();
      commit();
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = nameInput.value.trim();
      if (!name) { errorEl.textContent = 'Geef de categorie een naam.'; nameInput.focus(); return; }
      const fields = work.fields.map((f, i) => ({ ...f, label: f.label.trim() || `Veld ${i + 1}` }));
      if (!fields.length) { errorEl.textContent = 'Voeg minstens één veld toe.'; return; }

      if (existing) {
        const keep = new Set(fields.map((f) => f.id));
        const removed = existing.fields.filter((f) => !keep.has(f.id));
        const hasData = removed.some((f) => existing.items.some((it) => it.values[f.id] != null && it.values[f.id] !== ''));
        if (hasData && !window.confirm('Je verwijdert velden waar al iets in is ingevuld. Die gegevens gaan verloren. Doorgaan?')) return;
        existing.items.forEach((it) => removed.forEach((f) => { delete it.values[f.id]; }));
        existing.name = name;
        existing.emoji = emojiInput.value.trim();
        existing.fields = fields;
      } else {
        data.categories.push({ id: newId(), name, emoji: emojiInput.value.trim(), fields, items: [] });
      }
      closeModal();
      commit();
    });

    openModal(existing ? `Categorie aanpassen` : 'Nieuwe categorie', form);
    nameInput.focus();
  }

  // ---- Popup: item toevoegen / aanpassen -------------------------------

  function dispatchFile(input, file) {
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change'));
    } catch { /* oudere browsers: dan werkt plakken alleen als een veld focus heeft */ }
  }

  function buildFieldInput(field, value) {
    const label = escapeHtml(field.label);
    switch (field.type) {
      case 'longtext':
        return `<div class="dl-field"><label class="dl-label">${label}<textarea data-f="${field.id}" maxlength="1500" rows="3">${escapeHtml(value || '')}</textarea></label></div>`;
      case 'link':
        return `<div class="dl-field"><label class="dl-label">${label}<input type="url" data-f="${field.id}" maxlength="2000" placeholder="https://…" value="${escapeHtml(value || '')}"></label></div>`;
      case 'days': {
        const picked = Array.isArray(value) ? value : [];
        return `<div class="dl-field"><span class="dl-label">${label}</span>
          <div class="dl-day-picker" data-f="${field.id}" role="group" aria-label="${label}">
            <button type="button" class="dl-chip" data-all aria-pressed="${DAYS.every((_, i) => picked.includes(i))}" title="Alle dagen">Alle</button>
            ${DAYS.map((d, i) => `<button type="button" class="dl-chip" data-day="${i}" aria-pressed="${picked.includes(i)}" title="${DAYS_LONG[i]}">${d}</button>`).join('')}
          </div></div>`;
      }
      case 'tags':
        return `<div class="dl-field"><label class="dl-label">${label}<input type="text" data-f="${field.id}" maxlength="300" placeholder="komma, gescheiden" value="${escapeHtml(value || '')}"></label></div>`;
      case 'image':
        return `
          <div class="dl-field dl-image-field" data-f="${field.id}">
            <span class="dl-label">${label}</span>
            <input type="url" class="dl-image-url" maxlength="2000" placeholder="Link naar een afbeelding (https://…)" aria-label="${label}: link naar afbeelding">
            <label class="gf-add-photo-label">
              📷 …of upload een bestand
              <span class="gf-add-photo-filename" data-default-text="Kies bestand" aria-hidden="true">Kies bestand</span>
              <input type="file" class="gf-add-photo" accept="image/jpeg,image/png,image/webp,image/gif" aria-label="${label}: bestand kiezen">
            </label>
            <p class="gf-dropzone-hint">…of sleep een plaatje hierheen (ook van een andere website) of plak het met Ctrl+V. Een upload gaat voor op de link.</p>
            <div class="gf-photo-preview hidden">
              <img class="gf-photo-preview-img" alt="Voorbeeld" referrerpolicy="no-referrer">
              <button type="button" class="gf-photo-clear" aria-label="Afbeelding verwijderen">✕</button>
            </div>
          </div>`;
      default: // text
        return `<div class="dl-field"><label class="dl-label">${label}<input type="text" data-f="${field.id}" maxlength="200" value="${escapeHtml(value || '')}"></label></div>`;
    }
  }

  function openItemModal(catId, itemId) {
    const cat = getCat(catId);
    if (!cat) return;
    const existing = itemId ? cat.items.find((i) => i.id === itemId) : null;
    const values = existing?.values || {};

    const form = el(`
      <form class="dl-form" novalidate>
        ${cat.fields.map((f) => buildFieldInput(f, values[f.id])).join('') || '<p class="dl-hint">Deze categorie heeft nog geen velden: pas de categorie eerst aan (✏️).</p>'}
        <p class="dl-form-error" aria-live="polite"></p>
        <div class="dl-form-buttons">
          <button type="submit" class="btn btn-primary">${existing ? 'Opslaan' : 'Toevoegen'}</button>
          <button type="button" class="btn btn-outline" data-cancel>Annuleren</button>
        </div>
        ${existing ? '<div class="dl-form-buttons"><button type="button" class="btn btn-outline dl-btn-danger" data-delete>🗑️ Verwijderen</button></div>' : ''}
      </form>`);
    const errorEl = qs('.dl-form-error', form);

    // dagen-knoppen
    // "Alle" vinkt alle 7 dagen aan (of weer uit); staan alle 7 aan, dan staat "Alle" vanzelf ook aan.
    qsa('.dl-day-picker', form).forEach((group) => {
      const dayBtns = qsa('[data-day]', group);
      const allBtn = qs('[data-all]', group);
      const sync = () => allBtn.setAttribute('aria-pressed', String(dayBtns.every((b) => b.getAttribute('aria-pressed') === 'true')));
      group.addEventListener('click', (e) => {
        if (e.target.closest('[data-all]')) {
          const turnOn = allBtn.getAttribute('aria-pressed') !== 'true';
          dayBtns.forEach((b) => b.setAttribute('aria-pressed', String(turnOn)));
          sync();
          return;
        }
        const b = e.target.closest('[data-day]');
        if (b) { b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); sync(); }
      });
    });

    // afbeeldingsvelden
    const images = {};
    qsa('.dl-image-field', form).forEach((box) => {
      const fid = box.dataset.f;
      const urlInput = qs('.dl-image-url', box);
      const fileInput = qs('input[type="file"]', box);
      const ctl = setupPhotoField(box, { errorEl, maxBytes: MAX_ORIGINAL_UPLOAD_BYTES });
      const state = { ctl, urlInput, fileInput, keep: '' };
      const current = values[fid] ? safeImage(values[fid]) : '';
      if (current) {
        if (current.startsWith('data:')) state.keep = current;
        else urlInput.value = current;
        ctl.showExisting(current);
      }
      urlInput.addEventListener('input', () => {
        const u = safeImage(urlInput.value);
        state.keep = '';
        ctl.showExisting(u || '');
      });
      fileInput.addEventListener('change', () => { if (fileInput.files?.length) { urlInput.value = ''; state.keep = ''; } });
      qs('.gf-photo-clear', box).addEventListener('click', () => { urlInput.value = ''; state.keep = ''; });
      images[fid] = state;
    });

    // Ctrl+V ergens in het formulier -> eerste afbeeldingsveld
    form.addEventListener('paste', (e) => {
      if (e.target.closest('.dl-image-field')) return; // regelt photo-field zelf
      const file = Array.from(e.clipboardData?.files || []).find((f) => f.type.startsWith('image/'));
      const first = Object.values(images)[0];
      if (!file || !first) return;
      e.preventDefault();
      dispatchFile(first.fileInput, file);
    });

    qs('[data-cancel]', form).addEventListener('click', closeModal);
    qs('[data-delete]', form)?.addEventListener('click', () => {
      if (!window.confirm(`“${itemTitle(cat, existing)}” verwijderen?`)) return;
      cat.items = cat.items.filter((i) => i.id !== existing.id);
      closeModal();
      commit();
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.textContent = '';
      const submitBtn = qs('button[type="submit"]', form);
      await Promise.all(Object.values(images).map((s) => s.ctl.whenReady())); // plaatje van andere website kan nog laden
      const out = {};

      for (const f of cat.fields) {
        if (f.type === 'image') {
          const s = images[f.id];
          const file = s.ctl.getFile();
          if (file) {
            submitBtn.disabled = true;
            try { out[f.id] = await resizeImage(file); } catch (err) { submitBtn.disabled = false; errorEl.textContent = err.message; return; }
          } else if (s.urlInput.value.trim()) {
            const u = safeUrl(s.urlInput.value);
            if (!u) { errorEl.textContent = `${f.label}: dat lijkt geen geldige link.`; return; }
            out[f.id] = u;
          } else {
            out[f.id] = s.keep || '';
          }
          continue;
        }
        if (f.type === 'days') {
          const group = qs(`.dl-day-picker[data-f="${f.id}"]`, form);
          out[f.id] = qsa('[data-day]', group).filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => Number(b.dataset.day));
          continue;
        }
        const input = qs(`[data-f="${f.id}"]`, form);
        const v = input ? input.value.trim() : '';
        if (f.type === 'link' && v && !safeUrl(v)) { errorEl.textContent = `${f.label}: dat lijkt geen geldige link.`; return; }
        out[f.id] = f.type === 'link' && v ? safeUrl(v) : v;
      }

      const filled = Object.values(out).some((v) => (Array.isArray(v) ? v.length : String(v || '').trim()));
      if (!filled) { errorEl.textContent = 'Vul minstens één veld in.'; submitBtn.disabled = false; return; }

      if (existing) existing.values = out;
      else cat.items.push({ id: newId(), values: out, addedAt: Date.now() });
      closeModal();
      commit();
    });

    openModal(existing ? 'Item aanpassen' : `Toevoegen aan ${cat.name}`, form);
    qs('input[type="text"], input[type="url"], textarea', form)?.focus();
  }

  // ---- Wiring --------------------------------------------------------

  addCategoryBtn.addEventListener('click', () => openCategoryModal(null));

  todayBtn.addEventListener('click', () => {
    todayOnly = !todayOnly;
    render();
  });
  viewCategoriesBtn.addEventListener('click', () => { viewMode = 'categories'; render(); });
  viewAllBtn.addEventListener('click', () => { viewMode = 'all'; render(); });

  listEl.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const sectionEl = btn.closest('.dl-category');
    const combined = Boolean(sectionEl?.dataset.combined);
    const cardEl = btn.closest('.dl-card');
    // Op een kaart (ook in "Alles samen") bepaalt de kaart zelf bij welke categorie hij hoort.
    const cat = getCat((cardEl || sectionEl)?.dataset.cat);

    if (action === 'toggle-edit') {
      const key = combined ? ALL_KEY : cat?.id;
      if (!key) return;
      if (editing.has(key)) editing.delete(key); else editing.add(key);
      render();
    } else if (action === 'filter') {
      todayOnly = false;
      selectedDay = btn.dataset.day === 'all' ? 'all' : Number(btn.dataset.day);
      render();
    } else if (action === 'add-any') {
      openCategoryPicker();
    } else if (!cat) {
      // geen categorie bekend: niets te doen
    } else if (action === 'edit-cat') {
      openCategoryModal(cat.id);
    } else if (action === 'cat-up' || action === 'cat-down') {
      const i = data.categories.indexOf(cat);
      const j = action === 'cat-up' ? i - 1 : i + 1;
      if (j < 0 || j >= data.categories.length) return;
      [data.categories[i], data.categories[j]] = [data.categories[j], data.categories[i]];
      commit();
    } else if (action === 'add-item') {
      openItemModal(cat.id, null);
    } else if (action === 'edit-item') {
      openItemModal(cat.id, cardEl.dataset.item);
    } else if (action === 'delete-item') {
      const item = cat.items.find((i) => i.id === cardEl.dataset.item);
      if (!item || !window.confirm(`“${itemTitle(cat, item)}” verwijderen?`)) return;
      cat.items = cat.items.filter((i) => i.id !== item.id);
      commit();
    }
  });

  // ---- Synchroniseren met de andere persoon (alleen met Worker) ---------

  if (remote) {
    setInterval(() => {
      if (isUserActive() && !saving && overlay.classList.contains('hidden')) load({ silent: true });
    }, POLL_INTERVAL_MS);
    onPollResume(() => { if (!saving && overlay.classList.contains('hidden')) load({ silent: true }); });
  }

  load();
}
