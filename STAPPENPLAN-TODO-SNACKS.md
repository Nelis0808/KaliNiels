# TODO Lijst + Snack Ratings toevoegen — stappenplan

Deze update voegt twee pagina's toe, allebei in twee gedeelde kolommen
(Kalina links, Niels rechts — zelfde indeling als `gifts.html`):

- **`todo.html`** — een TODO-lijstje per persoon, met prioriteit
  (rood/oranje/geel/wit), hernoembaar, en drag-to-reorder.
- **`snack-rating.html`** — snack-beoordelingen per persoon: link,
  optioneel een foto, sterren van 0 tot 5, en een beschrijving.

Beide werken op **exact dezelfde manier** als het boodschappenlijstje:
wat jij verandert, ziet de ander een paar seconden later ook (en
andersom) — zonder in te loggen. Dat betekent: **twee nieuwe, aparte
Workers**, elk met hun eigen Cloudflare KV-opslag. Ze hebben niets met
elkaar of met de andere Workers op deze site te maken.

```
Browser (jij)         →  Worker "todo-lijst"     →  Cloudflare KV (de TODO's)
Browser (je vriendin) →  Worker "todo-lijst"     →  Cloudflare KV (de TODO's)

Browser (jij)         →  Worker "snack-ratings"  →  Cloudflare KV (de ratings)
Browser (je vriendin) →  Worker "snack-ratings"  →  Cloudflare KV (de ratings)
```

Geen wachtwoord nodig (net als bij het boodschappenlijstje en de
cadeau-ideeën): een TODO-lijstje en een lijstje snack-ratings zijn niet
gevoelig genoeg om die extra stap waard te zijn.

Dit stappenplan doet **beide Workers achter elkaar** — de stappen zijn
voor allebei identiek, alleen de namen/bindings verschillen.

---

## 1. Cloudflare KV-namespaces aanmaken (twee stuks)

1. Log in op <https://dash.cloudflare.com>.
2. Ga naar **Workers & Pages** → **KV** (in het linkermenu) →
   **Create a namespace**.
3. Naam: `todo-lijst` → **Add**.
4. Herhaal voor de tweede: naam `snack-ratings` → **Add**.
5. Beide namespaces mogen leeg blijven — de Worker vult ze zelf
   (begint gewoon met een lege lijst, geen standaarditems nodig hier).

## 2. De twee Workers deployen

Herhaal dit blok twee keer — één keer voor `todo-lijst`
(`cloudflare/cloudflare-worker-todo/`, binding `TODO_KV`), één keer
voor `snack-ratings` (`cloudflare/cloudflare-worker-snacks/`, binding
`SNACKS_KV`):

1. **Workers & Pages** → **Create** → **Create Worker**.
2. Naam: `todo-lijst` (of `snack-ratings`) → **Deploy** (met de
   standaard "Hello World", je vervangt dit zo).
3. **Edit code** → plak de volledige inhoud van
   `cloudflare/cloudflare-worker-todo/worker.js` (of
   `cloudflare-worker-snacks/worker.js`) uit deze zip erin → **Deploy**.
4. **Settings → Bindings** → **Add binding** → kies **KV Namespace**:
   - Variable name: **exact** `TODO_KV` (of `SNACKS_KV` voor de
     andere Worker) — de Worker-code verwacht precies die naam.
   - KV namespace: de bijbehorende namespace uit stap 1.
   → **Save and deploy**.
5. Noteer de Worker-URL, bv.
   `https://todo-lijst.<jouw-subdomain>.workers.dev` (en
   `https://snack-ratings.<jouw-subdomain>.workers.dev`).

   *(Wrangler-CLI alternatief: vul in
   `cloudflare/cloudflare-worker-todo/wrangler.toml` (en
   `-snacks/wrangler.toml`) het echte namespace-id in bij `id`, dan in
   die map: `wrangler deploy`.)*

### CORS instellen (belangrijk!)

Zelfde als bij alle andere Workers op deze site: open
`worker.js` van elke nieuwe Worker en check `ALLOWED_ORIGINS`
bovenin. Staat al goed voor `https://nelis0808.github.io` en de
lokale dev-poorten. Gebruik je een custom domain? Voeg die toe in
**beide** `worker.js`-bestanden en deploy opnieuw.

## 3. `config.js` bijwerken met je Worker-URLs

Open `assets/js/config.js` en vervang de twee placeholders:

```js
todo: {
  workerUrl: 'https://todo.YOUR-SUBDOMAIN.workers.dev',
  personLabels: {
    a: 'Niels',
    b: 'Kalina',
  },
},

snackRatings: {
  workerUrl: 'https://snack-ratings.YOUR-SUBDOMAIN.workers.dev',
  personLabels: {
    a: 'Niels',
    b: 'Kalina',
  },
},
```

→ vul bij `workerUrl` de echte URL's in die je in stap 2.5 noteerde.
Zolang dit nog de placeholder is, toont elke pagina netjes een
waarschuwing in plaats van kapot te gaan (zelfde gedrag als bij het
boodschappenlijstje).

`personLabels` bepaalt alleen de namen die boven elke kolom staan —
verander die gerust als jullie iets anders willen zien, dat heeft
niets met de Worker te maken.

## 4. Bestanden in je repo zetten

Kopieer uit deze zip naar de root van je repo (structuur is
identiek, dus alles landt op de juiste plek):

```
todo.html                                         (nieuw)
snack-rating.html                                 (nieuw)
assets/css/pages/todo.css                         (nieuw)
assets/css/pages/snack-rating.css                 (nieuw)
assets/js/modules/todo.js                         (nieuw)
assets/js/modules/snack-rating.js                 (nieuw)
assets/js/config.js                               (aangepast — todo + snackRatings toegevoegd)
assets/js/main.js                                 (aangepast — 4 regels)
cloudflare/cloudflare-worker-todo/worker.js        (nieuw, apart van de site)
cloudflare/cloudflare-worker-todo/wrangler.toml    (nieuw, optioneel voor CLI)
cloudflare/cloudflare-worker-snacks/worker.js      (nieuw, apart van de site)
cloudflare/cloudflare-worker-snacks/wrangler.toml  (nieuw, optioneel voor CLI)
```

Geen handmatige nav-aanpassingen nodig: "TODO Lijst" en "Snack
Ratings" staan al in `config.js` → verschijnen automatisch als kaart
op de homepage en in het "Meer"-menu.

## 5. Committen, pushen, testen

```bash
git add todo.html snack-rating.html \
        assets/css/pages/todo.css assets/css/pages/snack-rating.css \
        assets/js/modules/todo.js assets/js/modules/snack-rating.js \
        assets/js/config.js assets/js/main.js \
        cloudflare/cloudflare-worker-todo/ cloudflare/cloudflare-worker-snacks/
git commit -m "TODO-lijst en snack-ratings toevoegen (sync via Cloudflare KV)"
git push
```

Ga naar `.../todo.html` en `.../snack-rating.html` — beide zouden
leeg moeten starten (geen standaardlijstje ditmaal). Voeg links en
rechts iets toe, open de pagina op een ander apparaat (of een tweede
tabblad) en wacht een paar seconden — de wijziging moet daar ook
verschijnen.

---

## Hoe het per pagina werkt

### TODO Lijst

- Elke taak hoort bij één kolom (Kalina of Niels) — toevoegen via het
  formulier onderaan die kolom.
- Prioriteit kies je bij het toevoegen (rood/oranje/geel/wit), en kun
  je daarna nog wijzigen door op het gekleurde bolletje bij een taak
  te klikken (cyclet door alle vier).
- Naam wijzigen: ✏️-knopje bij de taak, typen, Enter of ergens anders
  klikken om op te slaan.
- Herordenen: sleep aan het handvat (≡) links van een taak, of houd
  de rij zelf even ingedrukt en sleep dan — beide werken met muis én
  vinger. Pijltje-omhoog/omlaag werkt ook zodra een handvat
  focus heeft (toetsenbord).
- Het volgnummer ("1.", "2.", ...) bij elke taak is puur decoratief en
  volgt automatisch de huidige volgorde.

### Snack Ratings

- Zelfde kolom-indeling. Alleen een naam is verplicht; link, foto en
  beschrijving zijn optioneel.
- Sterren: klik op een ster in het formulier om de beoordeling te
  zetten; nogmaals op dezelfde (hoogste gevulde) ster klikken zet 'm
  terug naar 0.
- Een foto wordt automatisch verkleind/gecomprimeerd in de browser
  vóórdat 'm verstuurd wordt (max 640px breed, JPEG-kwaliteit 80%) —
  dat houdt de gedeelde lijst klein en snel, ook met een paar foto's
  erin.
- Bewerken: ✏️-knopje op een kaart vult hetzelfde formulier opnieuw
  in (nu met "Opslaan" i.p.v. "Toevoegen") — "Annuleren" laat het
  weer leeg achter zonder iets te wijzigen.
- Kaarten sorteren automatisch op sterren (hoogste eerst), bij een
  gelijke score wint de meest recent toegevoegde.

## Hoe de sync precies werkt

Exact hetzelfde model als het boodschappenlijstje (zie
`STAPPENPLAN-BOODSCHAPPEN.md` voor de volledige uitleg) — samengevat:

- Elke wijziging wordt **meteen** naar de bijbehorende Worker
  gestuurd en direct in beeld bijgewerkt.
- Ondertussen vraagt de pagina **elke 5 seconden** de Worker om de
  actuele lijst, zodat wijzigingen van de ander vanzelf verschijnen.
  Stopt zodra het tabblad niet actief is, ververst meteen weer zodra
  je terugkomt.
- Last-write-wins, geen ingewikkelde botsingslogica — ruim voldoende
  voor twee mensen die af en toe iets aanpassen.
- **Belangrijk verschil met het boodschappenlijstje:** hier delen
  BEIDE kolommen (Kalina + Niels) samen ÉÉN lijst in Cloudflare KV
  (elk item heeft een `person`-veld) — elke opslag stuurt dus altijd
  de volledige lijst van beide kolommen mee, niet alleen die van de
  kolom waarin je iets wijzigde. Dat is normaal en geen probleem: de
  Worker en de pagina houden dat vanzelf consistent.

## Problemen oplossen

| Symptoom | Oorzaak | Oplossing |
|---|---|---|
| "⚠️ Nog geen Worker gekoppeld" | `workerUrl` in `config.js` staat nog op de placeholder | Stap 3 hierboven |
| Console: CORS-foutmelding | Je site-origin staat niet in `ALLOWED_ORIGINS` | Voeg 'm toe in het betreffende `worker.js`, opnieuw deployen |
| "Server misconfigured: TODO_KV/SNACKS_KV binding ontbreekt" | KV-binding vergeten of verkeerde variabelenaam | Stap 2.4 — moet **exact** `TODO_KV` / `SNACKS_KV` heten |
| Wijziging van je vriendin verschijnt niet | Nog geen 5 seconden gewacht, of haar tabblad staat op de achtergrond | Even wachten / haar tabblad actief maken |
| "⚠️ Wijziging niet opgeslagen (mogelijk een te grote foto?)" bij Snack Ratings | Foto (na verkleinen) toch nog te groot, of KV-quotum geraakt | Probeer een kleinere/eenvoudigere foto; de Worker weigert foto's boven ~600KB als extra vangnet |
| `404`/`Not found` van de Worker | Verkeerde `workerUrl`, of typefout in het pad | Controleer of de URL exact eindigt op `.workers.dev` zonder extra pad |
| Kaarten/taken van Kalina en Niels lijken door elkaar te lopen | Zou niet moeten gebeuren — elk item heeft een vast `person`-veld | Controleer of `personLabels` in `config.js` klopt; het probleem zit dan niet in de sync zelf |
