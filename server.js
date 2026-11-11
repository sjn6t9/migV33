import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createPush } from './webpush.js';
import Module, { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_ERR = {};
// Loads a game engine written as CommonJS. Accepts name.cjs or name.js (GitHub uploads often end up as .js).
function loadEngine(base) {
  const tried = [];
  for (const ext of ['.cjs', '.js']) {
    for (const dir of [ROOT, process.cwd()]) {
      const f = path.join(dir, base + ext); tried.push(f);
      if (!fs.existsSync(f)) continue;
      try {
        if (ext === '.cjs') return require(f);
        const m = new Module(f); m.filename = f; m.paths = Module._nodeModulePaths(path.dirname(f)); m._compile(fs.readFileSync(f, 'utf8'), f); return m.exports;
      } catch (e) { ENGINE_ERR[base + '.cjs'] = e.message; console.error('[engine] ' + base + ' failed to load:', e.message); return null; }
    }
  }
  ENGINE_ERR[base + '.cjs'] = 'file not found'; console.error('[engine] ' + base + ' not found (looked for .cjs / .js next to server.js)');
  return null;
}
let TP = null;   // Teen Patti Gold engine (virtual coins, for fun only); the site still runs if the file is missing
let RB = null;   // Royale Battle engine (room "royale")
RB = loadEngine('royale-battle');
let DC = null;   // Dice Bot engine
DC = loadEngine('dice');
let LC = null;   // LowCard Bot engine (room "lowcard")
LC = loadEngine('lowcard');
let CB = null;   // Cricket Bot engine (room "cricket")
CB = loadEngine('cricket-bot');
TP = loadEngine('teen-patti');

const STAFF_USER = (process.env.STAFF_USER || 'migv33').toLowerCase();
const STAFF_EMAIL = (process.env.STAFF_EMAIL || '').toLowerCase();
const SECRET = process.env.JWT_SECRET || 'change-me-now';
const PORT = process.env.PORT || 3000;
const db = new Database('migv33.db');
db.exec(`create table if not exists users(id integer primary key, name text unique, pass text, coins int default 0, full_name text, email text unique, gender text, bio text default '', status_text text default '', presence text default 'online', xp int default 0, role text default 'user', verified int default 0, spins int default 0, last_spin text default '');
create table if not exists msgs(id integer primary key, room text, user text, text text, kind text default 'msg', ts int)`);

for (const a of ["alter table users add column country text default ''", "alter table users add column mobile text default ''", "alter table users add column sec_q text default ''",
  "alter table users add column sec_a text default ''", "alter table users add column mpin text default ''", 'alter table users add column banned int default 0', "alter table users add column ban_reason text default ''"]) { try { db.exec(a); } catch {} }
db.exec('create table if not exists admin_log(id integer primary key, staff text, target text, action text, detail text, ts int)');
const isMain = n => String(n || '').toLowerCase() === STAFF_USER;
// The main staff account (migv33) has unlimited coins: its balance is topped up automatically after any change.
const UNL_COINS = 1000000000000, UN = STAFF_USER.replace(/[^a-z0-9._-]/g, '');
db.exec('drop trigger if exists unl_coins');
db.exec(`create trigger unl_coins after update of coins on users when lower(new.name)='${UN}' and new.coins<${UNL_COINS} begin update users set coins=${UNL_COINS} where id=new.id; end`);
db.prepare('update users set coins=? where lower(name)=? and coins<?').run(UNL_COINS, UN, UNL_COINS);

db.exec(`create table if not exists gifts(key text primary key, name text, icon text, cost int, recv int, active int default 1, ts int);
create table if not exists gift_inv(user text, gift text, n int default 0, primary key(user,gift))`);
const GIFTS = { rose: { n: 'Rose', c: 10, e: '🌹' }, heart: { n: 'Heart', c: 20, e: '💖' }, crown: { n: 'Crown', c: 100, e: '👑' } };

const app = express();
app.set('trust proxy', 1); // behind Caddy: use the real visitor IP for rate limits
app.use(express.json());
// The GitHub repo may hold everything in one flat folder: fall back to files next to server.js
const newest = (...fs_) => fs_.filter(f => fs.existsSync(f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
app.get(['/', '/index.html'], (q, r, next) => { const f = newest(path.join(ROOT, 'public/index.html'), path.join(ROOT, 'index.html')); f ? r.sendFile(f) : next(); });
const BADGE_FILES = { hmt: ['hmt.png', 'Head-Mentor-HMT.png', 'head-mentor-hmt.png'], vip: ['vip.png', 'VIP.png'] };
app.get('/badges/:f', (q, r, next) => {
  const n = q.params.f.replace(/\.png$/i, '').toLowerCase();
  if (!/^[a-z]+$/.test(n)) return next();
  const f = newest(...(BADGE_FILES[n] || [n + '.png']).flatMap(x => [path.join(ROOT, 'public/badges', x), path.join(ROOT, x)]));
  f ? r.sendFile(f) : next();
});
app.get(['/Logo.PNG', '/logo.png'], (q, r, next) => { const f = newest(path.join(ROOT, 'public/Logo.PNG'), path.join(ROOT, 'Logo.PNG')); f ? r.sendFile(f) : next(); });   // app icon (notifications, home screen)
app.use(express.static('public'));
fs.mkdirSync('uploads', { recursive: true });
app.use('/uploads', express.static('uploads', { maxAge: '7d', setHeaders: res => res.set('X-Content-Type-Options', 'nosniff') }));
const PUSH = createPush(db);
app.get('/api/push/key', (q, r) => r.json({ key: PUSH.publicKey }));
app.post('/api/call/decline', (q, r) => {   // the "Decline" button on the call notification (works without opening the app)
  const c = calls.get(String(q.body?.id || ''));
  if (c && c.state === 'ring' && c.key && q.body?.key === c.key) callEnd(c, 'declined', c.to);
  r.json({ ok: true });
});
const sign = (id, name) => jwt.sign({ id, name }, SECRET, { expiresIn: '365d' });
const bad = (r, m, s = 400) => r.status(s).json({ error: m });

const pending = new Map(); // username -> signup waiting for its email code
const hits = new Map();
const mailer = process.env.SMTP_HOST ? nodemailer.createTransport({
  host: process.env.SMTP_HOST, port: +(process.env.SMTP_PORT || 465), secure: (process.env.SMTP_PORT || '465') === '465',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
}) : null;
async function sendCode(email, code) {
  if (!mailer) return console.log(`[verification] ${email}: ${code}`); // no SMTP set: code goes to the server log
  await mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: email,
    subject: 'Your migv33 verification code', text: `Your verification code is ${code}. It expires in 10 minutes.` });
}
function createUser(name, p) {
  const i = db.prepare('insert into users(name,pass,full_name,email,gender) values(?,?,?,?,?)').run(name, p.hash, p.fullName, p.email, p.gender);
  pending.delete(name);
  db.prepare('update users set joined=? where name=?').run(Date.now(), name);
  db.prepare('update users set coins=coins+500, spins=spins+1 where name=?').run(name); addTx(name, 'other', 'Level 1 reward', 500);
  if (name.toLowerCase() === STAFF_USER) db.prepare("update users set role='staff', verified=1 where name=?").run(name);
  return sign(i.lastInsertRowid, name);
}
app.post('/api/signup/start', async (q, r) => {
  const now = Date.now();
  const h = (hits.get(q.ip) || []).filter(t => now - t < 3600e3);
  if (h.length >= 15) return bad(r, 'Too many attempts. Please try again later.', 429);
  hits.set(q.ip, [...h, now]);
  const { fullName = '', name = '', email = '', gender = '', pass = '' } = q.body || {};
  if (fullName.trim().length < 2 || fullName.length > 40) return bad(r, 'Enter your full name.');
  if (/[A-Z]/.test(name)) return bad(r, 'Username cannot have capital letters. Use small letters only.');
  if (/\s/.test(name)) return bad(r, 'Username cannot have spaces.');
  if (/^[0-9]/.test(name)) return bad(r, 'Username cannot start with a number.');
  if (!/^[a-z0-9._-]{3,16}$/.test(name)) return bad(r, 'Username must be 3–16 characters: small letters (a–z), numbers, dot (.), dash (-) or underscore (_).');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 100) return bad(r, 'Enter a valid email address.');
  if (!['Male', 'Female', 'Other'].includes(gender)) return bad(r, 'Select your gender.');
  if (pass.length < 6) return bad(r, 'Password must be at least 6 characters.');
  const em = email.toLowerCase(), ln = name.toLowerCase();
  const claim = ln === STAFF_USER && STAFF_EMAIL && em === STAFF_EMAIL;
  if (!claim && (ln.includes(STAFF_USER) || ['admin', 'staff', 'mentor', 'headmentor', 'merchant', 'vip', 'support'].includes(ln))) return bad(r, 'That username is reserved.');
  if (db.prepare('select 1 from users where lower(name)=? or email=?').get(ln, em)) return bad(r, 'That username or email is already registered.', 409);
  if (!mailer) return bad(r, 'Email verification is not set up yet. Please try again later.', 503); // never create an account without the email code
  const code = String(crypto.randomInt(100000, 1000000));
  pending.set(name, { email: em, code, exp: now + 600e3, tries: 0, fullName: fullName.trim(), gender, hash: bcrypt.hashSync(pass, 10) });
  try { await sendCode(em, code); } catch (e) { console.error(e); return bad(r, 'Could not send the verification email. Please try again.', 502); }
  r.json({ ok: true });
});
app.post('/api/signup/verify', (q, r) => {
  const { name = '', code = '' } = q.body || {};
  const p = pending.get(name);
  if (!p || Date.now() > p.exp) return bad(r, 'Code expired. Go back and press Next to get a new one.');
  if (++p.tries > 5) { pending.delete(name); return bad(r, 'Too many wrong codes. Please start again.', 429); }
  if (String(code).trim() !== p.code) return bad(r, 'Wrong verification code.');
  try { r.json({ token: createUser(name, p) }); } catch { bad(r, 'That username or email is already registered.', 409); }
});
app.post('/api/login', (q, r) => {
  const { name, pass } = q.body || {};
  const u = db.prepare('select * from users where lower(name)=lower(?)').get(name || '');
  if (!u || !bcrypt.compareSync(pass || '', u.pass)) return bad(r, 'Wrong username or password', 401);
  if (u.banned) return bad(r, 'This account has been banned.' + (u.ban_reason ? ' Reason: ' + u.ban_reason : ''), 403);
  r.json({ token: sign(u.id, u.name) });
});

// ---------- Forgot password: 6-digit code by email ----------
const resets = new Map(); // username -> { code, exp, tries }
const fhits = new Map();
app.post('/api/forgot', async (q, r) => {
  const now = Date.now(), h = (fhits.get(q.ip) || []).filter(t => now - t < 3600e3);
  if (h.length >= 8) return bad(r, 'Too many attempts. Please try again later.', 429);
  fhits.set(q.ip, [...h, now]);
  const id = String((q.body || {}).id || '').trim().toLowerCase().slice(0, 100);
  if (!id) return bad(r, 'Enter your username or email.');
  if (!mailer) return bad(r, 'Email is not set up yet. Please try again later.', 503);
  const u = db.prepare('select name,email from users where lower(name)=? or lower(email)=?').get(id, id);
  if (u && u.email) {
    const code = String(crypto.randomInt(100000, 1000000));
    resets.set(u.name.toLowerCase(), { code, exp: now + 600e3, tries: 0 });
    try { await mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: u.email, subject: 'Reset your migv33 password', text: `Your password reset code is ${code}. It expires in 10 minutes. If you did not ask for this, ignore this email.` }); }
    catch (e) { console.error(e); return bad(r, 'Could not send the email. Please try again.', 502); }
  }
  const mk = e => { const k = String(e).lastIndexOf('@'), l = k < 0 ? String(e) : String(e).slice(0, k), d = k < 0 ? '' : String(e).slice(k); return (l.length >= 4 ? l.slice(0, 2) + '***' + l.slice(-1) : l.slice(0, 1) + '***') + d; };
  r.json({ ok: true, hint: mk(u && u.email ? u.email : (id.includes('@') ? id : id + '@gmail.com')) });   // same shape whether or not the account exists
});
app.post('/api/reset', (q, r) => {
  const { id = '', code = '', pass = '' } = q.body || {};
  const u = db.prepare('select name from users where lower(name)=? or lower(email)=?').get(String(id).trim().toLowerCase(), String(id).trim().toLowerCase());
  const p = u && resets.get(u.name.toLowerCase());
  if (!p || Date.now() > p.exp) return bad(r, 'Code expired. Go back and request a new one.');
  if (++p.tries > 5) { resets.delete(u.name.toLowerCase()); return bad(r, 'Too many wrong codes. Please request a new one.', 429); }
  if (String(code).trim() !== p.code) return bad(r, 'Wrong code.');
  if (String(pass).length < 6) return bad(r, 'Password must be at least 6 characters.');
  db.prepare('update users set pass=? where name=?').run(bcrypt.hashSync(pass, 10), u.name);
  resets.delete(u.name.toLowerCase());
  r.json({ ok: true });
});

// ---------- Social API ----------
db.exec(`create table if not exists posts(id integer primary key, user text, text text, shares int default 0, ts int);
create table if not exists reacts(post int, user text, primary key(post,user));
create table if not exists comments(id integer primary key, post int, user text, text text, ts int);
create table if not exists friends(a text, b text, status text, primary key(a,b));
create table if not exists txs(id integer primary key, user text, kind text, title text, amount int, ts int);
create table if not exists rooms(name text primary key, cat text, owner text);
create table if not exists favs(user text, room text, primary key(user,room));
create table if not exists bans(room text, user text, by text, ts int, until int default 0, primary key(room,user));
create table if not exists room_mods(room text, user text, primary key(room,user));
create table if not exists room_cfg(room text primary key, locked int default 0, silence_until int default 0, announce text default '');
create table if not exists blocks(a text, b text, primary key(a,b));
create table if not exists call_log(id integer primary key autoincrement, a text, b text, kind text, status text, dur integer default 0, ts integer);
create index if not exists call_log_a on call_log(a);
create index if not exists call_log_b on call_log(b);
create table if not exists tp_pending(room text, hand text, user text, amount int);
create table if not exists tp_hands(id integer primary key, ts int, info text);
create table if not exists rb_pending(room text, round int, user text, option text, amount int);
create table if not exists lc_pending(room text, user text, amount int);
create table if not exists mutes(room text, user text, until int, primary key(room,user))`);
for (const a of ['alter table room_mods add column super int default 0', 'alter table rooms add column cap int default 0', "alter table rooms add column descr text default ''", 'alter table rooms add column minlv int default 0']) { try { db.exec(a); } catch {} }
db.exec(`create table if not exists room_game(room text primary key, game text);
create table if not exists kv(k text primary key, v text)`);
const gameOf = room => db.prepare('select game from room_game where room=?').get(room)?.game || '';
try { db.exec("alter table rooms add column flag text default ''"); } catch {}
// Rooms: every Asian country (with its flag) in Chat Rooms, and one room per game bot in Game Rooms.
const ASIA = [['Afghanistan','af'],['Armenia','am'],['Azerbaijan','az'],['Bahrain','bh'],['Bangladesh','bd'],['Bhutan','bt'],['Brunei','bn'],['Cambodia','kh'],['China','cn'],['Cyprus','cy'],['Georgia','ge'],['Hong Kong','hk'],['India','in'],['Indonesia','id'],['Iran','ir'],['Iraq','iq'],['Israel','il'],['Japan','jp'],['Jordan','jo'],['Kazakhstan','kz'],['Kuwait','kw'],['Kyrgyzstan','kg'],['Laos','la'],['Lebanon','lb'],['Malaysia','my'],['Maldives','mv'],['Mongolia','mn'],['Myanmar','mm'],['Nepal','np'],['North Korea','kp'],['Oman','om'],['Pakistan','pk'],['Palestine','ps'],['Philippines','ph'],['Qatar','qa'],['Saudi Arabia','sa'],['Singapore','sg'],['South Korea','kr'],['Sri Lanka','lk'],['Syria','sy'],['Taiwan','tw'],['Tajikistan','tj'],['Thailand','th'],['Timor Leste','tl'],['Turkey','tr'],['Turkmenistan','tm'],['United Arab Emirates','ae'],['Uzbekistan','uz'],['Vietnam','vn'],['Yemen','ye']];
const GAME_ROOMS = [['LowCard', 'lowcard'], ['Cricket', 'cricket'], ['Dice', 'dice'], ['TeenPatti', 'tp'], ['Royale Battle', 'royale']];
try { db.exec('alter table users add column vip int default 0'); } catch {}
if (!db.prepare("select 1 from kv where k='vip_flag_v1'").get()) {   // the old 'vip' role becomes a VIP badge, like Verified
  db.prepare("update users set vip=1, role='user' where role='vip'").run();
  db.prepare("insert into kv values('vip_flag_v1','1')").run();
}
if (!db.prepare("select 1 from kv where k='rooms_asia_v1'").get()) {   // first start with this version only: remove all old rooms
  db.transaction(() => {
    for (const t of ['rooms', 'favs', 'bans', 'room_mods', 'room_cfg', 'mutes', 'msgs', 'room_game', 'tp_pending', 'rb_pending', 'lc_pending']) { try { db.exec(`delete from ${t}`); } catch {} }
    try { db.exec('delete from room_seen'); db.exec('delete from room_since'); } catch {}
    db.prepare("insert into kv values('rooms_asia_v1','1')").run();
  })();
}
for (const [n, f] of ASIA) { db.prepare('insert or ignore into rooms(name,cat,owner,flag) values(?,?,?,?)').run(n, 'official', null, f); db.prepare("update rooms set flag=? where name=? and coalesce(flag,'')=''").run(f, n); }
for (const [n, g] of GAME_ROOMS) { db.prepare('insert or ignore into rooms(name,cat,owner) values(?,?,?)').run(n, 'game', null); db.prepare('insert or ignore into room_game values(?,?)').run(n, g); }
const roomOk = n => /^dm:/.test(n) || !!db.prepare('select 1 from rooms where name=?').get(n);
const auth = (q, r, next) => {
  let u;
  try { const t = jwt.verify((q.headers.authorization || '').slice(7), SECRET); u = db.prepare('select name,banned,ban_reason from users where id=?').get(t.id); } catch {}
  if (!u) return bad(r, 'Please log in again', 401);
  if (u.banned) return bad(r, 'Your account has been banned.' + (u.ban_reason ? ' Reason: ' + u.ban_reason : ''), 403);
  q.user = u.name; next();
};
const addTx = (user, kind, title, amount) => { const x = db.prepare('insert into txs(user,kind,title,amount,ts) values(?,?,?,?,?)').run(user, kind, title, amount, Date.now()); try { lbFromTx(user, kind, title, amount); } catch (e) { console.log('[lb]', e.message); } return x; };
const roleOf = n => db.prepare('select role from users where name=?').get(n)?.role || 'user';
// ---- Levels: STEPS[L-1] = XP needed to go from level L to L+1. Past level 27 the cost grows by 392.5 per level. ----
const MAXLV = 1000;
const STEPS = [20, 98, 176, 253, 331, 409, 487, 564, 640, 641, 760, 878, 996, 1113, 1231, 1349, 1467, 1584, 1702, 1820, 1938, 2056, 2172, 2290, 2291, 2684, 3076];
const lvStep0 = L => STEPS[L - 1] ?? Math.round(3076 + 392.5 * (L - 27));
const lvStep = L => lvStep0(L) * (L >= 20 ? 2 : 1); // from level 20 onward every level costs double XP
const CUM = [0, 0]; for (let L = 1; L < MAXLV; L++) CUM[L + 1] = CUM[L] + lvStep(L);
const level = xp => { let lo = 1, hi = MAXLV; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (CUM[m] <= xp) lo = m; else hi = m - 1; } return lo; };
const REWARDS = { 1: 500, 5: 500, 10: 1000, 15: 3000, 20: 5000, 25: 10000, 30: 15000, 35: 20000, 40: 25000, 45: 30000, 50: 35000, 55: 40000, 60: 45000, 65: 50000, 70: 60000, 75: 70000, 80: 80000 };
const levelReward = L => REWARDS[L] || (L >= 90 && L % 10 === 0 ? L * 1000 : 0);
function addXp(name, n) {
  const u = db.prepare('select xp from users where name=?').get(name); if (!u) return;
  const before = level(u.xp), xp = u.xp + n, after = level(xp);
  db.prepare('update users set xp=? where name=?').run(xp, name);
  let total = 0;
  for (let L = before + 1; L <= after; L++) { const rw = levelReward(L); if (rw) { total += rw; db.prepare('update users set coins=coins+? where name=?').run(rw, name); addTx(name, 'other', `Level ${L} reward`, rw); } }
  if (after > before) setImmediate(() => notify(name, 'rewards', `Level up! You reached level ${after}${total ? ` (+${total.toLocaleString()} coins)` : ''}`));
  if (after > before) wss.clients.forEach(w => { if (w.user === name) { send(w, { t: 'levelup', level: after, reward: total }); send(w, { t: 'coins', coins: coins(name) }); } });
}

// ---------- Chatroom levels: chat, gifts and games add room XP; the owner earns 2% of the coins spent in the room each day ----------
db.exec(`create table if not exists room_stat(room text primary key, xp real default 0);
create table if not exists room_day(room text, day text, spent int default 0, paid int default 0, primary key(room,day))`);
const TZOFF = 6 * 3600e3, DAYMS = 864e5;   // days roll over at 12:00 midnight, Bangladesh time
const dayKey = (t = Date.now()) => new Date(t + TZOFF).toISOString().slice(0, 10);
const nextMidnight = (t = Date.now()) => Math.floor((t + TZOFF) / DAYMS) * DAYMS + DAYMS - TZOFF;
const roomLevel = xp => Math.min(100, 1 + Math.floor(Math.sqrt(Math.max(0, xp || 0) / 200)));   // L2 = 200 XP, L3 = 800, L10 = 16,200
const roomXpOf = room => db.prepare('select xp from room_stat where room=?').get(room)?.xp || 0;
const ROOM_OWNER_PCT = 0.02;
function roomXp(room, n) {
  if (!room || /^dm:/.test(room) || !(n > 0)) return;
  const before = roomLevel(roomXpOf(room));
  db.prepare('insert into room_stat(room,xp) values(?,?) on conflict(room) do update set xp=xp+?').run(room, n, n);
  const after = roomLevel(roomXpOf(room));
  if (after > before) setImmediate(() => { try { cast(room, { t: 'msg', room, user: 'Room', text: `🎉 This room reached Level ${after}!`, kind: 'game', ts: Date.now(), role: '' }); } catch {} });
}
function roomSpend(room, coins) {
  if (!room || /^dm:/.test(room) || !(coins > 0)) return;
  db.prepare('insert into room_day(room,day,spent) values(?,?,?) on conflict(room,day) do update set spent=spent+?').run(room, dayKey(), coins, coins);
}
const curRoom = user => { for (const w of wss.clients) if (w.user === user && w.room && !/^dm:/.test(w.room)) return w.room; return ''; };
const giftXpVal = price => { const t = GIFT_XP.find(x => price <= x[0]) || GIFT_XP[GIFT_XP.length - 1]; return t[2] / t[1]; };
function payRoomOwners() {
  const today = dayKey();
  for (const x of db.prepare('select room,day,spent from room_day where paid=0 and day<?').all(today)) {
    const owner = db.prepare('select owner from rooms where name=?').get(x.room)?.owner, amt = Math.floor(x.spent * ROOM_OWNER_PCT);
    db.prepare('update room_day set paid=1 where room=? and day=?').run(x.room, x.day);
    if (!owner || amt < 1 || !db.prepare('select 1 from users where name=?').get(owner)) continue;
    db.prepare('update users set coins=coins+? where name=?').run(amt, owner);
    addTx(owner, 'other', `Room earnings · Room: ${x.room} · 2% of ${x.spent.toLocaleString()} coins spent on ${x.day}`, amt);
    setImmediate(() => { notify(owner, 'rewards', `Your room ${x.room} earned you ${amt.toLocaleString()} coins (2% of today's spending)`); pushCoins(owner); });
  }
  db.prepare('delete from room_day where paid=1 and day<?').run(dayKey(Date.now() - 14 * DAYMS));
}

// ---------- Daily leaderboards: Top 3 of the day win coins at midnight ----------
db.exec(`create table if not exists lb_day(day text, cat text, user text, score real default 0, primary key(day,cat,user));
create table if not exists lb_paid(day text, cat text, ts int, primary key(day,cat));
create table if not exists lb_award(id integer primary key, day text, cat text, rank int, user text, score real, coins int, ts int)`);
const LB_CATS = { gift: 'Top 3 Gift Sender', lowcard: 'Top 3 Low Card Player', dice: 'Top 3 Dice Player', cricket: 'Top 3 Cricket Player', tp: 'Top 3 Teen Patti Player', royale: 'Top 3 Legendary Battle Player', active: 'Top 3 Active Player' };
const LB_HOW = { gift: 'Coins spent on gifts today', lowcard: 'Coins won in Low Card today', dice: 'Coins won in Dice today', cricket: 'Coins won in Cricket today', tp: 'Coins won in Teen Patti today', royale: 'Coins won in Legendary Battle today', active: 'Online minutes + messages sent today' };
const LB_PRIZE = [15000, 10000, 5000];
let LBC = null;
const lbCfg = () => LBC || (LBC = (() => { try { return JSON.parse(db.prepare("select v from kv where k='lb_cfg'").get()?.v || '{}'); } catch { return {}; } })());
const lbSave = c => { LBC = c; db.prepare("insert or replace into kv(k,v) values('lb_cfg',?)").run(JSON.stringify(c)); };
const lbLive = (cat, day = dayKey()) => { const c = lbCfg()[cat]; return !!(c && c.on && c.start <= day); };
const lbEligible = u => { const x = db.prepare('select role,banned from users where name=?').get(u); return !!x && !x.banned && !['staff', 'admin'].includes(x.role) && !/ Bot$/.test(u); };
function lbAdd(cat, user, n) {
  if (!user || !(n > 0) || !lbLive(cat)) return;
  db.prepare('insert into lb_day(day,cat,user,score) values(?,?,?,?) on conflict(day,cat,user) do update set score=score+?').run(dayKey(), cat, user, n, n);
}
function lbFromTx(user, kind, title, amount) {
  if (kind === 'gift' || kind === 'gs') { if (amount < 0 && /^Sent /.test(title)) lbAdd('gift', user, -amount); return; }
  if (kind !== 'game' || !(amount > 0)) return;
  const c = /^LowCard Bot: win/.test(title) ? 'lowcard' : /^Dice Bot: win/.test(title) ? 'dice' : /^Cricket Bot: payout/.test(title) ? 'cricket' : /^Teen Patti Gold: win/.test(title) ? 'tp' : /^Royale Battle: win/.test(title) ? 'royale' : '';
  if (c) lbAdd(c, user, amount);
}
const lbTop = (day, cat, n = 3) => db.prepare('select user,score from lb_day where day=? and cat=? order by score desc, user limit ?').all(day, cat, n + 20).filter(x => lbEligible(x.user)).slice(0, n);
function lbPay() {
  const today = dayKey(), cfg = lbCfg();
  for (const cat of Object.keys(LB_CATS)) {
    const c = cfg[cat]; if (!c || !c.on) continue;
    for (let t = Date.now() - 3 * DAYMS; dayKey(t) < today; t += DAYMS) {
      const day = dayKey(t); if (day < c.start || db.prepare('select 1 from lb_paid where day=? and cat=?').get(day, cat)) continue;
      db.prepare('insert into lb_paid values(?,?,?)').run(day, cat, Date.now());
      lbTop(day, cat).forEach((w, i) => {
        if (!(w.score > 0)) return;
        db.prepare('update users set coins=coins+? where name=?').run(LB_PRIZE[i], w.user);
        db.prepare('insert into lb_award(day,cat,rank,user,score,coins,ts) values(?,?,?,?,?,?,?)').run(day, cat, i + 1, w.user, w.score, LB_PRIZE[i], Date.now());
        addTx(w.user, 'other', `Leaderboard reward · ${LB_CATS[cat]} · #${i + 1} on ${day}`, LB_PRIZE[i]);
        setImmediate(() => { notify(w.user, 'rewards', `You finished #${i + 1} in ${LB_CATS[cat]}! +${LB_PRIZE[i].toLocaleString()} coins`); pushCoins(w.user); });
      });
    }
  }
  db.prepare('delete from lb_day where day<?').run(dayKey(Date.now() - 5 * DAYMS));
}
setInterval(() => { try { lbPay(); payRoomOwners(); } catch (e) { console.error('[daily]', e); } }, 30e3).unref();
const profile = n => { const u = db.prepare('select name,full_name,gender,country,bio,status_text,presence,xp,coins,role,joined,avatar,avatar_art,avatar_mode from users where name=?').get(n); if (!u) return u; const { avatar, avatar_art, avatar_mode, ...rest } = u; return { ...rest, presence: livePres(u.name, u.presence), level: level(u.xp), hasPhoto: !!avatar, hasArt: !!avatar_art, avatarMode: avatar_mode === 'avatar' && avatar_art ? 'avatar' : 'photo' }; };
const ok = fn => (q, r) => { const f = e => { console.error(e); if (!r.headersSent) bad(r, 'Server error', 500); }; try { const x = fn(q, r); if (x && x.catch) x.catch(f); } catch (e) { f(e); } };
app.get('/api/lb', auth, ok((q, r) => {
  const today = dayKey(), yday = dayKey(Date.now() - DAYMS), cfg = lbCfg();
  r.json({ prizes: LB_PRIZE, endsAt: nextMidnight(), now: Date.now(), cats: Object.keys(LB_CATS).filter(k => cfg[k]?.on).map(k => {
    const live = lbLive(k, today);
    return { key: k, label: LB_CATS[k], how: LB_HOW[k], live, starts: live ? null : cfg[k].start,
      top: live ? lbTop(today, k).map(x => ({ name: x.user, score: Math.round(x.score), role: roleOf(x.user) })) : [],
      last: db.prepare('select rank,user name,score,coins from lb_award where day=? and cat=? order by rank').all(yday, k).map(x => ({ ...x, score: Math.round(x.score) })) };
  }) });
}));
app.get('/api/admin/lb', auth, ok((q, r) => {
  if (roleOf(q.user) !== 'staff') return bad(r, 'Only staff can do this', 403);
  const cfg = lbCfg(), today = dayKey();
  r.json(Object.keys(LB_CATS).map(k => ({ key: k, label: LB_CATS[k], how: LB_HOW[k], on: !!cfg[k]?.on, start: cfg[k]?.start || '', live: lbLive(k, today) })));
}));
app.post('/api/admin/lb', auth, ok((q, r) => {
  if (roleOf(q.user) !== 'staff') return bad(r, 'Only staff can do this', 403);
  const k = String(q.body?.key || ''), on = !!q.body?.on; if (!LB_CATS[k]) return bad(r, 'Unknown leaderboard');
  const cfg = { ...lbCfg() }, cur = cfg[k] || {};
  if (on && !cur.on) cfg[k] = { on: true, start: dayKey(Date.now() + DAYMS) };   // switched on today: counting starts at tomorrow 12:00 AM
  else if (!on) cfg[k] = { on: false, start: '' };
  lbSave(cfg); alog(q.user, k, 'leaderboard', on ? 'on' : 'off'); r.json({ ok: true });
}));
const fstate = (a, b) => {
  const x = db.prepare('select * from friends where (a=? and b=?) or (a=? and b=?)').get(a, b, b, a);
  return !x ? 'none' : x.status === 'accepted' ? 'friends' : x.a === a ? 'sent' : 'incoming';
};

app.get('/api/me', auth, ok((q, r) => { const x = db.prepare('select email,mobile,mpin,sec_q from users where name=?').get(q.user); r.json({ ...profile(q.user), email: x.email, mobile: x.mobile, hasPin: !!x.mpin, secQ: x.sec_q || '', secQs: SEC_QS, unlimited: isMain(q.user) }); }));
app.put('/api/me', auth, ok((q, r) => {
  const { bio, status_text, presence } = q.body || {};
  if (typeof bio === 'string') db.prepare('update users set bio=? where name=?').run(bio.slice(0, 200), q.user);
  if (typeof status_text === 'string') db.prepare('update users set status_text=? where name=?').run(status_text.slice(0, 60), q.user);
  if (['online', 'away', 'busy', 'offline'].includes(presence)) { db.prepare('update users set presence=? where name=?').run(presence, q.user); online(); userRooms(q.user).forEach(castRoster); }
  r.json(profile(q.user));
}));
db.exec('create table if not exists footprints(owner text, visitor text, ts int, primary key(owner,visitor))');
function userStats(n, p) {
  const c = (sql, ...a) => db.prepare(sql).get(...a).c || 0;
  const badges = (db.prepare('select verified from users where name=?').get(n)?.verified ? 1 : 0) + (p.role && p.role !== 'user' ? 1 : 0) + [10, 25, 50, 100, 200, 300, 500, 1000].filter(x => p.level >= x).length + (c('select count(*) c from posts where user=?', n) >= 1 ? 1 : 0);
  return { followers: c('select count(*) c from friends where b=?', n), following: c('select count(*) c from friends where a=?', n), footprints: c('select count(*) c from footprints where owner=?', n), badges,
    posts: c('select count(*) c from posts where user=?', n), giftsSent: c("select count(*) c from txs where user=? and kind='gift' and amount<0", n), giftsRecv: Math.max(c("select count(*) c from txs where user=? and kind='gift' and amount>0", n), c('select coalesce(sum(n),0) c from gift_inv where user=?', n)), games: c("select count(*) c from mevents where user=? and k='game'", n) };
}
app.get('/api/users/:n', auth, ok((q, r) => {
  const p = profile(q.params.n); if (!p) return bad(r, 'User not found', 404);
  delete p.coins;   // coin balances are private: profiles never show them
  if (p.name !== q.user) db.prepare('insert into footprints(owner,visitor,ts) values(?,?,?) on conflict(owner,visitor) do update set ts=excluded.ts').run(p.name, q.user, Date.now());
  const fc = db.prepare("select count(*) c from friends where status='accepted' and (a=? or b=?)").get(p.name, p.name).c;
  r.json({ ...p, gifts: db.prepare('select gift,n from gift_inv where user=? order by n desc').all(p.name).map(x => { const g = allGiftsAny(x.gift); return g && { key: x.gift, n: x.n, name: g.n, e: g.e, img: g.img }; }).filter(Boolean), friends: fc, stats: userStats(p.name, p), state: q.user === p.name ? 'me' : fstate(q.user, p.name) });
}));
app.post('/api/push/sub', auth, ok((q, r) => { if (!PUSH.save(q.user, q.body)) return bad(r, 'Bad subscription'); r.json({ ok: true }); }));
app.post('/api/push/test', auth, ok(async (q, r) => {
  const res = await PUSH.send(q.user, { title: 'Migv33', body: 'Call alerts work on this device ✔', tag: 'migv33-test' }, { ttl: 120, urgency: 'high' });
  r.json({ devices: res.length, ok: res.filter(x => x.ok).length, errors: res.filter(x => !x.ok).map(x => `${x.status || ''} ${x.err}`.trim()) });
}));
app.post('/api/push/unsub', auth, ok((q, r) => { PUSH.drop(q.user, q.body?.endpoint); r.json({ ok: true }); }));
app.post('/api/password', auth, ok((q, r) => {
  const { old = '', pass = '' } = q.body || {};
  const u = db.prepare('select pass from users where name=?').get(q.user);
  if (!bcrypt.compareSync(old, u.pass)) return bad(r, 'Current password is wrong', 403);
  if (pass.length < 6) return bad(r, 'New password must be at least 6 characters');
  db.prepare('update users set pass=? where name=?').run(bcrypt.hashSync(pass, 10), q.user); r.json({ ok: true });
}));

for (const a of ["alter table posts add column image text default ''", 'alter table posts add column pinned int default 0', 'alter table posts add column locked int default 0',
  'alter table posts add column edited int default 0', "alter table posts add column bg text default ''", "alter table reacts add column kind text default 'like'"]) { try { db.exec(a); } catch {} }
db.exec(`create table if not exists post_shares(post int, user text, ts int, primary key(post,user));
create table if not exists post_hidden(user text, post int, primary key(user,post));`);
db.exec(`create table if not exists stories(id integer primary key, user text, image text default '', text text default '', bg int default 0, ts int);
create table if not exists story_views(story int, user text, ts int, primary key(story,user));`);
const isMod = n => ['staff', 'admin'].includes(roleOf(n));
const REACTS = ['like', 'love', 'haha', 'wow', 'sad', 'angry', 'wink', 'cool', 'kiss', 'cry', 'shy', 'sleepy'];
const getPost = id => db.prepare('select * from posts where id=?').get(id);
const imgUrl = u => typeof u === 'string' && MEDIA_URL.test(u) && /\.(jpg|png|gif|webp)$/.test(u);
function dropFile(u) { if (u && MEDIA_URL.test(u) && !db.prepare('select 1 from posts where image=?').get(u) && !db.prepare('select 1 from stories where image=?').get(u) && !db.prepare('select 1 from users where avatar=? or avatar_art=?').get(u, u) && !db.prepare('select 1 from user_photos where url=?').get(u)) fs.unlink('.' + u, () => {}); }
app.get('/api/feed', auth, ok((q, r) => {
  const tag = String(q.query.tag || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 30);
  const rows = db.prepare(`select p.id,p.user,p.text,p.image,p.bg,p.pinned,p.locked,p.edited,p.ts, p.shares + (select count(*) from post_shares where post=p.id) shares,
    (select xp from users where name=p.user) xp, (select role from users where name=p.user) role,
    (select count(*) from reacts where post=p.id) reacts, (select kind from reacts where post=p.id and user=@me) mine,
    (select group_concat(kind) from (select kind from reacts where post=p.id group by kind order by count(*) desc limit 3)) rks,
    (select count(*) from comments where post=p.id) comments
    from posts p where p.id not in (select post from post_hidden where user=@me) ${tag ? "and (p.text like '%#'||@tag||'%')" : ''}
    order by p.pinned desc, p.id desc limit 40`).all(tag ? { me: q.user, tag } : { me: q.user });
  r.json(rows);
}));
app.get('/api/users-suggest', auth, ok((q, r) => {
  const s = String(q.query.q || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 16);
  r.json(db.prepare("select name, role from users where name like ? || '%' order by length(name) limit 6").all(s));
}));
// ---- Notifications: grp = social | rewards | mentions | system ----
db.exec('create table if not exists notifs(id integer primary key, user text, grp text, text text, ref text default \'\', ts int, read int default 0)');
db.exec('create index if not exists notifs_u on notifs(user,id)');
function notify(user, grp, text, ref = '') {
  try {
    if (!user) return;
    db.prepare('insert into notifs(user,grp,text,ref,ts) values(?,?,?,?,?)').run(user, grp, String(text).slice(0, 200), ref, Date.now());
    db.prepare('delete from notifs where user=? and id not in (select id from notifs where user=? order by id desc limit 300)').run(user, user);
    const n = db.prepare('select count(*) n from notifs where user=? and read=0').get(user).n;
    wss.clients.forEach(w => { if (w.user === user) send(w, { t: 'notif', unread: n, grp, text }); });
  } catch (e) { console.log('[notify]', e.message); }
}
const mentionsOf = (text, by) => [...new Set([...String(text || '').matchAll(/(^|\s)@([A-Za-z0-9_]{2,20})/g)].map(m => m[2]))].filter(n => n.toLowerCase() !== String(by).toLowerCase()).slice(0, 5);
function notifyMentions(text, by, where, ref = '') {
  for (const n of mentionsOf(text, by)) { const u = db.prepare('select name from users where lower(name)=lower(?)').get(n); if (u) notify(u.name, 'mentions', `${by} mentioned you ${where}`, ref); }
}
app.get('/api/notifs', auth, ok((q, r) => {
  const g = String(q.query?.group || 'all').toLowerCase();
  const rows = ['social', 'rewards', 'mentions', 'system'].includes(g)
    ? db.prepare('select id,grp,text,ref,ts,read from notifs where user=? and grp=? order by id desc limit 100').all(q.user, g)
    : db.prepare('select id,grp,text,ref,ts,read from notifs where user=? order by id desc limit 100').all(q.user);
  const cnt = {}; for (const x of db.prepare('select grp,count(*) n from notifs where user=? and read=0 group by grp').all(q.user)) cnt[x.grp] = x.n;
  r.json({ list: rows, unread: Object.values(cnt).reduce((a, b) => a + b, 0), counts: cnt });
}));
app.post('/api/notifs/read', auth, ok((q, r) => { db.prepare('update notifs set read=1 where user=?').run(q.user); r.json({ ok: true }); }));
app.get('/api/notifs/count', auth, ok((q, r) => r.json({ unread: db.prepare('select count(*) n from notifs where user=? and read=0').get(q.user).n })));
// ---- Help & Support, Feedback & Report: stored in the support mailbox list and e-mailed to support@ when mail is set up ----
const supLimit = new Map();
app.post('/api/support', auth, ok((q, r) => {
  const kind = ['help', 'feedback', 'report'].includes(q.body?.kind) ? q.body.kind : 'help';
  const subject = String(q.body?.subject || '').trim().slice(0, 120), msg = String(q.body?.message || '').trim().slice(0, 3000), target = String(q.body?.target || '').trim().slice(0, 40);
  if (msg.length < 5) return bad(r, 'Please write a little more.');
  const now = Date.now(), hist = (supLimit.get(q.user) || []).filter(t => now - t < 3600e3);
  if (hist.length >= 5) return bad(r, 'You have sent a few messages already. Please try again later.', 429);
  supLimit.set(q.user, [...hist, now]);
  const label = { help: 'Help', feedback: 'Feedback', report: 'Report' }[kind];
  const email = db.prepare('select email from users where name=?').get(q.user)?.email || '';
  const subj = `[${label}] ${subject || (kind === 'report' ? 'Report' + (target ? ' about ' + target : '') : 'From ' + q.user)}`;
  const body = `From: ${q.user}${email ? ' <' + email + '>' : ''}\n${target ? 'About user/room: ' + target + '\n' : ''}Type: ${label}\n\n${msg}`;
  db.prepare('insert into support_mail(dir,from_addr,to_addr,subject,body,ts,read) values(?,?,?,?,?,?,0)').run('in', `${q.user}${email ? ' <' + email + '>' : ' (in-app)'}`, SUP.user, subj, body, now);
  if (supMailer) supMailer.sendMail({ from: SUP.user, to: SUP.user, replyTo: email || undefined, subject: subj, text: body }).catch(e => console.log('[support mail]', e.message));
  r.json({ ok: true });
}));
app.post('/api/posts', auth, ok((q, r) => {
  const text = String(q.body?.text || '').trim().slice(0, 500), image = imgUrl(q.body?.image) ? q.body.image : '';
  if (!text && !image) return bad(r, 'Write something or add a photo first');
  const bg = !image && /^g([1-9]|[12]\d|3[0-8])(\.[0-9a-f]{6})?$/i.test(String(q.body?.bg || '')) ? q.body.bg : '';   // coloured text-post style
  const pid = db.prepare('insert into posts(user,text,image,bg,ts) values(?,?,?,?,?)').run(q.user, text, image, bg, Date.now()).lastInsertRowid;
  grantAct(q.user, 'post', pid); notifyMentions(text, q.user, 'in a post', 'post:' + pid); r.json({ ok: true });
}));
app.put('/api/posts/:id', auth, ok((q, r) => {
  const p = getPost(q.params.id); if (!p) return bad(r, 'Post not found', 404);
  if (p.user !== q.user) return bad(r, 'You can only edit your own posts', 403);
  const text = String(q.body?.text || '').trim().slice(0, 500);
  if (!text && !p.image) return bad(r, 'A post cannot be empty');
  db.prepare('update posts set text=?, edited=1 where id=?').run(text, p.id); r.json({ ok: true });
}));
app.delete('/api/posts/:id', auth, ok((q, r) => {
  const p = getPost(q.params.id); if (!p) return bad(r, 'Post not found', 404);
  if (p.user !== q.user && !isMod(q.user)) return bad(r, 'You cannot delete this post', 403);
  for (const t of ['reacts', 'comments', 'post_shares', 'post_hidden']) db.prepare(`delete from ${t} where post=?`).run(p.id);
  db.prepare('delete from posts where id=?').run(p.id); dropFile(p.image); r.json({ ok: true });
}));
app.post('/api/posts/:id/pin', auth, ok((q, r) => {
  if (!isMod(q.user)) return bad(r, 'Only staff and admins can pin posts', 403);
  const p = getPost(q.params.id); if (!p) return bad(r, 'Post not found', 404);
  if (!p.pinned && db.prepare('select count(*) c from posts where pinned=1').get().c >= 3) return bad(r, 'Up to 3 posts can be pinned. Unpin one first.');
  db.prepare('update posts set pinned=? where id=?').run(p.pinned ? 0 : 1, p.id); r.json({ pinned: !p.pinned });
}));
app.post('/api/posts/:id/lock', auth, ok((q, r) => {
  const p = getPost(q.params.id); if (!p) return bad(r, 'Post not found', 404);
  if (p.user !== q.user && !isMod(q.user)) return bad(r, 'Only the author or staff can lock comments', 403);
  db.prepare('update posts set locked=? where id=?').run(p.locked ? 0 : 1, p.id); r.json({ locked: !p.locked });
}));
app.post('/api/posts/:id/hide', auth, ok((q, r) => {
  if (!getPost(q.params.id)) return bad(r, 'Post not found', 404);
  if (q.body?.undo) db.prepare('delete from post_hidden where user=? and post=?').run(q.user, q.params.id);
  else db.prepare('insert or ignore into post_hidden values(?,?)').run(q.user, q.params.id);
  r.json({ ok: true });
}));
app.post('/api/posts/:id/react', auth, ok((q, r) => {
  const gp = getPost(q.params.id); if (!gp) return bad(r, 'Post not found', 404);
  const kind = reactKind(q.body?.kind);
  const cur = db.prepare('select kind from reacts where post=? and user=?').get(q.params.id, q.user);
  if (cur && cur.kind === kind) db.prepare('delete from reacts where post=? and user=?').run(q.params.id, q.user);
  else { db.prepare('insert or replace into reacts(post,user,kind) values(?,?,?)').run(q.params.id, q.user, kind); if (gp.user !== q.user) { grantAct(q.user, 'react', gp.id); notify(gp.user, 'social', `${q.user} reacted to your post`, 'post:' + gp.id); } }
  r.json({ ok: true });
}));
app.get('/api/posts/:id/who', auth, ok((q, r) => {
  const id = q.params.id, t = q.query.type;
  const role = 'select role from users where name=x.user';
  if (t === 'react') return r.json(db.prepare(`select user, kind, (${role}) role from reacts x where post=? order by rowid desc limit 200`).all(id));
  if (t === 'comment') return r.json(db.prepare(`select user, text, ts, (${role}) role from comments x where post=? order by id desc limit 200`).all(id));
  if (t === 'share') return r.json(db.prepare(`select user, ts, (${role}) role from post_shares x where post=? order by ts desc limit 200`).all(id));
  bad(r, 'Unknown list');
}));
app.get('/api/posts/:id/comments', auth, ok((q, r) => r.json(db.prepare('select user,text,ts,(select role from users where name=comments.user) role from comments where post=? order by id limit 100').all(q.params.id))));
app.post('/api/posts/:id/comments', auth, ok((q, r) => {
  const p = getPost(q.params.id); if (!p) return bad(r, 'Post not found', 404);
  if (p.locked && p.user !== q.user && !isMod(q.user)) return bad(r, 'Comments are locked on this post.', 403);
  const text = String(q.body?.text || '').trim().slice(0, 300); if (!text) return bad(r, 'Write a comment first');
  db.prepare('insert into comments(post,user,text,ts) values(?,?,?,?)').run(q.params.id, q.user, text, Date.now()); if (p.user !== q.user) { grantAct(q.user, 'comment', p.id); notify(p.user, 'social', `${q.user} commented on your post`, 'post:' + p.id); } notifyMentions(text, q.user, 'in a comment', 'post:' + p.id); r.json({ ok: true });
}));
app.post('/api/posts/:id/share', auth, ok((q, r) => {
  const gp = getPost(q.params.id); if (!gp) return bad(r, 'Post not found', 404);
  const ch = db.prepare('insert or ignore into post_shares values(?,?,?)').run(q.params.id, q.user, Date.now()).changes; if (ch && gp.user !== q.user) { grantAct(q.user, 'share', gp.id); notify(gp.user, 'social', `${q.user} shared your post`, 'post:' + gp.id); } r.json({ ok: true });
}));

// ---------- Stories (disappear after 24 hours) ----------
const STORY_MS = 24 * 3600e3;
function purgeStories() {
  const old = db.prepare('select id,image from stories where ts<?').all(Date.now() - STORY_MS);
  for (const s of old) { db.prepare('delete from story_views where story=?').run(s.id); db.prepare('delete from stories where id=?').run(s.id); dropFile(s.image); }
}
app.get('/api/stories', auth, ok((q, r) => {
  purgeStories();
  const rows = db.prepare(`select s.id,s.user,s.image,s.text,s.bg,s.ts,
    (select xp from users where name=s.user) xp, (select role from users where name=s.user) role,
    (select count(*) from story_views where story=s.id and user=@me) seen,
    (select count(*) from story_views where story=s.id) views
    from stories s where s.user not in (select case when a=@me then b else a end from blocks where a=@me or b=@me) order by s.id`).all({ me: q.user });
  const g = new Map();
  for (const s of rows) {
    if (!g.has(s.user)) g.set(s.user, { user: s.user, role: s.role, xp: s.xp, items: [] });
    g.get(s.user).items.push({ id: s.id, image: s.image, text: s.text, bg: s.bg, ts: s.ts, seen: !!s.seen, views: s.user === q.user ? s.views : undefined });
  }
  const list = [...g.values()].map(x => ({ ...x, unseen: x.items.some(i => !i.seen), last: x.items[x.items.length - 1].ts }));
  list.sort((a, b) => (a.user === q.user ? -1 : b.user === q.user ? 1 : (b.unseen - a.unseen) || (b.last - a.last)));
  r.json(list);
}));
app.post('/api/stories', auth, ok((q, r) => {
  const text = String(q.body?.text || '').trim().slice(0, 200), image = imgUrl(q.body?.image) ? q.body.image : '';
  const bg = Math.max(0, Math.min(5, parseInt(q.body?.bg, 10) || 0));
  if (!text && !image) return bad(r, 'Add a photo or some text first');
  if (db.prepare('select count(*) c from stories where user=? and ts>?').get(q.user, Date.now() - STORY_MS).c >= 15) return bad(r, 'You can have up to 15 stories at a time.');
  db.prepare('insert into stories(user,image,text,bg,ts) values(?,?,?,?,?)').run(q.user, image, text, bg, Date.now());
  addXp(q.user, 2); r.json({ ok: true });
}));
app.post('/api/stories/:id/view', auth, ok((q, r) => {
  const s = db.prepare('select user from stories where id=?').get(q.params.id);
  if (s && s.user !== q.user) db.prepare('insert or ignore into story_views values(?,?,?)').run(q.params.id, q.user, Date.now());
  r.json({ ok: true });
}));
app.get('/api/stories/:id/viewers', auth, ok((q, r) => {
  const s = db.prepare('select user from stories where id=?').get(q.params.id);
  if (!s) return bad(r, 'Story not found', 404);
  if (s.user !== q.user && !isMod(q.user)) return bad(r, 'Only the author can see viewers', 403);
  r.json(db.prepare('select user, ts, (select role from users where name=v.user) role from story_views v where story=? order by ts desc limit 200').all(q.params.id));
}));
app.delete('/api/stories/:id', auth, ok((q, r) => {
  const s = db.prepare('select * from stories where id=?').get(q.params.id);
  if (!s) return bad(r, 'Story not found', 404);
  if (s.user !== q.user && !isMod(q.user)) return bad(r, 'You cannot delete this story', 403);
  db.prepare('delete from story_views where story=?').run(s.id); db.prepare('delete from stories where id=?').run(s.id); dropFile(s.image); r.json({ ok: true });
}));

app.get('/api/headline', auth, ok((q, r) => {
  const now = Date.now();
  const rooms = db.prepare('select name from rooms').all();
  const chatting = rooms.reduce((n, x) => n + roomNames(x.name).size, 0);
  const seen = new Set(); wss.clients.forEach(w => { if (w.user) seen.add(w.user); });
  let onlineN = 0; for (const u of seen) if (livePres(u, db.prepare('select presence from users where name=?').get(u)?.presence) !== 'offline') onlineN++;
  const live = db.prepare("select name,ends from contests where status='approved' and settled=0 and starts<=? and ends>? order by ends limit 4").all(now, now);
  const upcoming = db.prepare("select name,starts from contests where status='approved' and settled=0 and starts>? order by starts limit 4").all(now);
  const top = db.prepare("select name,xp from users where banned=0 and role not in ('staff','admin') order by xp desc, name limit 3").all().map(u => ({ name: u.name, level: level(u.xp) }));
  r.json({ rooms: rooms.length, chatting, online: onlineN, live, upcoming, top, now, ...headlineCfg() });
}));
const HL_DEF = { show: { rooms: true, online: true, live: true, upcoming: true, top: true }, custom: [], colors: {}, ccolors: [] };
const HEX = x => /^#[0-9a-f]{6}$/i.test(String(x || '')) ? String(x).toLowerCase() : '';
function headlineCfg() {
  try { const c = JSON.parse(db.prepare("select v from kv where k='headline_cfg'").get()?.v || 'null'); if (c) return { show: { ...HL_DEF.show, ...(c.show || {}) }, custom: Array.isArray(c.custom) ? c.custom : [], colors: c.colors && typeof c.colors === 'object' ? c.colors : {}, ccolors: Array.isArray(c.ccolors) ? c.ccolors : [] }; } catch {}
  return HL_DEF;
}
app.get('/api/admin/headline', auth, ok((q, r) => { if (roleOf(q.user) !== 'staff') return bad(r, 'Only staff can do this', 403); r.json(headlineCfg()); }));
app.post('/api/admin/headline', auth, ok((q, r) => {
  if (roleOf(q.user) !== 'staff') return bad(r, 'Only staff can do this', 403);
  const b = q.body || {}, show = {};
  for (const k of Object.keys(HL_DEF.show)) show[k] = b.show?.[k] !== false;
  const raw = (Array.isArray(b.custom) ? b.custom : []).map((x, i) => [String(x || '').trim().slice(0, 200), HEX((b.ccolors || [])[i])]).filter(x => x[0]).slice(0, 10);
  const custom = raw.map(x => x[0]), ccolors = raw.map(x => x[1]), colors = {};
  for (const k of Object.keys(HL_DEF.show)) { const h = HEX(b.colors?.[k]); if (h) colors[k] = h; }
  db.prepare("insert or replace into kv(k,v) values('headline_cfg',?)").run(JSON.stringify({ show, custom, colors, ccolors }));
  alog(q.user, '-', 'headline', `${custom.length} custom`); r.json({ ok: true });
}));
app.get('/api/rooms', auth, ok((q, r) => {
  const fav = new Set(db.prepare('select room from favs where user=?').all(q.user).map(x => x.room));
  const own = new Map(), isStaffOwner = o => { if (!o) return false; if (!own.has(o)) own.set(o, ['staff', 'admin'].includes(roleOf(o))); return own.get(o); };
  r.json(db.prepare('select name,cat,cap,owner,flag from rooms').all().map(x => {
    const cat = (gameOf(x.name) || x.cat === 'game') ? 'game' : (x.cat === 'official' || isStaffOwner(x.owner)) ? 'official' : 'user';
    return { name: x.name, cat, cap: x.cap, owner: x.owner, flag: x.flag || '', count: roomNames(x.name).size, fav: fav.has(x.name), lvl: roomLevel(roomXpOf(x.name)), xp: Math.floor(roomXpOf(x.name)) };
  }).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)));
}));
app.post('/api/rooms', auth, ok((q, r) => {
  if (lvGate(q.user)) return bad(r, `Creating a room unlocks at Level ${MIN_LV_XFER}.`, 403);
  const name = String(q.body?.name || '').trim().replace(/\s+/g, ' ');
  if (!/^[A-Za-z0-9 ]{5,20}$/.test(name)) return bad(r, 'Room name: 5–20 characters, English letters, numbers and spaces only');
  if (db.prepare('select 1 from rooms where lower(name)=lower(?)').get(name)) return bad(r, 'That room already exists', 409);
  const descr = String(q.body?.descr || '').trim().slice(0, 200), minlv = Math.max(0, Math.min(MAXLV, parseInt(q.body?.minlv, 10) || 0));
  let flag = '';
  const fd = String(q.body?.flag || '');
  if (fd) {   // flag picture: the page shrinks it to 64x44; stored as a small PNG
    const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(fd);
    if (!m || fd.length > 150000) return bad(r, 'Flag picture is not valid or too large.');
    const buf = Buffer.from(m[2], 'base64'), t = sniff(buf);
    if (!t || t[0] !== 'image' || buf.length > 100000) return bad(r, 'Flag picture is not valid or too large.');
    const fn = crypto.randomBytes(16).toString('hex') + '.' + t[1]; fs.writeFileSync('uploads/' + fn, buf); flag = '/uploads/' + fn;
  }
  db.prepare('insert into rooms(name,cat,owner,descr,minlv,flag) values(?,?,?,?,?,?)').run(name, 'user', q.user, descr, minlv, flag); r.json({ ok: true });
}));
app.post('/api/rooms/:n/fav', auth, ok((q, r) => {
  const d = db.prepare('delete from favs where user=? and room=?').run(q.user, q.params.n);
  if (!d.changes) db.prepare('insert or ignore into favs values(?,?)').run(q.user, q.params.n); r.json({ ok: true });
}));

app.get('/api/friends', auth, ok((q, r) => {
  const rows = db.prepare('select * from friends where a=? or b=?').all(q.user, q.user);
  const other = x => (x.a === q.user ? x.b : x.a);
  const info = n => withPres({ name: n, ...db.prepare('select presence,xp,status_text,role from users where name=?').get(n) });
  const seen = new Set([q.user, ...rows.map(other)]);
  r.json({
    friends: rows.filter(x => x.status === 'accepted').map(x => info(other(x))),
    requests: rows.filter(x => x.status === 'pending' && x.b === q.user).map(x => info(x.a)),
    discover: db.prepare('select name from users order by random() limit 30').all().filter(u => !seen.has(u.name)).slice(0, 10).map(u => info(u.name)),
  });
}));
app.post('/api/friends/:act', auth, ok((q, r) => {
  const n = String(q.body?.name || ''), act = q.params.act;
  if (!n || n === q.user || !profile(n)) return bad(r, 'User not found', 404);
  const st = fstate(q.user, n);
  if (act === 'request' && st === 'none') { db.prepare("insert into friends values(?,?,'pending')").run(q.user, n); notify(n, 'social', `${q.user} followed you`, 'user:' + q.user); if (db.prepare('select verified from users where name=?').get(n)?.verified) grantAct(q.user, 'follow', n); }
  else if (act === 'accept' && st === 'incoming') { db.prepare("update friends set status='accepted' where a=? and b=?").run(n, q.user); notify(n, 'social', `${q.user} accepted your request — you are friends now`, 'user:' + q.user); }
  else if (act === 'remove') db.prepare('delete from friends where (a=? and b=?) or (a=? and b=?)').run(q.user, n, n, q.user);
  r.json({ ok: true });
}));

app.get('/api/account', auth, ok((q, r) => {
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const t = db.prepare('select coalesce(sum(case when amount>0 then amount end),0) e, coalesce(-sum(case when amount<0 then amount end),0) s from txs where user=? and kind!=\'gs\' and ts>=?').get(q.user, day.getTime());
  r.json({ coins: profile(q.user).coins, earned: t.e, spent: t.s, activity: db.prepare("select kind,title,amount,ts from txs where user=? and kind!='gs' order by id desc limit 50").all(q.user) });
}));
const pinFails = new Map();
function checkPin(name, pin) { // true = ok (or no PIN set), false = wrong, 'locked' = too many tries
  const row = db.prepare('select mpin from users where name=?').get(name); if (!row?.mpin) return true;
  const f = pinFails.get(name) || { n: 0, t: 0 }, now = Date.now(); if (now - f.t > 600e3) { f.n = 0; }
  if (f.n >= 5) return 'locked';
  if (bcrypt.compareSync(String(pin || ''), row.mpin)) { pinFails.delete(name); return true; }
  pinFails.set(name, { n: f.n + 1, t: now }); return false;
}
const MIN_LV_XFER = 20;
const lvGate = u => !['staff', 'admin'].includes(roleOf(u)) && level(db.prepare('select xp from users where name=?').get(u)?.xp || 0) < MIN_LV_XFER;
app.post('/api/transfer', auth, ok((q, r) => {
  if (lvGate(q.user)) return bad(r, `Coin transfer unlocks at Level ${MIN_LV_XFER}.`, 403);
  const to = String(q.body?.to || ''), amt = Math.floor(+q.body?.amount), note = String(q.body?.remarks || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!to || to === q.user || !profile(to)) return bad(r, 'Recipient not found');
  if (!(amt >= 1)) return bad(r, 'Enter an amount of at least 1');
  const pc = checkPin(q.user, q.body?.mpin);
  if (pc === 'locked') return bad(r, 'Too many wrong MPIN attempts. Try again in 10 minutes.', 429);
  if (!pc) return bad(r, 'Wrong or missing MPIN', 403);
  const go = db.transaction(() => {
    if (!db.prepare('update users set coins=coins-? where name=? and coins>=?').run(amt, q.user, amt).changes) throw new Error('funds');
    db.prepare('update users set coins=coins+? where name=?').run(amt, to);
    addTx(q.user, 'transfer', `Sent to ${to}${note ? ' — ' + note : ''}`, -amt); addTx(to, 'transfer', `Received from ${q.user}${note ? ' — ' + note : ''}`, amt);
  });
  try { go(); } catch { return bad(r, 'Not enough coins'); }
  wss.clients.forEach(w => (w.user === q.user || w.user === to) && send(w, { t: 'coins', coins: coins(w.user) }));
  r.json({ coins: coins(q.user) });
}));
app.get('/api/members', auth, ok((q, r) => r.json(db.prepare("select name,role,xp from users where role in ('admin','staff','headmentor','mentor','merchant') order by case role when 'admin' then 0 when 'staff' then 1 when 'headmentor' then 2 when 'mentor' then 3 else 4 end, name").all())));
app.post('/api/admin/role', auth, ok((q, r) => {
  if (roleOf(q.user) !== 'staff') return bad(r, 'Only staff can change roles', 403);
  const { name = '', role = '' } = q.body || {};
  if (!ROLE_LIST.includes(role)) return bad(r, 'Invalid role');
  if (name === q.user) return bad(r, "You can't change your own role", 403);
  if (!profile(name)) return bad(r, 'User not found', 404);
  setRole(name, role, q.user, 'Staff change'); online(); r.json({ ok: true });
}));
app.get('/api/vips', auth, ok((q, r) => r.json(db.prepare('select name from users where vip=1').all().map(u => u.name))));
app.get('/api/verified', auth, ok((q, r) => r.json(db.prepare('select name from users where verified=1').all().map(u => u.name))));
app.post('/api/admin/verify', auth, ok((q, r) => {
  if (roleOf(q.user) !== 'staff') return bad(r, 'Only staff can verify accounts', 403);
  const { name = '', on } = q.body || {};
  if (!profile(name)) return bad(r, 'User not found', 404);
  db.prepare('update users set verified=? where name=?').run(on ? 1 : 0, name); r.json({ ok: true });
}));


// ---------- Merchant / Mentor / Head Mentor hierarchy ----------
for (const a of ["alter table users add column parent text default ''", 'alter table users add column role_started_at int default 0', 'alter table users add column cycle_start int default 0']) { try { db.exec(a); } catch {} }
db.exec(`create table if not exists role_requests(id integer primary key, from_user text, to_user text, kind text, status text default 'pending', ts int, decided_ts int, decided_by text);
create unique index if not exists one_pending on role_requests(from_user) where status='pending';
create table if not exists tags(user text primary key, parent text, tagged_at int, tx_id int);
create table if not exists commissions(id integer primary key, spender text, parent text, eligible int, pct real, amount int, tx_id int, kind text, ts int, unique(tx_id,kind));
create index if not exists comm_p on commissions(parent,ts);
create table if not exists mevents(id integer primary key, user text, k text, n int default 1, ts int);
create index if not exists mev on mevents(user,k,ts);
create table if not exists payouts(id integer primary key, user text, cycle_start int, cycle_end int, points int, tier text, eligible int, trail int, result text, ts int);
create table if not exists role_history(id integer primary key, user text, from_role text, to_role text, reason text, by text, ts int)`);
const ROLE_LIST = ['user', 'merchant', 'mentor', 'headmentor', 'admin', 'staff'];
const RANK = { user: 0, merchant: 1, mentor: 2, headmentor: 3 };
const TAG_COST = 50000, COMM_PCT = 5, CYCLE_MS = 30 * 864e5, MIN_PTS = 300, TRAIL_STEP = 100000, TRAIL_PTS = 20;
// A tag lasts 30 days, then the user is untagged and can be tagged again (by anyone).
const TAG_DAYS = 30;
try { db.exec('alter table tags add column exp int default 0'); } catch {}
db.prepare('update tags set exp=? where coalesce(exp,0)=0').run(Date.now() + TAG_DAYS * 864e5);   // tags made before expiry existed get 30 days from now
const purgeTags = () => db.prepare('delete from tags where exp>0 and exp<=?').run(Date.now());
setInterval(purgeTags, 60 * 60 * 1000);
const TIERS = [['red', 1000], ['pink', 500], ['purple', 300]];
const tierOf = p => (TIERS.find(t => p >= t[1]) || [null])[0];
const TASKS = [
  { k: 'gift_sent', t: 'Send gifts in chatrooms', target: 100000, pts: 100, unit: 'gifts' },
  { k: 'gift_recv', t: 'Receive gifts in chatrooms', target: 50000, pts: 100, unit: 'gifts' },
  { k: 'game', t: 'Play games in chatrooms', target: 1000, pts: 100, unit: 'games' },
  { k: 'dm_gift', t: 'Send migmeet gifts', target: 5, pts: 200, unit: 'gifts' }];
const mev = (user, k, n = 1) => { const x = db.prepare('insert into mevents(user,k,n,ts) values(?,?,?,?)').run(user, k, n, Date.now()); if (k === 'game') { try { grantAct(user, 'game', Date.now() + '.' + Math.random()); } catch {} } return x; };
if (!db.prepare("select 1 from kv where k='migmeet_task_v1'").get()) {   // rebuild the migmeet-gift counts from the coin history
  try {
    db.transaction(() => {
      db.prepare("delete from mevents where k='dm_gift'").run();
      const rows = db.prepare("select user,ts from txs where kind='gift' and amount<0 and lower(title) like 'sent migmeet to %'").all();
      const ins = db.prepare("insert into mevents(user,k,n,ts) values(?,?,?,?)");
      for (const x of rows) ins.run(x.user, 'dm_gift', 1, x.ts);
    })();
  } catch (e) { console.log('[migmeet backfill]', e.message); }
  db.prepare("insert into kv values('migmeet_task_v1','1')").run();
}
function setRole(name, role, by, reason) {
  const u = db.prepare('select role from users where name=?').get(name); if (!u || u.role === role) return;
  const now = Date.now();
  db.prepare('update users set role=?, role_started_at=?, cycle_start=? where name=?').run(role, now, role === 'merchant' ? now : 0, name);
  db.prepare('insert into role_history(user,from_role,to_role,reason,by,ts) values(?,?,?,?,?,?)').run(name, u.role, role, reason || '', by || 'system', now);
  setImmediate(() => notify(name, 'system', `Your role is now ${role}`));
  // A tagger who loses merchant/mentor/head-mentor status loses all tag relationships.
  if (RANK[u.role] >= 1 && !(RANK[role] >= 1)) db.prepare('delete from tags where parent=?').run(name);
}
function pointsOf(name, start, end) {
  const cnt = k => db.prepare('select coalesce(sum(n),0) c from mevents where user=? and k=? and ts>=? and ts<?').get(name, k, start, end).c;
  const tasks = TASKS.map(t => { const v = cnt(t.k); return { ...t, value: Math.min(v, t.target), done: v >= t.target, earned: v >= t.target ? t.pts : 0 }; });
  const el = cnt('trail_eligible'), tp = Math.floor(el / TRAIL_STEP) * TRAIL_PTS;
  return { tasks, trail: { eligible: el, step: TRAIL_STEP, pts: TRAIL_PTS, earned: tp, into: el % TRAIL_STEP }, points: tasks.reduce((s, t) => s + t.earned, 0) + tp };
}
// 5% of eligible spending (gifts, game bets) goes to the direct tagger. One commission per transaction (unique tx_id+kind).
function commissionOn(spender, amount, kind, txId) {
  purgeTags(); const t = db.prepare('select parent from tags where user=?').get(spender); if (!t) return;
  const p = db.prepare('select name,role from users where name=?').get(t.parent);
  if (!p || p.name === spender || !(RANK[p.role] >= 1)) return;
  const c = Math.floor(amount * COMM_PCT / 100); if (c < 1) return;
  if (db.prepare('select 1 from commissions where tx_id=? and kind=?').get(txId, kind)) return;
  db.prepare('update users set coins=coins+? where name=?').run(c, p.name);
  addTx(p.name, 'other', `Trail commission from ${spender}`, c);
  db.prepare('insert into commissions(spender,parent,eligible,pct,amount,tx_id,kind,ts) values(?,?,?,?,?,?,?,?)').run(spender, p.name, amount, COMM_PCT, c, txId, kind, Date.now());
  mev(p.name, 'trail_eligible', amount); setImmediate(() => pushCoins(p.name));
}
let demoted = false;
function processCycles() {
  const now = Date.now();
  db.prepare("update users set cycle_start=? where role='merchant' and cycle_start=0").run(now);
  for (const m of db.prepare("select name,cycle_start from users where role='merchant' and cycle_start>0 and cycle_start+?<=?").all(CYCLE_MS, now)) {
    db.transaction(() => {
      let start = m.cycle_start;
      while (start + CYCLE_MS <= now) {
        const end = start + CYCLE_MS, pp = pointsOf(m.name, start, end), keep = pp.points >= MIN_PTS;
        const trail = db.prepare('select coalesce(sum(amount),0) s from commissions where parent=? and ts>=? and ts<?').get(m.name, start, end).s;
        db.prepare('insert into payouts(user,cycle_start,cycle_end,points,tier,eligible,trail,result,ts) values(?,?,?,?,?,?,?,?,?)').run(m.name, start, end, pp.points, tierOf(pp.points) || 'none', pp.trail.eligible, trail, keep ? 'kept' : 'demoted', now);
        if (!keep) { setRole(m.name, 'user', 'system', `Under ${MIN_PTS} points (${pp.points}) at cycle end`); demoted = true; return; }
        start = end; db.prepare('update users set cycle_start=? where name=?').run(start, m.name);
      }
    })();
  }
  if (demoted) { demoted = false; try { online(); } catch {} }
}
setTimeout(processCycles, 5000); setInterval(processCycles, 3600e3).unref();
const headOf = name => { let n = db.prepare('select parent from users where name=?').get(name)?.parent; for (let i = 0; n && i < 4; i++) { const x = db.prepare('select role,parent from users where name=?').get(n); if (!x) return null; if (x.role === 'headmentor') return n; n = x.parent; } return null; };
const lvOf = n => level(db.prepare('select xp from users where name=?').get(n)?.xp || 0);

app.get('/api/panel', auth, ok((q, r) => {
  processCycles();
  const me = q.user, u = db.prepare('select role,parent,cycle_start,role_started_at,mpin from users where name=?').get(me), now = Date.now();
  purgeTags();
  const out = { role: u.role, parent: u.parent, hasPin: !!u.mpin, now, tagCost: TAG_COST, pct: COMM_PCT, minPoints: MIN_PTS, roleStarted: u.role_started_at };
  out.outgoing = db.prepare('select id,to_user,kind,status,ts from role_requests where from_user=? order by id desc limit 1').get(me) || null;
  out.incoming = db.prepare("select id,from_user,kind,ts from role_requests where to_user=? and status='pending' order by id").all(me).map(x => ({ ...x, level: lvOf(x.from_user) }));
  if (u.role === 'user') out.mentors = db.prepare("select name,role,xp from users where role in ('mentor','headmentor') and banned=0 order by name limit 200").all().map(x => ({ name: x.name, role: x.role, level: level(x.xp) }));
  if (u.role === 'merchant') out.heads = db.prepare("select name,xp from users where role='headmentor' and banned=0 order by name limit 200").all().map(x => ({ name: x.name, level: level(x.xp) }));
  if (u.role === 'merchant') {
    const start = u.cycle_start || now, end = start + CYCLE_MS, pp = pointsOf(me, start, end), tier = tierOf(pp.points);
    const nxt = [...TIERS].reverse().find(t => pp.points < t[1]);
    out.head = headOf(me);
    out.cycle = { start, end, remaining: Math.max(0, end - now), days: 30 };
    out.points = pp.points; out.tier = tier; out.nextTier = nxt ? { name: nxt[0], need: nxt[1] - pp.points } : null;
    out.tasks = pp.tasks; out.trailTask = pp.trail;
    out.warning = pp.points < MIN_PTS ? { need: MIN_PTS - pp.points } : null;
  }
  if (RANK[u.role] >= 1) {
    const cs = u.role === 'merchant' ? u.cycle_start : now - CYCLE_MS, ce = u.role === 'merchant' ? u.cycle_start + CYCLE_MS : now + 1;
    const sum = (sql, ...a) => db.prepare(sql).get(...a);
    out.stats = {
      trailCycle: sum('select coalesce(sum(amount),0) s from commissions where parent=? and ts>=? and ts<?', me, cs, ce).s,
      trailAll: sum('select coalesce(sum(amount),0) s from commissions where parent=?', me).s,
      payoutsCycle: sum('select count(*) c from commissions where parent=? and ts>=? and ts<?', me, cs, ce).c,
      activeTags: sum('select count(*) c from tags where parent=?', me).c };
    out.tagged = db.prepare('select t.user name,t.tagged_at ts,t.exp,u.xp,u.banned from tags t join users u on u.name=t.user where t.parent=? order by t.tagged_at desc limit 200').all(me).map(x => ({ name: x.name, ts: x.ts, exp: x.exp, level: level(x.xp) }));
    out.byUser = db.prepare('select spender name,sum(eligible) eligible,sum(amount) amount,count(*) n,max(ts) last from commissions where parent=? group by spender order by amount desc limit 100').all(me);
    out.payouts = db.prepare('select cycle_start,cycle_end,points,tier,eligible,trail,result from payouts where user=? order by id desc limit 20').all(me);
    out.recent = db.prepare('select spender,eligible,pct,amount,tx_id,kind,ts from commissions where parent=? order by id desc limit 30').all(me);
  }
  if (u.role === 'mentor' || u.role === 'headmentor') {
    out.children = db.prepare("select name,role,xp,cycle_start from users where parent=? order by role,name limit 200").all(me).map(x => {
      const o = { name: x.name, role: x.role, level: level(x.xp) };
      if (x.role === 'merchant') { const pp = pointsOf(x.name, x.cycle_start || now, (x.cycle_start || now) + CYCLE_MS); o.points = pp.points; o.tier = tierOf(pp.points); o.left = Math.max(0, (x.cycle_start || now) + CYCLE_MS - now); }
      return o; });
  }
  r.json(out);
}));
app.post('/api/role/request', auth, ok((q, r) => {
  const me = q.user, role = roleOf(me);
  if (db.prepare("select 1 from role_requests where from_user=? and status='pending'").get(me)) return bad(r, 'You already have a pending request.');
  let kind, to;
  if (role === 'user') { kind = 'merchant'; to = String(q.body?.to || ''); const t = db.prepare('select role,banned from users where name=?').get(to); if (!t || !['mentor', 'headmentor'].includes(t.role) || t.banned || to === me) return bad(r, 'Choose a valid Mentor.'); }
  else if (role === 'merchant') { kind = 'mentor'; to = String(q.body?.to || '') || headOf(me); const t = db.prepare('select role,banned from users where name=?').get(to); if (!to || !t || t.role !== 'headmentor' || t.banned) return bad(r, 'Choose a Head Mentor.'); }
  else if (role === 'mentor') { kind = 'head'; to = 'system'; }
  else return bad(r, 'Your role cannot send a request.');
  try { db.prepare('insert into role_requests(from_user,to_user,kind,status,ts) values(?,?,?,?,?)').run(me, to, kind, 'pending', Date.now()); } catch { return bad(r, 'You already have a pending request.'); }
  r.json({ ok: true });
}));
app.post('/api/role/cancel', auth, ok((q, r) => { db.prepare("delete from role_requests where id=? and from_user=? and status='pending'").run(+q.body?.id, q.user); r.json({ ok: true }); }));
app.post('/api/role/respond', auth, ok((q, r) => {
  const me = q.user, myRole = roleOf(me), accept = !!q.body?.accept;
  const rq = db.prepare("select * from role_requests where id=? and status='pending'").get(+q.body?.id);
  if (!rq) return bad(r, 'Request not found or already handled.', 404);
  const allowed = rq.kind === 'merchant' ? rq.to_user === me && ['mentor', 'headmentor'].includes(myRole)
    : rq.kind === 'mentor' ? rq.to_user === me && myRole === 'headmentor' : ['staff', 'admin'].includes(myRole);
  if (!allowed) return bad(r, 'You cannot answer this request.', 403);
  const need = { merchant: 'user', mentor: 'merchant', head: 'mentor' }[rq.kind], next = { merchant: 'merchant', mentor: 'mentor', head: 'headmentor' }[rq.kind];
  db.transaction(() => {
    const cur = roleOf(rq.from_user), valid = cur === need;
    const st = accept && valid ? 'accepted' : 'rejected';
    db.prepare('update role_requests set status=?, decided_ts=?, decided_by=? where id=?').run(st, Date.now(), me, rq.id);
    if (st === 'accepted') {
      setRole(rq.from_user, next, me, `Accepted ${rq.kind} request`);
      if (rq.kind !== 'head') db.prepare('update users set parent=? where name=?').run(me, rq.from_user); else db.prepare("update users set parent='' where name=?").run(rq.from_user);
    }
  })();
  online(); r.json({ ok: true });
}));
app.get('/api/admin/requests', auth, ok((q, r) => {
  if (!['staff', 'admin'].includes(roleOf(q.user))) return bad(r, 'Not allowed', 403);
  r.json(db.prepare("select id,from_user,kind,ts from role_requests where status='pending' and kind='head' order by id").all().map(x => ({ ...x, level: lvOf(x.from_user) })));
}));
// ---------- Delete account: the user asks, staff accepts, the account is removed ----------
db.exec('create table if not exists del_requests(id integer primary key, user text, status text default \'pending\', ts int, decided_by text, decided_ts int)');
app.get('/api/account/delete-request', auth, ok((q, r) => r.json({ pending: !!db.prepare("select 1 from del_requests where user=? and status='pending'").get(q.user) })));
app.post('/api/account/delete-request', auth, ok((q, r) => {
  const u = db.prepare('select pass from users where name=?').get(q.user);
  if (isMain(q.user)) return bad(r, 'The main staff account cannot be deleted.', 403);
  if (!bcrypt.compareSync(String(q.body?.pass || ''), u.pass)) return bad(r, 'Wrong password', 403);
  if (db.prepare("select 1 from del_requests where user=? and status='pending'").get(q.user)) return bad(r, 'You already have a pending request.', 409);
  db.prepare('insert into del_requests(user,ts) values(?,?)').run(q.user, Date.now());
  for (const s of db.prepare("select name from users where role='staff'").all()) notify(s.name, 'system', `${q.user} asked to delete their account`, 'delreq');
  r.json({ ok: true });
}));
app.delete('/api/account/delete-request', auth, ok((q, r) => { db.prepare("update del_requests set status='cancelled',decided_ts=? where user=? and status='pending'").run(Date.now(), q.user); r.json({ ok: true }); }));
app.get('/api/admin/delete-requests', auth, ok((q, r) => {
  if (roleOf(q.user) !== 'staff') return bad(r, 'Only staff can do this', 403);
  r.json(db.prepare("select id,user,ts from del_requests where status='pending' order by id").all().map(x => ({ ...x, level: lvOf(x.user) })));
}));
function wipeUser(name) {
  const T = [['favs', 'user'], ['blocks', 'a'], ['blocks', 'b'], ['call_log', 'a'], ['call_log', 'b'], ['friends', 'a'], ['friends', 'b'], ['txs', 'user'], ['gift_inv', 'user'], ['footprints', 'owner'], ['footprints', 'visitor'], ['notifs', 'user'],
    ['user_photos', 'user'], ['story_views', 'user'], ['reacts', 'user'], ['comments', 'user'], ['post_shares', 'user'], ['post_hidden', 'user'], ['tags', 'user'], ['mevents', 'user'], ['xp_log', 'user'],
    ['user_colors', 'user'], ['user_color_active', 'user'], ['user_fx_active', 'user'], ['room_mods', 'user'], ['room_seen', 'user'], ['room_since', 'user'], ['mutes', 'user'], ['bans', 'user'],
    ['role_requests', 'from_user'], ['role_requests', 'to_user'], ['contest_scores', 'user'], ['gift_xp', 'user'], ['mails', 'to_user'], ['payouts', 'user'], ['role_history', 'user']];
  db.transaction(() => {
    try { for (const x of db.prepare('select id from reels where user=?').all(name)) reelDrop(x.id); } catch {}
    for (const [t, c] of [...T, ['reel_likes', 'user'], ['reel_views', 'user'], ['reel_comments', 'user'], ['reel_files', 'user']]) { try { db.prepare(`delete from ${t} where ${c}=?`).run(name); } catch {} }
    try { const ps = db.prepare('select id from posts where user=?').all(name); for (const p of ps) { db.prepare('delete from reacts where post=?').run(p.id); db.prepare('delete from comments where post=?').run(p.id); db.prepare('delete from post_shares where post=?').run(p.id); } db.prepare('delete from posts where user=?').run(name); } catch {}
    try { const ss = db.prepare('select id from stories where user=?').all(name); for (const x of ss) db.prepare('delete from story_views where story=?').run(x.id); db.prepare('delete from stories where user=?').run(name); } catch {}
    try { db.prepare("update msgs set user='Deleted user' where user=?").run(name); } catch {}
    try { db.prepare("update mails set from_user='Deleted user' where from_user=?").run(name); } catch {}
    db.prepare('delete from users where name=?').run(name);
  })();
}
app.post('/api/admin/delete-requests/:id', auth, ok((q, r) => {
  if (roleOf(q.user) !== 'staff') return bad(r, 'Only staff can do this', 403);
  const x = db.prepare("select * from del_requests where id=? and status='pending'").get(+q.params.id);
  if (!x) return bad(r, 'Request not found', 404);
  const acc = !!q.body?.accept, now = Date.now();
  if (acc && isMain(x.user)) return bad(r, 'The main staff account cannot be deleted.', 403);
  db.prepare('update del_requests set status=?,decided_by=?,decided_ts=? where id=?').run(acc ? 'accepted' : 'rejected', q.user, now, x.id);
  if (acc) { kickUser(x.user, 'Your account has been deleted.'); wipeUser(x.user); alog(q.user, x.user, 'delete_account', 'accepted'); online(); }
  else notify(x.user, 'system', 'Your account deletion request was declined.', '');
  r.json({ ok: true });
}));
// "Check tag": is this user tagged (and for how many more days), or can they be tagged now?
app.get('/api/tag/check', auth, ok((q, r) => {
  const me = q.user, to = String(q.query?.to || '').trim();
  if (!(RANK[roleOf(me)] >= 1)) return bad(r, 'Only Merchants and Mentors can tag users.', 403);
  purgeTags();
  const t = db.prepare('select name,role,banned from users where name=?').get(to);
  if (!t || to === me) return bad(r, 'User not found');
  const tg = db.prepare('select parent,exp from tags where user=?').get(to);
  if (tg) return r.json({ name: t.name, state: 'tagged', by: tg.parent, mine: tg.parent === me, daysLeft: Math.max(1, Math.ceil((tg.exp - Date.now()) / 864e5)) });
  if (t.role !== 'user' || t.banned) return bad(r, 'This user is not eligible to be tagged.');
  if (isBlocked(me, to)) return bad(r, "You can't tag this user.");
  r.json({ name: t.name, state: 'free', cost: TAG_COST, days: TAG_DAYS });
}));
app.post('/api/tag', auth, ok((q, r) => {
  const me = q.user, to = String(q.body?.to || '').trim();
  if (!(RANK[roleOf(me)] >= 1)) return bad(r, 'Only Merchants and Mentors can tag users.', 403);
  purgeTags();
  const t = db.prepare('select name,role,banned from users where name=?').get(to);
  if (!t || to === me) return bad(r, 'User not found');
  if (t.role !== 'user' || t.banned) return bad(r, 'This user is not eligible to be tagged.');
  if (db.prepare('select parent from tags where user=?').get(to)) return bad(r, 'This user is already tagged.', 409);
  if (isBlocked(me, to)) return bad(r, "You can't tag this user.");
  const pc = checkPin(me, q.body?.mpin);
  if (pc === 'locked') return bad(r, 'Too many wrong MPIN attempts. Try again in 10 minutes.', 429);
  if (!pc) return bad(r, 'Wrong or missing MPIN', 403);
  try {
    db.transaction(() => {
      if (!db.prepare('update users set coins=coins-? where name=? and coins>=?').run(TAG_COST, me, TAG_COST).changes) throw new Error('funds');
      db.prepare('update users set coins=coins+? where name=?').run(TAG_COST, to);
      const tx = addTx(me, 'transfer', `Tagged ${to} for ${TAG_DAYS} days (${TAG_COST.toLocaleString()} coins)`, -TAG_COST); addTx(to, 'transfer', `Tag gift from ${me}`, TAG_COST);
      db.prepare('insert into tags(user,parent,tagged_at,tx_id,exp) values(?,?,?,?,?)').run(to, me, Date.now(), tx.lastInsertRowid, Date.now() + TAG_DAYS * 864e5);
    })();
  } catch (e) { return bad(r, e.message === 'funds' ? `You need ${TAG_COST.toLocaleString()} coins to tag a user.` : 'This user is already tagged.', e.message === 'funds' ? 400 : 409); }
  pushCoins(me, to); r.json({ ok: true });
}));



// ---------- Staff: rooms (rename, capacity) ----------
const ROOM_TABLES = [['rooms', 'name'], ['favs', 'room'], ['bans', 'room'], ['room_mods', 'room'], ['room_cfg', 'room'], ['mutes', 'room'], ['msgs', 'room'], ['room_game', 'room'], ['tp_pending', 'room'], ['rb_pending', 'room'], ['lc_pending', 'room']];
app.get('/api/admin/rooms', auth, ok((q, r) => {
  if (!staffOnly(q, r)) return;
  r.json(db.prepare('select name,cat,owner,cap from rooms order by cat,name').all().map(x => ({ ...x, count: roomNames(x.name).size, game: gameOf(x.name) })));
}));
app.post('/api/admin/rooms/rename', auth, ok(async (q, r) => {
  if (!staffOnly(q, r)) return;
  const from = String(q.body?.from || ''), to = String(q.body?.to || '').trim().replace(/\s+/g, ' ');
  if (!db.prepare('select 1 from rooms where name=?').get(from)) return bad(r, 'Room not found', 404);
  if (!/^[A-Za-z0-9 ]{3,20}$/.test(to)) return bad(r, 'Room name: 3–20 characters, English letters, numbers and spaces only.');
  if (to !== from && db.prepare('select 1 from rooms where lower(name)=lower(?)').get(to)) return bad(r, 'That room name is already used.', 409);
  if (to === from) return r.json({ ok: true });
  const game = gameOf(from);
  if (!(await stopGame(from))) return bad(r, 'A game is running in that room. Try again when it ends.');
  [...(members.get(from) || [])].forEach(w => { w.room = null; send(w, { t: 'kicked', room: from, by: 'staff', renamed: to }); }); members.delete(from);
  db.transaction(() => {
    for (const [t, c] of ROOM_TABLES) db.prepare(`update ${t} set ${c}=? where ${c}=?`).run(to, from);
    if (game) db.prepare('insert or replace into room_game values(?,?)').run(to, game);
  })();
  alog(q.user, from, 'room_rename', `${from} → ${to}`); r.json({ ok: true });
}));
app.post('/api/admin/rooms/delete', auth, ok(async (q, r) => {
  if (!staffOnly(q, r)) return;
  const name = String(q.body?.room || '');
  if (!db.prepare('select 1 from rooms where name=?').get(name)) return bad(r, 'Room not found', 404);
  if (!(await stopGame(name))) return bad(r, 'A game is running in that room. Try again when it ends.');
  [...(members.get(name) || [])].forEach(w => { w.room = null; send(w, { t: 'kicked', room: name, by: 'staff', text: `${name} was deleted by staff.` }); }); members.delete(name);
  db.transaction(() => { for (const [t, c] of ROOM_TABLES) db.prepare(`delete from ${t} where ${c}=?`).run(name); try { db.prepare('delete from room_seen where room=?').run(name); } catch {} })();
  alog(q.user, name, 'room_delete', name); r.json({ ok: true });
}));
app.post('/api/admin/rooms/cap', auth, ok((q, r) => {
  if (!staffOnly(q, r)) return;
  const name = String(q.body?.room || ''), cap = Math.floor(+q.body?.cap);
  if (!db.prepare('select 1 from rooms where name=?').get(name)) return bad(r, 'Room not found', 404);
  if (!(cap >= 0 && cap <= 5000)) return bad(r, 'User limit must be between 0 (no limit) and 5000.');
  db.prepare('update rooms set cap=? where name=?').run(cap, name);
  alog(q.user, name, 'room_cap', cap ? String(cap) : 'unlimited'); cast(name, { t: 'roomcap', room: name, cap }); r.json({ ok: true });
}));

// ---------- Colour shop: buy name colours, apply one at a time ----------
db.exec(`create table if not exists user_colors(user text, color text, primary key(user,color));
create table if not exists user_color_active(user text primary key, color text)`);
const COLOR_SHOP = {
  // Shop colours are kept apart from the role colours (Admin, Staff, Mentor, Head Mentor, Merchant, VIP, Maroon)
  hotpink:  { n: 'Hot Pink',      c: 100000, hex: '#ff1493' },
  eblue:    { n: 'Electric Blue', c: 100000, hex: '#2979ff' },
  nlime:    { n: 'Neon Lime',     c: 120000, hex: '#76ff03' },
  epurple:  { n: 'Electric Purple', c: 110000, hex: '#d500f9' },
  aqua:     { n: 'Aqua',          c: 110000, hex: '#00e5ff' },
  amber:    { n: 'Amber',         c: 140000, hex: '#ffc400' },
  violet:   { n: 'Violet',        c: 150000, hex: '#7c4dff' },
  magenta:  { n: 'Magenta',       c: 160000, hex: '#ff00ff' },
  nyellow:  { n: 'Neon Yellow',   c: 200000, hex: '#ffea00' },
  // Effects: animated glows around the username. "shadow" holds the CSS animation (keyframes are in the page stylesheet)
  fx_glow:   { n: 'Soft Pulse',   c: 150000, shadow: 'fxPulse 2.4s ease-in-out infinite' },
  fx_neon:   { n: 'Neon Flicker', c: 180000, shadow: 'fxFlicker 1.8s linear infinite' },
  fx_double: { n: 'Wave Glow',    c: 200000, shadow: 'fxWave 2s ease-in-out infinite' },
  fx_rose:    { n: 'Rose',         c: 180000, shadow: 'fxRose 3s ease-in-out infinite' },
  fx_sparkle: { n: 'Sparkle',      c: 150000, shadow: 'fxSparkle 1.6s ease-in-out infinite' },
  fx_fire:    { n: 'Fire',         c: 170000, shadow: 'fxFire 1.2s ease-in-out infinite' },
  fx_ice:     { n: 'Ice',          c: 160000, shadow: 'fxIce 3s ease-in-out infinite' },
  fx_rainbow: { n: 'Rainbow',      c: 200000, shadow: 'fxRainbow 4s linear infinite' }
};
for (const k of Object.keys(COLOR_SHOP)) COLOR_SHOP[k].k = k;
try { db.exec('alter table user_colors add column expires int default 0'); } catch {} // older table without expiry
const COL_DAYS = 30, COL_RENEW_DAYS = 2, DAY_MS = 86400000;
try { db.exec('create table if not exists user_fx_active(user text primary key, color text)'); } catch {}
const bcastColors = (user, hex) => wss.clients.forEach(w => w.user && send(w, { t: 'ucol', user, hex }));
const bcastFx = (user, shadow) => wss.clients.forEach(w => w.user && send(w, { t: 'ufx', user, shadow }));
// A colour or effect lasts 30 days. When it ends it is removed from the user, and can be bought again.
const purgeColors = () => {
  const now = Date.now();
  const gone = db.prepare('select distinct a.user from user_color_active a join user_colors c on c.user=a.user and c.color=a.color where c.expires>0 and c.expires<=?').all(now).map(x => x.user);
  const goneFx = db.prepare('select distinct a.user from user_fx_active a join user_colors c on c.user=a.user and c.color=a.color where c.expires>0 and c.expires<=?').all(now).map(x => x.user);
  db.prepare('delete from user_colors where expires>0 and expires<=?').run(now);
  db.prepare("delete from user_color_active where color not like 'badge:%' and not exists (select 1 from user_colors c where c.user=user_color_active.user and c.color=user_color_active.color)").run();
  db.prepare('delete from user_fx_active where not exists (select 1 from user_colors c where c.user=user_fx_active.user and c.color=user_fx_active.color)').run();
  gone.forEach(u => bcastColors(u, null));
  goneFx.forEach(u => bcastFx(u, null));
};
setInterval(purgeColors, 10 * 60 * 1000);
// Badge colours: a user may colour their ID with the colour of any badge they hold (their role badge and/or VIP)
const BADGE_NAMES = { staff: 'Staff', admin: 'Admin', headmentor: 'Head Mentor', mentor: 'Mentor', merchant: 'Merchant', vip: 'VIP' };
const badgesOf = user => { const o = []; const r = roleOf(user); if (r && r !== 'vip' && BADGE_NAMES[r]) o.push(r); if (r === 'vip' || db.prepare('select vip from users where name=?').get(user)?.vip) o.push('vip'); return o; };
const badgeHex = k => `var(--nm-${k})`;   // theme-aware: same colour as the badge in Day, Night and Stonic
const activeColors = () => { purgeColors(); const o = {};
  db.prepare('select a.user, a.color from user_color_active a').all().forEach(x => {
    if (x.color.startsWith('badge:')) { const k = x.color.slice(6); if (badgesOf(x.user).includes(k)) o[x.user] = badgeHex(k); return; }
    if (COLOR_SHOP[x.color] && db.prepare('select 1 from user_colors where user=? and color=?').get(x.user, x.color)) o[x.user] = COLOR_SHOP[x.color].hex; });
  return o; };
const activeFx = () => { purgeColors(); const o = {}; db.prepare('select a.user, c.color from user_fx_active a join user_colors c on c.user=a.user and c.color=a.color').all().forEach(x => { if (COLOR_SHOP[x.color]?.shadow) o[x.user] = COLOR_SHOP[x.color].shadow; }); return o; };
app.get('/api/colors', auth, ok((q, r) => {
  purgeColors();
  const rows = db.prepare('select color, expires from user_colors where user=?').all(q.user);
  const active = db.prepare('select color from user_color_active where user=?').get(q.user)?.color || null;
  const fxActive = db.prepare('select color from user_fx_active where user=?').get(q.user)?.color || null;
  r.json({ badges: badgesOf(q.user).map(k => ({ k, n: BADGE_NAMES[k] })), shop: COLOR_SHOP, owned: rows.map(x => x.color), expires: Object.fromEntries(rows.map(x => [x.color, x.expires])), active, fxActive, coins: coins(q.user), days: COL_DAYS, renewDays: COL_RENEW_DAYS });
}));
app.post('/api/colors/buy/:k', auth, ok((q, r) => {
  purgeColors();
  const c = COLOR_SHOP[q.params.k]; if (!c) return bad(r, 'Colour not found', 404);
  const now = Date.now();
  const row = db.prepare('select expires from user_colors where user=? and color=?').get(q.user, c.k);
  if (row && row.expires - now > COL_RENEW_DAYS * DAY_MS) return bad(r, `You can renew this colour ${COL_RENEW_DAYS} days before it ends.`, 409);
  const paid = db.transaction(() => {
    if (!db.prepare('update users set coins=coins-? where name=? and coins>=?').run(c.c, q.user, c.c).changes) throw new Error('funds');
    if (row) db.prepare('update user_colors set expires=max(expires,?)+? where user=? and color=?').run(now, COL_DAYS * DAY_MS, q.user, c.k);
    else db.prepare('insert into user_colors(user,color,expires) values(?,?,?)').run(q.user, c.k, now + COL_DAYS * DAY_MS);
    addTx(q.user, 'shop', `${row ? 'Renewed' : 'Bought'} ${c.n} colour for ${COL_DAYS} days`, -c.c);
  });
  try { paid(); } catch (e) { if (e.message === 'funds') return bad(r, 'Not enough coins for this colour.'); throw e; }
  r.json({ ok: true, coins: coins(q.user) });
}));
app.post('/api/colors/apply/:k', auth, ok((q, r) => {
  const c = COLOR_SHOP[q.params.k]; if (!c) return bad(r, 'Colour not found', 404);
  if (!db.prepare('select 1 from user_colors where user=? and color=?').get(q.user, c.k)) return bad(r, 'Buy this colour first.', 403);
  if (c.shadow) { // an effect goes in its own slot, so a colour and an effect can both be worn
    db.prepare('insert into user_fx_active(user,color) values(?,?) on conflict(user) do update set color=excluded.color').run(q.user, c.k);
    bcastFx(q.user, c.shadow); return r.json({ ok: true });
  }
  db.prepare('insert into user_color_active(user,color) values(?,?) on conflict(user) do update set color=excluded.color').run(q.user, c.k);
  bcastColors(q.user, c.hex); r.json({ ok: true });
}));
app.post('/api/colors/badge/:k', auth, ok((q, r) => {
  const k = q.params.k; if (!badgesOf(q.user).includes(k)) return bad(r, 'You do not have this badge.', 403);
  db.prepare('insert into user_color_active(user,color) values(?,?) on conflict(user) do update set color=excluded.color').run(q.user, 'badge:' + k);
  bcastColors(q.user, badgeHex(k)); r.json({ ok: true });
}));
app.post('/api/colors/fx/remove', auth, ok((q, r) => {
  db.prepare('delete from user_fx_active where user=?').run(q.user);
  bcastFx(q.user, null); r.json({ ok: true });
}));
app.post('/api/colors/remove', auth, ok((q, r) => {
  db.prepare('delete from user_color_active where user=?').run(q.user);
  bcastColors(q.user, null); r.json({ ok: true });
}));

// ---------- Staff: custom gifts ----------
const staffOnly = (q, r) => roleOf(q.user) === 'staff' || (bad(r, 'Only staff can manage gifts', 403), false);
const bcastGifts = () => wss.clients.forEach(w => w.user && send(w, { t: 'gifts', gifts: allGifts() }));
app.get('/api/admin/gifts', auth, ok((q, r) => { if (!staffOnly(q, r)) return; r.json(db.prepare('select key,name,icon,cost,recv,active from gifts order by ts desc').all()); }));
app.post('/api/admin/gifts', auth, ok((q, r) => {
  if (!staffOnly(q, r)) return;
  const b = q.body || {}, name = String(b.name || '').trim().slice(0, 24), cost = Math.floor(+b.cost), recv = Math.floor(+b.recv);
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16);
  if (name.length < 2 || key.length < 2) return bad(r, 'Gift name needs at least 2 English letters or numbers.');
  if (!imgUrl(b.icon)) return bad(r, 'Upload a gift icon first.');
  if (!(cost >= 1 && cost <= 1e9)) return bad(r, 'Gift price must be between 1 and 1,000,000,000 coins.');
  if (!(recv >= 0 && recv <= 1e9)) return bad(r, 'Receiver coins must be between 0 and 1,000,000,000.');
  if (GIFTS[key] || db.prepare('select 1 from gifts where key=?').get(key)) return bad(r, 'A gift with this name already exists.', 409);
  db.prepare('insert into gifts(key,name,icon,cost,recv,active,ts) values(?,?,?,?,?,1,?)').run(key, name, b.icon, cost, recv, Date.now());
  alog(q.user, key, 'gift_create', `${name}: ${cost} / ${recv}`); bcastGifts(); r.json({ ok: true, key });
}));
app.post('/api/admin/gifts/:k', auth, ok((q, r) => {
  if (!staffOnly(q, r)) return;
  const g = db.prepare('select * from gifts where key=?').get(q.params.k); if (!g) return bad(r, 'Gift not found', 404);
  const b = q.body || {}, cost = b.cost === undefined ? g.cost : Math.floor(+b.cost), recv = b.recv === undefined ? g.recv : Math.floor(+b.recv);
  const name = b.name === undefined ? g.name : String(b.name).trim().slice(0, 24), icon = b.icon === undefined ? g.icon : b.icon;
  if (!(cost >= 1 && cost <= 1e9) || !(recv >= 0 && recv <= 1e9) || name.length < 2 || !imgUrl(icon)) return bad(r, 'Check the gift name, icon and coin values.');
  db.prepare('update gifts set name=?,icon=?,cost=?,recv=?,active=? where key=?').run(name, icon, cost, recv, b.active === undefined ? g.active : (b.active ? 1 : 0), g.key);
  if (icon !== g.icon && MEDIA_URL.test(g.icon) && !db.prepare('select 1 from gifts where icon=?').get(g.icon)) fs.unlink('.' + g.icon, () => {});
  alog(q.user, g.key, 'gift_edit', `${name}: ${cost} / ${recv}`); bcastGifts(); r.json({ ok: true });
}));
app.delete('/api/admin/gifts/:k', auth, ok((q, r) => {
  if (!staffOnly(q, r)) return;
  const g = db.prepare('select * from gifts where key=?').get(q.params.k); if (!g) return bad(r, 'Gift not found', 404);
  db.prepare('delete from gifts where key=?').run(g.key); db.prepare('delete from gift_inv where gift=?').run(g.key);
  if (MEDIA_URL.test(g.icon)) fs.unlink('.' + g.icon, () => {});
  alog(q.user, g.key, 'gift_delete', g.name); bcastGifts(); r.json({ ok: true });
}));

// ---------- Staff admin panel ----------
const COUNTRIES = ['Afghanistan','Albania','Algeria','Argentina','Armenia','Australia','Austria','Azerbaijan','Bahrain','Bangladesh','Belarus','Belgium','Bhutan','Bolivia','Bosnia and Herzegovina','Brazil','Brunei','Bulgaria','Cambodia','Cameroon','Canada','Chile','China','Colombia','Costa Rica','Croatia','Cuba','Cyprus','Czech Republic','Denmark','Dominican Republic','Ecuador','Egypt','El Salvador','Estonia','Ethiopia','Finland','France','Georgia','Germany','Ghana','Greece','Guatemala','Hong Kong','Hungary','Iceland','India','Indonesia','Iran','Iraq','Ireland','Israel','Italy','Ivory Coast','Jamaica','Japan','Jordan','Kazakhstan','Kenya','Kuwait','Kyrgyzstan','Laos','Latvia','Lebanon','Libya','Lithuania','Luxembourg','Malaysia','Maldives','Malta','Mexico','Moldova','Mongolia','Morocco','Myanmar','Nepal','Netherlands','New Zealand','Nigeria','North Macedonia','Norway','Oman','Pakistan','Palestine','Panama','Paraguay','Peru','Philippines','Poland','Portugal','Qatar','Romania','Russia','Saudi Arabia','Senegal','Serbia','Singapore','Slovakia','Slovenia','Somalia','South Africa','South Korea','Spain','Sri Lanka','Sudan','Sweden','Switzerland','Syria','Taiwan','Tajikistan','Tanzania','Thailand','Tunisia','Turkey','Turkmenistan','Uganda','Ukraine','United Arab Emirates','United Kingdom','United States','Uruguay','Uzbekistan','Venezuela','Vietnam','Yemen','Zambia','Zimbabwe'];
const RENAME_COLS = [['msgs', 'user'], ['posts', 'user'], ['comments', 'user'], ['reacts', 'user'], ['txs', 'user'], ['favs', 'user'], ['bans', 'user'], ['bans', 'by'], ['room_mods', 'user'],
  ['mutes', 'user'], ['tp_pending', 'user'], ['post_shares', 'user'], ['post_hidden', 'user'], ['stories', 'user'], ['story_views', 'user'], ['friends', 'a'], ['friends', 'b'], ['blocks', 'a'], ['blocks', 'b'], ['call_log', 'a'], ['call_log', 'b'], ['reels', 'user'], ['reel_likes', 'user'], ['reel_views', 'user'], ['reel_comments', 'user'], ['reel_files', 'user'], ['rooms', 'owner'], ['users', 'parent'], ['role_requests', 'from_user'], ['role_requests', 'to_user'], ['role_requests', 'decided_by'], ['tags', 'user'], ['tags', 'parent'], ['commissions', 'spender'], ['commissions', 'parent'], ['mevents', 'user'], ['payouts', 'user'], ['role_history', 'user'], ['role_history', 'by'], ['gift_inv', 'user'], ['lc_pending', 'user'], ['rb_pending', 'user']];   // room-name tables are handled by the room rename
const alog = (staff, target, action, detail = '') => db.prepare('insert into admin_log(staff,target,action,detail,ts) values(?,?,?,?,?)').run(staff, target, action, String(detail).slice(0, 200), Date.now());
const kickUser = (name, why) => wss.clients.forEach(w => { if (w.user === name) { send(w, { t: 'error', error: why }); try { w.close(); } catch {} } });
function staffTarget(q, r, name) {
  if (roleOf(q.user) !== 'staff') { bad(r, 'Only staff can use the admin panel', 403); return null; }
  const u = db.prepare('select * from users where name=?').get(name);
  if (!u) { bad(r, 'User not found', 404); return null; }
  if (isMain(u.name) && !isMain(q.user)) { bad(r, 'The main staff account is protected', 403); return null; }
  if (u.role === 'staff' && !isMain(q.user) && u.name !== q.user) { bad(r, 'Only the main staff account can edit other staff', 403); return null; }
  return u;
}
const adminView = u => ({ name: u.name, full_name: u.full_name, email: u.email, mobile: u.mobile, country: u.country, gender: u.gender, bio: u.bio, status_text: u.status_text, presence: u.presence,
  role: u.role, verified: !!u.verified, vip: !!u.vip, banned: !!u.banned, ban_reason: u.ban_reason, xp: u.xp, level: level(u.xp), coins: u.coins, unlimited: isMain(u.name), hasPin: !!u.mpin, secQ: u.sec_q, avatar: u.avatar || '', parent: u.parent || '', taggedBy: db.prepare('select parent from tags where user=?').get(u.name)?.parent || '', history: db.prepare('select from_role,to_role,reason,by,ts from role_history where user=? order by id desc limit 8').all(u.name) });
app.get('/api/admin/countries', auth, ok((q, r) => r.json(COUNTRIES)));
app.get('/api/admin/users', auth, ok((q, r) => {
  if (roleOf(q.user) !== 'staff') return bad(r, 'Only staff can use the admin panel', 403);
  const s = String(q.query.q || '').replace(/[%_\\]/g, '').slice(0, 40);
  const rows = db.prepare("select name,role,xp,coins,banned,email,full_name,verified from users where name like '%'||@s||'%' or email like '%'||@s||'%' or full_name like '%'||@s||'%' or mobile like '%'||@s||'%' order by banned desc, case role when 'staff' then 0 when 'admin' then 1 else 2 end, name limit 60").all({ s });
  r.json(rows.map(u => ({ ...u, level: level(u.xp), unlimited: isMain(u.name) })));
}));
app.get('/api/admin/log', auth, ok((q, r) => {
  if (roleOf(q.user) !== 'staff') return bad(r, 'Only staff can use the admin panel', 403);
  r.json(db.prepare('select staff,target,action,detail,ts from admin_log order by id desc limit 40').all());
}));
app.get('/api/admin/users/:n', auth, ok((q, r) => { const u = staffTarget(q, r, q.params.n); if (u) r.json(adminView(u)); }));
app.post('/api/admin/transfer', auth, ok((q, r) => {
  if (roleOf(q.user) !== 'staff') return bad(r, 'Only staff can use the admin panel', 403);
  const from = db.prepare('select * from users where name=?').get(String(q.body?.from || '')), to = db.prepare('select * from users where name=?').get(String(q.body?.to || ''));
  const amt = Math.floor(+q.body?.amount);
  if (!from || !to) return bad(r, 'User not found', 404);
  if (from.name === to.name) return bad(r, 'Choose two different users');
  if (!(amt >= 1)) return bad(r, 'Enter an amount of at least 1');
  if (isMain(from.name) && !isMain(q.user)) return bad(r, 'The main staff account is protected', 403);
  if (q.body?.mpin) { const pc = checkPin(from.name, q.body.mpin); if (pc === 'locked') return bad(r, 'Too many wrong MPIN attempts. Try again in 10 minutes.', 429); if (!pc) return bad(r, 'Wrong MPIN for ' + from.name, 403); }
  const go = db.transaction(() => {
    if (!db.prepare('update users set coins=coins-? where name=? and coins>=?').run(amt, from.name, amt).changes) throw new Error('funds');
    db.prepare('update users set coins=coins+? where name=?').run(amt, to.name);
    addTx(from.name, 'transfer', `Sent to ${to.name} (by staff)`, -amt); addTx(to.name, 'transfer', `Received from ${from.name} (by staff)`, amt);
  });
  try { go(); } catch { return bad(r, `${from.name} does not have enough coins`); }
  alog(q.user, from.name, 'transfer', `${amt} coins to ${to.name}${q.body?.mpin ? ' (MPIN verified)' : ''}`);
  pushCoins(from.name); pushCoins(to.name); r.json({ ok: true });
}));
app.post('/api/admin/users/:n/edit', auth, ok((q, r) => {
  const u = staffTarget(q, r, q.params.n); if (!u) return;
  const b = q.body || {}, a = String(b.action || ''), me = q.user, done = (detail = '') => { alog(me, q.params.n, a, detail); const f = db.prepare('select * from users where id=?').get(u.id); r.json(adminView(f)); };
  const str = (v, max) => String(v ?? '').trim().slice(0, max);
  if (a === 'rename') {
    const nn = str(b.newName, 16);
    if (isMain(u.name)) return bad(r, 'The main staff ID cannot be renamed');
    if (!/^[a-z._-][a-z0-9._-]{2,15}$/.test(nn)) return bad(r, 'ID must be 3–16 characters: small letters (a–z), numbers, dot, dash or underscore, no capitals or spaces, and it cannot start with a number.');
    if (isMain(nn) || ['admin', 'staff', 'mentor', 'headmentor', 'merchant', 'vip', 'support'].includes(nn.toLowerCase())) return bad(r, 'That ID is reserved.');
    if (db.prepare('select 1 from users where lower(name)=lower(?) and id!=?').get(nn, u.id)) return bad(r, 'That ID is already taken.', 409);
    const old = u.name;
    db.transaction(() => {
      db.prepare('update users set name=? where id=?').run(nn, u.id);
      for (const [t, c] of RENAME_COLS) db.prepare(`update ${t} set ${c}=? where ${c}=?`).run(nn, old);
      for (const { room } of db.prepare("select distinct room from msgs where room like 'dm:%'").all()) {
        const parts = room.slice(3).split(':'); if (!parts.includes(old)) continue;
        db.prepare('update msgs set room=? where room=?').run('dm:' + parts.map(x => x === old ? nn : x).sort().join(':'), room);
      }
    })();
    kickUser(old, 'auth'); alog(me, old, 'rename', `${old} → ${nn}`);
    return r.json(adminView(db.prepare('select * from users where id=?').get(u.id)));
  }
  if (a === 'country') { const c = str(b.country, 40); if (c && !COUNTRIES.includes(c)) return bad(r, 'Choose a country from the list'); db.prepare('update users set country=? where id=?').run(c, u.id); return done(c || 'cleared'); }
  if (a === 'level') {
    const L = Math.floor(+b.level); if (!(L >= 1 && L <= MAXLV)) return bad(r, `Level must be between 1 and ${MAXLV}`);
    db.prepare('update users set xp=? where id=?').run(CUM[L], u.id);
    wss.clients.forEach(w => w.user === u.name && send(w, { t: 'xp', xp: CUM[L] })); return done(`Level ${L} (${CUM[L]} XP)`);
  }
  if (a === 'mobile') { const m = str(b.mobile, 20).replace(/[\s-]/g, ''); if (m && !/^\+?[0-9]{6,15}$/.test(m)) return bad(r, 'Enter a valid mobile number (6–15 digits, optional +).'); db.prepare('update users set mobile=? where id=?').run(m, u.id); return done(m || 'cleared'); }
  if (a === 'secq_set') {
    const qn = str(b.question, 100), an = str(b.answer, 60).toLowerCase();
    if (qn.length < 3) return bad(r, 'Write the security question (at least 3 characters).'); if (!an) return bad(r, 'Write the answer.');
    db.prepare('update users set sec_q=?, sec_a=? where id=?').run(qn, bcrypt.hashSync(an, 10), u.id); return done('set');
  }
  if (a === 'secq_reset') { db.prepare("update users set sec_q='', sec_a='' where id=?").run(u.id); return done('reset'); }
  if (a === 'pin_set') { const pin = String(b.pin || ''); if (!/^[0-9]{4,6}$/.test(pin)) return bad(r, 'MPIN must be 4 to 6 digits.'); db.prepare('update users set mpin=? where id=?').run(bcrypt.hashSync(pin, 10), u.id); pinFails.delete(u.name); return done('set'); }
  if (a === 'pin_reset') { db.prepare("update users set mpin='' where id=?").run(u.id); pinFails.delete(u.name); return done('reset'); }
  if (a === 'email') {
    const em = str(b.email, 100).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return bad(r, 'Enter a valid email address.');
    if (db.prepare('select 1 from users where email=? and id!=?').get(em, u.id)) return bad(r, 'That email is already used by another account.', 409);
    db.prepare('update users set email=? where id=?').run(em, u.id); return done(em);
  }
  if (a === 'password') { const pw = String(b.password || ''); if (pw.length < 6 || pw.length > 100) return bad(r, 'Password must be at least 6 characters.'); db.prepare('update users set pass=? where id=?').run(bcrypt.hashSync(pw, 10), u.id); return done('changed'); }
  if (a === 'role') {
    const role = String(b.role || ''); if (!ROLE_LIST.includes(role)) return bad(r, 'Invalid role');
    if (isMain(u.name)) return bad(r, 'The main staff role cannot be changed');
    if (role === 'staff' && !isMain(me)) return bad(r, 'Only the main staff account can create other staff', 403);
    setRole(u.name, role, me, 'Staff change'); online(); return done(`${u.role} → ${role}`);
  }
  if (a === 'coins') {
    const amt = Math.floor(+b.amount), mode = String(b.mode || '');
    if (isMain(u.name)) return bad(r, 'The main staff account already has unlimited coins.');
    if (!['add', 'remove', 'set'].includes(mode)) return bad(r, 'Invalid action'); if (!(amt >= 0) || amt > 1e12 || (mode !== 'set' && amt < 1)) return bad(r, 'Enter a valid amount');
    const before = u.coins;
    if (mode === 'add') db.prepare('update users set coins=coins+? where id=?').run(amt, u.id);
    else if (mode === 'remove') db.prepare('update users set coins=max(0,coins-?) where id=?').run(amt, u.id);
    else db.prepare('update users set coins=? where id=?').run(amt, u.id);
    const after = db.prepare('select coins from users where id=?').get(u.id).coins; addTx(u.name, 'other', `Staff adjustment (${mode})`, after - before);
    pushCoins(u.name); return done(`${mode} ${amt}: ${before} → ${after}`);
  }
  if (a === 'ban') {
    if (isMain(u.name) || u.name === me) return bad(r, 'This account cannot be banned');
    db.prepare('update users set banned=1, ban_reason=? where id=?').run(str(b.reason, 100), u.id); kickUser(u.name, 'banned'); online(); return done(str(b.reason, 100));
  }
  if (a === 'parent') {
    const pn = str(b.parent, 16); if (pn) { const pr = db.prepare('select role from users where name=?').get(pn); if (!pr || !(RANK[pr.role] >= 1) || pn === u.name) return bad(r, 'Parent must be an existing merchant, mentor or head mentor'); }
    db.prepare('update users set parent=? where id=?').run(pn, u.id); return done(pn || 'cleared');
  }
  if (a === 'tag') {
    const pn = str(b.by, 16); db.prepare('delete from tags where user=?').run(u.name);
    if (pn) { const pr = db.prepare('select role from users where name=?').get(pn); if (!pr || !(RANK[pr.role] >= 1) || pn === u.name) return bad(r, 'Tagger must be an existing merchant, mentor or head mentor'); db.prepare('insert into tags(user,parent,tagged_at,tx_id) values(?,?,?,0)').run(u.name, pn, Date.now()); }
    return done(pn || 'untagged');
  }
  if (a === 'unban') { db.prepare("update users set banned=0, ban_reason='' where id=?").run(u.id); return done(); }
  if (a === 'profile') {
    const g = ['Male', 'Female', 'Other', ''].includes(b.gender) ? b.gender : u.gender;
    db.prepare('update users set full_name=?, gender=?, bio=?, status_text=? where id=?').run(str(b.full_name, 40), g, str(b.bio, 200), str(b.status_text, 60), u.id); return done();
  }
  if (a === 'vip') { db.prepare('update users set vip=? where id=?').run(b.on ? 1 : 0, u.id); return done(b.on ? 'on' : 'off'); }
  if (a === 'verify') { db.prepare('update users set verified=? where id=?').run(b.on ? 1 : 0, u.id); return done(b.on ? 'on' : 'off'); }
  if (a === 'avatar_remove') {
    const old = u.avatar; db.prepare("update users set avatar='' where id=?").run(u.id);
    if (old) { db.prepare('delete from user_photos where user=? and url=?').run(u.name, old); dropFile(old); } return done();
  }
  bad(r, 'Unknown action');
}));

// ---------- Daily Lucky Draw: two draws a day (12:00 PM and 12:00 AM, Dhaka time) ----------
const DRAW_TZ = 6 * 3600e3, HALF = 12 * 3600e3;               // Asia/Dhaka = UTC+6 (no daily-saving shift)
// label, min, max, weight (weights favour the smaller slices so the economy is not flooded)
const PRIZES = [['500–550', 500, 550, 30], ['750–825', 750, 825, 22], ['1k–1.1k', 1000, 1100, 16], ['1250–1375', 1250, 1375, 11], ['1.5k–1.65k', 1500, 1650, 8], ['2k–2.2k', 2000, 2200, 5], ['3k–3.3k', 3000, 3300, 4], ['5k–5.5k', 5000, 5500, 2.5], ['10k–11k', 10000, 11000, 1], ['20k–22k', 20000, 22000, 0.5]]
  .map(([l, min, max, w]) => ({ l, min, max, w }));
try { db.exec('alter table users add column last_slot int default -1'); } catch {}
const drawSlot = (t = Date.now()) => Math.floor((t + DRAW_TZ) / HALF);          // id of the current 12-hour window
const drawNext = (t = Date.now()) => (drawSlot(t) + 1) * HALF - DRAW_TZ;          // UTC ms when the next window opens
const pickPrize = () => { const tot = PRIZES.reduce((a, p) => a + p.w, 0); let x = crypto.randomInt(0, 1e6) / 1e6 * tot; for (let i = 0; i < PRIZES.length; i++) { if (x < PRIZES[i].w) return i; x -= PRIZES[i].w; } return 0; };
const spinInfo = name => { const u = db.prepare('select spins,last_slot from users where name=?').get(name); return { prizes: PRIZES.map(p => p.l), spins: u.spins, free: u.last_slot !== drawSlot(), next: drawNext() }; };
app.get('/api/spin', auth, ok((q, r) => r.json(spinInfo(q.user))));
app.post('/api/spin', auth, ok((q, r) => {
  const u = db.prepare('select spins,last_slot from users where name=?').get(q.user), slot = drawSlot();
  if (u.last_slot !== slot) { if (!db.prepare('update users set last_slot=? where name=? and last_slot is not ?').run(slot, q.user, slot).changes) return bad(r, 'Already spun'); }
  else if (u.spins > 0) { if (!db.prepare('update users set spins=spins-1 where name=? and spins>0').run(q.user).changes) return bad(r, 'No spins left'); }
  else return bad(r, 'No draw available. The next draw opens at 12:00 ' + (new Date(drawNext() + DRAW_TZ).getUTCHours() === 0 ? 'AM' : 'PM') + ' (Dhaka time).');
  const i = pickPrize(), p = PRIZES[i], amount = crypto.randomInt(p.min, p.max + 1);
  db.prepare('update users set coins=coins+? where name=?').run(amount, q.user); addTx(q.user, 'other', `Daily Lucky Draw: ${p.l}`, amount);
  wss.clients.forEach(w => w.user === q.user && send(w, { t: 'coins', coins: coins(q.user) }));
  r.json({ index: i, prize: p.l, amount, coins: coins(q.user), ...spinInfo(q.user) });
}));

// ---------- Announcements (sent from the Admin Panel, shown to every user on app start) ----------
db.exec('create table if not exists announcements(id integer primary key, title text, body text, link text, btn text, by text, ts int, active int default 1)');
const annOut = a => a && { id: a.id, title: a.title, body: a.body, link: a.link || '', btn: a.btn || '', ts: a.ts };
const staffChk = (q, r) => roleOf(q.user) === 'staff' || (bad(r, 'Only staff can send announcements', 403), false);
app.get('/api/announcement', auth, ok((q, r) => r.json(annOut(db.prepare('select * from announcements where active=1 order by id desc limit 1').get()) || null)));
app.get('/api/admin/announcements', auth, ok((q, r) => { if (!staffChk(q, r)) return; r.json(db.prepare('select id,title,body,link,btn,by,ts,active from announcements order by id desc limit 30').all()); }));
app.post('/api/admin/announcements', auth, ok((q, r) => {
  if (!staffChk(q, r)) return;
  const title = String(q.body.title || '').trim().slice(0, 80), body = String(q.body.body || '').trim().slice(0, 1000), btn = String(q.body.btn || '').trim().slice(0, 20); let link = String(q.body.link || '').trim().slice(0, 300);
  if (!title || !body) return bad(r, 'Title and message are required');
  if (link && !/^(https?:\/\/|\/)/i.test(link)) return bad(r, 'Link must start with http:// or https://');
  const id = db.prepare('insert into announcements(title,body,link,btn,by,ts) values(?,?,?,?,?,?)').run(title, body, link, btn, q.user, Date.now()).lastInsertRowid;
  const a = annOut(db.prepare('select * from announcements where id=?').get(id));
  wss.clients.forEach(w => w.user && send(w, { t: 'announce', a }));
  r.json({ ok: true, id: Number(id) });
}));
app.delete('/api/admin/announcements/:id', auth, ok((q, r) => { if (!staffChk(q, r)) return; db.prepare('update announcements set active=0 where id=?').run(+q.params.id); r.json({ ok: true }); }));
// ---------- Room Edit (room admin / super moderator / staff): description, moderators, minimum level ----------
const canEditRoom = (room, u) => isSA(u) || ownerOf(room) === u || isSuper(room, u);
const roomEditState = room => { const r = db.prepare('select owner,descr,minlv from rooms where name=?').get(room) || {}; return { room, owner: r.owner || STAFF_USER, descr: r.descr || '', minlv: r.minlv || 0, mods: db.prepare('select user,super from room_mods where room=? order by user').all(room).map(x => ({ user: x.user, super: !!x.super })) }; };
const castRoomCfg = room => { const e = roomEditState(room); cast(room, { t: 'roomcfg', room, descr: e.descr, minlv: e.minlv, mods: e.mods.map(x => x.user), supers: e.mods.filter(x => x.super).map(x => x.user) }); castRoster(room); };
app.get('/api/rooms/:name/edit', auth, ok((q, r) => { const room = q.params.name; if (!roomOk(room) || /^dm:/.test(room)) return bad(r, 'No such room', 404); if (!canEditRoom(room, q.user)) return bad(r, 'Only the room admin can edit this room', 403); r.json(roomEditState(room)); }));
app.post('/api/rooms/:name/edit', auth, ok((q, r) => {
  const room = q.params.name; if (!roomOk(room) || /^dm:/.test(room)) return bad(r, 'No such room', 404);
  if (!canEditRoom(room, q.user)) return bad(r, 'Only the room admin can edit this room', 403);
  const b = q.body || {};
  if (b.descr !== undefined) db.prepare('update rooms set descr=? where name=?').run(String(b.descr).trim().slice(0, 200), room);
  if (b.minlv !== undefined) { const n = Math.max(0, Math.min(MAXLV, parseInt(b.minlv, 10) || 0)); db.prepare('update rooms set minlv=? where name=?').run(n, room); }
  if (b.addMod) {
    const u = db.prepare('select name from users where lower(name)=lower(?)').get(String(b.addMod).trim());
    if (!u) return bad(r, 'No user with that name');
    if (u.name === ownerOf(room) || u.name.toLowerCase() === STAFF_USER) return bad(r, 'That user already manages this room');
    db.prepare('insert or ignore into room_mods(room,user) values(?,?)').run(room, u.name);
  }
  if (b.removeMod) { const u = String(b.removeMod); if (!isSA(q.user) && ownerOf(room) !== q.user && isSuper(room, u)) return bad(r, 'Only the room admin can remove a super moderator'); db.prepare('delete from room_mods where room=? and user=?').run(room, u); }
  castRoomCfg(room); r.json(roomEditState(room));
}));
// ---------- Daily activity XP (rolling 24 hours) ----------
db.exec('create table if not exists xp_log(user text, kind text, ref text, xp int, ts int); create index if not exists xp_log_u on xp_log(user,kind,ts)');
const ACT = { post: { xp: 100, max: 5 }, follow: { xp: 100, max: 5 }, comment: { xp: 50, max: 5 }, share: { xp: 50, max: 5 }, react: { xp: 50, max: 5 }, game: { xp: 5, max: 100 }, online: { xp: 5, max: 24 } };
function grantAct(user, kind, ref = '') {
  const c = ACT[kind]; if (!c || !user || user.endsWith(' Bot')) return 0;
  const since = Date.now() - 24 * 3600e3, ref0 = String(ref);
  if (db.prepare('select count(*) n from xp_log where user=? and kind=? and ts>?').get(user, kind, since).n >= c.max) return 0;
  if (ref0 && kind !== 'game' && kind !== 'online' && db.prepare('select 1 from xp_log where user=? and kind=? and ref=? and ts>?').get(user, kind, ref0, since)) return 0;   // each post / person counts once per day
  db.prepare('insert into xp_log values(?,?,?,?,?)').run(user, kind, ref0, c.xp, Date.now());
  addXp(user, c.xp);
  wss.clients.forEach(w => { if (w.user === user) { send(w, { t: 'xp', xp: xpOf(user) }); send(w, { t: 'actxp', kind, xp: c.xp }); } });
  return c.xp;
}
const onlineAcc = new Map();      // 5 XP for every full hour spent online (up to 24 per day)
setInterval(() => {
  try {
    const seen = new Set(); wss.clients.forEach(w => { if (w.user && w.readyState === 1) seen.add(w.user); });
    for (const u of seen) {
      if (db.prepare('select presence from users where name=?').get(u)?.presence === 'offline') continue;
      const a = (onlineAcc.get(u) || 0) + 60e3;
      lbAdd('active', u, 1);
      if (a >= 3600e3) { onlineAcc.set(u, a - 3600e3); grantAct(u, 'online', String(Date.now())); } else onlineAcc.set(u, a);
    }
  } catch (e) { console.error(e); }
}, 60e3).unref();

// ---------- Security: MPIN and security question (set from Settings) ----------
const SEC_QS = ["What was the name of your first pet?", "In which city or village were you born?", "What was the name of your first school?", "What is your mother's first name?", "What is your favourite food?", "What was your childhood nickname?", "Who was your favourite teacher?", "What is the name of your best childhood friend?"];
app.post('/api/security/pin', auth, ok((q, r) => {
  const pin = String(q.body?.pin || ''), old = String(q.body?.old || '');
  if (!/^[0-9]{4,6}$/.test(pin)) return bad(r, 'MPIN must be 4 to 6 digits.');
  if (db.prepare('select mpin from users where name=?').get(q.user)?.mpin) { const pc = checkPin(q.user, old); if (pc === 'locked') return bad(r, 'Too many wrong MPIN attempts. Try again in 10 minutes.', 429); if (!pc) return bad(r, 'Your current MPIN is wrong.', 403); }
  db.prepare('update users set mpin=? where name=?').run(bcrypt.hashSync(pin, 10), q.user); pinFails.delete(q.user); r.json({ ok: true });
}));
app.post('/api/security/question', auth, ok((q, r) => {
  const question = String(q.body?.question || ''), an = String(q.body?.answer || '').trim().toLowerCase().slice(0, 60);
  if (!SEC_QS.includes(question)) return bad(r, 'Pick one of the questions.');
  if (an.length < 2) return bad(r, 'Write your answer (at least 2 characters).');
  const row = db.prepare('select sec_q,pass from users where name=?').get(q.user);
  if (row.sec_q && !bcrypt.compareSync(String(q.body?.pass || ''), row.pass)) return bad(r, 'Enter your password to change the security question.', 403);
  db.prepare('update users set sec_q=?, sec_a=? where name=?').run(question, bcrypt.hashSync(an, 10), q.user); r.json({ ok: true });
}));
const BUILD = 'b8-security-xp';
app.get('/api/version', (q, r) => r.json({ build: BUILD, security: true }));
app.get('/api/leaderboard', auth, ok((q, r) => r.json(db.prepare('select name,xp,coins,role from users order by xp desc limit 20').all().map(u => ({ ...u, level: level(u.xp) })))));

// ---------- uploads: profile photos, chat images, voice notes ----------
try { db.exec("alter table users add column avatar text default ''"); } catch {}
for (const a of ["alter table users add column joined int default 0", "alter table users add column avatar_art text default ''", "alter table users add column avatar_mode text default 'photo'"]) { try { db.exec(a); } catch {} }
db.exec('create table if not exists user_photos(id integer primary key, user text, url text, ts int); create index if not exists up_user on user_photos(user)');
try { db.exec("update users set joined = coalesce((select min(ts) from msgs where msgs.user=users.name), " + Date.now() + ") where joined = 0 or joined is null"); } catch {}
for (const x of db.prepare("select name, avatar from users where avatar != ''").all()) { if (!db.prepare('select 1 from user_photos where user=? and url=?').get(x.name, x.avatar)) db.prepare('insert into user_photos(user,url,ts) values(?,?,?)').run(x.name, x.avatar, Date.now()); }
const sniff = b => {
  if (b.length < 12) return null;
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return ['image', 'jpg'];
  if (b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return ['image', 'png'];
  if (b.slice(0, 3).toString() === 'GIF') return ['image', 'gif'];
  if (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') return ['image', 'webp'];
  if (b.slice(0, 4).equals(Buffer.from([0x1A, 0x45, 0xDF, 0xA3]))) return ['voice', 'webm'];
  if (b.slice(0, 4).toString() === 'OggS') return ['voice', 'ogg'];
  if (b.slice(4, 8).toString() === 'ftyp') return ['voice', 'm4a'];
  if (b.slice(0, 3).toString() === 'ID3' || (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0)) return ['voice', 'mp3'];
  if (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WAVE') return ['voice', 'wav'];
  return null;
};
const upHits = new Map();
const MEDIA_URL = /^\/uploads\/[a-f0-9]{32}\.(jpg|png|gif|webp|webm|ogg|m4a|mp3|wav)$/;
app.post('/api/upload', auth, express.raw({ type: () => true, limit: '6mb' }), (q, r) => {
  if (String(q.query.kind || '') === 'mail') return mailUpload(q, r);
  const now = Date.now(), h = (upHits.get(q.user) || []).filter(t => now - t < 600e3);
  if (h.length >= 4 && roleOf(q.user) !== 'staff') return bad(r, 'Upload limit reached: 4 uploads per 10 minutes. Please wait a little.', 429);
  upHits.set(q.user, [...h, now]);
  const kind = String(q.query.kind || '');
  const b = q.body;
  if (!Buffer.isBuffer(b) || !b.length) return bad(r, 'No file received.');
  const t = sniff(b);
  if (!t) return bad(r, 'Unsupported file type.');
  if (kind === 'voice' ? t[0] !== 'voice' : t[0] !== 'image') return bad(r, 'Wrong file type for this upload.');
  if (b.length > (kind === 'voice' ? 3e6 : 5e6)) return bad(r, 'File is too large.', 413);
  const name = crypto.randomBytes(16).toString('hex') + '.' + t[1];
  fs.writeFileSync('uploads/' + name, b);
  const url = '/uploads/' + name;
  if (kind === 'avatar') {
    db.prepare('insert into user_photos(user,url,ts) values(?,?,?)').run(q.user, url, now);
    db.prepare("update users set avatar=?, avatar_mode='photo' where name=?").run(url, q.user);
    const extra = db.prepare('select id,url from user_photos where user=? order by id desc limit -1 offset 12').all(q.user);
    for (const x of extra) { db.prepare('delete from user_photos where id=?').run(x.id); dropFile(x.url); }
  } else if (kind === 'avatar_art') {
    const old = db.prepare('select avatar_art from users where name=?').get(q.user)?.avatar_art;
    db.prepare("update users set avatar_art=?, avatar_mode='avatar' where name=?").run(url, q.user);
    if (old && MEDIA_URL.test(old)) fs.unlink('.' + old, () => {});
  }
  r.json({ url });
});

// ---------- Reels (short vertical videos) ----------
db.exec(`create table if not exists reels(id integer primary key, user text, url text, poster text, caption text, dur int, ts int, views int default 0);
create index if not exists reels_ts on reels(ts);create index if not exists reels_user on reels(user);
create table if not exists reel_likes(reel int, user text, ts int, primary key(reel,user));
create table if not exists reel_views(reel int, user text, primary key(reel,user));
create table if not exists reel_comments(id integer primary key, reel int, user text, text text, ts int);
create index if not exists reel_comments_r on reel_comments(reel);
create table if not exists reel_files(url text primary key, user text, ts int)`);
try { fs.mkdirSync('uploads/reels', { recursive: true }); } catch {}
const REEL_VID = /^\/uploads\/reels\/[a-f0-9]{32}\.(mp4|webm)$/, REEL_POS = /^\/uploads\/reels\/[a-f0-9]{32}\.jpg$/;
const reelHits = new Map(), reelCom = new Map();
const sniffVideo = b => {
  if (!Buffer.isBuffer(b) || b.length < 12) return null;
  if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return 'webm';
  if (b.slice(4, 8).toString() === 'ftyp' && !/^M4[ABP] /.test(b.slice(8, 12).toString())) return 'mp4';
  return null;
};
function reelDrop(id) {
  const x = db.prepare('select url,poster from reels where id=?').get(id);
  if (!x) return;
  db.prepare('delete from reel_likes where reel=?').run(id); db.prepare('delete from reel_views where reel=?').run(id);
  db.prepare('delete from reel_comments where reel=?').run(id); db.prepare('delete from reels where id=?').run(id);
  for (const u of [x.url, x.poster]) if (u && (REEL_VID.test(u) || REEL_POS.test(u))) { db.prepare('delete from reel_files where url=?').run(u); fs.unlink('.' + u, () => {}); }
}
app.post('/api/reels/media', auth, express.raw({ type: () => true, limit: '40mb' }), (q, r) => {
  const kind = String(q.query.kind || ''), b = q.body, now = Date.now();
  if (!Buffer.isBuffer(b) || !b.length) return bad(r, 'No file received.');
  if (kind === 'video') {
    const h = (reelHits.get(q.user) || []).filter(t => now - t < 3600e3);
    if (h.length >= 6 && roleOf(q.user) !== 'staff') return bad(r, 'Upload limit reached: 6 videos per hour. Please wait a little.', 429);
    const ext = sniffVideo(b);
    if (!ext) return bad(r, 'Please choose an MP4 or WebM video.');
    if (b.length > 40e6) return bad(r, 'Video is too large (40 MB max).', 413);
    reelHits.set(q.user, [...h, now]);
    const url = '/uploads/reels/' + crypto.randomBytes(16).toString('hex') + '.' + ext;
    fs.writeFileSync('.' + url, b); db.prepare('insert into reel_files(url,user,ts) values(?,?,?)').run(url, q.user, now);
    return r.json({ url });
  }
  if (kind === 'poster') {
    if (!(b.length > 12 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF)) return bad(r, 'Poster must be a JPEG image.');
    if (b.length > 800e3) return bad(r, 'Poster is too large.', 413);
    const url = '/uploads/reels/' + crypto.randomBytes(16).toString('hex') + '.jpg';
    fs.writeFileSync('.' + url, b); db.prepare('insert into reel_files(url,user,ts) values(?,?,?)').run(url, q.user, now);
    return r.json({ url });
  }
  bad(r, 'Unknown upload kind.');
});
app.post('/api/reels', auth, ok((q, r) => {
  const url = String(q.body?.url || ''), poster = String(q.body?.poster || ''), caption = String(q.body?.caption || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const dur = Math.max(1, Math.round(Number(q.body?.dur) || 0));
  if (dur > 16) return bad(r, 'Reels can be up to 15 seconds.');
  if (!REEL_VID.test(url)) return bad(r, 'Invalid video.');
  const f = db.prepare('select user from reel_files where url=?').get(url);
  if (!f || f.user !== q.user) return bad(r, 'Upload the video first.');
  if (db.prepare('select 1 from reels where url=?').get(url)) return bad(r, 'This video is already posted.');
  let pos = '';
  if (poster) { const pf = REEL_POS.test(poster) && db.prepare('select user from reel_files where url=?').get(poster); if (pf && pf.user === q.user) pos = poster; }
  if (db.prepare('select count(*) c from reels where user=? and ts>?').get(q.user, Date.now() - 864e5).c >= 15) return bad(r, 'You can post up to 15 reels a day.', 429);
  const id = db.prepare('insert into reels(user,url,poster,caption,dur,ts) values(?,?,?,?,?,?)').run(q.user, url, pos, caption, dur, Date.now()).lastInsertRowid;
  addXp(q.user, 3); r.json({ id: Number(id) });
}));
app.get('/api/reels', auth, ok((q, r) => {
  const lim = Math.max(1, Math.min(20, parseInt(q.query.limit, 10) || 8)), before = parseInt(q.query.before, 10) || 0, one = parseInt(q.query.id, 10) || 0, who = String(q.query.user || '').slice(0, 40);
  const rows = db.prepare(`select r.id,r.user,r.url,r.poster,r.caption,r.dur,r.ts,r.views,
      (select count(*) from reel_likes where reel=r.id) likes, (select count(*) from reel_comments where reel=r.id) comments,
      exists(select 1 from reel_likes where reel=r.id and user=@me) liked
    from reels r where (@before=0 or r.id<@before) and (@one=0 or r.id=@one) and (@who='' or r.user=@who)
      and r.user not in (select case when a=@me then b else a end from blocks where a=@me or b=@me)
    order by r.id desc limit @lim`).all({ me: q.user, before, one, who, lim });
  r.json(rows.map(x => ({ ...x, liked: !!x.liked, role: roleOf(x.user), mine: x.user === q.user, fs: x.user === q.user ? 'me' : fstate(q.user, x.user) })));
}));
app.post('/api/reels/:id/view', auth, ok((q, r) => {
  const id = parseInt(q.params.id, 10), x = db.prepare('select user from reels where id=?').get(id);
  if (x && x.user !== q.user && db.prepare('insert or ignore into reel_views(reel,user) values(?,?)').run(id, q.user).changes) db.prepare('update reels set views=views+1 where id=?').run(id);
  r.json({ ok: true });
}));
app.post('/api/reels/:id/like', auth, ok((q, r) => {
  const id = parseInt(q.params.id, 10), x = db.prepare('select user from reels where id=?').get(id);
  if (!x) return bad(r, 'Reel not found', 404);
  let liked;
  if (db.prepare('select 1 from reel_likes where reel=? and user=?').get(id, q.user)) { db.prepare('delete from reel_likes where reel=? and user=?').run(id, q.user); liked = false; }
  else { db.prepare('insert into reel_likes(reel,user,ts) values(?,?,?)').run(id, q.user, Date.now()); liked = true; if (x.user !== q.user) notify(x.user, 'social', `${q.user} liked your reel`, 'reel:' + id); }
  r.json({ liked, likes: db.prepare('select count(*) c from reel_likes where reel=?').get(id).c });
}));
app.get('/api/reels/:id/comments', auth, ok((q, r) => {
  const id = parseInt(q.params.id, 10);
  r.json(db.prepare('select id,user,text,ts from reel_comments where reel=? order by id desc limit 100').all(id).reverse().map(c => ({ ...c, role: roleOf(c.user) })));
}));
app.post('/api/reels/:id/comments', auth, ok((q, r) => {
  const id = parseInt(q.params.id, 10), x = db.prepare('select user from reels where id=?').get(id), text = String(q.body?.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!x) return bad(r, 'Reel not found', 404);
  if (!text) return bad(r, 'Write a comment first');
  if (isBlocked(q.user, x.user)) return bad(r, 'You cannot comment here.', 403);
  if (Date.now() - (reelCom.get(q.user) || 0) < 2000) return bad(r, 'Please slow down a little.', 429);
  reelCom.set(q.user, Date.now());
  db.prepare('insert into reel_comments(reel,user,text,ts) values(?,?,?,?)').run(id, q.user, text, Date.now());
  if (x.user !== q.user) notify(x.user, 'social', `${q.user} commented on your reel`, 'reel:' + id);
  r.json({ ok: true, comments: db.prepare('select count(*) c from reel_comments where reel=?').get(id).c });
}));
app.delete('/api/reels/:id/comments/:cid', auth, ok((q, r) => {
  const id = parseInt(q.params.id, 10), c = db.prepare('select user from reel_comments where id=? and reel=?').get(parseInt(q.params.cid, 10), id), x = db.prepare('select user from reels where id=?').get(id);
  if (!c) return bad(r, 'Comment not found', 404);
  if (c.user !== q.user && !(x && x.user === q.user) && !isMod(q.user)) return bad(r, 'You cannot delete this comment', 403);
  db.prepare('delete from reel_comments where id=?').run(parseInt(q.params.cid, 10)); r.json({ ok: true });
}));
app.delete('/api/reels/:id', auth, ok((q, r) => {
  const id = parseInt(q.params.id, 10), x = db.prepare('select user from reels where id=?').get(id);
  if (!x) return bad(r, 'Reel not found', 404);
  if (x.user !== q.user && !isMod(q.user)) return bad(r, 'You cannot delete this reel', 403);
  reelDrop(id); r.json({ ok: true });
}));

// ---------- Mail (user to user, with JPG / PNG / PDF attachments) ----------
db.exec(`create table if not exists mails(id integer primary key, from_user text, to_user text, subject text, body text, ts int, read int default 0, del_from int default 0, del_to int default 0);
create index if not exists mails_to on mails(to_user, ts);create index if not exists mails_from on mails(from_user, ts);
create table if not exists mail_files(url text primary key, user text, name text, size int, mail int default 0, ts int)`);
const MAIL_URL = /^\/uploads\/[a-f0-9]{32}\.(jpg|png|pdf)$/;
const mailHits = new Map(), mailUp = new Map();
const mailType = b => b.length < 12 ? null : (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) ? 'jpg' : b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) ? 'png' : b.slice(0, 5).toString() === '%PDF-' ? 'pdf' : null;
function mailUpload(q, r) {
  const now = Date.now(), h = (mailUp.get(q.user) || []).filter(t => now - t < 600e3);
  if (h.length >= 12) return bad(r, 'Too many attachments. Please wait a few minutes.', 429);
  const b = q.body;
  if (!Buffer.isBuffer(b) || !b.length) return bad(r, 'No file received.');
  const t = mailType(b);
  if (!t) return bad(r, 'Only JPG, PNG and PDF files can be attached.');
  if (b.length > 5e6) return bad(r, 'File is too large (max 5 MB).', 413);
  mailUp.set(q.user, [...h, now]);
  const url = '/uploads/' + crypto.randomBytes(16).toString('hex') + '.' + t;
  const name = (String(q.query.name || 'file').replace(/[^\w .()\-]/g, '_').slice(0, 60) || 'file').replace(/\.(jpe?g|png|pdf)$/i, '') + '.' + t;
  fs.writeFileSync('.' + url, b);
  db.prepare('insert into mail_files(url,user,name,size,ts) values(?,?,?,?,?)').run(url, q.user, name, b.length, now);
  r.json({ url, name, size: b.length, type: t });
}
const mailUnread = n => db.prepare('select count(*) c from mails where to_user=? and read=0 and del_to=0').get(n).c;
const mailAtts = id => db.prepare('select url,name,size from mail_files where mail=?').all(id).map(a => ({ ...a, type: a.url.split('.').pop() }));
app.get('/api/mail/unread', auth, ok((q, r) => r.json({ n: mailUnread(q.user) })));
app.get('/api/mail', auth, ok((q, r) => {
  const box = ['inbox', 'unread', 'sent'].includes(q.query.box) ? q.query.box : 'inbox';
  const rows = box === 'sent'
    ? db.prepare('select id,from_user,to_user,subject,substr(body,1,120) pv,ts,read from mails where from_user=? and del_from=0 order by id desc limit 100').all(q.user)
    : db.prepare(`select id,from_user,to_user,subject,substr(body,1,120) pv,ts,read from mails where to_user=? and del_to=0 ${box === 'unread' ? 'and read=0' : ''} order by id desc limit 100`).all(q.user);
  r.json({ box, unread: mailUnread(q.user), items: rows.map(m => ({ ...m, att: db.prepare('select count(*) c from mail_files where mail=?').get(m.id).c })) });
}));
app.get('/api/mail/:id', auth, ok((q, r) => {
  const m = db.prepare('select * from mails where id=?').get(+q.params.id);
  if (!m || !((m.to_user === q.user && !m.del_to) || (m.from_user === q.user && !m.del_from))) return bad(r, 'Mail not found', 404);
  if (m.to_user === q.user && !m.read) { db.prepare('update mails set read=1 where id=?').run(m.id); m.read = 1; }
  r.json({ ...m, atts: mailAtts(m.id), unread: mailUnread(q.user) });
}));
app.post('/api/mail', auth, ok((q, r) => {
  const b = q.body || {}, to = String(b.to || '').trim().replace(/^@/, '');
  const dest = db.prepare('select name,banned from users where lower(name)=lower(?)').get(to);
  if (!dest || dest.banned) return bad(r, 'No user with that name.');
  if (dest.name === q.user) return bad(r, "You can't send mail to yourself.");
  if (isBlocked(q.user, dest.name)) return bad(r, "You can't send mail to this user.", 403);
  const subject = String(b.subject || '').trim().slice(0, 100) || '(no subject)', body = String(b.body || '').trim().slice(0, 5000);
  const urls = [...new Set(Array.isArray(b.atts) ? b.atts.map(String) : [])].slice(0, 3);
  if (!body && !urls.length) return bad(r, 'Write a message or attach a file.');
  for (const u of urls) if (!MAIL_URL.test(u) || !db.prepare('select 1 from mail_files where url=? and user=? and mail=0').get(u, q.user)) return bad(r, 'An attachment is no longer available. Please attach it again.');
  const now = Date.now(), h = (mailHits.get(q.user) || []).filter(t => now - t < 3600e3);
  if (h.length >= 30 && roleOf(q.user) !== 'staff') return bad(r, 'Mail limit reached: 30 per hour. Please wait a little.', 429);
  mailHits.set(q.user, [...h, now]);
  const id = db.prepare('insert into mails(from_user,to_user,subject,body,ts) values(?,?,?,?,?)').run(q.user, dest.name, subject, body, now).lastInsertRowid;
  for (const u of urls) db.prepare('update mail_files set mail=? where url=?').run(id, u);
  wss.clients.forEach(w => w.user === dest.name && send(w, { t: 'mail', id, from: q.user, subject, n: mailUnread(dest.name) }));
  r.json({ ok: true, id });
}));
app.delete('/api/mail/:id', auth, ok((q, r) => {
  const m = db.prepare('select * from mails where id=?').get(+q.params.id);
  if (!m) return r.json({ ok: true });
  if (m.to_user === q.user) db.prepare('update mails set del_to=1 where id=?').run(m.id);
  else if (m.from_user === q.user) db.prepare('update mails set del_from=1 where id=?').run(m.id);
  else return bad(r, 'Mail not found', 404);
  const x = db.prepare('select * from mails where id=?').get(m.id);
  if (x.del_to && x.del_from) { for (const f of db.prepare('select url from mail_files where mail=?').all(m.id)) fs.unlink('.' + f.url, () => {}); db.prepare('delete from mail_files where mail=?').run(m.id); db.prepare('delete from mails where id=?').run(m.id); }
  r.json({ ok: true, unread: mailUnread(q.user) });
}));
// uploaded but never sent attachments are cleaned up after a day
setInterval(() => { try { for (const f of db.prepare('select url from mail_files where mail=0 and ts<?').all(Date.now() - 864e5)) { fs.unlink('.' + f.url, () => {}); db.prepare('delete from mail_files where url=?').run(f.url); } } catch {} }, 3600e3).unref();
// ---- support@migv33.com mailbox (Admin Panel) ----
db.exec(`create table if not exists support_mail(id integer primary key autoincrement, dir text, mid text, from_addr text, to_addr text, subject text, body text, ts int, read int default 0)`);
db.exec(`create unique index if not exists support_mid on support_mail(mid) where mid is not null`);
const SUP = {
  user: process.env.SUPPORT_USER || 'support@migv33.com',
  pass: process.env.SUPPORT_PASS || (process.env.SMTP_USER === (process.env.SUPPORT_USER || 'support@migv33.com') ? process.env.SMTP_PASS : ''),
  smtp: process.env.SUPPORT_SMTP_HOST || 'smtp.hostinger.com', smtpPort: +(process.env.SUPPORT_SMTP_PORT || 465),
  imap: process.env.SUPPORT_IMAP_HOST || 'imap.hostinger.com', imapPort: +(process.env.SUPPORT_IMAP_PORT || 993),
};
const supMailer = SUP.pass ? nodemailer.createTransport({ host: SUP.smtp, port: SUP.smtpPort, secure: SUP.smtpPort === 465, auth: { user: SUP.user, pass: SUP.pass } }) : null;
let ImapFlow = null, simpleParser = null;
try { ({ ImapFlow } = await import('imapflow')); ({ simpleParser } = await import('mailparser')); } catch { /* run: npm install */ }
const supState = { last: 0, err: '', busy: false };
const htmlText = h => String(h || '').replace(/<(style|script)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, '\n\n').trim();
async function supSync() {
  if (!ImapFlow || !SUP.pass || supState.busy) return;
  supState.busy = true;
  const c = new ImapFlow({ host: SUP.imap, port: SUP.imapPort, secure: true, auth: { user: SUP.user, pass: SUP.pass }, logger: false });
  c.on('error', () => {});
  try {
    await c.connect();
    const lock = await c.getMailboxLock('INBOX');
    try {
      const total = c.mailbox.exists;
      if (total) {
        const from = Math.max(1, total - 49);
        for await (const m of c.fetch(`${from}:*`, { source: true, uid: true })) {
          try {
            const p = await simpleParser(m.source);
            const mid = p.messageId || `uid-${m.uid}`;
            if (db.prepare('select 1 from support_mail where mid=?').get(mid)) continue;
            const body = (p.text || htmlText(p.html) || '').slice(0, 20000);
            const att = (p.attachments || []).map(a => a.filename || 'file').join(', ');
            db.prepare('insert into support_mail(dir,mid,from_addr,to_addr,subject,body,ts) values(?,?,?,?,?,?,?)')
              .run('in', mid, (p.from?.text || '').slice(0, 200), SUP.user, (p.subject || '(no subject)').slice(0, 300), body + (att ? `\n\n[Attachments not shown here: ${att}]` : ''), +new Date(p.date || Date.now()));
          } catch (e) { console.log('[support] parse failed', e.message); }
        }
      }
    } finally { lock.release(); }
    await c.logout();
    supState.err = '';
  } catch (e) {
    supState.err = e.authenticationFailed ? 'Mailbox login failed: SUPPORT_PASS in /opt/migv33/.env is wrong or outdated (use the mailbox\'s current password, then restart the service).'
      : [e.responseText || e.message || 'IMAP error', e.code, e.serverResponseCode].filter(Boolean).join(' · ');
    console.log('[support] sync failed:', supState.err, e.response || '');
    try { c.close(); } catch {}
  }
  supState.last = Date.now(); supState.busy = false;
}
setInterval(() => supSync().catch(() => {}), 120000);
setTimeout(() => supSync().catch(() => {}), 8000);
const supUnread = () => db.prepare("select count(*) n from support_mail where dir='in' and read=0").get().n;
app.get('/api/admin/support', auth, ok((q, r) => {
  if (!staffChk(q, r)) return;
  const box = q.query.box === 'out' ? 'out' : 'in';
  r.json({ box, unread: supUnread(), address: SUP.user, canSend: !!supMailer, canReceive: !!(ImapFlow && SUP.pass), err: supState.err, last: supState.last,
    list: db.prepare('select id,from_addr,to_addr,subject,substr(body,1,120) snip,ts,read from support_mail where dir=? order by ts desc limit 200').all(box) });
}));
app.post('/api/admin/support/sync', auth, ok(async (q, r) => {
  if (!staffChk(q, r)) return;
  if (!SUP.pass) return bad(r, 'Support mailbox password is not set on the server (SUPPORT_PASS)');
  if (!ImapFlow) return bad(r, 'Run "npm install" on the server (imapflow and mailparser are needed to receive mail)');
  await supSync();
  r.json({ ok: true, unread: supUnread(), err: supState.err });
}));
app.get('/api/admin/support/:id', auth, ok((q, r) => {
  if (!staffChk(q, r)) return;
  const m = db.prepare('select * from support_mail where id=?').get(+q.params.id);
  if (!m) return bad(r, 'Not found', 404);
  if (!m.read) db.prepare('update support_mail set read=1 where id=?').run(m.id);
  r.json(m);
}));
app.post('/api/admin/support/send', auth, ok(async (q, r) => {
  if (!staffChk(q, r)) return;
  if (!supMailer) return bad(r, 'Support mailbox password is not set on the server (SUPPORT_PASS)');
  const to = String(q.body.to || '').trim(), subject = String(q.body.subject || '').trim().slice(0, 300), text = String(q.body.body || '').slice(0, 20000);
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(to)) return bad(r, 'Enter one valid email address');
  if (!subject) return bad(r, 'Write a subject');
  if (!text.trim()) return bad(r, 'Write a message');
  try { await supMailer.sendMail({ from: `"Migv33 Support" <${SUP.user}>`, to, subject, text }); }
  catch (e) { return bad(r, 'Could not send: ' + (e.message || 'SMTP error'), 502); }
  db.prepare('insert into support_mail(dir,from_addr,to_addr,subject,body,ts,read) values(?,?,?,?,?,?,1)').run('out', SUP.user, to, subject, text, Date.now());
  r.json({ ok: true });
}));
app.delete('/api/admin/support/:id', auth, ok((q, r) => {
  if (!staffChk(q, r)) return;
  db.prepare('delete from support_mail where id=?').run(+q.params.id); r.json({ ok: true });
}));
// ---- custom emoticons (Admin Panel -> Manage emoticons) ----
db.exec('create table if not exists custom_emo(name text primary key, code text, icon text, active int default 1, ts int)');
const EMO_BUILTIN = ['like'];
// first start: load the emoticon pictures that came with the project (emoticons.json) into the manager, once
db.exec('create table if not exists emo_seeded(k text primary key)');
try {
  if (fs.existsSync('emoticons.json')) {
    const all = JSON.parse(fs.readFileSync('emoticons.json', 'utf8'));
    for (const batch of [...new Set(all.map(e => e.batch || 1))].sort()) {
      const key = 'v' + batch;
      if (db.prepare('select 1 from emo_seeded where k=?').get(key)) continue;
      for (const e of all.filter(x => (x.batch || 1) === batch)) {
        if (db.prepare('select 1 from custom_emo where name=?').get(e.name)) continue;
        const buf = Buffer.from(e.png || e.gif, 'base64'), nm = crypto.randomBytes(16).toString('hex') + (e.png ? '.png' : '.gif');
        fs.mkdirSync('uploads', { recursive: true }); fs.writeFileSync('uploads/' + nm, buf);
        db.prepare('insert into custom_emo(name,code,icon,active,ts) values(?,?,?,1,?)').run(e.name, e.code && !db.prepare('select 1 from custom_emo where code=?').get(e.code) ? e.code : null, '/uploads/' + nm, Date.now());
      }
      db.prepare('insert into emo_seeded(k) values(?)').run(key);
    }
  }
  // one-time upgrade: swap the original 16px pictures for the sharp 96px versions (only if the picture was never replaced by staff)
  if (fs.existsSync('emoticons.json') && !db.prepare("select 1 from emo_seeded where k='hd1'").get()) {
    for (const e of JSON.parse(fs.readFileSync('emoticons.json', 'utf8'))) {
      if (!e.png) continue;
      const row = db.prepare('select icon from custom_emo where name=?').get(e.name);
      if (!row || !/^\/uploads\/[a-f0-9]{32}\.gif$/.test(row.icon || '')) continue;
      try {
        if (!fs.readFileSync('.' + row.icon).equals(Buffer.from(e.gif, 'base64'))) continue;
        const nm = crypto.randomBytes(16).toString('hex') + '.png';
        fs.writeFileSync('uploads/' + nm, Buffer.from(e.png, 'base64'));
        db.prepare('update custom_emo set icon=? where name=?').run('/uploads/' + nm, e.name);
        try { fs.unlinkSync('.' + row.icon); } catch {}
      } catch {}
    }
    db.prepare("insert into emo_seeded(k) values('hd1')").run();
  }
} catch (e) { console.log('[emoticons seed]', e.message); }
const emoList = () => db.prepare('select name,code,icon from custom_emo where active=1 order by ts').all();
const bcastEmo = () => wss.clients.forEach(w => w.user && send(w, { t: 'emos', list: emoList() }));
app.get('/api/emoticons', auth, ok((q, r) => r.json(emoList())));
app.get('/api/calls', auth, ok((q, r) => r.json(db.prepare('select id,a,b,kind,status,dur,ts from call_log where a=? or b=? order by id desc limit 60').all(q.user, q.user).map(x => ({ id: x.id, peer: x.a === q.user ? x.b : x.a, dir: x.a === q.user ? 'out' : 'in', kind: x.kind, status: x.status, dur: x.dur, ts: x.ts })))));
app.delete('/api/calls', auth, ok((q, r) => { db.prepare('delete from call_log where a=? or b=?').run(q.user, q.user); r.json({ ok: true }); }));
// ICE servers for audio/video calls. STUN is always on; set TURN_URL (comma separated), TURN_USER and TURN_PASS to relay calls on networks that block direct connections.
app.get('/api/ice', auth, ok((q, r) => {
  const iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (process.env.TURN_URL) iceServers.push({ urls: process.env.TURN_URL.split(',').map(x => x.trim()).filter(Boolean), username: process.env.TURN_USER || '', credential: process.env.TURN_PASS || '' });
  else iceServers.push({ urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turns:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' });   // free public relay, used only when you have not set a TURN server of your own
  r.json({ iceServers });
}));
app.get('/api/admin/emoticons', auth, ok((q, r) => { if (!staffOnly(q, r)) return; r.json(db.prepare('select name,code,icon,active from custom_emo order by ts').all()); }));
app.post('/api/admin/emoticons', auth, ok((q, r) => {
  if (!staffOnly(q, r)) return;
  const b = q.body || {}, name = String(b.name || '').trim().toLowerCase(), code = String(b.code || '').trim();
  if (!/^[a-z0-9]{2,12}$/.test(name)) return bad(r, 'Name: 2 to 12 English letters or numbers.');
  if (EMO_BUILTIN.includes(name) || db.prepare('select 1 from custom_emo where name=?').get(name)) return bad(r, 'This emoticon name is already used.', 409);
  if (code && !/^[^\s<>&"']{2,8}$/.test(code) && !/^:'\(|:'\)$/.test(code)) return bad(r, 'Shortcode: 2 to 8 characters, no spaces.');
  if (code && db.prepare('select 1 from custom_emo where code=?').get(code)) return bad(r, 'This shortcode is already used.', 409);
  if (!imgUrl(b.icon)) return bad(r, 'Upload the emoticon picture first.');
  db.prepare('insert into custom_emo(name,code,icon,active,ts) values(?,?,?,1,?)').run(name, code || null, b.icon, Date.now());
  alog(q.user, name, 'emo_create', code || ''); bcastEmo(); r.json({ ok: true });
}));
app.post('/api/admin/emoticons/:n', auth, ok((q, r) => {
  if (!staffOnly(q, r)) return;
  if (!db.prepare('select 1 from custom_emo where name=?').get(q.params.n)) return bad(r, 'Not found', 404);
  db.prepare('update custom_emo set active=? where name=?').run(q.body?.active ? 1 : 0, q.params.n); bcastEmo(); r.json({ ok: true });
}));
app.delete('/api/admin/emoticons/:n', auth, ok((q, r) => {
  if (!staffOnly(q, r)) return;
  db.prepare('delete from custom_emo where name=?').run(q.params.n); alog(q.user, q.params.n, 'emo_delete', ''); bcastEmo(); r.json({ ok: true });
}));
const reactKind = k => REACTS.includes(k) ? k : (typeof k === 'string' && k.startsWith('e:') && db.prepare('select 1 from custom_emo where name=? and active=1').get(k.slice(2))) ? k : 'like';
app.delete('/api/me/avatar', auth, (q, r) => {
  const old = db.prepare('select avatar from users where name=?').get(q.user)?.avatar;
  db.prepare("update users set avatar='' where name=?").run(q.user);
  r.json({ ok: true });
});
app.get('/api/avatars', auth, (q, r) => r.json(Object.fromEntries(db.prepare("select name, avatar, avatar_art, avatar_mode from users where avatar != '' or avatar_art != ''").all().map(u => [u.name, u.avatar_mode === 'avatar' && u.avatar_art ? u.avatar_art : (u.avatar || u.avatar_art)]).filter(x => x[1]))));
const myAv = n => { const u = db.prepare('select avatar,avatar_art,avatar_mode from users where name=?').get(n); return u.avatar_mode === 'avatar' && u.avatar_art ? u.avatar_art : (u.avatar || ''); };
app.get('/api/me/photos', auth, ok((q, r) => {
  const u = db.prepare('select avatar,avatar_art,avatar_mode from users where name=?').get(q.user);
  r.json({ photos: db.prepare('select id,url,ts from user_photos where user=? order by id desc').all(q.user), current: u.avatar, art: u.avatar_art, mode: u.avatar_mode === 'avatar' && u.avatar_art ? 'avatar' : 'photo', shown: myAv(q.user) });
}));
app.post('/api/me/avatar-mode', auth, ok((q, r) => {
  const m = q.body?.mode === 'avatar' ? 'avatar' : 'photo';
  const u = db.prepare('select avatar,avatar_art from users where name=?').get(q.user);
  if (m === 'avatar' && !u.avatar_art) return bad(r, 'Create an avatar first.');
  if (m === 'photo' && !u.avatar) return bad(r, 'Upload a profile photo first.');
  db.prepare('update users set avatar_mode=? where name=?').run(m, q.user); r.json({ ok: true, shown: myAv(q.user) });
}));
app.post('/api/me/photos/:id/use', auth, ok((q, r) => {
  const p = db.prepare('select url from user_photos where id=? and user=?').get(q.params.id, q.user); if (!p) return bad(r, 'Photo not found', 404);
  db.prepare("update users set avatar=?, avatar_mode='photo' where name=?").run(p.url, q.user); r.json({ ok: true, shown: p.url });
}));
app.delete('/api/me/photos/:id', auth, ok((q, r) => {
  const p = db.prepare('select url from user_photos where id=? and user=?').get(q.params.id, q.user); if (!p) return bad(r, 'Photo not found', 404);
  db.prepare('delete from user_photos where id=?').run(q.params.id);
  const cur = db.prepare('select avatar from users where name=?').get(q.user).avatar;
  if (cur === p.url) db.prepare("update users set avatar='', avatar_mode='avatar' where name=?").run(q.user);
  if (!db.prepare('select 1 from users where avatar_art=? and name=?').get(p.url, q.user)) dropFile(p.url);
  const u = db.prepare('select avatar_art,avatar_mode from users where name=?').get(q.user);
  if (!u.avatar_art) db.prepare("update users set avatar_mode='photo' where name=?").run(q.user);
  r.json({ ok: true, shown: myAv(q.user) });
}));

const server = http.createServer(app);
// ---------- Peoples page ----------
app.get('/api/people', auth, ok((q, r) => {
  const rows = w => db.prepare(`select name,role,xp from users where banned=0 and ${w} order by xp desc, name`).all().map(u => ({ name: u.name, role: u.role, level: level(u.xp) }));
  const G = (k, title, w) => { const list = rows(w); return { k, title, count: list.length, list }; };
  const top = db.prepare("select name,role,xp from users where banned=0 and role not in ('staff','admin') and lower(name)!=? order by xp desc, name").all(STAFF_USER).map(u => ({ name: u.name, role: u.role, level: level(u.xp) }));
  r.json([G('staff', 'Staff', "role='staff'"), G('admin', 'Admins', "role='admin'"), G('headmentor', 'Head Mentors', "role='headmentor'"), G('mentor', 'Mentors', "role='mentor'"),
    G('merchant', 'Merchants', "role='merchant'"), G('vip', 'VIP User', 'vip=1'), G('verified', 'Verified', 'verified=1'), { k: 'top', title: 'All Users', count: top.length, list: top }]);
}));

// ---------- Contests ----------
// Anyone with enough coins can create one: the whole prize pool is reserved at once. Staff/admin approve it; unawarded places go back to the creator.
db.exec(`create table if not exists contests(id integer primary key, owner text, name text, descr text default '', banner text default '', room text, ctype text, ranking text, ref text default '', minw int default 0, maxw int default 0,
  scope text default 'all', countries text default '[]', starts int, ends int, prizes text, pool int, status text default 'pending', decided_by text default '', reason text default '', created int, settled int default 0);
create table if not exists contest_scores(cid int, user text, score int default 0, primary key(cid,user))`);
const CT_MIN_DAY = 100000, CT_MAX_DAYS = 30, CT_MAX_PLACES = 10, DAY = 86400e3;
const CT_GAMES = { lowcard: 'LowCard', cricket: 'Cricket', dice: 'Dice', tp: 'Teen Patti', royale: 'Royale Battle' };
const ctMin = (s, e) => CT_MIN_DAY * Math.max(1, Math.ceil((e - s) / DAY));
const ctView = c => ({ id: c.id, owner: c.owner, name: c.name, descr: c.descr, banner: c.banner, room: c.room, ctype: c.ctype, ranking: c.ranking, ref: c.ref, minw: c.minw, maxw: c.maxw, scope: c.scope,
  countries: JSON.parse(c.countries || '[]'), starts: c.starts, ends: c.ends, prizes: JSON.parse(c.prizes || '[]'), pool: c.pool, status: c.status, reason: c.reason, decided_by: c.decided_by, created: c.created });
function ctRefund(c, status, by = '', reason = '') {
  db.transaction(() => {
    if (!db.prepare("update contests set status=?, decided_by=?, reason=?, settled=1 where id=? and settled=0").run(status, by, reason, c.id).changes) return;
    db.prepare('update users set coins=coins+? where name=?').run(c.pool, c.owner); addTx(c.owner, 'other', `Contest "${c.name}": prize pool returned`, c.pool);
  })(); pushCoins(c.owner);
}
function ctSettle(c) {
  const prizes = JSON.parse(c.prizes || '[]');
  const top = db.prepare('select user,score from contest_scores where cid=? and score>0 order by score desc, user limit ?').all(c.id, prizes.length);
  let paid = 0; const names = [c.owner];
  db.transaction(() => {
    if (!db.prepare("update contests set status='ended', settled=1 where id=? and settled=0").run(c.id).changes) return;
    top.forEach((t, i) => { db.prepare('update users set coins=coins+? where name=?').run(prizes[i], t.user); addTx(t.user, 'other', `Contest "${c.name}": place ${i + 1} prize`, prizes[i]); paid += prizes[i]; names.push(t.user); setImmediate(() => notify(t.user, 'rewards', `You won ${prizes[i].toLocaleString()} coins in "${c.name}" (place ${i + 1})`, 'contest:' + c.id)); });
    if (c.pool - paid > 0) { db.prepare('update users set coins=coins+? where name=?').run(c.pool - paid, c.owner); addTx(c.owner, 'other', `Contest "${c.name}": unawarded prizes returned`, c.pool - paid); }
  })(); pushCoins(...names);
}
function contestTick() {
  const now = Date.now();
  for (const c of db.prepare("select * from contests where settled=0 and status='pending' and ends<=?").all(now)) ctRefund(c, 'expired', '', 'Not approved before it ended');
  for (const c of db.prepare("select * from contests where settled=0 and status='approved' and ends<=?").all(now)) ctSettle(c);
}
setInterval(() => { try { contestTick(); } catch (e) { console.log('[contest]', e.message); } }, 30e3).unref();
function contestScore(room, kind, user, o = {}) {
  const now = Date.now();
  const rows = db.prepare("select * from contests where status='approved' and room=? and ctype=? and starts<=? and ends>?").all(room, kind, now, now);
  if (!rows.length) return;
  const country = db.prepare('select country from users where name=?').get(user)?.country || '';
  for (const c of rows) {
    if (c.owner === user) continue;
    if (c.scope === 'countries' && !JSON.parse(c.countries || '[]').includes(country)) continue;
    let pts = 0;
    if (kind === 'gift') { if (c.ref && c.ref !== o.gift) continue; pts = c.ranking === 'count' ? 1 : (o.amount || 0); }
    else { if (c.ref && c.ref !== o.game) continue; if (c.minw && (o.amount || 0) < c.minw) continue; if (c.maxw && (o.amount || 0) > c.maxw) continue; pts = c.ranking === 'earned' ? (o.won || 0) : 1; }
    if (pts > 0) db.prepare('insert into contest_scores(cid,user,score) values(?,?,?) on conflict(cid,user) do update set score=score+excluded.score').run(c.id, user, pts);
  }
}
app.get('/api/contests/options', auth, ok((q, r) => r.json({ minPerDay: CT_MIN_DAY, maxDays: CT_MAX_DAYS, maxPlaces: CT_MAX_PLACES, games: CT_GAMES, countries: COUNTRIES,
  gifts: Object.entries(allGifts()).map(([k, g]) => ({ k, n: g.n })), rooms: db.prepare("select name from rooms order by name").all().map(x => x.name), isMod: isMod(q.user) })));
app.get('/api/contests', auth, ok((q, r) => {
  const now = Date.now(), tab = String(q.query.tab || 'active'), me = q.user;
  const W = { active: ['status=\'approved\' and starts<=? and ends>? order by ends', [now, now]], upcoming: ['status=\'approved\' and starts>? order by starts', [now]], ended: ["status='ended' order by ends desc", []],
    mine: ['owner=? order by id desc', [me]], pending: ["status='pending' order by id", []] }[tab];
  if (!W) return bad(r, 'Unknown tab');
  if (tab === 'pending' && !isMod(me)) return bad(r, 'Only staff or admin can see pending contests', 403);
  const list = db.prepare(`select * from contests where ${W[0]} limit 60`).all(...W[1]).map(ctView);
  r.json(list.map(c => ({ ...c, mineScore: db.prepare('select score from contest_scores where cid=? and user=?').get(c.id, me)?.score || 0 })));
}));
app.get('/api/contests/:id', auth, ok((q, r) => {
  const c = db.prepare('select * from contests where id=?').get(+q.params.id); if (!c) return bad(r, 'Contest not found', 404);
  if (c.status === 'pending' && c.owner !== q.user && !isMod(q.user)) return bad(r, 'Contest not found', 404);
  const board = db.prepare('select user,score from contest_scores where cid=? and score>0 order by score desc, user limit 50').all(c.id);
  const players = db.prepare('select count(*) n from contest_scores where cid=? and score>0').get(c.id).n;
  const mine = db.prepare('select score from contest_scores where cid=? and user=?').get(c.id, q.user)?.score || 0;
  const myRank = mine > 0 ? db.prepare('select count(*)+1 n from contest_scores where cid=? and (score>? or (score=? and user<?))').get(c.id, mine, mine, q.user).n : 0;
  r.json({ ...ctView(c), board, players, mine, myRank, now: Date.now() });
}));
app.post('/api/contests', auth, ok((q, r) => {
  const b = q.body || {}, me = q.user, now = Date.now();
  const name = String(b.name || '').trim().slice(0, 60); if (name.length < 3) return bad(r, 'Give the contest a name (3+ characters).');
  const descr = String(b.descr || '').trim().slice(0, 500);
  const banner = String(b.banner || ''); if (banner && !/^\/uploads\/[\w./-]+$/.test(banner)) return bad(r, 'Invalid banner');
  if (!db.prepare('select 1 from rooms where name=?').get(b.room)) return bad(r, 'Choose a chatroom.');
  const ctype = b.ctype === 'game' ? 'game' : 'gift';
  const ranking = ctype === 'gift' ? (b.ranking === 'count' ? 'count' : 'spent') : (b.ranking === 'earned' ? 'earned' : 'won');
  let ref = String(b.ref || ''); if (ref && (ctype === 'gift' ? !giftDef0(ref) : !CT_GAMES[ref])) return bad(r, 'Unknown gift or game.');
  const minw = ctype === 'game' ? Math.max(0, Math.floor(+b.minw || 0)) : 0, maxw = ctype === 'game' ? Math.max(0, Math.floor(+b.maxw || 0)) : 0;
  if (minw && maxw && maxw < minw) return bad(r, 'Maximum wager is below the minimum.');
  const scope = b.scope === 'countries' ? 'countries' : 'all';
  const countries = scope === 'countries' ? [...new Set((Array.isArray(b.countries) ? b.countries : []).filter(c => COUNTRIES.includes(c)))].slice(0, 60) : [];
  if (scope === 'countries' && !countries.length) return bad(r, 'Choose at least one country.');
  let starts = Math.floor(+b.starts || 0), ends = Math.floor(+b.ends || 0);
  if (!starts || !ends) return bad(r, 'Set the start and end time.');
  if (starts < now) starts = now;
  if (ends <= starts + 3600e3) return bad(r, 'A contest must run for at least 1 hour.');
  if (ends - starts > CT_MAX_DAYS * DAY) return bad(r, `A contest can run for at most ${CT_MAX_DAYS} days.`);
  const prizes = (Array.isArray(b.prizes) ? b.prizes : []).map(x => Math.floor(+x)).slice(0, CT_MAX_PLACES);
  if (!prizes.length || prizes.some(x => !(x >= 1))) return bad(r, 'Add a prize of at least 1 coin for each place.');
  const pool = prizes.reduce((a, x) => a + x, 0), min = ctMin(starts, ends);
  if (pool < min) return bad(r, `The prize pool must be at least ${min.toLocaleString()} coins for this length.`);
  const info = db.transaction(() => {
    if (!db.prepare('update users set coins=coins-? where name=? and coins>=?').run(pool, me, pool).changes) return null;
    const x = db.prepare('insert into contests(owner,name,descr,banner,room,ctype,ranking,ref,minw,maxw,scope,countries,starts,ends,prizes,pool,created) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(me, name, descr, banner, b.room, ctype, ranking, ref, minw, maxw, scope, JSON.stringify(countries), starts, ends, JSON.stringify(prizes), pool, now);
    addTx(me, 'other', `Contest "${name}": prize pool reserved`, -pool); return x;
  })();
  if (!info) return bad(r, `You need ${pool.toLocaleString()} coins to reserve the prize pool.`);
  pushCoins(me); r.json({ ok: true, id: info.lastInsertRowid });
}));
app.post('/api/contests/:id/cancel', auth, ok((q, r) => {
  const c = db.prepare('select * from contests where id=?').get(+q.params.id); if (!c || c.owner !== q.user) return bad(r, 'Contest not found', 404);
  if (c.settled || !(c.status === 'pending' || (c.status === 'approved' && c.starts > Date.now()))) return bad(r, 'This contest can no longer be cancelled.');
  ctRefund(c, 'cancelled', q.user, 'Cancelled by the creator'); r.json({ ok: true });
}));
app.post('/api/admin/contests/:id', auth, ok((q, r) => {
  if (!isMod(q.user)) return bad(r, 'Only staff or admin can review contests', 403);
  const c = db.prepare('select * from contests where id=?').get(+q.params.id); if (!c) return bad(r, 'Contest not found', 404);
  if (c.status !== 'pending' || c.settled) return bad(r, 'This contest was already reviewed.');
  const act = q.body?.action;
  if (act === 'approve') {
    if (c.ends <= Date.now()) { ctRefund(c, 'expired', q.user, 'Approved too late'); return bad(r, 'It already ended, so the prize pool was returned.'); }
    db.prepare("update contests set status='approved', decided_by=? where id=?").run(q.user, c.id); alog(q.user, c.owner, 'contest', `approved #${c.id} ${c.name}`); notify(c.owner, 'system', `Your contest "${c.name}" was approved`, 'contest:' + c.id); return r.json({ ok: true });
  }
  if (act === 'reject') { const why = String(q.body?.reason || '').trim().slice(0, 200) || 'Not approved'; ctRefund(c, 'rejected', q.user, why); alog(q.user, c.owner, 'contest', `rejected #${c.id} ${c.name}: ${why}`); notify(c.owner, 'system', `Your contest "${c.name}" was rejected: ${why}`, 'contest:' + c.id); return r.json({ ok: true }); }
  bad(r, 'Unknown action');
}));

const wss = new WebSocketServer({ server, path: '/ws' });
const members = new Map(); // room -> Set<ws>
const send = (ws, o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
const cast = (room, o) => {
  members.get(room)?.forEach(w => { if (o.user && w.user !== o.user && isBlocked(o.user, w.user)) return; send(w, o); });
  // people who have this room open as a tab but are looking at another room get the message too (shown as unread)
  if (o.t === 'msg' && ['msg', 'image', 'voice'].includes(o.kind)) wss.clients.forEach(w => { if (w.user && w.user !== o.user && w.room !== room && w.tabs && w.tabs.has(room) && !isBlocked(o.user, w.user)) send(w, { ...o, bg: 1 }); });
  // also tell them when someone enters or leaves a room they keep as a tab
  if (o.t === 'enter' || o.t === 'leave') wss.clients.forEach(w => { if (w.user && w.user !== o.user && w.room !== room && w.tabs && w.tabs.has(room) && !isBlocked(o.user, w.user)) send(w, { ...o, bg: 1 }); });
};
// Live presence: the status the user picked (online / away / busy), but 'offline' once their browser is closed
// (no open connection for 15 seconds; the short grace keeps a quick reconnect from flashing offline).
const goneAt = new Map();
const AWAY_MS = 15 * 60e3;   // minimised / dropped: shown Away this long, then Offline; rooms are kept for one more AWAY_MS
const hasSock = n => [...wss.clients].some(w => w.user === n && !w.emb && w.readyState === 1 && !(w.hiddenAt && Date.now() - w.hiddenAt > AWAY_MS));
const livePres = (n, p) => { if (p === 'offline') return 'offline'; if (hasSock(n)) return p || 'online'; const g = goneAt.get(n); return g && Date.now() - g < AWAY_MS ? (!p || p === 'online' ? 'away' : p) : 'offline'; };
const withPres = u => (u && u.name ? { ...u, presence: livePres(u.name, u.presence) } : u);
const online = () => {
  const l = [...new Set([...wss.clients].filter(w => w.user).map(w => w.user))]
    .map(n => withPres({ name: n, ...db.prepare('select presence,role,xp from users where name=?').get(n) })).filter(u => u.presence !== 'offline');
  wss.clients.forEach(w => send(w, { t: 'online', list: l }));
};
const coins = n => db.prepare('select coins from users where name=?').get(n).coins;
// Normal users are removed from a public room after 30 minutes without chatting (joining or talking restarts the timer). Staff/admins and the room's admin/moderators stay.
const ROOM_STAY_MS = 30 * 60e3;
setInterval(() => {
  const now = Date.now();
  wss.clients.forEach(w => {
    if (!w.room || !w.user || w.room.startsWith('dm:') || !w.roomAt) return;
    const mod = canMod(w.room, w.user); if (w._m && !mod) w.roomAt = now; w._m = mod;   // a moderator who loses the role starts the 30 minutes from that moment
    if (now - w.roomAt < ROOM_STAY_MS) return;
    if (canMod(w.room, w.user)) return;
    const r = w.room; leaveRoom(w); send(w, { t: 'kicked', room: r, by: 'system', auto: true, why: 'idle' });
  });
}, 60e3).unref();
const dropAllRooms = (w, why) => {
  const r0 = w.room, rooms = new Set();
  if (r0 && !r0.startsWith('dm:')) rooms.add(r0);
  if (w.tabs) w.tabs.forEach(x => { if (!x.startsWith('dm:')) rooms.add(x); });
  if (r0 && !r0.startsWith('dm:')) leaveRoom(w);
  w.tabs = new Set();
  for (const t of rooms) {
    if (t === r0 || roomNames(t).has(w.user)) continue;
    try { db.prepare('delete from room_seen where user=? and room=?').run(w.user, t); db.prepare('delete from room_since where user=? and room=?').run(w.user, t); } catch {}
    cast(t, { t: 'leave', room: t, user: w.user, role: roleOf(w.user), xp: xpOf(w.user), ts: Date.now() }); castRoster(t); purgeRoomMsgs(t);
  }
  rooms.forEach(x => send(w, { t: 'kicked', room: x, by: 'system', auto: true, why }));
};
// App minimised with the connection still open: Away at once (client), Offline after 15 min, rooms reset after 30 min hidden in total
setInterval(() => {
  const now = Date.now(), seen = new Set();
  wss.clients.forEach(w => {
    if (!w.user || !w.hiddenAt || w.emb) return;
    const t = now - w.hiddenAt;
    if (t > AWAY_MS && t < AWAY_MS + 61e3 && !seen.has(w.user)) { seen.add(w.user); online(); userRooms(w.user).forEach(castRoster); }
    if (t >= AWAY_MS && !w._bgOut) { w._bgOut = 1; dropAllRooms(w, 'bg'); }   // 15 minutes minimised: out of every room (moderators too); the tabs stay with Rejoin/Leave
    if (t >= 2 * AWAY_MS && !w._bgAll) { w._bgAll = 1; send(w, { t: 'tabsclosed' }); }   // 30 minutes: every room tab is closed
  });
}, 60e3).unref();
// Everyone who is in a room: joined right now OR has the room open as a tab (an open tab means they are still in that room)
const roomNames = room => { const st = new Set([...(members.get(room) || [])].map(w => w.user)); for (const w of wss.clients) if (w.user && w.tabs && w.tabs.has(room)) st.add(w.user); return st; };
const roster = room => [...roomNames(room)].map(n => withPres({ name: n, ...db.prepare('select role,xp,presence from users where name=?').get(n) })).filter(u => u.presence !== 'offline');
const userRooms = n => { const st = new Set(); for (const w of wss.clients) if (w.user === n) { if (w.room) st.add(w.room); if (w.tabs) w.tabs.forEach(x => st.add(x)); } for (const [r0, set] of members) for (const w of set) if (w.user === n) st.add(r0); return [...st].filter(x => x && !x.startsWith('dm:')); };
const castRoster = room => { if (room && !/^dm:/.test(room)) cast(room, { t: 'members', room, list: roster(room) }); };
const leaveRoom = (ws, quiet = false) => {
  const r0 = ws.room; if (!r0) return; members.get(r0)?.delete(ws); ws.room = null;
  if (!quiet && !r0.startsWith('dm:') && ws.user && ![...(members.get(r0) || [])].some(w => w.user === ws.user)) { try { db.prepare('delete from room_seen where user=? and room=?').run(ws.user, r0); db.prepare('delete from room_since where user=? and room=?').run(ws.user, r0); } catch {} } 
  if (!quiet && !r0.startsWith('dm:') && ws.user && ![...(members.get(r0) || [])].some(w => w.user === ws.user)) cast(r0, { t: 'leave', room: r0, user: ws.user, role: roleOf(ws.user), xp: xpOf(ws.user), ts: Date.now() });
  if (!quiet) { try { ws.tabs && ws.tabs.delete(r0); } catch {} }   // really leaving (or timed out): the room is no longer an open tab either
  castRoster(r0);
  if (!quiet) purgeRoomMsgs(r0);
};
// Chat rooms keep no history: when the last person leaves, every text / photo / voice note of that room is deleted
const purgeRoomMsgs = room => {
  if (!room || room.startsWith('dm:') || (members.get(room)?.size || 0) > 0) return;
  try { if (roomNames(room).size > 0) return; } catch {}   // someone who still has the room open as a tab is still in it
  const rows = db.prepare('select text,kind from msgs where room=?').all(room);
  if (!rows.length) return;
  db.prepare('delete from msgs where room=?').run(room);
  for (const x of rows) if (x.kind === 'image' || x.kind === 'voice') { const u = String(x.text).split('|')[0]; if (MEDIA_URL.test(u)) fs.unlink('.' + u, () => {}); }
};
for (const { room } of db.prepare("select distinct room from msgs where room not like 'dm:%'").all()) purgeRoomMsgs(room);   // nobody is in a room right after a restart
// ---------- Teen Patti Gold (Legendary room) — virtual coins, fun only, no cash value ----------
const TP_BOOT = Math.max(1, parseInt(process.env.TP_BOOT || '10', 10));
const isTpRoom = n => gameOf(n) === 'tp';
const pushCoins = (...names) => wss.clients.forEach(w => names.includes(w.user) && send(w, { t: 'coins', coins: coins(w.user) }));
const tpStore = {
  async touch() {},
  async getBalance(id) { return db.prepare('select coins from users where name=?').get(id)?.coins ?? 0; },
  async top(n) { return db.prepare('select name, coins as balance from users order by coins desc limit ?').all(n); },
  async tpDebit({ key, handId, userId, amount }) {
    const run = db.transaction(() => {
      const c = db.prepare('update users set coins=coins-? where name=? and coins>=?').run(amount, userId, amount);
      if (!c.changes) return null;
      db.prepare('insert into tp_pending values(?,?,?,?)').run(key, String(handId), userId, amount);
      const btx = addTx(userId, 'game', 'Teen Patti Gold: bet', -amount); mev(userId, 'game'); roomSpend(key, amount); roomXp(key, 5); commissionOn(userId, amount, 'game', btx.lastInsertRowid);
      return db.prepare('select coins from users where name=?').get(userId).coins;
    });
    const bal = run(); if (bal !== null) pushCoins(userId); return bal;
  },
  async tpSettle({ key, handId, payouts }) {
    db.transaction(() => {
      for (const p of payouts) { db.prepare('update users set coins=coins+? where name=?').run(p.amount, p.userId); if (p.amount > 0) addTx(p.userId, 'game', 'Teen Patti Gold: win', p.amount); }
      db.prepare('delete from tp_pending where room=? and hand=?').run(key, String(handId));
    })();
    pushCoins(...payouts.map(p => p.userId));
  },
  async tpRefund(key) {
    const rows = key === undefined ? db.prepare('select * from tp_pending').all() : db.prepare('select * from tp_pending where room=?').all(key);
    db.transaction(() => {
      for (const b of rows) { db.prepare('update users set coins=coins+? where name=?').run(b.amount, b.user); addTx(b.user, 'game', 'Teen Patti Gold: refund', b.amount); }
      if (key === undefined) db.prepare('delete from tp_pending').run(); else db.prepare('delete from tp_pending where room=?').run(key);
    })();
    pushCoins(...new Set(rows.map(b => b.user)));
    return rows.map(b => ({ key: b.room, handId: b.hand, userId: b.user, name: b.user, amount: b.amount }));
  },
};
const tpPanels = room => members.get(room)?.forEach(w => send(w, { t: 'tp', room, view: tp.getView(room, w.user) }));
const tp = !TP ? null : new TP.TeenPattiManager({
  store: tpStore,
  config: { ...TP.CONFIG, DEFAULT_BOOT: TP_BOOT, RAKE_PERCENT: 0, TURN_SECONDS: 15 },
  send: (room, text) => cast(room, { t: 'msg', room, user: 'Teen Patti Gold', text, kind: 'game', ts: Date.now(), role: '' }),
  sendPrivate: (room, userId, text) => members.get(room)?.forEach(w => w.user === userId && send(w, { t: 'msg', room, user: 'Teen Patti Gold', text, kind: 'game', priv: true, ts: Date.now(), role: '' })),
  isAdmin: async u => !!u.isAdmin,   // set from the authenticated session (or true for the internal auto-start)
  onState: tpPanels,
  onHand: info => { try { db.prepare('insert into tp_hands(ts,info) values(?,?)').run(Date.now(), JSON.stringify(info)); } catch {} },
});
tp?.init().catch(e => console.error('[TeenPatti] init failed', e));
const isCricketRoom = n => String(n || '').toLowerCase() === 'cricket';
const cricket = !CB ? null : new CB.CricketBot({
  say: async (room, text) => cast(room, { t: 'msg', room, user: 'Cricket Bot', text, kind: 'game', ts: Date.now(), role: '' }),
  takeCredits: async (user, amount) => {
    const ok = db.transaction(() => {
      if (!db.prepare('update users set coins=coins-? where name=? and coins>=?').run(amount, user, amount).changes) return false;
      const tx = addTx(user, 'game', 'Cricket Bot: entry fee', -amount); mev(user, 'game'); { const rr = curRoom(user); roomSpend(rr, amount); roomXp(rr, 5); } commissionOn(user, amount, 'game', tx.lastInsertRowid); return true;
    })();
    if (ok) pushCoins(user); return ok;
  },
  addCredits: async (user, amount) => {
    db.transaction(() => { db.prepare('update users set coins=coins+? where name=?').run(amount, user); addTx(user, 'game', 'Cricket Bot: payout / refund', amount); })();
    pushCoins(user);
  },
});
const isLowRoom = n => String(n || '').toLowerCase() === 'lowcard';
const lcRefundRoom = room => db.transaction(() => {
  for (const b of db.prepare('select user,amount from lc_pending where room=?').all(room)) { db.prepare('update users set coins=coins+? where name=?').run(b.amount, b.user); addTx(b.user, 'game', 'Game bot: refund', b.amount); }
  db.prepare('delete from lc_pending where room=?').run(room);
})();
// Shared wallet API for the pot games (LowCard, Dice): entries are journaled in lc_pending so a crash refunds them at the next start.
const gameApi = label => ({
  say: async (room, text) => cast(room, { t: 'msg', room, user: label, text, kind: 'game', ts: Date.now(), role: '' }),
  debit: async (room, user, amount) => {
    const ok = db.transaction(() => {
      if (!db.prepare('update users set coins=coins-? where name=? and coins>=?').run(amount, user, amount).changes) return false;
      db.prepare('insert into lc_pending values(?,?,?)').run(room, user, amount);
      const tx = addTx(user, 'game', `${label}: entry fee`, -amount); mev(user, 'game'); roomSpend(room, amount); roomXp(room, 5); commissionOn(user, amount, 'game', tx.lastInsertRowid); return true;
    })();
    if (ok) pushCoins(user); return ok;
  },
  settle: async (room, winner, prize) => {
    const wrow = db.prepare('select * from lc_pending where room=? and user=?').get(room, winner);
    try { contestScore(room, 'game', winner, { game: 'lowcard', amount: wrow ? Object.values(wrow)[2] : 0, won: prize }); } catch (e) { console.log('[contest]', e.message); }
    const names = db.prepare('select user from lc_pending where room=?').all(room).map(x => x.user);
    db.transaction(() => { db.prepare('update users set coins=coins+? where name=?').run(prize, winner); addTx(winner, 'game', `${label}: win`, prize); db.prepare('delete from lc_pending where room=?').run(room); })();
    pushCoins(winner, ...names);
  },
  refund: async room => { const names = db.prepare('select user from lc_pending where room=?').all(room).map(x => x.user); lcRefundRoom(room); pushCoins(...names); },
});
const lowcard = !LC ? null : new LC.LowCardBot(gameApi('LowCard Bot'));
const dice = !DC ? null : new DC.DiceBot(gameApi('Dice Bot'));
// A crash in the middle of a LowCard game: give every pending entry back at the next start.
if (lowcard || dice) for (const { room } of db.prepare('select distinct room from lc_pending').all()) { lcRefundRoom(room); console.log('[LowCard] refunded interrupted game in', room); }
const isRoyaleRoom = n => String(n || '').toLowerCase() === 'royale';
const rbStore = {
  async touch() {},
  async getBalance(id) { return coins(id); },
  async placeBet({ roomId, roundId, userId, option, amount }) {
    const left = db.transaction(() => {
      if (!db.prepare('update users set coins=coins-? where name=? and coins>=?').run(amount, userId, amount).changes) return null;
      db.prepare('insert into rb_pending values(?,?,?,?,?)').run(roomId, roundId, userId, option, amount);
      const tx = addTx(userId, 'game', `Royale Battle: bet on ${option}`, -amount); mev(userId, 'game'); roomSpend(roomId, amount); roomXp(roomId, 5); commissionOn(userId, amount, 'game', tx.lastInsertRowid);
      return coins(userId);
    })();
    if (left !== null) pushCoins(userId); return left;
  },
  async settleRound({ roomId, roundId, payouts }) {
    db.transaction(() => {
      for (const p of payouts) { db.prepare('update users set coins=coins+? where name=?').run(p.amount, p.userId); addTx(p.userId, 'game', 'Royale Battle: win', p.amount); }
      db.prepare('delete from rb_pending where room=? and round=?').run(roomId, roundId);
    })();
    pushCoins(...payouts.map(p => p.userId));
  },
  async refundPending(roomId) {
    const rows = roomId === undefined ? db.prepare('select * from rb_pending').all() : db.prepare('select * from rb_pending where room=?').all(roomId);
    db.transaction(() => {
      for (const b of rows) { db.prepare('update users set coins=coins+? where name=?').run(b.amount, b.user); addTx(b.user, 'game', 'Royale Battle: refund', b.amount); }
      if (roomId === undefined) db.prepare('delete from rb_pending').run(); else db.prepare('delete from rb_pending where room=?').run(roomId);
    })();
    pushCoins(...rows.map(b => b.user));
    return rows.map(b => ({ roomId: b.room, roundId: b.round, userId: b.user, name: b.user, option: b.option, amount: b.amount }));
  },
  async top(n = 10) { return db.prepare('select name, coins balance from users where lower(name)!=? order by coins desc limit ?').all(STAFF_USER, n); },
};
const royale = !RB ? null : new RB.RoyaleBattleManager({
  send: (room, text) => cast(room, { t: 'msg', room, user: 'Royale Battle', text, kind: 'game', ts: Date.now(), role: '' }),
  sendTo: (room, userId, text) => members.get(room)?.forEach(w => w.user === userId && send(w, { t: 'msg', room, user: 'Royale Battle', text, kind: 'game', priv: true, ts: Date.now(), role: '' })),
  store: rbStore,
  isAdmin: async u => !!u.isAdmin,
  config: { ...RB.CONFIG, COIN_NAME: 'coins' },
  onRound: info => { try { db.prepare('insert into tp_hands(ts,info) values(?,?)').run(Date.now(), JSON.stringify({ game: 'royale', ...info })); } catch {} },
});
royale?.init().catch(e => console.error('[Royale] init failed', e));
setInterval(() => { try { royale?.savePlanners(); } catch {} }, 30e3).unref();


// ---------- Game tables (LowCard / Cricket / Dice / Royale Battle): live view for the client panel ----------
const gpView = (room, user) => {
  const g = gameOf(room), now = Date.now();
  if (g === 'lowcard' || g === 'dice') {
    const bot = g === 'lowcard' ? lowcard : dice, x = bot?.games.get(room);
    const base = { g, room, now, entry: bot?.entry instanceof Map ? (bot.entry.get(room) || 0) : 0 };
    if (!x) return { ...base, state: 'idle' };
    const alive = g === 'lowcard' ? x.alive : x.players, pend = x.pending || [];
    const players = x.players.map(n => ({ n, alive: g === 'dice' || alive.includes(n), me: n === user, wait: pend.includes(n) && !(x.draws || x.rolls)?.has(n), card: g === 'lowcard' ? (x.shown.get(n)?.label || null) : null, dice: g === 'dice' ? (x.shown.get(n) ? [x.shown.get(n).a, x.shown.get(n).b] : null) : null, total: g === 'dice' ? (x.shown.get(n)?.total ?? null) : null }));
    return { ...base, state: x.state, entry: x.entry, pot: x.pot || 0, round: x.round || 0, deadline: x.deadline, players, low: x.lowSet || [], outs: x.outs || [], winner: x.winner, prize: x.prize, joined: x.players.includes(user), pending: pend.includes(user) };
  }
  if (g === 'cricket') {
    const x = cricket?.games.get(room), base = { g, room, now };
    if (!x) return { ...base, state: 'idle' };
    const pend = x.pendingPlayers || [];
    const players = x.players.map(n => ({ n, me: n === user, out: x.out.has(n), runs: x.total[n] || 0, wait: pend.includes(n) && !x.draws?.has(n), last: x.shown.get(n) ? { l: x.shown.get(n).label, r: x.shown.get(n).runs || 0, o: !!x.shown.get(n).out } : null }));
    return { ...base, state: x.state, cost: x.cost, pot: x.pot || 0, round: x.round || 0, max: 6, deadline: x.deadline, players, winner: x.winner, prize: x.prize, joined: x.players.includes(user), pending: pend.includes(user) && !x.draws?.has(user) };
  }
  if (g === 'royale') {
    const x = royale?.rooms.get(room), base = { g, room, now };
    if (!x) return { ...base, state: 'idle' };
    const tot = {}, mine = {};
    for (const [id, b] of x.bets) for (const [o, a] of Object.entries(b.opts)) { tot[o] = (tot[o] || 0) + a; if (id === String(user)) mine[o] = a; }
    return { ...base, state: x.phase, round: x.roundId, deadline: x.deadline, since: x.phase === 'between' ? x.betweenAt : 0, pay: x.cfg.PAYOUTS, min: x.cfg.MIN_BET, tot, mine, bettors: x.bets.size, last: x.last ? { ...x.last, won: x.last.payouts.filter(p => p.userId === String(user)).reduce((a, p) => a + p.amount, 0) } : null };
  }
  return null;
};
const gpSend = (room, ws) => { const v = gpView(room, ws.user); if (!v) return; const j = JSON.stringify(v, (k, val) => k === 'now' ? undefined : val); if (ws._gp === j) return; ws._gp = j; send(ws, { t: 'gp', room, view: v }); };
const gpPush = room => members.get(room)?.forEach(w => gpSend(room, w));
setInterval(() => {
  try { for (const { room, game } of db.prepare("select room,game from room_game where game!='tp'").all()) if (members.get(room)?.size) gpPush(room); } catch {}
}, 1000).unref();

const POT_GAMES = ['cricket', 'lowcard', 'dice'];   // room admins / moderators may run these in their own room
const GAME_NAMES = { teenpatti: 'tp', tp: 'tp', cricket: 'cricket', lowcard: 'lowcard', dice: 'dice', royalebattle: 'royale', royale: 'royale' };
const GAME_LABEL = { tp: 'Teen Patti Gold', cricket: 'Cricket Bot', lowcard: 'LowCard Bot', dice: 'Dice Bot', royale: 'Royale Battle' };
const SYSADMIN = { id: 'system', name: 'System', isAdmin: true };
const gameBusy = room => {
  const g = gameOf(room);
  if (g === 'cricket') { const x = cricket?.games.get(room); return !!x && x.state !== 'ended'; }
  if (g === 'lowcard') return !!lowcard?.running(room);
  if (g === 'dice') return !!dice?.running(room);
  return false;
};
// Stops the game bot of a room. Returns false when a game/hand/round is still running.
async function stopGame(room) {
  const cur = gameOf(room); if (!cur) return true;
  if (gameBusy(room)) return false;
  if (cur === 'tp' && tp?.rooms.has(room)) { await tp.handleMessage(room, SYSADMIN, '/bot stop'); if (tp.rooms.has(room)) return false; tpPanels(room); }
  if (cur === 'royale' && royale?.rooms.has(room)) { await royale.handleMessage(room, SYSADMIN, '/bot stop'); if (royale.rooms.has(room)) return false; }
  db.prepare('delete from room_game where room=?').run(room);
  members.get(room)?.forEach(w => { w._gp = null; send(w, { t: 'gp', room, view: null }); });
  return true;
}
async function botCommand(ws, text) {
  const room = ws.room, u = ws.user, [, name = '', arg = ''] = text.trim().toLowerCase().split(/\s+/);
  if (room.startsWith('dm:')) return reply(ws, 'Game bots work in public rooms only.');
  if (!canMod(room, u)) return reply(ws, 'Only staff, admins, the room admin or room moderators can add or remove game bots. Anyone can play with !start once a game is added.');
  const cur = gameOf(room);
  if (name === 'stop') {
    if (!cur) return reply(ws, 'No game bot is running in this room.');
    if (!isSA(u) && !POT_GAMES.includes(cur)) return reply(ws, 'Only staff or admins can stop that bot.');
    if (!(await stopGame(room))) return reply(ws, 'A game is running right now. Try again when it ends.');
    return say(room, u, `🛑 ${GAME_LABEL[cur]} was stopped by ${u}`, 'sys');
  }
  const g = GAME_NAMES[name];
  if (!g) return reply(ws, 'Usage: /bot cricket | lowcard | dice   (staff/admins also: teenpatti | royalebattle)   ·   /bot stop');
  if (!isSA(u) && !POT_GAMES.includes(g)) return reply(ws, 'Only staff or admins can add Teen Patti and Royale Battle.');
  if (!{ tp, cricket, lowcard, dice, royale }[g]) { const f = { tp: 'teen-patti.cjs', cricket: 'cricket-bot.cjs', lowcard: 'lowcard.cjs', dice: 'dice.cjs', royale: 'royale-battle.cjs' }[g]; return reply(ws, `🔒 ${GAME_LABEL[g] || g} is not loaded on the server. Upload ${f} next to server.js and restart the service.${ENGINE_ERR[f] ? ' (' + ENGINE_ERR[f] + ')' : ''}`); }
  if (cur && cur !== g && !(await stopGame(room))) return reply(ws, `${GAME_LABEL[cur]} is running right now. Try again when it ends.`);
  db.prepare('insert or replace into room_game values(?,?)').run(room, g);
  if (g === 'tp') await tp.handleMessage(room, SYSADMIN, '/bot teenpatti ' + (/^\d+$/.test(arg) ? arg : (TP_ROOMS[room]?.[0] || TP_BOOT)));
  else if (g === 'royale') await royale.handleMessage(room, SYSADMIN, '/bot royalebattle');
  else if (g === 'lowcard' && /^\d+$/.test(arg)) lowcard.admin(room, true, `/bot lowcard ${arg}`);
  if (cur !== g) say(room, u, `🎮 ${GAME_LABEL[g]} is on in this room (started by ${u}). Type !start to play.`, 'sys');
}
db.exec('create table if not exists room_limit(room text primary key, max integer)');
const limitOf = room => db.prepare('select max from room_limit where room=?').get(room)?.max || 0;
function applyLimit(room) {
  const g = gameOf(room), lim = limitOf(room);
  const t = g === 'tp' ? tp?.rooms.get(room) : g === 'royale' ? royale?.rooms.get(room) : null;
  if (t) t.limit = lim || null;
}
function botLimit(ws, text) {
  const room = ws.room, u = ws.user, g = gameOf(room), arg = (text.trim().split(/\s+/)[1] || '').toLowerCase().replace(/,/g, '');
  if (room.startsWith('dm:')) return reply(ws, 'Game bots work in public rooms only.');
  if (!canMod(room, u)) return reply(ws, 'Only staff, admins, the room admin or room moderators can set the bet limit.');
  if (g !== 'tp' && g !== 'royale') return reply(ws, 'Bet limit is only for Teen Patti and Royale Battle rooms.');
  if (!arg) { const l = limitOf(room); return reply(ws, l ? `Bet limit here: ${l}. Use /botlimit [amount] to change, /botlimit off to remove.` : 'No custom bet limit in this room. Use /botlimit [maximum amount].'); }
  if (arg === 'off' || arg === '0') { db.prepare('delete from room_limit where room=?').run(room); applyLimit(room); return say(room, u, `🎚 Bet limit removed by ${u}`, 'sys'); }
  const m = /^(\d+(?:\.\d+)?)([km]?)$/.exec(arg);
  const n = m ? Math.round(+m[1] * (m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : 1)) : 0;
  if (!n || n < 100 || n > 1e9) return reply(ws, 'Usage: /botlimit [maximum amount]  e.g. /botlimit 50000 or /botlimit 50k  ·  /botlimit off');
  db.prepare('insert or replace into room_limit values(?,?)').run(room, n); applyLimit(room);
  say(room, u, `🎚 Max bet limit is now ${n.toLocaleString('en-US')} (set by ${u})`, 'sys');
}
// Fixed Teen Patti rooms: [minimum bet (boot), pot limit]. Re-applied on every start, so a restart never loses them.
const TP_ROOMS = { 'TeenPatti': [50, 100000], 'TeenPatti 1': [200, 200000], 'TeenPatti 2': [400, 400000], 'TeenPatti 3': [500, 600000], 'TeenPatti 4': [1000, 1000000], 'TeenPatti 5': [2000, 200000] };
for (const [n, [, lim]] of Object.entries(TP_ROOMS)) {
  db.prepare('insert or ignore into rooms(name,cat,owner) values(?,?,?)').run(n, 'game', null);
  db.prepare('insert or replace into room_game values(?,?)').run(n, 'tp');
  db.prepare('insert or replace into room_limit values(?,?)').run(n, lim);
}
setInterval(() => { for (const room of Object.keys(TP_ROOMS)) { try { applyLimit(room); } catch {} } }, 5e3).unref();
const potTop = () => 'Top players: ' + db.prepare('select name,coins from users where lower(name)!=? order by coins desc limit 5').all(STAFF_USER).map((x, i) => `${i + 1}. ${x.name} (${x.coins})`).join(' · ');
function gameRoute(ws, text) {
  const room = ws.room, g = gameOf(room);
  applyLimit(room);
  if (!g) return reply(ws, 'No game bot is running in this room. Staff, the room admin or moderators can start one with /bot cricket, /bot lowcard or /bot dice.');
  if (!speakOk(ws)) return;
  const u = { id: ws.user, name: ws.user, isAdmin: isSA(ws.user) }, lo = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (g === 'tp') { ensureTp(room); return tp.handleMessage(room, u, text).catch(e => console.error('[TeenPatti]', e)); }
  if (g === 'royale') {
    const pre = !royale.rooms.has(room) ? royale.handleMessage(room, SYSADMIN, '/bot royalebattle') : Promise.resolve();
    return pre.then(() => { applyLimit(room); return royale.handleMessage(room, u, text); }).catch(e => console.error('[Royale]', e));
  }
  if (g === 'cricket' || g === 'lowcard' || g === 'dice') {
    if (lo === '!bal') return reply(ws, `Your balance: ${coins(ws.user)} coins.`);
    if (lo === '!top') return reply(ws, potTop());
    const bot = { cricket, lowcard, dice }[g];
    return bot.handle(room, ws.user, text, isSA(ws.user)).catch(e => console.error('[' + g + ']', e));
  }
}
const ensureTp = room => { if (tp && isTpRoom(room) && !tp.rooms.has(room)) tp.handleMessage(room, { id: 'system', name: 'System', isAdmin: true }, '/bot teenpatti ' + (TP_ROOMS[room]?.[0] || TP_BOOT)); };
const shutdownTp = async () => { try { await tp?.shutdown(); } catch {} process.exit(0); };
process.on('SIGTERM', shutdownTp); process.on('SIGINT', shutdownTp);
const xpOf = n => db.prepare('select xp from users where name=?').get(n)?.xp || 0;

// ---------- UNO ----------
const games = new Map();
const mkDeck = () => {
  const d = [];
  for (const c of 'RYGB') {
    d.push(c + '0');
    for (let n = 1; n <= 9; n++) d.push(c + n, c + n);
    for (const s of 'SVD') d.push(c + s, c + s);
  }
  for (let i = 0; i < 4; i++) d.push('W', 'F');
  return d.sort(() => Math.random() - 0.5);
};
const draw = (g, p, n) => { while (n--) { if (!g.deck.length) g.deck = mkDeck(); g.hands[p].push(g.deck.pop()); } };
const step = (g, n = 1) => (g.turn + g.dir * n + g.players.length * 10) % g.players.length;
const unoState = (g, me) => ({
  t: 'uno', started: g.started, winner: g.winner, players: g.players, turn: g.players[g.turn],
  top: g.top, color: g.color, hand: g.hands[me] || [], counts: Object.fromEntries(g.players.map(p => [p, g.hands[p].length])),
});
const unoSync = room => members.get(room)?.forEach(w => send(w, unoState(games.get(room), w.user)));

function unoAct(room, user, m) {
  let g = games.get(room);
  if (m.a === 'join') {
    if (!g || g.winner) g = { players: [], hands: {}, deck: mkDeck(), started: false, dir: 1, turn: 0, top: null, color: null, winner: null }, games.set(room, g);
    if (!g.started && g.players.length < 4 && !g.players.includes(user)) { g.players.push(user); g.hands[user] = []; }
  } else if (!g) return;
  else if (m.a === 'start' && !g.started && g.players.length >= 2) {
    g.started = true;
    g.players.forEach(p => draw(g, p, 7));
    do { g.top = g.deck.pop(); } while (g.top.length === 1 || 'SVD'.includes(g.top[1]));
    g.color = g.top[0];
  } else if (g.started && !g.winner && g.players[g.turn] === user) {
    if (m.a === 'draw') { draw(g, user, 1); g.turn = step(g); }
    if (m.a === 'play') {
      const c = g.hands[user][m.i];
      if (!c) return;
      const wild = c === 'W' || c === 'F';
      if (wild ? !'RYGB'.includes(m.color) : !(c[0] === g.color || c.slice(1) === g.top.slice(1))) return;
      g.hands[user].splice(m.i, 1);
      g.top = c; g.color = wild ? m.color : c[0];
      if (!g.hands[user].length) { g.winner = user; }
      else {
        const nx = g.players[step(g)];
        if (c[1] === 'V') { g.dir *= -1; g.turn = g.players.length === 2 ? g.turn : step(g); }
        else if (c[1] === 'S') g.turn = step(g, 2);
        else if (c[1] === 'D') { draw(g, nx, 2); g.turn = step(g, 2); }
        else if (c === 'F') { draw(g, nx, 4); g.turn = step(g, 2); }
        else g.turn = step(g);
      }
    }
  }
  unoSync(room);
}

// ---------- Rooms, commands & moderation ----------
const cfg = room => db.prepare('select * from room_cfg where room=?').get(room) || { locked: 0, silence_until: 0, announce: '' };
const setCfg = (room, k, v) => { db.prepare('insert or ignore into room_cfg(room) values(?)').run(room); db.prepare(`update room_cfg set ${k}=? where room=?`).run(v, room); };
const isBlocked = (a, b) => !!db.prepare('select 1 from blocks where (a=? and b=?) or (a=? and b=?)').get(a, b, b, a);
const ownerOf = room => db.prepare('select owner from rooms where name=?').get(room)?.owner;
const isRoomMod = (room, u) => !!db.prepare('select 1 from room_mods where room=? and user=?').get(room, u);
const isSuper = (room, u) => !!db.prepare('select 1 from room_mods where room=? and user=? and super=1').get(room, u);
const isSA = u => ['staff', 'admin'].includes(roleOf(u));
const canMod = (room, u) => isSA(u) || ownerOf(room) === u || isRoomMod(room, u);
const reply = (ws, text, kind) => send(ws, { t: 'msg', room: ws.room, user: '', text, kind: kind || (/^(Usage:|Unknown|User not found|Only |You need|Pick another|Not enough|Please wait|Nobody|You are silenced|This room)/.test(text) ? 'err' : 'info'), ts: Date.now() });
const say = (room, user, text, kind = 'action') => {
  const o = { user, text, kind, ts: Date.now(), role: roleOf(user), xp: xpOf(user) };
  if (kind !== 'sys' && kind !== 'note') db.prepare('insert into msgs(room,user,text,kind,ts) values(?,?,?,?,?)').run(room, user, text, kind, o.ts);
  cast(room, { t: 'msg', room, ...o });
};
const fmt = s => s < 60 ? s + ' sec' : s < 3600 ? Math.round(s / 60) + ' min' : (s / 3600).toFixed(1).replace('.0', '') + ' h';
const seed = str => { let h = 7; for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const day = () => new Date().toISOString().slice(0, 10);
const refreshCoins = (...names) => wss.clients.forEach(w => names.includes(w.user) && send(w, { t: 'coins', coins: coins(w.user) }));

function canTarget(room, actor, target) {
  const tr = roleOf(target);
  if (tr === 'staff') return false;
  if (isSA(actor)) return true;
  if (tr === 'admin' || ownerOf(room) === target) return false;
  if (isRoomMod(room, target) && ownerOf(room) !== actor) return isSuper(room, actor) && !isSuper(room, target);   // super mods can act on normal mods, never on the room admin or other super mods
  return true;
}
function speakOk(ws) {
  const mu = db.prepare('select until from mutes where room=? and user=?').get(ws.room, ws.user);
  if (mu && mu.until > Date.now()) { reply(ws, `You are silenced in this room for ${Math.ceil((mu.until - Date.now()) / 60000)} more min.`); return false; }
  const c = cfg(ws.room);
  if (!canMod(ws.room, ws.user) && (c.locked || c.silence_until > Date.now())) { reply(ws, c.locked ? 'This room is locked.' : 'This room is silenced right now.'); return false; }
  return true;
}
function moderate(ws, act, t, secs, text) {
  const room = ws.room, u = ws.user, err = e => reply(ws, e);
  if (!room || room.startsWith('dm:')) return err('Moderation works in public rooms only.');
  if (!canMod(room, u)) return err('You need room moderator permission for that.');
  if (act === 'unkick' && !isSA(u)) return err('Only staff and admins can remove suspensions.');
  if ((act === 'mod' || act === 'dmod') && !(ownerOf(room) === u || isSA(u) || isSuper(room, u))) return err('Only the room admin or a super moderator can do that.');
  if ((act === 'smod' || act === 'dsmod') && !(ownerOf(room) === u || isSA(u))) return err('Only the room admin can do that.');
  if (['kick', 'bump', 'ban', 'unban', 'unkick', 'silence', 'unsilence', 'mod', 'dmod', 'smod', 'dsmod'].includes(act)) {
    if (!t || !profile(t)) return err('User not found. Usage: /' + act + ' username');
    if (t === u) return err("You can't do that to yourself.");
    if (['kick', 'bump', 'ban', 'silence'].includes(act) && !canTarget(room, u, t)) return err(`${t} is protected.`);
  }
  const note = (x, k = 'note') => say(room, u, x, k);
  const dur = ms => { const t = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(t / 86400)} days ${Math.floor(t % 86400 / 3600)} hours ${Math.floor(t % 3600 / 60)} minutes ${t % 60} seconds`; };
  const L = n => `${n} [${level(xpOf(n))}]`;
  const evict = ms => [...(members.get(room) || [])].filter(w => w.user === t).forEach(w => { members.get(room).delete(w); w.room = null; send(w, { t: 'kicked', room, by: u, text: ms ? `You have been kicked by ${u}. You are suspended from this chatroom for ${dur(ms)}.` : `You have been banned from this chatroom by ${u}.` }); });
  const suspend = ms => { db.prepare('insert or replace into bans values(?,?,?,?,?)').run(room, t, u, Date.now(), ms ? Date.now() + ms : 0); evict(ms); };
  const s = Math.min(86400, Math.max(1, Math.floor(secs) || 600));
  if (act === 'kick') { suspend(3600e3); note(`${L(t)} was kicked for 1 hour by ${L(u)}`); }
  else if (act === 'bump') { suspend(300e3); note(`${L(t)} was bumped for 5 minutes by ${L(u)}`); }
  else if (act === 'ban') { suspend(0); note(`${L(t)} has been banned by ${L(u)}.`); }
  else if (act === 'unban') { db.prepare('delete from bans where room=? and user=? and until=0').run(room, t); note(`${t} has been unbanned by ${u}.`); }
  else if (act === 'unkick') { db.prepare('delete from bans where room=? and user=? and until>0').run(room, t); note(`${L(t)}'s suspension was removed by ${L(u)}`); }
  else if (act === 'silence') { db.prepare('insert or replace into mutes values(?,?,?)').run(room, t, Date.now() + s * 1000); note(`${L(t)} was silenced for ${fmt(s)} by ${L(u)}`); }
  else if (act === 'unsilence') { db.prepare('delete from mutes where room=? and user=?').run(room, t); note(`${L(t)} can talk again (by ${L(u)})`); }
  else if (act === 'silenceall') { setCfg(room, 'silence_until', Date.now() + s * 1000); note(`Chatroom has been silenced for ${s} seconds`); }
  else if (act === 'unsilenceall') { setCfg(room, 'silence_until', 0); note(`Room silence lifted by ${u}`); }
  else if (act === 'lock') { setCfg(room, 'locked', 1); note(`This chatroom has been locked by ${u}.`, 'notel'); }
  else if (act === 'unlock') { setCfg(room, 'locked', 0); note(`This chatroom has been unlocked by ${u}.`, 'notel'); }
  else if (act === 'mod') { db.prepare('insert or ignore into room_mods(room,user) values(?,?)').run(room, t); note(`${t} is now moderator of this chatroom`); castRoomCfg(room); }
  else if (act === 'dmod') {
    if (isSuper(room, t) && !(ownerOf(room) === u || isSA(u))) return err('Only the room admin can remove a super moderator.');
    db.prepare('delete from room_mods where room=? and user=?').run(room, t); note(`${t} is no longer moderator of this room`); castRoomCfg(room);
  }
  else if (act === 'smod') { if (t === ownerOf(room)) return err('That is the room admin.'); db.prepare('insert into room_mods(room,user,super) values(?,?,1) on conflict(room,user) do update set super=1').run(room, t); note(`${L(t)} is now a super moderator (by ${L(u)})`); }
  else if (act === 'dsmod') { db.prepare('update room_mods set super=0 where room=? and user=?').run(room, t); note(`${t} is no longer a super moderator (still a moderator)`); }
  else if (act === 'broadcast') { if (!text) return err('Usage: /broadcast message'); note(`${u} Broadcasted 📣 ${text.slice(0, 300)}`, 'notea'); }
  else if (act === 'announce') { setCfg(room, 'announce', text.slice(0, 300)); if (text) note(`📣 (Announcement): ${text.slice(0, 300)}`, 'notea'); else reply(ws, 'Announcement removed.'); }
}

const giftDef = key0 => {
  const nk = String(key0 || '').toLowerCase().replace(/[\s_-]+/g, '');
  return giftDef0(key0) || giftDef0(nk) || (() => { for (const [k, g] of Object.entries(allGifts())) if (k.replace(/[\s_-]/g, '') === nk || String(g.n).toLowerCase().replace(/[\s_-]/g, '') === nk) return giftDef0(k); return null; })();
};
const giftDef0 = key => {
  key = String(key || '').toLowerCase();
  if (GIFTS[key]) return { ...GIFTS[key], key, r: Math.floor(GIFTS[key].c / 2) };
  const g = db.prepare('select * from gifts where key=? and active=1').get(key);
  return g ? { key, n: g.name, c: g.cost, r: g.recv, e: '🎁', img: g.icon } : null;
};
const allGifts = () => { const o = {}; for (const [k, g] of Object.entries(GIFTS)) o[k] = { ...g, r: Math.floor(g.c / 2) };
  for (const g of db.prepare('select * from gifts where active=1 order by ts').all()) o[g.key] = { n: g.name, c: g.cost, r: g.recv, e: '🎁', img: g.icon }; return o; };
const allGiftsAny = key => { if (GIFTS[key]) return GIFTS[key]; const g = db.prepare('select name n,icon img from gifts where key=?').get(key); return g && { ...g, e: '🎁' }; };
const giftIcon = gf => gf.img ? `[g:${gf.img}] ` : gf.e + ' ';
// XP for gifts: [max price, gifts needed, xp earned]. One gift is worth xp/gifts XP, kept as exact fractions (units of 1/4200 XP).
const GIFT_XP = [[5, 100, 2], [10, 20, 4], [20, 40, 10], [40, 30, 15], [100, 50, 30], [300, 60, 40], [500, 70, 70], [1000, 30, 80], [10000, 10, 100], [20000, 10, 120], [100000, 1, 200]]; // never less XP per gift for a pricier gift
const GXU = 4200;
db.exec('create table if not exists gift_xp(user text primary key, u int default 0)');
function giftXp(name, price) {
  const t = GIFT_XP.find(x => price <= x[0]) || GIFT_XP[GIFT_XP.length - 1];
  const units = Math.round(t[2] * GXU / t[1]);
  const row = db.prepare('select u from gift_xp where user=?').get(name);
  const tot = (row?.u || 0) + units, whole = Math.floor(tot / GXU);
  db.prepare('insert into gift_xp(user,u) values(?,?) on conflict(user) do update set u=excluded.u').run(name, tot % GXU);
  if (whole > 0) { addXp(name, whole); wss.clients.forEach(w => { if (w.user === name) send(w, { t: 'xp', xp: xpOf(name) }); }); }
}
const payGift = (from, to, gf, ctx = 'room', room = '') => { const ok = payGift0(from, to, gf, ctx, room); if (ok) { try { roomSpend(room, gf.c); roomXp(room, giftXpVal(gf.c)); } catch (e) { console.log('[roomxp]', e.message); } try { giftXp(from, gf.c); giftXp(to, gf.c); } catch (e) { console.log('[giftxp]', e.message); } } return ok; };
const payGift0 = (from, to, gf, ctx = 'room', room = '') => db.transaction(() => {
  const where = ctx === 'dm' ? ' · Private chat' : room ? ' · Room: ' + String(room).slice(0, 40) : '';
  if (!db.prepare('update users set coins=coins-? where name=? and coins>=?').run(gf.c, from, gf.c).changes) return false;
  const rc = gf.r ?? Math.floor(gf.c / 2);
  db.prepare('update users set coins=coins+? where name=?').run(rc, to);
  db.prepare('insert into gift_inv(user,gift,n) values(?,?,1) on conflict(user,gift) do update set n=n+1').run(to, gf.key || gf.n.toLowerCase());
  const tx = addTx(from, ctx === 'shower' ? 'gs' : 'gift', `Sent ${gf.n} to ${to}${where}`, -gf.c); addTx(to, 'gift', (ctx === 'shower' ? `${gf.n} gift shower from ${from}` : `${gf.n} from ${from}`) + where, rc); setImmediate(() => notify(to, 'rewards', `${from} sent you ${gf.n} (+${rc.toLocaleString()} coins)`));
  const isMig = String(gf.key || gf.n || '').toLowerCase() === 'migmeet' || String(gf.n || '').toLowerCase() === 'migmeet';
  if (isMig) mev(from, 'dm_gift');   // the "Send migmeet gifts" task counts the migmeet gift wherever it is sent
  if (ctx !== 'dm') { mev(from, 'gift_sent'); mev(to, 'gift_recv'); }
  commissionOn(from, gf.c, 'gift', tx.lastInsertRowid);
  return true;
})();
const GCOL = ['#d9342b', '#3aa655', '#1c1c1e', '#e8337a', '#2f6fd6', '#d98a00'];
const gcol = gf => gf.c >= 1000 ? '#d9342b' : gf.c >= 300 ? '#e8337a' : gf.c >= 20 ? '#3aa655' : '#1c1c1e'; // red 1000+, pink 300-999, green 20-299, black 1-19
function giftOne(ws, to, key, note = '') {
  const gf = giftDef(key);
  if (!gf) return reply(ws, `Unknown gift. Try: ${Object.keys(allGifts()).join(', ')}`);
  if (!to || to === ws.user || !profile(to)) return reply(ws, 'Pick another valid user.');
  if (isBlocked(ws.user, to)) return reply(ws, "You can't gift this user.");
  if (!speakOk(ws)) return;
  if (!payGift(ws.user, to, gf, ws.room?.startsWith('dm:') ? 'dm' : 'room', ws.room)) return reply(ws, 'Not enough coins.');
  if (!ws.room?.startsWith('dm:')) try { contestScore(ws.room, 'gift', ws.user, { gift: gf.key, amount: gf.c }); } catch (e) { console.log('[contest]', e.message); }
  say(ws.room, ws.user, `{c:${gcol(gf)}}<<${ws.user} [${level(xpOf(ws.user))}] gives a ${gf.n} ${giftIcon(gf).trim()} to ${to} [${level(xpOf(to))}]${note ? ' -- ' + note : ''}>>`, 'gift');
  reply(ws, `Congratulations for sending gift! You have used ${gf.c} coins and your estimated remaining balance after gifting will be ${coins(ws.user)} coins.`, 'ok');
  refreshCoins(ws.user, to);
}
const showerAt = new Map();
function shower(ws, key) {
  const gf = giftDef(key);
  if (!gf) return reply(ws, `Unknown gift. Try: ${Object.keys(allGifts()).join(', ')}`);
  const to = [...new Set([...(members.get(ws.room) || [])].map(w => w.user))].filter(n => n !== ws.user && !isBlocked(ws.user, n));
  if (!to.length) return reply(ws, 'Nobody else is here to receive it.');
  const wait = 10e3 - (Date.now() - (showerAt.get(ws.user) || 0));
  if (wait > 0) return reply(ws, `Please wait ${Math.ceil(wait / 1000)} more seconds before sending another gift shower.`);
  if (coins(ws.user) < gf.c * to.length) return reply(ws, `You need ${gf.c * to.length} coins to send ${gf.n} to ${to.length} members.`);
  showerAt.set(ws.user, Date.now());
  let sent = 0;
  to.forEach(n => { if (payGift(ws.user, n, gf, 'shower', ws.room)) try { sent++; contestScore(ws.room, 'gift', ws.user, { gift: gf.key, amount: gf.c }); } catch (e) { console.log('[contest]', e.message); } });
  if (sent) addTx(ws.user, 'gift', `${ws.room} · ${gf.n} gift shower (${sent} members)`, -gf.c * sent);
  const shown = to.length > 8 ? to.slice(0, 8).join(', ') + ` and ${to.length - 8} others` : to.join(', ');
  say(ws.room, ws.user, `{c:${gcol(gf)}}<< 🎆 *GIFT SHOWER* ${ws.user} [${level(xpOf(ws.user))}] gives a ${gf.n} ${giftIcon(gf).trim()} to ${shown}! Hurray! >>`, 'gift');
  reply(ws, `Congratulations for sending gift! You have used ${gf.c * to.length} coins and your estimated remaining balance after gifting will be ${coins(ws.user)} coins.`, 'ok');
  refreshCoins(ws.user, ...to);
}
function friendAct(ws, n) {
  const u = ws.user;
  if (!n || n === u || !profile(n)) return reply(ws, 'Usage: /f username');
  const st = fstate(u, n);
  if (st === 'none') { db.prepare("insert into friends values(?,?,'pending')").run(u, n); if (db.prepare('select verified from users where name=?').get(n)?.verified) grantAct(u, 'follow', n); return reply(ws, `You follow ${n} now. If they follow you back, you become friends.`); }
  if (st === 'incoming') { db.prepare("update friends set status='accepted' where a=? and b=?").run(n, u); return reply(ws, `You and ${n} are now friends!`); }
  reply(ws, st === 'friends' ? `You and ${n} are already friends.` : `You already follow ${n}.`);
}
function flames(a, b) {
  const x = [...a.toLowerCase().replace(/[^a-z]/g, '')], y = [...b.toLowerCase().replace(/[^a-z]/g, '')];
  for (const ch of [...x]) { const i = y.indexOf(ch); if (i > -1) { y.splice(i, 1); x.splice(x.indexOf(ch), 1); } }
  const n = x.length + y.length || 1, F = ['Friends', 'Lovers', 'Affection', 'Marriage', 'Enemies', 'Family']; let i = 0;
  while (F.length > 1) { i = (i + n - 1) % F.length; F.splice(i, 1); }
  return F[0];
}
const set = x => new Set(x.split(' '));
const ACT_REQ = set('slap boo cmon comfort congrat french glare hold pinch poke handball snuggle ruffle warn1 chase compliment duel fistbump handshake pat punch rescue surprise tease tickle whisper');
const ACT_SOLO = set('sick caff doh drunk eek happy hiccup hmm honor howl hum joy lag mmm goal win go yawn champion winner offside gold frenzy record snore wohoo worthy shmoo kickgoal freekick ponder bounce cartwheel dab disco drumroll hop jump meditate moonwalk ninja pirate rage robot rock skip sparkle spin stomp stretch victory volcano waddle yoga zombie zoom');
const ACT_OPT = set('shy wink sorry agree apologize argh bark bearhug beg beer blink blowk blush bored bow brb burp cheer chicken chuckle confuse cringe cry drool duck eh embrace faint fart firebreath flirt frown gasp gee giggle gn greet grin groan hfive hug kiss laugh listen loser love martian miss wave spit relax smile thank shiver challenge luck seduce stare salute worship welcome red yellow lose cheers shrug spock purr whop sigh squirt nod warn airkiss applaud boop celebrate clap crown cuddle dance facepalm flex highfive kneel magic motivate party peace pray roar salsa scream selfie shake singalong sneak superhero swoon think thumbsup toast trip whistle');
const EMO = { kiss: '😘', hug: '🤗', bearhug: '🤗', wave: '👋', cry: '😢', laugh: '😂', giggle: '🤭', wink: '😉', shy: '😳', blush: '😊', smile: '😄', grin: '😁', love: '❤️', clap: '👏', applaud: '👏', cheer: '🎉', party: '🥳', dance: '💃', slap: '🖐️', punch: '👊', poke: '👉', highfive: '🙌', hfive: '🙌', fistbump: '🤜', handshake: '🤝', pray: '🙏', sorry: '🙏', thumbsup: '👍', yawn: '🥱', snore: '😴', sick: '🤒', drunk: '🥴', beer: '🍺', toast: '🥂', cheers: '🥂', salute: '🫡', crown: '👑', winner: '🏆', champion: '🏆', victory: '✌️', peace: '☮️', rage: '😡', scream: '😱', roar: '🦁', robot: '🤖', ninja: '🥷', zombie: '🧟', disco: '🪩', rock: '🤘', yoga: '🧘', meditate: '🧘', think: '🤔', hmm: '🤔', shrug: '🤷', facepalm: '🤦', flex: '💪', magic: '✨', sparkle: '✨', selfie: '🤳' };
const ACTV = {
  wink: ['winks suggestively to {t}. Oooo', 'winks suggestively. Oooo'], sorry: ['apologizes to {t}', 'apologizes'], sick: [null, 'is not feeling well'],
  slap: ['slap {t} across the face. Ouch!', 'slaps the air'], agree: ['agrees with {t}', 'agrees'], shy: ['shy away from {t}', 'is feeling shy'],
  kiss: ['gives {t} a sweet kiss', 'blows a kiss'], hug: ['gives {t} a warm hug', 'needs a hug'], bearhug: ['gives {t} a big bear hug', 'wants a bear hug'],
  wave: ['waves at {t}', 'waves hello'], cry: ['cries on {t}\'s shoulder', 'is crying'], laugh: ['laughs at {t}', 'laughs out loud'], giggle: ['giggles at {t}', 'giggles'],
  blush: ['blushes at {t}', 'blushes'], smile: ['smiles at {t}', 'smiles'], grin: ['grins at {t}', 'grins'], love: ['loves {t}', 'is in love'],
  poke: ['pokes {t}', 'pokes around'], punch: ['punches {t}. Ouch!', 'throws a punch'], pinch: ['pinches {t}', 'pinches'], tickle: ['tickles {t}', 'tickles'],
  pat: ['pats {t} on the head', 'pats'], cheer: ['cheers for {t}', 'cheers'], thank: ['thanks {t}', 'says thank you'], bow: ['bows to {t}', 'bows'],
  yawn: [null, 'yawns'], happy: [null, 'is feeling happy'], drunk: [null, 'is drunk'], brb: ['will be right back, {t}', 'will be right back'], gn: ['says good night to {t}', 'says good night'],
  dance: ['dances with {t}', 'dances'], flirt: ['flirts with {t}', 'flirts'], stare: ['stares at {t}', 'stares'], salute: ['salutes {t}', 'salutes'],
};
Object.assign(ACTV, {
  apologize: ['apologizes to {t}', 'apologizes'], argh: ['is frustrated with {t}. ARGHHH!', 'is frustrated. ARGHHH!'], bark: ['barks playfully at {t}', 'barks playfully'],
  bearhug: ['gives {t} a great, big, bone-crushing bearhug!', 'wants a great, big bearhug!'], beg: ["begs at {t}'s feet", 'begs on their knees'],
  beer: ['looks at {t}, pointing to the door, suggesting that it is pub time', 'suggests that it is pub time'], blink: ['blink at {t} in disbelief!', 'blinks in disbelief!'],
  blowk: ['blows a kiss to {t}', 'blows a kiss'], blush: ['turns away from {t} and blushes', 'blushes'], boo: ["runs up behind {t} and screams 'BOOO!'", null],
  cheers: ['raises a cheer for {t}. Go for gold!', 'raises a cheer. Go for gold!'], gold: [null, 'won a gold medal! Congratulations!'],
  frenzy: [null, '=The crowd goes into a frenzy cheering for {u}'], record: [null, 'set a new world record!'], snore: [null, 'fell asleep and started snoring loudly. Bzzzz...'],
  wohoo: [null, "lets out an energetic, 'WOO HOO!'"], worthy: [null, "bows to the ground screaming, 'I'M NOT WORTHY!'"], kickgoal: [null, 'kicks a goal for the team!'],
  freekick: [null, 'is a free-kick specialist'], bounce: [null, 'bounces around the room with excitement'], cartwheel: [null, 'performs a spectacular cartwheel'],
  clap: ['claps loudly for {t}', 'claps loudly'], happy: [null, "can't resist smiling happily"], hiccup: [null, 'hiccups'], hmm: [null, 'humms and umms in deep thoughts'],
  hold: ['holds {t} lovingly', null], honor: [null, 'is extremely honored'], compliment: ['gives {t} a wonderful compliment', null], crown: ['crowns {t} ruler of the room', null],
  cuddle: ['cuddles up with {t}', null], dab: [null, 'hits a perfect dab'], howl: [null, 'lets loose a blood curdling howl at the moon. Hoooowwwll!'],
  hug: ['gives {t} a big hug', 'needs a hug'], kiss: ['kisses {t}', 'blows a kiss'], laugh: ['laughs at {t}', 'laughs out loud'], dance: ['invites {t} to dance', 'dances'],
  disco: [null, 'lights up the room with disco moves'], drumroll: [null, 'starts a dramatic drum roll...'], handshake: ['shakes hands with {t}', null],
  listen: ['looks at {t}, listening intently', 'listens intently'], loser: ["points at {t} and yells 'Loser!'", null], love: ['whispers to {t} sweet words of love', 'is in love'],
  highfive: ['gives {t} a mighty high five', 'raises a hand for a high five'], hop: [null, 'hops around happily'], jump: [null, 'jumps for joy'],
  magic: ['performs a magic trick for {t} ✨', null], miss: ['is very happy to see {t} again', 'misses everyone'], mmm: [null, 'drools. Mmmmm....'],
  wave: ['is waving at {t}', 'is waving'], poke: ['pokes {t} in the ribs.', 'pokes around'], spit: ['spits on {t}!', 'spits'],
  meditate: [null, 'closes their eyes and meditates peacefully'], motivate: ['motivates {t} to keep going!', null], pirate: [null, "shouts, 'Ahoy, MigMeet mateys!'"],
  robot: [null, 'performs the robot dance'], goal: [null, 'scores GOALLLLLLLLLLLLL!'], relax: ['tells {t} to relax', 'relaxes'], smile: ['smiles happily at {t}', 'smiles happily'],
  thank: ['thanks {t} wholeheartedly. Thank you!', 'says thank you'], win: [null, "screams, 'I won the battle!'"], selfie: ['takes a selfie with {t}', null],
  skip: [null, 'skips happily around the room'], sparkle: [null, 'sparkles like a MigMeet star ✨'], spin: [null, 'spins around until everything is dizzy'],
  go: [null, 'cheers for the MigMeet contest team. Go team, go!'], challenge: ['challenges {t} to a MigMeet contest battle', 'is ready for a challenge'],
  luck: ['wishes {t} good luck in the MigMeet contest!', 'wishes everyone good luck in the MigMeet contest!'], salute: ['gives {t} a smart salute', 'salutes'],
  surprise: ['jumps out and surprises {t}!', null], victory: [null, 'strikes a glorious victory pose!'], zoom: [null, 'zooms around the room at lightning speed!'],
  whistle: ['whistles appreciatively at {t}', null], winner: [null, 'wonders who will win this MigMeet contest'], welcome: ['warmly welcomes {t} to the MigMeet world', 'welcomes everyone'],
  offside: [null, "scores a goal, but after the referee's consideration, it's offside. Boo!"], lose: ['lost to {t} in the MigMeet battle. Better luck next time!', 'lost the battle. Better luck next time!'],
});
for (const k of 'crown cuddle magic motivate selfie whistle'.split(' ')) ACT_REQ.add(k);
for (const k of Object.keys(ACTV)) if (!ACT_REQ.has(k) && !ACT_SOLO.has(k) && !ACT_OPT.has(k)) ACT_OPT.add(k);
const SONGS = ["Under a lantern sky we walk, the river hums along, and every star leans in to hear our little midnight song",
  "Oh the rain taps on my window like a drummer keeping time, and the whole wide world is dancing to a gentle rhyme",
  "Come along, come along, to the place where the sunrise grows, we will chase the golden morning wherever the wind blows",
  "Tea is warm and the night is long, so let us sing a silly tune, la la la under the paper-white moon",
  "Hey hey, a new day is calling, shake the sleep from your shoes, we got laughter in our pockets and nothing left to lose",
  "Mango sun and monsoon breeze, a rickshaw bell rings by, we sing it loud, we sing it proud, beneath the open sky",
  "Little boat on a silver stream, carry my worries away, I will whistle you a melody to brighten up the day"];
app.get('/api/commands', auth, (q, r) => r.json({ optional: [...ACT_OPT], required: [...ACT_REQ], solo: [...ACT_SOLO] }));


// ---------- Lucky Packet: /packet <total> <people> drops coins in a room, /grab takes a random share. Unclaimed coins return after 5 minutes. ----------
const packets = new Map(); let packetId = 0;
function dropPacket(ws, total, n) {
  const room = ws.room, u = ws.user;
  if (room.startsWith('dm:')) return reply(ws, 'Lucky packets work in public rooms only.');
  total = Math.floor(total); n = Math.floor(n);
  if (!(n >= 2 && n <= 30)) return reply(ws, 'Usage: /packet <coins> <people>   (2 to 30 people)');
  if (!(total >= n * 10 && total <= 1e7)) return reply(ws, `Total must be at least ${n * 10} coins (10 per person) and at most 10,000,000.`);
  if (!speakOk(ws)) return;
  if (!db.transaction(() => { if (!db.prepare('update users set coins=coins-? where name=? and coins>=?').run(total, u, total).changes) return false; addTx(u, 'other', `Lucky Packet in ${room}`, -total); return true; })()) return reply(ws, 'Not enough coins.');
  const pk = { id: ++packetId, room, from: u, left: total, n, got: new Set() }; packets.set(pk.id, pk);
  pk.timer = setTimeout(() => {
    packets.delete(pk.id);
    if (pk.left > 0) { db.prepare('update users set coins=coins+? where name=?').run(pk.left, u); addTx(u, 'other', 'Lucky Packet refund', pk.left); pushCoins(u); say(room, u, `🧧 The Lucky Packet expired. ${pk.left} unclaimed coins went back to ${u}.`, 'sys'); }
  }, 5 * 60e3);
  pk.timer.unref?.();
  pushCoins(u);
  say(room, u, `🧧 dropped a Lucky Packet: ${total} coins for ${n} people! Type /grab`, 'gift');
}
function grabPacket(ws) {
  const room = ws.room, u = ws.user;
  const pk = [...packets.values()].reverse().find(x => x.room === room && x.n > x.got.size && !x.got.has(u) && x.from !== u);
  if (!pk) return reply(ws, 'No Lucky Packet to grab right now.');
  const remaining = pk.n - pk.got.size;
  const amt = remaining === 1 ? pk.left : 1 + Math.floor(Math.random() * Math.max(1, Math.min(pk.left - remaining, Math.floor(2 * pk.left / remaining) - 1)));
  pk.got.add(u); pk.left -= amt;
  db.prepare('update users set coins=coins+? where name=?').run(amt, u); addTx(u, 'other', `Lucky Packet from ${pk.from}`, amt); pushCoins(u);
  say(room, u, `🧧 grabbed ${amt} coins from ${pk.from}'s Lucky Packet!${pk.got.size >= pk.n ? ' (all taken)' : ''}`, 'gift');
  if (pk.got.size >= pk.n) { clearTimeout(pk.timer); packets.delete(pk.id); }
}

function command(ws, line) {
  const [raw, ...a] = line.slice(1).trim().split(/\s+/);
  const c = (raw || '').toLowerCase(), u = ws.user, room = ws.room, dm = room.startsWith('dm:');
  const other = dm ? room.slice(3).split(':').find(x => x !== u) : null, tgt = a[0] ? a[0].replace(/^@/, '') : null;
  const online = () => [...new Set([...(members.get(room) || [])].map(w => w.user))].filter(n => n !== u);
  const speak = fn => { if (speakOk(ws)) fn(); };
  if (c === 'balance') return reply(ws, `Your balance: ${coins(u)} coins.`);
  if (c === 'packet' || c === 'luckypacket') return dropPacket(ws, +a[0], +a[1]);
  if (c === 'grab') return grabPacket(ws);
  if (c === 'gift' || c === 'g') {
    const mi = a.indexOf('-m'), note = mi > -1 ? a.slice(mi + 1).join(' ').slice(0, 100) : '', p = mi > -1 ? a.slice(0, mi) : a;
    if (!p.length) return reply(ws, 'Usage: /gift username giftname   or   /gift all giftname');
    if (p[0].toLowerCase() === 'all') return dm ? reply(ws, 'Gift shower is unavailable in private chat.') : p[1] ? speak(() => shower(ws, p.slice(1).join(' '))) : reply(ws, 'Usage: /gift all giftname');
    if (dm && giftDef(p.join(' '))) return giftOne(ws, other, p.join(' '), note);
    return p[1] ? giftOne(ws, p[0].replace(/^@/, ''), p.slice(1).join(' '), note) : reply(ws, 'Usage: /gift username giftname');
  }
  if (c === 'f' || c === 'follow') return friendAct(ws, tgt || other);
  if (c === 'block' || c === 'unblock') {
    if (!tgt || tgt === u || !profile(tgt)) return reply(ws, `Usage: /${c} username`);
    if (c === 'block') { db.prepare('insert or ignore into blocks values(?,?)').run(u, tgt); return reply(ws, `${tgt} blocked. Neither of you will see the other's chatroom messages.`); }
    db.prepare('delete from blocks where a=? and b=?').run(u, tgt); return reply(ws, `${tgt} unblocked.`);
  }
  if (c === 'tag') { const p = tgt && profile(tgt); const tb = p && db.prepare('select parent from tags where user=?').get(tgt)?.parent; return reply(ws, p ? (tb ? `${tgt} is tagged by ${tb}.` : `${tgt} has no tag yet.`) : 'Usage: /tag username'); }
  if (c === 'whois') { const p = tgt && profile(tgt); return reply(ws, p ? `username: **${p.name}** [${p.role}]\nlevel: ${p.level}${p.country ? '\ncountry: ' + p.country : ''}${p.gender ? '\ngender: ' + p.gender : ''}` : 'Usage: /whois username', p ? 'info' : 'err'); }
  const act = (txt, kind = 'emote') => speak(() => say(room, u, `** ${txt} **`, kind));
  const rnd = n => Math.floor(Math.random() * n);
  if (c === 'me') return act((u + ' ' + a.join(' ')).trim().slice(0, 200));
  if (c === 'roll') return act(`${u} rolls ${1 + rnd(100)}`);
  if (c === 'sing') return act(`${u} sings ${SONGS[rnd(SONGS.length)]}`);
  if (c === 'getmyluck') { const L = () => rnd(101); return act(`${u}'s luck for day : ❤️ love ${L()}%, 💰 money ${L()}%, 💪 health ${L()}%, 🏆 success ${L()}%`, 'emotep'); }
  if (c === 'findmymatch') {
    let pool = online(); if (!pool.length) pool = db.prepare("select name from users where lower(name)!=? and name!=? and banned=0 order by random() limit 1").all(STAFF_USER, u).map(x => x.name);
    const who = pool[rnd(pool.length)]; if (!who) return reply(ws, 'Nobody else is here to match with.');
    return act(`${u} has been matched with ${who}!\n💘 Compatibility: ${rnd(101)}%`, 'emotep');
  }
  if (c === 'flames') {
    if (!tgt || !profile(tgt)) return reply(ws, 'Usage: /flames username');
    return act(`🔥 FLAMES : ${u} vs ${tgt} = ${flames(u, tgt)}`, 'emotep');
  }
  // moderation
  if (c === 'dmod' && !tgt) return;
  if (['ban', 'unban', 'unkick', 'bump', 'mod', 'dmod', 'smod', 'dsmod'].includes(c)) return moderate(ws, c, tgt);
  if (c === 'kick') return tgt ? moderate(ws, 'kick', tgt) : speak(() => say(room, u, '⚽ ' + u + ' kick'));
  if (c === 'silence') return !a[0] ? reply(ws, 'Usage: /silence <seconds> or /silence <username> <seconds>') : /^\d+$/.test(a[0]) ? moderate(ws, 'silenceall', null, +a[0]) : moderate(ws, 'silence', tgt, +a[1] || 600);
  if (c === 'unsilence') return tgt ? moderate(ws, 'unsilence', tgt) : moderate(ws, 'unsilenceall');
  if (c === 'lock' || c === 'unlock') return moderate(ws, c);
  if (c === 'broadcast') return moderate(ws, 'broadcast', null, 0, a.join(' '));
  if (c === 'announcement') return moderate(ws, 'announce', null, 0, a[0] === 'off' ? '' : a.join(' '));
  // fun actions
  if (ACT_REQ.has(c) || ACT_SOLO.has(c) || ACT_OPT.has(c)) {
    if (ACT_REQ.has(c) && !tgt) return reply(ws, `Usage: /${c} username`);
    const t = !ACT_SOLO.has(c) && tgt ? tgt : null;
    if (t && !profile(t)) return reply(ws, 'User not found.');
    const V = ACTV[c], verb = V ? (t ? V[0] : V[1]) : null;
    return act(`${verb && verb[0] === '=' ? '' : u + ' '}${(verb && verb[0] === '=' ? verb.slice(1) : verb || (t ? `${c}${/s$/.test(c) ? '' : 's'} {t}` : `${c}${/s$/.test(c) ? '' : 's'}`)).replace(/\{t\}/g, t || '').replace(/\{u\}/g, u)}`.trim());
  }
  reply(ws, 'Unknown command. Open Explore → Command List.');
}

// ---------- WebSocket ----------
// Keepalive: phones drop sockets silently; ping often so dead sockets are noticed quickly and live ones are never mistaken for dead
db.exec('create table if not exists room_seen(user text, room text, ts int, primary key(user,room))');
db.exec('create table if not exists room_since(user text, room text, ts int, primary key(user,room))');   // when this person walked into the room: a reload shows everything said since then
// remember who is in which room (survives a server restart), so a quick reconnect is not announced as a new entry
const seenUp = db.transaction(() => { const st = db.prepare('insert into room_seen(user,room,ts) values(?,?,?) on conflict(user,room) do update set ts=excluded.ts'); for (const w of wss.clients) if (w.user && w.room && !w.room.startsWith('dm:')) st.run(w.user, w.room, Date.now()); });
setInterval(() => { try { seenUp(); } catch {} }, 1e3).unref();
setInterval(() => { try { db.prepare('delete from room_seen where ts<?').run(Date.now() - 3600e3); db.exec('delete from room_since where not exists(select 1 from room_seen s where s.user=room_since.user and s.room=room_since.room)'); } catch {} }, 60e3).unref();
const recentlyIn = (u, room) => db.prepare('select 1 from room_seen where user=? and room=? and ts>?').get(u, room, Date.now() - 1800e3);
setInterval(() => { for (const w of wss.clients) { if (w._alive === false) { try { w.terminate(); } catch {} continue; } w._alive = false; try { w.ping(); } catch {} } }, 30e3).unref();
wss.on('connection', ws => {
  ws._alive = true; ws.on('pong', () => { ws._alive = true; }); ws.on('message', () => { ws._alive = true; });
  ws.on('message', raw => { try { onWsMessage(ws, raw); } catch (e) { console.error('[ws]', e); try { send(ws, { t: 'msg', room: ws.room, user: '', text: 'Something went wrong with that command.', kind: 'err', ts: Date.now() }); } catch {} } });
  ws.on('close', () => closeWs(ws));
});
/* ---------- 1-to-1 audio / video calls (WebRTC; the server only passes signals between the two people) ---------- */
const calls = new Map();   // id -> { id, from, to, kind, state: 'ring' | 'live', fromWs, toWs, timer, t0 }
const callOf = u => { for (const c of calls.values()) if (c.from === u || c.to === u) return c; return null; };
const mainSocks = u => [...wss.clients].filter(w => w.user === u && !w.emb && w.readyState === 1);
const lastInvite = new Map();
// Call charges: the caller pays per second while the call is live; the call ends when the coins run out
const CALL_RATE = { audio: 5, video: 10 };
function callBill(c) {
  const rate = CALL_RATE[c.kind] || 5; c.paid = 0;
  const tick = () => {
    if (!calls.has(c.id) || c.state !== 'live') return;
    const ch = db.prepare('update users set coins=coins-? where name=? and coins>=?').run(rate, c.from, rate).changes;
    if (!ch) return callEnd(c, 'nocoins', c.from);
    c.paid += rate; refreshCoins(c.from);
  };
  tick(); c.billT = setInterval(tick, 1000);
}
// Push ringing: sent now and repeated every 12 s while the call is still ringing, so the phone keeps alerting
function callPush(c) {
  const ring = () => { if (!calls.has(c.id) || c.state !== 'ring') return; PUSH.send(c.to, { t: 'call', id: c.id, key: c.key, from: c.from, kind: c.kind }, { ttl: 45, urgency: 'high', topic: 'call' }); };
  ring(); c.pushT = setInterval(ring, 12e3);
}
function callEnd(c, reason, by) {
  if (!calls.has(c.id)) return;
  clearTimeout(c.timer); clearInterval(c.pushT); clearInterval(c.billT); calls.delete(c.id);
  if (c.paid) { try { addTx(c.from, 'other', `${c.kind === 'video' ? 'Video' : 'Audio'} call with ${c.to} (${Math.round(c.paid / (CALL_RATE[c.kind] || 5))} sec)`, -c.paid); } catch (e) { console.log('[call bill]', e.message); } }
  if (c.push) PUSH.send(c.to, { t: 'call_end', id: c.id, from: c.from, kind: c.kind, answered: c.state === 'live', missed: c.state === 'ring' && (reason === 'noanswer' || reason === 'cancelled') }, { ttl: 600, urgency: 'high', topic: 'call' });
  const o = { t: 'call_end', id: c.id, reason, by: by || '' };
  mainSocks(c.from).forEach(w => send(w, o)); mainSocks(c.to).forEach(w => send(w, o));
  try {
    const live = c.state === 'live', status = live ? 'answered' : reason === 'declined' ? 'declined' : 'missed';
    db.prepare('insert into call_log(a,b,kind,status,dur,ts) values(?,?,?,?,?,?)').run(c.from, c.to, c.kind, status, live ? Math.round((Date.now() - c.t0) / 1000) : 0, Date.now());
    for (const u of [c.from, c.to]) db.prepare('delete from call_log where (a=? or b=?) and id not in (select id from call_log where a=? or b=? order by id desc limit 100)').run(u, u, u, u);
  } catch (e) { console.log('[call_log]', e.message); }
  if (c.state === 'ring' && (reason === 'noanswer' || reason === 'cancelled' || reason === 'offline')) notify(c.to, 'social', `Missed ${c.kind} call from ${c.from}`, 'user:' + c.from);
}
function callMsg(ws, m) {
  const me = ws.user, id = String(m.id || '');
  if (m.t === 'call_invite') {
    const to = String(m.to || '').slice(0, 40), kind = m.kind === 'video' ? 'video' : 'audio';
    const fail = reason => send(ws, { t: 'call_end', id: '', reason, to });
    if (Date.now() - (lastInvite.get(me) || 0) < 2500) return fail('wait');
    lastInvite.set(me, Date.now());
    const u = db.prepare('select name,banned from users where lower(name)=lower(?)').get(to);
    if (!u || u.banned || u.name === me) return fail('nouser');
    if (isBlocked(me, u.name)) return fail('blocked');
    if (callOf(me)) return fail('inacall');
    if (coins(me) < (CALL_RATE[kind] || 5)) return fail('nocoins');
    if (callOf(u.name)) return fail('busy');
    const socks = mainSocks(u.name);
    const pres = db.prepare('select presence from users where name=?').get(u.name)?.presence;
    // app closed (no connection): ring the phone/computer with a push notification if the user allowed it
    const seen = socks.some(w => w.vis !== false);   // some open window is on screen right now
    const viaPush = !seen && PUSH.has(u.name);
    // An offline user can still be called. With no connection and no push, the caller sees "Calling…" for up to 15 s while we wait for the
    // user's internet to come back; when they connect the call rings ("Ringing…"), otherwise it ends as unreachable.
    const waiting = !socks.length && !viaPush;
    const c = { id: Math.random().toString(36).slice(2, 12), from: me, to: u.name, kind, state: 'ring', fromWs: ws, toWs: null, t0: Date.now(), key: crypto.randomBytes(12).toString('hex'), push: viaPush, waiting };
    c.timer = setTimeout(() => callEnd(c, waiting ? 'offline' : 'noanswer'), waiting ? 15e3 : viaPush ? 60e3 : 45e3);
    calls.set(c.id, c);
    if (waiting) { send(ws, { t: 'call_wait', id: c.id, to: u.name, kind }); return; }
    send(ws, { t: 'call_ringing', id: c.id, to: u.name, kind });
    socks.forEach(w => send(w, { t: 'call_in', id: c.id, from: me, kind, role: roleOf(me), xp: xpOf(me) }));
    if (viaPush) callPush(c);
    return;
  }
  const c = calls.get(id);
  if (!c) return;
  if (m.t === 'call_accept') {
    if (ws.user !== c.to || c.state !== 'ring') return;
    clearTimeout(c.timer); clearInterval(c.pushT); c.state = 'live'; c.toWs = ws; c.t0 = Date.now();
    callBill(c); if (!calls.has(c.id)) return;
    if (c.push) PUSH.send(c.to, { t: 'call_end', id: c.id, from: c.from, kind: c.kind, answered: true }, { ttl: 60, urgency: 'high', topic: 'call' });   // stop the ringing notification
    mainSocks(c.to).forEach(w => { if (w !== ws) send(w, { t: 'call_end', id: c.id, reason: 'taken' }); });
    send(c.fromWs, { t: 'call_accepted', id: c.id });
  } else if (m.t === 'call_reject') {
    if (ws.user !== c.to || c.state !== 'ring') return;
    callEnd(c, 'declined', me);
  } else if (m.t === 'call_end') {
    if (ws.user !== c.from && ws.user !== c.to) return;
    callEnd(c, c.state === 'ring' ? 'cancelled' : 'ended', me);
  } else if (m.t === 'call_sig') {
    if (c.state !== 'live') return;
    const peer = ws === c.fromWs ? c.toWs : ws === c.toWs ? c.fromWs : null;
    const data = m.data && typeof m.data === 'object' ? m.data : null;
    if (!peer || !data || JSON.stringify(data).length > 24000) return;
    send(peer, { t: 'call_sig', id: c.id, data });
  }
}
function onWsMessage(ws, raw) {
  {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'auth') {
      try { const t = jwt.verify(m.token, SECRET), u = db.prepare('select name,banned from users where id=?').get(t.id); if (!u || u.banned) throw 0; ws.user = u.name; ws.emb = !!m.emb; ws.vis = m.vis !== 0; } catch { return send(ws, { t: 'error', error: 'auth' }); }
      if (m.offline) db.prepare("update users set presence='offline' where name=?").run(ws.user);
      else db.prepare("update users set presence='online' where name=? and presence='offline'").run(ws.user);
      // The phone's connection dropped and came back (e.g. while the user was on Home/Friends): put them back in the room they were in, with the same 30-minute timer
      const gh = ghosts.get(ws.user);
      if (gh) { ghosts.delete(ws.user); clearTimeout(gh._ghostT); if (gh.room && !ws.room && members.has(gh.room)) { members.get(gh.room).delete(gh); ws.room = gh.room; ws.roomAt = gh.roomAt; members.get(gh.room).add(ws); gh.room = null; } }
      send(ws, { t: 'ready', user: ws.user, coins: coins(ws.user), gifts: allGifts(), ucols: activeColors(), ufx: activeFx() });
      if (!ws.emb) for (const c of calls.values()) if (c.to === ws.user && c.state === 'ring') {
        send(ws, { t: 'call_in', id: c.id, from: c.from, kind: c.kind, role: roleOf(c.from), xp: xpOf(c.from) });
        if (c.waiting) { c.waiting = false; clearTimeout(c.timer); c.timer = setTimeout(() => callEnd(c, 'noanswer'), 45e3); send(c.fromWs, { t: 'call_ringing', id: c.id, to: c.to, kind: c.kind }); }   // the user came online: now it rings
      }
      if (!ws.emb && goneAt.has(ws.user)) { goneAt.delete(ws.user); setImmediate(() => userRooms(ws.user).forEach(castRoster)); }
      return online();
    }
    if (!ws.user) return;
    if (typeof m.t === 'string' && m.t.startsWith('call_')) return callMsg(ws, m);
    if (m.t === 'tabs') {
      const old = ws.tabs || new Set();
      ws.tabs = new Set((Array.isArray(m.rooms) ? m.rooms : []).slice(0, 30).map(x => String(x).slice(0, 60)));
      for (const r1 of new Set([...old, ...ws.tabs])) if (old.has(r1) !== ws.tabs.has(r1) && r1 !== ws.room) castRoster(r1);
      for (const r1 of old) if (!ws.tabs.has(r1) && r1 !== ws.room) purgeRoomMsgs(r1);
      return;
    }
    if (m.t === 'leave') {   // the user closed a room tab on purpose
      const r1 = String(m.room || '');
      if (r1 && ws.room === r1) leaveRoom(ws);
      else if (r1 && ws.user) { try { db.prepare('delete from room_seen where user=? and room=?').run(ws.user, r1); db.prepare('delete from room_since where user=? and room=?').run(ws.user, r1); } catch {} }
      if (r1 && ws.room !== r1) { try { ws.tabs && ws.tabs.delete(r1); } catch {} purgeRoomMsgs(r1); }
      return;
    }
    if (m.t === 'bye') { ws._bye = true; return; }
    if (m.t === 'vis') { ws.vis = !!m.v; const was = ws.hiddenAt; if (m.v) { ws._bgOut = 0; ws._bgAll = 0; } ws.hiddenAt = m.v ? 0 : Date.now(); if (m.v && was && Date.now() - was > AWAY_MS) { goneAt.delete(ws.user); online(); userRooms(ws.user).forEach(castRoster); } return; }   // app on screen (true) or in the background (false)   // the browser/tab is closing: show offline without the grace period
    if (m.t === 'logout') {   // signed out: offline, out of every room
      if (!ws.user) return;
      if (m.endpoint) { try { PUSH.drop(ws.user, m.endpoint); } catch {} }
      const u0 = ws.user;
      try { db.prepare("update users set presence='offline' where name=?").run(u0); } catch {}
      for (const w of wss.clients) if (w.user === u0) { try { w.tabs = new Set(); } catch {} }
      ghosts.delete(u0);
      const rooms0 = new Set(); for (const w of wss.clients) if (w.user === u0 && w.room) rooms0.add(w.room);
      for (const w of [...wss.clients]) if (w.user === u0 && w.room) leaveRoom(w);
      for (const r0 of rooms0) { try { db.prepare('delete from room_seen where user=? and room=?').run(u0, r0); db.prepare('delete from room_since where user=? and room=?').run(u0, r0); } catch {} purgeRoomMsgs(r0); }
      online(); return;
    }
    if (m.t === 'join') {
      const ok = roomOk(m.room) && (!/^dm:/.test(m.room) || m.room.slice(3).split(':').includes(ws.user));
      if (!ok) return;
      const bn = db.prepare('select until from bans where room=? and user=?').get(m.room, ws.user);
      if (bn) { if (bn.until === 0 || bn.until > Date.now()) return send(ws, { t: 'denied', room: m.room, error: bn.until ? (() => { const t = Math.round((bn.until - Date.now()) / 1000); return `You are suspended from this chatroom for ${Math.floor(t / 86400)} days ${Math.floor(t % 86400 / 3600)} hours ${Math.floor(t % 3600 / 60)} minutes ${t % 60} seconds.`; })() : 'You are banned from this chatroom.' }); db.prepare('delete from bans where room=? and user=?').run(m.room, ws.user); }
      if (!/^dm:/.test(m.room) && !isSA(ws.user)) {
        const cap = db.prepare('select cap from rooms where name=?').get(m.room)?.cap || 0;
        if (cap) { const here = new Set([...(members.get(m.room) || [])].filter(w => w !== ws).map(w => w.user)); if (!here.has(ws.user) && here.size >= cap) return send(ws, { t: 'denied', room: m.room, error: `This room is full (${cap} users).` }); }
      }
      if (!/^dm:/.test(m.room) && !canMod(m.room, ws.user)) {
        const need = db.prepare('select minlv from rooms where name=?').get(m.room)?.minlv || 0;
        if (need && level(xpOf(ws.user)) < need) return send(ws, { t: 'denied', room: m.room, error: `This room needs level ${need} or higher to enter.` });
      }
      const sameRoom = ws.room === m.room;
      leaveRoom(ws, true);   // switching tabs/rooms is not leaving: no 'left' line, and the 30-minute 'entered' memory is kept
      ws.room = m.room; ws.roomAt = Date.now();
      if (!members.has(m.room)) members.set(m.room, new Set());
      // Tapping Rejoin is a fresh entry: everyone sees 'has entered' and the old chat is not shown again
      if (m.fresh && !/^dm:/.test(m.room)) { try { db.prepare('delete from room_seen where user=? and room=?').run(ws.user, m.room); db.prepare('delete from room_since where user=? and room=?').run(ws.user, m.room); } catch {} }
      const wasHere = !m.fresh && (sameRoom || [...members.get(m.room)].some(w => w.user === ws.user && w !== ws) || !!recentlyIn(ws.user, m.room));
      members.get(m.room).add(ws);
      const isDm = /^dm:/.test(m.room);
      let sinceTs = 0;
      if (!isDm) { try { const row = db.prepare('select ts from room_since where user=? and room=?').get(ws.user, m.room); if (wasHere && row) sinceTs = row.ts; else db.prepare('insert or replace into room_since(user,room,ts) values(?,?,?)').run(ws.user, m.room, Date.now()); } catch {} }
      if (!isDm) send(ws, { t: 'roominfo', room: m.room, owner: ownerOf(m.room) || STAFF_USER, mods: db.prepare('select user from room_mods where room=?').all(m.room).map(x => x.user), supers: db.prepare('select user from room_mods where room=? and super=1').all(m.room).map(x => x.user), cap: db.prepare('select cap from rooms where name=?').get(m.room)?.cap || 0, descr: db.prepare('select descr from rooms where name=?').get(m.room)?.descr || '', minlv: db.prepare('select minlv from rooms where name=?').get(m.room)?.minlv || 0, announce: cfg(m.room).announce || '', users: roster(m.room), fav: !!db.prepare('select 1 from favs where user=? and room=?').get(ws.user, m.room) });
      const hist = db.prepare('select user,text,kind,ts,(select role from users where name=msgs.user) role,(select xp from users where name=msgs.user) xp from msgs where room=? and not exists(select 1 from blocks where (a=? and b=msgs.user) or (b=? and a=msgs.user)) order by id desc limit 50').all(m.room, ws.user, ws.user).reverse();
      const roomHist = (!isDm && sinceTs && !m.have) ? db.prepare('select user,text,kind,ts,(select role from users where name=msgs.user) role,(select xp from users where name=msgs.user) xp from msgs where room=? and ts>=? and not exists(select 1 from blocks where (a=? and b=msgs.user) or (b=? and a=msgs.user)) order by id desc limit 100').all(m.room, sinceTs, ws.user, ws.user).reverse() : [];
      send(ws, { t: 'history', room: m.room, items: isDm ? hist : roomHist });   // rooms: you only see what is said while you are inside
      if (!isDm) { if (!wasHere) cast(m.room, { t: 'enter', room: m.room, user: ws.user, role: roleOf(ws.user), xp: xpOf(ws.user), ts: Date.now() }); castRoster(m.room); }
      if (tp && isTpRoom(m.room)) { ensureTp(m.room); setTimeout(() => send(ws, { t: 'tp', room: m.room, view: tp.getView(m.room, ws.user) }), 50); }
      if (!isDm && gameOf(m.room) && gameOf(m.room) !== 'tp') { ws._gp = null; gpSend(m.room, ws); }
      if (games.has(m.room)) send(ws, unoState(games.get(m.room), ws.user));
    } else if (!ws.room) return;
    else if (m.t === 'msg') {
      ws.roomAt = Date.now();   // talking restarts the 30-minute idle timer
      const text = String(m.text || '').trim().slice(0, 500);
      if (!text) return;
      if (/^\/botlimit(\s|$)/i.test(text)) return botLimit(ws, text);
      if (/^\/bot(\s|$)/i.test(text)) return botCommand(ws, text).catch(e => console.error('[bot]', e));
      if (text[0] === '/') return command(ws, text);
      if (text[0] === '!') return gameRoute(ws, text);
      if (!speakOk(ws)) return;
      const o = { user: ws.user, text, kind: 'msg', ts: Date.now(), role: roleOf(ws.user), xp: xpOf(ws.user) };
      db.prepare('insert into msgs(room,user,text,kind,ts) values(?,?,?,?,?)').run(ws.room, o.user, o.text, o.kind, o.ts);
      if (!ws.room.startsWith('dm:')) notifyMentions(text, ws.user, `in ${ws.room}`, 'room:' + ws.room);
      addXp(ws.user, 1); lbAdd('active', ws.user, 1); roomXp(ws.room, 1);
      cast(ws.room, { t: 'msg', room: ws.room, ...o });
    } else if (m.t === 'media') {
      ws.roomAt = Date.now();
      const url = String(m.url || ''), kind = m.kind === 'voice' ? 'voice' : 'image';
      if (!MEDIA_URL.test(url) || !fs.existsSync('.' + url)) return;
      if (!speakOk(ws)) return;
      const dur = Math.max(0, Math.min(300, Math.round(+m.dur || 0)));
      const o = { user: ws.user, text: kind === 'voice' ? url + '|' + dur : url, kind, ts: Date.now(), role: roleOf(ws.user), xp: xpOf(ws.user) };
      db.prepare('insert into msgs(room,user,text,kind,ts) values(?,?,?,?,?)').run(ws.room, o.user, o.text, o.kind, o.ts);
      cast(ws.room, { t: 'msg', room: ws.room, ...o });
    } else if (m.t === 'gift') { ws.roomAt = Date.now(); giftOne(ws, m.to, m.gift); }
    else if (m.t === 'mod') moderate(ws, m.act, String(m.user || ''), (+m.minutes || 10) * 60);
    else if (m.t === 'uno') unoAct(ws.room, ws.user, m);
  }
}
const ghosts = new Map();
const ROOM_GRACE = AWAY_MS;   // minimised / dropped connections stay in their room this long
function closeWs(ws) {
  if (ws.user && !ws.emb && !hasSock(ws.user)) {
    const u0 = ws.user, rooms0 = userRooms(u0); if (ws.room) rooms0.push(ws.room);
    goneAt.set(u0, ws._bye ? Date.now() - AWAY_MS : Date.now());
    const upd = () => { if (hasSock(u0)) return; online(); [...new Set(rooms0)].filter(x => !x.startsWith('dm:')).forEach(castRoster); };
    setImmediate(upd); if (!ws._bye) setTimeout(upd, AWAY_MS + 1e3);
  }
  try { for (const c of [...calls.values()]) if (c.fromWs === ws || c.toWs === ws) callEnd(c, c.state === 'ring' ? 'cancelled' : 'dropped', ws.user); } catch {}
  // an explicit exit (tab closed / Leave) leaves at once; a dropped connection (app minimised, bad network) keeps the room for a grace period
  const r0 = ws.room;
  const otherTabs = ws.tabs && ws.user ? [...ws.tabs].filter(x => x !== r0 && !x.startsWith('dm:')) : [];
  const doLeave = () => {
    leaveRoom(ws);
    for (const t of otherTabs) {
      if (roomNames(t).has(ws.user)) continue;
      try { db.prepare('delete from room_seen where user=? and room=?').run(ws.user, t); db.prepare('delete from room_since where user=? and room=?').run(ws.user, t); } catch {}
      cast(t, { t: 'leave', room: t, user: ws.user, role: roleOf(ws.user), xp: xpOf(ws.user), ts: Date.now() }); castRoster(t);
    }
    online();
  };
  if (ws._bye || !ws.user) doLeave();
  else setTimeout(() => { if (hasSock(ws.user)) { try { leaveRoom(ws, true); } catch {} return; } doLeave(); }, ROOM_GRACE);
  online();
}
process.on('uncaughtException', e => console.error('[uncaught]', e));
process.on('unhandledRejection', e => console.error('[unhandled]', e));

server.listen(PORT, () => console.log('Migv33 running on :' + PORT));
