# OnzeSite

A small personal "date ideas" site, rebuilt as a clean, dependency-free
static-site **template**: plain HTML/CSS/JS, no build step, no framework,
designed to be easy to extend with new pages and features over time.

- **No build step.** Open it locally with any static server, or deploy it
  as-is to GitHub Pages / Netlify / Vercel.
- **Fully responsive.** Works from a small phone up to an ultrawide
  monitor; no fixed pixel layouts.
- **Accessible by default.** Keyboard navigation, screen-reader labels,
  reduced-motion support, and visible focus states are built in, not
  bolted on.
- **Private by default.** Every page ships `<meta name="robots"
  content="noindex, nofollow">` since this is personal content — remove
  it if you ever want the site to be publicly searchable.

---

## 1. Project structure

```
DateSite/
├── index.html              Home page — "days together" + hub of cards
├── date.html                Date-ideas random picker (indoor/outdoor)
├── tournament.html            Single-elimination "which one wins" decision tool
├── template.html             Starter file for building new pages — NOT
│                              linked in navigation, copy it to start a
│                              new page (see §4)
├── package.json               Optional convenience scripts (npm start / npm run dev)
├── .nojekyll                    Tells GitHub Pages to skip Jekyll processing (see §8)
├── .github/workflows/deploy.yml  Optional ready-to-use GitHub Pages Actions deploy
├── assets/
│   ├── css/
│   │   ├── main.css           Single entry point every page links to
│   │   ├── base/               Design tokens, reset, typography
│   │   ├── layout/               Container/grid/section primitives
│   │   ├── components/           Reusable UI: navbar, buttons, cards, forms, footer, stats
│   │   ├── utilities.css          Small helper classes (spacing, flex, animations)
│   │   ├── dark-mode.css          Component-specific dark-theme overrides
│   │   └── pages/                 One file per page, for page-only rules
│   ├── js/
│   │   ├── config.js            ⭐ Site content/config — edit this often
│   │   ├── main.js               Single entry point every page loads
│   │   └── modules/               One focused file per feature (see §3)
│   ├── data/
│   │   ├── date-ideas-indoor.json
│   │   └── date-ideas-outdoor.json
│   └── icons/
│       └── favicon.svg
```

Every HTML page lives at the project root (matching the original repo),
so links between pages are always simple relative filenames — no
`/absolute/paths` to break if you deploy under a sub-path.

**Pages included:**
- `index.html` — the "days together" counter plus a card grid linking
  to every feature page (data-driven from `config.js`, §5).
- `date.html` — picks a random date idea from an indoor or outdoor list.
- `tournament.html` — paste in any list of options and it runs a
  single-elimination bracket until one winner remains; also has
  quick-start buttons to reuse the date-idea lists as tournament input.
- `template.html` — not linked anywhere; a starter file for new pages.

---

## 2. Running it locally

The site uses `fetch()` (to load the date-ideas JSON) and native ES
module `<script type="module">` imports — both require the page to be
loaded over `http://`, not opened directly as a `file://` path.

Pick whichever you already have installed:

```bash
# Python (built into most systems)
python3 -m http.server 8000

# Node, zero-config, no install needed
npx http-server -c-1

# Or, if you added the provided package.json:
npm start
```

Then open `http://localhost:8000`. VS Code's "Live Server" extension
works too.

---

## 3. How the JavaScript is organised

`assets/js/main.js` is the **only** script every page loads. It calls a
list of small `init...()` functions, one per feature, imported from
`assets/js/modules/`:

| Module | Responsibility |
|---|---|
| `theme.js` | Light/dark mode toggle + persistence |
| `navbar.js` | Mobile hamburger menu, sticky-scroll shadow, smooth scroll, back-to-top |
| `reveal.js` | Fade-up animation when elements scroll into view |
| `counters.js` | Animated number counters (`[data-target]`) |
| `typewriter.js` | Typing animation for the main hero heading |
| `footer-year.js` | Keeps the footer copyright year current |
| `days-counter.js` | "Days together" counter on the home page |
| `home-cards.js` | Renders the home page's card grid from `config.js` |
| `date-picker.js` | Loads/display random date ideas |
| `tournament.js` | Single-elimination decision tournament |
| `utils.js` | Small shared helpers (no DOM-specific logic) |

**Every `init...()` function checks that its elements exist before doing
anything else, and returns early if they don't.** This is what makes it
safe to load the same `main.js` on every page even though not every page
uses every feature — a missing element on one page can never break a
feature on another page. (The original `script.js` didn't do this: it
assumed elements existed unconditionally, which — because `index.html`
and `date.html` were missing several of the elements `script.js`
expected — caused it to throw immediately and silently skip the rest of
the file. See §6.)

To add a new feature:

1. Create `assets/js/modules/your-feature.js` exporting `initYourFeature()`.
2. Guard it: `const el = document.getElementById('yourElement'); if (!el) return;`
3. Import and call it inside `DOMContentLoaded` in `main.js`.

---

## 4. Adding a new page

1. `cp template.html your-new-page.html` and fill in the content —
   the file has inline comments marking what to change.
2. Copy `assets/css/pages/page-template.css` to
   `assets/css/pages/your-new-page.css` for any page-only CSS, and link
   it after `main.css` in your new page's `<head>`.
3. Add the nav link (`<a href="your-new-page.html">...</a>`) inside the
   `<nav id="navLinks">` block on **every** page, including this one —
   the header is small enough that keeping it as plain duplicated HTML
   is simpler than building a templating layer for it. If this ever
   feels painful (e.g. you're past 5–6 pages), that's the signal to
   introduce a static-site generator like Eleventy or Astro, which can
   read `assets/js/config.js`-style data and generate the header for
   you — nothing else in this structure needs to change to make that
   move later.
4. Add an entry to `pages` in `assets/js/config.js` so it appears as a
   card on the home page automatically — no HTML edits needed for that
   part.

---

## 5. Configuration (`assets/js/config.js`)

This is the one file you'll likely touch most often:

- `siteName` — shown in `<title>`/logo/footer (keep in sync with the
  hard-coded "OnzeSite" text in the HTML files — see the note in §4
  about why the header isn't templated).
- `relationshipStartDate` — drives the "days together" counter.
- `nav` — kept here for reference/future templating; today the actual
  `<nav>` markup in each HTML file is what renders.
- `pages` — the home page's card grid. Add, remove, or reorder entries
  freely; the grid re-flows automatically. `status: "coming-soon"`
  renders a disabled, non-clickable card.

---

## 6. What changed from the original version

A transparent list, in case you're comparing against the original repo:

**Bugs fixed**
- `script.js` assumed elements like `#backToTop`, `#themeToggle`, and
  `.hero h1` existed on *every* page. On `index.html`/`date.html`,
  several didn't — so the very first lines threw a `TypeError` and
  silently aborted the rest of the script. Every init function is now
  individually guarded (see §3).
- The mobile hamburger button (`#menuBtn`) existed in the markup but had
  **no JavaScript wiring it up at all**, and the CSS simply hid the nav
  links below 768px with no way to reopen them — the navigation was
  completely unreachable on phones. A real toggle is now implemented in
  `navbar.js` + `components/navbar.css`.
- The smooth-scroll handler referenced an undeclared `nav` variable
  (`ReferenceError` on every anchor click). Fixed to reference the
  actual `navLinks` element, guarded for pages without one.
- The date-ideas hero buttons and their result boxes were aligned with
  hand-tuned fixed-pixel `transform: translateX(225px)` offsets, which
  only looked correct at one specific viewport width and pushed content
  off-screen on phones. Rebuilt with flexbox + `flex-wrap`, so it
  reflows naturally at any width.
- The font stack listed the generic keyword before the specific fonts
  (`sans-serif, Arial, Helvetica`), which meant the specific fallbacks
  could never actually be used. Corrected the order.
- `dates-buiten.txt` had two entries merged onto one line ("Rage
  roomComedy show") from a missing line break — split back into two
  items in the JSON conversion.
- `#backToTop` had no CSS at all. Fully styled and wired up.
- A redundant JS-driven "floating" animation duplicated a CSS
  `@keyframes float` that already did the same thing more efficiently
  (GPU-composited, no per-frame JS). Removed the JS version.

**Structural changes**
- Split the single `style.css`/`script.js` into a small, documented
  module system (see §1/§3) instead of one large file each.
- Moved the two `.txt` idea lists into structured JSON, loaded via
  `fetch()` with proper error handling instead of assuming the request
  always succeeds.
- Replaced hot-linked third-party stock images ("coming soon"
  placeholders, random profile-style avatar) with inline emoji icons —
  no dependency on an external image host that could disappear, block
  hotlinking, or simply load slowly on mobile data.
- `<html lang="en">` corrected to `lang="nl"` — the visible content is
  Dutch, and screen readers use this attribute to choose pronunciation.
- Added `<meta name="robots" content="noindex, nofollow">` (private
  content — see intro).
- Added a skip-to-content link, `aria-live` regions for the idea
  results, `aria-expanded`/`aria-pressed` on toggle buttons, and
  `prefers-reduced-motion`/`prefers-color-scheme` support throughout.

---

## 7. Browser support

Built on standard, broadly-supported web platform features (CSS custom
properties, `IntersectionObserver`, ES modules, `fetch`). Works in all
current versions of Chrome, Firefox, Safari, and Edge, on both desktop
and mobile. No transpilation or polyfills included — if you need to
support very old browsers, that's a deliberate trade-off to revisit.

## 8. Deploying to GitHub Pages

This project is set up to work on GitHub Pages with **zero path changes**,
whether it ends up at a custom domain, a user site
(`username.github.io`), or a project site
(`username.github.io/DateSite/`) — every link in the project is a
relative filename (`date.html`, `assets/css/main.css`, ...), never an
absolute `/path`, so it doesn't matter which subpath the site is served
under.

Two ways to enable it:

**Option A — plain branch deploy (simplest):**
1. Push this repo to GitHub.
2. Repo **Settings → Pages → Source** → "Deploy from a branch" → pick
   your branch (e.g. `main`) and folder `/ (root)`.
3. Wait a minute, then visit the URL GitHub shows you.

The included `.nojekyll` file tells GitHub Pages to publish the files
exactly as they are, skipping its default Jekyll build step (which
isn't needed here and can otherwise ignore/mangle certain folder
names).

**Option B — GitHub Actions deploy (included, more control):**
1. Repo **Settings → Pages → Source** → "GitHub Actions".
2. Push to your default branch — `.github/workflows/deploy.yml` runs
   automatically and publishes the site. If your default branch isn't
   `main`, update the `branches:` line in that file.
3. You can also trigger a deploy manually from the repo's **Actions**
   tab (`workflow_dispatch`).

**Custom domain (optional):** add a `CNAME` file at the project root
containing just your domain name, and configure the DNS records GitHub
documents for Pages.

Everything above applies equally to **Netlify / Vercel** — connect the
repo, leave the build command empty, publish directory `/`.

## 9. Ideas for what's next

The home page already stubs out likely next features as disabled
"coming soon" cards (bucket list, photo gallery, travel ideas, a
memories timeline, a shared playlist, gift ideas, surprises) — flipping
one of those from a placeholder into a real page is the intended
"next step" for extending this template. Follow §4.
