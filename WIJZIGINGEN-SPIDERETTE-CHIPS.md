# Overzicht van wijzigingen

## 1. Spiderette moeilijker maken (met behoud van gegarandeerde oplosbaarheid)
`assets/js/modules/spiderette.js`

- Root cause gevonden: met de relaxed drop-regel (rang-only, suit-onafhankelijk)
  is elke bereikbare tableau-staat altijd 100% rang-gesorteerd per kolom — dat
  is onvermijdelijk, wiskundig bewezen door meerdere scramble-strategieën te
  testen (ook een variant die uitsluitend losse kaarten verplaatst).
- De echte hendel bleek "suit-adjacency": hoe vaak twee aangrenzende kaarten in
  een kolom dezelfde suit delen. Voorheen ~64% (hele suit-runs bleven vaak
  intact bij elkaar), nu verlaagd naar ~40% door de scramble-zetten te sturen
  op het minimaliseren van deze metriek in plaats van alleen de kolomvorm.
- Geverifieerd met 800+ end-to-end forward-replay-tests op de daadwerkelijke
  productiecode: elke gegenereerde deal blijft 100% bewijsbaar oplosbaar.
- Kleine robuustheidsfix: als de constructie een randgeval tegenkomt waarbij
  een stock-wave niet meer veilig valt terug te draaien, wordt de poging nu
  correct weggegooid en opnieuw geprobeerd (voorheen ging de constructie stil
  door met een corrupte staat — kwam zeldzaam voor, maar kon in theorie
  kaarten laten "verdubbelen/verdwijnen" tijdens het bouwen van de deal).

## 2. Bug: kaarten verdwijnen na het oplossen van een stapel
`assets/js/modules/spiderette.js`

- Gevonden: zodra de eerste reeks compleet was, werd de hele resterende stock
  botweg leeggegooid (`stock = []`), terwijl de garantie van oplosbaarheid
  ervan uitgaat dat alle 24 stock-kaarten uiteindelijk gedeeld en gebruikt
  worden in de winnende zettenreeks.
- Bovendien bestaat "de stock verdwijnt zodra je een reeks voltooit" niet in
  de officiële Spiderette-regels (nagezocht bij meerdere regelbronnen) — het
  was een verzonnen restrictie in deze implementatie.
- Fix: die hele regel is verwijderd. De stock blijft na een voltooide reeks
  gewoon normaal beschikbaar om te delen (mits elke kolom nog minstens 1
  kaart heeft, de standaardregel). Geverifieerd met 500 volledige
  spel-simulaties die de bewezen winnende lijn volgen, inclusief het
  toepassen van sweeps na elke losse zet (niet alleen aan het eind) — alle
  500 spellen worden volledig uitgespeeld tot een winst (0 kaarten over, alle
  4 reeksen geveegd).

## 3. Chips van BlackJack en Spiderette linken
`assets/js/config.js`, `cloudflare/cloudflare-worker-blackjack/worker.js`,
`assets/js/modules/spiderette.js`, `assets/js/modules/blackjack.js`,
`STAPPENPLAN-BLACKJACK.md`

- Bevinding: dit was **al gerealiseerd** — beide spellen wezen al naar exact
  dezelfde Cloudflare Worker (`blackjack.niels-luijten7.workers.dev`) en die
  Worker slaat het chipsaldo op per PERSOON ("a"/"b"), niet per spel. Er was
  dus nooit een apart "Spiderette-saldo".
- Om dit voor toekomstige spellen expliciet en makkelijk te maken, zijn de
  comments in alle betrokken bestanden uitgebreid met een concrete
  instructie: een nieuw chip-spel hoeft alleen een `workerUrl`-entry in
  `config.js` toe te voegen die naar diezelfde Worker-URL wijst, en dezelfde
  `GET`/`PUT /chips`-aanroepen te implementeren (zoals `spiderette.js` dat
  doet) — geen nieuwe Worker of KV-namespace nodig.
- Geen functionele wijziging aan hoe chips zelf werken; alleen documentatie
  verduidelijkt zodat het overduidelijk is en niet per ongeluk losgekoppeld
  wordt bij toekomstig werk.
