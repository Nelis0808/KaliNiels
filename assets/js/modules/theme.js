// =================================================================
// THEME (light/dark mode, and blue/pink color theme)
// -----------------------------------------------------------------
// Two independent toggles, both persisted + applied as attributes
// on <html> (never a class on <body>):
//   data-theme="light" | "dark"        — initTheme()
//   data-color-theme="blue" | "pink"   — initColorTheme()
// All visual rules live in CSS (base/variables.css + dark-mode.css);
// these modules only decide *which* value is active and persist it.
// Because they're separate attributes, either can change without
// touching the other — picking "roze" carries into dark mode too,
// since dark mode never redefines the brand hue tokens itself.
//
// Both toggles now live inside the settings dropdown (see
// settings-dropdown.js) as `.switch` elements (role="switch"),
// instead of the two standalone icon buttons this used to be. This
// module only flips `aria-checked` + the label — the visuals live in
// assets/css/components/settings.css.
//
// EXTENDING: listen for the `themechange` / `colorthemechange`
// events this module fires on `document` if some future feature
// (e.g. a chart library) needs to re-render when a theme flips.
// =================================================================

const STORAGE_KEY = 'theme-preference';
const COLOR_STORAGE_KEY = 'color-theme-preference';

function applyTheme(theme, toggleBtn) {
  document.documentElement.setAttribute('data-theme', theme);

  if (toggleBtn) {
    const isDark = theme === 'dark';
    toggleBtn.setAttribute('aria-checked', String(isDark));
    toggleBtn.setAttribute('aria-label', isDark ?
      'Zet lichte modus aan' : 'Zet donkere modus aan');
  }

  document.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
}

export function initTheme() {
  const toggleBtn = document.getElementById('themeToggle');

  const stored = localStorage.getItem(STORAGE_KEY);
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const initialTheme = stored ?? (systemPrefersDark ? 'dark' : 'light');

  applyTheme(initialTheme, toggleBtn);

  if (!toggleBtn) return; // page has no theme toggle — nothing left to wire up

  toggleBtn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next, toggleBtn);
    localStorage.setItem(STORAGE_KEY, next);
  });
}

function applyColorTheme(colorTheme, toggleBtn) {
  document.documentElement.setAttribute('data-color-theme', colorTheme);

  if (toggleBtn) {
    const isPink = colorTheme === 'pink';
    toggleBtn.setAttribute('aria-checked', String(isPink));
    toggleBtn.setAttribute('aria-label', isPink ?
      'Zet blauwe thema aan' : 'Zet roze thema aan');
  }

  document.dispatchEvent(new CustomEvent('colorthemechange', { detail: { colorTheme } }));
}

export function initColorTheme() {
  const toggleBtn = document.getElementById('colorThemeToggle');

  const stored = localStorage.getItem(COLOR_STORAGE_KEY);
  const initialColorTheme = stored === 'pink' ? 'pink' : 'blue'; // "blauw" is the default

  applyColorTheme(initialColorTheme, toggleBtn);

  if (!toggleBtn) return; // page has no color-theme toggle — nothing left to wire up

  toggleBtn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-color-theme');
    const next = current === 'pink' ? 'blue' : 'pink';
    applyColorTheme(next, toggleBtn);
    localStorage.setItem(COLOR_STORAGE_KEY, next);
  });
}
