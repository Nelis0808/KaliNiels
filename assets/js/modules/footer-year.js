// =================================================================
// FOOTER YEAR
// Fills #year with the current year, so the footer never goes stale.
// =================================================================

export function initFooterYear() {
  const el = document.getElementById('year');
  if (!el) return;

  el.textContent = String(new Date().getFullYear());
}
