// =================================================================
// SETTINGS DROPDOWN (top-right "⚙️" menu, every page)
// -----------------------------------------------------------------
// Replaces the old pair of standalone icon buttons (🌸/🌙) with a
// single gear button that opens a panel. The two *working* settings
// (dark mode, color theme) are plain markup in every HTML file —
// see the `.settings-item` blocks in the header — and are wired up
// by theme.js exactly as before, just against new element IDs/roles.
//
// This module only handles:
//   1. Opening/closing the panel (click, outside click, Escape).
//   2. Rendering any FUTURE settings from siteConfig.settings as
//      disabled "Binnenkort" rows, so the panel is ready to grow.
//
// EXTENDING: to turn one of the placeholder rows into a real setting:
//   1. Give it real markup in every HTML file (copy a working
//      `.settings-item` block, e.g. the dark-mode one) instead of
//      leaving it to this auto-render step.
//   2. Remove its entry from `siteConfig.settings` in config.js.
//   3. Write a small init function (own module, or add to theme.js)
//      that reads/writes localStorage and applies the setting —
//      same pattern as initTheme()/initColorTheme().
//   4. Import + call that init function from main.js.
// Until then, just editing the `label`/`emoji` fields in
// config.js's `settings` array is enough to reshape the placeholders.
// =================================================================

import { siteConfig } from '../config.js';
import { escapeHtml } from './utils.js';

function renderPlaceholder(setting) {
  const emoji = setting.emoji ? `${setting.emoji} ` : '';
  return `
    <div class="settings-item settings-item-disabled" role="menuitem" aria-disabled="true">
      <span class="settings-item-label">${emoji}${escapeHtml(setting.label)}</span>
      <span class="dropdown-badge">Binnenkort</span>
    </div>
  `;
}

export function initSettingsDropdown() {
  const dropdown = document.getElementById('navSettingsDropdown');
  const trigger = document.getElementById('navSettingsBtn');
  const menu = document.getElementById('navSettingsMenu');
  if (!dropdown || !trigger || !menu) return; // page has no settings menu — nothing to do

  const extraContainer = document.getElementById('settingsExtra');
  if (extraContainer) {
    const extraSettings = siteConfig.settings || [];
    extraContainer.innerHTML = extraSettings.map(renderPlaceholder).join('');
  }

  function closeMenu() {
    dropdown.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
  }

  function toggleMenu() {
    const isOpen = dropdown.classList.toggle('open');
    trigger.setAttribute('aria-expanded', String(isOpen));
  }

  trigger.addEventListener('click', (event) => {
    event.stopPropagation(); // don't let the document click-listener below close it immediately
    toggleMenu();
  });

  // Click anywhere outside the dropdown closes it. Clicking a switch
  // INSIDE it should NOT close it — you might want to flip both.
  document.addEventListener('click', (event) => {
    if (!dropdown.contains(event.target)) closeMenu();
  });

  // Escape closes it and returns focus to the trigger button.
  dropdown.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeMenu();
      trigger.focus();
    }
  });
}
