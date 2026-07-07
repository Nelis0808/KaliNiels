# Privé fotogalerij toevoegen — stappenplan

Deze update voegt `photos.html` toe: een privégalerij die standaard
alleen **zes gekleurde slotjes** toont (placeholders, geen echte
foto's) totdat iemand met het juiste wachtwoord inlogt. Na inloggen
zie je jullie echte foto's, en boven de galerij staat "Ingelogd als
Jij" of "Ingelogd als Je vriendin" — want jullie hebben ieder een eigen
wachtwoord.

**Belangrijk:** de echte foto's staan *nergens* in deze git-repo (die
is publiek!). Ze staan in een **privé Cloudflare R2-bucket**, en de
enige manier om ze te zien is via een tweede Cloudflare Worker die
eerst het wachtwoord checkt. Zonder geldig wachtwoord krijgt de
browser letterlijk geen foto-bytes toegestuurd — het is geen kwestie
van "verstopt", het is echt niet opvraagbaar.

```
Browser (photos.html)  →  Worker "photo-gallery" (checkt wachtwoord)  →  Privé R2-bucket (echte foto's)
                            ↑ hier staan de 2 wachtwoorden + de token-sleutel
```

Dit is een **tweede, aparte Worker** naast de Ticketmaster-proxy uit de
vorige update — ze hebben niets met elkaar te maken en kunnen
onafhankelijk werken/breken.

---

## 1. Cloudflare R2-bucket aanmaken (privé fotoshost)

1. Log in op <https://dash.cloudflare.com>.
2. Ga naar **R2 Object Storage** → **Create bucket**.
3. Naam: bv. `our-private-photos` (moet matchen met `bucket_name` in
   `cloudflare-worker-photos/wrangler.toml`, of pas dat bestand aan
   naar de naam die jij kiest).
4. Laat "Public access" gewoon op de standaardwaarde **Disabled**/privé
   staan — dat is precies de bedoeling. Niemand kan bij deze bucket
   behalve jouw eigen Worker (via de binding hieronder).

> ℹ️ Cloudflare vraagt bij sommige accounts om een betaalmethode ter
> verificatie voordat je R2 kunt gebruiken. Dat is puur verificatie —
> zolang je onder de gratis limiet blijft (10 GB opslag, ruim genoeg
> voor duizenden foto's) betaal je niets.

## 2. Foto's uploaden

In de R2-bucket in het dashboard: **Upload** → sleep je foto's erin
(jpg/jpeg/png/webp/gif worden herkend). Klaar — geen build-stap, geen
CLI nodig. Wil je later een foto toevoegen of verwijderen? Gewoon
opnieuw uploaden/verwijderen in dit dashboard, de site pikt het
automatisch op (de Worker vraagt live de inhoud van de bucket op).

### Optioneel: bijschriften toevoegen

Een kant-en-klaar voorbeeld staat in `cloudflare-worker-photos/captions.example.json`
in deze zip. Kopieer het, hernoem naar `captions.json`, en vervang de
bestandsnamen door die van je eigen geüploade foto's. Elke foto krijgt
twee bijschriften in een `[kort, lang]` array:
- **kort** — altijd zichtbaar onder de foto in het overzicht.
- **lang** — verschijnt pas wanneer je op de foto klikt (in de
  uitvergrote weergave).

```json
{
  "vakantie-parijs.jpg": ["Ons weekendje Parijs", "Ons weekendje Parijs, mei 2026 — met te veel croissants en te weinig slaap."],
  "verjaardag.png": ["Jouw verjaardag ✨", "Jouw verjaardag dit jaar, met taart en veel te veel cadeaus."]
}
```

Alleen een los woord of zinnetje nodig, zonder aparte lange versie?
Dan mag het ook gewoon een enkele string blijven (zoals in de oude
versie) — die wordt dan voor zowel het korte als het lange bijschrift
gebruikt:

```json
{
  "shrek.jpg": "Looking shreksy"
}
```

Upload dit bestand ook in dezelfde R2-bucket (bestandsnaam moet
letterlijk `captions.json` zijn). Foto's zonder match tonen gewoon
geen bijschrift.

## 3. De photo-gallery Worker deployen

1. **Workers & Pages** → **Create** → **Create Worker**.
2. Naam: `photo-gallery` → **Deploy** (met de standaard "Hello World",
   je vervangt dit zo).
3. **Edit code** → plak de volledige inhoud van
   `cloudflare-worker-photos/worker.js` (uit deze zip) erin → **Deploy**.
4. **Settings → Bindings** → **Add binding** → kies **R2 Bucket**:
   - Variable name: `PHOTOS_BUCKET`
   - R2 bucket: de bucket die je in stap 1 maakte
   → **Save and deploy**.
5. **Settings → Variables and Secrets** → **Add** (3x, allemaal als
   type **Secret**):
   - `PASSPHRASE_A` → jouw wachtwoord
   - `PASSPHRASE_B` → het wachtwoord van je vriendin
   - `TOKEN_SECRET` → een lang, willekeurig stuk tekst (bv. gegenereerd
     met een password manager, 40+ tekens) — dit ondertekent de
     inlog-sessies, dus hoe langer/random hoe beter. Niemand hoeft dit
     te onthouden, het wordt nergens ingevoerd door jullie.
6. Noteer de Worker-URL, bv.
   `https://photo-gallery.<jouw-subdomain>.workers.dev`

   *(Wrangler-CLI alternatief: in `cloudflare-worker-photos/`, run
   `wrangler deploy`, dan `wrangler secret put PASSPHRASE_A`, etc.)*

### CORS instellen

Zelfde als bij de Ticketmaster-Worker: open
`cloudflare-worker-photos/worker.js` en check `ALLOWED_ORIGINS`
bovenin. Staat al goed voor `https://nelis0808.github.io` en de
lokale dev-poorten. Gebruik je een custom domain? Voeg die toe en
deploy opnieuw.

## 4. `config.js` bijwerken

```js
photos: {
  workerUrl: 'https://photo-gallery.YOUR-SUBDOMAIN.workers.dev',
  personLabels: {
    a: 'Jij',
    b: 'Je vriendin',
  },
},
```

Vul bij `workerUrl` je echte Worker-URL in (stap 3.6), en vervang
`'Jij'` / `'Je vriendin'` gerust door je echte namen — dit zijn alleen
weergavenamen, geen wachtwoorden, dus ze mogen gewoon zichtbaar in dit
publieke bestand staan.

## 5. Bestanden in je repo zetten

```
photos.html                                  (nieuw)
assets/css/pages/photos.css                  (nieuw)
assets/js/modules/photo-gallery.js           (nieuw)
assets/js/config.js                          (aangepast)
assets/js/main.js                            (aangepast — 2 regels)
cloudflare-worker-photos/worker.js           (nieuw, apart van de site)
cloudflare-worker-photos/wrangler.toml       (nieuw, optioneel voor CLI)
```

Net als bij Ticketmaster: geen handmatige nav-aanpassingen nodig, want
"Onze Foto's" staat al in `config.js` → verschijnt automatisch in het
"Meer"-menu en als kaart op de homepage.

## 6. Committen, pushen, testen

```bash
git add photos.html assets/css/pages/photos.css \
        assets/js/modules/photo-gallery.js assets/js/config.js assets/js/main.js \
        cloudflare-worker-photos/
git commit -m "Privé fotogalerij toevoegen (login per persoon, R2-opslag)"
git push
```

Ga naar `https://nelis0808.github.io/DateSite/photos.html`, je zou nu
de zes gekleurde slotjes moeten zien + een inlogveld. Log in met jouw
wachtwoord → je zou je eigen foto's moeten zien + "Ingelogd als Jij".
Log uit, probeer het wachtwoord van je vriendin → "Ingelogd als Je
vriendin".

---

## Wat dit wel en niet beschermt

- ✅ Iemand die je publieke GitHub-repo doorleest, vindt geen
  wachtwoorden, geen foto's, en geen manier om ze te vinden.
- ✅ Iemand die de Worker-URL raadt/vindt, komt zonder wachtwoord geen
  stap verder (elke foto-aanvraag wordt server-side geverifieerd).
- ✅ Een geknoeid of verlopen token wordt geweigerd (getest, zie
  hieronder) — dit is geen simpele "if paswoord === 'geheim'" check die
  je in de broncode zou kunnen teruglezen.
- ⚠️ Dit is een gedeeld wachtwoord per persoon, geen account met
  e-mailverificatie/wachtwoord-reset — prima voor "alleen wij twee",
  niet bedoeld als bank-niveau beveiliging.
- ⚠️ Wie het wachtwoord kent (of het token uit `localStorage` van
  iemands ingelogde laptop kopieert) kan de foto's zien — net als met
  elk gedeeld wachtwoord. Gebruik geen wachtwoord dat je ook ergens
  anders gebruikt.

## Problemen oplossen

| Symptoom | Oorzaak | Oplossing |
|---|---|---|
| "⚠️ Geen worker geconfigureerd" | `workerUrl` staat nog op de placeholder | Stap 4 |
| "Server misconfigured: missing secrets" | Eén van de 3 secrets niet gezet | Stap 3.5 |
| "Server misconfigured: R2 bucket not bound" | Binding vergeten of verkeerde variabelenaam | Stap 3.4 — moet exact `PHOTOS_BUCKET` heten |
| CORS-foutmelding in console | Je site-origin staat niet in `ALLOWED_ORIGINS` | Stap 3, CORS-instellen |
| "Onjuist wachtwoord" met correct wachtwoord | Typefout bij het instellen van de secret (spaties/hoofdletters) | Secret opnieuw invoeren in stap 3.5 |
| Nieuw geüploade foto verschijnt niet | Bestandsextensie niet herkend (alleen jpg/jpeg/png/webp/gif) | Converteer naar een van deze formaten |
| Blijft steeds uitgelogd na herladen | Cookies/site-data worden gewist door browser-instellingen, of "privénavigatie" | Test in een normaal browservenster |
