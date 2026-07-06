// =================================================================
// SITE CONFIGURATION
// -----------------------------------------------------------------
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
  siteName: 'MySite',

  // Used by the "days together" counter on the home page.
  // Format: YYYY-MM-DD.
  relationshipStartDate: '2021-07-12',

  // Top navigation, rendered on every page that includes a
  // <header class="navbar">. Add a new page? Add a link here too.
  nav: [
    { label: 'Home', href: 'index.html' },
    { label: 'Date Ideeën', href: 'date.html' },
    { label: 'Toernooi', href: 'tournament.html' },
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
      title: 'Bucket List',
      description: 'Dingen die we samen willen doen.',
      emoji: '📝',
      status: 'coming-soon',
    },
    {
      title: 'Onze Foto\u2019s',
      description: 'Een galerij vol herinneringen \u2014 alleen voor jullie twee.',
      href: 'photos.html',
      emoji: '📸',
      status: 'available',
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
      emoji: '🎁',
      status: 'coming-soon',
    },
    {
      title: 'Verrassingen',
      description: 'Nog geheim...',
      emoji: '✨',
      status: 'coming-soon',
    },
  ],

  // Config for the Ticketmaster page (assets/js/modules/ticketmaster.js).
  //
  // IMPORTANT: this is a PUBLIC repo, so this file must never contain the
  // real Ticketmaster API key. Instead, `workerUrl` points at a small
  // serverless proxy (a Cloudflare Worker) that holds the real key as a
  // secret on Cloudflare's side and forwards requests to Ticketmaster.
  // See /cloudflare-worker at the repo root + STAPPENPLAN.md for how to
  // deploy it (~5 minutes, free tier).
  ticketmaster: {
    // Replace with YOUR deployed worker URL after following STAPPENPLAN.md.
    workerUrl: 'https://ticketmaster-proxy.niels-luijten7.workers.dev',

    // ISO 3166-1 country code pre-selected in the country filter dropdown.
    defaultCountry: 'NL',
  },

  // Config for the private photo gallery (assets/js/modules/photo-gallery.js).
  //
  // Just like `ticketmaster` above: NEVER put the real passphrases here.
  // They live only as encrypted secrets on the Cloudflare Worker that
  // guards the private R2 bucket where the actual photos are stored.
  // This file only needs the worker's URL and display labels — see
  // /cloudflare-worker-photos + STAPPENPLAN-FOTOS.md for the full setup.
  photos: {
    // Replace with YOUR deployed worker URL after following STAPPENPLAN-FOTOS.md.
    workerUrl: 'https://photo-gallery.niels-luijten7.workers.dev',

    // Purely cosmetic display names for whoever's passphrase matched
    // ("a" or "b" — the worker never sends real names, just which of the
    // two passphrases was used). Change these to your actual names.
    personLabels: {
      a: 'Niels',
      b: 'Kalina',
    },
  },
};
