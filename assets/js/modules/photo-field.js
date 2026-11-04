// =================================================================
// PHOTO FIELD — "foto toevoegen" for forms (kleding, snack-rating)
// -----------------------------------------------------------------
// The same behaviour as the photo box on gifts.html, shared so the
// clothing and snack-rating pages don't each carry their own copy:
//   - pick a file with the "Kies bestand" pill,
//   - OR drag a picture onto the form (a file from your computer, or a
//     picture dragged out of another web page),
//   - OR paste one with Ctrl+V while the form has focus,
//   - a small preview with a ✕ to throw the choice away again.
//
// It only holds the chosen picture (a File); what the page does with it
// (these two pages shrink it to a small JPEG data URL, see resizePhoto in
// clothing.js / snack-rating.js) is up to the page. The markup it expects
// is the gifts-style block, see clothing.html:
//   label.gf-add-photo-label > span.gf-add-photo-filename + input[type=file]
//   p.gf-dropzone-hint
//   div.gf-photo-preview > img.gf-photo-preview-img + button.gf-photo-clear
// =================================================================

const IMAGE_URL_PATTERN = /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i;
const DEFAULT_MAX_BYTES = 15 * 1024 * 1024;

// What did the person drop on the form? A real file, a picture dragged
// out of another web page (its address), or just a link.
function extractDropped(dataTransfer) {
  const files = Array.from(dataTransfer.files || []).filter((f) => f.type.startsWith('image/'));
  if (files.length) return { file: files[0] };

  const html = dataTransfer.getData('text/html');
  if (html) {
    try {
      const img = new DOMParser().parseFromString(html, 'text/html').querySelector('img');
      const src = img && img.getAttribute('src');
      if (src && /^(https?:|data:image\/)/i.test(src)) return { src };
    } catch { /* fall through to the plain link below */ }
  }

  const raw = dataTransfer.getData('text/uri-list') || dataTransfer.getData('text/plain') || '';
  const link = raw.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith('#'));
  if (link && /^https?:\/\//i.test(link)) return IMAGE_URL_PATTERN.test(link) ? { src: link } : { link };
  return null;
}

/**
 * Wires one form up. Options:
 *   errorEl   element that shows messages (optional)
 *   urlInput  the form's link field: a dropped page link fills it in when empty (optional)
 *   maxBytes  largest file accepted (default 15MB)
 * Returns { getFile, clear, showExisting, whenReady }.
 */
export function setupPhotoField(form, { errorEl = null, urlInput = null, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const input = form.querySelector('input[type="file"]');
  const filenameEl = form.querySelector('.gf-add-photo-filename');
  const previewEl = form.querySelector('.gf-photo-preview');
  const previewImg = form.querySelector('.gf-photo-preview-img');
  const clearBtn = form.querySelector('.gf-photo-clear');

  let pending = null;          // File waiting to be saved with the form
  let previewObjectUrl = null;
  let readyPromise = Promise.resolve();

  const say = (text) => { if (errorEl) errorEl.textContent = text; };

  function releasePreview() {
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = null;
  }

  function showFilename(text) {
    if (filenameEl) filenameEl.textContent = text || filenameEl.dataset.defaultText || 'Kies bestand';
  }

  function showPreview(src) {
    if (!previewImg || !previewEl) return;
    previewImg.src = src;
    previewEl.classList.remove('hidden');
  }

  function clear() {
    pending = null;
    releasePreview();
    if (input) input.value = '';
    if (previewImg) previewImg.removeAttribute('src');
    previewEl?.classList.add('hidden');
    showFilename('');
  }

  // Edit mode: show the photo the item already has (nothing is waiting to be saved).
  function showExisting(src) {
    clear();
    if (src) showPreview(src);
  }

  function setFile(file) {
    if (!file) { clear(); return; }
    if (!file.type.startsWith('image/')) {
      clear();
      say('Dat is geen afbeelding.');
      return;
    }
    if (file.size > maxBytes) {
      clear();
      say(`Foto is te groot (max ${Math.floor(maxBytes / 1024 / 1024)}MB).`);
      return;
    }
    say('');
    releasePreview();
    previewObjectUrl = URL.createObjectURL(file);
    pending = file;
    showPreview(previewObjectUrl);
    showFilename(file.name || 'Geplakte afbeelding');
  }

  // A picture dragged out of another website: download it in the browser.
  function setSrc(src) {
    say('');
    const job = fetch(src)
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
      .then((blob) => {
        if (!blob.type.startsWith('image/')) throw new Error('geen afbeelding');
        setFile(new File([blob], 'sleepfoto', { type: blob.type }));
      })
      .catch(() => {
        // Many shops forbid downloading their pictures from another website.
        say('Die website staat niet toe dat ik het plaatje overneem. Sla het eerst op (rechtsklik → afbeelding opslaan) en sleep dan het bestand hierheen.');
      });
    readyPromise = job;
  }

  input?.addEventListener('change', () => setFile(input.files?.[0] || null));
  clearBtn?.addEventListener('click', clear);

  // Paste (Ctrl+V) an image while the form has focus
  form.addEventListener('paste', (event) => {
    const file = Array.from(event.clipboardData?.files || []).find((f) => f.type.startsWith('image/'));
    if (!file) return; // normal text paste into the inputs
    event.preventDefault();
    setFile(file);
  });

  // Drag & drop onto the whole form
  let dragDepth = 0;
  const carriesDroppable = (event) => {
    const types = Array.from(event.dataTransfer?.types || []);
    return types.includes('Files') || types.includes('text/uri-list') || types.includes('text/html');
  };
  form.addEventListener('dragenter', (event) => {
    if (!carriesDroppable(event)) return;
    event.preventDefault();
    dragDepth += 1;
    form.classList.add('gf-dropzone-active');
  });
  form.addEventListener('dragover', (event) => {
    if (!carriesDroppable(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });
  form.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) form.classList.remove('gf-dropzone-active');
  });
  form.addEventListener('drop', (event) => {
    if (!carriesDroppable(event)) return;
    event.preventDefault();
    dragDepth = 0;
    form.classList.remove('gf-dropzone-active');
    const dropped = extractDropped(event.dataTransfer);
    if (!dropped) { say('Daar kon ik geen afbeelding in vinden.'); return; }
    if (dropped.file) setFile(dropped.file);
    else if (dropped.src) setSrc(dropped.src);
    else if (dropped.link) {
      if (urlInput && !urlInput.value.trim()) {
        urlInput.value = dropped.link;
        say('Link ingevuld. Sleep het plaatje zelf hierheen als je een foto wilt.');
      } else {
        say('Dat is een link, geen afbeelding. Sleep de afbeelding zelf (of sla hem eerst op).');
      }
    }
  });

  return {
    /** The picture waiting to be saved, or null. */
    getFile: () => pending,
    clear,
    showExisting,
    /** Resolves once a picture dragged in from another website has been fetched (or failed). */
    whenReady: () => readyPromise,
  };
}
