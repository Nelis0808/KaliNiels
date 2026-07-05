// =================================================================
// THEME (light / dark mode)
// -----------------------------------------------------------------
// Applies data-theme="light" | "dark" on <html>. All visual rules
// live in CSS (base/variables.css + dark-mode.css); this module's
// only job is deciding *which* theme is active and persisting it.
//
// EXTENDING: listen for the `themechange` event this module fires
// on `document` if some future feature (e.g. a chart library) needs
// to re-render when the theme flips.
// =================================================================

const STORAGE_KEY = 'theme-preference';

function applyTheme(theme, toggleBtn) {
  document.documentElement.setAttribute('data-theme', theme);

  if (toggleBtn) {
    toggleBtn.textContent = theme === 'dark' ? '☀️' : '🌙';
    toggleBtn.setAttribute('aria-pressed', String(theme === 'dark'));
    toggleBtn.setAttribute('aria-label', theme === 'dark' ? 'Zet lichte modus aan' : 'Zet donkere modus aan');
  }

  document.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
}

export function initTheme() {
  const toggleBtn = document.getElementById('themeToggle');

  const stored = localStorage.getItem(STORAGE_KEY);
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const initialTheme = stored ?? (systemPrefersDark ? 'dark' : 'light');

  applyTheme(initialTheme, toggleBtn);

  if (!toggleBtn) return; // page has no theme toggle button — nothing left to wire up

  toggleBtn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next, toggleBtn);
    localStorage.setItem(STORAGE_KEY, next);
  });
}
