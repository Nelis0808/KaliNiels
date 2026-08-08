# Kleding-pagina toevoegen — stappenplan

Deze update voegt een nieuwe pagina toe: **`clothing.html`**, in twee
gedeelde kolommen (Kalina links, Niels rechts — zelfde indeling als
`gifts.html`/`snack-rating.html`). Per kledingstuk kun je invullen:

- **Naam** (verplicht)
- **Link** naar het kledingstuk (optioneel)
- **Maat** — vrij invulveld, dus `M`, `42`, `32/34`, whatever past bij
  het kledingstuk (optioneel)
- **Beschrijving** (optioneel)
- **Foto** (optioneel)
- **Sterren** van 0 tot 5

Dit werkt op **exact dezelfde manier** als de snack-ratings-pagina:
wat jij verandert, ziet de ander een paar seconden later ook (en
andersom) — zonder in te loggen. Dat betekent een **nieuwe, aparte
Worker** met zijn eigen Cloudflare KV-opslag, los van alle andere
Workers op deze site.

```
Browser (jij)         →  Worker "clothing"  →  Cloudflare KV (de kleding-items)
Browser (je vriendin) →  Worker "clothing"  →  Cloudflare KV (de kleding-items)
```

Geen wachtwoord nodig — zelfde afweging als bij de snack-ratings en
het lijstje: een lijstje kledingbeoordelingen is niet
gevoelig genoeg om die extra stap waard te zijn.

De stappen hieronder zijn vrijwel identiek aan die in
`STAPPENPLAN-TODO-SNACKS.md` (§1-3), alleen met "clothing" in plaats
van "snack-ratings"/"todo-lijst" als naam.

---

## 1. Cloudflare KV-namespace aanmaken

1. Log in op <https://dash.cloudflare.com>.
2. Ga naar **Workers & Pages** → **KV** (in het linkermenu) →
   **Create a namespace**.
3. Naam: `clothing` → **Add**.
4. Mag leeg blijven — de Worker vult 'm zelf (begint gewoon met een
   lege lijst).

## 2. De Worker deployen

1. **Workers & Pages** → **Create** → **Create Worker**.
2. Naam: `clothing` → **Deploy** (met de standaard "Hello World", je
   vervangt dit zo).
3. **Edit code** → plak de volledige inhoud van
   `cloudflare/cloudflare-worker-clothing/worker.js` uit deze update
   erin → **Deploy**.
4. **Settings → Bindings** → **Add binding** → kies **KV Namespace**,
   twee keer:
   - Variable name: **exact** `CLOTHING_KV` — de Worker-code
     verwacht precies die naam. KV namespace: de namespace uit stap 1.
   - Variable name: **exact** `RATE_LIMIT_KV` — dit is dezelfde
     gedeelde rate-limit-namespace die alle andere Workers op deze
     site ook gebruiken (dus **niet** een nieuwe aanmaken — kies de
     bestaande KV-namespace die je bijvoorbeeld ook aan de
     snack-ratings-Worker hebt gekoppeld). Zonder deze binding werkt
     de Worker nog steeds, maar zonder dagelijkse limiet.
   → **Save and deploy**.
5. Noteer de Worker-URL, bv.
   `https://clothing.<jouw-subdomain>.workers.dev`.

### CORS instellen (belangrijk!)

Zelfde als bij alle andere Workers op deze site: open
`cloudflare/cloudflare-worker-clothing/worker.js` en check
`ALLOWED_ORIGINS` bovenin. Staat al goed voor
`https://nelis0808.github.io` en de lokale dev-poorten. Gebruik je
een custom domain? Voeg die toe en deploy opnieuw.

## 3. `config.js` bijwerken met je Worker-URL

Open `assets/js/config.js` en vervang in het `clothing`-blok de
placeholder URL:

```js
clothing: {
  workerUrl: 'https://clothing.<jouw-subdomain>.workers.dev',
  personLabels: {
    a: 'Niels',
    b: 'Kalina',
  },
},
```

Zolang de URL nog `YOUR-SUBDOMAIN` bevat, toont `clothing.html` een
waarschuwing in plaats van de app (zelfde gedrag als de andere
gedeelde lijstjes wanneer ze nog niet gekoppeld zijn).

## 4. Committen en pushen

```bash
git add clothing.html assets/css/pages/clothing.css \
        assets/js/modules/clothing.js assets/js/main.js \
        assets/js/config.js cloudflare/cloudflare-worker-clothing/
git commit -m "Kleding-pagina toevoegen (met eigen Worker + KV)"
git push
```

De pagina verschijnt automatisch in het "Meer"-menu in de navigatie
en als kaartje op de homepage — dat komt uit `siteConfig.pages` in
`config.js`, geen verdere HTML-aanpassingen nodig.

## Let op

- Foto's worden client-side verkleind/gecomprimeerd (max 640px breed,
  JPEG) voordat ze naar de Worker gaan — zelfde reden als bij de
  snack-ratings: de hele lijst wordt in één keer opgeslagen/opgehaald,
  dus grote originele foto's zouden alles traag maken.
- Sterren, maat, link en beschrijving zijn allemaal achteraf te
  bewerken via het ✏️-icoon op elk kaartje.
- Bij een oneven aantal beoordelingen in een kolom wordt de laatste,
  onvolledige rij automatisch gecentreerd (zelfde fix als op
  `snack-rating.html` — zie de opmerking bovenin
  `assets/css/pages/snack-rating.css`).
- De Worker gebruikt dezelfde dagelijkse limiet (5.000 aanvragen/dag)
  als alle andere lijstjes op de site, via de gedeelde `RATE_LIMIT_KV`
  binding hierboven.

## "Kon lijstje niet laden" oplossen

Als de pagina een foutmelding geeft dat het lijstje niet geladen kan
worden, check in deze volgorde:

1. **`workerUrl` in `config.js` klopt letterlijk** met de URL die
   Cloudflare toont bij je gedeployde Worker (Workers & Pages → je
   Worker → rechtsboven de `*.workers.dev`-URL). Typefouten hierin
   (bv. een punt in plaats van een streepje) geven precies dit
   symptoom, zonder duidelijke foutmelding in de UI zelf — open de
   devtools-console (F12) in de browser, die toont de mislukte
   fetch-URL.
2. **CORS**: `ALLOWED_ORIGINS` in `worker.js` bevat de origin
   waarvandaan je de site bekijkt (zie sectie hierboven).
3. **Bindings**: zowel `CLOTHING_KV` als `RATE_LIMIT_KV` staan onder
   Settings → Bindings op de Worker, met exact die namen
   (hoofdlettergevoelig).
