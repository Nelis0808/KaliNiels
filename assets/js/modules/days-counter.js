// =================================================================
// "DAYS TOGETHER" COUNTER
// Fills #daysTogether with the number of days since
// siteConfig.relationshipStartDate. Change the date in one place —
// assets/js/config.js — and it updates everywhere this is used.
// =================================================================

import { siteConfig } from '../config.js';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export function initDaysCounter() {
  const el = document.getElementById('daysTogether');
  if (!el) return;

  const startDate = new Date(siteConfig.relationshipStartDate);
  const today = new Date();
  const diffDays = Math.ceil((today - startDate) / MS_PER_DAY);

  el.textContent = diffDays.toLocaleString('nl-NL');
}
