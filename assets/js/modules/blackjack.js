// =================================================================
// BLACKJACK
// -----------------------------------------------------------------
// Single-player vs. a simple dealer AI (hits until 17, stands on
// 17+, including "soft 17" counted as a stand here for simplicity).
// Classic rules: blackjack (ace + 10-value on the first two cards)
// pays 3:2, a normal win pays 1:1, push returns the bet, bust/loss
// forfeits it.
//
// CARDS: images live in assets/icons/playing-cards, named
// "{rank}_of_{suit}.png" (e.g. "10_of_hearts.png"), with two
// quirks in the source filenames that this module works around:
//   - the ace of spades is "ace_of_spades2.png" (trailing "2")
//   - jack/queen/king filenames all end in "2" as well
//     (e.g. "jack_of_clubs2.png")
// See cardImageFile() below — it's the ONLY place that needs to
// know about these exceptions.
//
// LOGGED IN vs GUEST — two independent things change:
//   1. CARD ART: assets/icons/playing-cards/special-cards/ holds an
//      alternate variant for aces, jacks/queens/kings, and jokers
//      only (number cards 2-10 look identical either way, so guests
//      never see a missing/blank special variant). Logged-in
//      players get the special-cards/ version of just those; number
//      cards always come from the plain folder.
//   2. CHIP BALANCE: guests get a fixed local stack (GUEST_CHIPS)
//      that resets on every page load — nothing is sent anywhere.
//      Logging in loads/saves a real balance via the "blackjack"
//      Cloudflare Worker (see cloudflare/cloudflare-worker-blackjack),
//      so it persists across visits and devices, and can be
//      manually topped up from the Cloudflare KV dashboard (see
//      STAPPENPLAN-BLACKJACK.md).
//
// AUTH: identical token scheme to photo-gallery.js (passphrase ->
// signed token -> kept in localStorage under its own key so logging
// into BlackJack and logging into the photo gallery are completely
// independent sessions, even though they may reuse the same
// passphrases if you set them up that way).
// =================================================================

import { siteRootUrl } from './utils.js';
import { siteConfig } from '../config.js';

const AUTH_STORAGE_KEY = 'bjAuth';
const GUEST_CHIPS_STARTING = 1000;
const CHIP_VALUES = [50, 100, 250, 500, 1000, 5000];
const DECK_COUNT = 1; // fresh single deck, reshuffled every hand — simplest for a casual 2-player-free game

// Ranks whose look changes when logged in (see file header). Every
// other rank (2-10) always uses the plain folder — there is no
// special-cards variant for them, so guests and logged-in players
// never differ there.
const SPECIAL_RANKS = new Set(['ace', 'jack', 'queen', 'king', 'joker']);

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king', 'ace'];

/** Blackjack value of a rank; ace starts at 11 and is softened in handValue() as needed. */
function rankValue(rank) {
  if (rank === 'ace') return 11;
  if (rank === 'jack' || rank === 'queen' || rank === 'king') return 10;
  return Number(rank);
}

/** Resolves a card to its image filename, folder-relative (see the special-case comment above). */
function cardImageFile(card) {
  const { rank, suit } = card;

  if (rank === 'ace' && suit === 'spades') return 'ace_of_spades2.png';
  if (rank === 'jack' || rank === 'queen' || rank === 'king') return `${rank}_of_${suit}2.png`;
  return `${rank}_of_${suit}.png`;
}

/** Full URL for a card's face image, choosing the special-cards variant when logged in and the rank qualifies. */
function cardImageUrl(card, isLoggedIn) {
  const file = cardImageFile(card);
  const folder = isLoggedIn && SPECIAL_RANKS.has(card.rank)
    ? 'assets/icons/playing-cards/special-cards'
    : 'assets/icons/playing-cards';
  return siteRootUrl(`${folder}/${file}`);
}

function buildShuffledDeck() {
  const deck = [];
  for (let d = 0; d < DECK_COUNT; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ rank, suit });
      }
    }
  }

  // Fisher-Yates
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/** Total value of a hand, softening aces (11 -> 1) one at a time until <= 21 or out of aces. */
function handValue(cards) {
  let total = cards.reduce((sum, card) => sum + rankValue(card.rank), 0);
  let aces = cards.filter((card) => card.rank === 'ace').length;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

function isBlackjack(cards) {
  return cards.length === 2 && handValue(cards) === 21;
}

export function initBlackjack() {
  const app = document.getElementById('bjApp');
  if (!app) return; // not on the blackjack page

  const workerUrl = siteConfig.blackjack?.workerUrl || '';

  // ---- DOM refs ----
  const guestBadge = document.getElementById('bjGuestBadge');
  const loggedInBadge = document.getElementById('bjLoggedInBadge');
  const whoLabel = document.getElementById('bjWhoLabel');
  const showLoginBtn = document.getElementById('bjShowLogin');
  const cancelLoginBtn = document.getElementById('bjCancelLogin');
  const logoutBtn = document.getElementById('bjLogoutBtn');
  const loginForm = document.getElementById('bjLoginForm');
  const passphraseInput = document.getElementById('bjPassphrase');
  const loginError = document.getElementById('bjLoginError');

  const balanceEl = document.getElementById('bjBalance');
  const betEl = document.getElementById('bjBet');
  const chipTray = document.getElementById('bjChipTray');
  const clearBetBtn = document.getElementById('bjClearBet');
  const dealBtn = document.getElementById('bjDeal');

  const table = document.getElementById('bjTable');
  const dealerCardsEl = document.getElementById('bjDealerCards');
  const playerCardsEl = document.getElementById('bjPlayerCards');
  const dealerScoreEl = document.getElementById('bjDealerScore');
  const playerScoreEl = document.getElementById('bjPlayerScore');
  const statusEl = document.getElementById('bjStatus');
  const hitBtn = document.getElementById('bjHit');
  const standBtn = document.getElementById('bjStand');
  const doubleBtn = document.getElementById('bjDouble');
  const nextHandBtn = document.getElementById('bjNextHand');

  // ---- state ----
  let auth = null; // { token, who, exp } | null
  let balance = GUEST_CHIPS_STARTING;
  let bet = 0;
  let deck = [];
  let playerHand = [];
  let dealerHand = [];
  let handInProgress = false;
  let dealerHoleHidden = false;

  function isLoggedIn() {
    return Boolean(auth);
  }

  // -----------------------------------------------------------------
  // AUTH (mirrors photo-gallery.js's storeAuth/loadStoredAuth/clearAuth)
  // -----------------------------------------------------------------
  function loadStoredAuth() {
    try {
      const raw = localStorage.getItem(AUTH_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.token || !parsed?.exp || parsed.exp * 1000 < Date.now()) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function storeAuth(nextAuth) {
    auth = nextAuth;
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextAuth));
  }

  function clearAuth() {
    auth = null;
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }

  function updateAuthUI() {
    if (isLoggedIn()) {
      guestBadge.classList.add('hidden');
      loggedInBadge.classList.remove('hidden');
      loginForm.classList.add('hidden');
      const labels = siteConfig.blackjack?.personLabels || {};
      whoLabel.textContent = labels[auth.who] || auth.who;
    } else {
      guestBadge.classList.remove('hidden');
      loggedInBadge.classList.add('hidden');
    }
  }

  function showLoginForm() {
    guestBadge.classList.add('hidden');
    loginForm.classList.remove('hidden');
    loginError.textContent = '';
    passphraseInput.value = '';
    passphraseInput.focus();
  }

  function hideLoginForm() {
    loginForm.classList.add('hidden');
    loginError.textContent = '';
    updateAuthUI();
  }

  async function login(passphrase) {
    if (!workerUrl) {
      loginError.textContent = '⚠️ Nog geen Worker gekoppeld, zie STAPPENPLAN-BLACKJACK.md.';
      return;
    }

    loginError.textContent = '';
    try {
      const response = await fetch(`${workerUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase }),
      });
      const data = await response.json();
      if (!response.ok) {
        loginError.textContent = data.error || 'Inloggen mislukt.';
        return;
      }

      storeAuth({ token: data.token, who: data.who, exp: data.exp });
      passphraseInput.value = '';
      updateAuthUI();
      await loadChips();
      renderCardsForAuthChange();
    } catch {
      loginError.textContent = 'Geen verbinding, probeer het later opnieuw.';
    }
  }

  function logout() {
    clearAuth();
    balance = GUEST_CHIPS_STARTING;
    bet = 0;
    updateAuthUI();
    updateBalanceUI();
    renderCardsForAuthChange();
  }

  // -----------------------------------------------------------------
  // CHIP BALANCE (server-backed when logged in, local-only as guest)
  // -----------------------------------------------------------------
  async function loadChips() {
    if (!isLoggedIn() || !workerUrl) return;
    try {
      const response = await fetch(`${workerUrl}/chips`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!response.ok) {
        if (response.status === 401) logout(); // session expired server-side
        return;
      }
      const data = await response.json();
      balance = data.chips;
      updateBalanceUI();
    } catch {
      // Offline/unreachable: keep whatever balance we last knew about.
    }
  }

  async function saveChips() {
    if (!isLoggedIn() || !workerUrl) return;
    try {
      await fetch(`${workerUrl}/chips`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
        body: JSON.stringify({ chips: balance }),
      });
    } catch {
      // Best-effort — if this fails the next successful load will just
      // reflect whatever was last saved; nothing crashes locally.
    }
  }

  function updateBalanceUI() {
    balanceEl.textContent = String(balance);
    betEl.textContent = String(bet);
    updateChipTrayState();
    dealBtn.disabled = bet <= 0 || handInProgress;
  }

  // -----------------------------------------------------------------
  // CHIP TRAY
  // -----------------------------------------------------------------
  function renderChipTray() {
    chipTray.innerHTML = CHIP_VALUES.map((value) => `
      <button type="button" class="bj-chip" data-value="${value}" aria-label="Zet ${value} chips in">
        <img src="${siteRootUrl(`assets/icons/chips/${value}.svg`)}" alt="" class="bj-chip-img">
        <span class="bj-chip-value">${value}</span>
      </button>
    `).join('');

    chipTray.querySelectorAll('.bj-chip').forEach((chipBtn) => {
      chipBtn.addEventListener('click', () => {
        if (handInProgress) return;
        const value = Number(chipBtn.dataset.value);
        placeBet(value);
      });
    });
  }

  function updateChipTrayState() {
    chipTray.querySelectorAll('.bj-chip').forEach((chipBtn) => {
      const value = Number(chipBtn.dataset.value);
      chipBtn.disabled = handInProgress || value > balance - bet;
    });
  }

  function placeBet(value) {
    if (value > balance - bet) return; // can't bet more chips than you have
    bet += value;
    updateBalanceUI();
  }

  function clearBet() {
    if (handInProgress) return;
    bet = 0;
    updateBalanceUI();
  }

  // -----------------------------------------------------------------
  // CARD RENDERING
  // -----------------------------------------------------------------
  function buildCardImg(card) {
    const img = document.createElement('img');
    img.src = cardImageUrl(card, isLoggedIn());
    img.alt = `${card.rank} of ${card.suit}`;
    img.className = 'bj-card-img';
    return img;
  }

  function buildHiddenCardImg() {
    const img = document.createElement('img');
    img.src = siteRootUrl('assets/icons/playing-cards/card-back-blue.png');
    img.alt = 'Verborgen kaart';
    img.className = 'bj-card-img';
    return img;
  }

  function renderHands() {
    playerCardsEl.replaceChildren(...playerHand.map(buildCardImg));

    const dealerNodes = dealerHand.map((card, index) => {
      if (index === 1 && dealerHoleHidden) return buildHiddenCardImg();
      return buildCardImg(card);
    });
    dealerCardsEl.replaceChildren(...dealerNodes);

    playerScoreEl.textContent = playerHand.length ? `(${handValue(playerHand)})` : '';
    dealerScoreEl.textContent = dealerHoleHidden
      ? (dealerHand.length ? `(${rankValue(dealerHand[0].rank)}+?)` : '')
      : (dealerHand.length ? `(${handValue(dealerHand)})` : '');
  }

  /** Re-renders whatever's currently on the table with the correct card-art variant after a login/logout. */
  function renderCardsForAuthChange() {
    if (playerHand.length || dealerHand.length) renderHands();
  }

  // -----------------------------------------------------------------
  // GAME FLOW
  // -----------------------------------------------------------------
  function setStatus(text) {
    statusEl.textContent = text;
  }

  function setActionButtonsEnabled(enabled) {
    hitBtn.disabled = !enabled;
    standBtn.disabled = !enabled;
    doubleBtn.disabled = !enabled || balance < bet || playerHand.length !== 2;
  }

  function dealHand() {
    if (bet <= 0 || bet > balance) return;

    deck = buildShuffledDeck();
    playerHand = [deck.pop(), deck.pop()];
    dealerHand = [deck.pop(), deck.pop()];
    dealerHoleHidden = true;
    handInProgress = true;

    table.classList.remove('hidden');
    dealBtn.disabled = true;
    clearBetBtn.disabled = true;
    nextHandBtn.classList.add('hidden');
    renderHands();

    const playerBJ = isBlackjack(playerHand);
    const dealerBJ = isBlackjack(dealerHand);

    if (playerBJ || dealerBJ) {
      dealerHoleHidden = false;
      renderHands();
      if (playerBJ && dealerBJ) {
        finishHand('push', 'Allebei BlackJack! Gelijkspel, inzet terug.');
      } else if (playerBJ) {
        finishHand('blackjack', 'BlackJack! Je wint 3:2. 🎉');
      } else {
        finishHand('lose', 'Dealer heeft BlackJack. Helaas.');
      }
      return;
    }

    setActionButtonsEnabled(true);
    setStatus('Hit, Stand, of Verdubbel?');
  }

  function hit() {
    if (!handInProgress) return;
    playerHand.push(deck.pop());
    renderHands();

    if (handValue(playerHand) > 21) {
      finishHand('lose', 'Bust! Je zit boven de 21.');
    } else {
      setActionButtonsEnabled(true);
      doubleBtn.disabled = true; // can only double on the first decision
    }
  }

  function double() {
    if (!handInProgress || balance < bet || playerHand.length !== 2) return;
    bet *= 2;
    updateBalanceUI();
    playerHand.push(deck.pop());
    renderHands();

    if (handValue(playerHand) > 21) {
      finishHand('lose', 'Bust na verdubbelen! Helaas.');
    } else {
      dealerPlaysOutAndFinish();
    }
  }

  function stand() {
    if (!handInProgress) return;
    dealerPlaysOutAndFinish();
  }

  function dealerPlaysOutAndFinish() {
    dealerHoleHidden = false;
    setActionButtonsEnabled(false);

    while (handValue(dealerHand) < 17) {
      dealerHand.push(deck.pop());
    }
    renderHands();

    const playerTotal = handValue(playerHand);
    const dealerTotal = handValue(dealerHand);

    if (dealerTotal > 21) {
      finishHand('win', 'Dealer bust! Jij wint. 🎉');
    } else if (dealerTotal > playerTotal) {
      finishHand('lose', `Dealer wint met ${dealerTotal} tegen ${playerTotal}.`);
    } else if (dealerTotal < playerTotal) {
      finishHand('win', `Jij wint met ${playerTotal} tegen ${dealerTotal}! 🎉`);
    } else {
      finishHand('push', `Gelijkspel op ${playerTotal}. Inzet terug.`);
    }
  }

  function finishHand(outcome, message) {
    handInProgress = false;
    setActionButtonsEnabled(false);

    if (outcome === 'blackjack') {
      balance += Math.floor(bet * 1.5);
    } else if (outcome === 'win') {
      balance += bet;
    } else if (outcome === 'lose') {
      balance -= bet;
    }
    // 'push': balance unchanged, bet effectively returned.

    setStatus(message);
    bet = 0;
    updateBalanceUI();
    clearBetBtn.disabled = false;
    nextHandBtn.classList.remove('hidden');

    saveChips();
  }

  function startNextHand() {
    playerHand = [];
    dealerHand = [];
    dealerHoleHidden = false;
    table.classList.add('hidden');
    nextHandBtn.classList.add('hidden');
    setStatus('');
    updateBalanceUI();
  }

  // -----------------------------------------------------------------
  // WIRE UP
  // -----------------------------------------------------------------
  showLoginBtn.addEventListener('click', showLoginForm);
  cancelLoginBtn.addEventListener('click', hideLoginForm);
  logoutBtn.addEventListener('click', logout);
  loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const passphrase = passphraseInput.value.trim();
    if (!passphrase) return;
    login(passphrase);
  });

  clearBetBtn.addEventListener('click', clearBet);
  dealBtn.addEventListener('click', dealHand);
  hitBtn.addEventListener('click', hit);
  standBtn.addEventListener('click', stand);
  doubleBtn.addEventListener('click', double);
  nextHandBtn.addEventListener('click', startNextHand);

  // ---- init ----
  renderChipTray();
  setActionButtonsEnabled(false);

  const storedAuth = loadStoredAuth();
  if (storedAuth) {
    auth = storedAuth;
    updateAuthUI();
    loadChips();
  } else {
    updateAuthUI();
    updateBalanceUI();
  }
}
