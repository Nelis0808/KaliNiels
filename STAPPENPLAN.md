# Ticketmaster-pagina toevoegen — stappenplan

Deze update voegt een nieuwe pagina `ticketmaster.html` toe met:

- **Aankomende concerten** — algemene lijst, gesorteerd op datum
- **Aankomende sales** — concerten waarvan de publieke verkoop nog niet
  gestart is (Ticketmaster's `onsaleStartDateTime`-filter)
- **Zoeken op naam** — concerten van een specifieke artiest/band
- Een **landfilter** (standaard Nederland, met "alle landen" als optie)

Omdat deze repo **publiek** is, mag de echte Ticketmaster API-key nergens
in de site-code staan. Daarom praat de site met een kleine, gratis
**Cloudflare Worker** (`/cloudflare-worker/worker.js`) die de key geheim
houdt en het verzoek doorstuurt naar Ticketmaster. De site zelf blijft
100% statisch/geen build-stap — de Worker is een klein los onderdeel dat
je één keer apart deployt.

'''
Browser (ticketmaster.html)  →  Cloudflare Worker (jouw proxy)  →  Ticketmaster Discovery API
                                  ↑ hier staat de geheime key
'''

---

## 1. Ticketmaster API-key aanvragen

1. Ga naar <https://developer.ticketmaster.com/> en maak een gratis account.
2. Maak een nieuwe "App" aan — je krijgt direct een **Consumer Key**
   (= je API key). Gratis tier: 5.000 calls/dag, 5 calls/seconde.
3. Bewaar deze key even apart — je hebt hem zo nodig, maar hij komt
   **nergens** in git terecht.

## 2. Cloudflare Worker deployen (~5 minuten)

Je hebt geen lokale tools nodig — dit kan volledig via het dashboard.

1. Maak een gratis account op <https://dash.cloudflare.com/sign-up>.
2. Ga naar **Workers & Pages** → **Create** → **Create Worker**.
3. Geef hem een naam, bv. `ticketmaster-proxy`, en klik **Deploy** (de
   standaard "Hello World"-code is prima, je vervangt hem zo).
4. Klik daarna **Edit code**, en plak de volledige inhoud van
   `cloudflare-worker/worker.js` (uit deze zip) erin. Klik **Deploy**.
5. Ga naar **Settings → Variables and Secrets** van je worker, klik
   **Add**, kies type **Secret**, naam `TICKETMASTER_API_KEY`, en plak
   je Ticketmaster key als waarde. Opslaan.
6. Noteer de URL van je worker, iets als:
   `https://ticketmaster-proxy.<jouw-subdomain>.workers.dev`

   *(Liever de command line? `npm install -g wrangler`, dan in
   `cloudflare-worker/`: `wrangler deploy`, gevolgd door
   `wrangler secret put TICKETMASTER_API_KEY`.)*

### CORS instellen (belangrijk!)

Open `cloudflare-worker/worker.js` en check de `ALLOWED_ORIGINS`-lijst
bovenin. Deze staat al ingesteld op:

```js
const ALLOWED_ORIGINS = [
  'https://nelis0808.github.io',   // jouw GitHub Pages project-URL
  'http://localhost:8080',          // npm start / npm run dev in deze repo
  'http://127.0.0.1:8080',
  'http://localhost:5500',          // VS Code "Live Server"-extensie
  'http://127.0.0.1:5500',
];
```

- Gebruik je **geen** custom domain? Dan hoef je niets te wijzigen —
  `https://nelis0808.github.io` dekt elke pagina van dit GitHub Pages
  project (inclusief `/DateSite/ticketmaster.html`, want de browser
  stuurt alleen het domein mee als Origin-header, geen pad).
- Gebruik je straks wél een **custom domain**? Voeg die dan toe aan de
  lijst, bv. `'https://onzedate.nl'`, en klik in het dashboard opnieuw
  op **Deploy** om de wijziging live te zetten.

## 3. Bestanden in je repo zetten

Kopieer uit deze zip naar de root van je `DateSite`-repo (structuur is
identiek, dus alles landt op de juiste plek):

'''
ticketmaster.html                          (nieuw)
assets/css/pages/ticketmaster.css          (nieuw)
assets/js/modules/ticketmaster.js          (nieuw)
assets/js/config.js                        (aangepast — zie hieronder)
assets/js/main.js                          (aangepast — 2 regels toegevoegd)
cloudflare-worker/worker.js                (nieuw, niet onderdeel van de site zelf)
cloudflare-worker/wrangler.toml            (nieuw, optioneel voor wrangler-CLI gebruik)
'''

Je hoeft de `<header>`/nav van de bestaande pagina's **niet** met de
hand aan te passen: `Ticketmaster` is geen "permanente" nav-link (net
als Home/Date Ideeën/Toernooi), dus hij verschijnt automatisch in het
**"Meer"-dropdownmenu** op elke pagina en als kaart op de homepage,
puur doordat hij nu in `siteConfig.pages` staat
(`assets/js/modules/nav-dropdown.js` en `home-cards.js` doen de rest).

## 4. `config.js` bijwerken met je Worker-URL

Open `assets/js/config.js` en vervang de placeholder:

```js
ticketmaster: {
  workerUrl: 'https://ticketmaster-proxy.YOUR-SUBDOMAIN.workers.dev',
  defaultCountry: 'NL',
},
```

→ vul bij `workerUrl` de echte URL in die je in stap 2.6 noteerde.
Zolang dit nog de placeholder is, toont de pagina netjes een
waarschuwing in plaats van kapot te gaan.

## 5. Committen en pushen

```bash
git add ticketmaster.html assets/css/pages/ticketmaster.css \
        assets/js/modules/ticketmaster.js assets/js/config.js assets/js/main.js \
        cloudflare-worker/
git commit -m "Ticketmaster-pagina toevoegen (concerten, sales, zoeken, landfilter)"
git push
```

GitHub Pages publiceert automatisch. Check na een minuut
`https://nelis0808.github.io/DateSite/ticketmaster.html`.

## 6. Lokaal testen (optioneel)

```bash
npm run dev   # of: npm start
```

Zolang je op `http://localhost:8080` (of `127.0.0.1:8080`/`:5500`) zit,
staat je Worker dit al toe (zie stap 2's CORS-lijst).

---

## Problemen oplossen

| Symptoom | Oorzaak | Oplossing |
|---|---|---|
| "⚠️ Geen worker geconfigureerd" | `workerUrl` in `config.js` staat nog op de placeholder | Stap 4 hierboven |
| Console: CORS-foutmelding | Je site-origin staat niet in `ALLOWED_ORIGINS` | Voeg 'm toe in `worker.js`, opnieuw deployen |
| `{"error":"Server misconfigured..."}` | Secret niet gezet op Cloudflare | Stap 2.5 hierboven |
| `401 Invalid ApiKey` van Ticketmaster | Verkeerde/verlopen Ticketmaster key | Nieuwe key aanmaken op developer.ticketmaster.com |
| `429` / quota-foutmelding | Dagelijkse limiet (5.000 calls) bereikt | De Worker cachet al 5 minuten per zoekopdracht; wacht of vraag Ticketmaster om een hogere quotum |
| Resultaten lijken "oud" na een wijziging | De 5-minuten edge-cache in de Worker | Even wachten, of `Cache-Control`-waarde in `worker.js` verlagen |

## Waarom niet gewoon de key in `config.js`?

Dit is een publieke GitHub-repo. Alles in `assets/js/` wordt letterlijk
meegestuurd naar elke bezoeker en staat voor altijd in je git-historie.
Een key die daar staat, kan door iedereen gekopieerd worden om jouw
gratis dagquota (5.000 calls/dag) leeg te trekken of zelfs te laten
blokkeren. De Worker kost je niets extra (Cloudflare's gratis tier is
ruim voldoende voor een persoonlijke site) en is de enige plek waar
zo'n key wél veilig staat.
