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
// Deploy instructions: see STAPPENPLAN-FOTOS.md at the repo root.
//
// Routes:
//   POST /login                  { passphrase } -> { token, who }
//   GET  /photos                 (auth)         -> { photos: [...] }
//   GET  /photos/object?key=...  (auth)         -> raw image bytes
//
// CAPTIONS: captions.json (uploaded to the same private R2 bucket,
// see STAPPENPLAN-FOTOS.md) maps each filename to a [short, long]
// array — short shows under the thumbnail, long shows in the
// lightbox when the photo is clicked:
//   { "img.jpg": ["Short description", "Longer description..."] }
// A plain string value (the old format) still works and is used for
// both the short and long caption. See captions.example.json.
// =================================================================

const ALLOWED_ORIGINS = [
  'https://nelis0808.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

const SESSION_LENGTH_SECONDS = 30 * 24 * 60 * 60; // "onthouden" — ~30 days
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
        let captions = {};
        try {
          const captionsObj = await env.PHOTOS_BUCKET.get('captions.json');
          if (captionsObj) captions = JSON.parse(await captionsObj.text());
        } catch {
          // Missing/invalid captions.json is fine — photos just show without a caption.
        }

        const photos = listing.objects
          .filter((obj) => isImageKey(obj.key))
          .map((obj) => {
            const raw = captions[obj.key];
            let caption = '';
            let captionLong = '';

            if (Array.isArray(raw)) {
              // New format: ["short", "long"]
              caption = raw[0] || '';
              captionLong = raw[1] || caption;
            } else if (typeof raw === 'string') {
              // Old format: a single string, used for both.
              caption = raw;
              captionLong = raw;
            }

            return { key: obj.key, caption, captionLong, uploaded: obj.uploaded };
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
        // proxy). These bytes are only supposed to be visible to someone
        // who already proved they know a passphrase — caching by URL
        // alone at Cloudflare's shared edge would let a second, unverified
        // visitor read a cached copy without ever logging in. Browser-level
        // private caching is fine (it's scoped to this one visitor).
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
