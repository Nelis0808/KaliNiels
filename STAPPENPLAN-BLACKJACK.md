# BlackJack toevoegen — stappenplan

Deze update voegt `games/blackjack.html` toe: een BlackJack-spel
tegen de dealer, met een klikbare chip-tray (`assets/icons/chips`)
en optioneel inloggen (zelfde wachtwoord-systeem als de fotogalerij).

**Spelen kan altijd, ook zonder inloggen** — als gast krijg je een
vaste lokale stapel van 1000 chips die reset zodra je de pagina
ververst. Inloggen ontgrendelt twee dingen:

1. **Een opgeslagen chipsaldo.** Dat saldo staat niet lokaal in de
   browser (dan zou het bij een ander apparaat weer op 1000 beginnen),
   maar in **Cloudflare KV** — dezelfde soort simpele sleutel/waarde-
   opslag als het boodschappenlijstje. Een kleine Worker (net als bij
   de fotogalerij, Ticketmaster en het boodschappenlijstje) leest en
   schrijft dat saldo namens de site:

   ```
   Browser (jij)      →  Worker "blackjack"  →  Cloudflare KV (jouw saldo)
   Browser (Kalina)   →  Worker "blackjack"  →  Cloudflare KV (haar saldo)
   ```

   Dit is een **vierde, aparte Worker** — los van de fotogalerij, het
   boodschappenlijstje en de Ticketmaster-proxy, ze hebben niets met
   elkaar te maken (al gebruiken ze wel hetzelfde inlog-principe).

2. **De "special" kaartvariant.** `assets/icons/playing-cards/` bevat
   de normale kaarten, `assets/icons/playing-cards/special-cards/`
   een alternatieve variant — maar alleen voor azen, boeren, vrouwen,
   heren en jokers. Cijferkaarten (2 t/m 10) zien er sowieso hetzelfde
   uit, dus daar merk je niets van in- of uitgelogd.

---

## 1. Cloudflare KV-namespace aanmaken

1. Log in op <https://dash.cloudflare.com>.
2. Ga naar **Workers & Pages** → **KV** (in het linkermenu) →
   **Create a namespace**.
3. Naam: bv. `blackjack-chips` → **Add**.
4. Je hoeft er niets in te zetten — de Worker vult de sleutels `a`
   en `b` zelf, de eerste keer dat iemand inlogt, met 1000 chips.

## 2. De blackjack-Worker deployen

1. **Workers & Pages** → **Create** → **Create Worker**.
2. Naam: `blackjack` → **Deploy** (met de standaard "Hello World",
   je vervangt dit zo).
3. **Edit code** → plak de volledige inhoud van
   `cloudflare/cloudflare-worker-blackjack/worker.js` erin → **Deploy**.
4. **Settings → Bindings** → **Add binding** → kies **KV Namespace**:
   - Variable name: `CHIPS_KV`
   - KV namespace: de namespace die je in stap 1 maakte
   → **Save and deploy**.
5. **Settings → Variables and Secrets** → voeg drie secrets toe
   (**Add** → **Encrypt** voor elk):
   - `PASSPHRASE_A` — wachtwoord voor persoon A (bv. Niels)
   - `PASSPHRASE_B` — wachtwoord voor persoon B (bv. Kalina)
   - `TOKEN_SECRET` — een lange willekeurige random string (voor het
     ondertekenen van sessies; hoeft niemand te onthouden)

   *Tip: dit mogen dezelfde wachtwoorden zijn als bij de fotogalerij
   als je dat prettiger vindt, maar het hoeft niet — de twee Workers
   weten niets van elkaar.*
6. Noteer de Worker-URL, bv.
   `https://blackjack.<jouw-subdomain>.workers.dev`

   *(Wrangler-CLI alternatief: vul in
   `cloudflare/cloudflare-worker-blackjack/wrangler.toml` het echte
   namespace-id in bij `id`, dan in die map: `wrangler deploy`, gevolgd
   door `wrangler secret put PASSPHRASE_A` (etc.) voor de drie secrets.)*

### CORS instellen (belangrijk!)

Zelfde als bij de andere Workers: open
`cloudflare/cloudflare-worker-blackjack/worker.js` en check
`ALLOWED_ORIGINS` bovenin. Staat al goed voor
`https://nelis0808.github.io` en de lokale dev-poorten. Gebruik je
een custom domain? Voeg die toe en deploy opnieuw.

## 3. `config.js` bijwerken met je Worker-URL

Open `assets/js/config.js` en vervang de placeholder:

```js
blackjack: {
  workerUrl: 'https://blackjack.YOUR-SUBDOMAIN.workers.dev',
  personLabels: {
    a: 'Niels',
    b: 'Kalina',
  },
},
```

→ vul bij `workerUrl` de echte URL in die je in stap 2.6 noteerde.
`personLabels` bepaalt alleen welke naam er op de pagina staat
("Ingelogd als Niels") — dit heeft geen invloed op de Worker zelf.
Zolang `workerUrl` nog de placeholder is, toont de pagina netjes een
waarschuwing in plaats van kapot te gaan (en blijft gewoon als gast
speelbaar).

## 4. Bestanden in je repo zetten

Kopieer naar de root van je repo (structuur is identiek, dus alles
landt op de juiste plek):

```
games/blackjack.html                                   (nieuw)
assets/css/pages/blackjack.css                         (nieuw)
assets/js/modules/blackjack.js                         (nieuw)
assets/js/modules/games-hub.js                         (aangepast — BlackJack-kaart toegevoegd)
assets/js/config.js                                    (aangepast)
assets/js/main.js                                       (aangepast — 2 regels)
cloudflare/cloudflare-worker-blackjack/worker.js        (nieuw, apart van de site)
cloudflare/cloudflare-worker-blackjack/wrangler.toml    (nieuw, optioneel voor CLI)
```

Geen handmatige nav-aanpassingen nodig: BlackJack verschijnt
automatisch als kaart op de Games-hub pagina.

## 5. Committen, pushen, testen

```bash
git add games/blackjack.html assets/css/pages/blackjack.css \
        assets/js/modules/blackjack.js assets/js/modules/games-hub.js \
        assets/js/config.js assets/js/main.js \
        cloudflare/cloudflare-worker-blackjack/
git commit -m "BlackJack toevoegen (chips, optioneel inloggen, saldo via Cloudflare KV)"
git push
```

Ga naar `https://nelis0808.github.io/KaliNiels/games/blackjack.html`
— je zou als gast direct moeten kunnen spelen met 1000 chips. Log in
met een van de twee wachtwoorden en check dat:

- je saldo verandert in "Ingelogd als ..." met een bedrag dat
  gelijk blijft na een page refresh (het wordt nu bewaard in KV);
  - de azen/boeren/vrouwen/heren/jokers er anders uitzien dan als
    gast (cijferkaarten blijven gelijk).

---

## Chips handmatig instellen (of aanpassen)

Wil je iemands saldo zelf even bijstellen — bijvoorbeeld na een
foutje, of gewoon omdat je iemand een cadeautje wil geven — dan hoef
je geen code aan te passen:

1. **Cloudflare dashboard** → **Workers & Pages** → **KV** → open de
   namespace die je in stap 1 maakte (bv. `blackjack-chips`).
2. Zoek de sleutel `a` (Niels) of `b` (Kalina, of wie je ook als "B"
   hebt ingesteld).
3. Klik erop, pas de waarde aan (een simpel getal, bv. `5000`) →
   **Save**.
4. Klaar — de Worker leest deze waarde altijd vers uit, dus de
   volgende keer dat die persoon zijn saldo laadt (pagina openen of
   verversen) zie je meteen het nieuwe bedrag. Geen redeploy nodig.

## Hoe het spel precies werkt

- **Chips inzetten**: klik op een chip in de tray om 'm aan je
  inzet toe te voegen. Je kan niet meer inzetten dan je saldo.
- **Delen**: "Deel kaarten" geeft jou en de dealer allebei 2 kaarten
  — de tweede kaart van de dealer ligt verdekt tot jouw beurt voorbij
  is.
- **Hit / Stand / Verdubbelen**: standaard BlackJack-regels. De
  dealer speelt automatisch door tot 17 of hoger zodra jij past.
  BlackJack (aas + 10-kaart in de eerste twee kaarten) betaalt 3:2.
- **Na een hand**: je resultaat (winst/verlies/gelijkspel) wordt
  direct verwerkt in je saldo. Ben je ingelogd, dan wordt dat nieuwe
  saldo meteen naar de Worker gestuurd om op te slaan — dat gebeurt
  op de achtergrond, je hoeft nergens op te wachten.
- **Als gast** verandert er niets aan bovenstaande, behalve dat je
  saldo alleen in het geheugen van de pagina leeft: een refresh zet
  'm terug op 1000.

## Problemen oplossen

| Symptoom | Oorzaak | Oplossing |
|---|---|---|
| "⚠️ Nog geen Worker gekoppeld" bij het inloggen | `workerUrl` in `config.js` staat nog op de placeholder | Stap 3 hierboven |
| Console: CORS-foutmelding | Je site-origin staat niet in `ALLOWED_ORIGINS` | Voeg 'm toe in `worker.js`, opnieuw deployen |
| "Server misconfigured: CHIPS_KV binding ontbreekt" | KV-binding vergeten of verkeerde variabelenaam | Stap 2.4 — moet exact `CHIPS_KV` heten |
| "Onjuist wachtwoord" ondanks correct wachtwoord | Secret niet (goed) ingesteld, of typefout | Stap 2.5 — check `PASSPHRASE_A`/`PASSPHRASE_B` in het dashboard |
| Saldo lijkt na inloggen steeds "1000" te zijn | Normaal de eerste keer (wordt dan geseed) — daarna moet het blijven bij wat je opslaat | Speel een hand en ververs; als het dan nog steeds reset, check de PUT /chips-call in de Network-tab |
| Kaarten zien er hetzelfde uit in- en uitgelogd | Je speelde alleen met cijferkaarten (2-10) — die hebben geen special-variant, dat is normaal gedrag | Kijk naar een aas, boer, vrouw, heer of joker voor het verschil |
| `404`/`Not found` van de Worker | Verkeerde `workerUrl`, of typefout in het pad | Controleer of de URL exact eindigt op `.workers.dev` zonder extra pad |
