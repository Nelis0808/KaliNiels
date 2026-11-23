# Nooit betalen bij Cloudflare — wat is ingesteld en wat jij nog checkt

Dit bestand hoort bij de mail "Cloudflare Observability pricing changes starting
December 1, 2026". Kort: **de mail raakt je site niet, zolang je op het gratis
(Free) plan zit.** Hieronder staat waarom, wat er in de code is ingesteld, en een
lijstje van een paar klikken in het Cloudflare-dashboard om het af te maken.

## 1. Wat zegt de mail?

* Observability (logs en traces van je Workers) krijgt vanaf 1 december 2026 een
  eigen abonnement met prijs per GB.
* **Workers Paid** → je krijgt automatisch een *betaald* Observability-abonnement.
* **Geen Workers Paid** → je blijft op **Free Observability**: *"will not be
  charged"*. Bij 0,5 GB logs per dag pauzeert het opnemen van logs, de volgende
  dag gaat het vanzelf weer door. Er is geen "extra gebruik" mogelijk, dus ook
  geen rekening.
* Je kunt een Observability-abonnement altijd opzeggen zonder je Workers-plan te
  veranderen.

De mail is naar het account gestuurd, dat zegt alleen dat de wijziging voor je
account geldt, niet dat je Paid bent. Controleer dat met stap A hieronder.

## 2. Wat kan er überhaupt geld kosten?

| Onderdeel | Op het Free plan | Kan het een rekening geven? |
|---|---|---|
| Workers (aantal aanvragen) | 100.000 per dag | Nee: bij het plafond stopt hij tot de volgende dag |
| KV | 100.000 reads, **1.000 writes** per dag, 1 GB | Nee: zelfde, hij stopt tot de volgende dag |
| Observability | 0,5 GB per dag | Nee (zie mail) |
| **R2** (foto's: galerij, cadeaus) | 10 GB opslag, 1 miljoen schrijf- en 10 miljoen leesacties per maand | **Ja, als je er ver overheen gaat**; dit is het enige onderdeel met een prijs ($0,015 per GB-maand extra) |

Dus: Workers en KV kunnen op Free niet in rekening worden gebracht, R2 wel. Voor
R2 zijn daarom harde grenzen in de code gezet (punt 3c).

## 3. Wat is er in de code ingesteld

### a) Daglimiet per Worker (alle 11)

Elke Worker telt per dag (UTC) mee hoeveel aanvragen hij krijgt en hoeveel
"schrijf-aanvragen" (opslaan, toevoegen, enz.). Is het plafond bereikt, dan
antwoordt hij met "Daglimiet bereikt" tot de volgende dag, zodat één foutje of
een open tabblad niet het hele (gedeelde) account leegtrekt.

| Worker | Aanvragen/dag | Schrijf-acties/dag |
|---|---|---|
| lijstje | 12.000 | 150 |
| todo | 8.000 | 80 |
| rating (snacks) | 6.000 | 60 |
| clothing | 6.000 | 60 |
| gifts | 8.000 | 100 (+ max. 20 foto-uploads) |
| recepten (TheMealDB) | 3.000 | 50 |
| ah-recepten | 3.000 | 220 (elke live-ophaalactie en elke import-stap telt mee; zie punt 3d) |
| favorite-artists | 3.000 | 40 |
| chips | 6.000 | 200 |
| gallery | 8.000 | 30 (alleen inloggen) |
| ticketmaster | 2.000 | n.v.t. |

Totaal aanvragen: 65.000 (ruim onder de 100.000), totaal schrijf-acties: 990
(onder de 1.000 van KV). De getallen staan bovenaan in elke Worker bij
`const BUDGET = {…}` en zijn aan te passen.

**Eerlijk over de grenzen:** dit is een extra vangnet, geen garantie. De
tellers leven in het geheugen van de Worker (die kan verversen) en in de Cache
API (die Cloudflare alleen op een eigen domein garandeert, niet op
`*.workers.dev`). De echte garantie is het feit dat Free-plan Workers/KV niet
gefactureerd kunnen worden.

### b) Minder onnodig verversen in de browser

Lijstje, to-do, snack-rating, kleding, cadeaus en collecties verversen elke 5–8
seconden. Dat gebeurde ook als je de pagina open liet staan zonder iets te doen.
Nu stopt het verversen na **5 minuten zonder muis, toets of aanraking**
(`assets/js/modules/poll-guard.js`) en gaat het meteen weer door zodra je terug
bent. De cadeau-pagina tekent ook niet meer opnieuw als er niets veranderd is.

### c) R2-grenzen (cadeau-foto's)

* maximaal 20 nieuwe/vervangen foto's per dag
* maximaal 500 MB in totaal in de bucket (de gratis 10 GB komt dus nooit in zicht)
* maximaal 5 MB per foto; grote foto's worden in de browser eerst verkleind
* een kleine lijst in KV houdt bij welke cadeaus een foto hebben, zodat de Worker
  nooit de dure `list`-actie van R2 hoeft te doen

### d) AH-recepten praat niet meer uit zichzelf met ah.nl

De AH-recepten-pagina toont alleen de opgeslagen backup. Eén knop op de dev-pagina
("Alles ophalen van AH.nl") doet een proefaanvraag via de Worker. AH blokkeert de
servers van Cloudflare meestal; dan verschijnt op de dev-pagina een stappenplan om
het **één keer in je eigen browser** te doen (`tools/ah-browser-export.js`, draait op
ah.nl, maakt het bestand `ah-recepten-export.json`), en laad je dat bestand op
dezelfde pagina in. De import kost per stukje precies één KV-schrijfactie:
± 120 lijst-pagina's + max. 48 recept-pakketten = ± 170 van de 220 per dag. Gaat
de daglimiet toch over de rand, kies dan morgen hetzelfde bestand opnieuw: de
dev-pagina onthoudt wat al binnen is en gaat verder.

## 4. Wat jij in het dashboard doet (± 5 minuten)

**A. Controleer of je op Free zit.**
Cloudflare-dashboard → *Workers & Pages* → *Plans* (of *Billing* → *Subscriptions*).
Er mag **geen** "Workers Paid" staan en geen betaald "Observability". Staat er
wel iets betaalds en wil je dat niet: opzeggen via *Billing → Subscriptions*.

**B. Optioneel: logs uitzetten.**
Per Worker: *Settings* → *Observability* → *Workers Logs* uit. Dat is niet
nodig (op Free kost het niets), maar dan loopt het nooit tegen de 0,5 GB aan.

**C. Kijk één keer naar R2.**
*R2* → *Overview*/*Metrics*: opslag moet ver onder 10 GB staan (met de nieuwe
grenzen blijft het onder 0,5 GB voor cadeau-foto's; de galerij-bucket heeft
daar een eigen grootte, controleer die even).

**D. Zet een melding aan.**
*Notifications* → *Add* → kies de melding voor gebruik/facturatie als je account
die aanbiedt. Het geeft een mail voordat er iets mis kan gaan.

**E. Plak de nieuwe Worker-code.**
Voor elke Worker: Workers & Pages → de Worker → *Edit code* → alles vervangen door
het bestand uit de map `cloudflare/…` → *Deploy*. Nieuwe bindings of secrets zijn
**niet** nodig.

| Worker | Bestand |
|---|---|
| lijstje | `cloudflare/lijstje/lijstje_worker.js` |
| todo | `cloudflare/todo/todo_worker.js` |
| rating | `cloudflare/rating/rating_worker.js` |
| clothing | `cloudflare/clothing/clothing_worker.js` |
| gifts (bol.com-plaatjes, upload-grenzen) | `cloudflare/gifts/gifts_worker.js` |
| recepten | `cloudflare/recepten/recepten_worker.js` |
| ah-recepten (backup + ophalen) | `cloudflare/ah-recepten/ah_recepten_worker.js` |
| favorite-artists | `cloudflare/ticketmaster_favorite-artists/ticket_master_favorite_artists_worker.js` |
| chips | `cloudflare/chips/chips_worker.js` |
| gallery | `cloudflare/gallery/gallery_worker.js` |
| ticketmaster | `cloudflare/ticketmaster/ticketmaster_worker.js` |

Pas de website (de rest van de bestanden) daarna op GitHub Pages aan zoals
gewoonlijk.

**Cache van de cadeaulijst wissen:** dev-pagina → paneel *🎁 Cadeaus-cache wissen* → knop. Daarna haalt de
cadeaus-pagina alle plaatjes en prijzen opnieuw op (browser én Worker-cache). Je cadeaus en foto's blijven staan.
Een verkeerd automatisch gekozen plaatje verwijder je per cadeau via bewerken → foto verwijderen.

**G. bol.com betrouwbaar: de officiële, gratis bol-API (aanbevolen voor bol).**
bol blokkeert alle automatische bezoeken; dit omzeilt dat netjes via bol's eigen API
(productnaam, plaatje én prijs, op basis van het productnummer in de link). Kosten: niets.
1. Meld je aan voor het gratis bol.com Partnerprogramma (partner.bol.com; goedkeuring kan even duren).
2. Log in op login.bol.com → *Account* → blok **Open API** → *Toevoegen* → kopieer de **Client ID**
   en klik *Toon secret* voor de **Client Secret**.
3. Cloudflare → de **gifts**-Worker → *Settings* → *Variables and Secrets* → twee Secrets toevoegen:
   `BOL_CLIENT_ID` en `BOL_CLIENT_SECRET` → *Deploy*.
4. Test met `/gifts/debug?url=<bol-link>`: `bolApiKeysPresent` moet `true` zijn en bij de stap
   `bol-api` staan de statuscodes (token / toEan / detail / media / offer).

**F. Optioneel voor plaatjes van winkels die de Worker blokkeren (bol.com, HEMA, ...).**
Dan vraagt de Worker het plaatje aan microlink.io. Zonder sleutel gebruikt hij het gratis
adres (beperkt); met een gratis sleutel (microlink.io → account → API key) krijg je meer
ruimte. Instellen, precies zo:

1. Cloudflare → *Workers & Pages* → de **gifts**-Worker → *Settings* → *Variables and Secrets*.
2. *Add* → Type **Secret**, naam exact `MICROLINK_API_KEY` (hoofdletters, met underscore),
   waarde = je sleutel (zonder spaties). *Deploy*.
   Heb je een tweede sleutel (ander account)? Zet die als Secret `MICROLINK_API_KEY_BACKUP`: de Worker
   gebruikt hem automatisch zodra de eerste sleutel zijn quotum (429) bereikt heeft. Per productlink wordt
   één microlink-aanroep gedaan, en alleen als de winkel de Worker zelf blokkeert.
3. Plak de nieuwste `cloudflare/gifts/gifts_worker.js` in die Worker (*Edit code*) en klik *Deploy*.
   Nodig: oudere versies gebruikten het verkeerde microlink-adres, waarmee een sleutel niets deed.
4. Test: open in je browser
   `https://<jouw-gifts-worker>.workers.dev/gifts/debug?url=<volledige productlink>`
   en lees `verdict`, `title`, `price`, `imageUrl` en `steps` (per route: de winkel zelf, microlink,
   de reader r.jina.ai; de sleutel zelf wordt nooit getoond). Staat er `microlinkKeyPresent: false`,
   dan staat het Secret op de verkeerde Worker of is er niet op *Deploy* geklikt.
5. Een eerder mislukt resultaat wordt niet meer 24 uur onthouden; ververs de pagina met Ctrl+F5.
6. Bij een gewone link zonder foto/prijs vraagt de Worker automatisch ook de prijs op en bewaart hij het
   gevonden productplaatje als eigen foto van dat cadeau (telt mee voor de 20 uploads per dag).
   Optioneel: een gratis `JINA_API_KEY` (Secret, zelfde stappen als hierboven) geeft de reader-route meer ruimte.
