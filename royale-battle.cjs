'use strict';
/**
 * Royale Battle — 3-card Red vs Blue chat-room game (virtual coins only).
 * Pure Node.js, no dependencies. Use RoyaleBattleManager (bottom of this file):
 *   send(roomId, text)   -> post a message into a room as the bot
 *   store                -> balance store with crash-safe bets (see the STORAGE section)
 *   isAdmin(user, room)  -> is this user an admin of the room
 * and forward every room message to manager.handleMessage(roomId, user, text).
 */
const crypto = require('crypto');

const HOUR = 3600 * 1000;

/* ======================= CONFIG ======================= */
const CONFIG = {
  BET_SECONDS: 45,            // betting window
  RESULT_PAUSE_SECONDS: 10,   // pause after the result before the next round
  MIN_BET: 100,
  MAX_BET: null,              // e.g. 100000, or null for no limit
  PAYOUTS: { red: 1.9, blue: 1.9, jutt: 5, color: 10, run: 20, doublerun: 100, tirel: 200 },
  // How often the WINNING side should show each special hand.
  // Every window a random count in [min, max] is chosen and spread at random times.
  SCHEDULE: {
    jutt:      { min: 5, max: 10, windowMs: 1 * HOUR },
    color:     { min: 2, max: 3,  windowMs: 1 * HOUR },
    run:       { min: 1, max: 2,  windowMs: 1 * HOUR },
    doublerun: { min: 2, max: 4,  windowMs: 6 * HOUR },
    tirel:     { min: 2, max: 3,  windowMs: 12 * HOUR },
  },
  COIN_NAME: 'coins',
  START_ADMIN_ONLY: true,     // only admins may type !start
  QUEUE_STOP: false,          // false: /bot stop is refused while a round runs (admin must retry after the round).
                              // true : /bot stop during a round is queued and executes when the round ends.
  NOTIFY_REFUNDS: true,       // announce in the room when bets were refunded after a crash/restart
};

const OPTION_LABEL = {
  red: 'Red', blue: 'Blue', jutt: 'Jutt', color: 'Color',
  run: 'Run', doublerun: 'Double Run', tirel: 'Tirel',
};
const HAND_LABEL = {
  high: 'High Card', jutt: 'Jutt', color: 'Color',
  run: 'Run', doublerun: 'Double Run', tirel: 'Tirel',
};
const HAND_STRENGTH = { high: 1, jutt: 2, color: 3, run: 4, doublerun: 5, tirel: 6 };
const OPTION_ALIASES = {
  red: 'red', r: 'red', blue: 'blue', b: 'blue',
  jutt: 'jutt', color: 'color', colour: 'color',
  run: 'run', doublerun: 'doublerun', dr: 'doublerun', tirel: 'tirel',
};

/* ======================= CARDS ======================= */
const SUITS = ['S', 'H', 'D', 'C'];
const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const rankLabel = (r) => RANK_LABEL[r] || String(r);
const cardStr = (c) => rankLabel(c.r) + SUIT_SYMBOL[c.s];
const cardId = (c) => c.r + c.s;

const rnd = (n) => crypto.randomInt(n);
const pick = (arr) => arr[rnd(arr.length)];
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function fullDeck() {
  const deck = [];
  for (const s of SUITS) for (let r = 2; r <= 14; r++) deck.push({ r, s });
  return deck;
}

// The 12 possible runs (ranking is handled in evaluate(): A-K-Q > A-2-3 > K-Q-J > ... > 2-3-4).
const SEQUENCES = [[3, 2, 14]];
for (let h = 4; h <= 14; h++) SEQUENCES.push([h, h - 1, h - 2]);

function isRunRanks(ranks) {
  const r = [...ranks].sort((a, b) => b - a);
  if (r[0] - 1 === r[1] && r[1] - 1 === r[2]) return true;
  return r[0] === 14 && r[1] === 3 && r[2] === 2;
}

/* ======================= HAND EVALUATION ======================= */
function evaluate(cards) {
  const ranks = cards.map((c) => c.r).sort((a, b) => b - a);
  const flush = cards.every((c) => c.s === cards[0].s);
  const run = isRunRanks(ranks);
  // Run order: A-K-Q (15) > A-2-3 (14) > K-Q-J (13) > Q-J-10 (12) > ... > 2-3-4 (4)
  let runHigh = ranks[0];
  if (ranks[0] === 14 && ranks[1] === 3) runHigh = 14;      // A-2-3 is the 2nd best run
  else if (ranks[0] === 14) runHigh = 15;                   // A-K-Q is the best run

  let type, key;
  if (ranks[0] === ranks[2]) { type = 'tirel'; key = [ranks[0]]; }
  else if (run && flush) { type = 'doublerun'; key = [runHigh]; }
  else if (run) { type = 'run'; key = [runHigh]; }
  else if (flush) { type = 'color'; key = ranks; }
  else if (ranks[0] === ranks[1] || ranks[1] === ranks[2]) {
    const pair = ranks[1]; // the middle card is always part of the pair
    const kicker = ranks.find((x) => x !== pair);
    type = 'jutt'; key = [pair, kicker];
  } else { type = 'high'; key = ranks; }
  return { type, strength: HAND_STRENGTH[type], key };
}

// > 0 if a beats b, < 0 if b beats a, 0 if identical by rank.
function compareHands(a, b) {
  if (a.strength !== b.strength) return a.strength - b.strength;
  for (let i = 0; i < Math.max(a.key.length, b.key.length); i++) {
    const d = (a.key[i] || 0) - (b.key[i] || 0);
    if (d) return d;
  }
  return 0;
}

/* ======================= DEALING ======================= */
function distinctRanks(n) {
  const set = new Set();
  while (set.size < n) set.add(2 + rnd(13));
  return [...set];
}

// Build a random 3-card hand of exactly the requested type.
function makeHand(type) {
  switch (type) {
    case 'tirel': {
      const r = 2 + rnd(13);
      return shuffle([...SUITS]).slice(0, 3).map((s) => ({ r, s }));
    }
    case 'doublerun': {
      const seq = pick(SEQUENCES); const s = pick(SUITS);
      return seq.map((r) => ({ r, s }));
    }
    case 'run': {
      const seq = pick(SEQUENCES); let suits;
      do { suits = seq.map(() => pick(SUITS)); } while (suits.every((x) => x === suits[0]));
      return seq.map((r, i) => ({ r, s: suits[i] }));
    }
    case 'color': {
      const s = pick(SUITS); let ranks;
      do { ranks = distinctRanks(3); } while (isRunRanks(ranks));
      return ranks.map((r) => ({ r, s }));
    }
    case 'jutt': {
      const pr = 2 + rnd(13); let k;
      do { k = 2 + rnd(13); } while (k === pr);
      const ps = shuffle([...SUITS]).slice(0, 2);
      return [...ps.map((s) => ({ r: pr, s })), { r: k, s: pick(SUITS) }];
    }
    case 'high': {
      let ranks, suits;
      do {
        ranks = distinctRanks(3);
        suits = ranks.map(() => pick(SUITS));
      } while (isRunRanks(ranks) || suits.every((x) => x === suits[0]));
      return ranks.map((r, i) => ({ r, s: suits[i] }));
    }
    default: throw new Error('unknown hand type ' + type);
  }
}

/**
 * Deal one round. `target` = the hand type the WINNING side must have
 * ('jutt' | 'color' | 'run' | 'doublerun' | 'tirel'), or null for a plain High Card round.
 * Both sides come from one deck (no shared cards), and the loser always has a strictly
 * lower hand, so there are never ties.
 */
function dealRound(target = null) {
  const type = target || 'high';
  const winner = rnd(2) === 0 ? 'red' : 'blue';
  const loser = winner === 'red' ? 'blue' : 'red';
  for (let i = 0; i < 5000; i++) {
    const wCards = makeHand(type);
    const used = new Set(wCards.map(cardId));
    const remaining = fullDeck().filter((c) => !used.has(cardId(c)));
    const wEval = evaluate(wCards);
    for (let j = 0; j < 300; j++) {
      const lCards = shuffle([...remaining]).slice(0, 3);
      const lEval = evaluate(lCards);
      if (compareHands(wEval, lEval) > 0) {
        return {
          winner,
          hands: { [winner]: wCards, [loser]: lCards },
          evals: { [winner]: wEval, [loser]: lEval },
          winningType: wEval.type,
        };
      }
    }
  }
  throw new Error('could not deal a round for ' + type);
}

/* ======================= FREQUENCY PLANNER ======================= */
// Special hands: rarest first when several are due in the same round.
const PRIORITY = ['tirel', 'doublerun', 'run', 'color', 'jutt'];

class Planner {
  constructor(schedule = CONFIG.SCHEDULE, now = Date.now()) {
    this.schedule = schedule;
    this.plans = {};
    for (const k of Object.keys(schedule)) this._roll(k, now);
  }
  _roll(k, start) {
    const { min, max, windowMs } = this.schedule[k];
    const count = min + rnd(max - min + 1);
    const times = Array.from({ length: count }, () => start + rnd(windowMs)).sort((a, b) => a - b);
    const carry = this.plans[k] ? this.plans[k].times : []; // overdue events are not lost
    this.plans[k] = { end: start + windowMs, times: [...carry, ...times] };
  }
  /** Returns the special hand type the next round must show, or null. */
  next(now = Date.now()) {
    for (const k of Object.keys(this.schedule)) {
      while (this.plans[k].end <= now) this._roll(k, this.plans[k].end);
    }
    for (const k of PRIORITY) {
      const p = this.plans[k];
      if (p && p.times.length && p.times[0] <= now) { p.times.shift(); return k; }
    }
    return null;
  }
  serialize() { return JSON.stringify(this.plans); }
  restore(json) { this.plans = JSON.parse(json); }
}

/* ======================= STORAGE ======================= */
/**
 * Balance store interface (all methods async). Replace with your database if you like.
 *
 *   getBalance(userId)                 -> number
 *   placeBet({roomId, roundId, userId, name, option, amount})
 *        -> new balance, or null if the user has not enough coins.
 *        MUST, in ONE atomic step, deduct `amount` AND durably record the bet as "pending".
 *   settleRound({roomId, roundId, payouts: [{userId, amount}]})
 *        MUST, in ONE atomic step, credit all payouts AND clear that round's pending bets.
 *   refundPending(roomId?)             -> [{roomId, roundId, userId, name, option, amount}]
 *        MUST, in ONE atomic step, give every pending bet back (of one room, or of ALL rooms
 *        when roomId is omitted) and clear them. Used for crash recovery at server start
 *        and when a round has to be cancelled.
 *   top(n) / touch(userId, name)       -> optional (!top and display names)
 *
 * Because a bet is recorded together with the deduction, and cleared together with the
 * payout, a crash at any moment leaves the bet in "pending" -> it is refunded on next start.
 */
class MemoryStore {
  constructor(startingCoins = 10000) {
    this.start = startingCoins;
    this.users = new Map();    // userId -> { name, balance }
    this.pending = new Map();  // roomId -> [{ roundId, userId, name, option, amount }]
  }
  _changed(/* durable */) {}   // hook: FileStore writes to disk here

  _u(id, name) {
    id = String(id);
    if (!this.users.has(id)) this.users.set(id, { name: name || id, balance: this.start });
    return this.users.get(id);
  }
  async touch(id, name) {
    const u = this._u(id, name);
    if (name && u.name !== name) { u.name = name; this._changed(false); }
  }
  async getBalance(id) { return this._u(id).balance; }

  async placeBet({ roomId, roundId, userId, name, option, amount }) {
    const u = this._u(userId, name);
    if (u.balance < amount) return null;
    u.balance -= amount;
    if (!this.pending.has(roomId)) this.pending.set(roomId, []);
    this.pending.get(roomId).push({ roundId, userId: String(userId), name, option, amount });
    this._changed(true);
    return u.balance;
  }

  async settleRound({ roomId, roundId, payouts }) {
    for (const p of payouts) this._u(p.userId).balance += p.amount;
    const rest = (this.pending.get(roomId) || []).filter((b) => b.roundId !== roundId);
    if (rest.length) this.pending.set(roomId, rest); else this.pending.delete(roomId);
    this._changed(true);
  }

  async refundPending(roomId) {
    const rooms = roomId === undefined ? [...this.pending.keys()] : [roomId];
    const refunded = [];
    for (const r of rooms) {
      for (const b of this.pending.get(r) || []) {
        this._u(b.userId).balance += b.amount;
        refunded.push({ roomId: r, ...b });
      }
      this.pending.delete(r);
    }
    if (refunded.length) this._changed(true);
    return refunded;
  }

  async top(n = 10) {
    return [...this.users.entries()]
      .map(([userId, u]) => ({ userId, name: u.name, balance: u.balance }))
      .sort((a, b) => b.balance - a.balance).slice(0, n);
  }
}

/* ======================= GAME (one room) ======================= */
const fmt = (n) => Number(n).toLocaleString('en-US');

function parseAmount(s) {
  const m = /^(\d+(?:\.\d+)?)(k|m)?$/i.exec(s || '');
  if (!m) return null;
  const mult = { k: 1e3, m: 1e6 }[(m[2] || '').toLowerCase()] || 1;
  const v = Math.floor(parseFloat(m[1]) * mult + 1e-9);
  return v > 0 ? v : null;
}

/**
 * phase:  'ready'    bot is in the room but the game has not been started (!start)
 *         'betting'  bets open
 *         'dealing'  bets closed, cards dealt, payouts being settled
 *         'between'  round finished, short pause before the next round  (bot CAN be stopped now)
 *         'stopped'  bot removed from the room
 */
class RoyaleBattle {
  constructor({ roomId, send, store, config = CONFIG, planner, now = () => Date.now(), onRound = null, onStopped = null }) {
    this.roomId = roomId;
    this.send = send;           // send(text) -> post into this room as the bot
    this.store = store;
    this.cfg = config;
    this.now = now;
    this.onRound = onRound;     // optional: called after every round (logging / audit)
    this.onStopped = onStopped; // called when the bot has stopped
    this.planner = planner || new Planner(config.SCHEDULE, now());
    this.phase = 'ready';
    this.roundId = 0;
    this.deadline = null; this.last = null;   // panel info
    this.bets = new Map();      // userId -> { name, opts: { red: 500, ... } }
    this.inflight = new Set();  // bets still being written to the store
    this.stopAfterRound = false;
    this.timer = null;
  }

  /** Bot joins the room (does not start rounds yet). */
  attach() {
    this.phase = 'ready';
    this.send('🎴 Royale Battle Bot is now in this room. Admin: type !start to begin.');
  }

  /** Start the rounds. Returns false if it is not in the 'ready' phase. */
  start() {
    if (this.phase !== 'ready') return false;
    this._startRound();
    return true;
  }

  /**
   * Stop the bot. Allowed only when no round is running ('ready' or 'between').
   * While a round is running it is refused, unless config.QUEUE_STOP is on
   * (then the stop happens automatically when the round ends).
   * Returns { ok, queued }.
   */
  requestStop() {
    if (this.phase === 'ready' || this.phase === 'between') { this._halt(); return { ok: true }; }
    if (this.phase === 'betting' || this.phase === 'dealing') {
      if (this.cfg.QUEUE_STOP) { this.stopAfterRound = true; return { ok: false, queued: true }; }
      return { ok: false, queued: false };
    }
    return { ok: false, queued: false };
  }

  _halt() {
    clearTimeout(this.timer);
    this.phase = 'stopped';
    this.send('🛑 Royale Battle Bot stopped.');
    if (this.onStopped) this.onStopped(this);
  }

  /** Silent stop for server shutdown (no message). */
  shutdown() { clearTimeout(this.timer); this.phase = 'stopped'; }

  _startRound() {
    this.roundId++;
    this.bets = new Map();
    this.phase = 'betting';
    const c = this.cfg;
    const opts = Object.keys(c.PAYOUTS).map((k) => `${OPTION_LABEL[k]} ${c.PAYOUTS[k]}x`).join(' · ');
    this.send(
      `🎴 New round! Type !bet [option] [amount] to bet (e.g. !bet red 500).\n` +
      `Options: ${opts}\n` +
      `Category bets pay only when the winning side has that hand; a category on the losing side does not win.\n` +
      `[${c.BET_SECONDS} seconds]`
    );
    this.deadline = Date.now() + c.BET_SECONDS * 1000;
    this.timer = setTimeout(() => this._closeAndDeal(), c.BET_SECONDS * 1000);
  }

  async _closeAndDeal() {
    this.phase = 'dealing'; this.deadline = null;                       // new bets are rejected from now on
    const c = this.cfg;
    try {
      await Promise.allSettled([...this.inflight]); // bets already being written still count

      const lines = [];
      for (const b of this.bets.values()) {
        const total = Object.values(b.opts).reduce((a, x) => a + x, 0);
        const parts = Object.entries(b.opts).map(([k, v]) => `${OPTION_LABEL[k]}: ${fmt(v)}`).join(', ');
        lines.push(`${b.name} has ${fmt(total)} ${c.COIN_NAME} on the table — ${parts}`);
      }
      if (lines.length) this.send(lines.join('\n'));

      const target = this.planner.next(this.now());
      const r = dealRound(target);
      const show = (side) => `${r.hands[side].map(cardStr).join(' ')} — ${HAND_LABEL[r.evals[side].type]}`;
      const catLabel = HAND_LABEL[r.winningType];
      const icon = r.winner === 'red' ? '🔴' : '🔵';

      // Payouts: the winning side + the winning side's hand category
      const payouts = []; const winnerLines = [];
      for (const [userId, b] of this.bets) {
        let paid = 0; const hit = [];
        for (const [opt, amount] of Object.entries(b.opts)) {
          if (opt === r.winner || (r.winningType !== 'high' && opt === r.winningType)) {
            paid += Math.floor(amount * c.PAYOUTS[opt] + 1e-9);
            hit.push(`${fmt(amount)} on ${OPTION_LABEL[opt]}`);
          }
        }
        if (paid > 0) {
          payouts.push({ userId, amount: paid });
          winnerLines.push(`- ${b.name} won ${fmt(paid)} ${c.COIN_NAME} (${hit.join(', ')})`);
        }
      }

      // Credits the winners AND clears this round's pending bets in one atomic step.
      await this.store.settleRound({ roomId: this.roomId, roundId: this.roundId, payouts });

      if (this.onRound) {
        try {
          this.onRound({
            roomId: this.roomId, roundId: this.roundId, at: this.now(), target,
            winner: r.winner, winningType: r.winningType,
            hands: { red: r.hands.red.map(cardStr), blue: r.hands.blue.map(cardStr) },
            bets: [...this.bets].map(([userId, b]) => ({ userId, name: b.name, opts: b.opts })),
            payouts,
          });
        } catch (e) { console.error('[RoyaleBattle] onRound hook failed', e); }
      }

      this.last = { roundId: this.roundId, winner: r.winner, type: r.winningType, label: catLabel,
        hands: { red: r.hands.red.map(cardStr), blue: r.hands.blue.map(cardStr) },
        handLabel: { red: HAND_LABEL[r.evals.red.type], blue: HAND_LABEL[r.evals.blue.type] },
        payouts: payouts.map((p) => ({ userId: p.userId, amount: p.amount })) };
      this.send(
        `🔴 Red: ${show('red')}\n🔵 Blue: ${show('blue')}\n\n` +
        `${icon} ${OPTION_LABEL[r.winner]} wins with ${catLabel}!\n` +
        `Hand-category result: ${catLabel} (only the winning side's category pays).` +
        (winnerLines.length ? `\n\n${winnerLines.join('\n')}` : '')
      );
    } catch (e) {
      console.error('[RoyaleBattle] round failed, refunding bets', e);
      try {
        await this.store.refundPending(this.roomId);
        this.send('⚠️ This round was cancelled because of an error. All bets were refunded.');
      } catch (e2) { console.error('[RoyaleBattle] REFUND FAILED — check the pending bets in the store', e2); }
    }

    // ---- round finished ----
    this.bets = new Map();
    this.phase = 'between'; this.deadline = Date.now() + c.RESULT_PAUSE_SECONDS * 1000;
    if (this.stopAfterRound) { this.stopAfterRound = false; this._halt(); return; }
    this.timer = setTimeout(() => this._startRound(), c.RESULT_PAUSE_SECONDS * 1000);
  }

  /* ---- player commands (!bet, !balance, !top) ---- */
  async handleMessage(userId, userName, text) {
    const t = String(text || '').trim();
    if (!t.startsWith('!') || this.phase === 'stopped') return;
    const [cmd, ...rest] = t.split(/\s+/);
    if (this.store.touch) await this.store.touch(userId, userName);
    switch (cmd.toLowerCase()) {
      case '!bet': return this._bet(userId, userName, rest);
      case '!balance': case '!bal': {
        const b = await this.store.getBalance(userId);
        return this.send(`${userName}, your balance: ${fmt(b)} ${this.cfg.COIN_NAME}`);
      }
      case '!top': {
        if (!this.store.top) return;
        const rows = await this.store.top(10);
        return this.send('🏆 Top players\n' +
          rows.map((x, i) => `${i + 1}. ${x.name} — ${fmt(x.balance)}`).join('\n'));
      }
    }
  }

  async _bet(userId, userName, args) {
    const c = this.cfg;
    if (this.phase === 'ready') return this.send(`${userName}, the game has not started yet. An admin must type !start.`);
    if (this.phase !== 'betting') return this.send(`${userName}, betting is closed. Wait for the next round.`);
    if (args.length < 2) return this.send(`${userName}, usage: !bet [option] [amount] (e.g. !bet red 500)`);

    const amount = parseAmount(args[args.length - 1]);
    const opt = OPTION_ALIASES[args.slice(0, -1).join('').toLowerCase()];
    if (!opt) return this.send(`${userName}, unknown option. Use: Red, Blue, Jutt, Color, Run, Double Run, Tirel.`);
    if (!amount) return this.send(`${userName}, invalid amount.`);
    if (amount < c.MIN_BET) return this.send(`${userName}, minimum bet is ${fmt(c.MIN_BET)}.`);
    if (c.MAX_BET && amount > c.MAX_BET) return this.send(`${userName}, maximum bet is ${fmt(c.MAX_BET)}.`);

    const rid = this.roundId;
    const job = (async () => {
      // Deducts the coins AND records the bet as pending, atomically.
      const left = await this.store.placeBet({
        roomId: this.roomId, roundId: rid, userId: String(userId), name: userName, option: opt, amount,
      });
      if (left === null) return this.send(`${userName}, not enough ${c.COIN_NAME}.`);
      const b = this.bets.get(String(userId)) || { name: userName, opts: {} };
      b.opts[opt] = (b.opts[opt] || 0) + amount;
      this.bets.set(String(userId), b);
      this.send(`✅ ${userName} bet ${fmt(amount)} on ${OPTION_LABEL[opt]} (balance ${fmt(left)})`);
    })();
    this.inflight.add(job);
    try { await job; } finally { this.inflight.delete(job); }
  }
}

/* ======================= ROOM MANAGER (admin commands) ======================= */
/**
 * Admin commands:
 *   /bot royalebattle   -> the bot joins the room (ready, not started)
 *   !start              -> starts the rounds
 *   /bot stop           -> removes the bot; refused while a round is running, works once the round has ended
 * Everything else (!bet, !balance, !top) goes to the room's game.
 */
class RoyaleBattleManager {
  /**
   * @param send     (roomId, text) => post a message into that room as the bot
   * @param store    balance store (see MemoryStore for the interface)
   * @param isAdmin  (user, roomId) => boolean | Promise<boolean>   default: user.isAdmin
   * @param plannerFile  optional path; keeps the hand-frequency plan across restarts
   */
  constructor({ send, store, config = CONFIG, isAdmin = (u) => !!(u && u.isAdmin), onRound = null, plannerFile = null, now = () => Date.now() }) {
    this.send = send; this.store = store; this.cfg = config; this.isAdmin = isAdmin;
    this.onRound = onRound; this.plannerFile = plannerFile; this.now = now;
    this.rooms = new Map();   // roomId -> RoyaleBattle
    this.savedPlans = {};
    if (plannerFile) {
      try { this.savedPlans = JSON.parse(require('fs').readFileSync(plannerFile, 'utf8')); } catch (e) { /* first run */ }
    }
  }

  /** Call ONCE at server start, before handling messages. Refunds the bets of any round that was interrupted. */
  async init() {
    const refunded = await this.store.refundPending();
    if (refunded.length) {
      console.log(`[RoyaleBattle] crash recovery: refunded ${refunded.length} bet(s)`);
      if (this.cfg.NOTIFY_REFUNDS) {
        for (const roomId of new Set(refunded.map((b) => b.roomId))) {
          this.send(roomId, '⚠️ The server restarted during a round. All bets of that round were refunded automatically.');
        }
      }
    }
    return refunded;
  }

  async handleMessage(roomId, user, text) {
    const t = String(text || '').trim().replace(/\s+/g, ' ');
    const low = t.toLowerCase();
    const game = this.rooms.get(roomId);
    const say = (m) => this.send(roomId, m);
    const admin = async () => !!(await this.isAdmin(user, roomId));

    if (low === '/bot royalebattle') {
      if (!(await admin())) return say('Only admins can add the bot to a room.');
      if (game) return say('Royale Battle Bot is already in this room.');
      return this._create(roomId).attach();
    }

    if (!game) return;   // no Royale Battle bot in this room: ignore everything else (other bots may use these commands)

    if (low === '/bot stop') {
      if (!(await admin())) return say('Only admins can stop the bot.');
      const r = game.requestStop();
      if (r.queued) return say('⏳ A round is running. The bot will stop when this round ends.');
      if (!r.ok) return say('⛔ A round is running — the bot cannot be stopped now. Try /bot stop again after the round ends.');
      return;   // stopped (game.onStopped already removed the room)
    }

    if (low === '!start') {
      if (this.cfg.START_ADMIN_ONLY && !(await admin())) return say('Only admins can start the game.');
      if (!game.start()) return say('The game is already running.');
      return;
    }

    return game.handleMessage(user.id, user.name, t);
  }

  _create(roomId) {
    const planner = new Planner(this.cfg.SCHEDULE, this.now());
    if (this.savedPlans[roomId]) { try { planner.plans = this.savedPlans[roomId]; } catch (e) { /* ignore */ } }
    const game = new RoyaleBattle({
      roomId, store: this.store, config: this.cfg, planner, now: this.now, onRound: this.onRound,
      send: (text) => this.send(roomId, text),
      onStopped: () => this.rooms.delete(roomId),
    });
    this.rooms.set(roomId, game);
    return game;
  }

  savePlanners() {
    if (!this.plannerFile) return;
    for (const [roomId, g] of this.rooms) this.savedPlans[roomId] = g.planner.plans;
    require('fs').writeFileSync(this.plannerFile, JSON.stringify(this.savedPlans));
  }

  /** Clean server shutdown: stop all timers, save the plan, refund any bets of a round in progress. */
  async shutdown() {
    this.savePlanners();
    for (const g of this.rooms.values()) g.shutdown();
    await this.store.refundPending();
  }
}

module.exports = {
  RoyaleBattle, RoyaleBattleManager, MemoryStore, Planner,
  dealRound, evaluate, compareHands, CONFIG, cardStr,
};
