// =================================================================
// LIJSTJE — Cloudflare Worker
// -----------------------------------------------------------------
// Backs lijstje.html / assets/js/modules/lijstje.js. Stores one or
// more named lists ("categories") in Cloudflare KV, under a single
// index key holding id + name per list (order = array order), plus
// one key per list holding its items. No login required: nothing
// sensitive is stored, and the Worker URL itself isn't public.
//
// BINDINGS (Settings -> Bindings on this Worker)
//   LIST_KV       -> this Worker's own KV namespace (its data, see
//                     KV LAYOUT below)
//   RATE_LIMIT_KV -> the KV namespace shared with every other Worker
//                     on this site, used only for the daily request
//                     counter (see "Daily call limit" further down).
//                     Worker still runs without it, just without a
//                     limit — see checkAndIncrementDailyLimit().
//
// KV LAYOUT (in LIST_KV)
//   "lists"       -> { lists: [ { id, name }, ... ] }
//   "list:<id>"   -> { items: [ { id, text, checked }, ... ] }
//
// ENDPOINTS
//   GET    /lists            -> { lists: [...] }
//   POST   /lists             body { name }          -> creates a list  -> { id, name }
//   PUT    /lists             body { order: [id...] } -> reorders lists -> { lists: [...] }
//   PATCH  /lists?id=<id>     body { name }          -> renames a list  -> { id, name }
//   DELETE /lists?id=<id>                             -> deletes a list -> { ok: true }
//
//   GET    /list?id=<id>                              -> { items: [...] }
//   PUT    /list?id=<id>      body { items }          -> saves items    -> { items: [...] }
//
// PUT /lists (reorder) backs the drag-and-drop reordering in the
// "Lijsten wijzigen" view of the dropdown on the front end.
//
// MIGRATION: the first time /lists is called and no "lists" index
// exists yet, this worker checks for a legacy single-list KV key
// (see LEGACY_KEYS below) and adopts it as the first list, so an
// existing list from before the multi-list index was added doesn't
// disappear. If nothing legacy is found either, it seeds one
// starter list instead.
// =================================================================

const ALLOWED_ORIGINS = [
  'https://nelis0808.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

// Legacy single-list KV key names to check during migration, in order.
const LEGACY_KEYS = ['list', 'shopping-list', 'boodschappenlijst'];

const DEFAULT_LIST_NAME = 'Boodschappen';

// Built inside a function (not as a module-scope constant) since
// Workers' runtime rejects any async I/O / timers / random-value
// generation outside a handler ("Disallowed operation called within
// global scope") — module-scope code runs once when the Worker
// script is first evaluated, before any request/handler context
// exists. This function only ever runs from within fetch().
function defaultItems() {
  return [
    { id: crypto.randomUUID(), text: 'Blikgroente', checked: false },
    { id: crypto.randomUUID(), text: 'Broodbeleg', checked: false },
    { id: crypto.randomUUID(), text: 'Ontbijtkoek', checked: false },
  ];
}

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
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
const RATE_LIMIT_PREFIX = 'lijstje';
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

async function readIndex(env) {
  const raw = await env.LIST_KV.get('lists', 'json');
  return raw && Array.isArray(raw.lists) ? raw.lists : null;
}

async function writeIndex(env, lists) {
  await env.LIST_KV.put('lists', JSON.stringify({ lists }));
}

async function readListItems(env, id) {
  const raw = await env.LIST_KV.get(`list:${id}`, 'json');
  return raw && Array.isArray(raw.items) ? raw.items : [];
}

async function writeListItems(env, id, items) {
  await env.LIST_KV.put(`list:${id}`, JSON.stringify({ items }));
}

// Runs once, the first time /lists is requested and no index exists
// yet. Tries to adopt an old single-list key so nobody's existing
// list vanishes on upgrade; otherwise seeds a starter list.
async function migrateOrSeed(env) {
  for (const legacyKey of LEGACY_KEYS) {
    const legacy = await env.LIST_KV.get(legacyKey, 'json');
    if (legacy && Array.isArray(legacy.items)) {
      const id = crypto.randomUUID();
      const lists = [{ id, name: DEFAULT_LIST_NAME }];
      await writeIndex(env, lists);
      await writeListItems(env, id, legacy.items);
      return lists;
    }
  }

  const id = crypto.randomUUID();
  const lists = [{ id, name: DEFAULT_LIST_NAME }];
  await writeIndex(env, lists);
  await writeListItems(env, id, defaultItems());
  return lists;
}

async function getOrInitLists(env) {
  const lists = await readIndex(env);
  if (lists) return lists;
  return migrateOrSeed(env);
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

    if (!env.LIST_KV) {
      return json({ error: 'Server misconfigured: LIST_KV binding ontbreekt' }, 500, origin);
    }

    try {
      // ---- /lists (the index of categories) --------------------------
      if (url.pathname === '/lists') {
        if (request.method === 'GET') {
          const lists = await getOrInitLists(env);
          return json({ lists }, 200, origin);
        }

        if (request.method === 'POST') {
          const body = await request.json().catch(() => ({}));
          const name = String(body.name || '').trim().slice(0, 60);
          if (!name) return json({ error: 'Naam is verplicht' }, 400, origin);

          const lists = await getOrInitLists(env);
          const id = crypto.randomUUID();
          const newList = { id, name };
          lists.push(newList);
          await writeIndex(env, lists);
          await writeListItems(env, id, []);
          return json(newList, 201, origin);
        }

        // Reorder: body { order: [id, id, ...] } — the full new order
        // of existing list ids, sent after a drag in "Lijsten
        // wijzigen". Unknown ids in `order` are ignored; any existing
        // list missing from `order` keeps its relative position and
        // is appended at the end (defensive — shouldn't normally
        // happen from the front end).
        if (request.method === 'PUT') {
          const body = await request.json().catch(() => ({}));
          const order = Array.isArray(body.order) ? body.order : null;
          if (!order) return json({ error: '"order" (array van ids) is verplicht' }, 400, origin);

          const lists = await getOrInitLists(env);
          const byId = new Map(lists.map((list) => [list.id, list]));
          const reordered = order.map((id) => byId.get(id)).filter(Boolean);
          for (const list of lists) {
            if (!order.includes(list.id)) reordered.push(list);
          }
          await writeIndex(env, reordered);
          return json({ lists: reordered }, 200, origin);
        }

        // Rename/delete of a single list both take their id via
        // ?id=, but PATCH/DELETE arrive at this same /lists path —
        // handle them here rather than a separate pathname.
        if (request.method === 'PATCH' || request.method === 'DELETE') {
          const id = url.searchParams.get('id');
          if (!id) return json({ error: '"id" query parameter is verplicht' }, 400, origin);

          const lists = await getOrInitLists(env);
          const index = lists.findIndex((list) => list.id === id);
          if (index === -1) return json({ error: 'Lijst niet gevonden' }, 404, origin);

          if (request.method === 'PATCH') {
            const body = await request.json().catch(() => ({}));
            const name = String(body.name || '').trim().slice(0, 60);
            if (!name) return json({ error: 'Naam is verplicht' }, 400, origin);
            lists[index] = { ...lists[index], name };
            await writeIndex(env, lists);
            return json(lists[index], 200, origin);
          }

          // DELETE — keep at least one list around so the page always
          // has something to show.
          if (lists.length <= 1) {
            return json({ error: 'De laatste lijst kan niet verwijderd worden' }, 400, origin);
          }
          lists.splice(index, 1);
          await writeIndex(env, lists);
          await env.LIST_KV.delete(`list:${id}`);
          return json({ ok: true }, 200, origin);
        }

        return json({ error: 'Method not allowed' }, 405, origin);
      }

      // ---- /list?id=<id> (the items inside one category) --------------
      if (url.pathname === '/list') {
        const id = url.searchParams.get('id');
        if (!id) return json({ error: '"id" query parameter is verplicht' }, 400, origin);

        if (request.method === 'GET') {
          const items = await readListItems(env, id);
          return json({ items }, 200, origin);
        }

        if (request.method === 'PUT') {
          const body = await request.json().catch(() => ({}));
          const items = Array.isArray(body.items) ? body.items : null;
          if (!items) return json({ error: '"items" (array) is verplicht' }, 400, origin);
          await writeListItems(env, id, items);
          return json({ items }, 200, origin);
        }

        return json({ error: 'Method not allowed' }, 405, origin);
      }

      return json({ error: 'Not found' }, 404, origin);
    } catch (error) {
      return json({ error: `Server error: ${error.message}` }, 500, origin);
    }
  },
};
