// =================================================================
// SITE CONFIGURATION
// The one file you should need to touch for day-to-day content
// changes. Nothing in here is page-specific markup, it's data
// that the JS modules read to render/behave correctly.
//
// This is the main "extension point" of the whole template:
// most new features should start by adding an entry here rather
// than hand-editing HTML in multiple places.
// =================================================================

// -----------------------------------------------------------------
// Helper for the `collectibles.trees` collection below — generates
// `rows * perRow` collectible items by cycling through a small tree
// "species" catalog (kept in sync, visually, with study-timer.js's
// own TREE_CATALOG species — see that file's header for why the
// growing tree itself only ever cycles those same 5 species). Each
// full cycle through the catalog appends a Roman-numeral suffix
// (Appelboom, then Appelboom II once the species comes back around a
// 2nd time, etc.) so every item name stays unique regardless of how
// many rows you configure. Falls back to a plain "#4" style suffix
// past the pre-built Roman numeral list, which only matters for
// unusually large collections (10+ full cycles).
function buildTreeCollectibleItems({ rows, perRow }) {
  const species = [
    { name: 'Appelboom', emoji: '🌳🍎' },
    { name: 'Kersenboom', emoji: '🌳🌸' },
    { name: 'Perenboom', emoji: '🌳🍐' },
    { name: 'Eik', emoji: '🌳🍂' },
    { name: 'Den', emoji: '🌲❄️' },
  ];
  const roman = ['', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  const total = Math.max(0, rows) * Math.max(1, perRow);
  const items = [];
  for (let i = 0; i < total; i += 1) {
    const kind = species[i % species.length];
    const cycle = Math.floor(i / species.length);
    const suffix = cycle < roman.length ? roman[cycle] : `#${cycle + 1}`;
    items.push({
      id: `tree-${i + 1}`,
      name: suffix ? `${kind.name} ${suffix}` : kind.name,
      emoji: kind.emoji,
    });
  }
  return items;
}

export const siteConfig = {
  // Shown in the logo / footer / <title> tags.
  siteName: 'KaliNiels',
  
  relationshipStartDate: '2021-07-12',

  // Top navigation, rendered on every page that includes a
  // <header class="navbar">. Add a new page? Add a link here too.
  nav: [
    { label: 'Home'         , href: 'index.html' },
    { label: 'Lijstje'      , href: 'lijstje.html' },
    { label: 'Ticketmaster' , href: 'ticketmaster.html' },
    // Tussen Ticketmaster en 'Studie Timer' staat in de header ook nog de
    // live "Timer"-klok (assets/partials/header.html, study-timer-badge.js);
    // die is geen pagina en staat dus niet in deze lijst.
    { label: 'Studie Timer' , href: 'timer.html' },
  ],

  // The clickable "hub" cards on the home page. This is the main
  // thing you'll edit as you ship new features:
  //   - status: "available"   -> renders as a clickable link
  //   - status: "coming-soon" -> renders disabled, no link
  // Reorder, add, or remove entries freely; the grid re-flows
  // automatically (see assets/css/components/cards.css).
  pages: [
    {
      title: 'Date Ideeën',
      description: 'Wat gaan we doen vandaag/deze maand?',
      href: 'date.html',
      emoji: '💡',
      status: 'available',
    },
    {
      title: 'Toernooi',
      description: 'Helpt je met kiezen (erg handig)!',
      href: 'tournament.html',
      emoji: '🏆',
      status: 'available',
    },
    {
      title: 'Ticketmaster',
      description: 'Aankomende concerten en ticketverkoop.',
      href: 'ticketmaster.html',
      emoji: '🎟️',
      status: 'available',
    },
    {
      title: 'Onze Foto\u2019s',
      description: 'Onze herinneringen',
      href: 'photos.html',
      emoji: '📸',
      status: 'available',
    },
    {
      title: 'Onze Reizen',
      description: 'Een map van waar we zijn geweest.',
      href: 'reizen.html',
      emoji: '🌍',
      status: 'available',
    },
    {
      title: 'Games',
      description: 'Speel alleen of samen een game.',
      href: 'games-hub.html',
      emoji: '🎮',
      status: 'available',
    },
    {
      title: 'Studie Timer',
      description: 'Studeren met een eigen planning en groeiende beloningsboom.',
      href: 'timer.html',
      emoji: '🌱',
      status: 'available',
    },
    {
      title: 'Lijstje',
      description: 'Samen bijgehouden, altijd in sync.',
      href: 'lijstje.html',
      emoji: '🛒',
      status: 'available',
    },
    {
      title: 'Collecties',
      description: 'Verdiende beloningen sparen en inwisselen.',
      href: 'collections.html',
      emoji: '🗂️',
      status: 'available',
    },
    {
      title: 'Cadeau Ideeën',
      description: 'Voor het volgende cadeautje.',
      href: 'gifts.html',
      emoji: '🎁',
      status: 'available',
    },
    {
      title: 'Recepten',
      description: 'Recepten op soort gerecht, met favorieten.',
      href: 'recepten.html',
      emoji: '🍳',
      status: 'available',
    },
    {
      title: 'AH-Recepten',
      description: 'Allerhande recepten van Albert Heijn, met favorieten.',
      href: 'ah-recepten.html',
      emoji: '🛒',
      status: 'available',
    },
    {
      title: 'Dealtjes',
      description: 'Kortingen en acties per categorie, met dagen.',
      href: 'dealtjes.html',
      emoji: '🏷️',
      status: 'available',
    },
    {
      title: 'TODO Lijst',
      description: 'Met prioriteit per taak.',
      href: 'todo.html',
      emoji: '✅',
      status: 'available',
    },
    {
      title: 'Snack Ratings',
      description: 'Sterren, foto\u2019s en beschrijvingen.',
      href: 'snack-rating.html',
      emoji: '🍿',
      status: 'available',
    },
    {
      title: 'Kleding',
      description: 'Naam, maat, sterren en foto\u2019s.',
      href: 'clothing.html',
      emoji: '👕',
      status: 'available',
    },
    {
      title: 'Verassing',
      description: 'Wacht tot 1 februari...',
      href: 'valentine.html',
      emoji: '❣️',
      status: 'coming-soon',
    },
    {
      title: 'Bucket List',
      description: 'Dingen die we (samen) willen doen.',
      emoji: '📝',
      status: 'coming-soon',
    },
    {
      title: 'Herinneringen',
      description: 'Een tijdlijn van speciale momenten.',
      emoji: '📅',
      status: 'coming-soon',
    },
    {
      title: 'Speellijst',
      description: 'Onze muziek, samen gemaakt.',
      emoji: '🎵',
      status: 'coming-soon',
    },
    {
      title: 'Verrassingen',
      description: 'Nog geheim...',
      emoji: '✨',
      status: 'coming-soon',
    },
  ],

  // Extra rows shown (disabled, with a "Binnenkort" badge) in the
  // settings dropdown (⚙️, top right of every page), underneath the
  // two working settings (donkere modus + kleurthema, which are
  // plain HTML + assets/js/modules/theme.js, not driven from here).
  //
  // See settings-dropdown.js's "EXTENDING" comment for how
  // to turn one of these into a real, working setting later.
  settings: [
    // { label: 'Taal', emoji: '🌐' },
    // { label: 'Lettergrootte', emoji: '🔠' },
  ],

  // Config for the Ticketmaster page (assets/js/modules/ticketmaster.js).
  // See ACTION-EXPANSION-PLAN.md for setup.
  ticketmaster: {
    workerUrl: 'https://ticketmaster-proxy.niels-luijten7.workers.dev',
    defaultCountry: 'NL',
    // Separate small Worker that stores the shared "Favorieten" artist
    // list (see cloudflare/ticketmaster_favorite-artists). Not the same
    // Worker as workerUrl above — that one only proxies Ticketmaster
    // itself and has no storage of its own.
    favoriteArtistsWorkerUrl: 'https://favorite-artists.niels-luijten7.workers.dev',
  },

  // Config for the private photo gallery (assets/js/modules/photo-gallery.js)
  // AND for the "Onze Reizen" country view (assets/js/modules/reizen-land.js),
  // which reuses this exact same Worker's public /travel endpoint plus
  // the logged-in session for showing real thumbnails per city.
  // See cloudflare/gallery/ + ACTION-EXPANSION-PLAN.md for setup.
  photos: {
    workerUrl: 'https://photo-gallery.niels-luijten7.workers.dev',
    personLabels: {
      a: 'Niels',
      b: 'Kalina',
    },
  },

  // Config for the synced shopping list (assets/js/modules/lijstje.js).
  // See cloudflare/lijstje/ for setup.
  shoppingList: {
    workerUrl: 'https://lijstje.niels-luijten7.workers.dev',
  },

  // Config for the gift ideas lists (assets/js/modules/gifts.js).
  // See cloudflare/gifts/ for setup. No login (same as shoppingList
  // above) — 'a' = Niels (right column), 'b' = Kalina (left column).
  gifts: {
    workerUrl: 'https://gifts.niels-luijten7.workers.dev',
    personLabels: {
      a: 'Niels',
      b: 'Kalina',
    },
  },

  // Config for the Recepten page (assets/js/modules/recepten.js).
  // See cloudflare/recepten/ + ACTION-EXPANSION-PLAN.md for setup. No
  // login — same reasoning as shoppingList/gifts/todo above; the
  // shared "favorites" list lives on this same Worker.
  //
  // `categories` is the curated menu of "soort gerecht" tabs shown on
  // the page — THIS is the file to edit to add/remove/rename a
  // category or its subcategories, no Worker redeploy needed:
  //   - id:    used internally, keep it unique
  //   - label: what's shown on the tab/chip
  //   - emoji: shown next to the label (optional)
  //   - type:  slug sent to the recipes Worker, which maps it to
  //            TheMealDB categories/cuisines/ingredients (see TYPE_SOURCES
  //            in cloudflare/recepten/recepten_worker.js — a NEW slug needs
  //            an entry there, otherwise it is used as a plain search word).
  //   - subcategories: optional list of { id, label, query } chips
  //            shown once this category is active ("Alles" is added
  //            automatically) — `query` is just extra free text
  //            combined with `type` when asking the Worker; Dutch words
  //            are translated to English by the Worker (NL_TO_EN there),
  //            unknown words are passed through unchanged.
  recipes: {
    workerUrl: 'https://recepten.niels-luijten7.workers.dev',
    categories: [
      {
        id: 'pasta', label: 'Pasta', emoji: '🍝', type: 'pasta',
        subcategories: [
          { id: 'kip', label: 'Met kip', query: 'kip' },
          { id: 'vegetarisch', label: 'Vegetarisch', query: 'vegetarisch' },
          { id: 'romig', label: 'Romig', query: 'romig' },
          { id: 'oven', label: 'Ovenpasta', query: 'ovenpasta' },
        ],
      },
      {
        id: 'rijst', label: 'Rijst', emoji: '🍚', type: 'rijst',
        subcategories: [
          { id: 'nasi', label: 'Nasi', query: 'nasi' },
          { id: 'risotto', label: 'Risotto', query: 'risotto' },
          { id: 'curry', label: 'Curry', query: 'curry' },
          { id: 'wok', label: 'Wok', query: 'wok' },
        ],
      },
      {
        id: 'taco', label: 'Taco\u2019s', emoji: '🌮', type: 'taco',
        subcategories: [
          { id: 'kip', label: 'Kip', query: 'kip' },
          { id: 'gehakt', label: 'Gehakt', query: 'gehakt' },
          { id: 'vegetarisch', label: 'Vegetarisch', query: 'vegetarisch' },
          { id: 'vis', label: 'Vis', query: 'vis' },
        ],
      },
      {
        id: 'wrap', label: 'Wrap\u2019s', emoji: '🌯', type: 'wrap',
        subcategories: [
          { id: 'kip', label: 'Kip', query: 'kip' },
          { id: 'falafel', label: 'Falafel', query: 'falafel' },
          { id: 'burrito', label: 'Burrito', query: 'burrito' },
          { id: 'vegetarisch', label: 'Vegetarisch', query: 'vegetarisch' },
        ],
      },
      {
        id: 'salade', label: 'Salade', emoji: '🥗', type: 'salade',
        subcategories: [
          { id: 'pasta', label: 'Pastasalade', query: 'pasta' },
          { id: 'kip', label: 'Met kip', query: 'kip' },
          { id: 'zomer', label: 'Zomers', query: 'zomer' },
        ],
      },
      {
        id: 'soep', label: 'Soep', emoji: '🍲', type: 'soep',
        subcategories: [
          { id: 'tomaat', label: 'Tomaat', query: 'tomaat' },
          { id: 'kip', label: 'Met kip', query: 'kip' },
          { id: 'vegetarisch', label: 'Vegetarisch', query: 'vegetarisch' },
        ],
      },
      {
        id: 'ovenschotel', label: 'Ovenschotel', emoji: '🍛', type: 'ovenschotel',
        subcategories: [
          { id: 'aardappel', label: 'Aardappel', query: 'aardappel' },
          { id: 'gehakt', label: 'Gehakt', query: 'gehakt' },
          { id: 'kip', label: 'Kip', query: 'kip' },
        ],
      },
      {
        id: 'aardappel', label: 'Aardappel', emoji: '🥔', type: 'aardappel',
        subcategories: [
          { id: 'puree', label: 'Pur\u00e9e', query: 'puree' },
          { id: 'gebakken', label: 'Gebakken', query: 'gebakken' },
          { id: 'salade', label: 'Salade', query: 'salade' },
        ],
      },
      // --- Toegevoegd: Aziatisch, Sushi + verschillende soorten vlees
      // (en, voor de symmetrie, vis/vegetarisch erbij) — zie punt 2.
      // `type` is best-effort: als AH's eigen soort-gerecht-filter deze
      // slug niet herkent, valt recepten_worker.js vanzelf terug op een
      // gewone trefwoordzoekopdracht (zie dat bestand se eigen comments),
      // dus zelfs een net-niet-goede slug levert nog steeds bruikbare
      // resultaten op.
      {
        id: 'aziatisch', label: 'Aziatisch', emoji: '🥢', type: 'aziatisch',
        subcategories: [
          { id: 'wok', label: 'Wok', query: 'wok' },
          { id: 'curry', label: 'Curry', query: 'curry' },
          { id: 'noedels', label: 'Noedels', query: 'noedels' },
          { id: 'rijst', label: 'Rijst', query: 'rijst' },
        ],
      },
      {
        id: 'sushi', label: 'Sushi', emoji: '🍣', type: 'sushi',
        subcategories: [
          { id: 'zalm', label: 'Zalm', query: 'zalm' },
          { id: 'maki', label: 'Maki', query: 'maki' },
          { id: 'vegetarisch', label: 'Vegetarisch', query: 'vegetarisch' },
        ],
      },
      {
        id: 'vlees', label: 'Vlees', emoji: '🥩', type: 'vlees',
        subcategories: [
          { id: 'kip', label: 'Kip', query: 'kip' },
          { id: 'rund', label: 'Rund', query: 'rundvlees' },
          { id: 'varken', label: 'Varken', query: 'varkensvlees' },
          { id: 'gehakt', label: 'Gehakt', query: 'gehakt' },
          { id: 'lam', label: 'Lam', query: 'lamsvlees' },
        ],
      },
      {
        id: 'vis', label: 'Vis', emoji: '🐟', type: 'vis',
        subcategories: [
          { id: 'zalm', label: 'Zalm', query: 'zalm' },
          { id: 'garnalen', label: 'Garnalen', query: 'garnalen' },
          { id: 'kabeljauw', label: 'Kabeljauw', query: 'kabeljauw' },
        ],
      },
      {
        id: 'vegetarisch', label: 'Vegetarisch', emoji: '🥦', type: 'vegetarisch',
        subcategories: [
          { id: 'vegan', label: 'Vegan', query: 'vegan' },
          { id: 'peulvruchten', label: 'Peulvruchten', query: 'peulvruchten' },
          { id: 'groente', label: 'Groente', query: 'groenteschotel' },
        ],
      },
      {
        id: 'airfryer', label: 'Airfryer', emoji: '🍟', type: 'airfryer',
        subcategories: [
          { id: 'kip', label: 'Kip', query: 'kip' },
          { id: 'groente', label: 'Groente', query: 'groente' },
          { id: 'aardappel', label: 'Aardappel', query: 'aardappel' },
          { id: 'vis', label: 'Vis', query: 'vis' },
        ],
      },
    ],
  },

  // Config for the AH-Recepten page (assets/js/modules/ah-recepten.js).
  // See cloudflare/ah-recepten/ + ACTION-EXPANSION-PLAN.md for setup.
  // No login — same reasoning as shoppingList/gifts/todo above; the
  // shared "favorites" list lives on this same Worker. This is the
  // ORIGINAL Albert Heijn / Allerhande version — see `recipes` above
  // for the separate TheMealDB-backed page (recepten.html) that
  // exists alongside it.
  //
  // `categories` is the curated menu of "soort gerecht" tabs shown on
  // the page — THIS is the file to edit to add/remove/rename a
  // category or its subcategories, no Worker redeploy needed:
  //   - id:    used internally, keep it unique
  //   - label: what's shown on the tab/chip
  //   - emoji: shown next to the label (optional)
  //   - type:  the value sent to AH's own "soort-gerecht" filter as-is
  //            (ah_recepten_worker.js falls back to a plain keyword
  //            search when AH doesn't recognize it — see that file).
  //   - subcategories: optional list of { id, label, query } chips
  //            shown once this category is active ("Alles" is added
  //            automatically) — `query` is just extra free text
  //            combined with `type` when asking the Worker, so any
  //            word AH's own search understands works here.
  ahRecipes: {
    workerUrl: 'https://ah-recepten.niels-luijten7.workers.dev',
    categories: [
      {
        id: 'pasta', label: 'Pasta', emoji: '🍝', type: 'pasta',
        subcategories: [
          { id: 'kip', label: 'Met kip', query: 'kip' },
          { id: 'vegetarisch', label: 'Vegetarisch', query: 'vegetarisch' },
          { id: 'romig', label: 'Romig', query: 'romig' },
          { id: 'oven', label: 'Ovenpasta', query: 'ovenpasta' },
        ],
      },
      {
        id: 'rijst', label: 'Rijst', emoji: '🍚', type: 'rijst',
        subcategories: [
          { id: 'nasi', label: 'Nasi', query: 'nasi' },
          { id: 'risotto', label: 'Risotto', query: 'risotto' },
          { id: 'curry', label: 'Curry', query: 'curry' },
          { id: 'wok', label: 'Wok', query: 'wok' },
        ],
      },
      {
        id: 'taco', label: 'Taco\u2019s', emoji: '🌮', type: 'taco',
        subcategories: [
          { id: 'kip', label: 'Kip', query: 'kip' },
          { id: 'gehakt', label: 'Gehakt', query: 'gehakt' },
          { id: 'vegetarisch', label: 'Vegetarisch', query: 'vegetarisch' },
          { id: 'vis', label: 'Vis', query: 'vis' },
        ],
      },
      {
        id: 'wrap', label: 'Wrap\u2019s', emoji: '🌯', type: 'wrap',
        subcategories: [
          { id: 'kip', label: 'Kip', query: 'kip' },
          { id: 'falafel', label: 'Falafel', query: 'falafel' },
          { id: 'burrito', label: 'Burrito', query: 'burrito' },
          { id: 'vegetarisch', label: 'Vegetarisch', query: 'vegetarisch' },
        ],
      },
      {
        id: 'salade', label: 'Salade', emoji: '🥗', type: 'salade',
        subcategories: [
          { id: 'pasta', label: 'Pastasalade', query: 'pasta' },
          { id: 'kip', label: 'Met kip', query: 'kip' },
          { id: 'zomer', label: 'Zomers', query: 'zomer' },
        ],
      },
      {
        id: 'soep', label: 'Soep', emoji: '🍲', type: 'soep',
        subcategories: [
          { id: 'tomaat', label: 'Tomaat', query: 'tomaat' },
          { id: 'kip', label: 'Met kip', query: 'kip' },
          { id: 'vegetarisch', label: 'Vegetarisch', query: 'vegetarisch' },
        ],
      },
      {
        id: 'ovenschotel', label: 'Ovenschotel', emoji: '🍛', type: 'ovenschotel',
        subcategories: [
          { id: 'aardappel', label: 'Aardappel', query: 'aardappel' },
          { id: 'gehakt', label: 'Gehakt', query: 'gehakt' },
          { id: 'kip', label: 'Kip', query: 'kip' },
        ],
      },
      {
        id: 'aardappel', label: 'Aardappel', emoji: '🥔', type: 'aardappel',
        subcategories: [
          { id: 'puree', label: 'Pur\u00e9e', query: 'puree' },
          { id: 'gebakken', label: 'Gebakken', query: 'gebakken' },
          { id: 'salade', label: 'Salade', query: 'salade' },
        ],
      },
      // --- Toegevoegd: Aziatisch, Sushi + verschillende soorten vlees
      // (en, voor de symmetrie, vis/vegetarisch erbij) — zie punt 2.
      // `type` is best-effort: als AH's eigen soort-gerecht-filter deze
      // slug niet herkent, valt recepten_worker.js vanzelf terug op een
      // gewone trefwoordzoekopdracht (zie dat bestand se eigen comments),
      // dus zelfs een net-niet-goede slug levert nog steeds bruikbare
      // resultaten op.
      {
        id: 'aziatisch', label: 'Aziatisch', emoji: '🥢', type: 'aziatisch',
        subcategories: [
          { id: 'wok', label: 'Wok', query: 'wok' },
          { id: 'curry', label: 'Curry', query: 'curry' },
          { id: 'noedels', label: 'Noedels', query: 'noedels' },
          { id: 'rijst', label: 'Rijst', query: 'rijst' },
        ],
      },
      {
        id: 'sushi', label: 'Sushi', emoji: '🍣', type: 'sushi',
        subcategories: [
          { id: 'zalm', label: 'Zalm', query: 'zalm' },
          { id: 'maki', label: 'Maki', query: 'maki' },
          { id: 'vegetarisch', label: 'Vegetarisch', query: 'vegetarisch' },
        ],
      },
      {
        id: 'vlees', label: 'Vlees', emoji: '🥩', type: 'vlees',
        subcategories: [
          { id: 'kip', label: 'Kip', query: 'kip' },
          { id: 'rund', label: 'Rund', query: 'rundvlees' },
          { id: 'varken', label: 'Varken', query: 'varkensvlees' },
          { id: 'gehakt', label: 'Gehakt', query: 'gehakt' },
          { id: 'lam', label: 'Lam', query: 'lamsvlees' },
        ],
      },
      {
        id: 'vis', label: 'Vis', emoji: '🐟', type: 'vis',
        subcategories: [
          { id: 'zalm', label: 'Zalm', query: 'zalm' },
          { id: 'garnalen', label: 'Garnalen', query: 'garnalen' },
          { id: 'kabeljauw', label: 'Kabeljauw', query: 'kabeljauw' },
        ],
      },
      {
        id: 'vegetarisch', label: 'Vegetarisch', emoji: '🥦', type: 'vegetarisch',
        subcategories: [
          { id: 'vegan', label: 'Vegan', query: 'vegan' },
          { id: 'peulvruchten', label: 'Peulvruchten', query: 'peulvruchten' },
          { id: 'groente', label: 'Groente', query: 'groenteschotel' },
        ],
      },
      {
        id: 'airfryer', label: 'Airfryer', emoji: '🍟', type: 'airfryer',
        subcategories: [
          { id: 'kip', label: 'Kip', query: 'kip' },
          { id: 'groente', label: 'Groente', query: 'groente' },
          { id: 'aardappel', label: 'Aardappel', query: 'aardappel' },
          { id: 'vis', label: 'Vis', query: 'vis' },
        ],
      },
      // Alleen AH-vers-pakketten. Geen subcategorieën. `type` is best-effort,
      // zoals bij de andere categorieën (valt anders terug op trefwoord 'verspakket').
      {
        id: 'verspakket', label: 'Vers pakket', emoji: '📦', type: 'verspakket',
        subcategories: [],
      },
    ],
  },

  // =================================================================
  // COLLECTIBLES / REWARDS (timer.html -> collections.html)
  // -----------------------------------------------------------------
  // Central config for the whole "earn collectibles, unlock a real
  // gift" system. See assets/js/modules/collectibles.js for the
  // persistence/reward-math this config drives, collections.html +
  // assets/js/modules/collections.js for the page that displays it,
  // and study-timer.js's showTreeCompleted() for where a Tree
  // collectible actually gets earned (one per fully-grown tree).
  //
  // THIS IS THE ONLY FILE YOU SHOULD NEED TO TOUCH TO:
  //   - change how many euros one collectible is "worth"
  //   - add a brand new collection (Trees is just the first one)
  //   - change how many collectibles a collection has, or its grid
  //   - add/remove reward rows (and their fallback price) per collection
  //
  // Collected counts + which gift is chosen per reward row are runtime
  // DATA, not config — that lives in localStorage per logged-in person,
  // same as the Studie Timer's own state (see collectibles.js).
  // =================================================================
  collectibles: {
    // What a single collectible is worth, in whole euros. Used by
    // EVERY collection's reward math unless that collection sets its
    // own `valueEUR` below. Reward unlock rule (see collectibles.js
    // computeRewardProgress()):
    //   collectedCount * collectibleValueEUR >= gift.price
    collectibleValueEUR: 5,

    // Shown for a reward row that has no gift selected yet, or whose
    // selected gift can no longer be found (e.g. deleted on
    // gifts.html) and was never actually unlocked. {price} is that
    // reward row's own fallbackPriceEUR.
    fallbackGiftLabel: (price) => `€${price} cadeaubon`,

    collections: [
      {
        id: 'trees',
        name: 'Bomen',
        emoji: '🌳',
        description: 'Elke boom die je in de Studie Timer helemaal laat groeien, komt hier in je collectie terecht.',
        // Purely informational — shown as a "waar verdien ik dit?" hint
        // + link on the Collections page for collections that are fed
        // by another page rather than earned directly there.
        source: { label: 'Studie Timer', href: 'timer.html' },
        // How many collectible "slots" this collection has, laid out
        // in rows of `itemsPerRow` on the Collections page. Change
        // rows/itemsPerRow here to resize the whole grid — items are
        // generated below from a small tree-species catalog, cycling
        // through it with a Roman-numeral suffix (Appelboom, Appelboom
        // II, ...) so growing the grid never means hand-writing more
        // entries one by one.
        itemsPerRow: 7,
        items: buildTreeCollectibleItems({ rows: 3, perRow: 7 }),
        // Multiple reward rows are just multiple entries here — add or
        // remove freely, in any price order (they don't need to be
        // ascending, though that reads best). `giftId` can be left
        // null (the normal case: pick the gift from the Collections
        // page, or via the 🎯 button on a gift's own card in Cadeau
        // Ideeën instead) or hard-set to a known gift id if you
        // already have one. `fallbackPriceEUR` is what's used for the
        // unlock math and the "€X cadeaubon" placeholder for as long
        // as no real gift is selected (or the selected one vanished).
        rewards: [
          { id: 'reward-1', giftId: null, fallbackPriceEUR: 25 },
          { id: 'reward-2', giftId: null, fallbackPriceEUR: 60 },
          { id: 'reward-3', giftId: null, fallbackPriceEUR: 100 },
        ],
      },

      // Second collection: Planten. Same shape as Trees above, just
      // nothing feeds it yet — there's no "grow a plant" feature on
      // the site to earn these from (unlike Trees, fed by the Studie
      // Timer), so `source.label` is left as the literal placeholder
      // "X" until a real feature exists to link here. Swap items /
      // rewards / source for the real thing whenever that's built —
      // this collection (and its "Planten" tab on collections.html)
      // works exactly like Trees the moment `items` isn't empty.
      {
        id: 'plants',
        name: 'Planten',
        emoji: '🌱',
        description: 'Elke plant die je in de X helemaal laat groeien, komt hier in je collectie terecht.',
        source: { label: 'X', href: '#' },
        itemsPerRow: 7,
        items: [
          { id: 'plant-1', name: 'Zonnebloem', emoji: '🌱🌻' },
          { id: 'plant-2', name: 'Tulp', emoji: '🌱🌷' },
          { id: 'plant-3', name: 'Cactus', emoji: '🌱🌵' },
          { id: 'plant-4', name: 'Klaver', emoji: '🌱🍀' },
        ],
        rewards: [
          { id: 'reward-1', giftId: null, fallbackPriceEUR: 25 },
        ],
      },

      // Add further collections here the same way — e.g.:
      // {
      //   id: 'stars',
      //   name: 'Sterren',
      //   emoji: '⭐',
      //   description: 'Verdien sterren door ... .',
      //   source: { label: '...', href: '...' },
      //   itemsPerRow: 7,
      //   items: [
      //     { id: 'star-1', name: 'Sterretje I', emoji: '⭐' },
      //     // ...
      //   ],
      //   rewards: [
      //     { id: 'reward-1', giftId: null, fallbackPriceEUR: 20 },
      //   ],
      // },
    ],
  },

  // Config for the TODO list (assets/js/modules/todo.js).
  // See cloudflare/todo/ for setup. Same no-login reasoning and
  // the same 'a' = Niels (right column) / 'b' = Kalina (left column)
  // convention as `gifts` above.
  todo: {
    workerUrl: 'https://todo-lijst.niels-luijten7.workers.dev',
    personLabels: {
      a: 'Niels',
      b: 'Kalina',
    },
  },

  // Config for the snack ratings list (assets/js/modules/snack-rating.js).
  // See cloudflare/rating/ for setup. Same conventions as `todo` above.
  snackRatings: {
    workerUrl: 'https://snack-ratings.niels-luijten7.workers.dev',
    personLabels: {
      a: 'Niels',
      b: 'Kalina',
    },
  },

  // Config for the clothing ratings list (assets/js/modules/clothing.js).
  // Same pattern/setup as `snackRatings` above, just its own Worker +
  // KV namespace — see cloudflare/clothing/.
  clothing: {
    workerUrl: 'https://clothing.niels-luijten7.workers.dev',
    personLabels: {
      a: 'Niels',
      b: 'Kalina',
    },
  },

  // Config for the Dealtjes page (assets/js/modules/dealtjes.js).
  // Opslag: één Worker + KV-namespace (zie cloudflare/dealtjes/ en
  // ACTION-EXPANSION-PLAN.md §2.11). De Worker moet 'dealtjes' heten
  // (wrangler.toml) om op deze URL te staan. Bevat workerUrl hieronder
  // 'YOUR-SUBDOMAIN', dan slaat de pagina alles alleen op in dit ene
  // apparaat/browser (localStorage).
  //
  // `templates` = de keuzelijst "wat voor soort items?" bij het aanmaken
  // van een nieuwe categorie. Elk veld heeft:
  //   - label:   wat er boven het invulveld / op de kaart staat
  //   - type:    'text' | 'longtext' | 'link' | 'image' | 'days' | 'tags'
  //   - visible: false = wel invulbaar, maar niet getoond op de kaart
  // Een categorie kopieert het gekozen sjabloon bij het aanmaken en kan
  // daarna op de pagina zelf (✏️ bij de categorie) worden aangepast:
  // velden toevoegen, hernoemen, verplaatsen, verbergen of verwijderen.
  // Nieuw soort sjabloon nodig? Voeg hier gewoon een entry toe.
  dealtjes: {
    workerUrl: 'https://dealtjes.niels-luijten7.workers.dev',
    templates: [
      {
        id: 'deal',
        emoji: '🏷️',
        label: 'Dealtje',
        description: 'Naam, logo, link, beschrijving en dagen',
        fields: [
          { label: 'Naam', type: 'text', visible: true },
          { label: 'Logo', type: 'image', visible: true },
          { label: 'Link', type: 'link', visible: true },
          { label: 'Beschrijving', type: 'longtext', visible: true },
          { label: 'Dagen', type: 'days', visible: true },
        ],
      },
      {
        id: 'logo',
        emoji: '🖼️',
        label: 'Logo + link',
        description: 'Alleen een logo met een link erbij',
        fields: [
          { label: 'Naam', type: 'text', visible: false },
          { label: 'Logo', type: 'image', visible: true },
          { label: 'Link', type: 'link', visible: true },
        ],
      },
      {
        id: 'tekst',
        emoji: '📝',
        label: 'Tekst',
        description: 'Een titel met een beschrijving',
        fields: [
          { label: 'Titel', type: 'text', visible: true },
          { label: 'Beschrijving', type: 'longtext', visible: true },
        ],
      },
      {
        id: 'leeg',
        emoji: '🧩',
        label: 'Zelf samenstellen',
        description: 'Begin met alleen een naam en bouw zelf verder',
        fields: [
          { label: 'Naam', type: 'text', visible: true },
        ],
      },
    ],
  },

  // Config for the shared chip balance used by BlackJack
  // (assets/js/modules/blackjack.js) and Spiderette
  // (assets/js/modules/spiderette.js). See cloudflare/chips/ +
  // ACTION-EXPANSION-PLAN.md for setup. Login itself happens once,
  // site-wide, via the header's "👤 Profiel" dropdown
  // (assets/js/modules/auth.js) — this Worker only needs to recognise
  // that shared session's token, so its TOKEN_SECRET / PASSPHRASE_A /
  // PASSPHRASE_B secrets must match the "photo-gallery" Worker's
  // exactly (see auth.js's file header for why). Display names come
  // from `photos.personLabels` above, not repeated here.
  //
  // IMPORTANT — this worker is deliberately GAME-AGNOSTIC: its /chips
  // endpoint stores one balance per PERSON ("a"/"b"), not per game (see
  // cloudflare/chips/chips_worker.js's file header). Any game's module
  // can read/spend/win the exact same shared balance just by pointing
  // its own `workerUrl` entry at this same URL — that's all
  // `blackjack` and `spiderette` below are doing. Adding a new
  // chip-based game later should follow the same pattern: add
  // `<newGame>: { workerUrl: 'https://blackjack.niels-luijten7.workers.dev' }`
  // here (same URL, no other setup needed) rather than inventing a new
  // worker/KV namespace for it — that's what keeps every game's chips
  // automatically in sync with each other.
  blackjack: {
    workerUrl: 'https://blackjack.niels-luijten7.workers.dev',
  },

  // Spiderette's shared chip balance (assets/js/modules/spiderette.js)
  // + "special" card art config. Reuses the exact same Worker as
  // `blackjack` above by design — see the note there.
  spiderette: {
    workerUrl: 'https://blackjack.niels-luijten7.workers.dev',
  },

  // Config for the dev page (dev.html/assets/js/modules/dev.js) — a
  // hidden admin/testing page (not linked in nav, not in `pages`
  // below, not in the sitemap; reachable only by typing the URL) for
  // quickly tweaking chips, collectibles progress, and reward state
  // while building/testing, instead of hand-editing localStorage or
  // the Cloudflare KV dashboard every time.
  //
  // ITS OWN LOGIN: deliberately separate from the shared "👤 Profiel"
  // site login (auth.js) — this page only reads/writes per-browser
  // localStorage directly (no Worker of its own), so a lightweight
  // client-side password is enough here. IMPORTANT: this is NOT a
  // real security boundary — anyone who opens this file (or the
  // browser's dev tools) can read the password below, same as any
  // other purely client-side check. It's meant to keep the page off
  // the beaten path for casual visitors, not to protect anything
  // sensitive; don't put anything here you wouldn't want visible to
  // someone determined to look at the page's source.
  //
  // The Chips section on that page is the one exception that DOES
  // touch a Worker (cloudflare/chips/chips_worker.js, same one as
  // `blackjack`/`spiderette` above) — it reuses whatever "👤 Profiel"
  // session is already active (see auth.js) rather than asking for
  // another login, since that Worker only ever lets a token adjust
  // its OWN person's balance (see that Worker's file header).
  dev: {
    password: 'admin-ww',
  },
};
