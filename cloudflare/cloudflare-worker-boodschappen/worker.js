// =================================================================
// BOODSCHAPPENLIJSTJE — SYNC (Cloudflare Worker)
// -----------------------------------------------------------------
// The whole point of this worker: both of you should see the same
// list, and a change either of you makes should show up for the
// other one soon after (boodschappenlijst.js polls this worker every
// few seconds). There's no login here (unlike the photo gallery) —
// a shopping list just isn't sensitive enough to be worth the extra
// friction, same reasoning as the Ticketmaster proxy.
//
// Storage: a single Cloudflare KV namespace, bound as `LIST_KV`,
// holding ONE key ("list") whose value is the entire list as JSON:
//   { items: [{ id, text, checked }, ...], updatedAt: <ms> }
// A grocery list for two people never gets big enough to need
// anything fancier than "read the whole thing, write the whole
// thing" — no database, no per-item rows.
//
// DEFAULT ITEMS: the very first time anyone opens the page (i.e.
// the KV key doesn't exist yet), THIS worker seeds it with the
// default list server-side, once — not the browser. That matters:
// if both of you happened to open the page for the first time at
// nearly the same moment, two browsers independently "seeding" the
// list could race and one of you would silently lose items. Seeding
// once, server-side, on first read avoids that entirely.
//
// Deploy instructions: see STAPPENPLAN-BOODSCHAPPEN.md at the repo root.
//
// Routes:
//   GET  /list          -> { items, updatedAt }  (seeds defaults if empty)
//   PUT  /list           { items }     -> { items, updatedAt }  (overwrites)
// =================================================================

const ALLOWED_ORIGINS = [
  'https://nelis0808.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

const KV_KEY = 'list';
const MAX_ITEMS = 200;       // sane ceiling, not a real limit anyone will hit
const MAX_TEXT_LENGTH = 200; // per item

// Same default list requested for the site — only used the very
// first time the list is read (see comment above).
const DEFAULT_ITEMS = [
  'Groenten of fruit in blik',
  'Broodbeleg',
  'Ontbijtkoek',
  'Couscous',
  'Zilvervlies- of meergranenrijst',
  'Houdbare pasta',
  'Pastasaus',
  'Beschuit',
  'Smeerkaas',
  'Koffie en thee',
  'Chocoladerepen',
  'Maaltijdsoepen',
  'Mayonaise',
  'Mosterd',
  'Vruchtensap',
  'Toiletpapier',
  'Keukenrol',
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

function jsonResponse(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

// ---- Daily call limit -----------------------------------------------
// Protects this Worker's own request budget and its KV usage from
// being drained by scraping/abuse of its URL — the site's Workers are
// reachable directly (bypassing the static site) by anyone who finds
// their URLs.
//
// Uses ONE Workers KV namespace, bound as `RATE_LIMIT_KV`, shared
// across all of this site's Workers (each Worker uses its own key
// prefix so they don't collide). One counter per UTC calendar day;
// TTL cleans old counters up automatically. This is "good enough"
// rate limiting for a small personal site — KV writes aren't
// perfectly atomic under heavy concurrent traffic, so under a real
// burst a handful of requests past the cap might still slip through,
// but that's an acceptable trade-off here.
const RATE_LIMIT_PREFIX = 'boodschappen';
const DAILY_LIMIT = 5000;

function currentUtcDateKey() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

/** Returns { allowed, count, limit }. Increments the counter as a side effect when allowed. */
async function checkAndIncrementDailyLimit(env, prefix, limit) {
  if (!env.RATE_LIMIT_KV) {
    console.error('RATE_LIMIT_KV binding missing — daily limit not enforced');
    return { allowed: true, count: 0, limit };
  }

  const key = `${prefix}:${currentUtcDateKey()}`;
  const current = Number.parseInt((await env.RATE_LIMIT_KV.get(key)) || '0', 10);

  if (current >= limit) {
    return { allowed: false, count: current, limit };
  }

  await env.RATE_LIMIT_KV.put(key, String(current + 1), { expirationTtl: 172800 });
  return { allowed: true, count: current + 1, limit };
}

function rateLimitedResponse(headers, limit) {
  return new Response(
    JSON.stringify({ error: `Dagelijkse limiet van ${limit} aanvragen bereikt. Probeer het morgen weer.` }),
    {
      status: 429,
      headers: { ...headers, 'Content-Type': 'application/json', 'Retry-After': '3600' },
    }
  );
}

function makeDefaultList() {
  return {
    items: DEFAULT_ITEMS.map((text) => ({ id: crypto.randomUUID(), text, checked: false })),
    updatedAt: Date.now(),
  };
}

/** Rejects anything that isn't a well-formed { items: [{id, text, checked}] } payload. */
function validateItems(body) {
  if (!body || !Array.isArray(body.items)) return null;
  if (body.items.length > MAX_ITEMS) return null;

  const cleaned = [];
  for (const raw of body.items) {
    if (!raw || typeof raw.text !== 'string') return null;
    const text = raw.text.trim().slice(0, MAX_TEXT_LENGTH);
    if (!text) continue; // silently drop empty rows instead of rejecting the whole save
    cleaned.push({
      id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
      text,
      checked: raw.checked === true,
    });
  }
  return cleaned;
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin);
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    if (!env.LIST_KV) {
      return jsonResponse({ error: 'Server misconfigured: LIST_KV binding ontbreekt' }, 500, headers);
    }

    const limitCheck = await checkAndIncrementDailyLimit(env, RATE_LIMIT_PREFIX, DAILY_LIMIT);
    if (!limitCheck.allowed) {
      return rateLimitedResponse(headers, limitCheck.limit);
    }

    if (url.pathname !== '/list') {
      return jsonResponse({ error: 'Not found' }, 404, headers);
    }

    // ---- GET /list : current state, seeding defaults on first-ever read ----
    if (request.method === 'GET') {
      let stored = await env.LIST_KV.get(KV_KEY, 'json');

      if (!stored) {
        stored = makeDefaultList();
        await env.LIST_KV.put(KV_KEY, JSON.stringify(stored));
      }

      return jsonResponse(stored, 200, headers);
    }

    // ---- PUT /list : overwrite with the browser's current state ----
    if (request.method === 'PUT') {
      let body;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: 'Ongeldige aanvraag' }, 400, headers);
      }

      const items = validateItems(body);
      if (items === null) {
        return jsonResponse({ error: 'Ongeldige lijst' }, 400, headers);
      }

      const stored = { items, updatedAt: Date.now() };
      await env.LIST_KV.put(KV_KEY, JSON.stringify(stored));
      return jsonResponse(stored, 200, headers);
    }

    return jsonResponse({ error: 'Method not allowed' }, 405, headers);
  },
};
