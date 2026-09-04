# Cloudflare Workers — implementation & expansion plan

This site is a static HTML/CSS/JS site with **no server of its own**.
Every feature that needs to store data, keep an API key secret, or
check a login talks to a small **Cloudflare Worker** instead — ten of
them in total, one per feature, each with its own URL, its own secrets,
and (mostly) its own KV namespace or storage bucket. None of them know
about each other's code; a couple of them share the same *login*
secrets so a single session works everywhere (see §2).

This document has two parts:

1. **General implementation** — the shape every Worker here follows,
   the shared login system, and how to deploy any of them from
   scratch.
2. **Specific implementation** — one section per Worker, with its
   exact bindings, secrets, and any feature-specific setup (R2
   buckets, seed data, etc).

If you're just deploying the site as-is, work through part 1 once,
then part 2 for whichever features you want live. Every page works
fine with its Worker un-configured — it just shows a
"⚠️ Nog geen Worker gekoppeld" message instead of breaking.

---

## Part 1 — General implementation

### 1.1 The shape every Worker follows

All ten Workers are single JavaScript files (`export default { async
fetch(request, env, ctx) { ... } }`) with no dependencies and no build
step — copy-paste the file's contents straight into the Cloudflare
dashboard's code editor, or deploy it with Wrangler. Every one of them
also follows the same internal pattern, so once you've deployed one
you understand the shape of all of them:

- **CORS allowlist** — an `ALLOWED_ORIGINS` array at the top of the
  file. Update this to match wherever your site is actually served
  from (see §1.3).
- **No default rate limiting** — most Workers here just read/write
  small bits of JSON and don't need a request cap. One did use a
  shared `RATE_LIMIT_KV` write-per-request counter; that's been
  removed (see §1.4) after it exhausted Cloudflare's free KV write
  quota on its own. If a Worker of yours proxies something metered
  (an API key with a usage cap, e.g. `cloudflare/ticketmaster/`),
  §1.4 covers the options that don't recreate that problem.
- **JSON in, JSON out** — every route returns `Content-Type:
  application/json` (except the two Workers that proxy raw image
  bytes: gallery and gifts).
- **Fails loudly, not silently** — a missing binding or secret returns
  a clear `500 { error: "Server misconfigured: ..." }` instead of a
  cryptic crash, so a half-finished deploy is easy to diagnose from
  the browser's network tab alone.

### 1.2 One login, shared across four features

Four Workers — **gallery**, **chips**, plus (indirectly, through the
same front-end session) every page gated by it — participate in a
single shared login, so logging in once unlocks Onze Foto's, Onze
Reizen's city photos, BlackJack, and Spiderette all at once. There is
no separate "site-wide auth" Worker; the **gallery** Worker's `/login`
route is the one identity provider, and every other participating
Worker independently verifies tokens it issued.

**How it works:**

- Two passphrases are configured as secrets — `PASSPHRASE_A` (e.g.
  Niels) and `PASSPHRASE_B` (e.g. Kalina) — on the gallery Worker.
- `POST /login` on the gallery Worker checks a submitted passphrase
  against both and, on success, returns a signed token: a tiny
  stateless JWT-alike, `base64url(payload) + "." +
  base64url(HMAC-SHA256 signature)`, where `payload` is `{ who: 'a' |
  'b', exp }`.
- The browser stores that token (`assets/js/modules/auth.js`) and
  sends it as `Authorization: Bearer <token>` to any Worker that needs
  to know who's logged in.
- Any Worker that wants to accept that same session — currently just
  **chips** — independently re-implements the identical
  sign/verify logic and is configured with the **exact same**
  `TOKEN_SECRET`, `PASSPHRASE_A`, and `PASSPHRASE_B` secret values as
  the gallery Worker. A token signed by one verifies cleanly on the
  other purely because the secrets match — there's no runtime call
  between the two Workers at all.

**Setting this up:** deploy the gallery Worker first (§2.6), generate
your `TOKEN_SECRET` and choose your two passphrases there, then reuse
those same three secret values verbatim when you deploy the chips
Worker (§2.1). If you ever rotate `TOKEN_SECRET` on one, rotate it
identically on the other, or existing sessions will start failing
chips-Worker requests with 401 while the rest of the site stays logged
in (a Worker-secret mismatch, not an expired session).

**Adding a future login-gated feature:** reuse the gallery Worker's
`/login` route from the front end (via `getAuth()` /
`onAuthChange()` in `assets/js/modules/auth.js` — don't build a new
login form), and if your new feature's own Worker needs to verify who's
logged in server-side, copy the same base64url/HMAC token-verification
functions from `chips_worker.js` and set matching secrets, exactly as
above.

### 1.3 CORS — do this for every Worker you deploy

Every Worker's `ALLOWED_ORIGINS` array ships pre-filled with:

```js
const ALLOWED_ORIGINS = [
  'https://nelis0808.github.io',   // GitHub Pages project URL
  'http://localhost:8080',          // npm start / npm run dev
  'http://127.0.0.1:8080',
  'http://localhost:5500',          // VS Code "Live Server" extension
  'http://127.0.0.1:5500',
];
```

- Deploying under the same GitHub Pages project as this repo, no
  custom domain? Nothing to change — `https://nelis0808.github.io`
  covers every page in the project, since the browser's `Origin`
  header only ever contains the domain, never the path.
- Using a **different** GitHub username, org, or a **custom domain**?
  Replace/add your real origin (e.g. `'https://onzedate.nl'`) in every
  Worker you deploy, then redeploy that Worker.
- Forgetting this step is the single most common setup mistake — it
  shows up as a CORS error in the browser console, with the request
  never even reaching the Worker's own logic.

### 1.4 Rate limiting — what happened, and what to do instead

This project used to recommend one shared KV namespace
(`RATE_LIMIT_KV`) that every Worker wrote a counter to on every
request. **Don't do that** — it's what caused a real
`"You have exceeded the daily Workers KV free tier limit of 1000 put
operations"` email. The free tier's 1,000-writes/day cap is
**account-wide**, shared across every namespace and every Worker —
and one write *per request* adds up fast: a debounced search box
alone can fire a few requests a second while someone's typing, each
one an extra `KV.put()`. You hit the ceiling from completely normal
use, well before anything resembling abuse.

**Default now: no rate limiting.** Every Worker in this project just
reads/writes small bits of JSON (or, for `cloudflare/recepten/`, an
already-cached page) for two people — there's very little to actually
throttle, and the KV write itself was the bigger risk. Cache windows
(§ per-Worker, e.g. `CACHE_TTL_MS` in `recepten_worker.js`) already
keep real request volume low without spending any write quota on it.

**If one specific Worker genuinely needs protecting** — mainly
`cloudflare/ticketmaster/`, since it proxies a metered Ticketmaster API
key and a bug or loop there could burn through that key's own quota,
not just yours — pick one, roughly in order of effort:

1. **Bucketed KV counter (simplest, still dashboard-only).** Same idea
   as before, but write far less often: key the counter by hour
   instead of by request (e.g. `ticketmaster:2026-09-04T14`) and only
   increment it once per *batch* of requests using
   [`waitUntil`](https://developers.cloudflare.com/workers/runtime-apis/context/)
   or simply accept an approximate count by incrementing every Nth
   request. Cuts writes by 1-2 orders of magnitude versus per-request.
   Still KV, still simple, no new Cloudflare product to learn.
2. **Cloudflare's native Rate Limiting API binding (zero KV).** A
   built-in Workers binding designed exactly for this — no KV
   namespace, no writes at all, backed by Cloudflare's edge
   infrastructure directly:
   [developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
   **Catch:** this binding isn't offered in the dashboard's
   Settings → Bindings UI (Cloudflare's own docs note it's "not
   currently visible in the Cloudflare dashboard") — it can only be
   attached by adding a `[[ratelimits]]` block to `wrangler.toml` and
   deploying with the Wrangler CLI (`npm install -g wrangler`,
   `wrangler login`, `wrangler deploy` from the Worker's folder). Worth
   it if you're comfortable installing that once; skip it if you want
   to stay purely dashboard-based.
3. **Zone-level WAF Rate Limiting Rules (what Cloudflare's own
   support suggests, zero KV, dashboard-only).** Security →
   Security rules → Rate limiting rules, matched on the Worker's
   path, works entirely from the dashboard. **Catch:** this is a
   *zone* feature — it only applies to a domain you actually own and
   have added to your Cloudflare account. It does **not** apply to a
   bare `<name>.workers.dev` address, which is what every Worker in
   this project uses by default (Cloudflare's own domain, not your
   zone). You'd first need to attach a **Custom Domain** to the Worker
   (Worker → Settings → Domains & Routes → Add Custom Domain — this
   part *is* dashboard-only) using a domain you own and have added to
   Cloudflare; only then does that hostname become a zone you can
   write WAF rules against. Worth it only if you already have (or are
   happy to add) a domain for this; not a quick five-minute fix on
   `workers.dev` alone.

For two people planning dinner or a concert, option 1 (or nothing at
all) is almost certainly enough.

### 1.5 Deploying any Worker, step by step

The same six steps apply to all nine — the specific sections in Part 2
below only tell you which bindings/secrets/buckets that particular
Worker needs.

1. **Cloudflare account.** Free tier at
   <https://dash.cloudflare.com/sign-up> — plenty for a small personal
   site (100,000 requests/day, generous KV/R2 free tiers).
2. **Create the Worker.** Workers & Pages → Create → Create Worker.
   Give it a name (e.g. `lijstje`), Deploy the default "Hello World"
   — you'll replace it next.
3. **Paste in the code.** Edit code → replace everything with the
   full contents of that feature's `*_worker.js` file from this repo
   (see the file path in each Part 2 section) → Deploy.
4. **Add bindings.** Settings → Bindings → Add binding, for whatever
   KV namespace(s) / R2 bucket that Worker needs (see Part 2). No
   rate-limit binding needed by default anymore — see §1.4.
5. **Add secrets.** Settings → Variables and Secrets → Add → type
   **Secret** for anything sensitive (API keys, passphrases,
   `TOKEN_SECRET`) — never as a plain "Variable", and never pasted
   into the code itself.
6. **Note the Worker's URL** (`https://<name>.<your-subdomain>.workers.dev`)
   and paste it into the matching field in `assets/js/config.js` (see
   each Part 2 section for exactly which field). Until you do, the
   page shows a friendly "not configured yet" message instead of
   breaking.

**Prefer the command line?** Every Worker folder under `cloudflare/`
has (or can have) a `wrangler.toml`. Install Wrangler
(`npm install -g wrangler`), then from that folder: `wrangler deploy`,
followed by `wrangler secret put SECRET_NAME` for each secret. Fill in
any real KV/R2 namespace IDs into `wrangler.toml` first — the
dashboard flow above needs none of that and is the simpler path for a
one-person deploy.

### 1.6 Local testing

```bash
npm run dev   # or: npm start
```

As long as you're on `http://localhost:8080` (or `127.0.0.1:8080` /
`:5500`), every Worker's default `ALLOWED_ORIGINS` already permits it
— see §1.3.

### 1.7 Troubleshooting (applies to every Worker)

| Symptom | Cause | Fix |
|---|---|---|
| "⚠️ Nog geen Worker gekoppeld" | The relevant `workerUrl` in `config.js` is still the placeholder | Part 2's setup for that feature, final step |
| Console: CORS error | Your site's origin isn't in that Worker's `ALLOWED_ORIGINS` | §1.3 |
| `{"error":"Server misconfigured..."}` | A binding or secret is missing on that Worker | Re-check Part 2's bindings/secrets list for that Worker |
| `401` after being logged in fine elsewhere | That Worker's `TOKEN_SECRET`/`PASSPHRASE_A`/`PASSPHRASE_B` don't match the gallery Worker's | §1.2 — copy the three secret values over exactly |
| `429` / daily-limit message | That Worker's daily request cap was hit | Built-in cache windows (5 min–1 day depending on the Worker) reduce repeat calls; wait, or raise `DAILY_LIMIT` in that Worker's code |
| Results look "stale" after a change | An edge/response cache inside that Worker | Wait out the cache window noted in that Worker's file, or lower its `Cache-Control`/TTL |

### 1.8 Why not just put secrets in `assets/js/config.js`?

This repo is (or can be) a **public** GitHub repo. Everything under
`assets/js/` is sent verbatim to every visitor's browser and lives
forever in the git history. Any secret placed there — a Ticketmaster
API key, a login passphrase — could be copied by anyone to drain your
free-tier quota, or worse. A Worker costs nothing extra on Cloudflare's
free tier and is the only place in this whole setup where a secret
actually stays secret.

---

## Part 2 — Specific implementation, per Worker

Ten Workers live under `cloudflare/`, one subfolder each. Every one
of them follows the general shape in Part 1 — this section only lists
what's unique to each.

### 2.1 `cloudflare/chips/` — shared chip balance (BlackJack + Spiderette)

**File:** `cloudflare/chips/chips_worker.js`
**Config field:** `blackjack.workerUrl` **and** `spiderette.workerUrl`
in `config.js` — point both at the **same** Worker URL.

- **Bindings:** `CHIPS_KV` (its own new KV namespace — nothing to
  pre-populate, the Worker seeds `1000` chips per person on first
  login). No rate-limit binding needed by default — see §1.4.
- **Secrets:** `PASSPHRASE_A`, `PASSPHRASE_B`, `TOKEN_SECRET` — **must
  exactly match** the gallery Worker's (§1.2). They can be the same
  passphrases you chose for the gallery Worker, or different ones —
  either way, use the identical values on both Workers.
- **Deliberately game-agnostic:** `/chips` stores one balance per
  PERSON (`a`/`b`), never per game — that's what makes chips won in
  BlackJack immediately spendable in Spiderette. Adding a third
  chip-based game later: just point its own `workerUrl` config entry
  at this same URL and implement the same `GET`/`PUT /chips` calls
  (copy the pattern from `spiderette.js`) — no new Worker or KV
  namespace needed.
- **Manually adjusting someone's balance:** Workers & Pages → KV →
  your `CHIPS_KV` namespace → edit the `"a"` or `"b"` key directly (a
  plain integer stored as a string). The Worker always reads fresh,
  never caches.
- Routes: `POST /login`, `GET /chips`, `PUT /chips`.

### 2.2 `cloudflare/gallery/` — identity provider + private photo gallery

**File:** `cloudflare/gallery/gallery_worker.js`
**Config field:** `photos.workerUrl` in `config.js` (also powers Onze
Reizen's `/travel` endpoint — no separate config needed there).

This is the Worker described in §1.2 — deploy this one **first**,
before chips, since chips reuses its secrets.

- **Bindings:** `PHOTOS_BUCKET` (a new R2 bucket, kept fully private —
  never make it public, the Worker is the only thing allowed to read
  it). No rate-limit binding needed by default — see §1.4.
- **Secrets:** `PASSPHRASE_A`, `PASSPHRASE_B`, `TOKEN_SECRET` (a long
  random string — a password generator's output is fine, nobody needs
  to remember it).
- **Uploading photos:** drag files straight into the R2 bucket via the
  Cloudflare dashboard (R2 → your bucket → Upload). No upload UI on
  the site itself.
- **Captions (optional):** upload a `captions.json` to the same
  bucket, mapping filename → an array of up to 4 strings:
  ```json
  { "img.jpg": ["Short caption", "Longer caption...", "Portugal", "Lissabon"] }
  ```
  The first two are the short/long captions shown in the gallery. The
  optional 3rd/4th (country, place) are what power Onze Reizen's city
  pins — a photo without them just never shows up on the travel map,
  everything else about it works the same.
- **Stock/moodboard photos for wishlist cities:** give an entry a full
  `http(s)://` URL as its key instead of a filename — e.g. an Unsplash
  photo:
  ```json
  { "https://images.unsplash.com/photo-xxxx": ["Short caption", "Longer caption... https://example.com", "Portugal", "Porto"] }
  ```
  A URL-keyed entry is never looked up in R2 (it doesn't need to be —
  the URL is already a public image), and is therefore never gated
  behind login the way a real photo is. It's returned directly by the
  public `/travel` endpoint instead, alongside that city's real-photo
  count, and shows up as that wishlist pin's moodboard on
  `reizen/land.html` — same short-caption/click-to-enlarge/
  longer-caption-with-a-working-link treatment as a real photo. See
  `cloudflare/gallery/captions.json` for a worked Porto example, and
  `travel-countries.json`'s own `_unvisitedCityPinsComment`.
- **`/travel` is deliberately public** (no login check) — for real
  (filename-keyed) photos it only ever returns city names + photo
  counts + a "visited" flag, built from `captions.json`'s optional
  fields, never filenames or anything usable to fetch a real photo.
  URL-keyed (stock) entries are the one exception: their caption + URL
  ARE returned here, since that URL was already public before it went
  into `captions.json`. This is what lets Onze Reizen's map page show
  a "places we've been" teaser (and wishlist-city moodboards) to a
  logged-out visitor while the actual private photos stay behind
  login.
- Routes: `POST /login`, `GET /photos`, `GET /photos/object?key=...`,
  `GET /travel?country=XX` (public).

### 2.3 `cloudflare/lijstje/` — shared shopping list

**File:** `cloudflare/lijstje/lijstje_worker.js`
**Config field:** `shoppingList.workerUrl` in `config.js`.

- **Bindings:** `LIST_KV` (its own new KV namespace). No rate-limit binding needed by default — see §1.4.
- **Secrets:** none — no login for this feature (nothing sensitive,
  the Worker URL itself isn't public).
- **Multiple named lists:** the first time `/lists` is called with no
  index yet, the Worker seeds one starter list (or adopts a legacy
  single-list key, if one exists from before multi-list support was
  added — see `LEGACY_KEYS` in the file).
- Routes: `GET/POST/PUT /lists`, `PATCH/DELETE /lists?id=`,
  `GET/PUT /list?id=`.

### 2.4 `cloudflare/todo/` — shared TODO list

**File:** `cloudflare/todo/todo_worker.js`
**Config field:** `todo.workerUrl` in `config.js`.

- **Bindings:** `TODO_KV` (new KV namespace). No rate-limit binding needed by default — see §1.4.
- **Secrets:** none.
- Same "read it all, write it all back" model as lijstje, with an
  added `person` (`a`/`b`) and `priority` field per item so one list
  serves both of `todo.html`'s columns.
- Routes: `GET /todos`, `PUT /todos`.

### 2.5 `cloudflare/rating/` — snack ratings

**File:** `cloudflare/rating/rating_worker.js`
**Config field:** `snackRatings.workerUrl` in `config.js`.

- **Bindings:** `SNACKS_KV` (new KV namespace). No rate-limit binding needed by default — see §1.4.
- **Secrets:** none.
- **Photos:** no R2 bucket needed — `snack-rating.js` downscales and
  JPEG-compresses a chosen photo client-side into a small data URL
  *before* it ever reaches this Worker, and that string is stored
  directly on the item in KV. Simpler than a second storage system,
  and comfortably within a single KV value's 25MB limit.
- Routes: `GET /snacks`, `PUT /snacks`.

### 2.6 `cloudflare/clothing/` — clothing ratings

**File:** `cloudflare/clothing/clothing_worker.js`
**Config field:** `clothing.workerUrl` in `config.js`.

- **Bindings:** `CLOTHING_KV` (new KV namespace). No rate-limit binding needed by default — see §1.4.
- **Secrets:** none.
- Identical pattern to `rating` above (client-side-compressed photo
  data URLs, no R2), with one extra free-text `size` field per item
  (e.g. "M", "42", "32/34").
- Routes: `GET /clothing`, `PUT /clothing`.

### 2.7 `cloudflare/gifts/` — gift idea lists + image resolver

**File:** `cloudflare/gifts/gifts_worker.js`
**Config field:** `gifts.workerUrl` in `config.js`.

- **Bindings:** `GIFTS_KV` (new KV namespace, the list itself) +
  `GIFTS_BUCKET` (new R2 bucket, public/no-login — it only ever holds
  pictures of gift *ideas*). No rate-limit binding needed by default — see §1.4.
- **Secrets:** none.
- **Image resolution order** for a gift's thumbnail: (1) a custom
  photo uploaded via the add/edit form (`POST /gifts/upload`, stored
  as `<gift id>.<ext>` in `GIFTS_BUCKET`) always wins if present; (2)
  otherwise the Worker fetches the gift's `url` itself server-side and
  scrapes its `<meta property="og:image">`; (3) otherwise, no image —
  the site shows a plain gift-box icon.
- **SSRF safety:** the Worker validates any URL it's asked to fetch
  (blocks localhost/private-IP ranges) since it fetches whatever link
  a visitor gives it.
- Routes: `GET/PUT /gifts`, `PATCH /gifts/:id`, `GET /gifts/meta?url=`,
  `GET /gifts/image?id=&url=`, `POST /gifts/upload?id=`.
- **`price` field:** gifts optionally carry an integer `price` (whole
  euros), used by the Collecties/rewards system (see §2.10) to pick a
  gift as a reward. This needed **no changes here** — `PUT /gifts`
  already stores/returns whatever fields each gift object has, so
  `price` just rides along like any other field. The site's own edit
  form always saves via `PUT /gifts` (not `PATCH /gifts/:id`)
  specifically so this keeps working regardless of which fields your
  deployed `PATCH` route happens to whitelist.

### 2.10 Collecties / rewards (`timer.html` → `collections.html`) — no Worker

Unlike every feature above, this one has **no Cloudflare Worker of its
own** and needed none added. Collected-collectible counts and which
gift is chosen per reward row are stored in `localStorage`, namespaced
per logged-in person — the exact same pattern the Studie Timer's own
tree-growth state already uses (see `study-timer.js`'s `KEY`
constant), just under its own key (see `collectibles.js`'s `KEY`).
Login itself still goes through the shared identity Worker (§1.2) —
this page is gated the same way Onze Reizen is (`page-gate.js`) — but
nothing about *progress* is server-backed. If you'd rather have it
sync across devices, `collectibles.js`'s `readStore()`/`writeStore()`
are the only two functions that would need to change (swap them for
`fetch` calls to a new Worker, following the same shape as §1.1).

### 2.8 `cloudflare/ticketmaster/` — Ticketmaster API proxy

**File:** `cloudflare/ticketmaster/ticketmaster_worker.js`
**Config field:** `ticketmaster.workerUrl` in `config.js`.

1. Get a free API key at <https://developer.ticketmaster.com/> (create
   an "App" — you get a Consumer Key immediately; free tier: 5,000
   calls/day, 5 calls/second).
2. Deploy this Worker (§1.5) with one secret:
   `TICKETMASTER_API_KEY` = that Consumer Key.
3. This is the one Worker in this project where request throttling
   still genuinely matters — it proxies your Ticketmaster API key, and
   a bug/loop here burns through *that key's* 5,000-calls/day quota,
   not just Cloudflare's. See §1.4 for options (the 5-minute
   edge-cache mentioned below already helps a lot on its own; avoid
   recreating a per-request `RATE_LIMIT_KV` write on top of it).
4. Paste the Worker URL into `ticketmaster.workerUrl`.

The Worker builds Ticketmaster's exact query parameters server-side
per "mode" (`upcoming`, `sales`, `search`) so the browser never needs
to know Ticketmaster's param names, and edge-caches identical queries
for 5 minutes to protect your daily quota.

### 2.9 `cloudflare/ticketmaster_favorite-artists/` — saved artist list

**File:** `cloudflare/ticketmaster_favorite-artists/ticket_master_favorite_artists_worker.js`
**Config field:** `ticketmaster.favoriteArtistsWorkerUrl` in
`config.js` — a **separate** Worker/URL from `ticketmaster.workerUrl`
above.

- **Bindings:** `FAVORITE_ARTISTS_KV` (new KV namespace). No
  rate-limit binding needed by default — see §1.4.
- **Secrets:** none.
- This Worker never talks to Ticketmaster itself — it only stores the
  shared list of artist/band names. The front end still calls the
  `ticketmaster` proxy Worker (§2.8) once per saved artist and merges
  results client-side, so the two Workers stay fully independent.
- Routes: `GET /artists`, `PUT /artists`.

### 2.11 `cloudflare/recepten/` — Albert Heijn / Allerhande recipes + favorites

**File:** `cloudflare/recepten/recepten_worker.js`
**Config field:** `recipes.workerUrl` in `config.js` — the same field
also carries the curated category/subcategory menu itself (see the
comment above `recipes:` in `config.js`), so most day-to-day tweaks
(add a category, rename a chip) don't touch this Worker at all.

**⚠️ Already deployed and got the "exceeded daily Workers KV free
tier limit of 1000 put operations" email?** That was this Worker's old
`RATE_LIMIT_KV` counter, which wrote to KV on *every single request* —
removed as of this version, see §1.4 for the full story. Do this now:

1. Open the `recepten` Worker → **Settings → Bindings** → remove the
   `RATE_LIMIT_KV` binding if present (this alone stops the writes
   immediately, no redeploy needed — the code already no-ops without
   it, but you're about to replace the code anyway in step 2).
2. **Edit code** → replace the contents with this version of
   `cloudflare/recepten/recepten_worker.js` (no `RATE_LIMIT_KV`
   reference at all anymore) → Deploy.
3. Nothing else to do — the account-wide write quota resets on its own
   (Cloudflare's email told you exactly when); once it does, the
   `RECIPES_KV` writes this Worker still makes (a handful a day, see
   "Caching" below) are nowhere near the limit on their own.
4. If other Workers of yours are also bound to a shared
   `RATE_LIMIT_KV`/`rate-limits` namespace, repeat step 1 for each —
   removing the binding is a dashboard-only action and safe even
   without touching that Worker's code (every Worker in this project
   already no-ops when the binding is missing).

**⚠️ Unofficial and unsupported.** There is no public Albert Heijn
recipe API. This Worker reads the same public, no-login
`ah.nl/allerhande` pages a browser would and extracts what it needs —
see the long comment at the top of `recepten_worker.js` for exactly
how, and what happens when a curated category slug doesn't match AH's
own (automatic fallback to a plain keyword search, surfaced to the
front end as `fallbackUsed`). Albert Heijn can restructure `ah.nl` at
any time without notice; if results ever look empty or wrong, that
file's "EXTRACTION NOTES" section says exactly what to look at first.
Nothing here bypasses a login, paywall, or AH's own rate limiting — it
only reads pages any visitor's browser can already load, and only
does so at most once a day per query (see "Caching" below).

#### Step by step

This is the same 6-step flow as §1.5, spelled out exactly for this
Worker — do these in order:

1. **Create a KV namespace for this feature.** Workers & Pages → KV →
   Create a namespace → name it e.g. `recepten-cache`.
2. **Create the Worker.** Workers & Pages → Create → Create Worker →
   name it e.g. `recepten` → Deploy the default "Hello World" page —
   you'll overwrite it in the next step.
3. **Paste in the code.** Open the Worker → Edit code → select all,
   delete → paste the full contents of
   `cloudflare/recepten/recepten_worker.js` → Deploy.
4. **Add one binding.** Settings → Bindings → Add binding → KV
   Namespace → variable name `RECIPES_KV` → pick the `recepten-cache`
   namespace from step 1 → Save/Deploy. (No second binding needed —
   see the callout above if you're coming from an older version of
   this Worker that also asked for `RATE_LIMIT_KV`.)
5. **Secrets:** none needed — this Worker has no API keys or
   passphrases. Skip this step.
6. **Copy the Worker's URL and paste it into the site.** It looks like
   `https://recepten.<your-subdomain>.workers.dev` (shown on the
   Worker's overview page). Open `assets/js/config.js`, find
   `recipes: { workerUrl: ... }`, and replace the placeholder URL
   there with your real one.
7. **Confirm your site's origin is allowed.** Default GitHub Pages URL
   with no custom domain? Nothing to do — already covered (§1.3). Using
   a custom domain? Add it to `ALLOWED_ORIGINS` near the top of
   `recepten_worker.js`, then Deploy again.
8. **Test it end to end.** Open `recepten.html` → click a category tab
   (e.g. Pasta) → recipe cards with pictures should appear within a
   few seconds. Click a card → ingredients + bereidingswijze should
   load, and changing "aantal personen" should rescale every amount
   live. Click the ⭐ on a card, reload the page, and check it's still
   favorited (confirms the KV write worked).

If step 8 shows the "⚠️ Nog geen Worker gekoppeld" banner, step 6
wasn't saved — check `config.js` again. If the page loads but shows a
request error, work through §1.7's table first; if the Worker responds
but recipes are empty/wrong specifically here, see this file's own
"EXTRACTION NOTES" section next.

#### Reference

- **Bindings:** `RECIPES_KV` only (its own KV namespace from step 1
  above — caches scraped listing/detail pages for 24h, and also holds
  the shared `favorites` list). No rate-limit binding — see §1.4.
- **Secrets:** none.
- **Favorites, on the SAME Worker:** unlike Ticketmaster's saved
  artists (a separate Worker, §2.9), the shared "Favorieten" list here
  is just one more KV key (`favorites`) on this same Worker, since
  there's no separate secret-holding proxy to keep independent from —
  simpler for a single-purpose feature like this one.
- **Caching — scrapes `ah.nl` at most once a day, on purpose:** both
  `/recipes` and `/recipe` cache their result in KV for 24h
  (`CACHE_TTL_MS` in the Worker); AH is only actually re-scraped once
  that entry is stale, and the result is shared across both
  people/every device. On top of that, the browser keeps an identical
  24h cache in `localStorage` (`CLIENT_CACHE_TTL_MS` in `recepten.js`),
  so a repeat visit on the same device often never even reaches the
  Worker. Neither layer is a scheduled/Cron pre-fetch — it's plain
  lazy caching (fetch only when asked, then reuse for a day), which
  needs no extra Cloudflare setup and is the minimal way to get "once
  a day" for two people browsing dinner ideas. Want fresher results
  sooner? Lower `CACHE_TTL_MS` in the Worker **and**
  `CLIENT_CACHE_TTL_MS` in `recepten.js` together (keep them equal) —
  at the cost of more requests to `ah.nl`.
- Routes: `GET /recipes` (listing/search), `GET /recipe` (one recipe's
  full detail), `GET /favorites`, `PUT /favorites`.
- **CPU time:** parsing a full `ah.nl` results page (regex over the
  raw HTML) is heavier than the other Workers here, which mostly just
  read/write small JSON blobs. Cloudflare's free "Workers Free" plan
  caps CPU time per request tighter than the paid plan; if listing
  requests start failing with a CPU-limit error in the dashboard's
  logs (not a normal `{"error": ...}` JSON response — those are
  handled fine), that's the cause. The 24h cache above means this only
  bites once per query per day at most; if it keeps happening, Workers
  Paid ($5/mo, 30s CPU time) removes the ceiling entirely.

---

## Appendix — "Onze Reizen" map data (not a Worker, but related setup)

The world map and per-country borders that power `reizen.html` /
`reizen/land.html` aren't fetched from any Worker or external API —
they're static JSON files already bundled in the repo
(`assets/data/world-map.json`, `assets/data/countries/<ISO>.json`),
generated once from [Natural Earth](https://www.naturalearthdata.com/)
(public domain vector map data, via the `world-atlas` npm package) and
committed like any other asset. Nothing to deploy or configure for
this part — city pins and photos on top of that static map come from
the gallery Worker's `/travel` endpoint (§2.2) instead.

Similarly, `assets/data/spiderette-seeds.json` (a bundled pool of
350+ pre-verified-solvable game seeds) was generated once, offline,
with `node tools/generate-spiderette-seeds.mjs` (also available as
`npm run generate-spiderette-seeds`) — see
`assets/js/modules/spiderette-solver.js`'s file header for how the
solver behind it works. Nothing to deploy here either; the game falls
back to solving a fresh deal live in the browser if this file is ever
unavailable.
