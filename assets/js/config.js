// =================================================================
// SITE CONFIGURATION
// -----------------------------------------------------------------
// The one file you should need to touch for day-to-day content
// changes. Nothing in here is page-specific markup — it's data
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
      title: 'Bucket List',
      description: 'Dingen die we samen willen doen.',
      emoji: '📝',
      status: 'coming-soon',
    },
    {
      title: 'Onze Foto\u2019s',
      description: 'Een galerij vol herinneringen.',
      emoji: '📸',
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
};
