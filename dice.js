'use strict';
// Dice Bot - chat-room game engine (virtual coins, for fun only). Node 16+, no packages.
// Elimination rules: every round the bot rolls two dice - that total is the TARGET. Each player rolls two dice once (!r).
// A total >= TARGET is IN, otherwise OUT and eliminated. If nobody hits the target nobody is eliminated. A double gives
// immunity for the next round. Last player standing wins the pot (minus rake).
// Commands: !start [amount]   !j   !r (also !d / !roll)
// api: say(room,text) · tell(room,user,text) optional private line · debit(room,user,amount)->bool · settle(room,winner,prize) · refund(room)

const CFG = {
  DEFAULT_ENTRY: 100, MIN_ENTRY: 10, MAX_ENTRY: 1000000, MIN_PLAYERS: 2,
  JOIN_SECONDS: 30, ROLL_SECONDS: 30, PAUSE_MS: 1500, MAX_ROUNDS: 40, RAKE_PERCENT: 10,
  IDLE_MESSAGE: 'Play Dice Bot. Type !start to start the game.',
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FACE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const roll = rng => { const a = 1 + Math.floor(rng() * 6), b = 1 + Math.floor(rng() * 6); return { a, b, total: a + b }; };
const show = (r) => `${FACE[r.a]} ${r.a} + ${FACE[r.b]} ${r.b} = ${r.total}`;
const list = a => a.join(', ');

class DiceGame {
  constructor(room, api, entry, cfg, rng) { this.room = room; this.api = api; this.entry = entry; this.cfg = cfg; this.rng = rng; this.deadline = null; this.shown = new Map(); this.winner = null; this.prize = 0; this.round = 0; this.target = 0; this.alive = []; this.immune = new Set(); this.state = 'joining'; this.players = []; this.pending = null; this.rolls = null; this._done = null; }
  say(t) { return this.api.say(this.room, t); }
  async open(starter) {
    this.players.push(starter); this.alive.push(starter);
    this.deadline = Date.now() + this.cfg.JOIN_SECONDS * 1000;
    await this.say(`New Dice game started. Press !j or !join to join, entry ${this.entry} coins [${this.cfg.JOIN_SECONDS} seconds]`);
    await sleep(this.cfg.JOIN_SECONDS * 1000);
    if (this.players.length < this.cfg.MIN_PLAYERS) { this.state = 'ended'; await this.say(`Not enough players. Game cancelled.`); return this.idle(); }
    this.state = 'starting';
    const paid = [];
    for (const p of this.players) { if (await this.api.debit(this.room, p, this.entry)) paid.push(p); else await this.say(`${p} does not have enough coins (${this.entry}), removed from the game.`); }
    if (paid.length < this.cfg.MIN_PLAYERS) {
      if (paid.length) await this.api.refund(this.room);
      this.state = 'ended'; await this.say(`Not enough players (need ${this.cfg.MIN_PLAYERS}). Game cancelled - entries refunded.`); return this.idle();
    }
    this.players = paid; this.alive = [...paid]; this.pot = paid.length * this.entry; this.state = 'playing';
    await this.say(`Game begins! Bot rolls first - match or beat the total to stay IN! ${paid.length} players, pot ${this.pot} coins.`);
    try { await this.play(); } catch (e) { this.state = 'ended'; try { await this.api.refund(this.room); await this.say('Dice error. Coins refunded.'); } catch {} console.error('[Dice]', e); }
  }
  join(user) {
    if (this.state !== 'joining') return this.say('Joining is closed.');
    if (this.players.includes(user)) return this.say(`${user}, you already joined.`);
    this.players.push(user); this.alive.push(user); return this.say(`${user} joined the game.`);
  }
  onRoll(user) {
    if (this.state !== 'playing') return;
    if (!this.alive.includes(user)) return;
    if (!this.pending) return this.api.tell ? this.api.tell(this.room, user, 'The round result is being tallied. Please wait.') : undefined;
    if (this.rolls.has(user)) return;
    const r = roll(this.rng); this.rolls.set(user, r); this.shown.set(user, r);
    this.say(`${user}: ${show(r)} ${r.total >= this.target ? 'IN!' : 'OUT!'}${r.a === r.b ? ' Double - immunity for the next round!' : ''}`);
    if (this.rolls.size === this.pending.length && this._done) this._done();
  }
  async collect(players, seconds) {
    this.pending = players; this.rolls = new Map(); this.deadline = Date.now() + seconds * 1000;
    await new Promise(res => { this._done = res; this._t = setTimeout(res, seconds * 1000); });
    clearTimeout(this._t);
    const res = this.rolls; this.pending = null; this._done = null; this.deadline = null;
    await this.say("TIME'S UP! Tallying rolls...");
    for (const p of players) if (!res.has(p)) { const r = roll(this.rng); res.set(p, r); this.shown.set(p, r); await this.say(`Bot rolls - ${p}: ${show(r)} ${r.total >= this.target ? 'IN!' : 'OUT!'}${r.a === r.b ? ' = immunity for the next round!' : ''}`); }
    return res;
  }
  async play() {
    while (this.alive.length > 1) {
      if (this.round >= this.cfg.MAX_ROUNDS) { this.state = 'ended'; await this.api.refund(this.room); await this.say('Too many rounds. Game cancelled, entries refunded.'); return this.idle(); }
      this.round++; this.shown = new Map();
      const bot = roll(this.rng); this.target = bot.total;
      await this.say(`ROUND #${this.round}: Bot rolled ${show(bot)}. Your TARGET: ${this.target}!`);
      await this.say(`Players: !r to roll. ${this.cfg.ROLL_SECONDS} seconds.`);
      const res = await this.collect([...this.alive], this.cfg.ROLL_SECONDS);
      const ins = this.alive.filter(p => res.get(p).total >= this.target);
      const nextImmune = new Set(this.alive.filter(p => res.get(p).a === res.get(p).b));
      if (!ins.length) await this.say(`No one hit the TARGET (${this.target}) - nobody is eliminated, everyone advances!`);
      else {
        const outs = this.alive.filter(p => !ins.includes(p) && !this.immune.has(p)), saved = this.alive.filter(p => !ins.includes(p) && this.immune.has(p));
        if (outs.length) await this.say(`Eliminated: ${list(outs)}.`);
        if (saved.length) await this.say(`${list(saved)} stay in thanks to immunity.`);
        this.alive = this.alive.filter(p => !outs.includes(p));
      }
      this.immune = nextImmune;
      if (this.alive.length > 1) {
        await this.say(`Remaining players are ${list(this.alive)} (${this.alive.length} players).`);
        await sleep(this.cfg.PAUSE_MS);
        await this.say(`Players, get ready for round #${this.round + 1}!`);
        await sleep(this.cfg.PAUSE_MS);
      }
    }
    const winner = this.alive[0], prize = Math.floor(this.pot * (1 - this.cfg.RAKE_PERCENT / 100));
    this.winner = winner; this.prize = prize;
    await this.api.settle(this.room, winner, prize);
    this.state = 'ended';
    await this.say(`Game over! ${winner} WINS ${prize} coins!! CONGRATS!`);
    return this.idle();
  }
  async idle() { if (this.cfg.IDLE_MESSAGE) await this.say(this.cfg.IDLE_MESSAGE); }
}

class DiceBot {
  constructor(api, cfg = {}, rng = Math.random) { this.api = api; this.cfg = { ...CFG, ...cfg }; this.rng = rng; this.games = new Map(); }
  running(room) { const g = this.games.get(room); return !!g && g.state !== 'ended'; }
  async handle(room, user, text) {
    const cmd = text.trim().toLowerCase(), g = this.games.get(room);
    if (cmd.startsWith('!start')) {
      const m = cmd.match(/^!start(?:\s+(\d+))?$/);
      if (!m) return this.api.say(room, 'Usage: !start  or  !start <amount>');
      const entry = m[1] ? parseInt(m[1], 10) : this.cfg.DEFAULT_ENTRY;
      if (entry < this.cfg.MIN_ENTRY || entry > this.cfg.MAX_ENTRY) return this.api.say(room, `Entry must be between ${this.cfg.MIN_ENTRY} and ${this.cfg.MAX_ENTRY} coins.`);
      if (this.running(room)) return this.api.say(room, 'A game is already running.');
      const game = new DiceGame(room, this.api, entry, this.cfg, this.rng); this.games.set(room, game);
      return game.open(user);
    }
    if (!g || g.state === 'ended') return;
    if (cmd === '!j' || cmd === '!join') return g.join(user);
    if (cmd === '!r' || cmd === '!d' || cmd === '!roll') return g.onRoll(user);
  }
}
module.exports = { DiceBot, CFG };

if (require.main === module) {
  const w = { a: 1000, b: 1000, c: 1000 }, pend = [];
  const api = { say: async (r, t) => console.log('[Dice Bot]', t), debit: async (r, u, n) => { if (w[u] >= n) { w[u] -= n; pend.push([u, n]); return true; } return false; },
    settle: async (r, x, p) => { w[x] += p; pend.length = 0; }, refund: async () => { for (const [u, n] of pend) w[u] += n; pend.length = 0; } };
  const bot = new DiceBot(api, { JOIN_SECONDS: 1, ROLL_SECONDS: 1, PAUSE_MS: 10 });
  bot.handle('r', 'a', '!start 100'); setTimeout(() => { bot.handle('r', 'b', '!j'); bot.handle('r', 'c', '!j'); }, 100);
  setTimeout(() => bot.handle('r', 'a', '!r'), 1500); setTimeout(() => { console.log(w); process.exit(0); }, 6000);
}
