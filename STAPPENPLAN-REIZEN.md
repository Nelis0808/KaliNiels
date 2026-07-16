# Onze Reizen toevoegen — stappenplan

`reizen.html` is een interactieve wereldkaart: een SVG, getekend uit
echte geografische data (Natural Earth, publiek domein — zie
"Waar de kaartdata vandaan komt" hieronder), met een pin per land.
Je kan **slepen** (pannen) en **scrollen/knijpen** (zoomen). Klik een
pin → er opent een kaart-venster met de eigen, haarscherpe kaart van
dat land, met een pin per stad waar je foto's van hebt
gecatalogiseerd. Vanuit dat venster kan je door naar
`reizen/land.html`, dezelfde ervaring maar dan volledig-scherm mét
het fotostrookje per stad.

**Onze Reizen is nu volledig privé.** Niet alleen de foto's, maar de
hele pagina — de kaart zelf, de landpinnen, de plaatsnamen — is
verborgen achter een inlogscherm totdat je bent ingelogd. Inloggen
gebeurt niet meer per pagina, maar **één keer, site-breed**, via de
"👤 Profiel"-dropdown in de sticky header bovenaan elke pagina (zie
`assets/js/modules/auth.js` + `profile-dropdown.js`). Diezelfde
sessie ontgrendelt automatisch ook Onze Foto's, BlackJack en
Spiderette — er is nu maar één wachtwoord-scherm voor de hele site,
niet meer één per pagina.

**Dit is een volledige herbouw van de vorige versie.** Die scrapete
d-maps.com voor de landkaarten — dat bleek onbetrouwbaar (blokkeerde
de scraper, en landnamen/interne ID's op die site zijn niet
gestandaardiseerd). Deze versie gebruikt in plaats daarvan **lokale
bestanden** met echte landsgrenzen, geïdentificeerd met de gewone
ISO 3166-1-landcode (NL, BE, US, ...) die iedereen al kent. Geen
externe site, dus niets dat kan blokkeren, niets dat kan veranderen
onder je voeten, en geen netwerk-round-trip nodig om een land te
openen — dat gaat nu instant.

```
reizen.html                → volledig verborgen achter het inlogscherm (assets/js/modules/page-gate.js) totdat je via "👤 Profiel" bent ingelogd
                            → daarna: assets/data/travel-countries.json + assets/data/world-map.json (100% lokaal, geen Worker nodig)
                            → klik een pin: assets/data/countries/<ISO>.json (lokaal) + Worker "photo-gallery" (/travel, voor de steden)
reizen/land.html            → zelfde inlogscherm, plus de echte foto's per stad via dezelfde photo-gallery Worker
```

Er is dus nog maar **één** Cloudflare Worker in dit hele systeem
(`photo-gallery`, die had je al) — de eerdere `dmaps-proxy` Worker is
volledig verwijderd, dat bestaat niet meer. BlackJack en Spiderette
gebruiken voor hun *chips* nog wel hun eigen "blackjack" Worker, maar
delen nu dezelfde login-sessie als deze — zie
`assets/js/modules/auth.js`'s bestandskop voor de precieze uitleg
(kort gezegd: zet de "blackjack" Worker's `TOKEN_SECRET`,
`PASSPHRASE_A` en `PASSPHRASE_B` secrets exact gelijk aan die van de
"photo-gallery" Worker, dan werkt de gedeelde sessie ook daar).
```

Er is dus nu nog maar **één** Cloudflare Worker in dit hele systeem
(`photo-gallery`, die had je al) — de eerdere `dmaps-proxy` Worker is
volledig verwijderd, dat bestaat niet meer.

## Hoe het samenhangt met bijschriften

Een bijschrift in `captions.json` mag optioneel een land en plaats
krijgen (3e/4e element):

```json
{
  "lissabon-uitzicht.jpg": ["Uitzicht over Lissabon", "Onze eerste avond, mei 2026.", "Portugal", "Lissabon"]
}
```

- Niet elke foto hoeft dit — een foto met alleen de eerste twee (of
  maar één) velden werkt zoals eerst en verschijnt gewoon niet op de
  reiskaart.
- Het **land** (3e veld) moet overeenkomen met de `name` van een land
  in `assets/data/travel-countries.json` (hoofdletter-ongevoelig).
- De **plaats** (4e veld) is de naam van de stads-pin — gebruik
  consistente spelling tussen foto's van dezelfde stad.

## 1. `photo-gallery` Worker opnieuw deployen (nieuwe /travel-route)

Zelfde Worker als voorheen (zie `STAPPENPLAN-FOTOS.md`), alleen de
code is bijgewerkt met een `/travel`-route:

1. **Cloudflare dashboard** → **Workers & Pages** → jouw
   `photo-gallery` Worker → **Edit code**.
2. Vervang de inhoud door `cloudflare/cloudflare-worker-photos/worker.js`
   uit deze update.
3. **Deploy**.

Geen nieuwe secrets/bindings nodig — dezelfde `PHOTOS_BUCKET`-binding
en drie secrets werken door. **Als je de vorige (d-maps-based) versie
van dit systeem al had gedeployed: verwijder gerust de losse
`dmaps-proxy` Worker** in het Cloudflare dashboard — die wordt door
niets in deze update meer aangeroepen.

## 2. Landen instellen

Open `assets/data/travel-countries.json`. Elk land:

```json
{
  "iso": "PT", "name": "Portugal", "status": "visited",
  "cityPins": { "lissabon": { "lon": -9.1393, "lat": 38.7223 } }
}
```

- `iso` — een gewone **ISO 3166-1 alpha-2 code** (NL, BE, US, JP, ...
  — dezelfde tweeletter-code die overal wordt gebruikt, dus nooit
  onduidelijk). Dit is de sleutel waarmee de site
  `assets/data/countries/<ISO>.json` opzoekt.
- `name` — hoe het land heet in `captions.json` (voor de matching)
  én hoe het op de site getoond wordt.
- `status` — `"visited"` of `"wishlist"`, bepaalt de pin-kleur.
- `pin` — **optioneel**. Zonder dit veld krijgt een land automatisch
  een pin op het geografische midden van zijn vasteland (uitgerekend
  uit de echte kaartdata). Wil je 'm liever op de hoofdstad? Zet
  `"pin": { "lon": ..., "lat": ... }` — die coördinaten zoek je
  gewoon op (Wikipedia's infobox, of rechtsklik "Wat is hier" in
  Google Maps). Geen pixels gokken, geen trial-and-error.
- `cityPins` — **optioneel**, zie stap 3.

**Een land toevoegen dat er nog niet is?** Zet het gewoon in dit
bestand met zijn ISO-code — als dat land bestaat, bestaat ook
automatisch `assets/data/countries/<ISO>.json` al (alle ~237
landen/gebieden staan al klaar, zie "Welke landen werken al"
hieronder). Er is verder niets te bouwen of te scrapen.

## 3. (Optioneel) Precieze stads-pins instellen

Zonder een city-pin krijgt elke stad een nette maar willekeurige
"waaier"-positie (geen echte geografie) — dat werkt gewoon, meteen,
zonder verder werk. Wil je een stad wél precies op zijn echte plek
hebben staan: zoek zijn coördinaten op (Wikipedia, Google Maps) en
zet ze erbij:

```json
"cityPins": {
  "lissabon": { "lon": -9.1393, "lat": 38.7223 }
}
```

De sleutel (`"lissabon"`) moet **exact** (hoofdletter-ongevoelig)
overeenkomen met de "Plaats" die je in `captions.json` gebruikt. Dit
zijn **echte wereldcoördinaten**, geen schattingen — ze worden
automatisch door dezelfde projectie gehaald die de landkaart zelf
tekent, dus de pin landt altijd exact goed, op elk zoomniveau.
Steden zónder entry hier vallen automatisch terug op de
waaier-indeling — niets breekt als je dit overslaat.

`assets/data/travel-countries.json` staat al met een paar
voorbeelden erin (hoofdsteden van elk land) — pas ze aan of vul ze
verder aan naar wens.

## 4. Bestanden in je repo zetten

```
reizen.html                                   (aangepast — SVG-kaart + zoom-knoppen + modal)
reizen/land.html                              (aangepast — SVG-kaart + zoom-knoppen)
assets/css/pages/reizen.css                    (aangepast — pan/zoom, modal, SVG-styling)
assets/js/modules/reizen.js                    (aangepast — pan/zoom + modal-logica)
assets/js/modules/reizen-land.js                (aangepast — gebruikt nu de gedeelde helpers)
assets/js/modules/reizen-cities.js              (aangepast — projecteert lon/lat i.p.v. pixel-percentages)
assets/js/modules/map-pan-zoom.js               (ongewijzigd — sleep/scroll/knijp-besturing)
assets/js/modules/geo-render.js                 (nieuw — GeoJSON → SVG, vervangt dmaps.js volledig)
assets/data/travel-countries.json               (aangepast — ISO-codes i.p.v. handmatige x/y)
assets/data/world-map.json                      (nieuw — wereldkaart-data, alle landen)
assets/data/countries/*.json                    (nieuw — ~237 losse hoge-resolutie landkaarten)
cloudflare/cloudflare-worker-photos/worker.js     (ongewijzigd t.o.v. vorige Reizen-update)
```

**Verwijderd** (mag je uit je eigen repo weghalen als je de vorige
versie al had): `assets/js/modules/dmaps.js`,
`cloudflare/cloudflare-worker-dmaps/`,
`assets/icons/reizen/world-map.jpg` en `world-map.svg`.

## 5. Committen, pushen, testen

```bash
git add reizen.html reizen/land.html assets/css/pages/reizen.css \
        assets/js/modules/reizen.js assets/js/modules/reizen-land.js \
        assets/js/modules/reizen-cities.js assets/js/modules/map-pan-zoom.js \
        assets/js/modules/geo-render.js assets/data/travel-countries.json \
        assets/data/world-map.json assets/data/countries/ \
        cloudflare/cloudflare-worker-photos/worker.js
git rm -r assets/js/modules/dmaps.js cloudflare/cloudflare-worker-dmaps/ assets/icons/reizen/ 2>/dev/null
git commit -m "Onze Reizen: echte vectorkaart (geen d-maps.com meer), pan/zoom, precieze pins"
git push
```

Ga naar `https://nelis0808.github.io/KaliNiels/reizen.html`:

- Je zou de landen-pins op de wereldkaart moeten zien, meteen (geen
  laadwachttijd voor een externe kaart).
- Sleep om te verschuiven, scroll (of pinch op mobiel) om te zoomen.
  Dubbelklik/dubbeltik op een plek zoomt daar gericht op in — handig
  als twee pins dicht bij elkaar liggen (bijv. Nederland/België).
- Klik een land → er opent **direct** een venster met de landkaart
  (geen netwerk-wachttijd — het is een lokaal bestand) en, als er
  gecatalogiseerde foto's zijn, stad-pins erop.
- Klik een stad-pin voor de echte foto's van die stad (de hele pagina
  is al gated achter de "👤 Profiel"-login, dus als je hier komt ben
  je al ingelogd).
- "Volledige pagina met foto's" in dat venster brengt je naar
  `reizen/land.html?iso=XX`, dezelfde ervaring volledig-scherm.

---

## Waar de kaartdata vandaan komt

[Natural Earth](https://www.naturalearthdata.com/) — publiek domein,
geen naamsvermelding verplicht (staat er toch bij, netjes). Het is
dezelfde data die achter de meeste "serieuze" webkaarten zit
(D3-voorbeelden, Wikipedia's kaartjes, noem maar op) — geen scraping,
geen doorlopende afhankelijkheid van een externe site, want de
bestanden staan gewoon in je eigen repo:

- `assets/data/world-map.json` (~1,7 MB) — alle landen op 1:50.000.000-
  detail, voor het wereldoverzicht. Bevat ook, per land, het
  geografische middelpunt van zijn vasteland (voor automatische pins,
  zie stap 2).
- `assets/data/countries/<ISO>.json` (~10–270 KB per land) — dat
  land alleen, op 1:10.000.000-detail (5x scherper dan de
  wereldkaart), bijgesneden tot het "hoofdgebied": het vasteland plus
  dichtbijgelegen eilanden/regio's (bijv. Noord-Ierland blijft bij
  het Verenigd Koninkrijk, Corsica bij Frankrijk), maar ver-overzeese
  gebieden (Frans-Guyana, Alaska, de Azoren, ...) zijn eruit gefilterd
  zodat de kaart van bijvoorbeeld Frankrijk niet gedomineerd wordt
  door een piepklein Zuid-Amerikaans gebiedje aan de rand.

Deze bestanden zijn **eenmalig gegenereerd** (uit het `world-atlas`
npm-pakket, dat op zijn beurt van Natural Earth komt) en gewoon
statisch meegeleverd — er draait geen build-stap, geen scraper, geen
Worker voor de kaart zelf. Wil je zelf de brondata verversen of een
land met een andere "hoofdgebied"-afsnijding: dat gebeurde met een
klein Node-scriptje (topojson → GeoJSON, ISO-nummer → ISO-lettercode
via het `iso-3166-1`-pakket, dan per land het grootste
grenspolygoon plus alles binnen ~10° ervan). Vraag er gerust naar als
je dit ooit opnieuw wil draaien.

## Welke landen werken al

Alle ~237 landen/gebieden met een officiële ISO 3166-1-code hebben al
een kant-en-klaar bestand in `assets/data/countries/` — je hoeft dus
nooit iets te "activeren", alleen een entry toe te voegen aan
`travel-countries.json` (stap 2). Landen zónder algemeen erkende
ISO-code (bijv. Kosovo, Somaliland, betwiste gebieden) staan er niet
tussen — die komen niet voor in de ISO-standaard, dus ook niet in
deze data.

## Problemen oplossen

| Symptoom | Oorzaak | Oplossing |
|---|---|---|
| Land verschijnt niet op de wereldkaart | Niet toegevoegd aan `assets/data/travel-countries.json`, of de ISO-code klopt niet | Stap 2 hierboven — check de code op [iso.org](https://www.iso.org/obp/ui/#search) als je twijfelt |
| Kaart-venster toont "Kon de kaart niet laden" | `assets/data/countries/<ISO>.json` ontbreekt (typefout in de ISO-code?) of is per ongeluk verwijderd | Check de bestandsnaam **exact** hoofdlettergevoelig tegen `iso` in `travel-countries.json` |
| Pin staat niet precies op de hoofdstad | Je gebruikt de automatische centroid-pin (geen `pin`-veld gezet) | Stap 2 — voeg `"pin": {"lon":...,"lat":...}` toe met de echte coördinaten |
| "⚠️ Nog geen Worker gekoppeld" bij de steden | `workerUrl` in `assets/js/config.js` (bij `photos`) staat nog op de placeholder | Zie `STAPPENPLAN-FOTOS.md` stap 4 |
| Geen steden te zien bij een land | Geen foto's met "Land" dat matcht, of het land-veld spelt anders dan `name` in `travel-countries.json` | Check `captions.json` |
| Stad-pin klikbaar maar geen foto's | "Plaats" wijkt net iets af van de pin-naam | Check spelling in `captions.json` tegen de pin-naam |
| `404`/CORS-foutmelding van `/travel` | Oude versie van `worker.js` nog actief | Stap 1 hierboven |
| Slepen op de kaart voelt "vast" op mobiel | Pagina zelf scrollt mee | Zou niet moeten — de kaart zet `touch-action: none`; laat het weten als dit toch gebeurt op jouw toestel |
| Twee pins overlappen elkaar (bijv. Nederland/België) | Ze liggen simpelweg dicht bij elkaar op een uitgezoomde wereldkaart — net als in Google Maps | Zoom in (scroll/knijp, of dubbelklik/dubbeltik precies tussen de twee pins) tot ze uit elkaar vallen |
