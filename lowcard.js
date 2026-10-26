'use strict';
// LowCard Bot - chat-room game engine (virtual coins, for fun only). Node 16+, no packages.
// Rules: everyone draws one card per round (!d); the LOWEST card is OUT (2 lowest ... Ace highest).
// Ties for lowest -> separate tie-break rounds among only the tied players. Last player standing wins the pot (minus rake).
// Commands: !start [amount]   !j   !d      Wire it up with the `api` object (see bottom of the file for a demo).

const CFG = {
  DEFAULT_ENTRY: 100, MIN_ENTRY: 10, MAX_ENTRY: 1000000,
  MIN_PLAYERS: 2,
  JOIN_SECONDS: 30, DRAW_SECONDS: 30, TIEBREAK_SECONDS: 15, BETWEEN_ROUND_MS: 2000,
  RAKE_PERCENT: 10,
  START_ADMIN_ONLY: false,
  IDLE_MESSAGE: 'Play LowCard Bot. Type !start to start the game.',
};
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];   // index 0 = lowest
const SUITS = ['♠', '♥', '♦', '♣'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const drawCard = (rng = Math.random) => { const r = Math.floor(rng() * 13); return { r, label: RANKS[r] + SUITS[Math.floor(rng() * 4)] }; };

class LowCardGame {
  constructor(room, api, entry, cfg, rng) {
    this.room = room; this.api = api; this.entry = entry; this.cfg = cfg; this.rng = rng;
    this.state = 'joining';            // joining | starting | playing | ended
    this.players = []; this.alive = []; this.pot = 0; this.round = 0;
    this.pending = null; this.draws = null; this._done = null;
  }
  say(t) { return this.api.say(this.room, t); }

  async open(starter) {
    this.players.push(starter);        // the starter joins automatically
    await this.say(`New LowCard game started. !j to join, entry ${this.entry} coins [${this.cfg.JOIN_SECONDS} seconds]`);
    await sleep(this.cfg.JOIN_SECONDS * 1000);
    if (this.players.length < this.cfg.MIN_PLAYERS) { this.state = 'ended'; await this.say(`Not enough players (need ${this.cfg.MIN_PLAYERS}). Table closed.`); return this.idle(); }
    this.state = 'starting';
    const paid = [];
    for (const p of this.players) { if (await this.api.debit(this.room, p, this.entry)) paid.push(p); else await this.say(`${p} does not have enough coins (${this.entry}), removed from the game.`); }
    if (paid.length < this.cfg.MIN_PLAYERS) {
      if (paid.length) await this.api.refund(this.room);
      this.state = 'ended'; await this.say(`Not enough players (need ${this.cfg.MIN_PLAYERS}). Table closed, coins refunded.`); return this.idle();
    }
    this.players = paid; this.alive = [...paid]; this.pot = paid.length * this.entry; this.state = 'playing';
    await this.say(`Game begins - Lowest card is OUT! ${paid.length} players, pot ${this.pot} coins.`);
    try { await this.play(); } catch (e) { this.state = 'ended'; try { await this.api.refund(this.room); await this.say('LowCard error. Coins refunded.'); } catch {} console.error('[LowCard]', e); }
  }

  join(user) {
    if (this.state !== 'joining') return this.say('Joining is closed.');
    if (this.players.includes(user)) return this.say(`${user}, you already joined.`);
    this.players.push(user);
    return this.say(`${user} joined the game.`);
  }

  onDraw(user) {
    if (this.state !== 'playing') return;
    if (!this.pending) return;
    if (!this.alive.includes(user)) return;
    if (!this.pending.includes(user)) return this.say(`${user}, wait for the next round.`);
    if (this.draws.has(user)) return;
    const c = drawCard(this.rng); this.draws.set(user, c);
    this.say(`${user} draws: ${c.label}`);
    if (this.draws.size === this.pending.length && this._done) this._done();
  }

  async collect(players, seconds) {
    this.pending = players; this.draws = new Map();
    await new Promise(res => { this._done = res; this._t = setTimeout(res, seconds * 1000); });
    clearTimeout(this._t);
    for (const p of players) if (!this.draws.has(p)) { const c = drawCard(this.rng); this.draws.set(p, c); await this.say(`Bot draws - ${p}: ${c.label}`); }
    const res = this.draws; this.pending = null; this._done = null; return res;
  }

  async play() {
    while (this.alive.length > 1) {
      this.round++;
      await this.say(`ROUND #${this.round}. Players !d to draw a card [${this.cfg.DRAW_SECONDS} seconds]`);
      let res = await this.collect([...this.alive], this.cfg.DRAW_SECONDS);
      let pool = [...this.alive], low = this.lowest(pool, res);
      while (low.length > 1) {                       // tie for lowest: only the tied players draw again
        await this.say(`Tie between ${low.join(', ')}! Tie-break round. !d to draw [${this.cfg.TIEBREAK_SECONDS} seconds]`);
        res = await this.collect([...low], this.cfg.TIEBREAK_SECONDS); pool = low; low = this.lowest(pool, res);
      }
      const out = low[0];
      await this.say(`${out} is OUT with ${res.get(out).label}!`);
      this.alive = this.alive.filter(p => p !== out);
      if (this.alive.length > 1) {
        await this.say(`Remaining players: ${this.alive.join(', ')} (${this.alive.length}). Next round in ${Math.round(this.cfg.BETWEEN_ROUND_MS / 1000)} seconds.`);
        await sleep(this.cfg.BETWEEN_ROUND_MS);
      }
    }
    const winner = this.alive[0], prize = Math.floor(this.pot * (1 - this.cfg.RAKE_PERCENT / 100));
    await this.api.settle(this.room, winner, prize);
    this.state = 'ended';
    await this.say(`Game Over! ${winner} won ${prize} coins. CONGRATS!`);
    return this.idle();
  }
  lowest(pool, res) { const m = Math.min(...pool.map(p => res.get(p).r)); return pool.filter(p => res.get(p).r === m); }
  async idle() { if (this.cfg.IDLE_MESSAGE) await this.say(this.cfg.IDLE_MESSAGE); }
}

class LowCardBot {
  // api: say(room,text) · debit(room,user,amount)->bool (must also journal the bet) · settle(room,winner,prize) · refund(room)
  constructor(api, cfg = {}, rng = Math.random) { this.api = api; this.cfg = { ...CFG, ...cfg }; this.rng = rng; this.games = new Map(); this.entry = new Map(); this.off = new Set(); }
  running(room) { const g = this.games.get(room); return !!g && g.state !== 'ended'; }
  // Admin: "/bot lowcard [entry]" enables the bot and sets the room's default entry; "/bot stop" disables it (refused while a game runs).
  admin(room, isAdmin, text) {
    const t = text.trim().toLowerCase().split(/\s+/);
    if (!isAdmin) return this.api.say(room, 'Only admins can use /bot.');
    if (t[1] === 'stop') { if (this.running(room)) return this.api.say(room, 'A game is running. Try again when it ends.'); this.off.add(room); return this.api.say(room, 'LowCard Bot stopped.'); }
    if (t[1] === 'lowcard') {
      const n = t[2] === undefined ? this.cfg.DEFAULT_ENTRY : parseInt(t[2], 10);
      if (!(n >= this.cfg.MIN_ENTRY && n <= this.cfg.MAX_ENTRY)) return this.api.say(room, `Entry must be between ${this.cfg.MIN_ENTRY} and ${this.cfg.MAX_ENTRY} coins.`);
      this.off.delete(room); this.entry.set(room, n); return this.api.say(room, `LowCard Bot is ready. Default entry: ${n} coins. Type !start`);
    }
    return this.api.say(room, 'Usage: /bot lowcard [entry]   or   /bot stop');
  }
  async handle(room, user, text, isAdmin = false) {
    const cmd = text.trim().toLowerCase(), g = this.games.get(room);
    if (cmd.startsWith('!start')) {
      if (this.off.has(room)) return this.api.say(room, 'LowCard Bot is stopped in this room.');
      const m = cmd.match(/^!start(?:\s+(\d+))?$/);
      if (!m) return this.api.say(room, 'Usage: !start  or  !start <amount>');
      if (this.cfg.START_ADMIN_ONLY && !isAdmin) return this.api.say(room, 'Only admins can start a game.');
      const entry = m[1] ? parseInt(m[1], 10) : (this.entry.get(room) || this.cfg.DEFAULT_ENTRY);
      if (entry < this.cfg.MIN_ENTRY || entry > this.cfg.MAX_ENTRY) return this.api.say(room, `Entry must be between ${this.cfg.MIN_ENTRY} and ${this.cfg.MAX_ENTRY} coins.`);
      if (this.running(room)) return this.api.say(room, 'A game is already running.');
      const game = new LowCardGame(room, this.api, entry, this.cfg, this.rng); this.games.set(room, game);
      return game.open(user);
    }
    if (!g || g.state === 'ended') return;
    if (cmd === '!j' || cmd === '!join') return g.join(user);
    if (cmd === '!d' || cmd === '!draw') return g.onDraw(user);
  }
}
module.exports = { LowCardBot, CFG, RANKS, SUITS };

// ---------- Demo: node lowcard.cjs ----------
if (require.main === module) {
  const cfg = { JOIN_SECONDS: 1, DRAW_SECONDS: 1, TIEBREAK_SECONDS: 1, BETWEEN_ROUND_MS: 200 };
  const wallet = { mig: 1000, administration: 1000, rafi: 1000, lil: 50 }, pend = [];
  const api = {
    say: async (room, t) => console.log('[LowCard Bot]', t),
    debit: async (room, u, n) => { if (wallet[u] >= n) { wallet[u] -= n; pend.push([u, n]); return true; } return false; },
    settle: async (room, w, p) => { wallet[w] += p; pend.length = 0; },
    refund: async () => { for (const [u, n] of pend) wallet[u] += n; pend.length = 0; },
  };
  const bot = new LowCardBot(api, cfg);
  bot.handle('r', 'administration', '!start 200');
  for (const [u, ms] of [['mig', 100], ['rafi', 200], ['lil', 300]]) setTimeout(() => bot.handle('r', u, '!j'), ms);
  setTimeout(() => ['mig', 'administration'].forEach(u => bot.handle('r', u, '!d')), 1500);
  setTimeout(() => { console.log(wallet); process.exit(0); }, 12000);
}
