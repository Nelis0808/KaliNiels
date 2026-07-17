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
// CHIP SAFETY: the balance can NEVER go negative, in either the
// guest or logged-in path. Doubling down is only offered (the button
// is only enabled) when the player can actually cover double the
// current bet, and the bet itself is clamped to whatever the player
// can currently afford whenever a chip is added to the tray or a
// double is confirmed — see canAffordDouble()/placeBet()/double()
// below. Every balance mutation additionally goes through
// clampChips(), a last-line-of-defense floor at 0, so no code path
// (now or added later) can silently push a balance below zero.
//
// AUTH: there is no login form on this page anymore. Logging in
// happens ONCE, site-wide, via the "👤 Profiel" dropdown in the
// sticky header (assets/js/modules/auth.js) — the exact same
// session that unlocks Onze Foto's and Onze Reizen also unlocks the
// special card art + real chip balance here. This module listens
// for that shared session via onAuthChange().
//
// The chip balance itself still lives in its own "blackjack" Worker
// + KV namespace (see cloudflare/cloudflare-worker-blackjack) — no
// reason to move real balance state into the identity Worker. For
// that Worker to accept the shared session's token, its
// TOKEN_SECRET / PASSPHRASE_A / PASSPHRASE_B secrets must be set to
// the EXACT SAME values as the "photo-gallery" Worker's (see
// assets/js/modules/auth.js's file header for why that's safe: both
// workers already use the identical signing scheme).
// =================================================================

import { siteRootUrl } from './utils.js';
import { siteConfig } from '../config.js';
import { getAuth, onAuthChange, logout } from './auth.js';

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

/** Floors a chip amount at 0 — the one place every balance mutation must pass through, so no code path can ever leave it negative. */
function clampChips(amount) {
  return Math.max(0, Math.floor(amount));
}

export function initBlackjack() {
  const app = document.getElementById('bjApp');
  if (!app) return; // not on the blackjack page

  const workerUrl = siteConfig.blackjack?.workerUrl || '';

  // ---- DOM refs ----
  const authStatus = document.getElementById('bjAuthStatus');

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
  const nextHandGroup = document.getElementById('bjNextHandGroup');
  const sameBetBtn = document.getElementById('bjSameBet');
  const newBetBtn = document.getElementById('bjNewBet');

  // ---- state ----
  let auth = null; // { token, who, exp } | null
  let balance = GUEST_CHIPS_STARTING;
  let bet = 0;
  let deck = [];
  let playerHand = [];
  let dealerHand = [];
  let handInProgress = false;
  let dealerHoleHidden = false;
  let previousBet = 0; // the bet from the hand that just finished, offered again by "Dezelfde inzet"

  function isLoggedIn() {
    return Boolean(auth);
  }

  // -----------------------------------------------------------------
  // AUTH — reflects the shared site-wide session (assets/js/modules/
  // auth.js). Login/logout happen in the header's "👤 Profiel"
  // dropdown, not on this page — this just reacts when that session
  // changes, via onAuthChange() (see the bottom of this file).
  // -----------------------------------------------------------------
  function updateAuthUI() {
    authStatus.classList.toggle('hidden', isLoggedIn());
  }

  async function syncWithAuth(nextAuth) {
    const wasLoggedIn = isLoggedIn();
    auth = nextAuth;
    updateAuthUI();

    if (isLoggedIn()) {
      await loadChips();
    } else if (wasLoggedIn) {
      // Just logged out: fall back to a fresh local guest stack.
      balance = GUEST_CHIPS_STARTING;
      bet = 0;
      updateBalanceUI();
    }
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
        if (response.status === 401) logout(); // session expired server-side — clears the SHARED session too
        return;
      }
      const data = await response.json();
      balance = clampChips(data.chips);
      // The bet from a previous session can never legitimately exceed
      // the freshly-loaded balance — clamp defensively in case chips
      // were manually lowered in the KV dashboard while a bet was mid-air.
      bet = Math.min(bet, balance);
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
    dealBtn.disabled = bet <= 0 || bet > balance || handInProgress;
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
    if (value <= 0) return;
    // Never let the bet exceed what's actually in the balance — chips
    // that would push past it are simply refused rather than clamped,
    // so the tray's own disabled state (updateChipTrayState) and this
    // guard always agree with each other.
    if (value > balance - bet) return;
    bet = Math.min(bet + value, balance);
    updateBalanceUI();
  }

  function clearBet() {
    if (handInProgress) return;
    bet = 0;
    updateBalanceUI();
  }

  /** True only when doubling is both a legal blackjack move (first decision, exactly 2 cards) AND actually affordable (balance covers a second matching bet on top of the first). */
  function canAffordDouble() {
    return playerHand.length === 2 && balance >= bet * 2 && bet > 0;
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
    doubleBtn.disabled = !enabled || !canAffordDouble();
  }

  /** Smoothly scrolls the table into view once it's been unhidden and
   *  rendered — deferred one animation frame so the browser has laid
   *  out the now-visible table before we ask it to scroll, otherwise
   *  scrollIntoView can measure the pre-reveal (zero-height) position. */
  function scrollToTable() {
    requestAnimationFrame(() => {
      table.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
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
    nextHandGroup.classList.add('hidden');
    renderHands();
    scrollToTable();

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
    if (!handInProgress || !canAffordDouble()) return;
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

    // Every branch below goes through clampChips() — belt-and-braces
    // on top of the affordability checks earlier (placeBet/double
    // already prevent betting more than the balance), so a balance
    // can never end up negative even if those checks are ever loosened.
    if (outcome === 'blackjack') {
      balance = clampChips(balance + bet * 1.5);
    } else if (outcome === 'win') {
      balance = clampChips(balance + bet);
    } else if (outcome === 'lose') {
      balance = clampChips(balance - bet);
    }
    // 'push': balance unchanged, bet effectively returned.

    setStatus(message);
    previousBet = bet;
    bet = 0;
    updateBalanceUI();
    clearBetBtn.disabled = false;
    nextHandGroup.classList.remove('hidden');
    // Can only offer to repeat the bet if the balance still covers it
    // (e.g. a loss can leave the player unable to afford it again).
    sameBetBtn.disabled = previousBet <= 0 || previousBet > balance;

    saveChips();
  }

  /** Shared reset between the "same bet" and "new bet" choices — clears
   *  the table back to the betting screen. */
  function resetTable() {
    playerHand = [];
    dealerHand = [];
    dealerHoleHidden = false;
    table.classList.add('hidden');
    nextHandGroup.classList.add('hidden');
    setStatus('');
  }

  /** "Nieuwe inzet" — same as the old single "Volgende hand" button:
   *  back to an empty bet, player picks fresh chips before dealing. */
  function startNextHandNewBet() {
    resetTable();
    bet = 0;
    updateBalanceUI();
  }

  /** "Dezelfde inzet" — re-places last hand's bet and deals immediately,
   *  so back-to-back hands at the same stake don't need re-clicking
   *  through the chip tray each time. */
  function startNextHandSameBet() {
    if (previousBet <= 0 || previousBet > balance) return;
    resetTable();
    bet = previousBet;
    updateBalanceUI();
    dealHand();
  }

  // -----------------------------------------------------------------
  // WIRE UP
  // -----------------------------------------------------------------
  clearBetBtn.addEventListener('click', clearBet);
  dealBtn.addEventListener('click', dealHand);
  hitBtn.addEventListener('click', hit);
  standBtn.addEventListener('click', stand);
  doubleBtn.addEventListener('click', double);
  sameBetBtn.addEventListener('click', startNextHandSameBet);
  newBetBtn.addEventListener('click', startNextHandNewBet);

  // ---- init ----
  renderChipTray();
  setActionButtonsEnabled(false);
  updateBalanceUI();

  // React to the shared header login/logout — see the AUTH block above.
  onAuthChange(syncWithAuth);
  syncWithAuth(getAuth());
}
