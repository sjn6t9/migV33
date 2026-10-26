// Cricket Bot - platform independent game engine (Node.js 16+)
// Commands: !start (100 coins)  !start <amount>  !j  !d
// Connect it to your chat platform via the `api` object (see bottom).

const CFG = {
  defaultCost: 100,    // !start  -> default entry cost
  minCost: 10,         // allowed range for !start <amount>
  maxCost: 1000000,
  joinSeconds: 30,
  batSeconds: 30,
  maxRounds: 6,
  minPlayers: 2,
  feePercent: 10,      // house cut from the pot (0 = no cut)
  nextRoundDelay: 2,   // seconds
  countDelay: 1.5,     // "Counting runs..." delay
  idleMessage: "Play Cricket Bot. Type !start to start the game.",
  openMark: "🔓",    // appended to the "New cricket game started" message (set "" to disable)
  closeMark: "🔒",   // sent after "Game Over" (set "" to disable)
  // Draw outcomes (weight = chance). Edit freely.
  // Optional: add icon: "<platform emoticon code>" to an outcome to show it before the label.
  outcomes: [
    { label: "One",   runs: 1, w: 28 },
    { label: "Two",   runs: 2, w: 18 },
    { label: "Three", runs: 3, w: 9 },
    { label: "FOUR!", runs: 4, w: 9 },
    { label: "SIX!",  runs: 6, w: 8 },
    { label: "no run, dot ball!", runs: 0, w: 16 },
    { label: "Caught!",  out: true, w: 5 },
    { label: "Run Out!", out: true, w: 3 },
    { label: "LBW!",     out: true, w: 4 },
  ],
};

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const runsText = (n) => `${n} run${n === 1 ? "" : "s"}`;

function draw() {
  const total = CFG.outcomes.reduce((a, o) => a + o.w, 0);
  let x = Math.random() * total;
  for (const o of CFG.outcomes) if ((x -= o.w) < 0) return o;
  return CFG.outcomes[0];
}

class CricketGame {
  constructor(room, api, cost) {
    this.room = room;
    this.api = api;
    this.cost = cost;
    this.state = "joining"; // joining | playing | ended
    this.players = [];      // usernames
    this.total = {};        // total runs
    this.out = new Set();
    this.round = 0;
    this.draws = null;
    this.pendingPlayers = null;
  }

  say(t) { return this.api.say(this.room, t); }

  async open(starter) {
    // the starter automatically joins (no "joined" message). Nobody pays yet.
    this.players.push(starter);
    this.total[starter] = 0;
    await this.say(`New cricket game started. !j to join, cost ${this.cost} coins [${CFG.joinSeconds} seconds]${CFG.openMark ? " " + CFG.openMark : ""}`);
    await sleep(CFG.joinSeconds);

    // Joining is over: charge the entry fee now. Players without enough coins are dropped.
    this.state = "starting";
    const paid = [];
    for (const p of this.players) {
      if (await this.api.takeCredits(p, this.cost)) paid.push(p);
      else await this.say(`${p} does not have enough coins (${this.cost}), removed from the game.`);
    }
    this.players = paid;
    if (paid.length < CFG.minPlayers) {
      for (const p of paid) await this.api.addCredits(p, this.cost);
      await this.say("Not enough players. Game cancelled, coins refunded.");
      this.state = "ended";
      return;
    }
    this.state = "playing";
    this.pot = paid.length * this.cost;
    await this.say(`Cricket game started. ${paid.length} players joined the game! Pot amount: ${this.pot} coins. Be ready to bat. Maximum round: ${CFG.maxRounds}!`);
    await this.play();
  }

  // Joining does NOT take coins; the fee is taken when the game starts.
  async join(user) {
    if (this.state !== "joining") return this.say("Joining is closed.");
    if (this.players.includes(user)) return this.say(`${user}, you already joined.`);
    this.players.push(user);
    this.total[user] = 0;
    return this.say(`${user} joined the game.`);
  }

  onDraw(user) {
    if (!this.pendingPlayers || !this.pendingPlayers.includes(user)) return;
    if (this.draws.has(user)) return;
    this.doDraw(user);
    if (this.draws.size === this.pendingPlayers.length && this._done) this._done();
  }

  doDraw(user) {
    const o = draw();
    this.draws.set(user, o);
    return this.say(`${user} bats: ${o.icon ? o.icon + " " : ""}${o.label}`);
  }

  // One batting round for the given players -> Map(user -> outcome)
  async collect(players) {
    this.pendingPlayers = players;
    this.draws = new Map();
    await new Promise((res) => {
      this._done = res;
      this._timer = setTimeout(res, CFG.batSeconds * 1000);
    });
    clearTimeout(this._timer);
    const rest = players.filter((p) => !this.draws.has(p));
    if (rest.length) {
      await this.say("Times up! Drawing for remaining players...");
      for (const p of rest) await this.doDraw(p);
    }
    const result = this.draws;
    this.pendingPlayers = null;
    this._done = null;
    return result;
  }

  async play() {
    while (true) {
      this.round++;
      const active = this.players.filter((p) => !this.out.has(p));
      await this.say(`Round #${this.round}. Players !d to bat [${CFG.batSeconds} seconds]`);
      const res = await this.collect(active);

      await this.say("Counting runs...");
      await sleep(CFG.countDelay);
      for (const p of active) {
        const o = res.get(p);
        if (o.out) this.out.add(p);
        else this.total[p] += o.runs;
      }
      // "Counting runs" shows each player's TOTAL runs, highest first (outs are not listed)
      const scorers = active.filter((p) => !this.out.has(p)).sort((a, b) => this.total[b] - this.total[a]);
      for (const p of scorers) await this.say(`${p} (${runsText(this.total[p])})`);

      const left = this.players.filter((p) => !this.out.has(p));
      if (left.length === 1) return this.finish(left[0], "last player standing");
      if (left.length === 0) return this.decide(active); // everyone out this round
      if (this.round >= CFG.maxRounds) return this.decide(left);

      await this.say(`Remaining players are ${left.join(", ")} (${left.length} players).`);
      await this.say(`All players next round in ${CFG.nextRoundDelay} seconds.`);
      await sleep(CFG.nextRoundDelay);
    }
  }

  // Highest total wins; ties go to tie-break rounds
  async decide(candidates) {
    let pool = candidates;
    const max = Math.max(...pool.map((p) => this.total[p]));
    pool = pool.filter((p) => this.total[p] === max);

    while (pool.length > 1) {
      await this.say(`Tie between ${pool.join(", ")} (${runsText(max)})! Tie-break round. !d to bat [${CFG.batSeconds} seconds]`);
      const res = await this.collect(pool);
      await this.say("Counting runs...");
      await sleep(CFG.countDelay);
      const score = (p) => (res.get(p).out ? 0 : res.get(p).runs);
      for (const p of pool) await this.say(`${p} (${runsText(score(p))})`);
      const best = Math.max(...pool.map(score));
      pool = pool.filter((p) => score(p) === best);
      if (pool.length > 1) await this.say("Still tied! Another tie-break round...");
    }
    return this.finish(pool[0], `${runsText(this.total[pool[0]])}`);
  }

  async finish(winner, how) {
    const prize = Math.floor(this.pot * (1 - CFG.feePercent / 100));
    await this.api.addCredits(winner, prize);
    const runs = this.total[winner];
    await this.say(`Game Over! ${winner} won ${prize} coins with ${runsText(runs)}. CONGRATS!`);
    this.state = "ended";
    if (CFG.closeMark) await this.say(CFG.closeMark);
    if (CFG.idleMessage) await this.say(CFG.idleMessage);
  }
}

// ---------- Room manager ----------
class CricketBot {
  constructor(api) {
    this.api = api;
    this.games = new Map();
  }

  // Call this for every chat message: bot.handle(roomId, username, text)
  async handle(room, user, text) {
    const cmd = text.trim().toLowerCase();
    const g = this.games.get(room);
    if (cmd.startsWith("!start")) {
      const m = cmd.match(/^!start(?:\s+(\d+))?$/);
      if (!m) return this.api.say(room, "Usage: !start  or  !start <amount>");
      const cost = m[1] ? parseInt(m[1], 10) : CFG.defaultCost;
      if (cost < CFG.minCost || cost > CFG.maxCost)
        return this.api.say(room, `Amount must be between ${CFG.minCost} and ${CFG.maxCost} coins.`);
      if (g && g.state !== "ended") return this.api.say(room, "A game is already running.");
      const game = new CricketGame(room, this.api, cost);
      this.games.set(room, game);
      return game.open(user);
    }
    if (!g || g.state === "ended") return;
    if (cmd === "!j") return g.join(user);
    if (cmd === "!d") return g.onDraw(user);
  }
}

module.exports = { CricketBot, CFG };

// ---------- Demo: node cricket-bot.js ----------
if (require.main === module) {
  CFG.joinSeconds = 1; CFG.batSeconds = 2; CFG.countDelay = 0.3; CFG.nextRoundDelay = 0.3;
  const wallet = { mig: 1000, administration: 1000, rafi: 1000 };
  const api = {
    say: async (room, t) => console.log("[Cricket Bot]", t),
    takeCredits: async (u, n) => (wallet[u] >= n ? ((wallet[u] -= n), true) : false),
    addCredits: async (u, n) => { wallet[u] = (wallet[u] || 0) + n; },
  };
  const bot = new CricketBot(api);
  bot.handle("room1", "administration", "!start 200");
  setTimeout(() => bot.handle("room1", "mig", "!j"), 100);
  setTimeout(() => bot.handle("room1", "rafi", "!j"), 300);
  // players type !d each round
  setInterval(() => {
    for (const u of ["mig", "administration", "rafi"]) bot.handle("room1", u, "!d");
  }, 700);
  setTimeout(() => { console.log(wallet); process.exit(0); }, 30000);
}
