# Ticketmaster "Favorieten" toevoegen — stappenplan

Deze update voegt een vierde, **standaard geselecteerde** tab toe aan
`ticketmaster.html`: **⭐ Favorieten**. Daar sla je artiest- of
bandnamen op ("Coldplay", "Metallica", ...) en zie je meteen hun
aankomende concerten bij elkaar, zonder elke keer opnieuw te hoeven
zoeken. De lijst is **gedeeld tussen apparaten**: voeg je op je
telefoon een artiest toe, dan staat die een paar seconden later ook op
de laptop — precies zoals het gedeelde boodschappenlijstje werkt.

```
Browser (ticketmaster.html)
  ├─→ favorite-artists Worker   (NIEUW — bewaart alleen de NAMEN)
  └─→ ticketmaster-proxy Worker (bestaand — haalt concerten op per naam)
```

Dit zijn dus **twee aparte Workers** die niets van elkaar hoeven te
weten: de bestaande `ticketmaster-proxy` (die je Ticketmaster API-key
geheim houdt) is totaal ongewijzigd — de Favorieten-tab doet gewoon
één "Zoek op naam"-verzoek per opgeslagen artiest aan diezelfde proxy
en voegt de resultaten samen tot één lijst, gesorteerd op datum. De
nieuwe `favorite-artists`-Worker bewaart alleen de lijst met namen
zelf, in zijn eigen KV-namespace.

> Heb je de `lijstje`-Worker al eerder gedeployed? Deze stappen zijn
> vrijwel identiek — zelfde KV/Worker-aanpak, alleen met een andere
> naam en een andere binding.

---

## 1. Cloudflare KV-namespace aanmaken

1. Log in op <https://dash.cloudflare.com>.
2. Ga naar **Workers & Pages** → **KV** (in het linkermenu) →
   **Create a namespace**.
3. Naam: bv. `favorite-artists` → **Add**.
4. Je hoeft er verder niets in te zetten — de Worker vult 'm zelf
   zodra je voor het eerst een artiest toevoegt.

## 2. De favorite-artists-Worker deployen

1. **Workers & Pages** → **Create** → **Create Worker**.
2. Naam: `favorite-artists` → **Deploy** (met de standaard
   "Hello World", je vervangt dit zo).
3. **Edit code** → plak de volledige inhoud van
   `cloudflare/cloudflare-worker-favorite-artists/worker.js` (uit
   deze zip) erin → **Deploy**.
4. **Settings → Bindings** → **Add binding** → kies **KV Namespace**,
   twee keer:
   - Variable name: **exact** `FAVORITE_ARTISTS_KV` — de Worker-code
     verwacht precies die naam. KV namespace: de namespace uit stap 1.
   - Variable name: **exact** `RATE_LIMIT_KV` — dit is dezelfde
     gedeelde rate-limit-namespace die alle andere Workers op deze
     site ook gebruiken (dus **niet** een nieuwe aanmaken — kies de
     bestaande KV-namespace die je bijvoorbeeld ook aan de
     lijstje- of clothing-Worker hebt gekoppeld). Zonder deze
     binding werkt de Worker nog steeds, maar zonder dagelijkse limiet.
   → **Save and deploy**.
5. Noteer de Worker-URL, bv.
   `https://favorite-artists.<jouw-subdomain>.workers.dev`.

   *(Wrangler-CLI alternatief: vul in
   `cloudflare/cloudflare-worker-favorite-artists/wrangler.toml` de
   echte namespace-id's in, dan in die map: `wrangler deploy`.)*

### CORS instellen (belangrijk!)

Zelfde als bij alle andere Workers op deze site: open
`cloudflare/cloudflare-worker-favorite-artists/worker.js` en check
`ALLOWED_ORIGINS` bovenin. Staat al goed voor
`https://nelis0808.github.io` en de lokale dev-poorten. Gebruik je
een custom domain? Voeg die toe en deploy opnieuw.

## 3. `config.js` bijwerken met je Worker-URL

Open `assets/js/config.js` en vervang in het `ticketmaster`-blok de
placeholder URL:

```js
ticketmaster: {
  workerUrl: 'https://ticketmaster-proxy.<jouw-subdomain>.workers.dev', // al ingevuld, niet aanraken
  defaultCountry: 'NL',
  favoriteArtistsWorkerUrl: 'https://favorite-artists.<jouw-subdomain>.workers.dev',
},
```

Let op: `workerUrl` (de bestaande Ticketmaster-proxy) en
`favoriteArtistsWorkerUrl` (nieuw) zijn **twee verschillende
Workers** met twee verschillende URL's — niet dezelfde URL twee keer
invullen.

## 4. Bestanden in je repo zetten

Kopieer uit deze zip:

- `cloudflare/cloudflare-worker-favorite-artists/` (hele map)
- `ticketmaster.html` (overschrijven)
- `assets/js/modules/ticketmaster.js` (overschrijven)
- `assets/js/config.js` (overschrijven, of handmatig het
  `ticketmaster`-blok bijwerken zoals hierboven)
- `assets/css/pages/ticketmaster.css` (overschrijven)

## 5. Committen, pushen, testen

```bash
git add .
git commit -m "Ticketmaster: favoriete artiesten toevoegen"
git push
```

Open `ticketmaster.html` — de **⭐ Favorieten**-tab is nu standaard
geselecteerd. Typ een artiestnaam in het veld en klik **Toevoegen**
(of druk Enter). De naam verschijnt als "chip" onder de werkbalk, met
een ✕ om 'm weer te verwijderen, en de concerten voor die artiest
verschijnen eronder. Voeg een tweede apparaat toe (of open de site in
een incognitovenster) — na een paar seconden zie je daar dezelfde
lijst.

## Hoe het precies werkt

- **Opslaan**: elke toevoeging/verwijdering stuurt de **hele**
  bijgewerkte namenlijst naar de `favorite-artists`-Worker (net als
  bij het boodschappenlijstje) — geen aparte add/remove-endpoints,
  gewoon één simpele PUT.
- **Concerten ophalen**: zodra de Favorieten-tab actief is, doet
  `ticketmaster.js` één "Zoek op naam"-verzoek per opgeslagen artiest
  aan de bestaande `ticketmaster-proxy`-Worker (parallel, niet na
  elkaar), voegt alle resultaten samen, verwijdert dubbele shows
  (bijvoorbeeld een festival waar twee favorieten allebei spelen), en
  sorteert alles op datum.
- **Geen "Meer laden" op deze tab**: met bijvoorbeeld 10 favorieten
  zou paginering per individuele artiest nogal complex worden voor
  weinig winst. In plaats daarvan toont deze tab de eerstvolgende 6
  concerten per artiest in één keer — ruim voldoende om te zien wat
  eraan zit te komen.
- **Eén favoriet niet bereikbaar?** Als één van de onderliggende
  aanvragen mislukt (bijvoorbeeld een tijdelijke netwerkhapering),
  worden de andere favorieten gewoon getoond; de statusregel
  onderaan meldt hoeveel er niet geladen konden worden.
- **Rate limiting**: de nieuwe Worker gebruikt dezelfde dagelijkse
  limiet (5.000 aanvragen/dag) als alle andere Workers op de site,
  via de gedeelde `RATE_LIMIT_KV`-binding hierboven. Let op: elke
  keer dat je de Favorieten-tab opent of ververst, telt dat als 1
  aanvraag aan déze Worker (voor de namenlijst) plús N aanvragen aan
  de bestaande `ticketmaster-proxy` (1 per favoriet) — bij veel
  favorieten en veel verversingen loop je dus sneller tegen de limiet
  van de **proxy**-Worker aan (die zelf 10.000/dag toestaat) dan
  tegen die van deze nieuwe Worker.

## Problemen oplossen

| Symptoom | Oorzaak | Oplossing |
|---|---|---|
| "⚠️ Geen favorieten-worker geconfigureerd" | `favoriteArtistsWorkerUrl` in `config.js` staat nog op de placeholder | Stap 3 hierboven |
| Console: CORS-foutmelding bij `/artists` | Je site-origin staat niet in `ALLOWED_ORIGINS` | Voeg 'm toe in `cloudflare-worker-favorite-artists/worker.js`, opnieuw deployen |
| "Server misconfigured: FAVORITE_ARTISTS_KV binding ontbreekt" | KV-binding vergeten of verkeerde variabelenaam | Stap 2.4 — moet exact `FAVORITE_ARTISTS_KV` heten |
| Toegevoegde artiest verdwijnt meteen weer | PUT naar `/artists` mislukt (zie Console/Network in devtools voor de exacte foutmelding) — meestal een ontbrekende/verkeerde binding | Controleer stap 2.4 |
| "Dagelijkse limiet van 5000 aanvragen bereikt" (op déze Worker) | De gedeelde `RATE_LIMIT_KV`-teller voor `favorite-artists` zit vol voor vandaag | Normaliter geen probleem bij normaal gebruik; verhoog zo nodig `DAILY_LIMIT` in `worker.js` en deploy opnieuw |
| Favorieten-tab blijft "Bezig met laden…" of toont een fout over de proxy | De bestáánde `ticketmaster-proxy`-Worker (niet deze nieuwe) is niet bereikbaar of zijn eigen dagelijkse limiet zit vol | Zie STAPPENPLAN.md (de oorspronkelijke Ticketmaster-instructies) |
