// =================================================================
// VALENTINE (valentine.html) — "coming soon" surprise page
// -----------------------------------------------------------------
// - "Nee" ontwijkt de cursor zodra je 'm probeert aan te raken/hoveren.
// - De eerste keer dat "Nee" beweegt, springt "Ja" naar het midden van
//   het scherm (en wordt groter, als een soort "hoofdknop").
// - Na een willekeurig aantal ontwijkingen (3-10) verstopt "Nee" zich
//   precies achter "Ja", zodat hij niet meer aan te klikken is.
// - Klikken op "Ja" toont het bedankbericht, wisselt de foto, en laat
//   hartjes/sterren over het scherm vallen.
//
// Volgt hetzelfde patroon als de andere modules: de functie checkt zelf
// of de benodigde elementen bestaan en stopt vroeg als dat niet zo is,
// zodat main.js 'm veilig op elke pagina kan aanroepen.
// =================================================================
export function initValentine() {
  const stage = document.getElementById('val-stage');
  const container = document.getElementById('valContainer');
  const yesBtn = document.getElementById('valYes');
  const noBtn = document.getElementById('valNo');
  const image = document.getElementById('valImage');
  const message = document.getElementById('valMessage');
  const heartsLayer = document.getElementById('valHearts');

  if (!stage || !yesBtn || !noBtn) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const EDGE_MARGIN = 100;
  const MIN_DISTANCE_FROM_CURSOR = 160;

  let hasStarted = false; // has the chase begun (Ja moved to center)?
  let settled = false; // has Nee hidden behind Ja for good?
  let moveCount = 0;
  const vanishAfter = 3 + Math.floor(Math.random() * 8); // random 3-10 inclusive

  // Freezes a button's current on-screen position as inline left/top,
  // so it can be detached from normal flow without jumping.
  function fixToCurrentPosition(btn) {
    const rect = btn.getBoundingClientRect();
    btn.style.left = `${rect.left}px`;
    btn.style.top = `${rect.top}px`;
  }

  // Standard clamp helper
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  // Picks a random on-screen point at least MIN_DISTANCE_FROM_CURSOR away
  // from the cursor, within the viewport minus EDGE_MARGIN.
  function randomFarPoint(cursorX, cursorY, width, height) {
    const maxX = Math.max(EDGE_MARGIN, window.innerWidth - width - EDGE_MARGIN);
    const maxY = Math.max(EDGE_MARGIN, window.innerHeight - height - EDGE_MARGIN);

    let x = cursorX;
    let y = cursorY;
    let attempts = 0;

    do {
      x = EDGE_MARGIN + Math.random() * (maxX - EDGE_MARGIN);
      y = EDGE_MARGIN + Math.random() * (maxY - EDGE_MARGIN);
      attempts++;
    } while (
      Math.hypot(x - cursorX, y - cursorY) < MIN_DISTANCE_FROM_CURSOR &&
      attempts < 30
    );

    return {
      x: clamp(x, EDGE_MARGIN, maxX),
      y: clamp(y, EDGE_MARGIN, maxY),
    };
  }

  // First dodge only: detaches both buttons from flow and slides "Ja" to center.
  function startChase() {
    if (hasStarted) return;
    hasStarted = true;

    // Beide knoppen loskoppelen van de normale flow, op hun huidige plek.
    fixToCurrentPosition(yesBtn);
    fixToCurrentPosition(noBtn);
    yesBtn.classList.add('val-btn--roaming');
    noBtn.classList.add('val-btn--roaming');

    // Force reflow zodat de browser de transitie ook echt animeert.
    void yesBtn.offsetWidth;

    // "Ja" schuift horizontaal naar het midden van de tekst-container
    // (niet het hele scherm) — de verticale positie blijft ongewijzigd.
    requestAnimationFrame(() => {
      const referenceEl = container || stage;
      const refRect = referenceEl.getBoundingClientRect();
      const yesWidth = yesBtn.offsetWidth;
      const targetLeft = refRect.left + refRect.width / 2 - yesWidth / 2;
      yesBtn.style.left = `${targetLeft}px`;
    });
  }

  // Final move: slides "Nee" to sit exactly behind "Ja" and disables it.
  function hideNeeUnderJa() {
    settled = true; // geen nieuwe ontwijk-pogingen meer terwijl 'ie wegglijdt

    const yesRect = yesBtn.getBoundingClientRect();
    const noWidth = noBtn.offsetWidth;
    const noHeight = noBtn.offsetHeight;
    const targetLeft = yesRect.left + yesRect.width / 2 - noWidth / 2;
    const targetTop = yesRect.top + yesRect.height / 2 - noHeight / 2;

    // Bewust trager dan de normale ontwijk-sprongen, zodat je 'm echt
    // onder de Ja-knop ziet verschuiven in plaats van meteen te zien
    // verdwijnen.
    noBtn.style.transform = 'rotate(0deg)';
    noBtn.classList.add('val-btn--hiding');
    noBtn.style.left = `${targetLeft}px`;
    noBtn.style.top = `${targetTop}px`;

    const finalizeHidden = () => {
      noBtn.removeEventListener('transitionend', finalizeHidden);
      noBtn.classList.remove('val-btn--hiding');
      noBtn.classList.add('val-btn--stuck');

      // Onbereikbaar maken voor muis, touch én toetsenbord.
      noBtn.tabIndex = -1;
      noBtn.setAttribute('aria-disabled', 'true');
      noBtn.setAttribute('aria-hidden', 'true');
    };

    noBtn.addEventListener('transitionend', finalizeHidden, { once: true });
    // Vangnet mocht transitionend niet vuren (bv. reduced motion).
    window.setTimeout(finalizeHidden, 900);
  }

  // Runs one dodge: starts the chase if needed, then either hides "Nee"
  // for good or jumps it to a new random spot.
  function dodge(cursorX, cursorY) {
    if (settled) return;

    startChase();
    moveCount += 1;

    if (moveCount >= vanishAfter) {
      hideNeeUnderJa();
      return;
    }

    const width = noBtn.offsetWidth;
    const height = noBtn.offsetHeight;
    const { x, y } = randomFarPoint(cursorX, cursorY, width, height);

    noBtn.style.left = `${x}px`;
    noBtn.style.top = `${y}px`;

    // Klein willekeurig kanteltje voor extra speelsheid.
    if (!reduceMotion) {
      const tilt = (Math.random() * 16 - 8).toFixed(1);
      noBtn.style.transform = `rotate(${tilt}deg)`;
    }
  }

  // Normalizes mouse/touch/keyboard events into an {x, y} point.
  function pointFromEvent(e) {
    if (e.touches && e.touches[0]) {
      return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    const rect = noBtn.getBoundingClientRect();
    return {
      x: e.clientX ?? rect.left + rect.width / 2,
      y: e.clientY ?? rect.top + rect.height / 2,
    };
  }

  // Mouse hover triggers a dodge
  noBtn.addEventListener('mouseenter', (e) => {
    const { x, y } = pointFromEvent(e);
    dodge(x, y);
  });

  // Touch triggers a dodge too, before the tap can land
  noBtn.addEventListener(
    'touchstart',
    (e) => {
      e.preventDefault();
      const { x, y } = pointFromEvent(e);
      dodge(x, y);
    },
    { passive: false }
  );

  // Toetsenbordgebruikers: tab-focus telt ook als "toenadering".
  noBtn.addEventListener('focus', () => {
    const rect = noBtn.getBoundingClientRect();
    dodge(rect.left + rect.width / 2, rect.top + rect.height / 2);
  });

  // Mocht een klik 'm ooit toch raken (bv. zeer snelle muisbeweging):
  // reken het niet als "nee", laat 'm gewoon opnieuw wegspringen.
  noBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const { x, y } = pointFromEvent(e);
    dodge(x, y);
  });

  yesBtn.addEventListener('click', sayYes);

  // Handles the "Ja" click: swaps photo, shows the message, spawns hearts.
  function sayYes() {
    yesBtn.removeEventListener('click', sayYes);
    yesBtn.disabled = true;
    noBtn.style.display = 'none';
    stage.classList.add('val-stage--yes');

    if (image && image.dataset.yesSrc) {
      image.src = image.dataset.yesSrc;
      image.alt = 'Stitch met een hart';
    }

    if (message) {
      message.hidden = false;
      message.textContent =
        'Dankjewel cutie <3 Love you!!!!';
    }

    // "Ja" terug naar een nette, statische plek in de flow.
    yesBtn.classList.remove('val-btn--roaming');
    yesBtn.style.position = '';
    yesBtn.style.left = '';
    yesBtn.style.top = '';
    yesBtn.style.transform = '';

    if (!reduceMotion) spawnHearts();
  }

  // Spawns a burst of falling heart/star emoji particles.
  function spawnHearts() {
    if (!heartsLayer) return;
    const symbols = ['💕', '💖', '💗', '✨', '⭐', '💘'];
    const total = 28;

    for (let i = 0; i < total; i += 1) {
      const span = document.createElement('span');
      span.className = 'val-heart';
      span.textContent = symbols[Math.floor(Math.random() * symbols.length)];
      span.style.left = `${Math.random() * 100}vw`;
      span.style.fontSize = `${16 + Math.random() * 22}px`;
      span.style.animationDuration = `${4 + Math.random() * 3}s`;
      span.style.animationDelay = `${Math.random() * 1.2}s`;
      heartsLayer.appendChild(span);
      setTimeout(() => span.remove(), 8000);
    }
  }

  // Als "Nee" al verstopt zit onder "Ja" en het venster van formaat
  // verandert (bv. rotatie op mobiel), volg "Ja" mee.
  window.addEventListener('resize', () => {
    if (!settled) return;
    const yesRect = yesBtn.getBoundingClientRect();
    const noWidth = noBtn.offsetWidth;
    const noHeight = noBtn.offsetHeight;
    noBtn.style.left = `${yesRect.left + yesRect.width / 2 - noWidth / 2}px`;
    noBtn.style.top = `${yesRect.top + yesRect.height / 2 - noHeight / 2}px`;
  });
}
