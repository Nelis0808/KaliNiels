// =================================================================
// TICKETMASTER PROXY (Cloudflare Worker)
// -----------------------------------------------------------------
// This is the ONLY place your real Ticketmaster API key should ever
// live. It's deployed separately from the static site (this file is
// NOT loaded by index.html/main.js) and stored as a Cloudflare
// "secret" — never committed to git, never shipped to the browser.
//
// The site calls THIS worker's URL; this worker calls Ticketmaster
// with the real key attached server-side, and returns the JSON back.
//
// Deploy instructions: see STAPPENPLAN.md at the repo root.
// =================================================================

const TICKETMASTER_EVENTS_URL = 'https://app.ticketmaster.com/discovery/v2/events.json';

// Every origin your site is actually served from. GitHub Pages project
// pages look like "https://<username>.github.io" (note: no trailing
// slash, no path — browsers send the Origin header without a path).
// Add your custom domain here too if/when you use one.
const ALLOWED_ORIGINS = [
  'https://nelis0808.github.io',
  'http://localhost:8080',   // `npm start` / `npm run dev` in this repo (http-server / live-server)
  'http://127.0.0.1:8080',
  'http://localhost:5500',   // VS Code "Live Server" extension default
  'http://127.0.0.1:5500',
];

// Builds the Ticketmaster-specific query params for each "mode" the
// front-end can request. Keeping this server-side means the browser
// only ever sends `mode` + `countryCode` + (optionally) `keyword` —
// it never has to know Ticketmaster's exact param names.
const MODE_BUILDERS = {
  upcoming: () => ({
    classificationName: 'music',
    sort: 'date,asc',
    startDateTime: isoNow(),
  }),
  sales: () => ({
    classificationName: 'music',
    sort: 'date,asc',
    // "Include events going onsale after this date" — i.e. tickets
    // for these events are NOT on public sale yet.
    onsaleStartDateTime: isoNow(),
  }),
  search: (searchParams) => ({
    classificationName: 'music',
    keyword: searchParams.get('keyword') || '',
    startDateTime: isoNow(),
    sort: 'date,asc',
  }),
};

function isoNow() {
  // Ticketmaster wants "yyyy-MM-ddTHH:mm:ssZ" (no milliseconds).
  return new Date().toISOString().split('.')[0] + 'Z';
}

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

function jsonError(message, status, headers) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

// ---- Daily call limit -----------------------------------------------
// Protects your Ticketmaster quota (and this Worker's own free-tier
// request budget) from being drained by scraping/abuse of this proxy's
// URL, since — unlike a raw API key — anyone who finds this URL can
// call it directly, bypassing the site entirely.
//
// Uses ONE Workers KV namespace, bound as `RATE_LIMIT_KV`, shared
// across all of this site's Workers (each Worker uses its own key
// prefix so they don't collide). One counter per UTC calendar day;
// TTL cleans old counters up automatically. This is "good enough"
// rate limiting for a small personal site — KV writes aren't
// perfectly atomic under heavy concurrent traffic, so under a real
// burst a handful of requests past the cap might still slip through,
// but that's an acceptable trade-off here.
const RATE_LIMIT_PREFIX = 'ticketmaster';
const DAILY_LIMIT = 10000;

function currentUtcDateKey() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

/** Returns { allowed, count, limit }. Increments the counter as a side effect when allowed. */
async function checkAndIncrementDailyLimit(env, prefix, limit) {
  if (!env.RATE_LIMIT_KV) {
    // Fail open with a console warning rather than taking the whole
    // site down if the KV binding hasn't been set up yet.
    console.error('RATE_LIMIT_KV binding missing — daily limit not enforced');
    return { allowed: true, count: 0, limit };
  }

  const key = `${prefix}:${currentUtcDateKey()}`;
  const current = Number.parseInt((await env.RATE_LIMIT_KV.get(key)) || '0', 10);

  if (current >= limit) {
    return { allowed: false, count: current, limit };
  }

  // Just under 2 days — comfortably covers the rest of "today" in any
  // timezone plus a safety margin, then KV expires the key on its own.
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

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin);

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    if (request.method !== 'GET') {
      return jsonError('Method not allowed', 405, headers);
    }

    if (!env.TICKETMASTER_API_KEY) {
      return jsonError('Server misconfigured: missing TICKETMASTER_API_KEY secret', 500, headers);
    }

    // Enforce the daily cap before doing any real work. Checked before
    // the edge-cache lookup below so the limit reflects total traffic
    // to this Worker, not just calls that actually reach Ticketmaster.
    const limitCheck = await checkAndIncrementDailyLimit(env, RATE_LIMIT_PREFIX, DAILY_LIMIT);
    if (!limitCheck.allowed) {
      return rateLimitedResponse(headers, limitCheck.limit);
    }

    const url = new URL(request.url);
    const mode = url.searchParams.get('mode') || 'upcoming';
    const buildParams = MODE_BUILDERS[mode];

    if (!buildParams) {
      return jsonError(`Unknown mode "${mode}". Use upcoming, sales, or search.`, 400, headers);
    }

    if (mode === 'search' && !url.searchParams.get('keyword')) {
      return jsonError('Missing "keyword" query param for search mode', 400, headers);
    }

    // Edge cache: identical queries within the TTL are served without
    // hitting Ticketmaster again. This protects your daily quota
    // (free tier is typically 5000 calls/day) since this proxy's URL,
    // unlike a raw API key, can be called by anyone who finds it.
    const cache = caches.default;
    const cacheKey = new Request(request.url, request);
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      return withCors(cachedResponse, headers);
    }

    const tmParams = new URLSearchParams(buildParams(url.searchParams));
    tmParams.set('apikey', env.TICKETMASTER_API_KEY);
    tmParams.set('size', clampSize(url.searchParams.get('size')));
    tmParams.set('page', clampPage(url.searchParams.get('page')));

    const countryCode = url.searchParams.get('countryCode');
    if (countryCode) tmParams.set('countryCode', countryCode);

    let upstreamResponse;
    try {
      upstreamResponse = await fetch(`${TICKETMASTER_EVENTS_URL}?${tmParams.toString()}`);
    } catch (err) {
      return jsonError('Kon Ticketmaster niet bereiken', 502, headers);
    }

    const body = await upstreamResponse.text();
    const response = new Response(body, {
      status: upstreamResponse.status,
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300', // 5 minutes
      },
    });

    if (upstreamResponse.ok) {
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    }

    return response;
  },
};

function withCors(response, headers) {
  const copy = new Response(response.body, response);
  Object.entries(headers).forEach(([key, value]) => copy.headers.set(key, value));
  return copy;
}

function clampSize(raw) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return '12';
  return String(Math.min(Math.max(n, 1), 20));
}

function clampPage(raw) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 0) return '0';
  return String(Math.min(n, 50)); // Ticketmaster caps deep paging anyway
}
