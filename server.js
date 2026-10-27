import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let TP = null;   // Teen Patti Gold engine (virtual coins, for fun only); the site still runs if the file is missing
let RB = null;   // Royale Battle engine (room "royale")
try { RB = require('./royale-battle.cjs'); } catch (e) { console.error('[Royale] engine not loaded:', e.message); }
let DC = null;   // Dice Bot engine
try { DC = require('./dice.cjs'); } catch (e) { console.error('[Dice] engine not loaded:', e.message); }
let LC = null;   // LowCard Bot engine (room "lowcard")
try { LC = require('./lowcard.cjs'); } catch (e) { console.error('[LowCard] engine not loaded:', e.message); }
let CB = null;   // Cricket Bot engine (room "cricket")
try { CB = require('./cricket-bot.cjs'); } catch (e) { console.error('[Cricket] engine not loaded:', e.message); }
try { TP = require('./teen-patti.cjs'); } catch (e) { console.error('[TeenPatti] engine not loaded:', e.message); }

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
app.use(express.static('public'));
fs.mkdirSync('uploads', { recursive: true });
app.use('/uploads', express.static('uploads', { maxAge: '7d', setHeaders: res => res.set('X-Content-Type-Options', 'nosniff') }));
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
  if (!/^[A-Za-z0-9._-]{3,16}$/.test(name)) return bad(r, 'Username must be 3–16 characters: English letters, numbers, dot (.), dash (-) or underscore (_).');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 100) return bad(r, 'Enter a valid email address.');
  if (!['Male', 'Female', 'Other'].includes(gender)) return bad(r, 'Select your gender.');
  if (pass.length < 6) return bad(r, 'Password must be at least 6 characters.');
  const em = email.toLowerCase(), ln = name.toLowerCase();
  const claim = ln === STAFF_USER && STAFF_EMAIL && em === STAFF_EMAIL;
  if (!claim && (ln.includes(STAFF_USER) || ['admin', 'staff', 'mentor', 'headmentor', 'merchant', 'support'].includes(ln))) return bad(r, 'That username is reserved.');
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
create table if not exists tp_pending(room text, hand text, user text, amount int);
create table if not exists tp_hands(id integer primary key, ts int, info text);
create table if not exists rb_pending(room text, round int, user text, option text, amount int);
create table if not exists lc_pending(room text, user text, amount int);
create table if not exists mutes(room text, user text, until int, primary key(room,user))`);
for (const a of ['alter table room_mods add column super int default 0', 'alter table rooms add column cap int default 0', "alter table rooms add column descr text default ''", 'alter table rooms add column minlv int default 0']) { try { db.exec(a); } catch {} }
db.exec(`create table if not exists room_game(room text primary key, game text);
create table if not exists kv(k text primary key, v text)`);
const gameOf = room => db.prepare('select game from room_game where room=?').get(room)?.game || '';
for (const [n, c] of [['lobby', 'official'], ['adda', 'official'], ['music', 'official'], ['games', 'game'], ['legendary', 'game'], ['cricket', 'game'], ['lowcard', 'game'], ['royale', 'game']])
  db.prepare('insert or ignore into rooms(name,cat,owner) values(?,?,?)').run(n, c, null);
if (!db.prepare("select 1 from kv where k='games_seeded'").get()) {   // first start only: the four game rooms get their game
  for (const [r, g] of [['legendary', 'tp'], ['cricket', 'cricket'], ['lowcard', 'lowcard'], ['royale', 'royale']]) db.prepare('insert or ignore into room_game values(?,?)').run(r, g);
  db.prepare("insert into kv values('games_seeded','1')").run();
}
const roomOk = n => /^dm:/.test(n) || !!db.prepare('select 1 from rooms where name=?').get(n);
const auth = (q, r, next) => {
  let u;
  try { const t = jwt.verify((q.headers.authorization || '').slice(7), SECRET); u = db.prepare('select name,banned,ban_reason from users where id=?').get(t.id); } catch {}
  if (!u) return bad(r, 'Please log in again', 401);
  if (u.banned) return bad(r, 'Your account has been banned.' + (u.ban_reason ? ' Reason: ' + u.ban_reason : ''), 403);
  q.user = u.name; next();
};
const addTx = (user, kind, title, amount) => db.prepare('insert into txs(user,kind,title,amount,ts) values(?,?,?,?,?)').run(user, kind, title, amount, Date.now());
const roleOf = n => db.prepare('select role from users where name=?').get(n)?.role || 'user';
// ---- Levels: STEPS[L-1] = XP needed to go from level L to L+1. Past level 27 the cost grows by 392.5 per level. ----
const MAXLV = 1000;
const STEPS = [20, 98, 176, 253, 331, 409, 487, 564, 640, 641, 760, 878, 996, 1113, 1231, 1349, 1467, 1584, 1702, 1820, 1938, 2056, 2172, 2290, 2291, 2684, 3076];
const lvStep = L => STEPS[L - 1] ?? Math.round(3076 + 392.5 * (L - 27));
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
  if (after > before) wss.clients.forEach(w => { if (w.user === name) { send(w, { t: 'levelup', level: after, reward: total }); send(w, { t: 'coins', coins: coins(name) }); } });
}
const profile = n => { const u = db.prepare('select name,full_name,gender,country,bio,status_text,presence,xp,coins,role from users where name=?').get(n); return u && { ...u, level: level(u.xp) }; };
const ok = fn => (q, r) => { const f = e => { console.error(e); if (!r.headersSent) bad(r, 'Server error', 500); }; try { const x = fn(q, r); if (x && x.catch) x.catch(f); } catch (e) { f(e); } };
const fstate = (a, b) => {
  const x = db.prepare('select * from friends where (a=? and b=?) or (a=? and b=?)').get(a, b, b, a);
  return !x ? 'none' : x.status === 'accepted' ? 'friends' : x.a === a ? 'sent' : 'incoming';
};

app.get('/api/me', auth, ok((q, r) => { const x = db.prepare('select email,mobile,mpin,sec_q from users where name=?').get(q.user); r.json({ ...profile(q.user), email: x.email, mobile: x.mobile, hasPin: !!x.mpin, secQ: x.sec_q || '', secQs: SEC_QS, unlimited: isMain(q.user) }); }));
app.put('/api/me', auth, ok((q, r) => {
  const { bio, status_text, presence } = q.body || {};
  if (typeof bio === 'string') db.prepare('update users set bio=? where name=?').run(bio.slice(0, 200), q.user);
  if (typeof status_text === 'string') db.prepare('update users set status_text=? where name=?').run(status_text.slice(0, 60), q.user);
  if (['online', 'away', 'busy', 'offline'].includes(presence)) { db.prepare('update users set presence=? where name=?').run(presence, q.user); online(); }
  r.json(profile(q.user));
}));
app.get('/api/users/:n', auth, ok((q, r) => {
  const p = profile(q.params.n); if (!p) return bad(r, 'User not found', 404);
  const fc = db.prepare("select count(*) c from friends where status='accepted' and (a=? or b=?)").get(p.name, p.name).c;
  r.json({ ...p, gifts: db.prepare('select gift,n from gift_inv where user=? order by n desc').all(p.name).map(x => { const g = allGiftsAny(x.gift); return g && { key: x.gift, n: x.n, name: g.n, e: g.e, img: g.img }; }).filter(Boolean), friends: fc, state: q.user === p.name ? 'me' : fstate(q.user, p.name) });
}));
app.post('/api/password', auth, ok((q, r) => {
  const { old = '', pass = '' } = q.body || {};
  const u = db.prepare('select pass from users where name=?').get(q.user);
  if (!bcrypt.compareSync(old, u.pass)) return bad(r, 'Current password is wrong', 403);
  if (pass.length < 6) return bad(r, 'New password must be at least 6 characters');
  db.prepare('update users set pass=? where name=?').run(bcrypt.hashSync(pass, 10), q.user); r.json({ ok: true });
}));

for (const a of ["alter table posts add column image text default ''", 'alter table posts add column pinned int default 0', 'alter table posts add column locked int default 0',
  'alter table posts add column edited int default 0', "alter table reacts add column kind text default 'like'"]) { try { db.exec(a); } catch {} }
db.exec(`create table if not exists post_shares(post int, user text, ts int, primary key(post,user));
create table if not exists post_hidden(user text, post int, primary key(user,post));`);
db.exec(`create table if not exists stories(id integer primary key, user text, image text default '', text text default '', bg int default 0, ts int);
create table if not exists story_views(story int, user text, ts int, primary key(story,user));`);
const isMod = n => ['staff', 'admin'].includes(roleOf(n));
const REACTS = ['like', 'love', 'haha', 'wow', 'sad', 'angry'];
const getPost = id => db.prepare('select * from posts where id=?').get(id);
const imgUrl = u => typeof u === 'string' && MEDIA_URL.test(u) && /\.(jpg|png|gif|webp)$/.test(u);
function dropFile(u) { if (u && MEDIA_URL.test(u) && !db.prepare('select 1 from posts where image=?').get(u) && !db.prepare('select 1 from stories where image=?').get(u) && !db.prepare('select 1 from users where avatar=?').get(u)) fs.unlink('.' + u, () => {}); }
app.get('/api/feed', auth, ok((q, r) => {
  const tag = String(q.query.tag || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 30);
  const rows = db.prepare(`select p.id,p.user,p.text,p.image,p.pinned,p.locked,p.edited,p.ts, p.shares + (select count(*) from post_shares where post=p.id) shares,
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
app.post('/api/posts', auth, ok((q, r) => {
  const text = String(q.body?.text || '').trim().slice(0, 500), image = imgUrl(q.body?.image) ? q.body.image : '';
  if (!text && !image) return bad(r, 'Write something or add a photo first');
  const pid = db.prepare('insert into posts(user,text,image,ts) values(?,?,?,?)').run(q.user, text, image, Date.now()).lastInsertRowid;
  grantAct(q.user, 'post', pid); r.json({ ok: true });
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
  const kind = REACTS.includes(q.body?.kind) ? q.body.kind : 'like';
  const cur = db.prepare('select kind from reacts where post=? and user=?').get(q.params.id, q.user);
  if (cur && cur.kind === kind) db.prepare('delete from reacts where post=? and user=?').run(q.params.id, q.user);
  else { db.prepare('insert or replace into reacts(post,user,kind) values(?,?,?)').run(q.params.id, q.user, kind); if (gp.user !== q.user) grantAct(q.user, 'react', gp.id); }
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
  db.prepare('insert into comments(post,user,text,ts) values(?,?,?,?)').run(q.params.id, q.user, text, Date.now()); if (p.user !== q.user) grantAct(q.user, 'comment', p.id); r.json({ ok: true });
}));
app.post('/api/posts/:id/share', auth, ok((q, r) => {
  const gp = getPost(q.params.id); if (!gp) return bad(r, 'Post not found', 404);
  const ch = db.prepare('insert or ignore into post_shares values(?,?,?)').run(q.params.id, q.user, Date.now()).changes; if (ch && gp.user !== q.user) grantAct(q.user, 'share', gp.id); r.json({ ok: true });
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

app.get('/api/rooms', auth, ok((q, r) => {
  const fav = new Set(db.prepare('select room from favs where user=?').all(q.user).map(x => x.room));
  r.json(db.prepare('select name,cat,cap from rooms').all().map(x => ({ ...x, count: members.get(x.name)?.size || 0, fav: fav.has(x.name) })));
}));
app.post('/api/rooms', auth, ok((q, r) => {
  const name = String(q.body?.name || '').trim().replace(/\s+/g, ' ');
  if (!/^[A-Za-z0-9 ]{5,20}$/.test(name)) return bad(r, 'Room name: 5–20 characters, English letters, numbers and spaces only');
  if (db.prepare('select 1 from rooms where lower(name)=lower(?)').get(name)) return bad(r, 'That room already exists', 409);
  db.prepare('insert into rooms(name,cat,owner) values(?,?,?)').run(name, 'user', q.user); r.json({ ok: true });
}));
app.post('/api/rooms/:n/fav', auth, ok((q, r) => {
  const d = db.prepare('delete from favs where user=? and room=?').run(q.user, q.params.n);
  if (!d.changes) db.prepare('insert or ignore into favs values(?,?)').run(q.user, q.params.n); r.json({ ok: true });
}));

app.get('/api/friends', auth, ok((q, r) => {
  const rows = db.prepare('select * from friends where a=? or b=?').all(q.user, q.user);
  const other = x => (x.a === q.user ? x.b : x.a);
  const info = n => ({ name: n, ...db.prepare('select presence,xp,status_text,role from users where name=?').get(n) });
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
  if (act === 'request' && st === 'none') { db.prepare("insert into friends values(?,?,'pending')").run(q.user, n); if (db.prepare('select verified from users where name=?').get(n)?.verified) grantAct(q.user, 'follow', n); }
  else if (act === 'accept' && st === 'incoming') db.prepare("update friends set status='accepted' where a=? and b=?").run(n, q.user);
  else if (act === 'remove') db.prepare('delete from friends where (a=? and b=?) or (a=? and b=?)').run(q.user, n, n, q.user);
  r.json({ ok: true });
}));

app.get('/api/account', auth, ok((q, r) => {
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const t = db.prepare('select coalesce(sum(case when amount>0 then amount end),0) e, coalesce(-sum(case when amount<0 then amount end),0) s from txs where user=? and ts>=?').get(q.user, day.getTime());
  r.json({ coins: profile(q.user).coins, earned: t.e, spent: t.s, activity: db.prepare('select kind,title,amount,ts from txs where user=? order by id desc limit 50').all(q.user) });
}));
const pinFails = new Map();
function checkPin(name, pin) { // true = ok (or no PIN set), false = wrong, 'locked' = too many tries
  const row = db.prepare('select mpin from users where name=?').get(name); if (!row?.mpin) return true;
  const f = pinFails.get(name) || { n: 0, t: 0 }, now = Date.now(); if (now - f.t > 600e3) { f.n = 0; }
  if (f.n >= 5) return 'locked';
  if (bcrypt.compareSync(String(pin || ''), row.mpin)) { pinFails.delete(name); return true; }
  pinFails.set(name, { n: f.n + 1, t: now }); return false;
}
app.post('/api/transfer', auth, ok((q, r) => {
  const to = String(q.body?.to || ''), amt = Math.floor(+q.body?.amount);
  if (!to || to === q.user || !profile(to)) return bad(r, 'Recipient not found');
  if (!(amt >= 1)) return bad(r, 'Enter an amount of at least 1');
  const pc = checkPin(q.user, q.body?.mpin);
  if (pc === 'locked') return bad(r, 'Too many wrong MPIN attempts. Try again in 10 minutes.', 429);
  if (!pc) return bad(r, 'Wrong or missing MPIN', 403);
  const go = db.transaction(() => {
    if (!db.prepare('update users set coins=coins-? where name=? and coins>=?').run(amt, q.user, amt).changes) throw new Error('funds');
    db.prepare('update users set coins=coins+? where name=?').run(amt, to);
    addTx(q.user, 'transfer', `Sent to ${to}`, -amt); addTx(to, 'transfer', `Received from ${q.user}`, amt);
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
const TIERS = [['red', 1000], ['pink', 500], ['purple', 300]];
const tierOf = p => (TIERS.find(t => p >= t[1]) || [null])[0];
const TASKS = [
  { k: 'gift_sent', t: 'Send gifts in chatrooms', target: 100000, pts: 100, unit: 'gifts' },
  { k: 'gift_recv', t: 'Receive gifts in chatrooms', target: 50000, pts: 100, unit: 'gifts' },
  { k: 'game', t: 'Play games in chatrooms', target: 1000, pts: 100, unit: 'games' },
  { k: 'dm_gift', t: 'Send migmeet gifts', target: 20, pts: 200, unit: 'gifts' }];
const mev = (user, k, n = 1) => { const x = db.prepare('insert into mevents(user,k,n,ts) values(?,?,?,?)').run(user, k, n, Date.now()); if (k === 'game') { try { grantAct(user, 'game', Date.now() + '.' + Math.random()); } catch {} } return x; };
function setRole(name, role, by, reason) {
  const u = db.prepare('select role from users where name=?').get(name); if (!u || u.role === role) return;
  const now = Date.now();
  db.prepare('update users set role=?, role_started_at=?, cycle_start=? where name=?').run(role, now, role === 'merchant' ? now : 0, name);
  db.prepare('insert into role_history(user,from_role,to_role,reason,by,ts) values(?,?,?,?,?,?)').run(name, u.role, role, reason || '', by || 'system', now);
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
  const t = db.prepare('select parent from tags where user=?').get(spender); if (!t) return;
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
  const out = { role: u.role, parent: u.parent, hasPin: !!u.mpin, now, tagCost: TAG_COST, pct: COMM_PCT, minPoints: MIN_PTS, roleStarted: u.role_started_at };
  out.outgoing = db.prepare('select id,to_user,kind,status,ts from role_requests where from_user=? order by id desc limit 1').get(me) || null;
  out.incoming = db.prepare("select id,from_user,kind,ts from role_requests where to_user=? and status='pending' order by id").all(me).map(x => ({ ...x, level: lvOf(x.from_user) }));
  if (u.role === 'user') out.mentors = db.prepare("select name,role,xp from users where role in ('mentor','headmentor') and banned=0 order by name limit 200").all().map(x => ({ name: x.name, role: x.role, level: level(x.xp) }));
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
    out.tagged = db.prepare('select t.user name,t.tagged_at ts,u.xp,u.banned from tags t join users u on u.name=t.user where t.parent=? order by t.tagged_at desc limit 200').all(me).map(x => ({ name: x.name, ts: x.ts, level: level(x.xp) }));
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
  else if (role === 'merchant') { kind = 'mentor'; to = headOf(me); if (!to) return bad(r, 'You have no Head Mentor above you yet. Ask staff to assign one.'); }
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
app.post('/api/tag', auth, ok((q, r) => {
  const me = q.user, to = String(q.body?.to || '').trim();
  if (!(RANK[roleOf(me)] >= 1)) return bad(r, 'Only Merchants and Mentors can tag users.', 403);
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
      const tx = addTx(me, 'transfer', `Tagged ${to} (50,000 coins)`, -TAG_COST); addTx(to, 'transfer', `Tag gift from ${me}`, TAG_COST);
      db.prepare('insert into tags(user,parent,tagged_at,tx_id) values(?,?,?,?)').run(to, me, Date.now(), tx.lastInsertRowid);
    })();
  } catch (e) { return bad(r, e.message === 'funds' ? `You need ${TAG_COST.toLocaleString()} coins to tag a user.` : 'This user is already tagged.', e.message === 'funds' ? 400 : 409); }
  pushCoins(me, to); r.json({ ok: true });
}));



// ---------- Staff: rooms (rename, capacity) ----------
const ROOM_TABLES = [['rooms', 'name'], ['favs', 'room'], ['bans', 'room'], ['room_mods', 'room'], ['room_cfg', 'room'], ['mutes', 'room'], ['msgs', 'room'], ['room_game', 'room'], ['tp_pending', 'room'], ['rb_pending', 'room'], ['lc_pending', 'room']];
app.get('/api/admin/rooms', auth, ok((q, r) => {
  if (!staffOnly(q, r)) return;
  r.json(db.prepare('select name,cat,owner,cap from rooms order by cat,name').all().map(x => ({ ...x, count: new Set([...(members.get(x.name) || [])].map(w => w.user)).size, game: gameOf(x.name) })));
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
app.post('/api/admin/rooms/cap', auth, ok((q, r) => {
  if (!staffOnly(q, r)) return;
  const name = String(q.body?.room || ''), cap = Math.floor(+q.body?.cap);
  if (!db.prepare('select 1 from rooms where name=?').get(name)) return bad(r, 'Room not found', 404);
  if (!(cap >= 0 && cap <= 5000)) return bad(r, 'User limit must be between 0 (no limit) and 5000.');
  db.prepare('update rooms set cap=? where name=?').run(cap, name);
  alog(q.user, name, 'room_cap', cap ? String(cap) : 'unlimited'); cast(name, { t: 'roomcap', room: name, cap }); r.json({ ok: true });
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
  ['mutes', 'user'], ['tp_pending', 'user'], ['post_shares', 'user'], ['post_hidden', 'user'], ['stories', 'user'], ['story_views', 'user'], ['friends', 'a'], ['friends', 'b'], ['blocks', 'a'], ['blocks', 'b'], ['rooms', 'owner'], ['users', 'parent'], ['role_requests', 'from_user'], ['role_requests', 'to_user'], ['role_requests', 'decided_by'], ['tags', 'user'], ['tags', 'parent'], ['commissions', 'spender'], ['commissions', 'parent'], ['mevents', 'user'], ['payouts', 'user'], ['role_history', 'user'], ['role_history', 'by'], ['gift_inv', 'user'], ['lc_pending', 'user'], ['rb_pending', 'user']];   // room-name tables are handled by the room rename
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
  role: u.role, verified: !!u.verified, banned: !!u.banned, ban_reason: u.ban_reason, xp: u.xp, level: level(u.xp), coins: u.coins, unlimited: isMain(u.name), hasPin: !!u.mpin, secQ: u.sec_q, avatar: u.avatar || '', parent: u.parent || '', taggedBy: db.prepare('select parent from tags where user=?').get(u.name)?.parent || '', history: db.prepare('select from_role,to_role,reason,by,ts from role_history where user=? order by id desc limit 8').all(u.name) });
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
    if (!/^[A-Za-z0-9._-]{3,16}$/.test(nn)) return bad(r, 'ID must be 3–16 characters: English letters, numbers, dot, dash or underscore.');
    if (isMain(nn) || ['admin', 'staff', 'mentor', 'headmentor', 'merchant', 'support'].includes(nn.toLowerCase())) return bad(r, 'That ID is reserved.');
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
  if (a === 'verify') { db.prepare('update users set verified=? where id=?').run(b.on ? 1 : 0, u.id); return done(b.on ? 'on' : 'off'); }
  if (a === 'avatar_remove') {
    const old = u.avatar; db.prepare("update users set avatar='' where id=?").run(u.id);
    if (old && MEDIA_URL.test(old)) fs.unlink('.' + old, () => {}); return done();
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
    const old = db.prepare('select avatar from users where name=?').get(q.user)?.avatar;
    db.prepare('update users set avatar=? where name=?').run(url, q.user);
    if (old && MEDIA_URL.test(old)) fs.unlink('.' + old, () => {});
  }
  r.json({ url });
});
app.delete('/api/me/avatar', auth, (q, r) => {
  const old = db.prepare('select avatar from users where name=?').get(q.user)?.avatar;
  db.prepare("update users set avatar='' where name=?").run(q.user);
  if (old && MEDIA_URL.test(old)) fs.unlink('.' + old, () => {});
  r.json({ ok: true });
});
app.get('/api/avatars', auth, (q, r) => r.json(Object.fromEntries(db.prepare("select name, avatar from users where avatar != ''").all().map(u => [u.name, u.avatar]))));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const members = new Map(); // room -> Set<ws>
const send = (ws, o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
const cast = (room, o) => {
  members.get(room)?.forEach(w => { if (o.user && w.user !== o.user && isBlocked(o.user, w.user)) return; send(w, o); });
  // people who have this room open as a tab but are looking at another room get the message too (shown as unread)
  if (o.t === 'msg' && ['msg', 'image', 'voice'].includes(o.kind)) wss.clients.forEach(w => { if (w.user && w.user !== o.user && w.room !== room && w.tabs && w.tabs.has(room) && !isBlocked(o.user, w.user)) send(w, { ...o, bg: 1 }); });
};
const online = () => {
  const l = [...new Set([...wss.clients].filter(w => w.user).map(w => w.user))]
    .map(n => ({ name: n, ...db.prepare('select presence,role,xp from users where name=?').get(n) })).filter(u => u.presence !== 'offline');
  wss.clients.forEach(w => send(w, { t: 'online', list: l }));
};
const coins = n => db.prepare('select coins from users where name=?').get(n).coins;
// Normal users are removed from a public room 30 minutes after joining. Staff/admins and the room's admin/moderators stay.
const ROOM_STAY_MS = 30 * 60e3;
setInterval(() => {
  const now = Date.now();
  wss.clients.forEach(w => {
    if (!w.room || !w.user || w.room.startsWith('dm:') || !w.roomAt || now - w.roomAt < ROOM_STAY_MS) return;
    if (canMod(w.room, w.user)) return;
    const r = w.room; leaveRoom(w); send(w, { t: 'kicked', room: r, by: 'system', auto: true });
  });
}, 60e3).unref();
const roster = room => [...new Set([...(members.get(room) || [])].map(w => w.user))].map(n => ({ name: n, ...db.prepare('select role,xp,presence from users where name=?').get(n) })).filter(u => u.presence !== 'offline');
const castRoster = room => { if (room && !/^dm:/.test(room)) cast(room, { t: 'members', room, list: roster(room) }); };
const leaveRoom = (ws, quiet = false) => {
  const r0 = ws.room; if (!r0) return; members.get(r0)?.delete(ws); ws.room = null;
  if (!quiet && !r0.startsWith('dm:') && ws.user && ![...(members.get(r0) || [])].some(w => w.user === ws.user)) cast(r0, { t: 'leave', room: r0, user: ws.user, role: roleOf(ws.user), xp: xpOf(ws.user), ts: Date.now() });
  castRoster(r0);
  if (!quiet) purgeRoomMsgs(r0);
};
// Chat rooms keep no history: when the last person leaves, every text / photo / voice note of that room is deleted
const purgeRoomMsgs = room => {
  if (!room || room.startsWith('dm:') || (members.get(room)?.size || 0) > 0) return;
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
      const btx = addTx(userId, 'game', 'Teen Patti Gold: bet', -amount); mev(userId, 'game'); commissionOn(userId, amount, 'game', btx.lastInsertRowid);
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
      const tx = addTx(user, 'game', 'Cricket Bot: entry fee', -amount); mev(user, 'game'); commissionOn(user, amount, 'game', tx.lastInsertRowid); return true;
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
      const tx = addTx(user, 'game', `${label}: entry fee`, -amount); mev(user, 'game'); commissionOn(user, amount, 'game', tx.lastInsertRowid); return true;
    })();
    if (ok) pushCoins(user); return ok;
  },
  settle: async (room, winner, prize) => {
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
      const tx = addTx(userId, 'game', `Royale Battle: bet on ${option}`, -amount); mev(userId, 'game'); commissionOn(userId, amount, 'game', tx.lastInsertRowid);
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
  store: rbStore,
  isAdmin: async u => !!u.isAdmin,
  config: { ...RB.CONFIG, COIN_NAME: 'coins' },
  onRound: info => { try { db.prepare('insert into tp_hands(ts,info) values(?,?)').run(Date.now(), JSON.stringify({ game: 'royale', ...info })); } catch {} },
});
royale?.init().catch(e => console.error('[Royale] init failed', e));
setInterval(() => { try { royale?.savePlanners(); } catch {} }, 30e3).unref();

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
  if (cur === 'tp' && tp?.rooms.has(room)) { await tp.handleMessage(room, SYSADMIN, '/bot stop'); if (tp.rooms.has(room)) return false; }
  if (cur === 'royale' && royale?.rooms.has(room)) { await royale.handleMessage(room, SYSADMIN, '/bot stop'); if (royale.rooms.has(room)) return false; }
  db.prepare('delete from room_game where room=?').run(room); return true;
}
async function botCommand(ws, text) {
  const room = ws.room, u = ws.user, [, name = '', arg = ''] = text.trim().toLowerCase().split(/\s+/);
  if (room.startsWith('dm:')) return reply(ws, 'Game bots work in public rooms only.');
  if (!canMod(room, u)) return reply(ws, 'Only staff, the room admin or room moderators can use /bot.');
  const cur = gameOf(room);
  if (name === 'stop') {
    if (!cur) return reply(ws, 'No game bot is running in this room.');
    if (!isSA(u) && !POT_GAMES.includes(cur)) return reply(ws, 'Only staff or admins can stop that bot.');
    if (!(await stopGame(room))) return reply(ws, 'A game is running right now. Try again when it ends.');
    return say(room, u, `🛑 ${GAME_LABEL[cur]} was stopped by ${u}`, 'sys');
  }
  const g = GAME_NAMES[name];
  if (!g) return reply(ws, 'Usage: /bot cricket | lowcard | dice   (staff/admins also: teenpatti | royalebattle)   ·   /bot stop');
  if (!isSA(u) && !POT_GAMES.includes(g)) return reply(ws, 'Only staff or admins can start Teen Patti and Royale Battle.');
  if (!{ tp, cricket, lowcard, dice, royale }[g]) return reply(ws, 'That game is not installed on the server.');
  if (cur && cur !== g && !(await stopGame(room))) return reply(ws, `${GAME_LABEL[cur]} is running right now. Try again when it ends.`);
  db.prepare('insert or replace into room_game values(?,?)').run(room, g);
  if (g === 'tp') await tp.handleMessage(room, SYSADMIN, '/bot teenpatti ' + (/^\d+$/.test(arg) ? arg : TP_BOOT));
  else if (g === 'royale') await royale.handleMessage(room, SYSADMIN, '/bot royalebattle');
  else if (g === 'lowcard' && /^\d+$/.test(arg)) lowcard.admin(room, true, `/bot lowcard ${arg}`);
  if (cur !== g) say(room, u, `🎮 ${GAME_LABEL[g]} is on in this room (started by ${u}). Type !start to play.`, 'sys');
}
const potTop = () => 'Top players: ' + db.prepare('select name,coins from users where lower(name)!=? order by coins desc limit 5').all(STAFF_USER).map((x, i) => `${i + 1}. ${x.name} (${x.coins})`).join(' · ');
function gameRoute(ws, text) {
  const room = ws.room, g = gameOf(room);
  if (!g) return reply(ws, 'No game bot is running in this room. Staff, the room admin or moderators can start one with /bot cricket, /bot lowcard or /bot dice.');
  if (!speakOk(ws)) return;
  const u = { id: ws.user, name: ws.user, isAdmin: isSA(ws.user) }, lo = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (g === 'tp') { ensureTp(room); return tp.handleMessage(room, u, text).catch(e => console.error('[TeenPatti]', e)); }
  if (g === 'royale') {
    const pre = !royale.rooms.has(room) ? royale.handleMessage(room, SYSADMIN, '/bot royalebattle') : Promise.resolve();
    return pre.then(() => royale.handleMessage(room, u, text)).catch(e => console.error('[Royale]', e));
  }
  if (g === 'cricket' || g === 'lowcard' || g === 'dice') {
    if (lo === '!bal') return reply(ws, `Your balance: ${coins(ws.user)} coins.`);
    if (lo === '!top') return reply(ws, potTop());
    const bot = { cricket, lowcard, dice }[g];
    return bot.handle(room, ws.user, text, isSA(ws.user)).catch(e => console.error('[' + g + ']', e));
  }
}
const ensureTp = room => { if (tp && isTpRoom(room) && !tp.rooms.has(room)) tp.handleMessage(room, { id: 'system', name: 'System', isAdmin: true }, '/bot teenpatti ' + TP_BOOT); };
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
const reply = (ws, text) => send(ws, { t: 'msg', room: ws.room, user: '', text: '🔒 ' + text, kind: 'sys', ts: Date.now() });
const say = (room, user, text, kind = 'action') => {
  const o = { user, text, kind, ts: Date.now(), role: roleOf(user), xp: xpOf(user) };
  if (kind !== 'sys') db.prepare('insert into msgs(room,user,text,kind,ts) values(?,?,?,?,?)').run(room, user, text, kind, o.ts);
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
  const note = x => say(room, u, x, 'sys');
  const L = n => `${n} [${level(xpOf(n))}]`;
  const evict = () => [...(members.get(room) || [])].filter(w => w.user === t).forEach(w => { members.get(room).delete(w); w.room = null; send(w, { t: 'kicked', room, by: u }); });
  const suspend = ms => { db.prepare('insert or replace into bans values(?,?,?,?,?)').run(room, t, u, Date.now(), ms ? Date.now() + ms : 0); evict(); };
  const s = Math.min(86400, Math.max(1, Math.floor(secs) || 600));
  if (act === 'kick') { suspend(3600e3); note(`${L(t)} was kicked for 1 hour by ${L(u)}`); }
  else if (act === 'bump') { suspend(300e3); note(`${L(t)} was bumped for 5 minutes by ${L(u)}`); }
  else if (act === 'ban') { suspend(0); note(`${L(t)} was banned by ${L(u)}`); }
  else if (act === 'unban') { db.prepare('delete from bans where room=? and user=? and until=0').run(room, t); note(`${L(t)} was unbanned by ${L(u)}`); }
  else if (act === 'unkick') { db.prepare('delete from bans where room=? and user=? and until>0').run(room, t); note(`${L(t)}'s suspension was removed by ${L(u)}`); }
  else if (act === 'silence') { db.prepare('insert or replace into mutes values(?,?,?)').run(room, t, Date.now() + s * 1000); note(`${L(t)} was silenced for ${fmt(s)} by ${L(u)}`); }
  else if (act === 'unsilence') { db.prepare('delete from mutes where room=? and user=?').run(room, t); note(`${L(t)} can talk again (by ${L(u)})`); }
  else if (act === 'silenceall') { setCfg(room, 'silence_until', Date.now() + s * 1000); note(`Room silenced for ${fmt(s)} by ${u}`); }
  else if (act === 'unsilenceall') { setCfg(room, 'silence_until', 0); note(`Room silence lifted by ${u}`); }
  else if (act === 'lock') { setCfg(room, 'locked', 1); note(`Room locked by ${u}`); }
  else if (act === 'unlock') { setCfg(room, 'locked', 0); note(`Room unlocked by ${u}`); }
  else if (act === 'mod') { db.prepare('insert or ignore into room_mods values(?,?)').run(room, t); note(`${L(t)} is now a room moderator (by ${L(u)})`); }
  else if (act === 'dmod') {
    if (isSuper(room, t) && !(ownerOf(room) === u || isSA(u))) return err('Only the room admin can remove a super moderator.');
    db.prepare('delete from room_mods where room=? and user=?').run(room, t); note(`${t} is no longer a room moderator`);
  }
  else if (act === 'smod') { if (t === ownerOf(room)) return err('That is the room admin.'); db.prepare('insert into room_mods(room,user,super) values(?,?,1) on conflict(room,user) do update set super=1').run(room, t); note(`${L(t)} is now a super moderator (by ${L(u)})`); }
  else if (act === 'dsmod') { db.prepare('update room_mods set super=0 where room=? and user=?').run(room, t); note(`${t} is no longer a super moderator (still a moderator)`); }
  else if (act === 'broadcast') { if (!text) return err('Usage: /broadcast message'); note('📢 ' + text.slice(0, 300)); }
  else if (act === 'announce') { setCfg(room, 'announce', text.slice(0, 300)); note(text ? `📌 Announcement set by ${u}` : `Announcement removed by ${u}`); }
}

const giftDef = key => {
  key = String(key || '').toLowerCase();
  if (GIFTS[key]) return { ...GIFTS[key], key, r: Math.floor(GIFTS[key].c / 2) };
  const g = db.prepare('select * from gifts where key=? and active=1').get(key);
  return g ? { key, n: g.name, c: g.cost, r: g.recv, e: '🎁', img: g.icon } : null;
};
const allGifts = () => { const o = {}; for (const [k, g] of Object.entries(GIFTS)) o[k] = { ...g, r: Math.floor(g.c / 2) };
  for (const g of db.prepare('select * from gifts where active=1 order by ts').all()) o[g.key] = { n: g.name, c: g.cost, r: g.recv, e: '🎁', img: g.icon }; return o; };
const allGiftsAny = key => { if (GIFTS[key]) return GIFTS[key]; const g = db.prepare('select name n,icon img from gifts where key=?').get(key); return g && { ...g, e: '🎁' }; };
const giftIcon = gf => gf.img ? `[g:${gf.img}] ` : gf.e + ' ';
const payGift = (from, to, gf, ctx = 'room') => db.transaction(() => {
  if (!db.prepare('update users set coins=coins-? where name=? and coins>=?').run(gf.c, from, gf.c).changes) return false;
  const rc = gf.r ?? Math.floor(gf.c / 2);
  db.prepare('update users set coins=coins+? where name=?').run(rc, to);
  db.prepare('insert into gift_inv(user,gift,n) values(?,?,1) on conflict(user,gift) do update set n=n+1').run(to, gf.key || gf.n.toLowerCase());
  const tx = addTx(from, 'gift', `Sent ${gf.n} to ${to}`, -gf.c); addTx(to, 'gift', `${gf.n} from ${from}`, rc);
  mev(from, ctx === 'dm' ? 'dm_gift' : 'gift_sent'); if (ctx !== 'dm') mev(to, 'gift_recv');
  commissionOn(from, gf.c, 'gift', tx.lastInsertRowid);
  return true;
})();
function giftOne(ws, to, key, note = '') {
  const gf = giftDef(key);
  if (!gf) return reply(ws, `Unknown gift. Try: ${Object.keys(allGifts()).join(', ')}`);
  if (!to || to === ws.user || !profile(to)) return reply(ws, 'Pick another valid user.');
  if (isBlocked(ws.user, to)) return reply(ws, "You can't gift this user.");
  if (!speakOk(ws)) return;
  if (!payGift(ws.user, to, gf, ws.room?.startsWith('dm:') ? 'dm' : 'room')) return reply(ws, 'Not enough coins.');
  say(ws.room, ws.user, `${giftIcon(gf)}sent ${gf.n} to ${to} [${level(xpOf(to))}]`, 'gift');
  if (note) wss.clients.forEach(w => w.user === to && w.room === ws.room && reply(w, `Private note from ${ws.user}: ${note}`));
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
  to.forEach(n => payGift(ws.user, n, gf, 'room'));
  say(ws.room, ws.user, `${giftIcon(gf)}sent a ${gf.n} to all ${to.length} members here`, 'gift'); refreshCoins(ws.user, ...to);
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
  const n = x.length + y.length || 1, F = ['Friends', 'Lovers', 'Affection', 'Marriage', 'Enemies', 'Siblings']; let i = 0;
  while (F.length > 1) { i = (i + n - 1) % F.length; F.splice(i, 1); }
  return F[0];
}
const set = x => new Set(x.split(' '));
const ACT_REQ = set('slap boo cmon comfort congrat french glare hold pinch poke handball snuggle ruffle warn1 chase compliment duel fistbump handshake pat punch rescue surprise tease tickle whisper');
const ACT_SOLO = set('sick caff doh drunk eek happy hiccup hmm honor howl hum joy lag mmm goal win go yawn champion winner offside gold frenzy record snore wohoo worthy shmoo kickgoal freekick ponder bounce cartwheel dab disco drumroll hop jump meditate moonwalk ninja pirate rage robot rock skip sparkle spin stomp stretch victory volcano waddle yoga zombie zoom');
const ACT_OPT = set('shy wink sorry agree apologize argh bark bearhug beg beer blink blowk blush bored bow brb burp cheer chicken chuckle confuse cringe cry drool duck eh embrace faint fart firebreath flirt frown gasp gee giggle gn greet grin groan hfive hug kiss laugh listen loser love martian miss wave spit relax smile thank shiver challenge luck seduce stare salute worship welcome red yellow lose cheers shrug spock purr whop sigh squirt nod warn airkiss applaud boop celebrate clap crown cuddle dance facepalm flex highfive kneel magic motivate party peace pray roar salsa scream selfie shake singalong sneak superhero swoon think thumbsup toast trip whistle');
const EMO = { kiss: '😘', hug: '🤗', bearhug: '🤗', wave: '👋', cry: '😢', laugh: '😂', giggle: '🤭', wink: '😉', shy: '😳', blush: '😊', smile: '😄', grin: '😁', love: '❤️', clap: '👏', applaud: '👏', cheer: '🎉', party: '🥳', dance: '💃', slap: '🖐️', punch: '👊', poke: '👉', highfive: '🙌', hfive: '🙌', fistbump: '🤜', handshake: '🤝', pray: '🙏', sorry: '🙏', thumbsup: '👍', yawn: '🥱', snore: '😴', sick: '🤒', drunk: '🥴', beer: '🍺', toast: '🥂', cheers: '🥂', salute: '🫡', crown: '👑', winner: '🏆', champion: '🏆', victory: '✌️', peace: '☮️', rage: '😡', scream: '😱', roar: '🦁', robot: '🤖', ninja: '🥷', zombie: '🧟', disco: '🪩', rock: '🤘', yoga: '🧘', meditate: '🧘', think: '🤔', hmm: '🤔', shrug: '🤷', facepalm: '🤦', flex: '💪', magic: '✨', sparkle: '✨', selfie: '🤳' };
const SONGS = ['La la laa, the server is humming a tune!', 'Doo-be-doo, coins in my pocket and friends in the room!', 'Na na na, typing songs with both thumbs!', 'Hey ho, hey ho, a chat room we shall go!', 'Sha-la-la, nobody told the wifi to stop!'];
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
    if (p[0] === 'all') return dm ? reply(ws, 'Gift shower is unavailable in private chat.') : speak(() => shower(ws, p[1]));
    return dm && p.length === 1 ? giftOne(ws, other, p[0], note) : giftOne(ws, p[0], p[1], note);
  }
  if (c === 'f' || c === 'follow') return friendAct(ws, tgt || other);
  if (c === 'block' || c === 'unblock') {
    if (!tgt || tgt === u || !profile(tgt)) return reply(ws, `Usage: /${c} username`);
    if (c === 'block') { db.prepare('insert or ignore into blocks values(?,?)').run(u, tgt); return reply(ws, `${tgt} is blocked. Neither of you will see the other's room messages.`); }
    db.prepare('delete from blocks where a=? and b=?').run(u, tgt); return reply(ws, `${tgt} is unblocked.`);
  }
  if (c === 'tag') { const p = tgt && profile(tgt); const tb = p && db.prepare('select parent from tags where user=?').get(tgt)?.parent; return reply(ws, p ? (tb ? `${tgt} is tagged by ${tb}.` : `${tgt} is not tagged.`) : 'Usage: /tag username'); }
  if (c === 'whois') { const p = tgt && profile(tgt); return reply(ws, p ? `${p.name}: role ${p.role}, level ${p.level}, gender ${p.gender || 'not set'}, country ${p.country || 'not set'}.` : 'Usage: /whois username'); }
  if (c === 'me') return speak(() => say(room, u, `✨ ${u} ✨`));
  if (c === 'roll') return speak(() => say(room, u, `🎲 ${u} rolled ${1 + Math.floor(Math.random() * 100)} (1–100)`));
  if (c === 'sing') return speak(() => say(room, u, `🎤 ${u}: ${SONGS[Math.floor(Math.random() * SONGS.length)]}`));
  if (c === 'getmyluck') { const L = k => seed(u + day() + k) % 101; return speak(() => say(room, u, `🍀 ${u}'s luck today: love ${L('l')}%, money ${L('m')}%, health ${L('h')}%, success ${L('s')}%`)); }
  if (c === 'flames' || c === 'findmymatch') {
    const who = c === 'flames' && tgt ? tgt : online()[Math.floor(Math.random() * online().length)];
    if (!who || !profile(who)) return reply(ws, c === 'flames' ? 'Usage: /flames username' : 'Nobody else is here to match with.');
    return speak(() => say(room, u, c === 'flames' ? `🔥 FLAMES: ${u} & ${who} = ${flames(u, who)}` : `💘 ${u} & ${who}: ${40 + seed([u, who].sort().join() + day()) % 61}% compatible`));
  }
  // moderation
  if (['ban', 'unban', 'unkick', 'bump', 'mod', 'dmod', 'smod', 'dsmod'].includes(c)) return moderate(ws, c, tgt);
  if (c === 'kick') return tgt ? moderate(ws, 'kick', tgt) : speak(() => say(room, u, '⚽ ' + u + ' kick'));
  if (c === 'silence') return !a[0] ? moderate(ws, 'silenceall', null, 600) : /^\d+$/.test(a[0]) ? moderate(ws, 'silenceall', null, +a[0]) : moderate(ws, 'silence', tgt, +a[1] || 600);
  if (c === 'unsilence') return tgt ? moderate(ws, 'unsilence', tgt) : moderate(ws, 'unsilenceall');
  if (c === 'lock' || c === 'unlock') return moderate(ws, c);
  if (c === 'broadcast') return moderate(ws, 'broadcast', null, 0, a.join(' '));
  if (c === 'announcement') return moderate(ws, 'announce', null, 0, a[0] === 'off' ? '' : a.join(' '));
  // fun actions
  if (ACT_REQ.has(c) || ACT_SOLO.has(c) || ACT_OPT.has(c)) {
    if (ACT_REQ.has(c) && !tgt) return reply(ws, `Usage: /${c} username`);
    const t = !ACT_SOLO.has(c) && tgt ? tgt : null;
    if (t && !profile(t)) return reply(ws, 'User not found.');
    return speak(() => say(room, u, `${EMO[c] || '✨'} ${u} ${c}${t ? ' → ' + t : ''}`));
  }
  reply(ws, 'Unknown command. Open Explore → Command List.');
}

// ---------- WebSocket ----------
wss.on('connection', ws => {
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'auth') {
      try { const t = jwt.verify(m.token, SECRET), u = db.prepare('select name,banned from users where id=?').get(t.id); if (!u || u.banned) throw 0; ws.user = u.name; } catch { return send(ws, { t: 'error', error: 'auth' }); }
      if (m.offline) db.prepare("update users set presence='offline' where name=?").run(ws.user);
      else db.prepare("update users set presence='online' where name=? and presence='offline'").run(ws.user);
      send(ws, { t: 'ready', user: ws.user, coins: coins(ws.user), gifts: allGifts() });
      return online();
    }
    if (!ws.user) return;
    if (m.t === 'tabs') { ws.tabs = new Set((Array.isArray(m.rooms) ? m.rooms : []).slice(0, 30).map(x => String(x).slice(0, 60))); return; }
    if (m.t === 'join') {
      const ok = roomOk(m.room) && (!/^dm:/.test(m.room) || m.room.slice(3).split(':').includes(ws.user));
      if (!ok) return;
      const bn = db.prepare('select until from bans where room=? and user=?').get(m.room, ws.user);
      if (bn) { if (bn.until === 0 || bn.until > Date.now()) return send(ws, { t: 'denied', room: m.room, error: bn.until ? 'You are suspended from this room for a while.' : 'You are banned from this room.' }); db.prepare('delete from bans where room=? and user=?').run(m.room, ws.user); }
      if (!/^dm:/.test(m.room) && !isSA(ws.user)) {
        const cap = db.prepare('select cap from rooms where name=?').get(m.room)?.cap || 0;
        if (cap) { const here = new Set([...(members.get(m.room) || [])].filter(w => w !== ws).map(w => w.user)); if (!here.has(ws.user) && here.size >= cap) return send(ws, { t: 'denied', room: m.room, error: `This room is full (${cap} users).` }); }
      }
      if (!/^dm:/.test(m.room) && !canMod(m.room, ws.user)) {
        const need = db.prepare('select minlv from rooms where name=?').get(m.room)?.minlv || 0;
        if (need && level(xpOf(ws.user)) < need) return send(ws, { t: 'denied', room: m.room, error: `This room needs level ${need} or higher to enter.` });
      }
      leaveRoom(ws, ws.room === m.room);
      ws.room = m.room; ws.roomAt = Date.now();
      if (!members.has(m.room)) members.set(m.room, new Set());
      const wasHere = [...members.get(m.room)].some(w => w.user === ws.user && w !== ws);
      members.get(m.room).add(ws);
      const isDm = /^dm:/.test(m.room);
      if (!isDm) send(ws, { t: 'roominfo', room: m.room, owner: ownerOf(m.room) || STAFF_USER, mods: db.prepare('select user from room_mods where room=?').all(m.room).map(x => x.user), supers: db.prepare('select user from room_mods where room=? and super=1').all(m.room).map(x => x.user), cap: db.prepare('select cap from rooms where name=?').get(m.room)?.cap || 0, descr: db.prepare('select descr from rooms where name=?').get(m.room)?.descr || '', minlv: db.prepare('select minlv from rooms where name=?').get(m.room)?.minlv || 0, announce: cfg(m.room).announce || '', users: roster(m.room), fav: !!db.prepare('select 1 from favs where user=? and room=?').get(ws.user, m.room) });
      const hist = db.prepare('select user,text,kind,ts,(select role from users where name=msgs.user) role,(select xp from users where name=msgs.user) xp from msgs where room=? and not exists(select 1 from blocks where (a=? and b=msgs.user) or (b=? and a=msgs.user)) order by id desc limit 50').all(m.room, ws.user, ws.user).reverse();
      send(ws, { t: 'history', room: m.room, items: isDm ? hist : [] });   // rooms: you only see what is said while you are inside
      if (!isDm) { if (!wasHere) cast(m.room, { t: 'enter', room: m.room, user: ws.user, role: roleOf(ws.user), xp: xpOf(ws.user), ts: Date.now() }); castRoster(m.room); }
      if (tp && isTpRoom(m.room)) { ensureTp(m.room); setTimeout(() => send(ws, { t: 'tp', room: m.room, view: tp.getView(m.room, ws.user) }), 50); }
      if (games.has(m.room)) send(ws, unoState(games.get(m.room), ws.user));
    } else if (!ws.room) return;
    else if (m.t === 'msg') {
      const text = String(m.text || '').trim().slice(0, 500);
      if (!text) return;
      if (/^\/bot(\s|$)/i.test(text)) return botCommand(ws, text).catch(e => console.error('[bot]', e));
      if (text[0] === '/') return command(ws, text);
      if (text[0] === '!') return gameRoute(ws, text);
      if (!speakOk(ws)) return;
      const o = { user: ws.user, text, kind: 'msg', ts: Date.now(), role: roleOf(ws.user), xp: xpOf(ws.user) };
      db.prepare('insert into msgs(room,user,text,kind,ts) values(?,?,?,?,?)').run(ws.room, o.user, o.text, o.kind, o.ts);
      addXp(ws.user, 1);
      cast(ws.room, { t: 'msg', room: ws.room, ...o });
    } else if (m.t === 'media') {
      const url = String(m.url || ''), kind = m.kind === 'voice' ? 'voice' : 'image';
      if (!MEDIA_URL.test(url) || !fs.existsSync('.' + url)) return;
      if (!speakOk(ws)) return;
      const dur = Math.max(0, Math.min(300, Math.round(+m.dur || 0)));
      const o = { user: ws.user, text: kind === 'voice' ? url + '|' + dur : url, kind, ts: Date.now(), role: roleOf(ws.user), xp: xpOf(ws.user) };
      db.prepare('insert into msgs(room,user,text,kind,ts) values(?,?,?,?,?)').run(ws.room, o.user, o.text, o.kind, o.ts);
      cast(ws.room, { t: 'msg', room: ws.room, ...o });
    } else if (m.t === 'gift') giftOne(ws, m.to, m.gift);
    else if (m.t === 'mod') moderate(ws, m.act, String(m.user || ''), (+m.minutes || 10) * 60);
    else if (m.t === 'uno') unoAct(ws.room, ws.user, m);
  });
  ws.on('close', () => {   // keep a person in their room for a short while so a quick app switch / reconnect does not kick them out
    const r0 = ws.room;
    if (r0 && ws.user && !r0.startsWith('dm:')) setTimeout(() => { if (ws.room === r0) leaveRoom(ws); online(); }, 25e3);
    else leaveRoom(ws);
    online();
  });
});

server.listen(PORT, () => console.log('Migv33 running on :' + PORT));
