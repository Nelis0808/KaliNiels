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
      description: 'Wat gaan we doen vandaag?',
      href: 'date.html',
      emoji: '💡',
      status: 'available',
    },
    {
      title: 'Toernooi',
      description: 'Kan je niet kiezen? Laat opties het tegen elkaar opnemen.',
      href: 'tournament.html',
      emoji: '🏆',
      status: 'available',
    },
    {
      title: 'Ticketmaster',
      description: 'Aankomende concerten en ticketverkoop, live van Ticketmaster.',
      href: 'ticketmaster.html',
      emoji: '🎟️',
      status: 'available',
    },
    {
      title: 'Onze Foto\u2019s',
      description: 'Een galerij vol herinneringen!',
      href: 'photos.html',
      emoji: '📸',
      status: 'available',
    },
    {
      title: 'Games',
      description: 'Speel samen een potje, direct in de browser.',
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
      title: 'Bucket List',
      description: 'Dingen die we samen willen doen.',
      emoji: '📝',
      status: 'coming-soon',
    },
    {
      title: 'Reis Ideeën',
      description: 'Waar gaan we naartoe?',
      emoji: '✈️',
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
      title: 'Cadeau Ideeën',
      description: 'Voor de volgende gelegenheid.',
      href: 'gifts.html',
      emoji: '🎁',
      status: 'available',
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

  // Config for the private photo gallery (assets/js/modules/photo-gallery.js).
  // PHOTO_GALLERY.md for usage.
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

  // Config for BlackJack's optional login + saved chip balance
  // (assets/js/modules/blackjack.js). STAPPENPLAN-BLACKJACK.md for usage.
  blackjack: {
    workerUrl: 'https://blackjack.niels-luijten7.workers.dev',
    personLabels: {
      a: 'Niels',
      b: 'Kalina',
    },
  },

  // Config for Spiderette's optional login (assets/js/modules/spiderette.js).
  // Unlike BlackJack there's no balance to save here — logging in only
  // switches to the "special" card art (aces/faces) — so this simply
  // reuses the same BlackJack Worker's /login endpoint (same
  // passphrases, independent session/localStorage key though).
  spiderette: {
    workerUrl: 'https://blackjack.niels-luijten7.workers.dev',
    personLabels: {
      a: 'Niels',
      b: 'Kalina',
    },
  },
};
