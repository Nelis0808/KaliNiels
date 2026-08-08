# Cadeau Ideeën toevoegen — stappenplan

Deze update voegt `gifts.html` toe: twee gedeelde lijstjes met
cadeau-ideeën — **links voor Kalina, rechts voor Niels**. Je plakt
een linkje naar het cadeau erin, en de site zoekt er zelf een plaatje
bij. Wat de één toevoegt of verwijdert, ziet de ander een paar
seconden later ook — net als bij het lijstje, zonder dat
iemand hoeft in te loggen.

```
Browser (jij)         →  Worker "gifts"  →  Cloudflare KV (de lijst: titels/links/notities)
Browser (je vriendin) →  Worker "gifts"  →  Cloudflare KV (de lijst: titels/links/notities)
                                          ↘  Cloudflare R2 "gifts" (optioneel: eigen foto's)
                                          ↘  De webshop/site achter de link (fallback: og:image)
```

Dit is een **vierde, aparte Worker**, los van Ticketmaster, de
fotogalerij en het lijstje — ze hebben niets met elkaar
te maken en kunnen onafhankelijk werken/breken.

## Hoe het plaatje bij elk cadeau tot stand komt

Voor elk cadeau-idee doet de Worker, in deze volgorde:

1. **Eigen foto** — staat er in de (publieke, want niet-gevoelige) R2-bucket
   een bestand dat begint met het ID van dat cadeau (bv.
   `3fa8...c1.jpg`)? Dan wint die altijd — jij hebt 'm bewust
   geüpload.
2. **Automatisch van de link** — zo niet, dan haalt de Worker zelf de
   pagina achter de link op en leest het `og:image`-tag (hetzelfde
   plaatje dat WhatsApp/Twitter/Facebook laten zien als je die link
   deelt) en stuurt dat door.
3. **Geen van beide?** Dan zie je gewoon een neutraal 🎁-icoontje in
   plaats van een foto — niets breekt.

Net als bij de fotogalerij (zie `STAPPENPLAN-FOTOS.md`) ziet de
browser nooit rechtstreeks een andere website of bucket — alleen deze
ene Worker doet dat, wat CORS-gedoe voorkomt en je site-origin nooit
naar de webshop lekt.

Geen wachtwoord nodig hier (in tegenstelling tot de foto's): een
lijstje met cadeau-ideeën is niet gevoelig genoeg om die extra stap
waard te zijn — zelfde afweging als bij het lijstje.

---

## 1. Cloudflare KV-namespace aanmaken (de lijst zelf)

1. Log in op <https://dash.cloudflare.com>.
2. Ga naar **Workers & Pages** → **KV** → **Create a namespace**.
3. Naam: bv. `gifts` → **Add**.
4. Verder niets nodig — de Worker begint gewoon met een lege lijst
   totdat jullie iets toevoegen.

## 2. Cloudflare R2-bucket aanmaken (optioneel: eigen foto's)

Alleen nodig als je weleens een cadeau-idee een eigen foto wil geven
in plaats van het automatisch gevonden plaatje (bv. omdat de webshop
geen goed `og:image` heeft, of je wil gewoon een leukere foto).

1. **R2 Object Storage** → **Create bucket**.
2. Naam: bv. `gifts` (moet matchen met `bucket_name` in
   `cloudflare-worker-gifts/wrangler.toml`, of pas dat bestand aan).
3. Public access mag hier gewoon op de standaardwaarde blijven — de
   bucket zelf hoeft niet publiek te zijn, alleen de Worker leest 'm
   (en die geeft alleen bestaande, geldige afbeeldingen door).

### Een eigen foto toevoegen aan een cadeau

Elk cadeau-idee heeft een uniek ID (een lange, willekeurige code) dat
je terugvindt door in de browser-devtools (F12 → tab **Network**) te
kijken naar de `/gifts/image?id=...`-aanvraag van dat kaartje, of
tijdelijk `console.log`-regels toevoegen in `gifts.js` — of makkelijker:
vraag de lijst rechtstreeks op via
`https://gifts.JOUW-SUBDOMAIN.workers.dev/gifts` in je browser, dat
toont de hele lijst inclusief IDs als leesbare JSON.

Upload in de R2-bucket een bestand met die ID als naam, bv.
`3fa85f64-5717-4562-b3fc-2c963f66afa6.jpg` (jpg/jpeg/png/webp/gif
worden herkend) — de site pikt 'm vanzelf op, geen herstart nodig.

## 3. De gifts-Worker deployen

1. **Workers & Pages** → **Create** → **Create Worker**.
2. Naam: `gifts` → **Deploy** (met de standaard "Hello World", je
   vervangt dit zo).
3. **Edit code** → plak de volledige inhoud van
   `cloudflare/cloudflare-worker-gifts/worker.js` (uit deze zip) erin
   → **Deploy**.
4. **Settings → Bindings** → **Add binding** → kies **KV Namespace**:
   - Variable name: `GIFTS_KV`
   - KV namespace: de namespace uit stap 1
   → **Save and deploy**.
5. Alleen als je stap 2 hierboven ook deed: **Add binding** → **R2
   Bucket**:
   - Variable name: `GIFTS_BUCKET`
   - R2 bucket: de bucket uit stap 2
   → **Save and deploy**.
   (Sla je dit over? Dan werkt alles nog gewoon — er zijn dan alleen
   nooit eigen foto's, enkel automatisch gevonden plaatjes of het
   🎁-icoontje.)
6. Noteer de Worker-URL, bv.
   `https://gifts.<jouw-subdomain>.workers.dev`

   *(Wrangler-CLI alternatief: vul in
   `cloudflare/cloudflare-worker-gifts/wrangler.toml` het echte
   namespace-id in bij `id`, dan in die map: `wrangler deploy`.)*

### CORS instellen (belangrijk!)

Zelfde als bij de andere Workers: open
`cloudflare/cloudflare-worker-gifts/worker.js` en check
`ALLOWED_ORIGINS` bovenin. Staat al goed voor
`https://nelis0808.github.io` en de lokale dev-poorten. Gebruik je
een custom domain? Voeg die toe en deploy opnieuw.

## 4. `config.js` bijwerken met je Worker-URL

Open `assets/js/config.js` en vervang de placeholder:

```js
gifts: {
  workerUrl: 'https://gifts.YOUR-SUBDOMAIN.workers.dev',
  personLabels: {
    a: 'Niels',
    b: 'Kalina',
  },
},
```

Vul bij `workerUrl` de echte URL in die je in stap 3.6 noteerde.
Zolang dit nog de placeholder is, toont de pagina netjes een
waarschuwing in plaats van kapot te gaan. `personLabels` bepaalt
alleen de weergavenamen boven de twee kolommen — pas gerust aan.

## 5. Bestanden in je repo zetten

Kopieer uit deze zip naar de root van je `DateSite`-repo (structuur
is identiek, dus alles landt op de juiste plek):

```
gifts.html                                   (nieuw)
assets/css/pages/gifts.css                   (nieuw)
assets/js/modules/gifts.js                   (nieuw)
assets/js/config.js                          (aangepast)
assets/js/main.js                            (aangepast — 2 regels)
cloudflare/cloudflare-worker-gifts/worker.js       (nieuw, apart van de site)
cloudflare/cloudflare-worker-gifts/wrangler.toml   (nieuw, optioneel voor CLI)
```

Geen handmatige nav-aanpassingen nodig: "Cadeau Ideeën" stond al als
"Binnenkort" in `config.js` en staat nu op `available` → verschijnt
automatisch als klikbare kaart op de homepage en in het
"Meer"-menu.

## 6. Committen, pushen, testen

```bash
git add gifts.html assets/css/pages/gifts.css \
        assets/js/modules/gifts.js assets/js/config.js assets/js/main.js \
        cloudflare/cloudflare-worker-gifts/
git commit -m "Cadeau-ideeën toevoegen (twee kolommen, link-preview via Cloudflare)"
git push
```

Ga naar `https://nelis0808.github.io/DateSite/gifts.html`, voeg links
en rechts een linkje toe (bv. naar een webshop-product) en laat het
titelveld leeg — de site probeert 'm zelf in te vullen. Ververs de
pagina; het plaatje zou erbij moeten verschijnen. Open de pagina op
een ander apparaat (of een tweede tabblad) en wacht een paar
seconden — nieuwe cadeaus van de ander moeten daar ook verschijnen.

---

## Wat dit wel en niet doet

- ✅ Elk cadeau-idee is gewoon een link + titel + optionele notitie —
  geen account, geen login, meteen te delen.
- ✅ De site scraped nooit rechtstreeks vanuit de browser (dat zou
  bijna altijd stuklopen op CORS) — alleen de Worker doet dat,
  server-side.
- ✅ Een eigen foto uploaden overschrijft altijd het automatisch
  gevonden plaatje, nooit andersom.
- ⚠️ **Geen geheimhouding**: dit lijstje werkt zoals het
  lijstje — beide van jullie kunnen alles zien en
  bewerken, ook cadeaus die "voor" de ander bedoeld zijn. Handig om
  ideeën te verzamelen, maar dus geen verrassing als je zelf
  regelmatig meekijkt op de site. Wil je dat wél geheim per persoon,
  dan is dat een grotere uitbreiding (met login zoals de fotogalerij)
  — laat het weten als je dat alsnog wil.
- ⚠️ Niet elke webshop heeft een `og:image`-tag; sommige (vooral
  sites die JavaScript nodig hebben om de pagina te vullen) leveren
  dan geen plaatje. Upload in dat geval gewoon een eigen foto (zie
  stap 2).

## Problemen oplossen

| Symptoom | Oorzaak | Oplossing |
|---|---|---|
| "⚠️ Nog geen Worker gekoppeld" | `workerUrl` in `config.js` staat nog op de placeholder | Stap 4 hierboven |
| Console: CORS-foutmelding | Je site-origin staat niet in `ALLOWED_ORIGINS` | Voeg 'm toe in `worker.js`, opnieuw deployen |
| "Server misconfigured: GIFTS_KV binding ontbreekt" | KV-binding vergeten of verkeerde variabelenaam | Stap 3.4 — moet exact `GIFTS_KV` heten |
| Altijd het 🎁-icoontje, nooit een plaatje | Geen `og:image` op die pagina, of `GIFTS_BUCKET`-binding ontbreekt | Upload een eigen foto (stap 2), of accepteer het icoontje — het breekt niets |
| Titel blijft leeg na toevoegen | Kon de paginatitel niet lezen (site blokkeert bots, of laadt via JavaScript) | Vul de titel gewoon zelf in het formulier in |
| Wijziging van je vriendin verschijnt niet | Nog geen 8 seconden gewacht, of haar tabblad staat op de achtergrond | Even wachten / haar tabblad actief maken |
| `404`/`Not found` van de Worker | Verkeerde `workerUrl`, of typefout in het pad | Controleer of de URL exact eindigt op `.workers.dev` zonder extra pad |
