// =================================================================
// SHARED CHIP BALANCE — AUTH + CHIPS (Cloudflare Worker)
// -----------------------------------------------------------------
// Same login pattern as the private photo gallery
// (cloudflare/cloudflare-worker-photos/worker.js): two passphrases,
// one per person, a signed token proves who's logged in. This
// worker does NOT touch the photo gallery's secrets or storage —
// it's a fourth, separate Worker with its own KV namespace.
//
// WHAT IT'S FOR: this worker is a single, GAME-AGNOSTIC chip balance
// shared by every chip-based game on the site — currently BlackJack
// (assets/js/modules/blackjack.js) and Spiderette
// (assets/js/modules/spiderette.js), both configured in
// assets/js/config.js to point at this exact same worker URL (see
// that file's `blackjack`/`spiderette` entries). The /chips endpoint
// below stores one balance per PERSON, never per game — there's no
// concept of "blackjack chips" vs "spiderette chips" anywhere in this
// file, just one number per logged-in person that every connected
// game reads from and writes back to. That's what makes winning chips
// in one game immediately spendable in another, and it's also what
// any FUTURE chip-based game should plug into: add a `workerUrl`
// entry pointing here in config.js, reuse this same GET/PUT /chips
// contract, and its chips are automatically in sync with every other
// game on the site — no new worker or KV namespace needed.
//
// Each game is still free to be playable by anyone, logged in or
// not — but the chip balance only exists, and only persists, for
// logged-in players; how a given game module handles anonymous play
// (e.g. a fixed local-only stack, or just hiding the balance) is that
// module's own choice and has no bearing on this worker. This worker
// is what makes the logged-in balance durable across visits/devices,
// and is the thing that lets YOU manually set someone's balance from
// the Cloudflare dashboard (Workers & Pages → KV → your namespace →
// edit the "a" or "b" key) without touching any code.
//
// Storage: one Cloudflare KV namespace, bound as `CHIPS_KV`, with
// one key per person:
//   "a" -> "1000"   (plain integer, stored as a string)
//   "b" -> "1000"
// Editing that value directly in the KV dashboard is a fully
// supported way to top someone up or dock their chips — the worker
// only ever reads it fresh, never caches it.
//
// Deploy instructions: see STAPPENPLAN-BLACKJACK.md at the repo root.
//
// Routes:
//   POST /login          { passphrase }        -> { token, who, exp }
//   GET  /chips           (auth)                -> { who, chips }
//   PUT  /chips           (auth) { chips }      -> { who, chips }
// =================================================================

const ALLOWED_ORIGINS = [
  'https://nelis0808.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

const SESSION_LENGTH_SECONDS = 30 * 24 * 60 * 60; // ~30 days, same as the photo gallery
const DEFAULT_CHIPS = 1000; // seeded once per person, the very first time they log in
const MIN_CHIPS = 0;
const MAX_CHIPS = 1_000_000; // sane ceiling so a bug can't write something absurd into KV

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
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
const RATE_LIMIT_PREFIX = 'blackjack';
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
// Identical scheme to cloudflare-worker-photos/worker.js — a tiny
// stateless JWT-alike. Deliberately duplicated rather than shared,
// so this worker has zero dependency on the photo gallery's code or
// secrets (they can be edited/rotated fully independently).

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

/** Reads a person's chip count from KV, seeding DEFAULT_CHIPS the first time. */
async function readChips(env, who) {
  const raw = await env.CHIPS_KV.get(who);
  if (raw === null) {
    await env.CHIPS_KV.put(who, String(DEFAULT_CHIPS));
    return DEFAULT_CHIPS;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : DEFAULT_CHIPS;
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin);
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    if (!env.TOKEN_SECRET || !env.PASSPHRASE_A || !env.PASSPHRASE_B) {
      return jsonResponse({ error: 'Server misconfigured: missing secrets' }, 500, headers);
    }

    const limitCheck = await checkAndIncrementDailyLimit(env, RATE_LIMIT_PREFIX, DAILY_LIMIT);
    if (!limitCheck.allowed) {
      return rateLimitedResponse(headers, limitCheck.limit);
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
    if (url.pathname === '/chips') {
      if (!env.CHIPS_KV) {
        return jsonResponse({ error: 'Server misconfigured: CHIPS_KV binding ontbreekt' }, 500, headers);
      }

      const auth = await requireAuth(request, env);
      if (!auth) return jsonResponse({ error: 'Niet ingelogd of sessie verlopen' }, 401, headers);

      // ---- GET /chips : current balance ----
      if (request.method === 'GET') {
        const chips = await readChips(env, auth.who);
        return jsonResponse({ who: auth.who, chips }, 200, headers);
      }

      // ---- PUT /chips : save new balance after a hand ----
      if (request.method === 'PUT') {
        let body;
        try {
          body = await request.json();
        } catch {
          return jsonResponse({ error: 'Ongeldige aanvraag' }, 400, headers);
        }

        const chips = Number.parseInt(body.chips, 10);
        if (!Number.isFinite(chips) || chips < MIN_CHIPS || chips > MAX_CHIPS) {
          return jsonResponse({ error: 'Ongeldig aantal chips' }, 400, headers);
        }

        await env.CHIPS_KV.put(auth.who, String(chips));
        return jsonResponse({ who: auth.who, chips }, 200, headers);
      }
    }

    return jsonResponse({ error: 'Not found' }, 404, headers);
  },
};
