// =================================================================
// TODO LIJST — SYNC (Cloudflare Worker)
// -----------------------------------------------------------------
// Same shape as the boodschappenlijst Worker (see
// cloudflare/cloudflare-worker-boodschappen/worker.js) — one shared
// list, read-it-all/write-it-all-back, polled every few seconds by
// todo.js so a change either of you makes shows up for the other one
// soon after. No login (same reasoning as the shopping list Worker).
//
// The one difference from the shopping list: every item also carries
// a `person` field ("a" = Niels, "b" = Kalina — see config.js's
// `todo.personLabels`) and a `priority` level, so this one list
// serves BOTH of the page's columns — todo.js filters client-side by
// `person` for rendering, but every save PUTs the combined array for
// both of you at once (same "whole list" model as the shopping list;
// simplest option for two people and a handful of tasks).
//
// Storage: a single Cloudflare KV namespace, bound as `TODO_KV`,
// holding ONE key ("todos") whose value is the entire list as JSON:
//   { items: [{ id, person, text, priority, checked }, ...], updatedAt: <ms> }
//
// Deploy instructions: see STAPPENPLAN-TODO-SNACKS.md at the repo root.
//
// Routes:
//   GET  /todos          -> { items, updatedAt }
//   PUT  /todos  { items } -> { items, updatedAt }  (overwrites)
// =================================================================

const ALLOWED_ORIGINS = [
  'https://nelis0808.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

const KV_KEY = 'todos';
const MAX_ITEMS = 300;       // sane ceiling, not a real limit anyone will hit
const MAX_TEXT_LENGTH = 200; // per item
const VALID_PERSONS = new Set(['a', 'b']); // a = Niels, b = Kalina (see config.js)
const VALID_PRIORITIES = new Set(['high', 'medium', 'low', 'none']);

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
const RATE_LIMIT_PREFIX = 'todo';
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

/** Rejects anything that isn't a well-formed { items: [{id, person, text, priority, checked}] } payload. */
function validateItems(body) {
  if (!body || !Array.isArray(body.items)) return null;
  if (body.items.length > MAX_ITEMS) return null;

  const cleaned = [];
  for (const raw of body.items) {
    if (!raw || typeof raw.text !== 'string') return null;
    if (!VALID_PERSONS.has(raw.person)) return null;

    const text = raw.text.trim().slice(0, MAX_TEXT_LENGTH);
    if (!text) continue; // silently drop empty rows instead of rejecting the whole save

    cleaned.push({
      id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
      person: raw.person,
      text,
      priority: VALID_PRIORITIES.has(raw.priority) ? raw.priority : 'none',
      checked: raw.checked === true,
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

    if (!env.TODO_KV) {
      return jsonResponse({ error: 'Server misconfigured: TODO_KV binding ontbreekt' }, 500, headers);
    }

    const limitCheck = await checkAndIncrementDailyLimit(env, RATE_LIMIT_PREFIX, DAILY_LIMIT);
    if (!limitCheck.allowed) {
      return rateLimitedResponse(headers, limitCheck.limit);
    }

    if (url.pathname !== '/todos') {
      return jsonResponse({ error: 'Not found' }, 404, headers);
    }

    // ---- GET /todos : current state ----
    if (request.method === 'GET') {
      const stored = (await env.TODO_KV.get(KV_KEY, 'json')) || { items: [], updatedAt: Date.now() };
      return jsonResponse(stored, 200, headers);
    }

    // ---- PUT /todos : overwrite with the browser's current state ----
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
      await env.TODO_KV.put(KV_KEY, JSON.stringify(stored));
      return jsonResponse(stored, 200, headers);
    }

    return jsonResponse({ error: 'Method not allowed' }, 405, headers);
  },
};
