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

export const siteConfig = {
  // Shown in the logo / footer / <title> tags.
  siteName: 'KaliNiels',
  
  relationshipStartDate: '2021-07-12',

  // Top navigation, rendered on every page that includes a
  // <header class="navbar">. Add a new page? Add a link here too.
  nav: [
    { label: 'Home'         , href: 'index.html' },
    { label: 'Date Ideeën'  , href: 'date.html' },
    { label: 'Ticketmaster' , href: 'ticketmaster.html' },
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
      title: 'Boodschappenlijstje',
      description: 'Samen bijgehouden, altijd in sync.',
      href: 'boodschappenlijst.html',
      emoji: '🛒',
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
    { label: 'Meldingen', emoji: '🔔' },
  ],

  // Config for the Ticketmaster page (assets/js/modules/ticketmaster.js).
  // STAPPENPLAN.md for usage.
  ticketmaster: {
    workerUrl: 'https://ticketmaster-proxy.niels-luijten7.workers.dev',
    defaultCountry: 'NL',
  },

  // Config for the private photo gallery (assets/js/modules/photo-gallery.js)
  // AND for the "Onze Reizen" country view (assets/js/modules/reizen-land.js),
  // which reuses this exact same Worker's public /travel endpoint plus
  // the logged-in session for showing real thumbnails per city.
  // PHOTO_GALLERY.md / STAPPENPLAN-REIZEN.md for usage.
  photos: {
    workerUrl: 'https://photo-gallery.niels-luijten7.workers.dev',
    personLabels: {
      a: 'Niels',
      b: 'Kalina',
    },
  },

  // Config for the synced shopping list (assets/js/modules/boodschappenlijst.js).
  // STAPPENPLAN-BOODSCHAPPEN.md for usage.
  shoppingList: {
    workerUrl: 'https://boodschappenlijst.niels-luijten7.workers.dev',
  },

  // Config for the gift ideas lists (assets/js/modules/gifts.js).
  // STAPPENPLAN-GIFTS.md for usage. No login (same as shoppingList
  // above) — 'a' = Niels (right column), 'b' = Kalina (left column).
  gifts: {
    workerUrl: 'https://gifts.niels-luijten7.workers.dev',
    personLabels: {
      a: 'Niels',
      b: 'Kalina',
    },
  },

  // Config for the shared chip balance used by BlackJack
  // (assets/js/modules/blackjack.js) and Spiderette
  // (assets/js/modules/spiderette.js). STAPPENPLAN-BLACKJACK.md for
  // usage. Login itself happens once, site-wide, via the header's
  // "👤 Profiel" dropdown (assets/js/modules/auth.js) — this Worker
  // only needs to recognise that shared session's token, so its
  // TOKEN_SECRET / PASSPHRASE_A / PASSPHRASE_B secrets must match the
  // "photo-gallery" Worker's exactly (see auth.js's file header for
  // why). Display names come from `photos.personLabels` above, not
  // repeated here.
  //
  // IMPORTANT — this worker is deliberately GAME-AGNOSTIC: its /chips
  // endpoint stores one balance per PERSON ("a"/"b"), not per game (see
  // cloudflare/cloudflare-worker-blackjack/worker.js's file header). Any
  // game's module can read/spend/win the exact same shared balance just
  // by pointing its own `workerUrl` entry at this same URL — that's all
  // `blackjack` and `spiderette` below are doing. Adding a new chip-based
  // game later should follow the same pattern: add `<newGame>: {
  // workerUrl: 'https://blackjack.niels-luijten7.workers.dev' }` here
  // (same URL, no other setup needed) rather than inventing a new
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
};
