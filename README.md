# Kalina & Niels website

A personal site for two people: date ideas, shared lists, a private
photo gallery, a travel map, and a small arcade of two-player games —
built as a dependency-free static site. Plain HTML/CSS/JS, no build
step, no framework.

- **No build step.** Open it locally with any static server, or deploy
  it as-is to GitHub Pages / Netlify / Vercel.
- **Fully responsive.** Works from a small phone up to an ultrawide
  monitor; no fixed-pixel layouts.
- **Accessible by default.** Keyboard navigation, screen-reader labels,
  reduced-motion support, and visible focus states are built in.
- **Private by default.** Every page ships `<meta name="robots"
  content="noindex, nofollow">` — remove it if you ever want the site
  publicly searchable.
- **No server required for hosting.** The site itself is fully static;
  the handful of features that need a server (shared lists, private
  photos, login, an API key) each talk to their own small Cloudflare
  Worker — see [ACTION-EXPANSION-PLAN.md](./ACTION-EXPANSION-PLAN.md).

---

## 1. Project structure

```
DateSite/
├── .nojekyll                    Tells GitHub Pages to serve every file as-is (§8) — keep this
├── index.html                 Home — "days together" counter + card grid to every page
├── date.html                  Random date-idea picker (indoor/outdoor)
├── tournament.html            Paste any list, run a single-elimination bracket
├── games-hub.html             Landing page for the games (§1.2)
├── lijstje.html                Synced shopping list
├── todo.html                   Synced TODO list (per-person, with priority)
├── snack-rating.html           Synced snack ratings (per-person, 0-5 stars + photo)
├── clothing.html                Synced clothing ratings (same pattern as snacks, + size)
├── gifts.html                   Synced gift-idea lists, two columns, link-preview thumbnails
├── ticketmaster.html            Concert search/upcoming/sales + a saved-artist "Favorieten" tab
├── photos.html                  Private photo gallery (login required)
├── reizen.html + reizen/land.html   Travel map: world map -> per-country page -> city photos (login required)
├── valentine.html                "Will you be my Valentine" surprise page
├── template.html                 Starter file for new pages — NOT linked in navigation (see §4)
├── package.json                   npm start / npm run dev convenience scripts
├── assets/
│   ├── css/
│   │   ├── main.css               Single entry point every page links to
│   │   ├── base/                   Design tokens, reset, typography
│   │   ├── layout/                   Container/grid/section primitives
│   │   ├── components/               Reusable UI: navbar, buttons, cards, forms, footer, dropdowns...
│   │   ├── utilities.css              Small helper classes (spacing, flex, animations)
│   │   ├── dark-mode.css              Component-specific dark-theme overrides
│   │   └── pages/                     One file per page, for page-only rules
│   ├── js/
│   │   ├── config.js                ⭐ Site content/config — edit this often
│   │   ├── main.js                   Single entry point every page loads
│   │   └── modules/                   One focused file per feature (see §3)
│   ├── data/                        Static JSON: date ideas, word lists, travel/map data, ...
│   ├── partials/                     Shared header/footer HTML, injected via layout.js
│   └── icons/                        SVG icons, game piece art, etc.
├── cloudflare/                     9 small Worker scripts, one per server-backed feature (see §6)
└── tools/                          One-off offline scripts (e.g. Spiderette seed generation)
```

Every HTML page lives at the project root (except the games, under
`games/`, and the two travel pages, under `reizen/`), so links between
pages are simple relative filenames — no absolute `/path`s to break
depending on where you deploy.

### 1.1 Pages

| Page | What it does |
|---|---|
| `index.html` | "Days together" counter + a card grid linking to every feature page (data-driven from `config.js`) |
| `date.html` | Random date-idea picker, indoor or outdoor |
| `tournament.html` | Paste in any list of options, runs a single-elimination bracket to one winner; quick-start buttons reuse the date-idea lists |
| `lijstje.html` | One shared, synced shopping list (or several named lists), drag-to-reorder |
| `todo.html` | Shared TODO list, one column per person, with a priority level per item |
| `snack-rating.html` | Rate snacks 0-5 stars, one column per person, with an optional photo |
| `clothing.html` | Same as snacks, plus a free-text size field |
| `gifts.html` | Two columns of gift ideas with auto-fetched link previews and optional custom photos |
| `ticketmaster.html` | Upcoming concerts / upcoming sales / search by artist, plus a saved-favorites tab |
| `photos.html` | Private photo gallery — behind a shared login |
| `reizen.html`, `reizen/land.html` | World map of visited/wishlist countries → per-country page with city pins → real photos, all behind the same shared login |
| `valentine.html` | A small "will you be my Valentine" interactive surprise |
| `template.html` | Not linked anywhere — a starter file for building a new page (§4) |

### 1.2 Games (`games-hub.html` + `games/`)

| Game | File |
|---|---|
| Tic-Tac-Toe | `games/tictactoe.html` |
| Connect 4 | `games/connect4.html` |
| Snake (2-player Tron/light-cycle) | `games/snake.html` |
| Wallz (9x9 Quoridor-style wall game) | `games/wallz.html` |
| Wordle (NL/EN, adjustable word length) | `games/wordle.html` |
| Hangman (NL/EN word lists) | `games/hangman.html` |
| Hangman — custom word (one player sets the word for the other) | `games/hangman-custom.html` |
| BlackJack (against the dealer, real chip balance when logged in) | `games/blackjack.html` |
| Spiderette (1-suit Spider solitaire, every deal provably solvable) | `games/spiderette.html` |

BlackJack and Spiderette share **one** chip balance (see §6) — chips
won in either game are immediately spendable in the other.

---

## 2. Running it locally

The site uses `fetch()` (to load JSON data) and native ES module
`<script type="module">` imports — both require the page to be served
over `http://`, not opened directly as a `file://` path.

Pick whichever you already have installed:

```bash
# Python (built into most systems)
python3 -m http.server 8000

# Node, zero-config, no install needed
npx http-server -c-1

# Or, using the provided package.json:
npm start
```

Then open `http://localhost:8000`. VS Code's "Live Server" extension
works too.

---

## 3. How the JavaScript is organised

`assets/js/main.js` is the **only** script every page loads. It calls
a list of small `init...()` functions, one per feature, imported from
`assets/js/modules/` — each one checks that its own elements exist and
returns early if they don't, so it's safe to load the same `main.js`
on every page even though no single page uses every feature. A missing
element on one page can never break a feature on another page.

Shared/site-wide modules:

| Module | Responsibility |
|---|---|
| `theme.js` | Light/dark mode + blue/pink color theme, both persisted |
| `layout.js` | Injects the shared header/footer partials into every page |
| `navbar.js` | Mobile hamburger menu, sticky-scroll shadow, back-to-top |
| `nav-dropdown.js` | The "Meer" overflow menu in the header |
| `profile-dropdown.js` / `auth.js` | Shared site-wide login (§6.2) |
| `settings-dropdown.js` | Settings panel (theme toggles + future placeholders) |
| `reveal.js` | Fade-up animation when elements scroll into view |
| `counters.js` | Animated number counters (`[data-target]`) |
| `typewriter.js` | Typing animation for a hero heading |
| `footer-year.js` | Keeps the footer copyright year current |
| `page-gate.js` | Hides an entire page's content until logged in (used by Onze Reizen) |
| `utils.js` | Small shared helpers with no DOM-specific logic |

Every other module is page-specific (one per page/game listed in §1),
named to match — e.g. `lijstje.js` backs `lijstje.html`,
`spiderette.js` + `spiderette-solver.js` back `games/spiderette.html`.

To add a new feature:

1. Create `assets/js/modules/your-feature.js` exporting
   `initYourFeature()`.
2. Guard it: `const el = document.getElementById('yourElement'); if
   (!el) return;`
3. Import and call it inside `main.js`.

---

## 4. Adding a new page

1. `cp template.html your-new-page.html` and fill in the content — the
   file has inline comments marking what to change.
2. Copy `assets/css/pages/page-template.css` to
   `assets/css/pages/your-new-page.css` for page-only CSS, and link it
   after `main.css` in your new page's `<head>`.
3. Add the nav link (`<a href="your-new-page.html">...</a>`) inside
   the `<nav id="navLinks">` block — either directly in
   `assets/partials/header.html` (shared by every page via
   `layout.js`), or, for a page that doesn't need a permanent nav
   slot, just add it to `pages` in `config.js` (next step) and it
   appears automatically in the "Meer" dropdown + as a home-page card.
4. Add an entry to `pages` in `assets/js/config.js` so it appears as a
   card on the home page — no HTML edits needed for that part.

---

## 5. Configuration (`assets/js/config.js`)

The one file you'll likely touch most often:

- `siteName` — shown in `<title>`/logo/footer.
- `relationshipStartDate` — drives the "days together" counter.
- `pages` — the home page's card grid + "Meer" dropdown entries. Add,
  remove, or reorder freely; `status: "coming-soon"` renders a
  disabled, non-clickable card.
- `games` (in `games-hub.js`) — same idea, for the games grid.
- One config block per server-backed feature (`shoppingList`, `todo`,
  `snackRatings`, `clothing`, `gifts`, `ticketmaster`, `photos`,
  `blackjack`, `spiderette`) — each holds that feature's Worker URL
  and any per-feature settings (e.g. person display names). See
  [ACTION-EXPANSION-PLAN.md](./ACTION-EXPANSION-PLAN.md) for what to
  put in each one.

---

## 6. Server-backed features (Cloudflare Workers)

Nine small features need something a static site can't do on its own
— storing a shared list, keeping an API key secret, checking a login —
so each one talks to its own small **Cloudflare Worker**
(`cloudflare/<name>/`). The site stays 100% static either way: every
page works with its Worker left unconfigured, it just shows a
"⚠️ Nog geen Worker gekoppeld" message instead of breaking.

**Full deployment instructions — general setup plus exact steps for
every Worker — live in
[ACTION-EXPANSION-PLAN.md](./ACTION-EXPANSION-PLAN.md).** Short version:

### 6.1 What each Worker does

| Feature | Worker folder | Needs a secret? |
|---|---|---|
| Shopping list | `cloudflare/lijstje/` | No |
| TODO list | `cloudflare/todo/` | No |
| Snack ratings | `cloudflare/rating/` | No |
| Clothing ratings | `cloudflare/clothing/` | No |
| Gift ideas + image resolver | `cloudflare/gifts/` | No |
| Ticketmaster concert search | `cloudflare/ticketmaster/` | Yes — Ticketmaster API key |
| Ticketmaster saved artists | `cloudflare/ticketmaster_favorite-artists/` | No |
| Private photo gallery + shared login | `cloudflare/gallery/` | Yes — 2 passphrases + a token secret |
| Shared chip balance (BlackJack + Spiderette) | `cloudflare/chips/` | Yes — same 3 secrets as gallery |

### 6.2 One login, four features

Logging in once (via the "👤 Profiel" dropdown in the header) unlocks
Onze Foto's, Onze Reizen's city photos, BlackJack, and Spiderette —
there's a single shared session, not four separate logins. The gallery
Worker is the identity provider; the chips Worker independently
verifies the same tokens by being configured with matching secrets.
Full explanation in
[ACTION-EXPANSION-PLAN.md §1.2](./ACTION-EXPANSION-PLAN.md#12-one-login-shared-across-four-features).

### 6.3 Extending a feature, or adding a new one

Adding a new chip-based game, a new login-gated feature, or an
entirely new Worker-backed feature all follow established patterns in
this codebase — see
[ACTION-EXPANSION-PLAN.md](./ACTION-EXPANSION-PLAN.md) for the
specifics on each, plus general guidance on the shape every Worker
here follows so a new one is easy to write consistently.

---

## 7. Browser support

Built on standard, broadly-supported web platform features (CSS custom
properties, `IntersectionObserver`, ES modules, `fetch`). Works in all
current versions of Chrome, Firefox, Safari, and Edge, on both desktop
and mobile. No transpilation or polyfills — if very old browsers need
support, that's a deliberate trade-off to revisit.

---

## 8. Deploying to GitHub Pages

Every link in the project is a relative filename (`date.html`,
`assets/css/main.css`, ...), never an absolute `/path`, so the site
works unchanged whether it ends up at a custom domain, a user site
(`username.github.io`), or a project site
(`username.github.io/DateSite/`).

1. Push this repo to GitHub. A `.nojekyll` file already sits at the
   project root — **keep it there** (don't delete it, and make sure
   your `.gitignore` doesn't exclude dotfiles). It tells GitHub Pages
   to serve every file exactly as-is instead of running it through
   Jekyll first, which otherwise silently skips or mangles certain
   files/folders and is a common cause of a page loading its static
   HTML but none of its JavaScript-driven content.
2. Repo **Settings → Pages → Source** → "Deploy from a branch" → pick
   your branch (e.g. `main`) and folder `/ (root)`.
3. Wait a minute, then visit the URL GitHub shows you.
4. **Hard-refresh** the first time you check it (Ctrl/Cmd+Shift+R, or
   an incognito/private window) — GitHub Pages' CDN and your browser
   can both cache an earlier, broken deploy for a while after you've
   pushed a fix.

**Custom domain (optional):** add a `CNAME` file at the project root
containing just your domain name, and configure the DNS records
GitHub documents for Pages. If you do this, also add your custom
domain to `ALLOWED_ORIGINS` in every Cloudflare Worker you've deployed
(§6, and see
[ACTION-EXPANSION-PLAN.md §1.3](./ACTION-EXPANSION-PLAN.md#13-cors--do-this-for-every-worker-you-deploy)).

**Page loads but only shows plain text, no header/cards/counter?**
That's `assets/js/main.js` failing to run — every page now shows a red
banner explaining why when this happens (instead of just looking
broken), so open the page and read it, or open the browser console
(F12) for the full error. The two most common causes on GitHub Pages
specifically: a missing/removed `.nojekyll` file (§8.1 above), or a
stale cached copy of the page from before a fix was pushed (try a hard
refresh or incognito window first, always, before troubleshooting
further).

Everything above applies equally to **Netlify / Vercel** — connect the
repo, leave the build command empty, publish directory `/`.
