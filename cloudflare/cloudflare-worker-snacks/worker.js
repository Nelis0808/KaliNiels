// =================================================================
// SNACK RATINGS — SYNC (Cloudflare Worker)
// -----------------------------------------------------------------
// Same "whole list" model as the shopping list / TODO Worker (see
// their file headers) — one shared list, read-it-all/write-it-all-
// back, polled every few seconds by snack-rating.js. No login (same
// reasoning as the other small Workers on this site).
//
// Every item carries a `person` field ("a" = Niels, "b" = Kalina —
// see config.js's `snackRatings.personLabels`), same two-column idea
// as gifts.html/todo.html.
//
// PHOTOS: unlike the gift-ideas Worker, there's no R2 bucket / image
// scraping here — snack-rating.js already downscales+JPEG-compresses
// a chosen photo client-side into a smallish data URL (see its
// resizePhoto()) BEFORE it ever reaches this Worker, and that data
// URL is stored directly as a field on the item, right in KV. Simpler
// than a second storage system, and comfortably within a single KV
// value's 25MB limit for a reasonable number of snacks — this Worker
// still enforces MAX_PHOTO_LENGTH below as a sanity backstop in case
// something client-side ever sends an oversized one.
//
// Storage: a single Cloudflare KV namespace, bound as `SNACKS_KV`,
// holding ONE key ("snacks") whose value is the entire list as JSON:
//   { items: [{ id, person, name, url, description, rating, photo, addedAt }, ...], updatedAt: <ms> }
//
// Deploy instructions: see STAPPENPLAN-TODO-SNACKS.md at the repo root.
//
// Routes:
//   GET  /snacks           -> { items, updatedAt }
//   PUT  /snacks  { items } -> { items, updatedAt }  (overwrites)
// =================================================================

const ALLOWED_ORIGINS = [
  'https://nelis0808.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

const KV_KEY = 'snacks';
const MAX_ITEMS = 300;
const MAX_TEXT_LENGTH = 200;       // name
const MAX_DESC_LENGTH = 1000;
const MAX_URL_LENGTH = 2000;
const MAX_PHOTO_LENGTH = 600 * 1024; // ~600KB of base64 — generous headroom over the ~640px JPEGs the client sends
const VALID_PERSONS = new Set(['a', 'b']); // a = Niels, b = Kalina (see config.js)

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
const RATE_LIMIT_PREFIX = 'snacks';
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

function isHttpUrl(raw) {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isDataImageUrl(raw) {
  return typeof raw === 'string' && /^data:image\/(jpeg|png|webp|gif);base64,/.test(raw);
}

/** Rejects anything that isn't a well-formed { items: [{id, person, name, url, description, rating, photo, addedAt}] } payload. */
function validateItems(body) {
  if (!body || !Array.isArray(body.items)) return null;
  if (body.items.length > MAX_ITEMS) return null;

  const cleaned = [];
  for (const raw of body.items) {
    if (!raw || typeof raw.name !== 'string') return null;
    if (!VALID_PERSONS.has(raw.person)) return null;

    const name = raw.name.trim().slice(0, MAX_TEXT_LENGTH);
    if (!name) continue; // silently drop malformed rows instead of rejecting the whole save

    const url = typeof raw.url === 'string' ? raw.url.trim().slice(0, MAX_URL_LENGTH) : '';
    if (url && !isHttpUrl(url)) continue; // link is optional, but must be well-formed if present

    let photo = null;
    if (typeof raw.photo === 'string' && raw.photo) {
      if (!isDataImageUrl(raw.photo) || raw.photo.length > MAX_PHOTO_LENGTH) continue; // drop the row rather than a malformed/oversized photo silently corrupting the list
      photo = raw.photo;
    }

    const rating = Number.isInteger(raw.rating) ? Math.max(0, Math.min(5, raw.rating)) : 0;

    cleaned.push({
      id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
      person: raw.person,
      name,
      url,
      description: typeof raw.description === 'string' ? raw.description.trim().slice(0, MAX_DESC_LENGTH) : '',
      rating,
      photo,
      addedAt: typeof raw.addedAt === 'number' ? raw.addedAt : Date.now(),
    });
  }
  return cleaned;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin);
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    if (!env.SNACKS_KV) {
      return jsonResponse({ error: 'Server misconfigured: SNACKS_KV binding ontbreekt' }, 500, headers);
    }

    const limitCheck = await checkAndIncrementDailyLimit(env, RATE_LIMIT_PREFIX, DAILY_LIMIT);
    if (!limitCheck.allowed) {
      return rateLimitedResponse(headers, limitCheck.limit);
    }

    if (url.pathname !== '/snacks') {
      return jsonResponse({ error: 'Not found' }, 404, headers);
    }

    // ---- GET /snacks : current state ----
    if (request.method === 'GET') {
      const stored = (await env.SNACKS_KV.get(KV_KEY, 'json')) || { items: [], updatedAt: Date.now() };
      return jsonResponse(stored, 200, headers);
    }

    // ---- PUT /snacks : overwrite with the browser's current state ----
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
      await env.SNACKS_KV.put(KV_KEY, JSON.stringify(stored));
      return jsonResponse(stored, 200, headers);
    }

    return jsonResponse({ error: 'Method not allowed' }, 405, headers);
  },
};
