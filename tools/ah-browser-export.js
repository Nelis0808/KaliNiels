/* =================================================================
   AH-RECEPTEN — OPHALEN IN JE EIGEN BROWSER (tools/ah-browser-export.js)
   -----------------------------------------------------------------
   Albert Heijn blokkeert de IP-adressen van Cloudflare (waar de Worker
   op draait), maar een gewone browser van een gewone thuisverbinding
   niet. Dit script draait daarom IN JE BROWSER, op de pagina van ah.nl
   zelf (zelfde website = geen CORS-problemen), en haalt rustig, met
   pauzes tussen elke aanvraag, alles op:
     1. elke lijst uit config.js (categorie + subcategorie, 2 pagina's),
     2. daarna de details (ingrediënten + bereidingswijze) van elk recept.
   Het resultaat wordt als bestand "ah-recepten-export.json" opgeslagen.
   Dat bestand laad je op dev.html in; de Worker bewaart het daarna als
   backup.

   Niet zelf plakken: dev.html maakt de complete tekst voor je, met de
   lijsten al ingevuld (window.__AH_LISTS) en een "Kopieer"-knop.

   Stoppen kan altijd: klik op "Stop" in de balk bovenaan of typ ahStop().
   Wat dan al binnen is, wordt alsnog opgeslagen.

   De helperfuncties hieronder zijn kopieën van die in
   cloudflare/ah-recepten/ah_recepten_worker.js (zelfde uitvoerformaat).
   ================================================================= */
(async () => {
  'use strict';

  const AH_ORIGIN = 'https://www.ah.nl';
  const LISTS = Array.isArray(window.__AH_LISTS) ? window.__AH_LISTS : [];
  const OPTIONS = Object.assign(
    { pagesPerList: 2, maxDetails: 3000, delayMinMs: 900, delayMaxMs: 1900 },
    window.__AH_OPTIONS || {}
  );
  const AH_RECIPE_PATH_RE = /^\/allerhande\/recept\/(R-[A-Za-z0-9]+)(\/[^?#]*)?$/;

  // ---- Controle: staan we op ah.nl? --------------------------------------
  if (!/(^|\.)ah\.nl$/.test(location.hostname)) {
    alert('Open eerst https://www.ah.nl/allerhande in dit tabblad en plak het script daar opnieuw.');
    return;
  }
  if (LISTS.length === 0) {
    alert('Er zijn geen lijsten ingevuld. Kopieer het script opnieuw vanaf de dev-pagina.');
    return;
  }

  // ---- Balk met voortgang + Stop --------------------------------------------
  let stopRequested = false;
  window.ahStop = () => { stopRequested = true; };
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;z-index:2147483647;top:0;left:0;right:0;padding:10px 14px;background:#0b5cff;color:#fff;font:600 14px/1.4 system-ui,sans-serif;display:flex;gap:12px;align-items:center;box-shadow:0 2px 8px rgba(0,0,0,.4)';
  const bannerText = document.createElement('span');
  bannerText.style.flex = '1';
  const stopBtn = document.createElement('button');
  stopBtn.textContent = 'Stop en bewaar';
  stopBtn.style.cssText = 'padding:6px 12px;border:0;border-radius:6px;font-weight:700;cursor:pointer';
  stopBtn.onclick = () => { stopRequested = true; stopBtn.disabled = true; };
  banner.append(bannerText, stopBtn);
  document.body.appendChild(banner);
  const say = (text) => { bannerText.textContent = text; console.log('[AH-export] ' + text); };

  // ---- Kleine hulpjes (kopieën uit de Worker) --------------------------------
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const pause = () => sleep(OPTIONS.delayMinMs + Math.random() * (OPTIONS.delayMaxMs - OPTIONS.delayMinMs));

  const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€', eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', agrave: 'à', aacute: 'á', acirc: 'â', auml: 'ä', iuml: 'ï', icirc: 'î', ouml: 'ö', ocirc: 'ô', uuml: 'ü', ucirc: 'û', ccedil: 'ç', ntilde: 'ñ', deg: '°', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', frac12: '½', frac14: '¼', frac34: '¾', times: '×' };
  // Eén pass over &#x27; / &#39; / &quot; / &eacute; ... : "&#x27;Soto ayam&#x27;" wordt "'Soto ayam'".
  function decodeEntitiesRaw(str) {
    return String(str || '').replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z][a-z0-9]*));/gi, (whole, hex, dec, name) => {
      if (hex || dec) {
        const code = hex ? parseInt(hex, 16) : parseInt(dec, 10);
        try { return code === 160 ? ' ' : String.fromCodePoint(code); } catch { return whole; }
      }
      const known = NAMED_ENTITIES[name] !== undefined ? NAMED_ENTITIES[name] : NAMED_ENTITIES[name.toLowerCase()];
      return known === undefined ? whole : known;
    });
  }
  function stripTags(html) {
    return decodeEntitiesRaw(
      String(html || '')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
    ).replace(/\s+/g, ' ').trim();
  }
  function decodeEntities(str) {
    return decodeEntitiesRaw(str).trim();
  }
  function titleFromSlug(slug) {
    let clean = slug || '';
    try { clean = decodeURIComponent(clean); } catch { /* keep as is */ }
    clean = clean.replace(/-/g, ' ').trim();
    return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : 'Recept';
  }
  function isoDurationToMinutes(duration) {
    if (!duration || typeof duration !== 'string') return null;
    const match = duration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/i);
    if (!match) return null;
    const total = Number(match[1] || 0) * 60 + Number(match[2] || 0);
    return total > 0 ? total : null;
  }
  const UNICODE_FRACTIONS = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
  function parseIngredientQuantity(rawText) {
    const s = String(rawText || '').trim();
    let m = s.match(/^(\d+)?\s*([¼½¾⅓⅔⅛⅜⅝⅞])\s*(.*)$/);
    if (m) return { quantity: (m[1] ? parseInt(m[1], 10) : 0) + UNICODE_FRACTIONS[m[2]], rest: m[3].trim() };
    m = s.match(/^(\d+)\s*\/\s*(\d+)\s*(.*)$/);
    if (m) return { quantity: parseInt(m[1], 10) / parseInt(m[2], 10), rest: m[3].trim() };
    m = s.match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/);
    if (m) return { quantity: parseFloat(m[1].replace(',', '.')), rest: m[2].trim() };
    return { quantity: null, rest: s };
  }
  function extractJsonLdRecipe(html) {
    const scriptRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    const candidates = [];
    let match;
    while ((match = scriptRe.exec(html)) !== null) {
      let parsed;
      try { parsed = JSON.parse(match[1].trim()); } catch { continue; }
      for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
        if (item && Array.isArray(item['@graph'])) candidates.push(...item['@graph']);
        else candidates.push(item);
      }
    }
    return candidates.find((item) => {
      const type = item && item['@type'];
      if (!type) return false;
      return (Array.isArray(type) ? type : [type]).some((t) => String(t).toLowerCase() === 'recipe');
    }) || null;
  }
  function flattenInstructions(instructions) {
    if (!instructions) return [];
    const steps = [];
    for (const step of Array.isArray(instructions) ? instructions : [instructions]) {
      if (typeof step === 'string') steps.push(decodeEntities(step));
      else if (step && Array.isArray(step.itemListElement)) steps.push(...flattenInstructions(step.itemListElement));
      else if (step && typeof step.text === 'string') steps.push(decodeEntities(step.text));
    }
    return steps.filter(Boolean);
  }
  function firstImageUrl(image) {
    if (!image) return null;
    if (typeof image === 'string') return image;
    if (Array.isArray(image)) return firstImageUrl(image[0]);
    if (typeof image === 'object' && typeof image.url === 'string') return image.url;
    return null;
  }
  function resolveAhImageUrl(raw) {
    if (!raw) return null;
    try { return new URL(raw, AH_ORIGIN).href; } catch { return null; }
  }
  function firstYieldNumber(recipeYield) {
    const value = Array.isArray(recipeYield) ? recipeYield[0] : recipeYield;
    const match = String(value ?? '').match(/\d+/);
    return match ? parseInt(match[0], 10) : null;
  }
  function buildRecipeResponse(ld, sourceUrl, recipePath) {
    const idMatch = recipePath.match(AH_RECIPE_PATH_RE);
    const servings = firstYieldNumber(ld.recipeYield);
    const keywords = typeof ld.keywords === 'string'
      ? ld.keywords.split(',').map((k) => k.trim()).filter(Boolean)
      : Array.isArray(ld.keywords) ? ld.keywords : [];
    const ingredients = (Array.isArray(ld.recipeIngredient) ? ld.recipeIngredient : []).map((raw) => {
      const cleanRaw = decodeEntities(raw);
      const { quantity, rest } = parseIngredientQuantity(cleanRaw);
      return { raw: cleanRaw, quantity, rest };
    });
    return {
      id: idMatch ? idMatch[1] : null,
      url: recipePath,
      sourceUrl,
      title: decodeEntities(ld.name) || titleFromSlug(recipePath.split('/').pop()),
      description: decodeEntities(ld.description || ''),
      image: resolveAhImageUrl(firstImageUrl(ld.image)),
      servings: servings || 4,
      servingsEstimated: !servings,
      totalTimeMinutes: isoDurationToMinutes(ld.totalTime),
      prepTimeMinutes: isoDurationToMinutes(ld.prepTime),
      cookTimeMinutes: isoDurationToMinutes(ld.cookTime),
      category: decodeEntities(ld.recipeCategory || ''),
      cuisine: decodeEntities(ld.recipeCuisine || ''),
      keywords,
      ingredients,
      steps: flattenInstructions(ld.recipeInstructions),
      nutrition: ld.nutrition ? {
        calories: decodeEntities(ld.nutrition.calories || ''),
        fatContent: decodeEntities(ld.nutrition.fatContent || ''),
        saturatedFatContent: decodeEntities(ld.nutrition.saturatedFatContent || ''),
        carbohydrateContent: decodeEntities(ld.nutrition.carbohydrateContent || ''),
        proteinContent: decodeEntities(ld.nutrition.proteinContent || ''),
      } : null,
      rating: ld.aggregateRating
        ? { value: Number(ld.aggregateRating.ratingValue) || null, count: Number(ld.aggregateRating.ratingCount) || null }
        : null,
    };
  }

  // ---- Lijst-pagina's: receptkaartjes lezen -----------------------------------
  const RECIPE_HREF_RE = /(?:https?:\\?\/\\?\/(?:www\.)?ah\.nl)?\\?\/allerhande\\?\/recept\\?\/(R-[A-Za-z0-9]+)((?:\\?\/[A-Za-z0-9._~%-]+)*)/g;
  const MAX_CARDS_PER_PAGE = 60;
  function pickImageUrl(fragment) {
    const candidates = [];
    const attrRe = /\b(?:data-src|data-lazy-src|data-original|src)=["']([^"']+)["']/gi;
    let m;
    while ((m = attrRe.exec(fragment)) !== null) candidates.push(m[1]);
    const srcsetRe = /\b(?:data-srcset|srcset)=["']\s*([^"'\s,]+)/gi;
    while ((m = srcsetRe.exec(fragment)) !== null) candidates.push(m[1]);
    const real = candidates.find((c) => c && !/^data:/i.test(c));
    return real ? resolveAhImageUrl(decodeEntities(real)) : null;
  }
  function extractRecipeCards(html, categoryLabel, subcategoryLabel) {
    const cards = new Map();
    RECIPE_HREF_RE.lastIndex = 0;
    let match;
    while ((match = RECIPE_HREF_RE.exec(html)) !== null) {
      const id = match[1];
      const slugPath = (match[2] || '').replace(/\\/g, '');
      const path = `/allerhande/recept/${id}${slugPath}`;
      let attrs = '';
      let inner = '';
      const tagStart = Math.max(html.lastIndexOf('<a ', match.index), html.lastIndexOf('<a\n', match.index));
      if (tagStart !== -1 && match.index - tagStart < 800) {
        const tagEnd = html.indexOf('>', tagStart);
        if (tagEnd > match.index) {
          attrs = html.slice(tagStart, tagEnd);
          const close = html.indexOf('</a>', tagEnd);
          inner = html.slice(tagEnd + 1, close === -1 ? tagEnd + 4001 : Math.min(close, tagEnd + 6001));
        }
      }
      const existing = cards.get(id);
      if (existing && (!inner || existing.image)) continue;
      if (!existing && cards.size >= MAX_CARDS_PER_PAGE) continue;
      const titleAttrMatch = attrs.match(/(?:title|aria-label)=["']([^"']*)["']/i);
      const titleAttr = titleAttrMatch ? decodeEntities(titleAttrMatch[1]).replace(/^Recept:\s*/i, '') : '';
      const imgTagMatch = inner.match(/<img\b[^>]*>/i);
      const altMatch = imgTagMatch ? imgTagMatch[0].match(/alt=["']([^"']*)["']/i) : null;
      const plainText = inner ? stripTags(inner) : '';
      const minMatch = plainText.match(/(\d+)\s*min\b/i);
      const kcalMatch = plainText.match(/(\d+)\s*kcal\b/i);
      const lastSeg = path.split('/').filter(Boolean).pop();
      const title = titleAttr || decodeEntities(altMatch ? altMatch[1] : '') || (existing && existing.title) || titleFromSlug(lastSeg === id ? '' : lastSeg);
      cards.set(id, {
        id,
        url: path,
        title,
        image: (inner && pickImageUrl(inner)) || (existing && existing.image) || null,
        cookTimeMinutes: minMatch ? parseInt(minMatch[1], 10) : (existing && existing.cookTimeMinutes) || null,
        kcal: kcalMatch ? parseInt(kcalMatch[1], 10) : (existing && existing.kcal) || null,
        category: categoryLabel || null,
        subcategory: subcategoryLabel || null,
      });
    }
    return Array.from(cards.values());
  }
  function extractResultCount(html) {
    const match = html.match(/([\d][\d.,]*)\s*(?:<[^>]{0,200}>\s*){0,3}Allerhande\s+recepten/i);
    if (!match) return null;
    const digits = match[1].replace(/[.,]/g, '');
    return digits ? parseInt(digits, 10) : null;
  }

  // ---- Rustig ophalen, met terugval bij "te snel" ---------------------------------
  // Bij 403/429/503 wachten we steeds langer (1, 2, 4, 8 minuten) en proberen het
  // opnieuw. Lukt het na 4 keer nog niet, dan stoppen we en bewaren wat er al is.
  class BlockedError extends Error {}
  async function fetchText(url) {
    let wait = 60000;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (stopRequested) throw new Error('gestopt');
      let response;
      try {
        response = await fetch(url, { credentials: 'include', headers: { Accept: 'text/html,application/xhtml+xml' } });
      } catch (error) {
        response = null;
      }
      if (response && response.ok) return response.text();
      if (response && response.status === 404) return null;
      if (attempt === 4) break;
      const reason = response ? `HTTP ${response.status}` : 'netwerkfout';
      for (let left = wait / 1000; left > 0 && !stopRequested; left -= 1) {
        say(`AH zegt "${reason}" (te snel?). Wacht ${left}s en probeer opnieuw… (${attempt + 1}/4)`);
        await sleep(1000);
      }
      wait *= 2;
    }
    throw new BlockedError('AH blijft weigeren');
  }

  // ---- Fase 1: lijsten ------------------------------------------------------------
  const result = { app: 'kalininiels-ah-export', version: 1, exportedAt: new Date().toISOString(), lists: [], details: {} };
  const known = new Map(); // id -> pad
  let problem = '';

  try {
    for (let i = 0; i < LISTS.length && !stopRequested; i += 1) {
      const list = LISTS[i];
      let pages = OPTIONS.pagesPerList;
      for (let page = 0; page < pages && !stopRequested; page += 1) {
        say(`Lijsten: ${i + 1} van ${LISTS.length} — ${list.label} (pagina ${page + 1}) · ${known.size} recepten gevonden`);
        const q1 = new URLSearchParams({ 'soort-gerecht': list.type, page: String(page) });
        if (list.query) q1.set('query', list.query);
        const urls = [`${AH_ORIGIN}/allerhande/recepten-zoeken?${q1}`];
        const q2 = new URLSearchParams({ query: list.query ? `${list.type} ${list.query}` : list.type, page: String(page) });
        urls.push(`${AH_ORIGIN}/allerhande/recepten-zoeken?${q2}`);

        let recipes = [];
        let count = null;
        for (const url of urls) {
          const html = await fetchText(url);
          await pause();
          if (!html) continue;
          recipes = extractRecipeCards(html, list.type, list.query || null);
          count = extractResultCount(html);
          if (recipes.length) break;
        }
        if (recipes.length === 0) {
          if (i === 0 && page === 0) {
            throw new Error('De eerste lijst gaf geen recepten. AH heeft de pagina anders opgebouwd, of je bent niet op ah.nl/allerhande.');
          }
          break; // geen volgende pagina's
        }
        result.lists.push({ type: list.type, query: list.query || '', page, payload: { count, page, recipes, fallbackUsed: false } });
        recipes.forEach((r) => known.set(r.id, r.url));
        if (page === 0 && count && count <= recipes.length) pages = 1;
      }
    }

    // ---- Fase 2: details --------------------------------------------------------
    const ids = Array.from(known.keys()).slice(0, OPTIONS.maxDetails);
    for (let i = 0; i < ids.length && !stopRequested; i += 1) {
      const id = ids[i];
      const path = known.get(id);
      const remaining = Math.round(((ids.length - i) * (OPTIONS.delayMinMs + OPTIONS.delayMaxMs)) / 2 / 60000);
      say(`Details: ${i + 1} van ${ids.length} · nog ± ${remaining} min · mag dit tabblad open laten staan`);
      let html;
      try {
        html = await fetchText(AH_ORIGIN + path);
      } catch (error) {
        if (error instanceof BlockedError) throw error;
        break;
      }
      const ld = html ? extractJsonLdRecipe(html) : null;
      if (ld) result.details[id] = buildRecipeResponse(ld, AH_ORIGIN + path, path);
      await pause();
    }
  } catch (error) {
    problem = error && error.message ? error.message : String(error);
  }

  // ---- Opslaan als bestand -----------------------------------------------------------
  const nLists = result.lists.length;
  const nDetails = Object.keys(result.details).length;
  stopBtn.remove();
  if (nLists === 0) {
    say(`Niets om op te slaan. ${problem}`);
    return;
  }
  const blob = new Blob([JSON.stringify(result)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'ah-recepten-export.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  banner.style.background = problem || stopRequested ? '#b36b00' : '#1a8a3a';
  say(`${problem ? 'Gestopt: ' + problem + ' · ' : stopRequested ? 'Gestopt · ' : 'Klaar · '}${nLists} lijst-pagina's en ${nDetails} recepten opgeslagen in ah-recepten-export.json. Ga nu terug naar de dev-pagina en kies dat bestand.`);
})();
