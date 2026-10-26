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
const TP = require('./teen-patti.cjs');   // Teen Patti Gold engine (virtual coins, for fun only)

const STAFF_USER = (process.env.STAFF_USER || 'migv33').toLowerCase();
const STAFF_EMAIL = (process.env.STAFF_EMAIL || '').toLowerCase();
const SECRET = process.env.JWT_SECRET || 'change-me-now';
const PORT = process.env.PORT || 3000;
const db = new Database('migv33.db');
db.exec(`create table if not exists users(id integer primary key, name text unique, pass text, coins int default 0, full_name text, email text unique, gender text, bio text default '', status_text text default '', presence text default 'online', xp int default 0, role text default 'user', verified int default 0, spins int default 0, last_spin text default '');
create table if not exists msgs(id integer primary key, room text, user text, text text, kind text default 'msg', ts int)`);

const GIFTS = { rose: { n: 'Rose', c: 10, e: '🌹' }, heart: { n: 'Heart', c: 20, e: '💖' }, crown: { n: 'Crown', c: 100, e: '👑' } };

const app = express();
app.use(express.json());
app.use(express.static('public'));
fs.mkdirSync('uploads', { recursive: true });
app.use('/uploads', express.static('uploads', { maxAge: '7d', setHeaders: res => res.set('X-Content-Type-Options', 'nosniff') }));
const sign = (id, name) => jwt.sign({ id, name }, SECRET, { expiresIn: '30d' });
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
app.post('/api/signup/start', async (q, r) => {
  const now = Date.now();
  const h = (hits.get(q.ip) || []).filter(t => now - t < 3600e3);
  if (h.length >= 8) return bad(r, 'Too many attempts. Please try again later.', 429);
  hits.set(q.ip, [...h, now]);
  const { fullName = '', name = '', email = '', gender = '', pass = '' } = q.body || {};
  if (fullName.trim().length < 2 || fullName.length > 40) return bad(r, 'Enter your full name.');
  if (!/^[A-Za-z0-9._-]{3,16}$/.test(name)) return bad(r, 'Username must be 3–16 characters: English letters, numbers, dot (.), dash (-) or underscore (_).');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 100) return bad(r, 'Enter a valid email address.');
  if (!['Male', 'Female', 'Other'].includes(gender)) return bad(r, 'Select your gender.');
  if (pass.length < 6) return bad(r, 'Password must be at least 6 characters.');
  const em = email.toLowerCase(), ln = name.toLowerCase();
  const claim = ln === STAFF_USER && STAFF_EMAIL && em === STAFF_EMAIL;
  if (!claim && (ln.includes(STAFF_USER) || ['admin', 'staff', 'mentor', 'merchant', 'support'].includes(ln))) return bad(r, 'That username is reserved.');
  if (db.prepare('select 1 from users where lower(name)=? or email=?').get(ln, em)) return bad(r, 'That username or email is already registered.', 409);
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
  try {
    const i = db.prepare('insert into users(name,pass,full_name,email,gender) values(?,?,?,?,?)').run(name, p.hash, p.fullName, p.email, p.gender);
    pending.delete(name);
    db.prepare('update users set coins=coins+500, spins=spins+1 where name=?').run(name); addTx(name, 'other', 'Level 1 reward', 500);
    if (name.toLowerCase() === STAFF_USER) db.prepare("update users set role='staff', verified=1 where name=?").run(name);
    r.json({ token: sign(i.lastInsertRowid, name) });
  } catch { bad(r, 'That username or email is already registered.', 409); }
});
app.post('/api/login', (q, r) => {
  const { name, pass } = q.body || {};
  const u = db.prepare('select * from users where lower(name)=lower(?)').get(name || '');
  if (!u || !bcrypt.compareSync(pass || '', u.pass)) return bad(r, 'Wrong username or password', 401);
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
create table if not exists mutes(room text, user text, until int, primary key(room,user))`);
for (const [n, c] of [['lobby', 'official'], ['adda', 'official'], ['music', 'official'], ['games', 'game'], ['legendary', 'game']])
  db.prepare('insert or ignore into rooms values(?,?,?)').run(n, c, null);
const roomOk = n => /^dm:/.test(n) || !!db.prepare('select 1 from rooms where name=?').get(n);
const auth = (q, r, next) => { try { q.user = jwt.verify((q.headers.authorization || '').slice(7), SECRET).name; next(); } catch { bad(r, 'Please log in again', 401); } };
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
const profile = n => { const u = db.prepare('select name,full_name,gender,bio,status_text,presence,xp,coins,role from users where name=?').get(n); return u && { ...u, level: level(u.xp) }; };
const ok = fn => (q, r) => { try { fn(q, r); } catch (e) { console.error(e); bad(r, 'Server error', 500); } };
const fstate = (a, b) => {
  const x = db.prepare('select * from friends where (a=? and b=?) or (a=? and b=?)').get(a, b, b, a);
  return !x ? 'none' : x.status === 'accepted' ? 'friends' : x.a === a ? 'sent' : 'incoming';
};

app.get('/api/me', auth, ok((q, r) => r.json({ ...profile(q.user), email: db.prepare('select email from users where name=?').get(q.user).email })));
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
  r.json({ ...p, friends: fc, state: q.user === p.name ? 'me' : fstate(q.user, p.name) });
}));
app.post('/api/password', auth, ok((q, r) => {
  const { old = '', pass = '' } = q.body || {};
  const u = db.prepare('select pass from users where name=?').get(q.user);
  if (!bcrypt.compareSync(old, u.pass)) return bad(r, 'Current password is wrong', 403);
  if (pass.length < 6) return bad(r, 'New password must be at least 6 characters');
  db.prepare('update users set pass=? where name=?').run(bcrypt.hashSync(pass, 10), q.user); r.json({ ok: true });
}));

app.get('/api/feed', auth, ok((q, r) => r.json(db.prepare(`select p.*, (select xp from users where name=p.user) xp, (select role from users where name=p.user) role,
  (select count(*) from reacts where post=p.id) reacts, (select count(*) from reacts where post=p.id and user=?) mine,
  (select count(*) from comments where post=p.id) comments from posts p order by p.id desc limit 30`).all(q.user))));
app.post('/api/posts', auth, ok((q, r) => {
  const text = String(q.body?.text || '').trim().slice(0, 500); if (!text) return bad(r, 'Write something first');
  db.prepare('insert into posts(user,text,ts) values(?,?,?)').run(q.user, text, Date.now());
  addXp(q.user, 5); r.json({ ok: true });
}));
app.post('/api/posts/:id/react', auth, ok((q, r) => {
  const d = db.prepare('delete from reacts where post=? and user=?').run(q.params.id, q.user);
  if (!d.changes) db.prepare('insert or ignore into reacts values(?,?)').run(q.params.id, q.user); r.json({ ok: true });
}));
app.get('/api/posts/:id/comments', auth, ok((q, r) => r.json(db.prepare('select user,text,ts,(select role from users where name=comments.user) role from comments where post=? order by id limit 100').all(q.params.id))));
app.post('/api/posts/:id/comments', auth, ok((q, r) => {
  const text = String(q.body?.text || '').trim().slice(0, 300); if (!text) return bad(r, 'Write a comment first');
  db.prepare('insert into comments(post,user,text,ts) values(?,?,?,?)').run(q.params.id, q.user, text, Date.now()); r.json({ ok: true });
}));
app.post('/api/posts/:id/share', auth, ok((q, r) => { db.prepare('update posts set shares=shares+1 where id=?').run(q.params.id); r.json({ ok: true }); }));

app.get('/api/rooms', auth, ok((q, r) => {
  const fav = new Set(db.prepare('select room from favs where user=?').all(q.user).map(x => x.room));
  r.json(db.prepare('select name,cat from rooms').all().map(x => ({ ...x, count: members.get(x.name)?.size || 0, fav: fav.has(x.name) })));
}));
app.post('/api/rooms', auth, ok((q, r) => {
  const name = String(q.body?.name || '').trim().replace(/\s+/g, ' ');
  if (!/^[A-Za-z0-9 ]{5,20}$/.test(name)) return bad(r, 'Room name: 5–20 characters, English letters, numbers and spaces only');
  if (db.prepare('select 1 from rooms where lower(name)=lower(?)').get(name)) return bad(r, 'That room already exists', 409);
  db.prepare('insert into rooms values(?,?,?)').run(name, 'user', q.user); r.json({ ok: true });
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
  if (act === 'request' && st === 'none') db.prepare("insert into friends values(?,?,'pending')").run(q.user, n);
  else if (act === 'accept' && st === 'incoming') db.prepare("update friends set status='accepted' where a=? and b=?").run(n, q.user);
  else if (act === 'remove') db.prepare('delete from friends where (a=? and b=?) or (a=? and b=?)').run(q.user, n, n, q.user);
  r.json({ ok: true });
}));

app.get('/api/account', auth, ok((q, r) => {
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const t = db.prepare('select coalesce(sum(case when amount>0 then amount end),0) e, coalesce(-sum(case when amount<0 then amount end),0) s from txs where user=? and ts>=?').get(q.user, day.getTime());
  r.json({ coins: profile(q.user).coins, earned: t.e, spent: t.s, activity: db.prepare('select kind,title,amount,ts from txs where user=? order by id desc limit 50').all(q.user) });
}));
app.post('/api/transfer', auth, ok((q, r) => {
  const to = String(q.body?.to || ''), amt = Math.floor(+q.body?.amount);
  if (!to || to === q.user || !profile(to)) return bad(r, 'Recipient not found');
  if (!(amt >= 1)) return bad(r, 'Enter an amount of at least 1');
  const go = db.transaction(() => {
    if (!db.prepare('update users set coins=coins-? where name=? and coins>=?').run(amt, q.user, amt).changes) throw new Error('funds');
    db.prepare('update users set coins=coins+? where name=?').run(amt, to);
    addTx(q.user, 'transfer', `Sent to ${to}`, -amt); addTx(to, 'transfer', `Received from ${q.user}`, amt);
  });
  try { go(); } catch { return bad(r, 'Not enough coins'); }
  wss.clients.forEach(w => (w.user === q.user || w.user === to) && send(w, { t: 'coins', coins: coins(w.user) }));
  r.json({ coins: coins(q.user) });
}));
app.get('/api/members', auth, ok((q, r) => r.json(db.prepare("select name,role,xp from users where role in ('admin','staff','mentor','merchant') order by case role when 'admin' then 0 when 'staff' then 1 when 'mentor' then 2 else 3 end, name").all())));
app.post('/api/admin/role', auth, ok((q, r) => {
  if (roleOf(q.user) !== 'staff') return bad(r, 'Only staff can change roles', 403);
  const { name = '', role = '' } = q.body || {};
  if (!['user', 'merchant', 'mentor', 'admin', 'staff'].includes(role)) return bad(r, 'Invalid role');
  if (name === q.user) return bad(r, "You can't change your own role", 403);
  if (!profile(name)) return bad(r, 'User not found', 404);
  db.prepare('update users set role=? where name=?').run(role, name); online(); r.json({ ok: true });
}));
app.get('/api/verified', auth, ok((q, r) => r.json(db.prepare('select name from users where verified=1').all().map(u => u.name))));
app.post('/api/admin/verify', auth, ok((q, r) => {
  if (roleOf(q.user) !== 'staff') return bad(r, 'Only staff can verify accounts', 403);
  const { name = '', on } = q.body || {};
  if (!profile(name)) return bad(r, 'User not found', 404);
  db.prepare('update users set verified=? where name=?').run(on ? 1 : 0, name); r.json({ ok: true });
}));
const PRIZES = [{ l: '100 coins', c: 100 }, { l: '200 coins', c: 200 }, { l: '400 coins', c: 400 }, { l: '500 coins', c: 500 }, { l: '+100 XP', x: 100 }, { l: '+250 XP', x: 250 }, { l: 'Try again' }];
const today = () => new Date().toISOString().slice(0, 10);
app.get('/api/spin', auth, ok((q, r) => { const u = db.prepare('select spins,last_spin from users where name=?').get(q.user); r.json({ prizes: PRIZES.map(p => p.l), spins: u.spins, free: u.last_spin !== today() }); }));
app.post('/api/spin', auth, ok((q, r) => {
  const u = db.prepare('select spins,last_spin from users where name=?').get(q.user);
  if (u.last_spin !== today()) db.prepare('update users set last_spin=? where name=?').run(today(), q.user);
  else if (u.spins > 0) db.prepare('update users set spins=spins-1 where name=?').run(q.user);
  else return bad(r, 'No spins left. Come back tomorrow, or level up for more.');
  const i = crypto.randomInt(PRIZES.length), p = PRIZES[i];
  if (p.c) { db.prepare('update users set coins=coins+? where name=?').run(p.c, q.user); addTx(q.user, 'other', `Daily spin: ${p.l}`, p.c); }
  if (p.x) addXp(q.user, p.x);
  const left = db.prepare('select spins,last_spin from users where name=?').get(q.user);
  r.json({ index: i, prize: p.l, coins: coins(q.user), spins: left.spins, free: left.last_spin !== today() });
}));
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
  if (h.length >= 40) return bad(r, 'Too many uploads. Please wait a few minutes.', 429);
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
const cast = (room, o) => members.get(room)?.forEach(w => { if (o.user && w.user !== o.user && isBlocked(o.user, w.user)) return; send(w, o); });
const online = () => {
  const l = [...new Set([...wss.clients].filter(w => w.user).map(w => w.user))]
    .map(n => ({ name: n, ...db.prepare('select presence,role,xp from users where name=?').get(n) })).filter(u => u.presence !== 'offline');
  wss.clients.forEach(w => send(w, { t: 'online', list: l }));
};
const coins = n => db.prepare('select coins from users where name=?').get(n).coins;
const roster = room => [...new Set([...(members.get(room) || [])].map(w => w.user))].map(n => ({ name: n, ...db.prepare('select role,xp,presence from users where name=?').get(n) })).filter(u => u.presence !== 'offline');
const castRoster = room => { if (room && !/^dm:/.test(room)) cast(room, { t: 'members', room, list: roster(room) }); };
const leaveRoom = ws => { const r0 = ws.room; if (!r0) return; members.get(r0)?.delete(ws); ws.room = null; castRoster(r0); };
// ---------- Teen Patti Gold (Legendary room) — virtual coins, fun only, no cash value ----------
const TP_BOOT = Math.max(1, parseInt(process.env.TP_BOOT || '10', 10));
const isTpRoom = n => String(n || '').toLowerCase() === 'legendary';
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
      addTx(userId, 'game', 'Teen Patti Gold: bet', -amount);
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
const tp = new TP.TeenPattiManager({
  store: tpStore,
  config: { ...TP.CONFIG, DEFAULT_BOOT: TP_BOOT, RAKE_PERCENT: 0, TURN_SECONDS: 15 },
  send: (room, text) => cast(room, { t: 'msg', room, user: 'Teen Patti Gold', text, kind: 'game', ts: Date.now(), role: '' }),
  sendPrivate: (room, userId, text) => members.get(room)?.forEach(w => w.user === userId && send(w, { t: 'msg', room, user: 'Teen Patti Gold', text, kind: 'game', priv: true, ts: Date.now(), role: '' })),
  isAdmin: async (u) => isSA(u.id),
  onState: tpPanels,
  onHand: info => { try { db.prepare('insert into tp_hands(ts,info) values(?,?)').run(Date.now(), JSON.stringify(info)); } catch {} },
});
tp.init().catch(e => console.error('[TeenPatti] init failed', e));
const ensureTp = room => { if (isTpRoom(room) && !tp.rooms.has(room)) tp.handleMessage(room, { id: 'system', name: 'System', isAdmin: true }, '/bot teenpatti ' + TP_BOOT); };
const shutdownTp = async () => { try { await tp.shutdown(); } catch {} process.exit(0); };
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
const isSA = u => ['staff', 'admin'].includes(roleOf(u));
const canMod = (room, u) => isSA(u) || ownerOf(room) === u || isRoomMod(room, u);
const reply = (ws, text) => send(ws, { t: 'msg', room: ws.room, user: '', text: '🔒 ' + text, kind: 'sys', ts: Date.now() });
const say = (room, user, text, kind = 'action') => {
  const o = { user, text, kind, ts: Date.now(), role: roleOf(user) };
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
  return !(isRoomMod(room, target) && ownerOf(room) !== actor);
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
  if ((act === 'mod' || act === 'dmod') && !(ownerOf(room) === u || isSA(u))) return err('Only the room owner can do that.');
  if (['kick', 'bump', 'ban', 'unban', 'unkick', 'silence', 'unsilence', 'mod', 'dmod'].includes(act)) {
    if (!t || !profile(t)) return err('User not found. Usage: /' + act + ' username');
    if (t === u) return err("You can't do that to yourself.");
    if (['kick', 'bump', 'ban', 'silence'].includes(act) && !canTarget(room, u, t)) return err(`${t} is protected.`);
  }
  const note = x => say(room, u, x, 'sys');
  const evict = () => [...(members.get(room) || [])].filter(w => w.user === t).forEach(w => { members.get(room).delete(w); w.room = null; send(w, { t: 'kicked', room, by: u }); });
  const suspend = ms => { db.prepare('insert or replace into bans values(?,?,?,?,?)').run(room, t, u, Date.now(), ms ? Date.now() + ms : 0); evict(); };
  const s = Math.min(86400, Math.max(1, Math.floor(secs) || 600));
  if (act === 'kick') { suspend(3600e3); note(`${t} was kicked for 1 hour by ${u}`); }
  else if (act === 'bump') { suspend(300e3); note(`${t} was bumped for 5 minutes by ${u}`); }
  else if (act === 'ban') { suspend(0); note(`${t} was banned by ${u}`); }
  else if (act === 'unban') { db.prepare('delete from bans where room=? and user=? and until=0').run(room, t); note(`${t} was unbanned by ${u}`); }
  else if (act === 'unkick') { db.prepare('delete from bans where room=? and user=? and until>0').run(room, t); note(`${t}'s suspension was removed by ${u}`); }
  else if (act === 'silence') { db.prepare('insert or replace into mutes values(?,?,?)').run(room, t, Date.now() + s * 1000); note(`${t} was silenced for ${fmt(s)} by ${u}`); }
  else if (act === 'unsilence') { db.prepare('delete from mutes where room=? and user=?').run(room, t); note(`${t} can talk again (by ${u})`); }
  else if (act === 'silenceall') { setCfg(room, 'silence_until', Date.now() + s * 1000); note(`Room silenced for ${fmt(s)} by ${u}`); }
  else if (act === 'unsilenceall') { setCfg(room, 'silence_until', 0); note(`Room silence lifted by ${u}`); }
  else if (act === 'lock') { setCfg(room, 'locked', 1); note(`Room locked by ${u}`); }
  else if (act === 'unlock') { setCfg(room, 'locked', 0); note(`Room unlocked by ${u}`); }
  else if (act === 'mod') { db.prepare('insert or ignore into room_mods values(?,?)').run(room, t); note(`${t} is now a room moderator (by ${u})`); }
  else if (act === 'dmod') { db.prepare('delete from room_mods where room=? and user=?').run(room, t); note(`${t} is no longer a room moderator`); }
  else if (act === 'broadcast') { if (!text) return err('Usage: /broadcast message'); note('📢 ' + text.slice(0, 300)); }
  else if (act === 'announce') { setCfg(room, 'announce', text.slice(0, 300)); note(text ? `📌 Announcement set by ${u}` : `Announcement removed by ${u}`); }
}

const payGift = (from, to, gf) => {
  if (!db.prepare('update users set coins=coins-? where name=? and coins>=?').run(gf.c, from, gf.c).changes) return false;
  db.prepare('update users set coins=coins+? where name=?').run(Math.floor(gf.c / 2), to);
  addTx(from, 'gift', `Sent ${gf.n} to ${to}`, -gf.c); addTx(to, 'gift', `${gf.n} from ${from}`, Math.floor(gf.c / 2));
  return true;
};
function giftOne(ws, to, key, note = '') {
  const gf = GIFTS[String(key || '').toLowerCase()];
  if (!gf) return reply(ws, `Unknown gift. Try: ${Object.keys(GIFTS).join(', ')}`);
  if (!to || to === ws.user || !profile(to)) return reply(ws, 'Pick another valid user.');
  if (isBlocked(ws.user, to)) return reply(ws, "You can't gift this user.");
  if (!speakOk(ws)) return;
  if (!payGift(ws.user, to, gf)) return reply(ws, 'Not enough coins.');
  say(ws.room, ws.user, `${gf.e} sent ${gf.n} to ${to}`, 'gift');
  if (note) wss.clients.forEach(w => w.user === to && w.room === ws.room && reply(w, `Private note from ${ws.user}: ${note}`));
  refreshCoins(ws.user, to);
}
function shower(ws, key) {
  const gf = GIFTS[String(key || '').toLowerCase()];
  if (!gf) return reply(ws, `Unknown gift. Try: ${Object.keys(GIFTS).join(', ')}`);
  const to = [...new Set([...(members.get(ws.room) || [])].map(w => w.user))].filter(n => n !== ws.user && !isBlocked(ws.user, n)).slice(0, 25);
  if (!to.length) return reply(ws, 'Nobody else is here to receive it.');
  if (coins(ws.user) < gf.c * to.length) return reply(ws, `You need ${gf.c * to.length} coins to send ${gf.n} to ${to.length} members.`);
  to.forEach(n => payGift(ws.user, n, gf));
  say(ws.room, ws.user, `${gf.e} sent a ${gf.n} shower to ${to.length} members`, 'gift'); refreshCoins(ws.user, ...to);
}
function friendAct(ws, n) {
  const u = ws.user;
  if (!n || n === u || !profile(n)) return reply(ws, 'Usage: /f username');
  const st = fstate(u, n);
  if (st === 'none') { db.prepare("insert into friends values(?,?,'pending')").run(u, n); return reply(ws, `You follow ${n} now. If they follow you back, you become friends.`); }
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

function command(ws, line) {
  const [raw, ...a] = line.slice(1).trim().split(/\s+/);
  const c = (raw || '').toLowerCase(), u = ws.user, room = ws.room, dm = room.startsWith('dm:');
  const other = dm ? room.slice(3).split(':').find(x => x !== u) : null, tgt = a[0] ? a[0].replace(/^@/, '') : null;
  const online = () => [...new Set([...(members.get(room) || [])].map(w => w.user))].filter(n => n !== u);
  const speak = fn => { if (speakOk(ws)) fn(); };
  if (c === 'balance') return reply(ws, `Your balance: ${coins(u)} coins.`);
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
  if (c === 'tag') { const p = tgt && profile(tgt); return reply(ws, p ? `${tgt} ${p.role === 'merchant' ? 'has an active merchant tag.' : 'is not a merchant.'}` : 'Usage: /tag username'); }
  if (c === 'whois') { const p = tgt && profile(tgt); return reply(ws, p ? `${p.name}: role ${p.role}, level ${p.level}, gender ${p.gender || 'not set'}, country not set.` : 'Usage: /whois username'); }
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
  if (['ban', 'unban', 'unkick', 'bump', 'mod', 'dmod'].includes(c)) return moderate(ws, c, tgt);
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
      try { ws.user = jwt.verify(m.token, SECRET).name; } catch { return send(ws, { t: 'error', error: 'auth' }); }
      if (m.offline) db.prepare("update users set presence='offline' where name=?").run(ws.user);
      else db.prepare("update users set presence='online' where name=? and presence='offline'").run(ws.user);
      send(ws, { t: 'ready', user: ws.user, coins: coins(ws.user), gifts: GIFTS });
      return online();
    }
    if (!ws.user) return;
    if (m.t === 'join') {
      const ok = roomOk(m.room) && (!/^dm:/.test(m.room) || m.room.slice(3).split(':').includes(ws.user));
      if (!ok) return;
      const bn = db.prepare('select until from bans where room=? and user=?').get(m.room, ws.user);
      if (bn) { if (bn.until === 0 || bn.until > Date.now()) return send(ws, { t: 'denied', room: m.room, error: bn.until ? 'You are suspended from this room for a while.' : 'You are banned from this room.' }); db.prepare('delete from bans where room=? and user=?').run(m.room, ws.user); }
      leaveRoom(ws);
      ws.room = m.room;
      if (!members.has(m.room)) members.set(m.room, new Set());
      members.get(m.room).add(ws);
      const isDm = /^dm:/.test(m.room);
      if (!isDm) send(ws, { t: 'roominfo', room: m.room, owner: ownerOf(m.room) || STAFF_USER, mods: db.prepare('select user from room_mods where room=?').all(m.room).map(x => x.user), announce: cfg(m.room).announce || '', users: roster(m.room), fav: !!db.prepare('select 1 from favs where user=? and room=?').get(ws.user, m.room) });
      const hist = db.prepare('select user,text,kind,ts,(select role from users where name=msgs.user) role,(select xp from users where name=msgs.user) xp from msgs where room=? and not exists(select 1 from blocks where (a=? and b=msgs.user) or (b=? and a=msgs.user)) order by id desc limit 50').all(m.room, ws.user, ws.user).reverse();
      send(ws, { t: 'history', room: m.room, items: hist });
      if (!isDm) { cast(m.room, { t: 'enter', room: m.room, user: ws.user, role: roleOf(ws.user), xp: xpOf(ws.user), ts: Date.now() }); castRoster(m.room); }
      if (isTpRoom(m.room)) { ensureTp(m.room); setTimeout(() => send(ws, { t: 'tp', room: m.room, view: tp.getView(m.room, ws.user) }), 50); }
      if (games.has(m.room)) send(ws, unoState(games.get(m.room), ws.user));
    } else if (!ws.room) return;
    else if (m.t === 'msg') {
      const text = String(m.text || '').trim().slice(0, 500);
      if (!text) return;
      if (text[0] === '/') return command(ws, text);
      if (text[0] === '!') {
        if (isTpRoom(ws.room)) { ensureTp(ws.room); return tp.handleMessage(ws.room, { id: ws.user, name: ws.user, isAdmin: isSA(ws.user) }, text).catch(e => console.error('[TeenPatti]', e)); }
        return reply(ws, 'This game is only played in the Legendary room.');
      }
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
  ws.on('close', () => { leaveRoom(ws); online(); });
});

server.listen(PORT, () => console.log('Migv33 running on :' + PORT));
