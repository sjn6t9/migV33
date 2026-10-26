'use strict';
/**
 * Teen Patti Gold — 3-card poker for chat rooms (virtual coins only).
 * Pure JavaScript, no dependencies (works in Node.js and, for the demo, in a browser).
 *
 * Use TeenPattiManager (bottom of this file):
 *   send(roomId, text)                 -> post a message into a room as the bot
 *   sendPrivate(roomId, userId, text)  -> send a private message to ONE user (for !see)   [optional but recommended]
 *   store                              -> the SAME balance store you use for Royale Battle (see STORAGE below)
 *   isAdmin(user, roomId)              -> is this user an admin of the room
 *   onState(roomId)                    -> called after every change; push manager.getView(roomId, userId) to the panel (UI)
 * and forward every room message to manager.handleMessage(roomId, user, text).
 */

/* ======================= CONFIG ======================= */
const CONFIG = {
  DEFAULT_BOOT: 200,          // boot when an admin types just "/bot teenpatti" (or "/bot teenpatti 500")
  MAX_SEATS: 10,
  MIN_PLAYERS: 2,
  JOIN_SECONDS: 30,           // join window after !start
  TURN_SECONDS: 15,           // per-player turn timer (15 s, as in the reference game)
  RAKE_PERCENT: 10,           // house fee taken from the pot (inferred from the reference: 2,800 pot -> 2,520 paid)
  SHOW_COST_MULT: 2,          // Show costs 2 x the current stake ("Show = double of blind")
  MAX_STAKE_MULT: 64,         // the stake can never grow beyond boot x this
  START_ADMIN_ONLY: false,    // anyone may type !start (the first one opens the table)
  AUTO_CALL_DELAY_MS: 700,    // pause before an "auto call" plays
  COIN_NAME: 'coins',
  NOTIFY_REFUNDS: true,       // tell the room when coins were refunded after a crash/restart
};

/* ======================= CARDS ======================= */
const SUITS = ['S', 'H', 'D', 'C'];
const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RANK_LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const rankLabel = (r) => RANK_LABEL[r] || String(r);
const cardStr = (c) => rankLabel(c.r) + SUIT_SYMBOL[c.s];
const cardsStr = (cs) => cs.map(cardStr).join(' ');

function randInt(n) {                      // unbiased, cryptographically secure
  const c = (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues)
    ? globalThis.crypto : require('crypto').webcrypto;
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  let x;
  do { c.getRandomValues(buf); x = buf[0]; } while (x >= limit);
  return x % n;
}

function fullDeck() {
  const deck = [];
  for (const s of SUITS) for (let r = 2; r <= 14; r++) deck.push({ r, s });
  return deck;
}
function shuffle(arr, rng = randInt) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ======================= HAND EVALUATION ======================= */
// High Card < Jutt (pair) < Color (flush) < Run < Double Run (straight flush) < Tirel (trail)
const HAND_LABEL = { high: 'High Card', jutt: 'Jutt', color: 'Color', run: 'Run', doublerun: 'Double Run', tirel: 'Tirel' };
const HAND_STRENGTH = { high: 1, jutt: 2, color: 3, run: 4, doublerun: 5, tirel: 6 };

function isRunRanks(ranks) {
  const r = [...ranks].sort((a, b) => b - a);
  if (r[0] - 1 === r[1] && r[1] - 1 === r[2]) return true;
  return r[0] === 14 && r[1] === 3 && r[2] === 2;                  // A-2-3
}

function evaluate(cards) {
  const ranks = cards.map((c) => c.r).sort((a, b) => b - a);
  const flush = cards.every((c) => c.s === cards[0].s);
  const run = isRunRanks(ranks);
  // Run order: A-K-Q (15) > A-2-3 (14) > K-Q-J (13) > Q-J-10 (12) > ... > 2-3-4 (4)
  let runHigh = ranks[0];
  if (ranks[0] === 14 && ranks[1] === 3) runHigh = 14;
  else if (ranks[0] === 14) runHigh = 15;

  let type, key;
  if (ranks[0] === ranks[2]) { type = 'tirel'; key = [ranks[0]]; }
  else if (run && flush) { type = 'doublerun'; key = [runHigh]; }
  else if (run) { type = 'run'; key = [runHigh]; }
  else if (flush) { type = 'color'; key = ranks; }
  else if (ranks[0] === ranks[1] || ranks[1] === ranks[2]) {
    const pair = ranks[1];                                         // the middle card is always in the pair
    type = 'jutt'; key = [pair, ranks.find((x) => x !== pair)];
  } else { type = 'high'; key = ranks; }
  return { type, name: HAND_LABEL[type], strength: HAND_STRENGTH[type], key };
}

// > 0 if a beats b, < 0 if b beats a, 0 if identical by rank (possible: same ranks, different suits).
function compareHands(a, b) {
  if (a.strength !== b.strength) return a.strength - b.strength;
  for (let i = 0; i < Math.max(a.key.length, b.key.length); i++) {
    const d = (a.key[i] || 0) - (b.key[i] || 0);
    if (d) return d;
  }
  return 0;
}

/* ======================= STORAGE ======================= */
/**
 * Teen Patti uses the SAME balance store as Royale Battle (one wallet for all games) and adds three
 * methods with their own "pending" journal (tpPending), so it never mixes with Royale's pending bets:
 *
 *   tpDebit({key, handId, userId, name, amount})
 *        -> new balance, or null if not enough coins.
 *        MUST, in ONE atomic step, deduct `amount` AND durably record it as "pending" under `key` (= room).
 *   tpSettle({key, handId, payouts: [{userId, amount}]})
 *        MUST, in ONE atomic step, credit the payouts AND clear that hand's pending entries.
 *   tpRefund(key?)   -> [{key, handId, userId, name, amount}]
 *        MUST, in ONE atomic step, give every pending entry back (of one room, or of ALL rooms when
 *        `key` is omitted) and clear them. Used for crash recovery at start-up and to cancel a hand.
 *
 * A crash at any moment leaves the coins in "pending" -> refunded automatically at the next start.
 * attachTeenPatti(store) adds these methods to Royale's MemoryStore / FileStore (needs _u() and _changed()).
 */
const TP_STORE_METHODS = {
  async tpDebit({ key, handId, userId, name, amount }) {
    const u = this._u(userId, name);
    if (!(amount > 0) || u.balance < amount) return null;
    u.balance -= amount;
    if (!this.tpPending.has(key)) this.tpPending.set(key, []);
    this.tpPending.get(key).push({ handId, userId: String(userId), name, amount });
    this._changed(true);
    return u.balance;
  },
  async tpSettle({ key, handId, payouts }) {
    for (const p of payouts) this._u(p.userId).balance += p.amount;
    const rest = (this.tpPending.get(key) || []).filter((b) => b.handId !== handId);
    if (rest.length) this.tpPending.set(key, rest); else this.tpPending.delete(key);
    this._changed(true);
  },
  async tpRefund(key) {
    const keys = key === undefined ? [...this.tpPending.keys()] : [key];
    const refunded = [];
    for (const k of keys) {
      for (const b of this.tpPending.get(k) || []) {
        this._u(b.userId).balance += b.amount;
        refunded.push({ key: k, ...b });
      }
      this.tpPending.delete(k);
    }
    if (refunded.length) this._changed(true);
    return refunded;
  },
};

function attachTeenPatti(store) {
  if (!store.tpPending) store.tpPending = new Map();
  for (const [name, fn] of Object.entries(TP_STORE_METHODS)) if (typeof store[name] !== 'function') store[name] = fn;
  return store;
}

/** Stand-alone in-memory store (tests / demo). In production use Royale's FileStore + attachTeenPatti. */
class TPMemoryStore {
  constructor(startingCoins = 10000) {
    this.start = startingCoins;
    this.users = new Map();
    this.tpPending = new Map();
    attachTeenPatti(this);
  }
  _changed() {}
  _u(id, name) {
    id = String(id);
    if (!this.users.has(id)) this.users.set(id, { name: name || id, balance: this.start });
    return this.users.get(id);
  }
  async touch(id, name) { const u = this._u(id, name); if (name) u.name = name; }
  async getBalance(id) { return this._u(id).balance; }
  async top(n = 10) {
    return [...this.users.entries()].map(([userId, u]) => ({ userId, name: u.name, balance: u.balance }))
      .sort((a, b) => b.balance - a.balance).slice(0, n);
  }
}

/* ======================= HELPERS ======================= */
const fmt = (n) => Number(n).toLocaleString('en-US');
const REAL_TIMERS = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (t) => clearTimeout(t),
};
function parseAmount(s) {
  const m = /^(\d+(?:\.\d+)?)(k|m)?$/i.exec(s || '');
  if (!m) return null;
  const mult = { k: 1e3, m: 1e6 }[(m[2] || '').toLowerCase()] || 1;
  const v = Math.floor(parseFloat(m[1]) * mult + 1e-9);
  return v > 0 ? v : null;
}
const cardObj = (c) => ({ r: c.r, s: c.s, t: cardStr(c) });

/* ======================= TABLE (one room) ======================= */
/**
 * phase:  'idle'     no table open ("Type !start")
 *         'joining'  table open, players type !j (30s)   -> nothing is charged yet
 *         'dealing'  boots being charged / cards dealt / payout being settled
 *         'playing'  a hand is running (turns)
 * Player state: 'blind' | 'seen' | 'out'
 * All actions run one after another through a queue, so two messages can never race each other.
 */
class TeenPattiTable {
  constructor({ roomId, boot, store, send, sendPrivate, config = CONFIG, timers = REAL_TIMERS, rng = randInt, onState, onHand, onStopped }) {
    this.roomId = roomId; this.boot = boot; this.store = store; this.cfg = config;
    this._send = send; this._sendPrivate = sendPrivate; this.timers = timers; this.rng = rng;
    this.onState = onState || (() => {}); this.onHand = onHand || (() => {}); this.onStopped = onStopped || (() => {});
    this.phase = 'idle';
    this.seats = [];
    this.pot = 0; this.stake = boot; this.handId = null; this.handSeq = 0;
    this.dealerIdx = -1; this.turnIdx = -1; this.turnUserId = null; this.turnDeadline = null; this.joinDeadline = null;
    this.result = null; this.lastEvent = '';
    this._q = Promise.resolve();
    this._timer = null; this._autoTimer = null; this._turnSeq = 0;
    this.stopped = false;
  }

  /* ---- plumbing ---- */
  _enqueue(fn) {
    const run = this._q.then(fn).catch(async (e) => {
      console.error('[TeenPatti]', e);
      if (this.phase === 'playing' || this.phase === 'dealing') {
        try { await this._abort('an internal error happened'); } catch (e2) { console.error('[TeenPatti] abort failed', e2); }
      }
    });
    this._q = run;
    return run;
  }
  _say(text) {
    this.lastEvent = String(text).split('\n')[0];
    try { this._send(text); } catch (e) { console.error('[TeenPatti] send failed', e); }
    this._changed();
  }
  _private(userId, text) {
    if (!this._sendPrivate) return;
    try { this._sendPrivate(userId, text); } catch (e) { console.error('[TeenPatti] sendPrivate failed', e); }
  }
  _changed() { try { this.onState(this.roomId); } catch (e) { console.error('[TeenPatti] onState failed', e); } }
  _clearTimers() {
    if (this._timer) { this.timers.clearTimeout(this._timer); this._timer = null; }
    if (this._autoTimer) { this.timers.clearTimeout(this._autoTimer); this._autoTimer = null; }
  }
  _seat(id) { return this.seats.find((p) => p.id === id); }
  _active() { return this.seats.filter((p) => p.state !== 'out'); }

  attach() { this._say('Play Teen Patti Gold. Type !start to start the game.'); }

  /* ---- stop / shutdown (used by the manager) ---- */
  requestStop() {
    if (this.phase === 'dealing' || this.phase === 'playing') return { ok: false };
    this._clearTimers();
    this.stopped = true; this.phase = 'idle'; this.seats = [];
    this._changed();
    this.onStopped();
    return { ok: true };
  }
  shutdown() { this._clearTimers(); this.stopped = true; }

  /* ---- messages ---- */
  handleMessage(user, text) {
    const t = String(text || '').trim().replace(/\s+/g, ' ');
    if (!t.startsWith('!') || this.stopped) return Promise.resolve();
    return this._enqueue(() => this._handle(user, t));
  }

  async _handle(user, t) {
    const id = String(user.id), cmd = t.split(' ')[0].toLowerCase();
    if (this.store.touch) await this.store.touch(id, user.name);
    switch (cmd) {
      case '!start': return this._start(user);
      case '!j': case '!join': return this._join(user);
      case '!bet': case '!call': return this._act(id, 'bet');
      case '!raise': return this._act(id, 'raise');
      case '!pack': case '!fold': return this._act(id, 'pack');
      case '!show': return this._act(id, 'show');
      case '!see': return this._see(id);
      case '!allin': case '!all-in': return this._act(id, 'allin');
      case '!auto': case '!autocall': return this._auto(id, 'autoCall');
      case '!autoblind': case '!playblind': return this._auto(id, 'autoBlind');
      case '!balance': case '!bal': {
        const b = await this.store.getBalance(id);
        return this._say(`${user.name}, your balance: ${fmt(b)} ${this.cfg.COIN_NAME}`);
      }
      case '!top': {
        if (!this.store.top) return;
        const rows = await this.store.top(10);
        return this._say('🏆 Top players\n' + rows.map((x, i) => `${i + 1}. ${x.name} — ${fmt(x.balance)}`).join('\n'));
      }
    }
  }

  /* ---- opening a table ---- */
  async _start(user) {
    const c = this.cfg;
    if (this.phase === 'joining') return this._say('A table is already open — type !j to sit down.');
    if (this.phase !== 'idle') return this._say('A hand is already in progress.');
    const id = String(user.id);
    const bal = await this.store.getBalance(id);
    if (bal < this.boot) return this._say(`${user.name}, you need at least ${fmt(this.boot)} ${c.COIN_NAME} to open a table (boot ${fmt(this.boot)}).`);
    this.seats = [this._newPlayer(id, user.name, bal)];
    this.result = null; this.pot = 0; this.stake = this.boot; this.handId = null; this.turnUserId = null;
    this.phase = 'joining';
    this.joinDeadline = this.timers.now() + c.JOIN_SECONDS * 1000;
    this._timer = this.timers.setTimeout(() => this._enqueue(() => this._closeJoin()), c.JOIN_SECONDS * 1000);
    this._say(`🎴 Teen Patti Gold — 3-card poker! Best hand wins the pot.\n` +
      `👉 Type !j to sit down · boot ${fmt(this.boot)} · up to ${c.MAX_SEATS} players · [${c.JOIN_SECONDS}s]\n` +
      `🪑 ${user.name} sat down.`);
  }

  _newPlayer(id, name, balance) {
    return { id, name, balance, state: 'blind', cards: [], eval: null, invested: 0, revealed: false, autoCall: false, autoBlind: false, allIn: false };
  }

  async _join(user) {
    const c = this.cfg, id = String(user.id);
    if (this.phase === 'idle') return this._say('No table is open. Type !start to open one.');
    if (this.phase !== 'joining') return this._say('A hand is in progress. Join the next table.');
    if (this._seat(id)) return this._say(`${user.name}, you are already seated.`);
    if (this.seats.length >= c.MAX_SEATS) return this._say('The table is full.');
    const bal = await this.store.getBalance(id);
    if (bal < this.boot) return this._say(`${user.name}, you need at least ${fmt(this.boot)} ${c.COIN_NAME} to sit down.`);
    this.seats.push(this._newPlayer(id, user.name, bal));
    this._say(`🪑 ${user.name} sat down.`);
    if (this.seats.length >= c.MAX_SEATS) { this._clearTimers(); await this._closeJoin(); }
  }

  /* ---- join window ended: charge boots, deal ---- */
  async _closeJoin() {
    if (this.phase !== 'joining') return;
    const c = this.cfg;
    this._clearTimers();
    this.phase = 'dealing';
    this.handId = `${this.timers.now()}-${++this.handSeq}`;
    this.pot = 0;
    for (const p of [...this.seats]) {
      const bal = await this.store.tpDebit({ key: this.roomId, handId: this.handId, userId: p.id, name: p.name, amount: this.boot });
      if (bal === null) {
        this.seats = this.seats.filter((x) => x !== p);
        this._say(`${p.name} does not have enough coins for the boot and left the table.`);
      } else { p.balance = bal; p.invested = this.boot; this.pot += this.boot; }
    }
    if (this.seats.length < c.MIN_PLAYERS) {
      await this._refundAll();
      this.seats = []; this.pot = 0; this.phase = 'idle'; this.handId = null;
      return this._say(`Not enough players (need ${c.MIN_PLAYERS}). Table closed — type !start to try again.`);
    }

    // Deal. If two hands would be IDENTICAL by rank (e.g. 9-A-10 in two different suits) the deck is
    // reshuffled, so a tie can never happen (the rule of the reference game). Very rare, costs nothing.
    for (let attempt = 0; attempt < 50; attempt++) {
      const deck = shuffle(fullDeck(), this.rng);
      for (const p of this.seats) { p.cards = [deck.pop(), deck.pop(), deck.pop()]; p.eval = evaluate(p.cards); }
      let tie = false;
      for (let i = 0; i < this.seats.length && !tie; i++)
        for (let j = i + 1; j < this.seats.length; j++)
          if (compareHands(this.seats[i].eval, this.seats[j].eval) === 0) { tie = true; break; }
      if (!tie) break;
    }
    for (const p of this.seats) { p.state = 'blind'; p.revealed = false; }
    this.stake = this.boot;
    this.dealerIdx = this.rng(this.seats.length);
    this.turnIdx = (this.dealerIdx + 1) % this.seats.length;
    this.phase = 'playing';
    this._say(`🃏 Cards dealt — ${this.seats.length} players · boot ${fmt(this.boot)} · pot ${fmt(this.pot)}\n` +
      `Players: ${this.seats.map((p) => p.name).join(', ')}\n` +
      `Type !see to look at your cards, or keep playing blind (bets cost half).`);
    this._beginTurn();
  }

  async _refundAll() {
    const refunded = await this.store.tpRefund(this.roomId);
    for (const b of refunded) { const p = this._seat(b.userId); if (p) p.balance += b.amount; }
    return refunded;
  }

  /* ---- turns ---- */
  _amounts(p) {
    const c = this.cfg, seen = p.state === 'seen';
    const call = seen ? this.stake * 2 : this.stake;
    const raise = seen ? this.stake * 4 : this.stake * 2;
    const newStake = this.stake * 2;
    let canRaise = p.balance >= raise && newStake <= this.boot * c.MAX_STAKE_MULT;
    if (canRaise) for (const o of this._active()) if (o !== p && !o.allIn && o.balance < newStake * 2) canRaise = false;   // table limit: others must be able to follow
    const show = this.stake * c.SHOW_COST_MULT;
    const twoLeft = this._active().length === 2;
    return {
      call, canCall: p.balance >= call,
      raise, canRaise, newStake,
      // Show is offered whenever exactly 2 players are left; without the coins for it the player is packed
      show, canShow: twoLeft, canPayShow: p.balance >= show,
      // All in: offered when the coins are not enough for the call (but there are some)
      allIn: p.balance, canAllIn: p.balance > 0 && p.balance < call,
      canSee: p.state === 'blind',
    };
  }

  _optionsText(p) {
    const a = this._amounts(p), T = this.cfg.TURN_SECONDS;
    const parts = [a.canCall ? `Call ${fmt(a.call)} → !bet` : `Call ${fmt(a.call)} (not enough coins)`];
    if (a.canRaise) parts.push(`Raise ${fmt(a.raise)} → !raise`);
    if (a.canAllIn) parts.push(`All in ${fmt(a.allIn)} → !allin`);
    parts.push('Fold → !pack');
    if (a.canSee) parts.push('See cards → !see');
    if (a.canShow) parts.push(`Show ${fmt(a.show)} → !show` + (a.canPayShow ? '' : ' (not enough coins: you would fold)'));
    return `🎯 YOUR turn — playing ${p.state} · ${T}s\n` + parts.join(' · ');
  }

  _beginTurn() {
    const c = this.cfg, p = this.seats[this.turnIdx];
    const seq = ++this._turnSeq;
    this.turnUserId = p.id;
    this.turnDeadline = this.timers.now() + c.TURN_SECONDS * 1000;
    this._say(`▶ ${p.name}'s turn · Pot ${fmt(this.pot)} · ${c.TURN_SECONDS}s`);
    this._private(p.id, this._optionsText(p));
    this._clearTimers();
    this._timer = this.timers.setTimeout(() => this._enqueue(() => this._timeout(seq)), c.TURN_SECONDS * 1000);
    // Auto play: "Play blind" calls while the player is still blind; "Auto call (min)" calls blind AND seen until the result.
    const auto = p.autoCall || (p.autoBlind && p.state === 'blind');
    if (auto) {
      const a = this._amounts(p);
      if (a.canCall) {
        this._autoTimer = this.timers.setTimeout(() => this._enqueue(() => {
          if (seq === this._turnSeq && this.phase === 'playing') return this._act(p.id, 'bet');
        }), c.AUTO_CALL_DELAY_MS);
      } else {
        this._private(p.id, `⚠️ Auto play stopped — you don't have ${fmt(a.call)} ${c.COIN_NAME} for the call.`);
      }
    }
  }

  async _timeout(seq) {
    if (seq !== this._turnSeq || this.phase !== 'playing') return;
    const p = this._seat(this.turnUserId);
    if (!p || p.state === 'out') return;
    this._say(`⏰ ${p.name} ran out of time and folded.`);
    await this._fold(p);
  }

  _advance() {
    const n = this.seats.length;
    let i = this.turnIdx;
    do { i = (i + 1) % n; } while (this.seats[i].state === 'out' || this.seats[i].allIn);
    this.turnIdx = i;
    this._beginTurn();
  }

  /** After every action: hand over? showdown? or next player's turn. */
  async _afterAction() {
    const left = this._active();
    if (left.length === 1) return this._award(left[0], { reason: 'fold' });
    const actors = left.filter((p) => !p.allIn);
    if (left.some((p) => p.allIn) && actors.length <= 1) {
      this._say('💥 Nobody can bet any more — showdown!');
      return this._showdown({ reason: 'allin' });
    }
    return this._advance();
  }

  async _pay(p, amount) {
    const bal = await this.store.tpDebit({ key: this.roomId, handId: this.handId, userId: p.id, name: p.name, amount });
    if (bal === null) return false;
    p.balance = bal; p.invested += amount; this.pot += amount;
    return true;
  }

  /* ---- player actions ---- */
  async _act(id, action) {
    if (this.phase !== 'playing') return;
    const p = this._seat(id);
    if (!p || p.state === 'out') return;
    if (id !== this.turnUserId) return this._say(`${p.name}, it's not your turn.`);
    const a = this._amounts(p);

    if (action === 'pack') return this._fold(p);

    if (action === 'bet') {
      if (!a.canCall) return this._say(`${p.name}, you don't have ${fmt(a.call)} ${this.cfg.COIN_NAME}. ${a.canAllIn ? 'Type !allin or ' : 'Type '}!pack to fold.`);
      if (!(await this._pay(p, a.call))) return this._say(`${p.name}, not enough coins. Type !pack to fold.`);
      this._say(`💰 ${p.name} called ${fmt(a.call)} · Pot ${fmt(this.pot)}`);
      return this._afterAction();
    }

    if (action === 'raise') {
      if (!a.canRaise) return this._say(`${p.name}, you can't raise now (stake limit or not enough coins).`);
      if (!(await this._pay(p, a.raise))) return this._say(`${p.name}, not enough coins. Type !pack to fold.`);
      this.stake = a.newStake;
      this._say(`💰 ${p.name} raised ${fmt(a.raise)} · Pot ${fmt(this.pot)} · stake ${fmt(this.stake)}`);
      return this._afterAction();
    }

    if (action === 'allin') {
      p.balance = await this.store.getBalance(p.id);                 // the real balance, not a cached copy
      const b = this._amounts(p);
      if (!b.canAllIn) return this._say(`${p.name}, All in is only possible when you can't afford the call (${fmt(b.call)}) and still have coins.`);
      const amount = p.balance;
      if (!(await this._pay(p, amount))) return this._say(`${p.name}, not enough coins. Type !pack to fold.`);
      p.allIn = true;
      this._say(`💥 ${p.name} went ALL IN with ${fmt(amount)} · Pot ${fmt(this.pot)}`);
      return this._afterAction();
    }

    if (action === 'show') {
      if (this._active().length !== 2) return this._say(`${p.name}, Show is only possible when exactly 2 players are left.`);
      // No coins for the Show → the player is packed (rule of the reference game)
      if (!(a.canPayShow && (await this._pay(p, a.show)))) {
        this._say(`${p.name} asked for a Show but doesn't have ${fmt(a.show)} ${this.cfg.COIN_NAME}.`);
        return this._fold(p);
      }
      const other = this._active().find((x) => x !== p);
      this._say(`🎬 ${p.name} asked for a Show and paid ${fmt(a.show)} · Pot ${fmt(this.pot)}`);
      if (this.seats.some((x) => x.allIn)) return this._showdown({ reason: 'show', asker: p });
      const cmp = compareHands(p.eval, other.eval);
      const winner = cmp > 0 ? p : other;                 // identical ranks: the player who asked for the Show loses
      const loser = winner === p ? other : p;
      p.revealed = true; other.revealed = true;
      return this._award(winner, { reason: 'show', loser, tie: cmp === 0 });
    }
  }

  async _fold(p) {
    p.state = 'out'; p.revealed = true;
    this._say(`🏳️ ${p.name} folded — ${cardsStr(p.cards)} (${p.eval.name}).`);
    const left = this._active();
    if (left.length === 1) return this._award(left[0], { reason: 'fold' });
    this._say(`Remaining players are ${left.map((x) => x.name).join(', ')} (${left.length} players).`);
    return this._afterAction();
  }

  async _see(id) {
    if (this.phase !== 'playing') return;
    const p = this._seat(id);
    if (!p || p.state === 'out') return;
    if (p.state === 'blind') {
      p.state = 'seen';
      p.autoBlind = false;                 // "Play blind" lasts only until the player looks
      this._say(`👁 ${p.name} looked at their cards.`);
    }
    this._private(p.id, `🃏 Your cards: ${cardsStr(p.cards)} — ${p.eval.name}`);
    if (id === this.turnUserId) this._private(p.id, this._optionsText(p));
    this._changed();
  }

  async _auto(id, which) {
    const p = this._seat(id);
    if (!p || p.state === 'out') return;
    p[which] = !p[which];
    const label = which === 'autoBlind' ? 'Play blind' : 'Auto call (min)';
    this._private(id, `${label} is now ${p[which] ? 'ON' : 'OFF'}.`);
    // if it is this player's turn right now, let the auto play start immediately
    if (this.phase === 'playing' && this.turnUserId === id && p[which] && !this._autoTimer) {
      const auto = p.autoCall || (p.autoBlind && p.state === 'blind');
      if (auto && this._amounts(p).canCall) {
        const seq = this._turnSeq;
        this._autoTimer = this.timers.setTimeout(() => this._enqueue(() => {
          if (seq === this._turnSeq && this.phase === 'playing') return this._act(id, 'bet');
        }), this.cfg.AUTO_CALL_DELAY_MS);
      }
    }
    this._changed();
  }

  /* ---- end of hand ---- */
  async _award(winner, { reason, loser = null, tie = false }) {
    this._clearTimers();
    this._turnSeq++;                       // invalidate any pending turn timers
    this.turnUserId = null; this.turnDeadline = null;
    const pot = this.pot;
    const fee = Math.floor(pot * this.cfg.RAKE_PERCENT / 100);
    const payout = pot - fee;
    try {
      await this.store.tpSettle({ key: this.roomId, handId: this.handId, payouts: [{ userId: winner.id, amount: payout }] });
    } catch (e) {
      console.error('[TeenPatti] settle failed', e);
      return this._abort('the payout failed');
    }
    winner.balance += payout;
    const net = payout - winner.invested;
    const sign = net >= 0 ? '+' : '−';
    let msg;
    if (reason === 'show') {
      msg = `🏆 ${winner.name} wins ${fmt(payout)} coins with ${winner.eval.name}! ${cardsStr(winner.cards)}\n` +
            `${loser.name}: ${cardsStr(loser.cards)} — ${loser.eval.name}` +
            (tie ? '\n(Same hand — the player who asked for the Show loses.)' : '');
    } else {
      msg = `🏆 ${winner.name} wins ${fmt(payout)} coins — everyone else folded.`;
    }
    msg += `\n💰 Put in ${fmt(winner.invested)} → took ${fmt(payout)} (net ${sign}${fmt(Math.abs(net))})\n\n▶ Type !start to play again.`;

    this.result = {
      winnerId: winner.id, winnerName: winner.name, payout, pot, fee, reason, tie,
      handName: reason === 'show' ? winner.eval.name : null,
    };
    const info = {
      roomId: this.roomId, handId: this.handId, at: this.timers.now(), reason, pot, fee, payout, winnerId: winner.id,
      players: this.seats.map((p) => ({ id: p.id, name: p.name, invested: p.invested, state: p.state, cards: p.cards.map(cardStr), hand: p.eval.name })),
    };
    this.phase = 'idle';
    this._say(msg);
    try { this.onHand(info); } catch (e) { console.error('[TeenPatti] onHand failed', e); }
  }

  /**
   * Showdown when somebody is all-in (or a Show involves an all-in player).
   * An all-in player can only win the part of the pot up to what he put in (side pots):
   *   layer k = everything up to the k-th all-in total, contested by everybody still in the hand
   *   top layer = everything above the highest all-in total, contested only by the players who are not all-in.
   * The best hand of each layer takes it (10% rake per layer; your own uncontested coins come back un-raked).
   */
  _best(list, asker) {
    let best = null;
    for (const p of list) {
      if (!best) { best = p; continue; }
      const c = compareHands(p.eval, best.eval);
      if (c > 0 || (c === 0 && best === asker)) best = p;          // identical ranks: the player who asked for the Show loses
    }
    return best;
  }

  _layers() {
    const all = this.seats.filter((p) => p.invested > 0);
    const left = this._active();
    const caps = [...new Set(left.filter((p) => p.allIn).map((p) => p.invested))].sort((a, b) => a - b);
    const part = (q, lo, hi) => Math.max(0, Math.min(q.invested, hi) - Math.min(q.invested, lo));
    const layers = []; let prev = 0;
    for (const T of caps) {
      layers.push({ lo: prev, hi: T, amount: all.reduce((sum, q) => sum + part(q, prev, T), 0), eligible: left.filter((p) => !p.allIn || p.invested >= T) });
      prev = T;
    }
    const top = all.reduce((sum, q) => sum + part(q, prev, Infinity), 0);
    if (top > 0) {
      const eligible = left.filter((p) => !p.allIn);
      if (eligible.length) layers.push({ lo: prev, hi: Infinity, amount: top, eligible });
      else layers[layers.length - 1].amount += top;
    }
    return layers.filter((l) => l.amount > 0).map((l) => ({ ...l, own: (p) => part(p, l.lo, l.hi) }));
  }

  async _showdown({ reason, asker = null }) {
    this._clearTimers();
    this._turnSeq++;
    this.turnUserId = null; this.turnDeadline = null;
    const left = this._active();
    for (const p of left) p.revealed = true;
    const pot = this.pot, pct = this.cfg.RAKE_PERCENT;
    const won = new Map(); let fee = 0;
    for (const L of this._layers()) {
      const w = this._best(L.eligible, asker);
      const raked = L.eligible.length === 1 ? L.amount - L.own(L.eligible[0]) : L.amount;
      const f = Math.floor(raked * pct / 100);
      fee += f;
      won.set(w.id, (won.get(w.id) || 0) + L.amount - f);
    }
    const payouts = [...won.entries()].map(([userId, amount]) => ({ userId, amount })).sort((a, b) => b.amount - a.amount);
    try {
      await this.store.tpSettle({ key: this.roomId, handId: this.handId, payouts });
    } catch (e) {
      console.error('[TeenPatti] settle failed', e);
      return this._abort('the payout failed');
    }
    let msg = '';
    for (const pay of payouts) {
      const w = this._seat(pay.userId);
      w.balance += pay.amount;
      msg += `🏆 ${w.name} wins ${fmt(pay.amount)} coins with ${w.eval.name}! ${cardsStr(w.cards)}\n`;
    }
    for (const p of left) if (!won.has(p.id)) msg += `${p.name}: ${cardsStr(p.cards)} — ${p.eval.name}${p.allIn ? ' (all in)' : ''}\n`;
    for (const pay of payouts) {
      const w = this._seat(pay.userId), net = pay.amount - w.invested;
      msg += `💰 ${w.name}: put in ${fmt(w.invested)} → took ${fmt(pay.amount)} (net ${net >= 0 ? '+' : '−'}${fmt(Math.abs(net))})\n`;
    }
    msg += '\n▶ Type !start to play again.';
    const main = this._seat(payouts[0].userId);
    this.result = {
      winnerId: main.id, winnerName: main.name, payout: payouts[0].amount, pot, fee, reason, tie: false,
      handName: main.eval.name, payouts: payouts.map((x) => ({ userId: x.userId, name: this._seat(x.userId).name, amount: x.amount })),
    };
    const info = {
      roomId: this.roomId, handId: this.handId, at: this.timers.now(), reason, pot, fee, payouts, winnerId: main.id,
      players: this.seats.map((p) => ({ id: p.id, name: p.name, invested: p.invested, state: p.state, allIn: p.allIn, cards: p.cards.map(cardStr), hand: p.eval.name })),
    };
    this.phase = 'idle';
    this._say(msg.trim());
    try { this.onHand(info); } catch (e) { console.error('[TeenPatti] onHand failed', e); }
  }

  async _abort(reason) {
    this._clearTimers();
    this._turnSeq++;
    const refunded = await this._refundAll();
    this.turnUserId = null; this.turnDeadline = null;
    this.phase = 'idle'; this.pot = 0; this.result = null;
    this._say(`⚠️ The hand was cancelled (${reason}). ${refunded.length ? 'All coins were refunded.' : ''}`.trim());
    this.seats = [];
    this._changed();
  }

  /* ---- data for the UI panel ---- */
  /**
   * The JSON the panel needs, for ONE viewer. Other players' cards are never included unless they were
   * revealed (folded / shown), and your own cards only once you have seen them.
   */
  viewFor(userId) {
    const id = userId == null ? null : String(userId);
    const me = id ? this._seat(id) : null;
    const playing = this.phase === 'playing';
    const view = {
      v: 1, roomId: this.roomId, phase: this.phase, boot: this.boot,
      maxSeats: this.cfg.MAX_SEATS, minPlayers: this.cfg.MIN_PLAYERS,
      pot: this.pot, stake: this.stake, handId: this.handId,
      serverNow: this.timers.now(),
      joinDeadline: this.phase === 'joining' ? this.joinDeadline : null,
      turnDeadline: playing ? this.turnDeadline : null,
      turnSeconds: this.cfg.TURN_SECONDS,
      turnUserId: playing ? this.turnUserId : null,
      seats: this.seats.map((p, i) => ({
        userId: p.id, name: p.name, state: p.state, invested: p.invested, allIn: p.allIn,
        isDealer: playing && i === this.dealerIdx, isYou: p.id === id,
        isWinner: !!(this.result && this.result.winnerId === p.id && this.phase === 'idle'),
        cards: p.revealed ? p.cards.map(cardObj) : null,
        hand: p.revealed && p.eval ? p.eval.name : null,
      })),
      you: null, result: this.result, lastEvent: this.lastEvent,
    };
    if (me) {
      const show = me.state === 'seen' || me.revealed;
      const a = playing && me.state !== 'out' ? this._amounts(me) : null;
      view.you = {
        userId: me.id, state: me.state, balance: me.balance, invested: me.invested, autoCall: me.autoCall, autoBlind: me.autoBlind, allIn: me.allIn,
        cards: show && me.cards.length ? me.cards.map(cardObj) : null,
        hand: show && me.eval ? me.eval.name : null,
        isTurn: playing && this.turnUserId === me.id,
        actions: a ? { see: a.canSee, call: a.call, canCall: a.canCall, raise: a.raise, canRaise: a.canRaise, show: a.show, canShow: a.canShow, canPayShow: a.canPayShow, allIn: a.allIn, canAllIn: a.canAllIn, pack: true } : null,
      };
    }
    return view;
  }
}

/* ======================= MANAGER (all rooms) ======================= */
/**
 * Admin commands (per room):
 *   /bot teenpatti [boot]  -> adds the bot to the room, e.g. "/bot teenpatti 500" (default boot: CONFIG.DEFAULT_BOOT)
 *   /bot stop              -> removes the bot; refused while a hand is running
 * Player commands: !start (anyone) · !j · !bet · !raise · !pack · !see · !show · !allin · !autoblind · !autocall (!auto) · !bal · !top
 */
class TeenPattiManager {
  constructor({ send, sendPrivate = null, store, isAdmin = (u) => !!(u && u.isAdmin), config = CONFIG,
                onState = null, onHand = null, timers = REAL_TIMERS, rng = randInt }) {
    this.send = send; this.sendPrivate = sendPrivate; this.cfg = config; this.isAdmin = isAdmin;
    this.onState = onState; this.onHand = onHand; this.timers = timers; this.rng = rng;
    this.store = attachTeenPatti(store);
    this.rooms = new Map();   // roomId -> TeenPattiTable
    this._mq = new Map();     // roomId -> promise chain (message order)
    if (!sendPrivate) console.warn('[TeenPatti] no sendPrivate given: !see will only work through the panel (UI).');
  }

  /** Call ONCE at server start, before handling messages. Refunds every hand that was interrupted. */
  async init() {
    const refunded = await this.store.tpRefund();
    if (refunded.length) {
      console.log(`[TeenPatti] crash recovery: refunded ${refunded.length} entr${refunded.length === 1 ? 'y' : 'ies'}`);
      if (this.cfg.NOTIFY_REFUNDS) {
        for (const roomId of new Set(refunded.map((b) => b.key))) {
          this.send(roomId, '⚠️ The server restarted during a Teen Patti hand. All coins of that hand were refunded automatically.');
        }
      }
    }
    return refunded;
  }

  /** Messages of one room are processed strictly one after another (so "/bot teenpatti" then "!start" can never race). */
  handleMessage(roomId, user, text) {
    const prev = this._mq.get(roomId) || Promise.resolve();
    const run = prev.then(() => this._handleMessage(roomId, user, text));
    this._mq.set(roomId, run.catch(() => {}));
    return run;
  }

  async _handleMessage(roomId, user, text) {
    const t = String(text || '').trim().replace(/\s+/g, ' ');
    const low = t.toLowerCase();
    const game = this.rooms.get(roomId);
    const say = (m) => this.send(roomId, m);
    const admin = async () => !!(await this.isAdmin(user, roomId));

    if (low === '/bot teenpatti' || low.startsWith('/bot teenpatti ')) {
      if (!(await admin())) return say('Only admins can add the bot to a room.');
      if (game) return say('Teen Patti Gold is already in this room.');
      const arg = t.split(' ')[2];
      const boot = arg ? parseAmount(arg) : this.cfg.DEFAULT_BOOT;
      if (!boot) return say('Usage: /bot teenpatti [boot]   e.g. /bot teenpatti 500');
      return this._create(roomId, boot).attach();
    }

    if (!game) return;      // not our room: ignore everything else (other bots may use these commands)

    if (low === '/bot stop') {
      if (!(await admin())) return say('Only admins can stop the bot.');
      const r = game.requestStop();
      if (!r.ok) say('⛔ A hand is running — the bot cannot be stopped now. Try /bot stop again after the hand ends.');
      return;
    }

    if (low === '!start' && this.cfg.START_ADMIN_ONLY && !(await admin())) return say('Only admins can start the game.');
    return game.handleMessage(user, t);
  }

  _create(roomId, boot) {
    const game = new TeenPattiTable({
      roomId, boot, store: this.store, config: this.cfg, timers: this.timers, rng: this.rng,
      send: (text) => this.send(roomId, text),
      sendPrivate: this.sendPrivate ? (userId, text) => this.sendPrivate(roomId, userId, text) : null,
      onState: (id) => { if (this.onState) this.onState(id); },
      onHand: this.onHand,
      onStopped: () => this.rooms.delete(roomId),
    });
    this.rooms.set(roomId, game);
    return game;
  }

  /** JSON for the panel of ONE user in a room (null if the bot is not in that room). */
  getView(roomId, userId) {
    const g = this.rooms.get(roomId);
    return g ? g.viewFor(userId) : null;
  }

  /** Clean shutdown: stop all timers and refund any hand in progress. */
  async shutdown() {
    for (const g of this.rooms.values()) g.shutdown();
    await this.store.tpRefund();
  }
}

module.exports = {
  TeenPattiManager, TeenPattiTable, TPMemoryStore, attachTeenPatti,
  evaluate, compareHands, CONFIG, cardStr, fullDeck, shuffle, randInt, parseAmount,
};
