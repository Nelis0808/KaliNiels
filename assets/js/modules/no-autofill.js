// =================================================================
// NO SUGGESTIONS FROM EARLIER (no-autofill.js)
// -----------------------------------------------------------------
// Browsers remember what you typed in text fields and offer it again as a
// dropdown the next time ("Toevoegen…" fields, titles, notes, search boxes).
// That is not wanted here, so every ordinary text-like field gets
// autocomplete="off" — including fields the pages create later (rename
// boxes, edit forms), which a MutationObserver catches.
// Password fields are left alone on purpose (login keeps working with the
// browser's password manager), as is anything that already sets its own
// autocomplete value in the HTML.
// =================================================================

const TEXT_LIKE = 'input:not([type]), input[type="text"], input[type="search"], input[type="url"], input[type="number"], input[type="email"], input[type="tel"], textarea';

function silence(root) {
  const scope = root && root.querySelectorAll ? root : document;
  const fields = [...scope.querySelectorAll(TEXT_LIKE)];
  if (root && root.matches && root.matches(TEXT_LIKE)) fields.push(root);
  fields.forEach((field) => {
    if (!field.hasAttribute('autocomplete')) field.setAttribute('autocomplete', 'off');
  });
  // Forms without a password field: turn it off on the form as well (some browsers look there first).
  const forms = scope.querySelectorAll ? [...scope.querySelectorAll('form')] : [];
  if (root && root.matches && root.matches('form')) forms.push(root);
  forms.forEach((form) => {
    if (!form.hasAttribute('autocomplete') && !form.querySelector('input[type="password"]')) {
      form.setAttribute('autocomplete', 'off');
    }
  });
}

export function initNoAutofill() {
  silence(document);
  new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1) silence(node);
      });
    });
  }).observe(document.body, { childList: true, subtree: true });
}
