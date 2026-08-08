# Lijstje toevoegen — stappenplan

Deze update voegt `lijstje.html` toe: een gedeeld
lijstje met afvinken, verwijderen en toevoegen. Wat jij
verandert, ziet je vriendin een paar seconden later ook (en
andersom) — zonder dat iemand hoeft in te loggen.

---

## 0. Heb je al een werkende "boodschappenlijstje" opgezet? Lees dit eerst

Deze versie hernoemt de hele feature van **Boodschappenlijstje** naar
**Lijstje**, en voegt er meerdere lijsten/categorieën aan toe (zie
§6). Dat raakt drie dingen in Cloudflare. Volg deze volgorde:

1. **Worker-code bijwerken (verplicht).** De front-end praat nu tegen
   nieuwe endpoints (`/lists`, `/list?id=...`) in plaats van het oude
   vaste `/list`. Ga naar **Workers & Pages** → je bestaande
   `boodschappenlijst`-Worker → **Edit code** → vervang de hele
   inhoud door `cloudflare/cloudflare-worker-lijstje/worker.js` (uit
   deze zip) → **Deploy**. De nieuwe code migreert je bestaande lijst
   automatisch de eerste keer dat iemand `/lists` opvraagt (zie de
   `MIGRATION`-uitleg bovenin `worker.js`) — je hoeft dus niets met de
   KV-data zelf te doen.

2. **Worker (en KV-namespace) hernoemen — optioneel, cosmetisch.**
   Werkt prima onder de oude naam; dit is puur zodat de naam in je
   dashboard ook "Lijstje" zegt in plaats van "boodschappenlijst":
   - **Workers & Pages** → je Worker → **Settings** → **Rename** (of:
     onderaan **Delete** en opnieuw aanmaken als "Rename" niet
     beschikbaar is in jouw dashboard-versie — let op: dat laatste
     verandert ook de `*.workers.dev`-URL, zie stap 3).
   - Hernoem de KV-namespace op dezelfde manier via **Workers &
     Pages** → **KV** → de namespace → naam wijzigen.
   - Let op: als de Worker-naam verandert, verandert ook de
     `*.workers.dev`-URL (bv. `lijstje.jouw-subdomain.workers.dev` in
     plaats van `boodschappenlijst.jouw-subdomain.workers.dev`).

3. **`config.js` bijwerken als de URL veranderd is.** Alleen nodig als
   je stap 2 hierboven daadwerkelijk deed. Pas
   `shoppingList.workerUrl` in `assets/js/config.js` aan naar de
   nieuwe URL en commit die wijziging. Als je de Worker **niet**
   hernoemt, hoeft dit bestand voor dit onderdeel niet te wijzigen —
   het zit al op de oude URL, die blijft gewoon werken met de nieuwe
   code uit stap 1.

4. **GitHub Pages.** Geen actie nodig — dit is een GitHub Pages-site,
   niet Cloudflare Pages. De bestandshernoeming (`boodschappenlijst.*`
   → `lijstje.*`) wordt gewoon meegenomen in je volgende push. Had je
   de oude URL (`.../boodschappenlijst.html`) ergens gebookmarkt of
   gedeeld? Die geeft na de push een 404 — vervang 'm door
   `.../lijstje.html`.

Geen bestaande lijst, of begin je helemaal opnieuw? Dan kun je gewoon
onderstaande stappen 1 t/m 5 volgen als een normale nieuwe deploy.

De lijst staat niet ergens lokaal in de browser (dan zou alleen jij
'm zien), maar in **Cloudflare KV** — een simpele, gratis
sleutel/waarde-opslag. Een kleine Worker (net als bij Ticketmaster en
de fotogalerij) leest en schrijft die opslag namens de site:

```
Browser (jij)         →  Worker "lijstje"  →  Cloudflare KV (de lijst)
Browser (je vriendin) →  Worker "lijstje"  →  Cloudflare KV (de lijst)
```

Dit is een **derde, aparte Worker**, los van de Ticketmaster-proxy en
de fotogalerij — ze hebben niets met elkaar te maken.

Geen wachtwoord nodig hier (in tegenstelling tot de foto's): een
lijstje is niet gevoelig genoeg om die extra stap waard
te zijn. Wie de Worker-URL zou raden kan de lijst zien/aanpassen,
maar die URL staat nergens publiek en er valt weinig schade aan te
richten met iemand anders' lijstje afwasmiddel.

---

## 1. Cloudflare KV-namespace aanmaken

1. Log in op <https://dash.cloudflare.com>.
2. Ga naar **Workers & Pages** → **KV** (in het linkermenu) →
   **Create a namespace**.
3. Naam: bv. `lijstje` → **Add**.
4. Je hoeft er verder niets in te zetten — de Worker vult 'm zelf,
   de eerste keer dat de pagina geopend wordt, met het standaardlijstje.

## 2. De lijstje-Worker deployen

1. **Workers & Pages** → **Create** → **Create Worker**.
2. Naam: `lijstje` → **Deploy** (met de standaard
   "Hello World", je vervangt dit zo).
3. **Edit code** → plak de volledige inhoud van
   `cloudflare/cloudflare-worker-lijstje/worker.js` (uit deze
   zip) erin → **Deploy**.
4. **Settings → Bindings** → **Add binding** → kies **KV Namespace**:
   - Variable name: `LIST_KV`
   - KV namespace: de namespace die je in stap 1 maakte
   → **Save and deploy**.
5. Noteer de Worker-URL, bv.
   `https://lijstje.<jouw-subdomain>.workers.dev`

   *(Wrangler-CLI alternatief: vul in
   `cloudflare/cloudflare-worker-lijstje/wrangler.toml` het echte
   namespace-id in bij `id`, dan in die map: `wrangler deploy`.)*

### CORS instellen (belangrijk!)

Zelfde als bij de andere twee Workers: open
`cloudflare/cloudflare-worker-lijstje/worker.js` en check
`ALLOWED_ORIGINS` bovenin. Staat al goed voor
`https://nelis0808.github.io` en de lokale dev-poorten. Gebruik je
een custom domain? Voeg die toe en deploy opnieuw.

## 3. `config.js` bijwerken met je Worker-URL

Open `assets/js/config.js` en vervang de placeholder:

```js
shoppingList: {
  workerUrl: 'https://lijstje.YOUR-SUBDOMAIN.workers.dev',
},
```

→ vul bij `workerUrl` de echte URL in die je in stap 2.5 noteerde.
Zolang dit nog de placeholder is, toont de pagina netjes een
waarschuwing in plaats van kapot te gaan.

## 4. Bestanden in je repo zetten

Kopieer uit deze zip naar de root van je `DateSite`-repo (structuur
is identiek, dus alles landt op de juiste plek):

```
lijstje.html                             (nieuw)
assets/css/pages/lijstje.css             (nieuw)
assets/css/utilities.css                           (aangepast — .emoji-icon toegevoegd)
assets/js/modules/lijstje.js             (nieuw)
assets/js/config.js                                (aangepast)
assets/js/main.js                                  (aangepast — 2 regels)
cloudflare/cloudflare-worker-lijstje/worker.js       (nieuw, apart van de site)
cloudflare/cloudflare-worker-lijstje/wrangler.toml   (nieuw, optioneel voor CLI)
```

Geen handmatige nav-aanpassingen nodig: "Lijstje" staat
al in `config.js` → verschijnt automatisch als kaart op de homepage
en in het "Meer"-menu.

## 5. Committen, pushen, testen

```bash
git add lijstje.html assets/css/pages/lijstje.css \
        assets/css/utilities.css assets/js/modules/lijstje.js \
        assets/js/config.js assets/js/main.js \
        cloudflare/cloudflare-worker-lijstje/
git commit -m "Gedeeld lijstje toevoegen (sync via Cloudflare KV)"
git push
```

Ga naar `https://nelis0808.github.io/DateSite/lijstje.html`
— je zou het standaardlijstje (blikgroente, broodbeleg, ontbijtkoek,
...) moeten zien. Vink iets af of voeg iets toe, open de pagina op een
ander apparaat (of gewoon een tweede tabblad) en wacht een paar
seconden — de wijziging moet daar ook verschijnen.

---

## Hoe de sync precies werkt

- Elke wijziging (aanvinken/verwijderen/toevoegen) wordt **meteen**
  naar de Worker gestuurd en direct in beeld bijgewerkt (je hoeft niet
  te wachten tot het is opgeslagen om het te zien).
- Ondertussen vraagt de pagina **elke 5 seconden** de Worker om de
  actuele lijst, zodat wijzigingen van de ander vanzelf verschijnen.
  Dit stopt zodra het tabblad niet actief is (geen zin om onnodig te
  blijven verversen) en ververst meteen weer zodra je terugkomt.
- Er is geen "wie wint" botsingslogica nodig voor twee mensen die om
  de beurt af en toe iets aanvinken — de laatste opgeslagen versie
  wint gewoon (last-write-wins). Voor een lijstje is dat
  ruim voldoende.

## 6. Meerdere lijsten (categorieën)

Bovenaan de pagina staat nu een dropdown (bv. "Lijstje ▾") met daarin
elke lijst die jullie hebben, plus **"+ Nieuwe lijst toevoegen"**
onderaan. Een lijst kiezen wisselt meteen naar die lijst; een nieuwe
naam intypen en op "Aanmaken" klikken maakt er direct een nieuwe aan
en springt ernaartoe. Welke lijst je laatst open had staat per
apparaat (browser) onthouden, dus jij en je vriendin kunnen prima
allebei een andere lijst open hebben staan.

Dit is bewust **één pagina** met een dropdown in plaats van een aparte
`.html`-pagina per categorie: nieuwe lijsten werken dan meteen zonder
dat er ooit nieuwe bestanden bijgemaakt of gedeployed hoeven te
worden — alleen de Worker-code hierboven moest daarvoor eenmalig
bijgewerkt worden.

## Problemen oplossen

| Symptoom | Oorzaak | Oplossing |
|---|---|---|
| "⚠️ Nog geen Worker gekoppeld" | `workerUrl` in `config.js` staat nog op de placeholder | Stap 3 hierboven |
| Console: CORS-foutmelding | Je site-origin staat niet in `ALLOWED_ORIGINS` | Voeg 'm toe in `worker.js`, opnieuw deployen |
| "Server misconfigured: LIST_KV binding ontbreekt" | KV-binding vergeten of verkeerde variabelenaam | Stap 2.4 — moet exact `LIST_KV` heten |
| Wijziging van je vriendin verschijnt niet | Nog geen 5 seconden gewacht, of haar tabblad staat op de achtergrond | Even wachten / haar tabblad actief maken |
| Lijst lijkt "gereset" naar het standaardlijstje | Kwam voor vóór de eerste succesvolle keer opslaan — normaal gedrag bij een lege KV-namespace | Zodra er één keer iets is opgeslagen, gebeurt dit niet meer |
| `404`/`Not found` van de Worker | Verkeerde `workerUrl`, of typefout in het pad | Controleer of de URL exact eindigt op `.workers.dev` zonder extra pad |
| Oude lijst is leeg na de upgrade | Migratie in `worker.js` zocht de oude KV-key onder een andere naam dan verwacht (zie `LEGACY_KEYS` bovenin dat bestand) | Voeg de juiste oude keynaam toe aan `LEGACY_KEYS` en deploy opnieuw — dit werkt alleen vóórdat de `lists`-key al bestaat, dus doe dit vóór je de pagina voor het eerst na de upgrade opent |
| Dropdown bovenaan toont geen lijsten | Oude Worker-code draait nog (kent `/lists` niet) | Stap 0.1 hierboven — Worker-code bijwerken |
