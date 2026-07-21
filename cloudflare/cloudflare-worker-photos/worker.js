// =================================================================
// PRIVATE PHOTO GALLERY — AUTH + IMAGE PROXY (Cloudflare Worker)
// -----------------------------------------------------------------
// This worker is the ONLY thing that can read the private R2 bucket
// where your real photos live. The static site never has direct
// access to that bucket, and the bucket is never public — a browser
// can only ever see a photo by first proving it knows one of the two
// passphrases below.
//
// Two secrets per person, so you can tell who's logged in:
//   PASSPHRASE_A         — e.g. your passphrase
//   PASSPHRASE_B         — your girlfriend's passphrase
//   TOKEN_SECRET         — random long string used to sign session tokens
// Set all three as Cloudflare "secrets" (never in this file, never in git).
// Bind the R2 bucket to this worker as `PHOTOS_BUCKET`.
//
// Deploy instructions: see PHOTO-GALLERY.md at the repo root.
//
// Routes:
//   POST /login                  { passphrase } -> { token, who }
//   GET  /photos                 (auth)         -> { photos: [...] }
//   GET  /photos/object?key=...  (auth)         -> raw image bytes
//   GET  /travel?country=XX      (PUBLIC)       -> { cities: [...] }  (see below)
//
// CAPTIONS: captions.json (uploaded to the same private R2 bucket,
// see PHOTO-GALLERY.md) maps each filename to a caption array:
//   { "img.jpg": ["Short description", "Longer description..."] }
// As of the "Onze Reizen" feature, TWO more optional fields can
// follow — a country and a specific place within it:
//   { "img.jpg": ["Short", "Longer...", "Portugal", "Lissabon"] }
// Not every photo needs them — entries with only 2 elements (or a
// plain string, the old format) simply never show up on the travel
// map, they still work exactly as before on photos.html.
//
// /travel IS DELIBERATELY PUBLIC (no Authorization header, no
// passphrase check) — it powers reizen/land.html's city-pin
// overview, which is meant to be a fun "look where we've been"
// teaser visible to anyone, unlike the actual photo bytes. It only
// ever returns city names + photo counts + a "visited" flag, NEVER
// filenames, captions, or anything that could be used to fetch a
// real image — so it can't be used to bypass the login on
// /photos or /photos/object above.
// =================================================================

const ALLOWED_ORIGINS = [
  'https://nelis0808.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

const SESSION_LENGTH_SECONDS = 30 * 24 * 60 * 60; // ~30 days
const IMAGE_CONTENT_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
};

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
// Protects this Worker's own request budget and its R2 usage from
// being drained by scraping/abuse of its URL — the site's Workers are
// reachable directly (bypassing the static site) by anyone who finds
// their URLs. Applies to every route here, including the public
// /travel endpoint and the /login attempts themselves, so it also
// acts as a basic brake on passphrase brute-forcing.
//
// Uses ONE Workers KV namespace, bound as `RATE_LIMIT_KV`, shared
// across all of this site's Workers (each Worker uses its own key
// prefix so they don't collide). One counter per UTC calendar day;
// TTL cleans old counters up automatically. This is "good enough"
// rate limiting for a small personal site — KV writes aren't
// perfectly atomic under heavy concurrent traffic, so under a real
// burst a handful of requests past the cap might still slip through,
// but that's an acceptable trade-off here.
const RATE_LIMIT_PREFIX = 'photos';
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

// ---- base64url + HMAC token helpers -------------------------------
// A deliberately tiny JWT-alike: base64url(payload) + "." +
// base64url(HMAC-SHA256 signature of that payload string). Stateless —
// no session storage needed, the signature itself proves validity.

function toBase64Url(bytes) {
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(str.length + ((4 - (str.length % 4)) % 4), '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function signToken(payload, secret) {
  const payloadB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  const sigB64 = toBase64Url(new Uint8Array(signature));
  return `${payloadB64}.${sigB64}`;
}

async function verifyToken(token, secret) {
  if (!token || !token.includes('.')) return null;
  const [payloadB64, sigB64] = token.split('.');

  try {
    const key = await hmacKey(secret);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      fromBase64Url(sigB64),
      new TextEncoder().encode(payloadB64)
    );
    if (!valid) return null;

    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64)));
    if (typeof payload.exp !== 'number' || payload.exp < Date.now() / 1000) return null;
    return payload; // { who: 'a' | 'b', exp }
  } catch {
    return null;
  }
}

// Constant-time-ish string comparison, so a failed login doesn't leak
// timing information about how many characters matched.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function requireAuth(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  return verifyToken(token, env.TOKEN_SECRET);
}

function contentTypeFor(key) {
  const ext = key.split('.').pop().toLowerCase();
  return IMAGE_CONTENT_TYPES[ext] || 'application/octet-stream';
}

function isImageKey(key) {
  const ext = key.split('.').pop().toLowerCase();
  return Object.prototype.hasOwnProperty.call(IMAGE_CONTENT_TYPES, ext);
}

/** Normalizes one captions.json entry (array of 2-4 strings, or a legacy plain string) into { caption, captionLong, country, place }. */
function parseCaptionEntry(raw) {
  if (Array.isArray(raw)) {
    const [caption = '', captionLong = '', country = '', place = ''] = raw;
    return {
      caption,
      captionLong: captionLong || caption,
      country: country || '',
      place: place || '',
    };
  }
  if (typeof raw === 'string') {
    return { caption: raw, captionLong: raw, country: '', place: '' };
  }
  return { caption: '', captionLong: '', country: '', place: '' };
}

async function loadCaptions(bucket) {
  try {
    const captionsObj = await bucket.get('captions.json');
    if (!captionsObj) return {};
    return JSON.parse(await captionsObj.text());
  } catch {
    return {}; // missing/invalid captions.json is fine — photos just show without one
  }
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin);
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    const limitCheck = await checkAndIncrementDailyLimit(env, RATE_LIMIT_PREFIX, DAILY_LIMIT);
    if (!limitCheck.allowed) {
      return rateLimitedResponse(headers, limitCheck.limit);
    }

    // ---- GET /travel?country=XX : PUBLIC, no auth — see file header ----
    // Returns only city names + photo counts for the given country,
    // built from captions.json's optional 3rd/4th fields. Never
    // returns filenames or anything usable to fetch a real photo.
    if (url.pathname === '/travel' && request.method === 'GET') {
      if (!env.PHOTOS_BUCKET) {
        return jsonResponse({ error: 'Server misconfigured: R2 bucket not bound' }, 500, headers);
      }

      const wantedCountry = (url.searchParams.get('country') || '').trim().toLowerCase();
      if (!wantedCountry) {
        return jsonResponse({ error: 'Ontbrekende "country" parameter' }, 400, headers);
      }

      const captions = await loadCaptions(env.PHOTOS_BUCKET);
      const cityCounts = new Map(); // place (lowercased) -> { name, count }

      for (const raw of Object.values(captions)) {
        const { country, place } = parseCaptionEntry(raw);
        if (!country || !place) continue;
        if (country.trim().toLowerCase() !== wantedCountry) continue;

        const key = place.trim().toLowerCase();
        const existing = cityCounts.get(key);
        if (existing) existing.count += 1;
        else cityCounts.set(key, { name: place.trim(), count: 1 });
      }

      const cities = Array.from(cityCounts.values())
        .map((city) => ({ ...city, visited: true })) // every captioned city is, by definition, a place we've actually been
        .sort((a, b) => b.count - a.count);

      return jsonResponse({ cities }, 200, { ...headers, 'Cache-Control': 'public, max-age=300' });
    }

    if (!env.TOKEN_SECRET || !env.PASSPHRASE_A || !env.PASSPHRASE_B) {
      return jsonResponse({ error: 'Server misconfigured: missing secrets' }, 500, headers);
    }

    // ---- POST /login ----
    if (url.pathname === '/login' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: 'Ongeldige aanvraag' }, 400, headers);
      }

      const passphrase = (body.passphrase || '').trim();
      let who = null;
      if (safeEqual(passphrase, env.PASSPHRASE_A)) who = 'a';
      else if (safeEqual(passphrase, env.PASSPHRASE_B)) who = 'b';

      if (!who) {
        return jsonResponse({ error: 'Onjuist wachtwoord' }, 401, headers);
      }

      const exp = Math.floor(Date.now() / 1000) + SESSION_LENGTH_SECONDS;
      const token = await signToken({ who, exp }, env.TOKEN_SECRET);
      return jsonResponse({ token, who, exp }, 200, headers);
    }

    // ---- everything below requires a valid token ----
    if (url.pathname === '/photos' || url.pathname === '/photos/object') {
      const auth = await requireAuth(request, env);
      if (!auth) return jsonResponse({ error: 'Niet ingelogd of sessie verlopen' }, 401, headers);

      if (!env.PHOTOS_BUCKET) {
        return jsonResponse({ error: 'Server misconfigured: R2 bucket not bound' }, 500, headers);
      }

      // ---- GET /photos : list available photos + optional captions ----
      if (url.pathname === '/photos' && request.method === 'GET') {
        const listing = await env.PHOTOS_BUCKET.list();
        const captions = await loadCaptions(env.PHOTOS_BUCKET);

        const photos = listing.objects
          .filter((obj) => isImageKey(obj.key))
          .map((obj) => {
            const { caption, captionLong, country, place } = parseCaptionEntry(captions[obj.key]);
            return { key: obj.key, caption, captionLong, country, place, uploaded: obj.uploaded };
          })
          .sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded)); // newest first

        return jsonResponse({ photos, who: auth.who }, 200, headers);
      }

      // ---- GET /photos/object?key=... : raw image bytes ----
      if (url.pathname === '/photos/object' && request.method === 'GET') {
        const key = url.searchParams.get('key');
        if (!key || !isImageKey(key)) {
          return jsonResponse({ error: 'Ongeldige of ontbrekende key' }, 400, headers);
        }

        const object = await env.PHOTOS_BUCKET.get(key);
        if (!object) return jsonResponse({ error: 'Foto niet gevonden' }, 404, headers);

        // IMPORTANT: no shared/edge caching here (unlike the Ticketmaster
        // proxy, and unlike /travel above). These bytes are only supposed
        // to be visible to someone who already proved they know a
        // passphrase — caching by URL alone at Cloudflare's shared edge
        // would let a second, unverified visitor read a cached copy
        // without ever logging in. Browser-level private caching is fine
        // (it's scoped to this one visitor).
        return new Response(object.body, {
          status: 200,
          headers: {
            ...headers,
            'Content-Type': contentTypeFor(key),
            'Cache-Control': 'private, max-age=3600',
          },
        });
      }
    }

    return jsonResponse({ error: 'Not found' }, 404, headers);
  },
};
