# Cloudflare Workers — implementation & expansion plan

This site is a static HTML/CSS/JS site with **no server of its own**.
Every feature that needs to store data, keep an API key secret, or
check a login talks to a small **Cloudflare Worker** instead — nine of
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

All nine Workers are single JavaScript files (`export default { async
fetch(request, env, ctx) { ... } }`) with no dependencies and no build
step — copy-paste the file's contents straight into the Cloudflare
dashboard's code editor, or deploy it with Wrangler. Every one of them
also follows the same internal pattern, so once you've deployed one
you understand the shape of all of them:

- **CORS allowlist** — an `ALLOWED_ORIGINS` array at the top of the
  file. Update this to match wherever your site is actually served
  from (see §1.3).
- **Daily call limit** — a shared `RATE_LIMIT_KV` namespace (see §1.4)
  protects each Worker's own request budget from abuse, independent of
  whatever storage/KV namespace that Worker actually uses for its
  data.
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

### 1.4 The shared rate-limit KV namespace

Every Worker checks a daily request cap against **one** shared KV
namespace, bound as `RATE_LIMIT_KV`, so you only ever need to create
this once and bind it to every Worker you deploy:

1. **Workers & Pages → KV → Create a namespace**, name it something
   like `rate-limits`.
2. On **every** Worker: **Settings → Bindings → Add binding → KV
   Namespace**, variable name `RATE_LIMIT_KV`, pick that same
   namespace.
3. Nothing else to configure — each Worker uses its own key prefix
   (`ticketmaster:`, `lijstje:`, `photos:`, etc.) internally, so they
   never collide with each other inside the shared namespace.

If you skip this binding on a given Worker, that Worker still works —
it just logs a warning and doesn't enforce a limit. Not required, but
recommended for anything whose URL might get shared or discovered.

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
   KV namespace(s) / R2 bucket that Worker needs (see Part 2) — plus
   `RATE_LIMIT_KV` from §1.4.
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

Nine Workers live under `cloudflare/`, one subfolder each. Every one
of them follows the general shape in Part 1 — this section only lists
what's unique to each.

### 2.1 `cloudflare/chips/` — shared chip balance (BlackJack + Spiderette)

**File:** `cloudflare/chips/chips_worker.js`
**Config field:** `blackjack.workerUrl` **and** `spiderette.workerUrl`
in `config.js` — point both at the **same** Worker URL.

- **Bindings:** `CHIPS_KV` (its own new KV namespace — nothing to
  pre-populate, the Worker seeds `1000` chips per person on first
  login) + `RATE_LIMIT_KV` (§1.4).
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
  it) + `RATE_LIMIT_KV` (§1.4).
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
- **`/travel` is deliberately public** (no login check) — it only ever
  returns city names + photo counts + a "visited" flag, built from
  `captions.json`'s optional fields, never filenames or anything
  usable to fetch a real photo. This is what lets Onze Reizen's map
  page show a "places we've been" teaser to a logged-out visitor while
  the actual photos stay behind login.
- Routes: `POST /login`, `GET /photos`, `GET /photos/object?key=...`,
  `GET /travel?country=XX` (public).

### 2.3 `cloudflare/lijstje/` — shared shopping list

**File:** `cloudflare/lijstje/lijstje_worker.js`
**Config field:** `shoppingList.workerUrl` in `config.js`.

- **Bindings:** `LIST_KV` (its own new KV namespace) + `RATE_LIMIT_KV`.
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

- **Bindings:** `TODO_KV` (new KV namespace) + `RATE_LIMIT_KV`.
- **Secrets:** none.
- Same "read it all, write it all back" model as lijstje, with an
  added `person` (`a`/`b`) and `priority` field per item so one list
  serves both of `todo.html`'s columns.
- Routes: `GET /todos`, `PUT /todos`.

### 2.5 `cloudflare/rating/` — snack ratings

**File:** `cloudflare/rating/rating_worker.js`
**Config field:** `snackRatings.workerUrl` in `config.js`.

- **Bindings:** `SNACKS_KV` (new KV namespace) + `RATE_LIMIT_KV`.
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

- **Bindings:** `CLOTHING_KV` (new KV namespace) + `RATE_LIMIT_KV`.
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
  pictures of gift *ideas*) + `RATE_LIMIT_KV`.
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

### 2.8 `cloudflare/ticketmaster/` — Ticketmaster API proxy

**File:** `cloudflare/ticketmaster/ticketmaster_worker.js`
**Config field:** `ticketmaster.workerUrl` in `config.js`.

1. Get a free API key at <https://developer.ticketmaster.com/> (create
   an "App" — you get a Consumer Key immediately; free tier: 5,000
   calls/day, 5 calls/second).
2. Deploy this Worker (§1.5) with one secret:
   `TICKETMASTER_API_KEY` = that Consumer Key.
3. `RATE_LIMIT_KV` binding as usual (§1.4) — no other bindings needed,
   this Worker holds no data of its own.
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

- **Bindings:** `FAVORITE_ARTISTS_KV` (new KV namespace) +
  `RATE_LIMIT_KV`.
- **Secrets:** none.
- This Worker never talks to Ticketmaster itself — it only stores the
  shared list of artist/band names. The front end still calls the
  `ticketmaster` proxy Worker (§2.8) once per saved artist and merges
  results client-side, so the two Workers stay fully independent.
- Routes: `GET /artists`, `PUT /artists`.

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
