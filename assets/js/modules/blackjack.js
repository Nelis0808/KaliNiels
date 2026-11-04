// =================================================================
// BLACKJACK
// -----------------------------------------------------------------
// Single-player vs. a simple dealer AI (hits until 17, stands on
// 17+, including "soft 17" counted as a stand here for simplicity).
// Classic rules: blackjack (ace + 10-value on the first two cards)
// pays 3:2, a normal win pays 1:1, push returns the bet, bust/loss
// forfeits it.
//
// SPLITSEN: on the very first decision, when the two starting cards
// have the SAME RANK (two 8s, two kings, ...), a "Splitsen" button
// appears. Splitting puts a second, equal bet on the table and turns
// the pair into two separate rows ("Rij 1" / "Rij 2"). Row 1 is played
// all the way through first (hit / stand / double), then row 2 gets its
// second card and is played the same way. Every row is then settled on
// its own against the dealer, and the status line shows each row's
// result plus the net total. One split per hand (no re-splitting); a
// 21 on a split row is a normal 21 (pays 1:1, not 3:2). Splitting needs
// the balance to cover the extra bet, same safety rule as doubling.
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
//      Cloudflare Worker (see cloudflare/chips/), so it persists
//      across visits and devices, and can be manually topped up
//      from the Cloudflare KV dashboard (see ACTION-EXPANSION-PLAN.md).
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
// + KV namespace (see cloudflare/chips/) — no
// reason to move real balance state into the identity Worker. For
// that Worker to accept the shared session's token, its
// TOKEN_SECRET / PASSPHRASE_A / PASSPHRASE_B secrets must be set to
// the EXACT SAME values as the "photo-gallery" Worker's (see
// assets/js/modules/auth.js's file header for why that's safe: both
// workers already use the identical signing scheme).
// =================================================================

import { siteRootUrl } from './utils.js';
import { siteConfig } from '../config.js';
import { getAuth, onAuthChange } from './auth.js';

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
function cardImageFile(card, useSpecial) {
  const { rank, suit } = card;
  if (rank === 'joker') return `${suit}_joker.png`; // suit is 'red'/'black' for jokers, unused by this deck but handled for completeness
  // special-cards/ names every jack/queen/king (all suits) and ONLY
  // the ace of spades with a trailing "2" — every other file (2-10,
  // and the other three aces) keeps the exact same name in both
  // folders. This suffix only ever applies in the special-cards
  // folder, i.e. only when useSpecial is true.
  const needsTwoSuffix = useSpecial && (
    rank === 'jack' || rank === 'queen' || rank === 'king' ||
    (rank === 'ace' && suit === 'spades')
  );
  return `${rank}_of_${suit}${needsTwoSuffix ? '2' : ''}.png`;
}

/** Full URL for a card's face image, choosing the special-cards variant when logged in and the rank qualifies. */
function cardImageUrl(card, isLoggedIn) {
  const useSpecial = isLoggedIn && SPECIAL_RANKS.has(card.rank);
  const file = cardImageFile(card, useSpecial);
  const folder = useSpecial
    ? 'assets/icons/playing-cards/special-cards'
    : 'assets/icons/playing-cards';
  return siteRootUrl(`${folder}/${file}`);
}

// Builds a fresh single deck and Fisher-Yates shuffles it
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

// True if a 2-card starting hand totals 21 (a natural blackjack)
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
  const splitBtn = document.getElementById('bjSplit');
  const nextHandGroup = document.getElementById('bjNextHandGroup');
  const sameBetBtn = document.getElementById('bjSameBet');
  const newBetBtn = document.getElementById('bjNewBet');

  // ---- state ----
  let auth = null; // { token, who, exp } | null
  let balance = GUEST_CHIPS_STARTING;
  let chipLoadFailed = false; // true if the last loadChips() attempt couldn't reach/read the Worker — see loadChips()
  let bet = 0; // the base bet for this hand (a split row / a double adds to what's at stake, see wagered())
  let deck = [];
  // The player's row(s): one normally, two after a split. Each:
  //   { cards: [], bet, fromSplit, result: null | { outcome, text, short } }
  // `result` is filled in as soon as a row is decided (bust) or when the
  // dealer has played out; a row with no result yet is still "alive".
  let hands = [];
  let activeIndex = 0; // which row the player is currently playing
  let dealerHand = [];
  let handInProgress = false;
  let dealerHoleHidden = false;
  let previousBet = 0; // the bet from the hand that just finished, offered again by "Dezelfde inzet"

  // True if the shared site session is active
  function isLoggedIn() {
    return Boolean(auth);
  }

  // -----------------------------------------------------------------
  // AUTH — reflects the shared site-wide session (assets/js/modules/
  // auth.js). Login/logout happen in the header's "👤 Profiel"
  // dropdown, not on this page — this just reacts when that session
  // changes, via onAuthChange() (see the bottom of this file).
  // -----------------------------------------------------------------
  // Hides the "log in for real chips" notice once logged in
  function updateAuthUI() {
    authStatus.classList.toggle('hidden', isLoggedIn());
  }

  // Reacts to the shared session changing: loads real chips, or resets to a guest stack
  async function syncWithAuth(nextAuth) {
    const wasLoggedIn = isLoggedIn();
    auth = nextAuth;
    updateAuthUI();

    if (isLoggedIn()) {
      await loadChips();
    } else if (wasLoggedIn) {
      // Just logged out: fall back to a fresh local guest stack.
      balance = GUEST_CHIPS_STARTING;
      chipLoadFailed = false;
      bet = 0;
      updateBalanceUI();
    }
    renderCardsForAuthChange();
  }

  // -----------------------------------------------------------------
  // CHIP BALANCE (server-backed when logged in, local-only as guest).
  // This is the SITE-WIDE shared balance, not a BlackJack-only one —
  // Spiderette (assets/js/modules/spiderette.js) reads/writes the
  // exact same balance via the exact same Worker, and any future
  // chip-based game should too — see
  // cloudflare/chips/chips_worker.js's file header.
  // -----------------------------------------------------------------
  // Fetches the logged-in player's real chip balance from the Worker
  async function loadChips() {
    if (!isLoggedIn() || !workerUrl) return;
    try {
      const response = await fetch(`${workerUrl}/chips`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!response.ok) {
        if (response.status === 401) {
          // IMPORTANT: this deliberately does NOT clear the shared
          // site session. The blackjack Worker isn't the source of
          // truth for whether the SITE session is valid — that's the
          // shared token's own `exp`, already checked client-side in
          // auth.js before a token is ever used. A 401 specifically
          // from THIS Worker's /chips essentially always means its
          // TOKEN_SECRET doesn't match the identity ("photo-gallery")
          // Worker's yet (see auth.js's file header for the exact
          // fix) — a server misconfiguration, not an expired session.
          // Logging out here would force a fresh login that gets
          // signed with the exact same (still-mismatched) secret and
          // 401s again next visit — a repeating "keeps logging me
          // out" loop that fixes nothing. Instead this just surfaces
          // the failure locally, same as any other load failure, and
          // leaves the person's login for the rest of the site alone.
          console.error(`[blackjack] chip load got 401 — token was not accepted by ${workerUrl}. This almost always means the blackjack Worker's TOKEN_SECRET doesn't match the identity Worker's yet (see auth.js's file header) — not a real expired session, so this page is deliberately NOT logging you out site-wide over it.`);
        } else {
          console.error(`[blackjack] chip load failed: HTTP ${response.status} from ${workerUrl}/chips`);
        }
        chipLoadFailed = true;
        updateBalanceUI();
        return;
      }
      chipLoadFailed = false;
      const data = await response.json();
      balance = clampChips(data.chips);
      // The bet from a previous session can never legitimately exceed
      // the freshly-loaded balance — clamp defensively in case chips
      // were manually lowered in the KV dashboard while a bet was mid-air.
      bet = Math.min(bet, balance);
      updateBalanceUI();
    } catch (err) {
      // Network/CORS/offline — don't silently pretend the balance we
      // never actually loaded is fine; the previous behaviour here
      // left `balance` at its hardcoded GUEST_CHIPS_STARTING default
      // forever, which looked exactly like a real (but wrong) balance.
      console.error(`[blackjack] chip load failed (network/CORS?), check that ${workerUrl} is reachable and its CORS ALLOWED_ORIGINS includes this site's origin.`, err);
      chipLoadFailed = true;
      updateBalanceUI();
    }
  }

  // Best-effort save of the current balance back to the Worker
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

  // Refreshes the balance/bet display and the deal button's enabled state
  function updateBalanceUI() {
    if (chipLoadFailed) {
      balanceEl.textContent = '?';
      balanceEl.title = 'Kon saldo niet laden, de weergegeven waarde klopt mogelijk niet. Zie de browserconsole voor details.';
    } else {
      balanceEl.textContent = String(balance);
      balanceEl.title = '';
    }
    betEl.textContent = String(handInProgress ? wagered() : bet);
    updateChipTrayState();
    dealBtn.disabled = bet <= 0 || bet > balance || handInProgress || chipLoadFailed;
  }

  // -----------------------------------------------------------------
  // CHIP TRAY
  // -----------------------------------------------------------------
  // Builds the clickable chip-value buttons
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

  // Disables chips that would push the bet past the current balance
  function updateChipTrayState() {
    chipTray.querySelectorAll('.bj-chip').forEach((chipBtn) => {
      const value = Number(chipBtn.dataset.value);
      chipBtn.disabled = handInProgress || value > balance - bet;
    });
  }

  // Adds a chip's value to the current bet, if affordable
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

  // Resets the current bet to 0
  function clearBet() {
    if (handInProgress) return;
    bet = 0;
    updateBalanceUI();
  }

  // -----------------------------------------------------------------
  // ROWS (hands) — one normally, two after a split
  // -----------------------------------------------------------------
  function activeHand() {
    return hands[activeIndex];
  }

  /** Total chips currently at stake across every row (base bets plus doubles/split). */
  function wagered() {
    return hands.reduce((sum, hand) => sum + hand.bet, 0);
  }

  /** True only when doubling is both a legal blackjack move (first decision of a row, exactly 2 cards) AND actually affordable (balance covers a second matching bet on top of everything already at stake). */
  function canAffordDouble() {
    const hand = activeHand();
    return Boolean(hand) && hand.cards.length === 2 && hand.bet > 0 && balance >= wagered() + hand.bet;
  }

  /** The "Splitsen" button is only offered on the very first decision, with a pair of the same rank, and only once per hand. */
  function isSplitPair() {
    const hand = activeHand();
    return handInProgress && hands.length === 1 && Boolean(hand) && hand.cards.length === 2 && hand.cards[0].rank === hand.cards[1].rank;
  }

  /** Splitting needs a second bet equal to the first one on top of what's already at stake — never more than the balance. */
  function canAffordSplit() {
    const hand = activeHand();
    return isSplitPair() && balance >= wagered() + hand.bet;
  }

  // -----------------------------------------------------------------
  // CARD RENDERING
  // -----------------------------------------------------------------
  // Builds one face-up card's <img>
  function buildCardImg(card) {
    const img = document.createElement('img');
    img.src = cardImageUrl(card, isLoggedIn());
    img.alt = `${card.rank} of ${card.suit}`;
    img.className = 'bj-card-img';
    return img;
  }

  // Builds the card-back <img> for the dealer's hidden hole card
  function buildHiddenCardImg() {
    const img = document.createElement('img');
    img.src = siteRootUrl('assets/icons/playing-cards/card-back-blue.png');
    img.alt = 'Verborgen kaart';
    img.className = 'bj-card-img';
    return img;
  }

  /** One split row: a small label ("Rij 1 (18)" + its result once settled) above its own row of cards. */
  function buildSplitRow(hand, index) {
    const row = document.createElement('div');
    row.className = 'bj-split-hand';
    if (handInProgress && index === activeIndex) row.classList.add('is-active');
    if (hand.result) row.classList.add(`is-${hand.result.outcome}`);

    const label = document.createElement('div');
    label.className = 'bj-split-label';
    const score = hand.cards.length ? ` (${handValue(hand.cards)})` : '';
    label.textContent = `Rij ${index + 1}${score}`;
    if (hand.result) {
      const badge = document.createElement('span');
      badge.className = 'bj-split-result';
      badge.textContent = hand.result.short;
      label.append(' ', badge);
    }

    const cards = document.createElement('div');
    cards.className = 'bj-cards';
    cards.replaceChildren(...hand.cards.map(buildCardImg));

    row.append(label, cards);
    return row;
  }

  // Redraws both hands' cards and running score totals
  function renderHands() {
    if (hands.length > 1) {
      playerCardsEl.classList.add('bj-cards--split');
      playerCardsEl.replaceChildren(...hands.map(buildSplitRow));
      playerScoreEl.textContent = ''; // every row shows its own total instead
    } else {
      playerCardsEl.classList.remove('bj-cards--split');
      const cards = hands[0]?.cards || [];
      playerCardsEl.replaceChildren(...cards.map(buildCardImg));
      playerScoreEl.textContent = cards.length ? `(${handValue(cards)})` : '';
    }

    const dealerNodes = dealerHand.map((card, index) => {
      if (index === 1 && dealerHoleHidden) return buildHiddenCardImg();
      return buildCardImg(card);
    });
    dealerCardsEl.replaceChildren(...dealerNodes);

    dealerScoreEl.textContent = dealerHoleHidden
      ? (dealerHand.length ? `(${rankValue(dealerHand[0].rank)}+?)` : '')
      : (dealerHand.length ? `(${handValue(dealerHand)})` : '');
  }

  /** Re-renders whatever's currently on the table with the correct card-art variant after a login/logout. */
  function renderCardsForAuthChange() {
    if (hands.length || dealerHand.length) renderHands();
  }

  // -----------------------------------------------------------------
  // GAME FLOW
  // -----------------------------------------------------------------
  // Updates the status line text
  function setStatus(text) {
    statusEl.textContent = text;
  }

  // Enables/disables Hit/Stand/Double/Split for the current decision point
  function setActionButtonsEnabled(enabled) {
    hitBtn.disabled = !enabled;
    standBtn.disabled = !enabled;
    doubleBtn.disabled = !enabled || !canAffordDouble();
    // "Splitsen" only exists on the first decision of a pair; once
    // anything else happens (or there's no pair) it's gone entirely.
    splitBtn.classList.toggle('hidden', !(enabled && isSplitPair()));
    splitBtn.disabled = !enabled || !canAffordSplit();
    splitBtn.title = isSplitPair() && !canAffordSplit() ? 'Je hebt niet genoeg chips voor een tweede inzet.' : '';
  }

  /** Prompt for whichever row is up next ("Rij 2: Hit, Stand, of Verdubbel?"). */
  function decisionPrompt() {
    const hand = activeHand();
    const prefix = hands.length > 1 ? `Rij ${activeIndex + 1}: ` : '';
    return `${prefix}${isSplitPair() ? 'Hit, Stand, Verdubbel of Splitsen?' : 'Hit, Stand, of Verdubbel?'}`;
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

  // Shuffles a fresh deck, deals both hands, and checks for an instant blackjack
  function dealHand() {
    if (bet <= 0 || bet > balance) return;

    deck = buildShuffledDeck();
    hands = [{ cards: [deck.pop(), deck.pop()], bet, fromSplit: false, result: null }];
    activeIndex = 0;
    dealerHand = [deck.pop(), deck.pop()];
    dealerHoleHidden = true;
    handInProgress = true;

    table.classList.remove('hidden');
    dealBtn.disabled = true;
    clearBetBtn.disabled = true;
    nextHandGroup.classList.add('hidden');
    renderHands();
    scrollToTable();

    const playerBJ = isBlackjack(hands[0].cards);
    const dealerBJ = isBlackjack(dealerHand);

    if (playerBJ || dealerBJ) {
      dealerHoleHidden = false;
      if (playerBJ && dealerBJ) {
        hands[0].result = { outcome: 'push', text: 'Allebei BlackJack! Gelijkspel, inzet terug.', short: 'gelijkspel' };
      } else if (playerBJ) {
        hands[0].result = { outcome: 'blackjack', text: 'BlackJack! Je wint 3:2. 🎉', short: 'BlackJack' };
      } else {
        hands[0].result = { outcome: 'lose', text: 'Dealer heeft BlackJack. Helaas.', short: 'verloren' };
      }
      renderHands();
      finishHand();
      return;
    }

    setActionButtonsEnabled(true);
    setStatus(decisionPrompt());
  }

  /** Marks the active row as busted and moves on (next row, or settle). */
  function bustActiveRow(singleHandText) {
    const hand = activeHand();
    hand.result = { outcome: 'lose', text: singleHandText, short: 'bust' };
    renderHands();
    moveOnAfterRow();
  }

  // Deals the player one more card, busting the row if it goes over 21
  function hit() {
    if (!handInProgress) return;
    const hand = activeHand();
    hand.cards.push(deck.pop());
    renderHands();

    if (handValue(hand.cards) > 21) {
      bustActiveRow('Bust! Je zit boven de 21.');
    } else {
      setActionButtonsEnabled(true); // 3+ cards now: double/split drop away by themselves
      setStatus(decisionPrompt());
    }
  }

  // Doubles this row's bet, deals exactly one more card, then moves on
  function double() {
    if (!handInProgress || !canAffordDouble()) return;
    const hand = activeHand();
    hand.bet *= 2;
    updateBalanceUI();
    hand.cards.push(deck.pop());
    renderHands();

    if (handValue(hand.cards) > 21) {
      bustActiveRow('Bust na verdubbelen! Helaas.');
    } else {
      moveOnAfterRow();
    }
  }

  // Locks in the current row and moves on (next row, or the dealer)
  function stand() {
    if (!handInProgress) return;
    moveOnAfterRow();
  }

  // Splits a pair into two rows with an equal bet each; row 1 is played first
  function split() {
    if (!handInProgress || !canAffordSplit()) return;
    const [first, second] = hands[0].cards;
    const rowBet = hands[0].bet;

    hands = [
      { cards: [first], bet: rowBet, fromSplit: true, result: null },
      { cards: [second], bet: rowBet, fromSplit: true, result: null },
    ];
    activeIndex = 0;
    hands[0].cards.push(deck.pop()); // row 1 gets its second card now; row 2 gets its own when it's its turn

    updateBalanceUI();
    renderHands();
    setActionButtonsEnabled(true);
    setStatus(decisionPrompt());
  }

  /** After a row is done (stand / double / bust): play the next row, or — when it was the last one — the dealer. */
  function moveOnAfterRow() {
    if (activeIndex < hands.length - 1) {
      activeIndex += 1;
      const next = activeHand();
      if (next.cards.length === 1) next.cards.push(deck.pop());
      renderHands();
      setActionButtonsEnabled(true);
      setStatus(decisionPrompt());
      return;
    }
    dealerPlaysOutAndFinish();
  }

  // Reveals the hole card, draws for the dealer until 17+ (only if some row is still alive), then settles every row
  function dealerPlaysOutAndFinish() {
    dealerHoleHidden = false;
    setActionButtonsEnabled(false);

    const aliveRows = hands.filter((hand) => !hand.result);
    if (aliveRows.length > 0) {
      while (handValue(dealerHand) < 17) {
        dealerHand.push(deck.pop());
      }
    }

    const dealerTotal = handValue(dealerHand);
    aliveRows.forEach((hand) => {
      const playerTotal = handValue(hand.cards);
      if (dealerTotal > 21) {
        hand.result = { outcome: 'win', text: 'Dealer bust! Jij wint. 🎉', short: 'gewonnen' };
      } else if (dealerTotal > playerTotal) {
        hand.result = { outcome: 'lose', text: `Dealer wint met ${dealerTotal} tegen ${playerTotal}.`, short: `verloren (${playerTotal}-${dealerTotal})` };
      } else if (dealerTotal < playerTotal) {
        hand.result = { outcome: 'win', text: `Jij wint met ${playerTotal} tegen ${dealerTotal}! 🎉`, short: `gewonnen (${playerTotal}-${dealerTotal})` };
      } else {
        hand.result = { outcome: 'push', text: `Gelijkspel op ${playerTotal}. Inzet terug.`, short: `gelijkspel (${playerTotal})` };
      }
    });

    renderHands();
    finishHand();
  }

  /** Chip change for one settled row. */
  function rowDelta(hand) {
    switch (hand.result.outcome) {
      case 'blackjack': return hand.bet * 1.5;
      case 'win': return hand.bet;
      case 'lose': return -hand.bet;
      default: return 0; // push: bet returned
    }
  }

  // Settles the balance for every row (each on its own) and shows the result
  function finishHand() {
    handInProgress = false;
    setActionButtonsEnabled(false);

    // clampChips() — belt-and-braces on top of the affordability checks
    // (placeBet/double/split already prevent staking more than the
    // balance), so a balance can never end up negative even if those
    // checks are ever loosened.
    const net = hands.reduce((sum, hand) => sum + rowDelta(hand), 0);
    balance = clampChips(balance + net);

    if (hands.length === 1) {
      setStatus(hands[0].result.text);
    } else {
      const parts = hands.map((hand, index) => `Rij ${index + 1}: ${hand.result.short}`);
      const netText = net > 0 ? `+${net}` : String(net);
      setStatus(`${parts.join(' · ')} — netto ${netText} chips.`);
    }

    previousBet = bet; // the original stake, not what doubles/splits added on top
    bet = 0;
    renderHands(); // re-render: the active-row highlight is gone now
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
    hands = [];
    activeIndex = 0;
    dealerHand = [];
    dealerHoleHidden = false;
    playerCardsEl.classList.remove('bj-cards--split');
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
  splitBtn.addEventListener('click', split);
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
