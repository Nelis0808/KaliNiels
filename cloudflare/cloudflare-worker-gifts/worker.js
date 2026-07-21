// =================================================================
// GIFT IDEAS — LIST SYNC + IMAGE RESOLVER (Cloudflare Worker)
// -----------------------------------------------------------------
// Powers gifts.html: two synced lists of gift ideas ("voor Kalina" /
// "voor Niels"), each entry a link + a title + an optional note, and
// now an optional custom photo (see /gifts/upload below). No login
// here (same reasoning as the boodschappenlijst Worker) — a
// gift-idea list just isn't sensitive enough to be worth the extra
// friction.
//
// Storage:
//   - Cloudflare KV (binding `GIFTS_KV`), ONE key ("gifts") holding
//     the entire list as JSON, same "read it all, write it all back"
//     model as the shopping list — a gift list for two people never
//     gets big enough to need anything fancier.
//   - Cloudflare R2 (binding `GIFTS_BUCKET`), for OPTIONAL custom
//     photos, same idea as the private photo gallery's bucket, but
//     public/no-login (it only ever holds pictures of gift *ideas*,
//     never anything private). Filename convention: `<gift id>.<ext>`
//     — see STAPPENPLAN-GIFTS.md. Can be uploaded either by hand via
//     the R2 dashboard, OR now directly from gifts.html's add/edit
//     form via POST /gifts/upload (see below).
//
// IMAGE RESOLUTION ORDER for a given gift (GET /gifts/image), this
// is the whole point of this Worker:
//   1. Custom photo in GIFTS_BUCKET named "<id>.jpg/.png/.webp/...":
//      always wins if present — you uploaded it on purpose.
//   2. Otherwise, this Worker fetches the gift's `url` itself
//      (server-side, so no CORS/hotlink problems for the browser),
//      reads the page's <meta property="og:image"> (falling back to
//      twitter:image), and proxies that image back.
//   3. Otherwise: 404, and the site just shows a plain gift-box icon.
//
// EDITING: PATCH /gifts/:id updates title/url/note/person on an
// existing entry in place (keeping its id and addedAt), instead of
// the old "delete + re-add" being the only option. Deleting an old
// custom photo when a gift's id is removed, or replacing one on
// edit, is handled by /gifts/upload simply overwriting/removing
// whatever's stored under that id — see below.
//
// Deploy instructions: see STAPPENPLAN-GIFTS.md at the repo root.
//
// Routes:
//   GET   /gifts                          -> { gifts, updatedAt }
//   PUT   /gifts                { gifts } -> { gifts, updatedAt }  (overwrites the whole list)
//   PATCH /gifts/:id     { title?,url?,note?,person? } -> { gifts, updatedAt } (edits one entry)
//   GET   /gifts/meta?url=...             -> { title, imageUrl }  (best-effort link preview, used to prefill the add-form)
//   GET   /gifts/image?id=...&url=...     -> raw image bytes (custom photo, else scraped og:image)
//   POST  /gifts/upload?id=...            -> { ok: true }  (multipart/form-data or raw image body — uploads/replaces a custom photo for that gift)
// =================================================================

const ALLOWED_ORIGINS = [
  'https://nelis0808.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

const KV_KEY = 'gifts';
const MAX_GIFTS = 300;         // sane ceiling, not a real limit anyone will hit
const MAX_TEXT_LENGTH = 200;   // title / note
const MAX_URL_LENGTH = 2000;
const VALID_PERSONS = new Set(['a', 'b']); // a = Niels, b = Kalina (see config.js)
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8MB — generous for a phone photo, small enough to stay well within R2 free tier

const IMAGE_CONTENT_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

const EXTENSION_FOR_CONTENT_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

// ---- CORS / JSON helpers -------------------------------------------

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET, PUT, PATCH, POST, OPTIONS',
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

// ---- List validation --------------------------------------------------

/** Rejects anything that isn't a well-formed { gifts: [{id, person, title, url, note}] } payload. */
function validateGifts(body) {
  if (!body || !Array.isArray(body.gifts)) return null;
  if (body.gifts.length > MAX_GIFTS) return null;

  const cleaned = [];
  for (const raw of body.gifts) {
    if (!raw || typeof raw.title !== 'string' || typeof raw.url !== 'string') return null;
    if (!VALID_PERSONS.has(raw.person)) return null;

    const title = raw.title.trim().slice(0, MAX_TEXT_LENGTH);
    const url = raw.url.trim().slice(0, MAX_URL_LENGTH);
    // Link is optional (see gifts.html/gifts.js) — a gift needs a
    // title either way, but the url only has to be well-formed if
    // one was actually provided; empty is fine.
    if (!title || (url && !isHttpUrl(url))) continue; // silently drop malformed rows instead of rejecting the whole save

    cleaned.push({
      id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
      person: raw.person,
      title,
      url,
      note: typeof raw.note === 'string' ? raw.note.trim().slice(0, MAX_TEXT_LENGTH) : '',
      addedAt: typeof raw.addedAt === 'number' ? raw.addedAt : Date.now(),
    });
  }
  return cleaned;
}

/** Validates a PATCH body — every field optional, but whatever IS present must be well-formed. Returns a partial object to merge in, or null if the body is bad. */
function validateGiftPatch(body) {
  if (!body || typeof body !== 'object') return null;
  const patch = {};

  if ('title' in body) {
    if (typeof body.title !== 'string') return null;
    const title = body.title.trim().slice(0, MAX_TEXT_LENGTH);
    if (!title) return null;
    patch.title = title;
  }
  if ('url' in body) {
    if (typeof body.url !== 'string') return null;
    const url = body.url.trim().slice(0, MAX_URL_LENGTH);
    if (url && !isHttpUrl(url)) return null; // empty is fine (link is optional), non-empty must be well-formed
    patch.url = url;
  }
  if ('note' in body) {
    if (typeof body.note !== 'string') return null;
    patch.note = body.note.trim().slice(0, MAX_TEXT_LENGTH);
  }
  if ('person' in body) {
    if (!VALID_PERSONS.has(body.person)) return null;
    patch.person = body.person;
  }

  return patch;
}

// ---- URL / SSRF safety -------------------------------------------------
// This Worker fetches whatever URL a visitor gives it (to scrape an
// og:image), so it must never be usable as a generic proxy into
// internal/private network space.

function isHttpUrl(raw) {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isSafeExternalUrl(raw) {
  if (!isHttpUrl(raw)) return false;
  const hostname = new URL(raw).hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.local')) return false;
  // Blocks literal IPv4 private/loopback/link-local ranges. Not a
  // bulletproof SSRF filter (DNS rebinding etc. is out of scope for
  // a two-person gift list), just a reasonable sanity check.
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number);
    if (a === 127 || a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 169) {
      return false;
    }
  }
  if (hostname === '[::1]' || hostname === '::1') return false;
  return true;
}

// ---- og:image / <title> extraction --------------------------------------
// Cloudflare Workers don't ship a DOM parser, so this is a small,
// deliberately forgiving regex scan over <meta>/<title> tags rather
// than a full HTML parser — good enough for the standard tags every
// shop/product page already sets for link previews (WhatsApp,
// Twitter/X, Facebook, etc. all rely on the exact same tags).

function extractPageMeta(html, baseUrl) {
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
  const found = {};

  for (const tag of metaTags) {
    const propMatch = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i);
    const contentMatch = tag.match(/content\s*=\s*["']([^"']*)["']/i);
    if (!propMatch || !contentMatch) continue;
    const key = propMatch[1].toLowerCase();
    if (!(key in found)) found[key] = contentMatch[1];
  }

  const rawImage =
    found['og:image:secure_url'] || found['og:image'] || found['twitter:image'] || found['twitter:image:src'] || null;

  let imageUrl = null;
  if (rawImage) {
    try {
      imageUrl = new URL(rawImage, baseUrl).href;
    } catch {
      imageUrl = null;
    }
  }

  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = (found['og:title'] || (titleMatch ? titleMatch[1] : '') || '').trim().slice(0, 200);

  return { title, imageUrl };
}

function contentTypeFor(key) {
  const ext = key.split('.').pop().toLowerCase();
  return IMAGE_CONTENT_TYPES[ext] || 'application/octet-stream';
}

function isImageKey(key) {
  const ext = key.split('.').pop().toLowerCase();
  return Object.prototype.hasOwnProperty.call(IMAGE_CONTENT_TYPES, ext);
}

// A convincing browser-ish User-Agent — some shops block/serve a
// blank page to the default fetch() UA when scraping link previews.
const SCRAPE_USER_AGENT =
  'Mozilla/5.0 (compatible; KaliNielsGiftBot/1.0; +https://nelis0808.github.io/DateSite/)';

async function findCustomPhoto(bucket, giftId) {
  const listing = await bucket.list({ prefix: `${giftId}.` });
  const match = listing.objects.find((obj) => isImageKey(obj.key));
  if (!match) return null;
  return bucket.get(match.key).then((object) => (object ? { object, key: match.key } : null));
}

/** Removes any existing custom photo(s) for a gift id — used before
 *  saving a new upload (so switching file types, e.g. jpg -> png,
 *  doesn't leave the old file dangling and ambiguous) and when a
 *  gift is deleted from the list. */
async function deleteCustomPhoto(bucket, giftId) {
  const listing = await bucket.list({ prefix: `${giftId}.` });
  const imageKeys = listing.objects.filter((obj) => isImageKey(obj.key)).map((obj) => obj.key);
  await Promise.all(imageKeys.map((k) => bucket.delete(k)));
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin);
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    // ---- GET/PUT /gifts : the shared list ----
    if (url.pathname === '/gifts') {
      if (!env.GIFTS_KV) {
        return jsonResponse({ error: 'Server misconfigured: GIFTS_KV binding ontbreekt' }, 500, headers);
      }

      if (request.method === 'GET') {
        const stored = (await env.GIFTS_KV.get(KV_KEY, 'json')) || { gifts: [], updatedAt: Date.now() };
        return jsonResponse(stored, 200, headers);
      }

      if (request.method === 'PUT') {
        let body;
        try {
          body = await request.json();
        } catch {
          return jsonResponse({ error: 'Ongeldige aanvraag' }, 400, headers);
        }

        const gifts = validateGifts(body);
        if (gifts === null) {
          return jsonResponse({ error: 'Ongeldige lijst' }, 400, headers);
        }

        // Any gift that existed before this overwrite but isn't in the
        // new list anymore was deleted — clean up its custom photo too,
        // so R2 doesn't slowly accumulate orphaned images.
        if (env.GIFTS_BUCKET) {
          const previous = (await env.GIFTS_KV.get(KV_KEY, 'json')) || { gifts: [] };
          const newIds = new Set(gifts.map((g) => g.id));
          const removedIds = (previous.gifts || []).map((g) => g.id).filter((id) => !newIds.has(id));
          ctx.waitUntil(Promise.all(removedIds.map((id) => deleteCustomPhoto(env.GIFTS_BUCKET, id))));
        }

        const stored = { gifts, updatedAt: Date.now() };
        await env.GIFTS_KV.put(KV_KEY, JSON.stringify(stored));
        return jsonResponse(stored, 200, headers);
      }

      return jsonResponse({ error: 'Method not allowed' }, 405, headers);
    }

    // ---- PATCH /gifts/:id : edit one existing entry in place ----
    if (url.pathname.startsWith('/gifts/') && request.method === 'PATCH') {
      const id = url.pathname.slice('/gifts/'.length);
      if (!id) return jsonResponse({ error: 'Ontbrekende id' }, 400, headers);

      if (!env.GIFTS_KV) {
        return jsonResponse({ error: 'Server misconfigured: GIFTS_KV binding ontbreekt' }, 500, headers);
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: 'Ongeldige aanvraag' }, 400, headers);
      }

      const patch = validateGiftPatch(body);
      if (patch === null) {
        return jsonResponse({ error: 'Ongeldige wijziging' }, 400, headers);
      }

      const stored = (await env.GIFTS_KV.get(KV_KEY, 'json')) || { gifts: [], updatedAt: Date.now() };
      const index = (stored.gifts || []).findIndex((g) => g.id === id);
      if (index === -1) {
        return jsonResponse({ error: 'Cadeau niet gevonden' }, 404, headers);
      }

      stored.gifts[index] = { ...stored.gifts[index], ...patch };
      stored.updatedAt = Date.now();
      await env.GIFTS_KV.put(KV_KEY, JSON.stringify(stored));
      return jsonResponse(stored, 200, headers);
    }

    // ---- GET /gifts/meta?url=... : best-effort link preview (prefills the add-form) ----
    if (url.pathname === '/gifts/meta' && request.method === 'GET') {
      const target = url.searchParams.get('url') || '';
      if (!isSafeExternalUrl(target)) {
        return jsonResponse({ error: 'Ongeldige of niet-toegestane URL' }, 400, headers);
      }

      const cache = caches.default;
      const cacheKey = new Request(request.url, request);
      const cached = await cache.match(cacheKey);
      if (cached) return withCors(cached, headers);

      try {
        const pageResponse = await fetch(target, {
          headers: { 'User-Agent': SCRAPE_USER_AGENT, Accept: 'text/html' },
          cf: { redirect: 'follow' },
        });
        const html = await pageResponse.text();
        const meta = extractPageMeta(html, target);

        const response = jsonResponse(meta, 200, { ...headers, 'Cache-Control': 'public, max-age=86400' });
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
        return response;
      } catch (error) {
        return jsonResponse({ title: '', imageUrl: null }, 200, headers);
      }
    }

    // ---- POST /gifts/upload?id=... : upload/replace a custom photo ----
    // Body is the raw image bytes (fetch(..., { body: file }) from the
    // browser — see gifts.js) with a Content-Type header identifying
    // the image format. Deliberately simple (no multipart parsing
    // needed) since the browser only ever sends one file at a time here.
    if (url.pathname === '/gifts/upload' && request.method === 'POST') {
      if (!env.GIFTS_BUCKET) {
        return jsonResponse({ error: 'Server misconfigured: GIFTS_BUCKET binding ontbreekt' }, 500, headers);
      }

      const giftId = url.searchParams.get('id') || '';
      if (!giftId || !/^[a-zA-Z0-9-]+$/.test(giftId)) {
        return jsonResponse({ error: 'Ongeldige of ontbrekende id' }, 400, headers);
      }

      const contentType = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
      const ext = EXTENSION_FOR_CONTENT_TYPE[contentType];
      if (!ext) {
        return jsonResponse({ error: 'Alleen jpg, png, webp of gif toegestaan' }, 400, headers);
      }

      const bytes = await request.arrayBuffer();
      if (bytes.byteLength === 0) {
        return jsonResponse({ error: 'Lege upload' }, 400, headers);
      }
      if (bytes.byteLength > MAX_UPLOAD_BYTES) {
        return jsonResponse({ error: `Foto te groot (max ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB)` }, 413, headers);
      }

      // Replace, don't accumulate: drop any previous photo(s) for this
      // id first (covers switching file types, e.g. a re-uploaded jpg
      // replacing an old png) before writing the new one.
      await deleteCustomPhoto(env.GIFTS_BUCKET, giftId);
      await env.GIFTS_BUCKET.put(`${giftId}.${ext}`, bytes, {
        httpMetadata: { contentType },
      });

      return jsonResponse({ ok: true }, 200, headers);
    }

    // ---- GET /gifts/image?id=...&url=... : custom photo first, else scraped og:image ----
    if (url.pathname === '/gifts/image' && request.method === 'GET') {
      const giftId = url.searchParams.get('id') || '';
      const target = url.searchParams.get('url') || '';
      if (!giftId) return jsonResponse({ error: 'Ontbrekende id' }, 400, headers);

      // 1. Custom photo, uploaded on purpose to GIFTS_BUCKET — always wins.
      if (env.GIFTS_BUCKET) {
        try {
          const found = await findCustomPhoto(env.GIFTS_BUCKET, giftId);
          if (found) {
            return new Response(found.object.body, {
              status: 200,
              headers: {
                ...headers,
                'Content-Type': contentTypeFor(found.key),
                'Cache-Control': 'public, max-age=3600',
              },
            });
          }
        } catch (error) {
          // Bucket hiccup shouldn't block falling through to the scrape path below.
          console.error('GIFTS_BUCKET lookup failed:', error);
        }
      }

      // 2. No custom photo — try to scrape the link's og:image.
      if (!isSafeExternalUrl(target)) {
        return jsonResponse({ error: 'Geen foto beschikbaar' }, 404, headers);
      }

      const cache = caches.default;
      const cacheKey = new Request(request.url, request);
      const cached = await cache.match(cacheKey);
      if (cached) return withCors(cached, headers);

      try {
        const pageResponse = await fetch(target, {
          headers: { 'User-Agent': SCRAPE_USER_AGENT, Accept: 'text/html' },
          cf: { redirect: 'follow' },
        });
        const html = await pageResponse.text();
        const { imageUrl } = extractPageMeta(html, target);
        if (!imageUrl) return jsonResponse({ error: 'Geen og:image gevonden' }, 404, headers);

        const imageResponse = await fetch(imageUrl, { headers: { 'User-Agent': SCRAPE_USER_AGENT } });
        const contentType = imageResponse.headers.get('Content-Type') || '';
        if (!imageResponse.ok || !contentType.startsWith('image/')) {
          return jsonResponse({ error: 'Kon afbeelding niet ophalen' }, 404, headers);
        }

        const response = new Response(imageResponse.body, {
          status: 200,
          headers: {
            ...headers,
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=86400', // 1 day — product photos rarely change
          },
        });
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
        return response;
      } catch (error) {
        return jsonResponse({ error: 'Kon link niet ophalen' }, 404, headers);
      }
    }

    return jsonResponse({ error: 'Not found' }, 404, headers);
  },
};

function withCors(response, headers) {
  const copy = new Response(response.body, response);
  Object.entries(headers).forEach(([key, value]) => copy.headers.set(key, value));
  return copy;
}
