// =================================================================
// FAVORIETE ARTIESTEN — Cloudflare Worker
// -----------------------------------------------------------------
// Backs the "Favorieten" tab on ticketmaster.html
// (assets/js/modules/ticketmaster.js). Stores ONE shared list of
// artist/band names in Cloudflare KV — same "whole list" model as
// the lijstje/gifts/clothing Workers on this site (read-it-all,
// write-it-all-back, no login). Whichever device adds or removes a
// name, every other device sees the same list — that's the whole
// point, so you don't have to re-type "Coldplay, Metallica, ..." on
// your phone AND your laptop.
//
// This Worker does NOT talk to Ticketmaster itself. The front end
// still uses the existing ticketmaster-proxy Worker (mode=search) to
// fetch actual concert data, once per saved artist, and merges the
// results client-side. This Worker only stores the list of NAMES.
// Keeping it separate means the existing Ticketmaster proxy — and
// its own rate limit / API key / caching — didn't need to change at
// all for this feature.
//
// BINDINGS (Settings -> Bindings on this Worker)
//   FAVORITE_ARTISTS_KV -> this Worker's own KV namespace (its data)
//   RATE_LIMIT_KV        -> the KV namespace shared with every other
//                            Worker on this site, used only for the
//                            daily request counter (see "Daily call
//                            limit" below). Worker still runs without
//                            it, just without a limit.
//
// KV LAYOUT (in FAVORITE_ARTISTS_KV)
//   "artists" -> { artists: ["Coldplay", "Metallica", ...] }
//
// ENDPOINTS
//   GET /artists                    -> { artists: [...] }
//   PUT /artists   body { artists } -> replaces the whole list -> { artists: [...] }
//
// A plain PUT-the-whole-array design (rather than separate add/remove/
// reorder endpoints) on purpose: the front end already has to hold
// the full list in memory to render it, so sending the whole thing
// back on every change is simpler than several endpoints, and this
// list is expected to stay small (tens of names, not thousands) —
// see MAX_ARTISTS below.
//
// Deploy instructions: see STAPPENPLAN-TICKETMASTER-FAVORIETEN.md at
// the repo root.
// =================================================================

const ALLOWED_ORIGINS = [
  'https://nelis0808.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

const KV_KEY = 'artists';
const MAX_ARTISTS = 50; // plenty for "artists we want to catch live"; keeps queries to the Ticketmaster proxy (one per artist) reasonable
const MAX_NAME_LENGTH = 100;

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

// ---- Daily call limit -----------------------------------------------
// Same shared-KV, prefix-per-Worker daily counter as every other
// Worker on this site — see their file headers (e.g.
// cloudflare-worker-lijstje/worker.js) for the full reasoning.
const RATE_LIMIT_PREFIX = 'favorite-artists';
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

function rateLimitedResponse(origin, limit) {
  return new Response(
    JSON.stringify({ error: `Dagelijkse limiet van ${limit} aanvragen bereikt. Probeer het morgen weer.` }),
    {
      status: 429,
      headers: { ...corsHeaders(origin), 'Content-Type': 'application/json', 'Retry-After': '3600' },
    }
  );
}

/** Cleans + validates the incoming { artists } body. Returns null if the shape is wrong. */
function validateArtists(body) {
  if (!body || !Array.isArray(body.artists)) return null;
  if (body.artists.length > MAX_ARTISTS) return null;

  const cleaned = [];
  const seenLower = new Set(); // de-dupe case-insensitively ("Coldplay" and "coldplay" are the same save)
  for (const raw of body.artists) {
    if (typeof raw !== 'string') continue;
    const name = raw.trim().slice(0, MAX_NAME_LENGTH);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seenLower.has(key)) continue;
    seenLower.add(key);
    cleaned.push(name);
  }
  return cleaned;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const limitCheck = await checkAndIncrementDailyLimit(env, RATE_LIMIT_PREFIX, DAILY_LIMIT);
    if (!limitCheck.allowed) {
      return rateLimitedResponse(origin, limitCheck.limit);
    }

    if (!env.FAVORITE_ARTISTS_KV) {
      return json({ error: 'Server misconfigured: FAVORITE_ARTISTS_KV binding ontbreekt' }, 500, origin);
    }

    if (url.pathname !== '/artists') {
      return json({ error: 'Not found' }, 404, origin);
    }

    if (request.method === 'GET') {
      const stored = (await env.FAVORITE_ARTISTS_KV.get(KV_KEY, 'json')) || { artists: [] };
      return json({ artists: Array.isArray(stored.artists) ? stored.artists : [] }, 200, origin);
    }

    if (request.method === 'PUT') {
      const body = await request.json().catch(() => null);
      const artists = validateArtists(body);
      if (artists === null) {
        return json({ error: `Ongeldige lijst (max ${MAX_ARTISTS} namen, elk max ${MAX_NAME_LENGTH} tekens)` }, 400, origin);
      }
      await env.FAVORITE_ARTISTS_KV.put(KV_KEY, JSON.stringify({ artists }));
      return json({ artists }, 200, origin);
    }

    return json({ error: 'Method not allowed' }, 405, origin);
  },
};
