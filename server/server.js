// Mam & Mam Overseas Ltd. (RL 1217): portal backend.
// Built only on Node's built-in modules, so it runs on any Node 18+ without native packages.
// Data: one JSON document saved atomically to DATA_DIR/db.json (with daily backups); uploaded files in DATA_DIR/files.
// Email: verification codes are sent through SMTP when SMTP_* settings and the `nodemailer` package are present.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { COUNTRIES, HOURLY, STAGES, CL_STAGES, STAFF_PERMS, LABEL, INITIAL, TEAM_DEPTS, VISA_FIELDS, VISA_DATES, clCountryOk, CL_REGIONS } from "../src/constants.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(HERE, "..", ".env"));
const PORT = Number(process.env.PORT || 3100);
const HOST = process.env.HOST || "127.0.0.1";
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(HERE, "..", "data"));
const STATIC_DIR = path.resolve(process.env.STATIC_DIR || path.join(HERE, "..", "dist"));
const SHOW_CODES = process.env.SHOW_CODES === "1"; // testing only: return the email code in the API response
const SESSION_DAYS = 30;
const MAX_BODY = 25 * 1048576;
const MAX_FILE = 6 * 1048576;

function loadEnv(file) {
  try {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (!m) continue;
      if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* no .env file */ }
}

/* ======================= storage ======================= */
fs.mkdirSync(path.join(DATA_DIR, "files"), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, "backups"), { recursive: true });
const DB_FILE = path.join(DATA_DIR, "db.json");

function freshDb() {
  return {
    v: 5, settings: structuredClone(INITIAL.settings), seo: structuredClone(INITIAL.seo), packages: structuredClone(INITIAL.packages), posts: structuredClone(INITIAL.posts),
    users: [], jobs: [], applications: [], notifications: [], orders: [], messages: [], workers: [], clearances: [], ledger: [], tickets: [], testimonials: [], team: [], gallery: [],
    files: {}, sessions: {}
  };
}
let db;
try { db = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch (e) {
  if (fs.existsSync(DB_FILE)) { console.error("db.json could not be read; refusing to start so no data is overwritten.", e.message); process.exit(1); }
  db = freshDb();
}
for (const [k, v] of Object.entries(freshDb())) if (db[k] === undefined) db[k] = v;
for (const [k, v] of Object.entries(INITIAL.seo)) if (!db.seo[k]) db.seo[k] = structuredClone(v); // pages added in later versions

let REV = Date.now(); // goes up on every change; browsers check it each second and reload their data when it moves
function save() {
  REV++;
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
  const day = new Date().toISOString().slice(0, 10); const bk = path.join(DATA_DIR, "backups", `db-${day}.json`);
  if (!fs.existsSync(bk)) {
    fs.copyFileSync(DB_FILE, bk);
    const all = fs.readdirSync(path.join(DATA_DIR, "backups")).filter(f => f.startsWith("db-")).sort();
    all.slice(0, Math.max(0, all.length - 14)).forEach(f => fs.unlinkSync(path.join(DATA_DIR, "backups", f)));
  }
}

/* Fiji wages are hourly: mark Fiji jobs whose amounts already look hourly (others keep monthly until edited) */
/* every clearance file gets an EC reference number, e.g. EC-2026-RL1217-100001 (older files get one in date order) */
const ecRef = c => { db.clSeq = (db.clSeq || 100000) + 1; return `IC-${String(c.created || now()).slice(0, 4)}-RL1217-${db.clSeq}`; };
// numbers made before start with IC too (EC-2026-RL1217-100002 → IC-2026-RL1217-100002)
for (const c of db.clearances) if (/^EC-\d{4}-RL1217-\d+$/.test(c.ref || "")) c.ref = "IC" + c.ref.slice(2);
[...db.clearances].sort((a, b) => String(a.created).localeCompare(String(b.created))).forEach(c => { if (!c.ref) c.ref = ecRef(c); });
for (const j of db.jobs) if (!j.period) j.period = HOURLY.includes(j.country) && Number(j.salaryMax) <= 500 ? "hour" : "month";
/* home page slideshow: the pictures shipped in dist/scenery are the starting list; after that the admin manages it */
if (!Array.isArray(db.scenery)) {
  try { db.scenery = JSON.parse(fs.readFileSync(path.join(HERE, "seed", "scenery.json"), "utf8")).map(x => ({ id: id("sc"), builtin: x.name, alt: x.alt, pos: x.pos || "50% 50%", hidden: false })); }
  catch { db.scenery = []; }
}
/* job post templates by profession (admin job form): start from server/seed/job-templates.json, then the admin manages them */
if (!Array.isArray(db.jobTemplates)) {
  try { db.jobTemplates = JSON.parse(fs.readFileSync(path.join(HERE, "seed", "job-templates.json"), "utf8")).map(x => ({ id: id("jt"), ...x })); }
  catch { db.jobTemplates = []; }
}
/* team members shipped with the code (server/seed/team.json): each is added once; if the admin later deletes one it stays deleted */
try {
  const seedDir = path.join(HERE, "seed"); const list = JSON.parse(fs.readFileSync(path.join(seedDir, "team.json"), "utf8"));
  db.seeded = db.seeded || {}; let added = 0;
  for (const m of list) {
    if (db.seeded[`team:${m.key}`]) {
      const x = db.team.find(y => y.name.toLowerCase() === m.name.toLowerCase());
      if (x && m.website && x.website === undefined) { x.website = m.website; added++; }
      continue;
    }
    db.seeded[`team:${m.key}`] = true;
    if (db.team.some(x => x.name.toLowerCase() === m.name.toLowerCase())) continue;
    let photo = null;
    if (m.photo && fs.existsSync(path.join(seedDir, m.photo))) {
      const buf = fs.readFileSync(path.join(seedDir, m.photo)); const fid = id("f");
      fs.writeFileSync(path.join(DATA_DIR, "files", fid), buf);
      db.files[fid] = { id: fid, owner: "seed", name: m.photo, size: buf.length, mime: "image/jpeg", public: true, at: now() };
      photo = { id: fid, name: m.photo, size: buf.length };
    }
    db.team.push({ id: id("tm"), name: m.name, title: m.title, dept: TEAM_DEPTS.includes(m.dept) ? m.dept : TEAM_DEPTS[0], bio: m.bio || "", expertise: m.expertise || [], years: m.years ?? "",
      phone: m.phone || "", whatsapp: m.whatsapp || "", email: m.email || "", website: m.website || "", order: m.order ?? 10, photo });
    added++;
  }
  if (added) { save(); console.log(`Team seed applied (${added} change(s)) from server/seed/team.json.`); } else if (list.length) save();
} catch (e) { if (e.code !== "ENOENT") console.warn("Team seed skipped:", e.message); }

/* first admin account from the environment */
if (!db.users.some(u => u.role === "admin")) {
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase(), pass = process.env.ADMIN_PASSWORD || "";
  if (email && pass.length >= 8) {
    db.users.push({ id: id("u"), role: "admin", name: "Site Admin", email, pass: hashPass(pass), status: "active", created: now() });
    save(); console.log(`Admin account created for ${email}.`);
  } else console.warn("No admin account yet: open the one-time setup link (/#setup-SETUP_TOKEN) or set ADMIN_EMAIL and ADMIN_PASSWORD in .env.");
}

/* ======================= helpers ======================= */
function id(p) { return p + crypto.randomBytes(6).toString("hex"); }
function now() { return new Date().toISOString(); }
function hashPass(p) { const salt = crypto.randomBytes(16); return `s1$${salt.toString("hex")}$${crypto.scryptSync(p, salt, 64).toString("hex")}`; }
function checkPass(p, h) {
  if (!h || !h.startsWith("s1$")) return false;
  const [, salt, hash] = h.split("$"); const got = crypto.scryptSync(String(p), Buffer.from(salt, "hex"), 64);
  return crypto.timingSafeEqual(got, Buffer.from(hash, "hex"));
}
class Fail extends Error { constructor(msg, code = 400) { super(msg); this.code = code; } }
const must = (cond, msg, code) => { if (!cond) throw new Fail(msg, code); };
const str = (v, max = 500) => String(v ?? "").trim().slice(0, max);
const numv = (v, min = 0, max = 1e9) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min; };
const user = uid => db.users.find(u => u.id === uid);
const job = jid => db.jobs.find(j => j.id === jid);
const worker = wid => db.workers.find(w => w.id === wid);
const webUrl = v => { const x = str(v, 200); if (!x) return ""; const u = /^https?:\/\//i.test(x) ? x : `https://${x}`; try { const p = new URL(u); return ["http:", "https:"].includes(p.protocol) && p.hostname.includes(".") ? p.href.replace(/\/$/, "") : ""; } catch { return ""; } };
const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
function notify(uid, text) { if (uid) db.notifications.unshift({ id: id("n"), uid, text, at: now(), read: false }); if (db.notifications.length > 5000) db.notifications.length = 5000; }
const notifyAdmins = (text, perm) => db.users.filter(x => x.role === "admin" || (perm && x.role === "staff" && x.perms?.includes(perm))).forEach(a => notify(a.id, text));
const can = (u, perm) => u && (u.role === "admin" || (u.role === "staff" && u.status === "active" && u.perms?.includes(perm)));
const needPerm = (u, perm) => must(can(u, perm), "You don't have permission for this.", 403);
const needRole = (u, role) => must(u && u.role === role && u.status === "active", role === "agent" ? "Your agent account must be approved first." : "Not allowed for this account.", 403);
const balanceOf = aid => db.ledger.filter(l => l.agentId === aid && l.status === "confirmed").reduce((s, l) => s + (l.type === "charge" ? 1 : -1) * Number(l.amount), 0);
const bdt = n => `BDT ${Number(n || 0).toLocaleString("en-US")}`;

/* rate limiting (per IP + key) */
const hits = new Map();
function limit(ip, key, max, windowMs) {
  const k = `${ip}|${key}`; const t = Date.now(); const arr = (hits.get(k) || []).filter(x => t - x < windowMs);
  must(arr.length < max, "Too many attempts. Please wait a few minutes and try again.", 429);
  arr.push(t); hits.set(k, arr);
}
setInterval(() => { const t = Date.now(); for (const [k, a] of hits) if (!a.some(x => t - x < 3600e3)) hits.delete(k); }, 600e3).unref();

/* ======================= files ======================= */
const SIG = [["pdf", "application/pdf", b => b.slice(0, 5).toString() === "%PDF-"], ["jpg", "image/jpeg", b => b[0] === 0xff && b[1] === 0xd8], ["png", "image/png", b => b.slice(0, 4).toString("hex") === "89504e47"],
  ["webp", "image/webp", b => b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WEBP"], ["doc", "application/msword", b => b.slice(0, 4).toString("hex") === "d0cf11e0"],
  ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", b => b.slice(0, 2).toString() === "PK"],
  /* voice messages recorded in the browser (Chrome/Firefox: WebM or Ogg; Safari: MP4) */
  ["webm", "audio/webm", b => b.slice(0, 4).toString("hex") === "1a45dfa3"], ["ogg", "audio/ogg", b => b.slice(0, 4).toString() === "OggS"],
  ["m4a", "audio/mp4", b => b.slice(4, 8).toString() === "ftyp"], ["mp3", "audio/mpeg", b => b.slice(0, 3).toString() === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)],
  ["wav", "audio/wav", b => b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WAVE"]];
/* f = { name, data: "data:...;base64,..." }; kinds limit which formats are accepted */
function storeFile(f, owner, { images = true, pdf = true, word = false, audio = false, isPublic = false, chat = null } = {}) {
  must(f && typeof f.data === "string" && f.data.startsWith("data:"), "File is missing.");
  const buf = Buffer.from(f.data.slice(f.data.indexOf(",") + 1), "base64");
  must(buf.length > 0, "File is empty."); must(buf.length <= MAX_FILE, "File is larger than 6 MB.");
  const sig = SIG.find(s => s[2](buf)); must(sig, "Unsupported file. Upload PDF or JPG.");
  const ok = (["jpg", "png", "webp"].includes(sig[0]) && images) || (sig[0] === "pdf" && pdf) || (["doc", "docx"].includes(sig[0]) && word) || (["webm", "ogg", "m4a", "mp3", "wav"].includes(sig[0]) && audio);
  must(ok, images && !pdf ? "Upload a photo (JPG)." : "Upload a PDF or JPG file.");
  const fid = id("f"); fs.writeFileSync(path.join(DATA_DIR, "files", fid), buf);
  const name = str(f.name, 120).replace(/[^\w.\- ]+/g, "_") || `file.${sig[0]}`;
  db.files[fid] = { id: fid, owner, name, size: buf.length, mime: sig[1], public: isPublic, at: now(), ...(chat ? { chat } : {}) };
  return { id: fid, name, size: buf.length };
}
function dropFile(ref) { if (!ref?.id || !db.files[ref.id]) return; delete db.files[ref.id]; fs.rmSync(path.join(DATA_DIR, "files", ref.id), { force: true }); }
/* who may open a stored file */
function mayRead(u, f) {
  if (f.public) return true; if (!u) return false;
  if (u.role === "admin" || u.role === "staff") return true;
  if (f.owner === u.id) return true;
  if (u.role === "employer") { // CV/photo/passport of candidates who applied to this employer's jobs
    const mine = new Set(db.jobs.filter(j => j.employerId === u.id).map(j => j.id));
    return db.applications.some(a => mine.has(a.jobId) && a.candidateId === f.owner);
  }
  return false;
}
/* slideshow pictures as the browser needs them; visitors only get the ones that are switched on */
function sceneryView(u) {
  return (db.scenery || []).filter(x => !x.hidden || can(u, "content")).map(x => x.builtin
    ? { id: x.id, alt: x.alt, pos: x.pos, hidden: !!x.hidden, builtin: true, src: `/scenery/${x.builtin}-1280.webp`, srcSet: `/scenery/${x.builtin}-768.webp 768w, /scenery/${x.builtin}-1280.webp 1280w, /scenery/${x.builtin}-1920.webp 1920w` }
    : { id: x.id, alt: x.alt, pos: x.pos, hidden: !!x.hidden, src: `/api/files/${x.big}`, srcSet: x.small ? `/api/files/${x.small} 960w, /api/files/${x.big} 1920w` : "" });
}
const POS = ["50% 50%", "50% 25%", "50% 75%", "25% 50%", "75% 50%"];
const fileRef = r => (r && r.id ? { id: r.id, name: r.name, size: r.size, data: `/api/files/${r.id}` } : r || null);

/* ======================= state sent to the browser ======================= */
const cleanUser = (u, full) => {
  if (!u) return u; const { pass, verify, ...x } = u;
  if (x.profile) x.profile = { ...x.profile, photo: fileRef(x.profile.photo), passportFile: fileRef(x.profile.passportFile), cv: fileRef(x.profile.cv) };
  if (x.agent?.docs) x.agent = { ...x.agent, docs: Object.fromEntries(Object.entries(x.agent.docs).map(([k, v]) => [k, fileRef(v)])) };
  if (!full) { delete x.email; if (x.profile) delete x.profile.passportFile; if (x.agent) x.agent = { business: x.agent.business, phone: x.agent.phone }; delete x.perms; }
  return x;
};
const cleanCl = c => ({ ...c, files: c.files ? { passport: fileRef(c.files.passport), visa: fileRef(c.files.visa), contract: fileRef(c.files.contract), others: (c.files.others || []).map(fileRef) } : c.files, card: c.card ? { ...c.card, data: `/api/files/${c.card.id}` } : null, payment: c.payment ? { ...c.payment, file: fileRef(c.payment.file) } : null });

function viewFor(u) {
  const live = db.jobs.filter(j => j.status === "active");
  const pub = {
    headlines: (db.headlines || []).filter(h => h.active && (!h.until || h.until >= bdDay())).map(h => ({ id: h.id, text: h.text, link: h.link, hot: !!h.hot })),
    v: db.v, session: u?.id || null, settings: { ...db.settings }, needsSetup: !db.users.some(x => x.role === "admin"), seo: db.seo, packages: db.packages, posts: db.posts,
    testimonials: db.testimonials, team: [...db.team].sort((a, b) => (a.order ?? 99) - (b.order ?? 99)).map(m => ({ ...m, photo: m.photo ? { ...m.photo, data: `/api/files/${m.photo.id}` } : null })), gallery: db.gallery.map(g => ({ ...g, src: `/api/files/${g.fileId}` })), scenery: sceneryView(u), about: aboutView(),
    stats: { employers: db.users.filter(x => x.role === "employer" && x.status === "active").length, hired: db.applications.filter(a => a.status === "hired").length },
    jobs: live, applications: [], notifications: [], orders: [], messages: [], workers: [], clearances: [], ledger: [], tickets: [],
    users: db.users.filter(x => x.role === "employer" && live.some(j => j.employerId === x.id)).map(x => ({ id: x.id, role: "employer", status: x.status, company: { name: x.company?.name, verify: x.company?.verify, country: x.company?.country } }))
  };
  if (!u) return pub;
  pub.notifications = db.notifications.filter(n => n.uid === u.id).slice(0, 200);
  const addUsers = (list, full = true) => { for (const x of list) if (x && !pub.users.some(y => y.id === x.id)) pub.users.push(cleanUser(x, full)); };
  pub.users = pub.users.filter(x => x.id !== u.id); addUsers([u]);
  if (u.role === "candidate") {
    pub.applications = db.applications.filter(a => a.candidateId === u.id);
    pub.jobs = db.jobs.filter(j => j.status === "active" || pub.applications.some(a => a.jobId === j.id));
    pub.clearances = db.clearances.filter(c => c.candidateId === u.id).map(cleanCl);
  } else if (u.role === "employer") {
    const mine = db.jobs.filter(j => j.employerId === u.id);
    pub.jobs = [...live.filter(j => j.employerId !== u.id), ...mine];
    pub.applications = db.applications.filter(a => mine.some(j => j.id === a.jobId));
    addUsers(pub.applications.map(a => user(a.candidateId)).filter(Boolean));
    addUsers(pub.applications.filter(a => a.agentId).map(a => user(a.agentId)), false);
    pub.workers = db.workers.filter(w => pub.applications.some(a => a.workerId === w.id)).map(w => ({ id: w.id, agentId: w.agentId, name: w.name, trade: w.trade, experience: w.experience, district: w.district }));
    pub.orders = db.orders.filter(o => o.uid === u.id);
  } else if (u.role === "agent") {
    pub.workers = db.workers.filter(w => w.agentId === u.id);
    pub.clearances = db.clearances.filter(c => c.agentId === u.id).map(cleanCl);
    pub.applications = db.applications.filter(a => a.agentId === u.id);
    pub.jobs = db.jobs.filter(j => j.status === "active" || pub.applications.some(a => a.jobId === j.id));
    pub.tickets = db.tickets.filter(t => t.agentId === u.id);
    pub.ledger = db.ledger.filter(l => l.agentId === u.id);
    pub.passports = db.passports.filter(p => p.agentId === u.id).map(({ by, ...p }) => p); // passports the office entered with this agent as reference
  } else if (u.role === "admin" || u.role === "staff") {
    Object.assign(pub, {
      jobs: db.jobs, applications: db.applications, orders: db.orders, messages: can(u, "messages") ? db.messages : [], workers: db.workers,
      clearances: db.clearances.map(cleanCl), ledger: db.ledger, tickets: db.tickets, users: db.users.map(x => cleanUser(x, true))
    });
    if (can(u, "jobs")) pub.jobTemplates = db.jobTemplates;
    if (can(u, "office")) pub.office = { entries: db.office.entries, auto: officeAuto(), leaders: leaders() };
    { const me = leaders().find(x => x.uid === u.id); if (me) pub.myMoney = { entries: db.office.entries.filter(e => e.people?.includes(me.k)), me }; }
    if (can(u, "clearance")) pub.raims = db.raims ? { email: db.raims.email, auto: db.raims.auto, saved: !!db.raims.pass, last: db.raims.last || null } : null;
    if (PP_PERMS.some(k => can(u, k))) { pub.passports = db.passports; pub.agentBook = db.agentBook; pub.bookMatch = Object.fromEntries(db.users.filter(x => x.role === "agent" && x.status !== "active").map(x => [x.id, bookMatches(x).map(b => b.name)]).filter(([, v]) => v.length)); }
    if (can(u, "visa")) pub.visa = db.visa;
    if (isStaffRole(u)) pub.attendance = attView(u, u.role === "admin");
    if (can(u, "headlines")) pub.headlinesAll = db.headlines || [];
    if (isStaffRole(u)) pub.mySalary = { monthly: db.salary.profiles[u.id]?.monthly ?? null, pays: db.salary.pays.filter(p => p.uid === u.id).map(p => salaryOut(p)) };
    if (can(u, "salary")) pub.salary = { profiles: db.salary.profiles, pays: db.salary.pays.map(p => salaryOut(p)) };
    if (can(u, "receipts")) pub.mr = { accounts: db.mr.accounts, receipts: db.mr.receipts.map(r => mrOut(r)), charges: db.mr.charges };
    if (u.role === "admin") { const c = smtpConf(); pub.smtp = { host: c.host || "", port: c.port || 465, user: c.user || "", from: c.from || "", hasPass: !!c.pass, local: !!c.local }; }
  }
  return pub;
}

/* ======================= email ======================= */
let mailer = null;
// SMTP_LOCAL=1: send through this server's own mail service (installed by deploy/mail.sh) as MAIL_FROM
const LOCAL_MAIL = process.env.SMTP_LOCAL === "1";
const smtpConf = () => LOCAL_MAIL ? { host: "127.0.0.1", port: 25, user: "", pass: "", from: process.env.MAIL_FROM || "", local: true }
  : db.smtp?.host ? db.smtp : { host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, user: process.env.SMTP_USER, pass: process.env.SMTP_PASS, from: process.env.MAIL_FROM };
const mailFrom = () => { const c = smtpConf(); return c.from || c.user; };
async function getMailer() {
  if (mailer !== null) return mailer;
  mailer = false; const c = smtpConf();
  if (!c.host || (!c.local && (!c.user || !c.pass)) || (c.local && !c.from)) return mailer;
  try {
    const nm = (await import("nodemailer")).default; const port = Number(c.port || 465);
    mailer = c.local ? nm.createTransport({ host: c.host, port, secure: false, ignoreTLS: true, name: "localhost" })
      : nm.createTransport({ host: c.host, port, secure: port === 465, auth: { user: c.user, pass: c.pass } });
  } catch (e) { console.warn("nodemailer is not installed; emails are not sent.", e.message); }
  return mailer;
}
async function sendCode(u) {
  const m = await getMailer(); if (!m) return false;
  try {
    await m.sendMail({ from: `"Mam & Mam Overseas Ltd." <${mailFrom()}>`, to: u.email, subject: `Your verification code: ${u.verify.code}`,
      text: `Assalamu Alaikum ${u.name},\n\nYour Mam & Mam Overseas Ltd. verification code is ${u.verify.code}.\nIt expires in 30 minutes.\n\nIf you did not create an account, ignore this email.\n\nMam & Mam Overseas Ltd. · RL 1217` });
    return true;
  } catch (e) { console.error("Email send failed:", e.message); return false; }
}
function newCode(u) { u.verify = { code: String(crypto.randomInt(100000, 1000000)), sentAt: now(), tries: 0 }; }

/* ======================= actions ======================= */
const A = {};

/* ---- account ---- */
A["auth.login"] = async ({ email, pass }, u, ctx) => {
  limit(ctx.ip, "login", 10, 15 * 60e3);
  const x = db.users.find(y => y.email === str(email, 200).toLowerCase());
  must(x && checkPass(pass, x.pass), "Email or password is wrong.");
  must(zoneAllows(ctx.zone, x) || (ctx.zone === "main" && AGENT_HOST && x.role === "agent"), zoneMsg(ctx.zone), ctx.zone === "main" ? 400 : 403);
  must(x.status !== "suspended", "This account is suspended. Contact the agency.");
  if (x.status === "unverified") return { verify: x.id, email: x.email, msg: "Verify your email address to continue." };
  if (isStaffRole(x) && LOGIN_OTP && await getMailer()) return startOtp(x); // admin and staff: a one-time code by email as well
  ctx.login(x); return { msg: `Signed in as ${x.name}` };
};
/* admin / staff sign-in, step 2: the code from the email (LOGIN_OTP=off in the server settings turns this off) */
const LOGIN_OTP = !/^(0|off|no|false)$/i.test(process.env.LOGIN_OTP || "on");
const otps = new Map(); // ticket -> { uid, code, exp, tries, sent }
const maskMail = e => String(e).replace(/^(.)(.*)(.@.*)$/, (_, a, b, c) => a + "*".repeat(Math.min(6, b.length)) + c);
async function startOtp(x) {
  for (const [k, v] of otps) if (v.uid === x.id || v.exp < Date.now()) otps.delete(k);
  const tk = crypto.randomBytes(18).toString("hex"), code = String(crypto.randomInt(100000, 1000000));
  otps.set(tk, { uid: x.id, code, exp: Date.now() + 10 * 60e3, tries: 0, sent: Date.now() });
  const ok = await sendLoginCode(x, code);
  must(ok, "The sign-in code could not be emailed. Try again in a minute, or contact the admin.");
  return { otp: tk, email: maskMail(x.email), msg: `A sign-in code was sent to ${maskMail(x.email)}.`, ...(SHOW_CODES ? { code } : {}) };
}
async function sendLoginCode(x, code) {
  const m = await getMailer(); if (!m) return false;
  try {
    await m.sendMail({ from: `"Mam & Mam Overseas Ltd." <${mailFrom()}>`, to: x.email, subject: `Sign-in code: ${code}`,
      text: `Assalamu Alaikum ${x.name},\n\nYour sign-in code for the Mam & Mam Overseas Ltd. ${x.role === "admin" ? "admin" : "staff"} account is ${code}.\nIt expires in 10 minutes.\n\nIf you did not try to sign in, change your password now: someone knows it.\n\nMam & Mam Overseas Ltd. · RL 1217` });
    return true;
  } catch (e) { console.error("Sign-in code email failed:", e.message); return false; }
}
A["auth.otp"] = async ({ otp, code }, u, ctx) => {
  limit(ctx.ip, "otp", 20, 15 * 60e3);
  const o = otps.get(String(otp || "")); must(o && o.exp > Date.now(), "This code has expired. Sign in again.");
  o.tries++; if (o.tries > 5) { otps.delete(String(otp)); must(false, "Too many wrong codes. Sign in again."); }
  must(String(code || "").replace(/\D/g, "") === o.code, "The code is not correct. Check the email and try again.");
  otps.delete(String(otp)); const x = user(o.uid); must(x && x.status !== "suspended", "This account is suspended. Contact the agency.");
  ctx.login(x); return { msg: `Signed in as ${x.name}` };
};
A["auth.otpResend"] = async ({ otp }, u, ctx) => {
  limit(ctx.ip, "otpresend", 5, 15 * 60e3);
  const o = otps.get(String(otp || "")); must(o && o.exp > Date.now(), "This code has expired. Sign in again.");
  must(Date.now() - o.sent > 45e3, "Wait a minute before asking for a new code.");
  o.code = String(crypto.randomInt(100000, 1000000)); o.exp = Date.now() + 10 * 60e3; o.tries = 0; o.sent = Date.now();
  const x = user(o.uid); must(x && await sendLoginCode(x, o.code), "The sign-in code could not be emailed. Try again in a minute.");
  return { msg: `A new code was sent to ${maskMail(x.email)}.`, ...(SHOW_CODES ? { code: o.code } : {}) };
};
A["auth.handoff"] = async ({ token: t }, u, ctx) => {
  limit(ctx.ip, "handoff", 30, 15 * 60e3);
  const h = handoffs.get(String(t || "")); handoffs.delete(String(t || ""));
  must(ctx.zone === "agent" && h && h.exp > Date.now(), "This sign-in link has expired. Sign in again.");
  const x = user(h.uid); must(x && x.role === "agent" && x.status !== "suspended", "This sign-in link has expired. Sign in again.");
  ctx.login(x); return { msg: `Signed in as ${x.name}` };
};
A["auth.logout"] = async (_, u, ctx) => { ctx.logout(); return {}; };
A["auth.register"] = async (d, u, ctx) => {
  must(ctx.zone !== "admin" && ctx.zone !== "agent", zoneMsg(ctx.zone), 403);
  limit(ctx.ip, "register", 6, 3600e3);
  const role = ["candidate", "employer", "agent"].includes(d.role) ? d.role : "candidate";
  const email = str(d.email, 200).toLowerCase(), name = str(d.name, 120);
  must(name.length >= 2, "Enter your full name."); must(emailOk(email), "Enter a valid email address.");
  must(String(d.pass || "").length >= 6, "Password must be at least 6 characters."); must(d.pass === d.pass2, "Passwords do not match.");
  must(!db.users.some(x => x.email === email), "An account with this email already exists. Sign in instead.");
  const nu = { id: id("u"), role, name, email, pass: hashPass(String(d.pass)), status: role === "candidate" ? "unverified" : "pending", created: now() };
  if (role === "candidate") {
    const mobile = str(d.mobile, 30); must(mobile.replace(/\D/g, "").length >= 10, "Enter a valid mobile number, e.g. 01XXXXXXXXX.");
    nu.profile = { phone: mobile, experience: "", passport: "No", cv: null }; nu.saved = []; nu.alerts = { on: true, freq: "daily", cats: [], countries: [] };
    newCode(nu); db.users.push(nu);
    notify(nu.id, "Welcome! Complete your profile, upload your photo, passport and CV, then apply for jobs.");
    const sent = await sendCode(nu);
    return { verify: nu.id, email, sent, ...(SHOW_CODES ? { code: nu.verify.code } : {}) };
  }
  if (role === "employer") { must(str(d.company).length >= 2, "Enter your company name."); nu.company = { name: str(d.company, 150), country: "Saudi Arabia", city: "", industry: "Construction", website: "", licenseNo: "", about: "", verify: "none" }; nu.credits = 1; nu.featuredCredits = 0; }
  if (role === "agent") { must(str(d.business).length >= 2, "Enter your business name."); nu.agent = { business: str(d.business, 150), phone: str(d.aphone, 30), district: "", address: "", docs: {} }; notifyAdmins(`New agent registration: ${nu.agent.business}.${(m => m.length ? ` Matches the Agents list: ${m.map(b => b.name).join(", ")} (joined on approval).` : "")(bookMatches(nu))}`, "users"); }
  if (role === "employer") notifyAdmins(`New employer registration: ${nu.company.name}.`, "users");
  db.users.push(nu); notify(nu.id, "Welcome! Your account will be activated after the agency approves it.");
  ctx.login(nu); return { msg: "Account created." };
};
A["auth.verify"] = async ({ uid, code }, u, ctx) => {
  limit(ctx.ip, "verify", 20, 15 * 60e3);
  const x = user(uid); must(x && x.status === "unverified" && x.verify, "This account doesn't need verification.");
  must((x.verify.tries || 0) < 5, "Too many wrong codes. Send a new code.");
  must(Date.now() - Date.parse(x.verify.sentAt) < 30 * 60e3, "This code has expired. Send a new code.");
  if (str(code, 10) !== x.verify.code) { x.verify.tries = (x.verify.tries || 0) + 1; return { error: "That code is not correct. Check the email and try again." }; }
  x.status = "active"; x.emailVerified = now(); delete x.verify; ctx.login(x); return { msg: "Email verified." };
};
A["auth.resend"] = async ({ uid }, u, ctx) => {
  limit(ctx.ip, "resend", 5, 3600e3);
  const x = user(uid); must(x && x.status === "unverified", "This account doesn't need verification.");
  newCode(x); const sent = await sendCode(x);
  return { sent, msg: sent ? `A new code was sent to ${x.email}.` : "Email could not be sent. Contact the office.", ...(SHOW_CODES ? { code: x.verify.code } : {}) };
};
A["auth.changePassword"] = async ({ old, pass, pass2 }, u, ctx) => {
  must(u, "Sign in first.", 401); limit(ctx.ip, "chpass", 10, 3600e3);
  must(checkPass(old, u.pass), "Current password is wrong."); must(String(pass || "").length >= 8, "New password must be at least 8 characters."); must(pass === pass2, "New passwords do not match.");
  u.pass = hashPass(String(pass)); for (const [t, s] of Object.entries(db.sessions)) if (s.uid === u.id && t !== ctx.token) delete db.sessions[t];
  return { msg: "Password changed." };
};
A["notif.readAll"] = async (_, u) => { must(u, "Sign in first.", 401); db.notifications.forEach(n => { if (n.uid === u.id) n.read = true; }); return {}; };

/* ---- public ---- */
A["contact.send"] = async (d, u, ctx) => {
  limit(ctx.ip, "contact", 5, 3600e3);
  must(str(d.name).length >= 2 && str(d.phone).length >= 6 && str(d.message).length >= 2, "Fill in your name, phone and message.");
  db.messages.unshift({ id: id("m"), name: str(d.name, 120), phone: str(d.phone, 30), email: str(d.email, 200), type: str(d.type, 40), country: str(d.country, 60), message: str(d.message, 3000), at: now(), read: false });
  notifyAdmins(`New contact message from ${str(d.name, 60)}.`, "messages");
  return { msg: "Message sent. We will contact you soon." };
};
/* Track/Verify › Track: the passport number OR the mobile number (either one) finds the person's files */
A["track.lookup"] = async ({ passport, phone }, u, ctx) => {
  limit(ctx.ip, "track", 30, 3600e3);
  const P = str(passport, 30).replace(/\s+/g, "").toUpperCase(), dg = v => String(v || "").replace(/\D/g, "").slice(-10), M = dg(phone);
  must(P.length >= 6 || M.length >= 10, "Enter the passport number or the mobile number.");
  const byPass = x => P.length >= 6 && String(x || "").replace(/\s+/g, "").toUpperCase() === P, byPhone = x => M.length >= 10 && dg(x) === M;
  const strip = c => ({ id: c.id, country: c.country, status: c.status, statusText: c.statusText, baseStage: c.baseStage, history: c.history, created: c.created, card: c.card ? { sentAt: c.card.sentAt } : null });
  const appView = a => { const j = job(a.jobId); return { id: a.id, status: a.status, history: a.history, appliedAt: a.appliedAt, job: j ? { title: j.title, city: j.city, country: j.country } : null }; };
  const LN = { bmet: "BMET", ksa: "KSA (Saudi Arabia)", fiji: "Fiji" };
  const visaOf = pass => { const p = db.passports.find(x => byPassOf(x.passport, pass)); return p ? Object.entries(p.vstatus || {}).map(([k, v]) => ({ list: LN[k] || k, status: v.s, at: v.at })) : []; };
  const byPassOf = (a, b) => String(a || "").replace(/\s+/g, "").toUpperCase() === String(b || "").replace(/\s+/g, "").toUpperCase();
  const out = [], seen = new Set();
  for (const w of db.workers.filter(x => byPass(x.passport) || byPhone(x.phone))) {
    seen.add(w.passport.toUpperCase());
    out.push({ name: w.name, passport: w.passport, clearances: db.clearances.filter(c => c.workerId === w.id).map(strip), apps: db.applications.filter(a => a.workerId === w.id).map(appView),
      tickets: db.tickets.filter(t => t.workerId === w.id).map(t => ({ id: t.id, from: t.from, to: t.to, status: t.status, prefDate: t.prefDate, airline: t.airline, pnr: t.pnr, flightDate: t.flightDate })), visa: visaOf(w.passport) });
  }
  for (const c of db.users.filter(x => x.role === "candidate" && (byPass(x.profile?.passportNo) || byPhone(x.profile?.phone)))) {
    const pp = (c.profile?.passportNo || "").toUpperCase(); if (pp && seen.has(pp)) continue; if (pp) seen.add(pp);
    out.push({ name: c.name, passport: c.profile?.passportNo || "", clearances: db.clearances.filter(x => x.candidateId === c.id).map(strip), apps: db.applications.filter(a => a.candidateId === c.id).map(appView), tickets: [], visa: visaOf(pp) });
  }
  // a passport only in the office lists (KSA / Fiji entry): its status
  if (P.length >= 6 && !seen.has(P)) { const p = db.passports.find(x => byPass(x.passport)); if (p && (p.vstatus && Object.keys(p.vstatus).length)) out.push({ name: p.name, passport: p.passport, clearances: [], apps: [], tickets: [], visa: visaOf(p.passport) }); }
  return { result: out.length ? out.slice(0, 10) : false };
};
/* Track/Verify: find a money receipt, salary receipt or statement by its number and amount, and open its verify page */
A["verify.find"] = async ({ kind, no, amount }, u, ctx) => {
  limit(ctx.ip, "verify", 40, 3600e3);
  const N = str(no, 30).replace(/\s+/g, "").toUpperCase(), amt = Math.round(Number(String(amount ?? "").replace(/[^\d.]/g, "")) * 100) / 100;
  must(N, "Enter the number printed on the paper."); must(amt > 0, "Enter the amount printed on the paper.");
  const same = v => Math.abs(Math.round(Number(v || 0) * 100) / 100 - amt) < 0.01;
  const notFound = "No document matches this number and amount. Check both, or contact the office.";
  if (kind === "receipt") {
    const r = db.mr.receipts.find(x => x.no.toUpperCase() === N); must(r && same(r.amount), notFound);
    must(r.status === "approved" && r.token, r.void ? "This money receipt was cancelled by the office." : "This payment is not approved yet, so the money receipt is not valid yet.");
    return { go: `receipt-${r.token}` };
  }
  if (kind === "salary") { const p = db.salary.pays.find(x => x.no.toUpperCase() === N); must(p && (same(p.paid) || same(p.net)) && p.token, notFound); must(!p.void, "This salary receipt was cancelled by the office."); return { go: `salary-${p.token}` }; }
  if (kind === "statement") { const x = db.statements.list.find(y => y.no.toUpperCase() === N); must(x && (same(Math.abs(x.balance)) || same(x.debit) || same(x.credit)), notFound); return { go: `statement-${x.token}` }; }
  must(false, "Choose what to verify.");
};
/* ---- job seeker ---- */
A["cand.profile"] = async (d, u) => {
  needRole(u, "candidate");
  u.name = str(d.name, 120) || u.name;
  Object.assign(u.profile, { phone: str(d.phone, 30), district: str(d.district, 60), trade: str(d.trade, 80), experience: d.experience === "" ? "" : numv(d.experience, 0, 60),
    passportNo: str(d.passportNo, 30).toUpperCase(), passport: d.passportNo ? "Yes" : ["Yes", "Applied", "No"].includes(d.passport) ? d.passport : "No", passportExpiry: str(d.passportExpiry, 10),
    languages: str(d.languages, 200), skills: str(d.skills, 400), countries: str(d.countries, 200) });
  return { msg: "Profile saved." };
};
A["cand.upload"] = async ({ key, file }, u) => {
  needRole(u, "candidate"); must(["photo", "passportFile", "cv"].includes(key), "Unknown upload.");
  const ref = storeFile(file, u.id, key === "photo" ? { images: true, pdf: false } : key === "cv" ? { images: false, pdf: true, word: true } : {});
  dropFile(u.profile[key]); u.profile[key] = ref;
  return { msg: { photo: "Profile photo uploaded.", passportFile: "Passport copy uploaded.", cv: "CV uploaded." }[key] };
};
A["cand.removeFile"] = async ({ key }, u) => { needRole(u, "candidate"); must(["photo", "passportFile", "cv"].includes(key), "Unknown file."); dropFile(u.profile[key]); u.profile[key] = null; return { msg: "Removed." }; };
A["cand.save"] = async ({ jobId }, u) => {
  must(u?.role === "candidate", "Sign in as a job seeker to save jobs.", 401);
  const i = u.saved.indexOf(jobId); if (i >= 0) { u.saved.splice(i, 1); return { msg: "Removed from saved jobs." }; }
  must(job(jobId), "Job not found."); u.saved.push(jobId); return { msg: "Job saved." };
};
A["cand.alerts"] = async (d, u) => {
  needRole(u, "candidate");
  u.alerts = { on: !!d.on, freq: ["instant", "daily", "weekly"].includes(d.freq) ? d.freq : "daily", cats: (d.cats || []).map(x => str(x, 60)).slice(0, 20), countries: (d.countries || []).filter(c => COUNTRIES[c]) };
  return { msg: "Alert settings saved." };
};
A["cand.apply"] = async ({ jobId }, u) => {
  needRole(u, "candidate"); const j = job(jobId); must(j && j.status === "active", "This job is no longer open.");
  must(!db.applications.some(a => a.jobId === j.id && a.candidateId === u.id), "You already applied for this job.");
  const p = u.profile; must(u.name && p.phone && p.passportNo && p.trade && p.photo && p.cv, "Complete your profile (photo, passport number, trade and CV) before applying.");
  db.applications.push({ id: id("a"), jobId: j.id, candidateId: u.id, status: "applied", history: [{ s: "applied", at: now() }], appliedAt: now() });
  notify(u.id, `Application submitted: ${j.title} (${j.city}).`); notify(j.employerId, `New applicant for ${j.title}: ${u.name}.`);
  return { msg: "Application submitted. Track it below." };
};
A["app.withdraw"] = async ({ id: aid }, u) => {
  const a = db.applications.find(x => x.id === aid); must(a, "Application not found.");
  must(u && (a.candidateId === u.id || a.agentId === u.id), "Not allowed.", 403); must(["applied", "shortlisted"].includes(a.status), "This application can no longer be withdrawn.");
  db.applications = db.applications.filter(x => x.id !== aid); return { msg: "Application withdrawn." };
};
A["cand.clearance"] = async (d, u) => {
  needRole(u, "candidate"); must(clCountryOk(d.country), "Select a country.");
  must(!db.clearances.some(c => c.candidateId === u.id && c.status !== "rejected" && !c.card), "You already have a clearance file in progress.");
  const fullName = str(d.fullName, 120), passportNo = str(d.passportNo, 30).toUpperCase(); must(fullName && passportNo, "Enter your full name and passport number.");
  must(d.files?.visa, "Upload the visa copy."); must(d.files?.passport || u.profile.passportFile, "Upload the passport copy.");
  must((d.files.others || []).length <= 3, "Upload at most 3 other documents.");
  const files = { passport: d.files.passport ? storeFile(d.files.passport, u.id) : { ...u.profile.passportFile }, visa: storeFile(d.files.visa, u.id), contract: d.files.contract ? storeFile(d.files.contract, u.id) : null, others: (d.files.others || []).map(f => storeFile(f, u.id)) };
  const docs = ["Passport copy", "Visa copy", ...(files.contract ? ["Employment contract"] : []), ...(files.others.length ? ["Other documents"] : [])];
  db.clearances.push({ id: id("c"), agentId: null, workerId: null, candidateId: u.id, country: d.country, fullName, passportNo, employer: "", visaNo: "", visaType: "", flightDate: "", docs, files, notes: "", status: "pending", history: [{ s: "pending", at: now() }], created: now() });
  { const c = db.clearances[db.clearances.length - 1]; c.ref = ecRef(c); }
  if (!u.profile.passportNo) u.profile.passportNo = passportNo;
  notifyAdmins(`New BMET clearance file from job seeker ${fullName} (${d.country}).`, "clearance");
  return { msg: "Clearance application submitted. Follow its status below." };
};

/* ---- employer ---- */
const jobData = d => {
  must(COUNTRIES[d.country], "Choose a country."); must(str(d.title).length >= 2 && str(d.city).length >= 1, "Enter the job title and city.");
  const min = numv(d.salaryMin), max = numv(d.salaryMax); must(max >= min, "“Salary to” must be equal to or higher than “Salary from”.");
  const period = HOURLY.includes(d.country) ? "hour" : "month";
  must(period === "month" || max <= 500, "Fiji wages are per hour: enter the pay for one hour, e.g. 5.5 to 6.5 FJD.");
  must(min > 0, "Enter the salary.");
  return { title: str(d.title, 120), category: str(d.category, 60), country: d.country, city: str(d.city, 80), salaryMin: Math.round(min * 100) / 100, salaryMax: Math.round(max * 100) / 100, period, currency: COUNTRIES[d.country], type: str(d.type, 30),
    experience: numv(d.experience, 0, 50), contract: numv(d.contract, 1, 10), vacancies: numv(d.vacancies, 1, 10000), age: str(d.age, 20), deadline: str(d.deadline, 10),
    benefits: (d.benefits || []).map(x => str(x, 40)).slice(0, 10), description: str(d.description, 5000), requirements: str(d.requirements, 3000),
    label: ["urgent", "new", "upcoming"].includes(d.label) ? d.label : "" };
};
function publishJob(j) {
  const was = j.status; j.status = "active"; notify(j.employerId, `Your job “${j.title}” is now live.`);
  if (was === "pending") db.users.filter(c => c.role === "candidate" && c.alerts?.on && (!c.alerts.cats.length || c.alerts.cats.includes(j.category)) && (!c.alerts.countries.length || c.alerts.countries.includes(j.country)))
    .forEach(c => notify(c.id, `Job alert: ${j.title} in ${j.city}, ${j.country} (${j.currency} ${Number(j.salaryMin).toLocaleString("en-US")}+${j.period === "hour" ? "/hour" : ""}).`));
}
A["emp.company"] = async (d, u) => {
  must(u?.role === "employer", "Not allowed.", 403);
  Object.assign(u.company, { name: str(d.name, 150) || u.company.name, industry: str(d.industry, 60), country: COUNTRIES[d.country] ? d.country : u.company.country, city: str(d.city, 80), website: str(d.website, 200), licenseNo: str(d.licenseNo, 80), about: str(d.about, 3000) });
  if (str(d.person)) u.name = str(d.person, 120); return { msg: "Company profile saved." };
};
A["emp.requestVerify"] = async (_, u) => { must(u?.role === "employer", "Not allowed.", 403); u.company.verify = "pending"; notifyAdmins(`Verification request: ${u.company.name}.`, "users"); return { msg: "Verification request sent to the agency." }; };
A["emp.jobSave"] = async (d, u) => {
  needRole(u, "employer"); const data = jobData(d);
  if (d.id) {
    const j = job(d.id); must(j && j.employerId === u.id, "Job not found.");
    Object.assign(j, data, { updatedAt: now() }); if (db.settings.moderation && j.status === "active") j.status = "pending";
    if (j.status === "pending") notifyAdmins(`Job edited, needs review: ${j.title}.`, "jobs");
    return { msg: db.settings.moderation ? "Changes saved and sent for review." : "Changes saved." };
  }
  if (db.settings.paidPosting) { must((u.credits || 0) >= 1, "No job post credits left."); u.credits--; }
  const nj = { id: id("j"), employerId: u.id, ...data, featured: false, status: "pending", created: now() };
  db.jobs.push(nj); if (!db.settings.moderation) publishJob(nj);
  notifyAdmins(`New job submitted for review: ${nj.title} by ${u.company.name}.`, "jobs");
  return { msg: db.settings.moderation ? "Job submitted. It goes live after the agency approves it." : "Job is live." };
};
/* job post templates: add, update or delete a profession */
A["admin.jobTemplate"] = async (d, u) => {
  needPerm(u, "jobs");
  const L = db.jobTemplates;
  if (d.op === "delete") { const x = L.find(t => t.id === d.id); must(x, "Template not found."); db.jobTemplates = L.filter(t => t !== x); return { msg: `“${x.name}” removed from the list.` }; }
  const lines = v => (Array.isArray(v) ? v : String(v ?? "").split(/\r?\n/)).map(s => str(s, 300).replace(/^(?:[•\-*]|Bullet)\s*/i, "")).filter(Boolean).slice(0, 25);
  const name = str(d.name, 60), duties = lines(d.duties), requirements = lines(d.requirements);
  must(name.length >= 2, "Enter the job name, e.g. Electrician.");
  must(duties.length, "Write at least one responsibility.");
  must(!L.some(t => t.id !== d.id && t.name.toLowerCase() === name.toLowerCase()), `“${name}” is already in the list.`);
  const data = { name, category: str(d.category, 60) || "Construction", duties, requirements };
  if (d.op === "update") { const x = L.find(t => t.id === d.id); must(x, "Template not found."); Object.assign(x, data); return { msg: "Template saved.", id: x.id }; }
  must(L.length < 200, "Too many templates.");
  const x = { id: id("jt"), ...data }; L.push(x);
  return { msg: `“${name}” added to the job list.`, id: x.id };
};
/* admin / staff with the jobs permission: post a job for any employer or edit any job; goes live without review */
A["admin.jobSave"] = async (d, u) => {
  needPerm(u, "jobs"); const data = jobData(d);
  let employerId = null, employerName = "";
  if (d.employerId) { const e = user(d.employerId); must(e && e.role === "employer", "Choose an employer from the list."); employerId = e.id; }
  else employerName = str(d.employerName, 120);
  if (d.id) {
    const j = job(d.id); must(j, "Job not found.");
    const before = j.employerId; Object.assign(j, data, { employerId, employerName, featured: !!d.featured, updatedAt: now() });
    if (before && before === employerId) notify(before, `The agency updated your job “${j.title}”.`);
    return { msg: "Changes saved.", jobId: j.id };
  }
  const nj = { id: id("j"), employerId, employerName, ...data, featured: !!d.featured, status: "pending", created: now(), postedBy: u.id };
  db.jobs.push(nj);
  if (d.publish) { publishJob(nj); return { msg: "Job is live.", jobId: nj.id }; }
  nj.status = "paused"; return { msg: "Job saved as unpublished. Publish it from the list when ready.", jobId: nj.id };
};
A["emp.jobState"] = async ({ id: jid, v }, u) => {
  must(u?.role === "employer", "Not allowed.", 403); const j = job(jid); must(j && j.employerId === u.id, "Job not found.");
  if (v === "reopen") { must(j.status === "closed", "Only closed jobs can be reopened."); j.status = db.settings.moderation ? "pending" : "active"; return { msg: db.settings.moderation ? "Sent for review before going live again." : "Job is live again." }; }
  const allowed = { paused: ["active"], active: ["paused"], closed: ["active", "paused"] }; must(allowed[v]?.includes(j.status), "This change isn't possible.");
  j.status = v; return { msg: `Job ${v === "active" ? "resumed" : v}.` };
};
A["app.status"] = async ({ id: aid, status }, u) => {
  const a = db.applications.find(x => x.id === aid); must(a, "Application not found."); must([...STAGES, "rejected"].includes(status), "Unknown status.");
  const j = job(a.jobId); must(can(u, "apps") || (u?.role === "employer" && j?.employerId === u.id), "Not allowed.", 403);
  if (a.status === status) return {};
  a.status = status; a.history.push({ s: status, at: now() });
  const name = a.workerId ? worker(a.workerId)?.name : user(a.candidateId)?.name;
  if (a.agentId) notify(a.agentId, `${name}: application for ${j?.title} moved to ${LABEL[status]}.`); else notify(a.candidateId, `Your application for ${j?.title} moved to ${LABEL[status]}.`);
  return { msg: `Status changed to ${LABEL[status]}. ${a.agentId ? "Agent" : "Candidate"} notified.` };
};
A["emp.buy"] = async ({ pkgId }, u) => {
  must(u?.role === "employer", "Not allowed.", 403); const p = db.packages.find(x => x.id === pkgId); must(p, "Package not found.");
  if (!p.price) {
    must(!db.orders.some(o => o.uid === u.id && o.price === 0), "The free package can be claimed once.");
    u.credits = (u.credits || 0) + Number(p.posts); u.featuredCredits = (u.featuredCredits || 0) + Number(p.featured);
    db.orders.push({ id: id("o"), uid: u.id, name: p.name, price: 0, posts: p.posts, featured: p.featured, status: "paid", at: now() }); return { msg: "Free credits added." };
  }
  db.orders.push({ id: id("o"), uid: u.id, name: p.name, price: p.price, posts: p.posts, featured: p.featured, status: "pending", at: now() });
  notifyAdmins(`Package request from ${u.company.name}: ${p.name}.`, "packages"); return { msg: "Package requested. Credits are added once payment is confirmed." };
};

/* share photocard (PNG made in the browser) for link previews; admin/staff with jobs permission or the job's employer */
A["job.card"] = async ({ id: jid, file }, u) => {
  const j = job(jid); must(j, "Job not found.");
  must(can(u, "jobs") || (u?.role === "employer" && j.employerId === u.id), "Not allowed.", 403);
  must(typeof file?.data === "string" && file.data.startsWith("data:image/png"), "The card must be a PNG image.");
  const ref = storeFile({ name: `job-${j.id}.png`, data: file.data }, u.id, { pdf: false, isPublic: true });
  if (j.card) dropFile(j.card);
  j.card = ref; j.cardAt = now();
  return {};
};

/* ---- agent ---- */
const AGENT_DOC_KEYS = ["photo", "nid", "tradeLicense"];
A["agent.profile"] = async (d, u) => {
  must(u?.role === "agent", "Not allowed.", 403);
  u.name = str(d.name, 120) || u.name; Object.assign(u.agent, { business: str(d.business, 150) || u.agent.business, phone: str(d.phone, 30), district: str(d.district, 60), address: str(d.address, 300) });
  return { msg: "Profile saved." };
};
A["agent.upload"] = async ({ key, file }, u) => {
  must(u?.role === "agent", "Not allowed.", 403); must(AGENT_DOC_KEYS.includes(key), "Unknown document.");
  u.agent.docs = u.agent.docs || {}; const ref = storeFile(file, u.id, key === "photo" ? { pdf: false } : {});
  dropFile(u.agent.docs[key]); u.agent.docs[key] = { ...ref, at: now() };
  if (u.status === "pending" && AGENT_DOC_KEYS.every(k => u.agent.docs[k])) notifyAdmins(`${u.agent.business} uploaded all documents (photo, NID, trade licence).`, "users");
  return { msg: `${{ photo: "Photo", nid: "NID", tradeLicense: "Trade License" }[key]} uploaded.` };
};
A["agent.removeDoc"] = async ({ key }, u) => { must(u?.role === "agent" && AGENT_DOC_KEYS.includes(key), "Not allowed.", 403); dropFile(u.agent.docs?.[key]); u.agent.docs[key] = null; return { msg: "Removed." }; };
A["agent.workerSave"] = async (d, u) => {
  must(u?.role === "agent", "Not allowed.", 403);
  const pass = str(d.passport, 30).toUpperCase(); must(str(d.name).length >= 2 && pass, "Enter the worker's name and passport number.");
  must(!db.workers.some(x => x.passport.toUpperCase() === pass && x.id !== d.id), "A worker with this passport number is already registered.");
  const data = { name: str(d.name, 120), father: str(d.father, 120), passport: pass, passportExpiry: str(d.passportExpiry, 10), dob: str(d.dob, 10), phone: str(d.phone, 30), district: str(d.district, 60), trade: str(d.trade, 80), experience: numv(d.experience, 0, 60) };
  if (d.id) { const w = worker(d.id); must(w && w.agentId === u.id, "Worker not found."); Object.assign(w, data); return { msg: "Worker updated." }; }
  db.workers.push({ id: id("w"), agentId: u.id, ...data, created: now() }); return { msg: "Worker added." };
};
A["agent.workerDelete"] = async ({ id: wid }, u) => {
  const w = worker(wid); must(u?.role === "agent" && w && w.agentId === u.id, "Worker not found.");
  must(!db.clearances.some(c => c.workerId === wid && c.status !== "rejected") && !db.applications.some(a => a.workerId === wid), "This worker has a clearance file or job application, so they cannot be removed.");
  db.workers = db.workers.filter(x => x.id !== wid); return { msg: "Worker removed." };
};
A["agent.clearance"] = async (d, u) => {
  needRole(u, "agent");
  if (!d.workerId && d.newWorker) { // a worker typed into the application form is added to "My workers" first
    const nw = d.newWorker, pass = str(nw.passport, 30).toUpperCase();
    must(str(nw.name).length >= 2 && pass, "Enter the worker's name and passport number.");
    must(!db.workers.some(x => x.passport.toUpperCase() === pass), `A worker with passport ${pass} is already registered. Choose them from your workers.`);
    must(clCountryOk(d.country), "Select a country."); must(d.files?.passport && d.files?.visa, "Upload the passport copy and visa copy."); must(str(d.employer), "Enter the employer / sponsor name.");
    const nwr = { id: id("w"), agentId: u.id, name: str(nw.name, 120), father: "", passport: pass, passportExpiry: "", dob: "", phone: str(nw.phone, 30), district: "", trade: str(nw.trade, 80), experience: 0, created: now() };
    db.workers.push(nwr); d.workerId = nwr.id;
  }
  const w = worker(d.workerId); must(w && w.agentId === u.id, "Choose one of your workers."); must(clCountryOk(d.country), "Select a country.");
  must(!db.clearances.some(c => c.workerId === w.id && c.status !== "rejected"), "This worker already has an open clearance file.");
  must(d.files?.passport && d.files?.visa, "Upload the passport copy and visa copy."); must(str(d.employer), "Enter the employer / sponsor name.");
  const files = { passport: storeFile(d.files.passport, u.id), visa: storeFile(d.files.visa, u.id), contract: d.files.contract ? storeFile(d.files.contract, u.id) : null, others: [] };
  const docs = ["Passport copy", "Visa copy", ...(files.contract ? ["Employment contract"] : [])];
  db.clearances.push({ id: id("c"), agentId: u.id, workerId: w.id, candidateId: null, country: d.country, employer: str(d.employer, 150), visaNo: str(d.visaNo, 40), visaType: str(d.visaType, 40), flightDate: str(d.flightDate, 10), docs, files, notes: str(d.notes, 2000), status: "pending", history: [{ s: "pending", at: now() }], created: now() });
  { const c = db.clearances[db.clearances.length - 1]; c.ref = ecRef(c); }
  const fee = Number(db.settings.clearanceFee || 0);
  if (fee > 0) db.ledger.push({ id: id("l"), agentId: u.id, type: "charge", desc: `BMET clearance processing: ${w.name}`, amount: fee, date: now().slice(0, 10), method: "", ref: "", status: "confirmed" });
  notifyAdmins(`New BMET clearance file: ${w.name} (${d.country}) from ${u.agent.business}.`, "clearance");
  return { msg: "Clearance application submitted." };
};
/* the agency creates a clearance file itself: for a registered agent (the agent sees it in their portal) or for a custom agent / reference name typed in */
/* bulk entry: many rows, one destination; documents are not needed here (they can be added later in Details) */
A["admin.clearanceBulk"] = async (d, u) => {
  needPerm(u, "clearance");
  const rows = Array.isArray(d.rows) ? d.rows.slice(0, 200) : []; must(rows.length, "Add at least one row.");
  must(clCountryOk(d.country), "Select a country.");
  const seen = new Set();
  rows.forEach((r, i) => { // check every row first, so nothing is saved when one row is wrong
    const pass = str(r.passport, 30).replace(/\s+/g, "").toUpperCase(), n = `Row ${i + 1}: `;
    must(pass, n + "enter the passport number."); must(str(r.name).length >= 2, n + "enter the candidate name.");
    must(r.agentId ? db.users.some(x => x.id === r.agentId && x.role === "agent") : str(r.agentName), n + "select the agent or write a name.");
    must(!seen.has(pass), n + `passport ${pass} is entered twice.`); seen.add(pass);
    must(r.fee === "" || r.fee == null || (Number(r.fee) >= 0 && Number(r.fee) < 1e8), n + "check the processing fee."); must(r.due === "" || r.due == null || (Number(r.due) >= 0 && Number(r.due) < 1e8), n + "check the due amount.");
    const old = db.workers.find(x => x.passport.replace(/\s+/g, "").toUpperCase() === pass);
    if (old) {
      must(r.agentId ? old.agentId === r.agentId : !old.agentId, n + `passport ${pass} is registered with ${user(old.agentId)?.agent?.business || old.agentName || "another agent"}.`);
      must(!db.clearances.some(c => c.workerId === old.id && c.status !== "rejected"), n + `${old.name} already has an open clearance file.`);
    }
  });
  for (const r of rows) await A["admin.clearance"]({ bulk: true, agentId: r.agentId || "", agentName: r.agentName, newWorker: { name: r.name, passport: r.passport, phone: r.phone }, icNo: r.icNo, fee: r.fee, due: r.due, country: d.country, employer: d.employer, visaType: d.visaType, flightDate: d.flightDate, notes: d.notes }, u);
  notifyAdmins(`${rows.length} BMET clearance file(s) added in bulk (${d.country}) by ${u.name}.`, "clearance");
  return { msg: `${rows.length} clearance application(s) created.` };
};
A["admin.clearance"] = async (d, u) => {
  needPerm(u, "clearance");
  const ag = d.agentId ? db.users.find(x => x.id === d.agentId && x.role === "agent") : null;
  must(!d.agentId || ag, "Agent not found.");
  const agentName = ag ? "" : str(d.agentName, 120);
  must(clCountryOk(d.country), "Select a country."); if (!d.bulk) { must(d.files?.passport && d.files?.visa, "Upload the passport copy and visa copy."); must(str(d.employer), "Enter the employer / sponsor name."); }
  const mine = w => ag ? w.agentId === ag.id : !w.agentId;
  if (!d.workerId && d.newWorker) {
    const nw = d.newWorker, pass = str(nw.passport, 30).replace(/\s+/g, "").toUpperCase();
    must(str(nw.name).length >= 2 && pass, "Enter the worker's name and passport number.");
    const old = db.workers.find(x => x.passport.replace(/\s+/g, "").toUpperCase() === pass);
    if (old) { must(mine(old), `Passport ${pass} is already registered with ${user(old.agentId)?.agent?.business || old.agentName || "another agent"}.`); d.workerId = old.id; if (str(nw.phone) && !old.phone) old.phone = str(nw.phone, 30); }
    else {
      const nwr = { id: id("w"), agentId: ag ? ag.id : null, ...(ag ? {} : { agentName }), name: str(nw.name, 120), father: "", passport: pass, passportExpiry: "", dob: "", phone: str(nw.phone, 30), district: "", trade: str(nw.trade, 80), experience: 0, created: now(), by: u.id };
      db.workers.push(nwr); d.workerId = nwr.id;
    }
  }
  const w = worker(d.workerId); must(w && mine(w), ag ? "Choose one of this agent's workers." : "Choose a worker.");
  must(!db.clearances.some(c => c.workerId === w.id && c.status !== "rejected"), `${w.name} already has an open clearance file.`);
  const owner = ag ? ag.id : u.id;
  const up = f => f ? storeFile(f, owner) : null;
  const files = { passport: up(d.files?.passport), visa: up(d.files?.visa), contract: up(d.files?.contract), others: [] };
  const docs = [...(files.passport ? ["Passport copy"] : []), ...(files.visa ? ["Visa copy"] : []), ...(files.contract ? ["Employment contract"] : [])];
  // processing fee: the amount typed for this file, or the default fee from Site settings; due: an older amount the agent still owes
  const amt = v => v === "" || v == null ? null : Math.round(Number(v) * 100) / 100;
  const fee = amt(d.fee) ?? Number(db.settings.clearanceFee || 0), due = amt(d.due) || 0;
  must(fee >= 0 && fee < 1e8 && due >= 0 && due < 1e8, "Check the processing fee and due amount.");
  const c = { id: id("c"), agentId: ag ? ag.id : null, ...(ag ? {} : { agentName }), workerId: w.id, candidateId: null, country: d.country, employer: str(d.employer, 150), visaNo: str(d.visaNo, 40), visaType: str(d.visaType, 40), flightDate: str(d.flightDate, 10), icNo: str(d.icNo, 40), fee, due, docs, files, notes: str(d.notes, 2000), status: "pending", history: [{ s: "pending", at: now() }], created: now(), by: u.id };
  // a RAIMS IC number given with the file becomes its reference number (when no other file has it)
  const icRef = c.icNo.replace(/\s+/g, "").toUpperCase();
  db.clearances.push(c); c.ref = /^IC[-A-Z0-9/]{3,39}$/.test(icRef) && !db.clearances.some(x => x !== c && String(x.ref || "").toUpperCase() === icRef) ? icRef : ecRef(c);
  if (ag && fee > 0) db.ledger.push({ id: id("l"), agentId: ag.id, type: "charge", desc: `BMET clearance processing: ${w.name} (${c.ref})`, amount: fee, date: now().slice(0, 10), method: "", ref: "", status: "confirmed" });
  if (ag && due > 0) db.ledger.push({ id: id("l"), agentId: ag.id, type: "charge", desc: `Previous due: ${w.name} (${c.ref})`, amount: due, date: now().slice(0, 10), method: "", ref: "", status: "confirmed" });
  if (ag) notify(ag.id, `The agency created a BMET clearance file for ${w.name} (${d.country})${due > 0 ? `; previous due ${bdt(due)} added to your account` : ""}.`);
  return { msg: "Clearance application created." };
};
A["agent.applyJob"] = async ({ jobId, workerIds }, u) => {
  needRole(u, "agent"); const j = job(jobId); must(j && j.status === "active", "This job is no longer open.");
  const ids = (workerIds || []).filter(wid => { const w = worker(wid); return w && w.agentId === u.id && !db.applications.some(a => a.jobId === j.id && a.workerId === wid); });
  must(ids.length, "Select at least one worker who hasn't applied yet.");
  ids.forEach(wid => db.applications.push({ id: id("a"), jobId: j.id, candidateId: null, workerId: wid, agentId: u.id, status: "applied", history: [{ s: "applied", at: now() }], appliedAt: now() }));
  notify(j.employerId, `${ids.length} new applicant(s) for ${j.title} via agent ${u.agent.business}.`);
  return { msg: `${ids.length} application(s) submitted for ${j.title}.` };
};
A["agent.ticket"] = async (d, u) => {
  needRole(u, "agent"); const w = worker(d.workerId); must(w && w.agentId === u.id, "Choose one of your workers."); must(str(d.from) && str(d.to) && str(d.prefDate), "Fill in the route and date.");
  db.tickets.push({ id: id("t"), agentId: u.id, workerId: w.id, from: str(d.from, 80), to: str(d.to, 80), prefDate: str(d.prefDate, 10), notes: str(d.notes, 500), status: "requested", fare: "", pnr: "", airline: "", flightDate: "", created: now() });
  notifyAdmins(`Air ticket request: ${w.name}, ${str(d.from, 80)} → ${str(d.to, 80)} (${u.agent.business}).`, "tickets");
  return { msg: "Ticket request sent. The agency will confirm the fare and booking." };
};
A["agent.ticketCancel"] = async ({ id: tid }, u) => { const t = db.tickets.find(x => x.id === tid); must(u?.role === "agent" && t && t.agentId === u.id && t.status === "requested", "Not allowed.", 403); t.status = "cancelled"; return { msg: "Request cancelled." }; };
A["agent.payment"] = async (d, u) => {
  must(u?.role === "agent", "Not allowed.", 403); const amount = numv(d.amount, 0, 1e8); must(amount >= 1, "Enter the amount.");
  db.ledger.push({ id: id("l"), at: now(), agentId: u.id, type: "payment", desc: str(d.desc, 200) || "Payment sent by agent", amount, date: str(d.date, 10) || now().slice(0, 10), method: str(d.method, 40), ref: str(d.ref, 80), status: "pending" });
  notifyAdmins(`Payment reported by ${u.agent.business}: ${bdt(amount)} via ${str(d.method, 40)}.`, "ledger");
  return { msg: "Payment submitted. It appears in your balance after confirmation." };
};

/* ---- first admin account (one-time link printed by the installer) ---- */
A["setup.admin"] = async (d, u, ctx) => {
  must(ctx.zone !== "main", "This setup link is not valid. Use the link printed by the installer.", 403);
  limit(ctx.ip, "setup", 10, 3600e3);
  must(!db.users.some(x => x.role === "admin"), "The admin account already exists. Sign in instead.");
  const tok = process.env.SETUP_TOKEN || ""; must(tok.length >= 16 && str(d.token, 200) === tok, "This setup link is not valid. Use the link printed by the installer.");
  const email = str(d.email, 200).toLowerCase(); must(str(d.name).length >= 2 && emailOk(email), "Enter your name and a valid email.");
  must(String(d.pass || "").length >= 8, "Password must be at least 8 characters."); must(d.pass === d.pass2, "Passwords do not match.");
  must(!db.users.some(x => x.email === email), "An account with this email already exists.");
  const x = { id: id("u"), role: "admin", name: str(d.name, 120), email, pass: hashPass(String(d.pass)), status: "active", created: now() };
  db.users.push(x); ctx.login(x); return { msg: "Admin account created. Welcome!" };
};

/* ---- email (SMTP) settings: admin only; the password is never sent back to the browser ---- */
A["admin.smtp"] = async (d, u) => {
  must(u?.role === "admin", "Only the admin can change email settings.", 403);
  const prev = db.smtp || {};
  db.smtp = { host: str(d.host, 200), port: numv(d.port || 465, 1, 65535), user: str(d.user, 200), pass: d.pass ? String(d.pass).slice(0, 300) : prev.pass || "", from: str(d.from, 200) };
  mailer = null; return { msg: "Email settings saved. Send a test email to check them." };
};
A["admin.smtpTest"] = async (_, u) => {
  must(u?.role === "admin", "Only the admin can do this.", 403);
  mailer = null; const m = await getMailer(); must(m, "Email is not set up yet: fill in the server, username and password.");
  try { await m.sendMail({ from: `"Mam & Mam Overseas Ltd." <${mailFrom()}>`, to: u.email, subject: "Test email from your website", text: "Email sending works. Job seekers will now receive their verification codes." }); }
  catch (e) { throw new Fail(`Sending failed: ${e.message}`); }
  return { msg: `Test email sent to ${u.email}.` };
};

/* ---- admin & staff ---- */
A["admin.userState"] = async ({ id: xid, status }, u) => {
  needPerm(u, "users"); const x = user(xid); must(x && x.id !== u.id, "Not allowed."); must(["active", "suspended"].includes(status), "Unknown status.");
  must(u.role === "admin" || !["admin", "staff"].includes(x.role), "Only the admin can change admin or staff accounts.", 403);
  x.status = status; if (status === "active") notify(x.id, "Your account has been approved.");
  if (status === "suspended") for (const [t, s] of Object.entries(db.sessions)) if (s.uid === x.id) delete db.sessions[t];
  // an approved agent who was already in the Agents list (same name, mobile or email): the earlier records join the account
  const linked = status === "active" && x.role === "agent" ? linkAgentAccount(x) : [];
  return { msg: `Account ${status === "active" ? "activated" : "suspended"}.${linked.length ? ` Linked with ${linked.map(l => `${l.name} (${l.passports} passports, ${l.files} clearance files, ${l.receipts} receipts)`).join(", ")}.` : ""}` };
};
A["admin.markVerified"] = async ({ id: xid }, u) => { needPerm(u, "users"); const x = user(xid); must(x && x.status === "unverified", "Not needed."); x.status = "active"; x.emailVerified = now(); delete x.verify; return { msg: "Email marked as verified." }; };
A["admin.verifyCompany"] = async ({ id: xid }, u) => { needPerm(u, "users"); const x = user(xid); must(x?.company, "Not an employer."); x.company.verify = "verified"; if (x.status === "pending") x.status = "active"; notify(x.id, "Your company has been verified."); return { msg: "Company verified." }; };
A["admin.deleteUser"] = async ({ id: xid }, u) => {
  needPerm(u, "users"); const x = user(xid); must(x && x.id !== u.id, "Not allowed."); must(u.role === "admin" || !["admin", "staff"].includes(x.role), "Only the admin can delete admin or staff accounts.", 403);
  const gone = db.jobs.filter(j => j.employerId === xid).map(j => j.id);
  db.users = db.users.filter(y => y.id !== xid); db.jobs = db.jobs.filter(j => j.employerId !== xid);
  db.applications = db.applications.filter(a => a.candidateId !== xid && a.agentId !== xid && !gone.includes(a.jobId));
  db.workers = db.workers.filter(w => w.agentId !== xid); db.clearances = db.clearances.filter(c => c.agentId !== xid && c.candidateId !== xid);
  db.ledger = db.ledger.filter(l => l.agentId !== xid); db.tickets = db.tickets.filter(t => t.agentId !== xid);
  for (const [t, s] of Object.entries(db.sessions)) if (s.uid === xid) delete db.sessions[t];
  Object.values(db.files).filter(f => f.owner === xid).forEach(dropFile);
  return { msg: "Account deleted." };
};
A["admin.job"] = async ({ id: jid, op, v }, u) => {
  needPerm(u, "jobs"); const j = job(jid); must(j, "Job not found.");
  if (op === "publish") { publishJob(j); return { msg: "Job published." }; }
  if (op === "reject") { j.status = "rejected"; notify(j.employerId, `Your job “${j.title}” was not approved. Contact the agency for details.`); return { msg: "Job rejected." }; }
  if (op === "pause") { j.status = "paused"; return { msg: "Job unpublished." }; }
  if (op === "feature") { j.featured = !!v; return { msg: j.featured ? "Marked as featured." : "Removed from featured." }; }
  if (op === "delete") { db.jobs = db.jobs.filter(x => x.id !== jid); db.applications = db.applications.filter(a => a.jobId !== jid); return { msg: "Job deleted." }; }
  throw new Fail("Unknown operation.");
};
/* the agency adds or replaces a document of a clearance file (e.g. a file made in bulk without documents) */
A["admin.clDoc"] = async ({ id: cid, kind, file }, u) => {
  needPerm(u, "clearance"); const c = db.clearances.find(x => x.id === cid); must(c, "File not found.");
  const L = { passport: "Passport copy", visa: "Visa copy", contract: "Employment contract" }; must(L[kind], "Unknown document."); must(file, "Choose the file.");
  c.files = c.files || { passport: null, visa: null, contract: null, others: [] };
  const ref = storeFile(file, c.agentId || c.candidateId || u.id);
  if (c.files[kind]) dropFile(c.files[kind]);
  c.files[kind] = ref; if (!c.docs.includes(L[kind])) c.docs.push(L[kind]);
  return { msg: `${L[kind]} saved.` };
};
/* only the admin deletes a BMET clearance file: its documents, the charges it made on the agent account, and the worker if nothing else uses them */
A["admin.clDelete"] = async ({ id: cid }, u) => {
  must(u?.role === "admin", "Only the admin can delete a clearance file.", 403);
  const c = db.clearances.find(x => x.id === cid); must(c, "File not found.");
  const w = c.workerId ? worker(c.workerId) : null, name = w?.name || c.fullName || "the worker";
  for (const f of [c.files?.passport, c.files?.visa, c.files?.contract, ...(c.files?.others || []), c.card, c.payment?.file]) if (f) { try { dropFile(f); } catch {} }
  if (c.ref) db.ledger = db.ledger.filter(l => !(l.type === "charge" && l.agentId === c.agentId && String(l.desc || "").includes(`(${c.ref})`)));
  db.clearances = db.clearances.filter(x => x !== c);
  let gone = false;
  if (w && !db.clearances.some(x => x.workerId === w.id) && !db.applications.some(a => a.workerId === w.id)) { db.workers = db.workers.filter(x => x !== w); gone = true; }
  return { msg: `Clearance file ${c.ref || ""} for ${name} deleted${gone ? ", with the worker" : ""}.` };
};
A["admin.clStatus"] = async ({ id: cid, status, text }, u) => {
  needPerm(u, "clearance"); const c = db.clearances.find(x => x.id === cid); must(c, "File not found."); must([...CL_STAGES, "rejected", "custom"].includes(status), "Unknown status.");
  const name = c.workerId ? worker(c.workerId)?.name : c.fullName || user(c.candidateId)?.name;
  if (status === "custom") { // a status written by the agency, e.g. "Fingerprint taken"; the progress bar stays at the last stage
    const t = str(text, 80); must(t.length >= 2, "Write the status (at least 2 letters).");
    if (c.status === "custom" && c.statusText === t) return {};
    if (c.status !== "custom") c.baseStage = CL_STAGES.includes(c.status) ? c.status : (c.baseStage || "pending");
    c.status = "custom"; c.statusText = t; c.history.push({ s: "custom", t, at: now() });
    notify(c.agentId || c.candidateId, `BMET clearance for ${name}: ${t}.`);
    return { msg: `Clearance status: ${t}.${c.agentId ? " Agent notified." : c.candidateId ? " Job seeker notified." : ""}` };
  }
  if (c.status === status) return {};
  c.status = status; delete c.statusText; c.history.push({ s: status, at: now() });
  const payNow = c.agentId && ["final", "approved"].includes(status) && !["submitted", "paid"].includes(c.payment?.status) ? " Send the payment receipt from BMET clearance (Unpaid)." : "";
  notify(c.agentId || c.candidateId, `BMET clearance for ${name}: ${LABEL[status]}.${status === "approved" ? " The clearance card will be sent to your portal." : ""}${payNow}`);
  return { msg: `Clearance status: ${LABEL[status]}.${c.agentId ? " Agent notified." : c.candidateId ? " Job seeker notified." : ""}` };
};
/* ---- RAIMS (raims.oep.gov.bd): the agency's own RAIMS sign-in, kept on this server; the EC application list
   is read and each file here with the same IC number (or passport) takes the RAIMS status, up to Approved ---- */
const RAIMS = process.env.RAIMS_BASE || "https://raims.oep.gov.bd";
const raimsKey = (() => { const f = path.join(DATA_DIR, "raims.key"); try { return fs.readFileSync(f); } catch { const k = crypto.randomBytes(32); fs.writeFileSync(f, k, { mode: 0o600 }); return k; } })();
const seal = t => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", raimsKey, iv), e = Buffer.concat([c.update(String(t), "utf8"), c.final()]); return [iv, c.getAuthTag(), e].map(b => b.toString("base64")).join("."); };
const unseal = v => { const [iv, tag, e] = String(v).split(".").map(b => Buffer.from(b, "base64")); const d = crypto.createDecipheriv("aes-256-gcm", raimsKey, iv); d.setAuthTag(tag); return Buffer.concat([d.update(e), d.final()]).toString("utf8"); };
function jar() {
  const c = {};
  return { set(res) { for (const h of res.headers.getSetCookie?.() || []) { const [kv] = h.split(";"), i = kv.indexOf("="); if (i > 0) c[kv.slice(0, i).trim()] = kv.slice(i + 1).trim(); } }, get: () => Object.entries(c).map(([k, v]) => `${k}=${v}`).join("; "), c };
}
async function rq(J, url, opt = {}) {
  let u = url.startsWith("http") ? url.replace(/^https?:\/\/raims\.oep\.gov\.bd/i, RAIMS) : RAIMS + url, r;
  for (let i = 0; i < 6; i++) {
    r = await fetch(u, { ...opt, redirect: "manual", headers: { "User-Agent": "Mozilla/5.0 (MAM Overseas portal)", Accept: "text/html,application/json,*/*", ...(opt.headers || {}), Cookie: J.get() }, signal: AbortSignal.timeout(30000) });
    J.set(r); if (![301, 302, 303, 307, 308].includes(r.status)) break;
    u = new URL(r.headers.get("location"), u).href; if (r.status !== 307 && r.status !== 308) opt = { headers: opt.headers };
  }
  return { r, url: u, text: await r.text() };
}
const RAIMS_STAGE = [[/reject|cancel|declin/i, "rejected"], [/^approved$|^approve$|clearance (issued|approved)|^issued/i, "approved"], [/final/i, "final"], [/\badg\b|additional director general/i, "adg"],
  [/director general|\bdg\b/i, "adg"], [/\bdirector\b/i, "director"], [/\bdd\b|deputy director/i, "dd"], [/\bad\b|assistant director/i, "ad"], [/section|desk|officer/i, "section"], [/submit|bmet|forward|pending|process/i, "sent_bmet"]];
const raimsStage = t => (RAIMS_STAGE.find(([re]) => re.test(String(t).trim())) || [])[1] || "";
const cells = tr => [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => htmlText(m[1]).replace(/\s+/g, " ").trim());
function raimsRows(html, json) {
  const rows = [];
  const hrefs = h => [...String(h || "").matchAll(/href=["']([^"'#]+)["']/gi)].map(m => m[1].replace(/&amp;/g, "&")).filter(x => !/^(javascript|mailto|tel):/i.test(x));
  if (json) { const data = Array.isArray(json) ? json : json.data || json.rows || json.items || [], links = []; let head = [];
    for (const x of data) { if (Array.isArray(x)) { rows.push(x.map(v => htmlText(String(v ?? "")).trim())); links.push(x.flatMap(v => hrefs(v))); }
      else { head = Object.keys(x); rows.push(Object.values(x).map(v => htmlText(typeof v === "object" && v ? JSON.stringify(v) : String(v ?? "")).trim()));
        links.push([...Object.values(x).flatMap(v => hrefs(v)), ...(x.id && /^\d+$/.test(String(x.id)) ? [`/agency/ec/application/individual/${x.id}/show`] : [])]); } }
    return { head, rows, links }; }
  const t = /<table[\s\S]*?<\/table>/i.exec(html || ""); if (!t) return { head: [], rows };
  const trs = [...t[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(m => m[0]); const head = trs.length ? cells(trs[0]) : [];
  const links = [];
  for (const tr of trs.slice(1)) { const c = cells(tr); if (c.length > 1) { rows.push(c); links.push(hrefs(tr)); } }
  return { head, rows, links };
}
/* signs in and reads the EC application list; throws a Fail with a plain message when something is wrong */
async function raimsOpen(search = "") {
  const R = db.raims; must(R?.email && R?.pass, "Save the RAIMS email and password first (BMET clearance › RAIMS).");
  const J = jar();
  try {
    const lp = await rq(J, "/agency/login");
    const tok = (/name="_token"[^>]*value="([^"]+)"/.exec(lp.text) || /name="csrf-token"[^>]*content="([^"]+)"/.exec(lp.text) || [])[1];
    const action = (/<form[^>]*action="([^"]*login[^"]*)"/i.exec(lp.text) || [])[1] || "/agency/login";
    must(tok, "The RAIMS sign-in page did not load (no form). The site may be down or blocking this server.");
    const li = await rq(J, action.replace(/&amp;/g, "&"), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: lp.url }, body: new URLSearchParams({ _token: tok, email: R.email, password: unseal(R.pass), remember: "on" }).toString() });
    if (/name="password"/i.test(li.text) && /login/i.test(li.url)) { const m = /class="[^"]*(?:invalid-feedback|alert|text-danger|error)[^"]*"[^>]*>([\s\S]*?)<\//i.exec(li.text); must(false, `RAIMS did not accept the sign-in${m ? `: ${htmlText(m[1]).trim()}` : ". Check the email and password."}`); }
    if (/otp|verification code/i.test(li.text) && /name="(otp|code)"/i.test(li.text)) must(false, "RAIMS asks for a one-time code at sign-in, so it cannot be read automatically.");
    const lst = await rq(J, "/agency/ec/application/list");
    must(!/name="password"/i.test(lst.text), "RAIMS signed out before the list opened. Try again.");
    let parsed = raimsRows(lst.text), ajax = "", pages = 1;
    if (!parsed.rows.length) { // a list filled by the page's script: ask the same address the script asks
      const aj = (/ajax\s*:\s*\{?\s*(?:url\s*:\s*)?["'`]([^"'`]+)["'`]/i.exec(lst.text) || /url\s*:\s*["'`]([^"'`]*(?:ec|application)[^"'`]*)["'`]/i.exec(lst.text) || [])[1];
      if (aj) { const q = new URLSearchParams({ draw: "1", start: "0", length: "1000", "search[value]": search, "search[regex]": "false" }); const j = await rq(J, aj.replace(/&amp;/g, "&") + (aj.includes("?") ? "&" : "?") + q, { headers: { "X-Requested-With": "XMLHttpRequest", Accept: "application/json", "X-CSRF-TOKEN": (/name="csrf-token"[^>]*content="([^"]+)"/.exec(lst.text) || [])[1] || "" } }); try { parsed = raimsRows("", JSON.parse(j.text)); ajax = aj; } catch {} }
    } else { // a list in pages (?page=2 …): read them all (at most 60)
      const last = Math.min(60, Math.max(1, ...[...lst.text.matchAll(/[?&]page=(\d+)/g)].map(m => +m[1])));
      for (let pg = 2; pg <= last; pg++) { const x = raimsRows((await rq(J, `/agency/ec/application/list?page=${pg}`)).text); if (!x.rows.length) break; parsed.rows.push(...x.rows); parsed.links.push(...x.links); pages = pg; }
    }
    parsed.page = { url: lst.url, status: lst.r.status, title: htmlText((/<title>([\s\S]*?)<\/title>/i.exec(lst.text) || [])[1] || ""), tables: (lst.text.match(/<table/gi) || []).length, scripts: [...lst.text.matchAll(/<script[^>]*src="([^"]+)"/gi)].map(m => m[1]).filter(x => !/jquery|bootstrap|cdn/i.test(x)).slice(0, 6), text: htmlText(lst.text).slice(0, 1200), login: { url: li.url, status: li.r.status } };
    return { J, lst, parsed, ajax, pages };
  } catch (e) { if (e instanceof Fail) throw e; must(false, `Could not reach RAIMS: ${e.message}`); }
}
async function raimsSync(by = "auto") {
  const R = db.raims, out = { at: now(), by, rows: 0, matched: 0, updated: [], statuses: {} };
  try {
    const { parsed, ajax } = await raimsOpen(); if (ajax) out.ajax = ajax;
    out.head = parsed.head; out.rows = parsed.rows.length; out.sample = parsed.rows.slice(0, 3);
    const si = parsed.head.findIndex(h => /status/i.test(h));
    for (const row of parsed.rows) {
      const line = row.join(" | "), ic = (/\bIC[-\s]?[A-Z0-9][A-Z0-9-]{3,}/i.exec(line) || [])[0]?.replace(/\s+/g, "").toUpperCase();
      const pp = (/\b([A-Z]{1,2}\d{7,8})\b/.exec(line) || [])[1];
      const st = si >= 0 ? row[si] : (row.find(v => raimsStage(v.replace(/^status:\s*/i, ""))) || "").replace(/^status:\s*/i, "");
      if (st) out.statuses[st] = (out.statuses[st] || 0) + 1;
      const c = db.clearances.find(x => ic && (String(x.ref || "").toUpperCase() === ic || String(x.icNo || "").replace(/\s+/g, "").toUpperCase() === ic)) || db.clearances.find(x => pp && ppNorm(worker(x.workerId)?.passport || user(x.candidateId)?.profile?.passportNo || x.passport || "") === pp);
      if (!c) continue; out.matched++;
      const stage = raimsStage(st); if (!stage) continue;
      const cur = c.status === "custom" ? c.baseStage : c.status, ci = CL_STAGES.indexOf(cur), ni = CL_STAGES.indexOf(stage);
      if (c.status === "approved" || c.card) continue; // done here already
      if (stage !== "rejected" && ni <= ci) continue; // RAIMS behind or equal: keep ours
      await A["admin.clStatus"]({ id: c.id, status: stage }, { role: "admin", id: "raims", name: "RAIMS" });
      c.history[c.history.length - 1].by = "RAIMS"; c.raims = { status: st, at: now() };
      out.updated.push({ ref: c.ref, name: worker(c.workerId)?.name || c.fullName || "", from: LABEL[cur] || cur, to: LABEL[stage], raims: st });
    }
    out.ok = true;
  } catch (e) { out.ok = false; out.error = e instanceof Fail ? e.message : `Could not reach RAIMS: ${e.message}`; }
  if (db.raims) db.raims.last = out; save(); return out;
}
setInterval(() => { if (db.raims?.auto && db.raims.pass) raimsSync("auto").catch(() => {}); }, 30 * 60e3).unref();
A["admin.raims"] = async (d, u) => {
  needPerm(u, "clearance");
  if (d.op === "save") {
    must(u.role === "admin", "Only the admin can change the RAIMS sign-in.", 403);
    const email = str(d.email, 120).toLowerCase(); must(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), "Enter the RAIMS email.");
    db.raims = { ...(db.raims || {}), email, auto: d.auto !== false, ...(d.password ? { pass: seal(String(d.password).slice(0, 200)) } : {}) };
    must(db.raims.pass, "Enter the RAIMS password.");
    return { msg: "RAIMS sign-in saved." };
  }
  if (d.op === "remove") { must(u.role === "admin", "Only the admin can change the RAIMS sign-in.", 403); delete db.raims; return { msg: "RAIMS sign-in removed." }; }
  /* Add bulk: an IC number or application ID → every worker under it (name, passport, country, IC number) */
  if (d.op === "lookup") {
    const raw = str(d.q, 300).trim(), q = raw.replace(/\s+/g, "").toUpperCase(); must(q.length >= 3, "Enter the IC number, the RAIMS link or its number.");
    const norm = v => String(v || "").replace(/\s+/g, "").toUpperCase(), PPR = /\b([A-Z]{1,2}\d{7,8})\b/;
    // the RAIMS page of one application (…/agency/ec/application/individual/1705123/show): its workers
    const showPage = async (J, link, ic0, country0) => {
      const pg = await rq(J, link), txt = htmlText(pg.text), title = htmlText((/<title>([\s\S]*?)<\/title>/i.exec(pg.text) || [])[1] || ""), tables = (pg.text.match(/<table/gi) || []).length;
      must(!/name="password"/i.test(pg.text), "RAIMS signed out. Try again.");
      const icp = norm((/\bIC[-\s]?\d{4}[-\s]?RL\d+[-\s]?\d+/i.exec(txt) || /\bIC[-\s]?[A-Z0-9][A-Z0-9-]{5,}/i.exec(txt) || [])[0]) || ic0 || "";
      const ctry = country0 || (() => { const i = txt.search(/country/i); if (i < 0) return ""; const seg = txt.slice(i, i + 80).toLowerCase(); let best = ""; let at = 1e9;
        for (const c of [...Object.keys(COUNTRIES), ...CL_REGIONS.flatMap(([, L]) => L)]) { const j = seg.indexOf(c.toLowerCase()); if (j >= 0 && (j < at || (j === at && c.length > best.length))) { at = j; best = c; } } return best; })();
      const people = [];
      for (const m of pg.text.matchAll(/<table[\s\S]*?<\/table>/gi)) {
        const t = raimsRows(m[0]); if (!t.rows.some(r => PPR.test(r.join(" ")))) continue;
        const H = t.head.map(h => h.toLowerCase()), c = re => H.findIndex(h => re.test(h)), ci = { name: c(/name/), pp: c(/passport/), country: c(/country|destination/), ic: c(/\bic\b|clearance/) };
        for (const r of t.rows) { const pp = (PPR.exec(r.join(" ")) || [])[1]; if (!pp) continue;
          people.push({ ic: (ci.ic >= 0 && norm(r[ci.ic])) || icp, name: ci.name >= 0 ? r[ci.name] : r.find(v => /^[A-Z][A-Z .'-]{4,}$/.test(v) && !PPR.test(v)) || "", passport: pp, country: (ci.country >= 0 && r[ci.country]) || ctry }); }
      }
      if (!people.length) { // one person on the page, written as label: value
        const pp = (/Passport\s*(?:No\.?|Number)?\s*:?\s*([A-Z]{1,2}\d{7,8})/i.exec(txt) || PPR.exec(txt) || [])[1];
        const nm = ((/(?:Worker|Applicant|Emigrant|Full)?\s*Name\s*:?\s*([A-Z][A-Z .'-]{3,60}?)(?=\s{2,}|\s+[A-Z][a-z]+\s*:|$)/.exec(txt) || [])[1] || "").trim();
        if (pp) people.push({ ic: icp, name: nm, passport: pp, country: ctry });
      }
      return { people, txt, title, url: pg.url, tables };
    };
    // a RAIMS page link pasted as it is (any page on raims.oep.gov.bd), or only the number in such a link
    const link = /^https?:\/\/raims\.oep\.gov\.bd(\/[^\s]*)$/i.exec(raw)?.[1] || (/^(\d{4,10})$/.test(raw) ? `/agency/ec/application/individual/${raw}/show` : "");
    if (link) {
      const { J } = await raimsOpen(); const r = await showPage(J, link);
      if (!r.people.length) return { problem: "That RAIMS page has no workers that this site can read.", seen: { page: link, title: r.title, url: r.url, text: r.txt.slice(0, 1500), tables: r.tables } };
      return { people: r.people.slice(0, 100) };
    }
    const { J, parsed, ajax, pages } = await raimsOpen(q), H = parsed.head.map(h => h.toLowerCase());
    const col = re => H.findIndex(h => re.test(h));
    const ci = { ic: col(/\bic\b|ic no|clearance no|ref/), name: col(/name/), country: col(/country|destination/) };
    const hit = parsed.rows.map((r, i) => [r, i]).filter(([r]) => r.some(v => norm(v).includes(q)));
    let people = [];
    for (const [r, i] of hit.slice(0, 20)) {
      const link = (parsed.links?.[i] || []).find(h => /individual\/\d+\/show/i.test(h)) || (parsed.links?.[i] || []).find(h => /ec\/application\/.*(show|view)/i.test(h));
      const ic = norm((/\bIC[-\s]?[A-Z0-9][A-Z0-9-]{3,}/i.exec(r.join(" | ")) || [])[0]) || (ci.ic >= 0 ? norm(r[ci.ic]) : "");
      if (link) { const x = await showPage(J, link, ic, ci.country >= 0 ? r[ci.country] : ""); if (x.people.length) { people.push(...x.people); continue; } }
      const pp = (PPR.exec(r.join(" ")) || [])[1]; if (pp) people.push({ ic, name: ci.name >= 0 ? r[ci.name] : "", passport: pp, country: ci.country >= 0 ? r[ci.country] : "" });
    }
    const seen = new Set(); people = people.filter(x => x.passport && !seen.has(x.passport) && seen.add(x.passport));
    if (!people.length) return { problem: `Nothing on RAIMS matches ${q}.`, seen: { rows: parsed.rows.length, pages, head: parsed.head.slice(0, 12), ajax, first: (parsed.rows[0] || []).slice(0, 10), links: (parsed.links?.[0] || []).slice(0, 5), hits: hit.length, list: parsed.page } };
    return { people: people.slice(0, 100) };
  }
  if (d.op === "sync") { const r = await raimsSync(u.name); return r.ok ? { msg: `RAIMS: ${r.rows} files read, ${r.matched} matched, ${r.updated.length} updated.` } : { problem: r.error }; }
  must(false, "Unknown request.");
};
/* the EC reference number can be set or changed by the agency until the file is Approved */
A["admin.clRef"] = async ({ id: cid, ref }, u) => {
  needPerm(u, "clearance"); const c = db.clearances.find(x => x.id === cid); must(c, "File not found.");
  must(c.status !== "approved" && !c.card, "The EC Ref No cannot be changed after the file is Approved.");
  const r = str(ref, 40).toUpperCase().replace(/\s+/g, ""); must(/^[A-Z0-9][A-Z0-9\-/]{3,39}$/.test(r), "Enter a valid EC Ref No (letters, numbers and dashes).");
  must(!db.clearances.some(x => x.id !== c.id && String(x.ref || "").toUpperCase() === r), "Another file already has this EC Ref No.");
  c.ref = r; return { msg: `EC Ref No saved: ${r}` };
};
A["admin.card"] = async ({ id: cid, file, fee }, u) => {
  needPerm(u, "clearance"); const c = db.clearances.find(x => x.id === cid); must(c && c.status === "approved", "Upload the card after the file is Approved.");
  const owner = c.agentId || c.candidateId; const ref = storeFile(file, owner || u.id);
  const replacing = !!c.card; const f = replacing ? Number(c.card.fee || 0) : numv(fee, 0, 1e7);
  if (c.card) dropFile(c.card);
  const isCand = !c.agentId;
  c.card = { ...ref, fee: f, feeNote: isCand && f > 0 ? (c.card?.feePaid ? "paid" : "pay at the office") : "", sentAt: now(), feePaid: c.card?.feePaid || c.payment?.status === "paid" || false };
  const name = c.workerId ? worker(c.workerId)?.name : c.fullName;
  if (!replacing && f > 0 && c.agentId) db.ledger.push({ id: id("l"), agentId: c.agentId, type: "charge", desc: `BMET clearance card fee: ${name}`, amount: f, date: now().slice(0, 10), method: "", ref: "", status: "confirmed" });
  notify(owner, `${replacing ? "Updated clearance card" : "Clearance card"} for ${name} is ready. Download it from your portal${f > 0 && !replacing ? `. Card fee: ${bdt(f)}` : ""}.`);
  return { msg: c.agentId ? "Clearance card sent to the agent." : c.candidateId ? "Clearance card sent to the job seeker." : "Clearance card saved." };
};
/* clearance fee: after Final Approval the agent sends a payment receipt; the agency approves it and the file shows Paid */
const CL_PAYABLE = ["final", "approved"];
A["agent.clPayment"] = async (d, u) => {
  needRole(u, "agent"); const c = db.clearances.find(x => x.id === d.id); must(c && c.agentId === u.id, "File not found.");
  must(CL_PAYABLE.includes(c.status === "custom" ? c.baseStage : c.status), "Payment opens after the Final Approval.");
  must(!(c.payment && ["submitted", "paid"].includes(c.payment.status)) && !c.card?.feePaid, "A payment for this file is already sent.");
  const amount = numv(d.amount, 1, 10000000); must(amount > 0, "Enter the amount you paid.");
  must(d.file, "Attach the payment receipt.");
  if (c.payment?.file) dropFile(c.payment.file);
  c.payment = { status: "submitted", amount, method: str(d.method, 40), ref: str(d.ref, 80), file: storeFile(d.file, u.id), at: now(), note: "" };
  const w = worker(c.workerId);
  notifyAdmins(`Clearance payment receipt: ${w?.name || "worker"} (${c.ref}), BDT ${amount} from ${u.agent?.business || u.name}.`, "clearance");
  return { msg: "Payment receipt sent. The agency will check it and mark the file Paid." };
};
A["admin.clPayment"] = async ({ id: cid, op, note }, u) => {
  needPerm(u, "clearance"); const c = db.clearances.find(x => x.id === cid); must(c?.payment?.status === "submitted", "No payment receipt is waiting for this file.");
  const w = worker(c.workerId);
  if (op === "approve") { c.payment.status = "paid"; c.payment.checkedAt = now(); if (c.card) c.card.feePaid = true; notify(c.agentId, `Payment approved for ${w?.name || "your worker"} (${c.ref}). The file is Paid.`); return { msg: "Payment approved. The agent now sees Paid." }; }
  must(op === "reject", "Unknown action.");
  c.payment.status = "rejected"; c.payment.note = str(note, 300); c.payment.checkedAt = now();
  notify(c.agentId, `Payment receipt for ${w?.name || "your worker"} (${c.ref}) was not accepted${c.payment.note ? `: ${c.payment.note}` : ""}. Please send it again.`);
  return { msg: "Receipt rejected. The agent is asked to send it again." };
};
A["admin.cardFeePaid"] = async ({ id: cid, v }, u) => { needPerm(u, "clearance"); const c = db.clearances.find(x => x.id === cid); must(c?.card, "No card."); c.card.feePaid = !!v; c.card.feeNote = v ? "paid" : "pay at the office"; return { msg: v ? "Card fee marked as received." : "Card fee marked as unpaid." }; };
A["admin.ticketBook"] = async (d, u) => {
  needPerm(u, "tickets"); const t = db.tickets.find(x => x.id === d.id); must(t && t.status === "requested", "Ticket not found.");
  Object.assign(t, { airline: str(d.airline, 80), pnr: str(d.pnr, 20).toUpperCase(), flightDate: str(d.flightDate, 10), fare: numv(d.fare, 0, 1e7), status: "booked" });
  const w = worker(t.workerId);
  if (d.charge && t.agentId && t.fare > 0) db.ledger.push({ id: id("l"), agentId: t.agentId, type: "charge", desc: `Air ticket ${t.from} → ${t.to}: ${w?.name}`, amount: t.fare, date: now().slice(0, 10), method: "", ref: t.pnr, status: "confirmed" });
  notify(t.agentId, `Ticket booked for ${w?.name}: ${t.airline}, PNR ${t.pnr}, flight ${t.flightDate}.`);
  return { msg: "Ticket marked as booked." };
};
A["admin.ticketCancel"] = async ({ id: tid }, u) => { needPerm(u, "tickets"); const t = db.tickets.find(x => x.id === tid); must(t && t.status === "requested", "Ticket not found."); t.status = "cancelled"; notify(t.agentId, `Ticket request for ${worker(t.workerId)?.name} was cancelled by the agency.`); return { msg: "Request cancelled." }; };
A["admin.ledgerAdd"] = async (d, u) => { // one entry, or several at once (d.rows)
  needPerm(u, "ledger"); const ag = user(d.agentId); must(ag?.role === "agent", "Choose an agent.");
  const list = Array.isArray(d.rows) ? d.rows.slice(0, 50) : [d]; must(list.length, "Add at least one entry.");
  const made = list.map((x, i) => {
    const at = list.length > 1 ? ` (row ${i + 1})` : "";
    const charge = x.type !== "payment", qty = charge && x.qty != null && x.qty !== "" ? numv(x.qty, 1, 10000) : 1;
    const rate = x.rate != null && x.rate !== "" ? numv(x.rate, 0, 1e8) : numv(x.amount, 0, 1e8);
    const amount = Math.round(qty * rate * 100) / 100; must(amount >= 1 && amount <= 1e9 && str(x.desc), `Enter the amount and description${at}.`);
    return { id: id("l"), at: now(), agentId: ag.id, type: charge ? "charge" : "payment", desc: str(x.desc, 200), amount, ...(charge ? { qty, rate } : {}), date: /^\d{4}-\d{2}-\d{2}$/.test(x.date || "") ? x.date : now().slice(0, 10), method: charge ? "" : str(x.method, 80), ref: charge ? "" : str(x.ref, 80), status: "confirmed" };
  });
  db.ledger.push(...made);
  for (const l of made) notify(ag.id, l.type === "charge" ? `New charge on your account: ${l.desc.slice(0, 100)} (${bdt(l.amount)}).` : `Payment of ${bdt(l.amount)} recorded.`);
  return { msg: made.length > 1 ? `${made.length} entries added.` : "Entry added." };
};
A["admin.ledgerEdit"] = async (d, u) => { // change rate × quantity (and details/date) of a charge
  needPerm(u, "ledger"); const l = db.ledger.find(x => x.id === d.id); must(l && l.type === "charge", "Entry not found.");
  must(!l.mr, "This entry comes from a money receipt.");
  const qty = numv(d.qty, 1, 10000), rate = numv(d.rate, 0, 1e8), amount = Math.round(qty * rate * 100) / 100; must(amount >= 1 && amount <= 1e9, "Enter the rate and quantity.");
  Object.assign(l, { qty, rate, amount }); if (str(d.desc)) l.desc = str(d.desc, 200); if (/^\d{4}-\d{2}-\d{2}$/.test(d.date || "")) l.date = d.date;
  return { msg: `Saved: ${rate.toLocaleString("en-US")} × ${qty} = ${amount.toLocaleString("en-US")} BDT.` };
};
A["admin.ledgerConfirm"] = async ({ id: lid, ok }, u) => {
  needPerm(u, "ledger"); const l = db.ledger.find(x => x.id === lid); must(l && l.status === "pending", "Entry not found.");
  l.status = ok ? "confirmed" : "rejected"; if (ok) l.confirmedAt = now();
  notify(l.agentId, ok ? `Payment of ${bdt(l.amount)} confirmed. New balance: ${bdt(balanceOf(l.agentId))}.` : `Payment of ${bdt(l.amount)} (ref ${l.ref || "—"}) could not be confirmed. Contact the office.`);
  return { msg: ok ? "Payment confirmed." : "Payment marked as not received." };
};
A["admin.ledgerDelete"] = async ({ id: lid }, u) => { needPerm(u, "ledger"); db.ledger = db.ledger.filter(l => l.id !== lid); return { msg: "Entry deleted." }; };
/* floating buttons on the website: WhatsApp and the "i" help assistant can be switched on/off (off by default) */
A["admin.fabs"] = async ({ key, v }, u) => {
  needPerm(u, "settings"); must(["fabWhatsapp", "fabHelp"].includes(key), "Unknown button.");
  db.settings[key] = !!v; const name = key === "fabWhatsapp" ? "WhatsApp button" : "Help (i) button";
  return { msg: `${name} is ${v ? "on" : "off"}.` };
};
A["admin.paidPosting"] = async ({ v }, u) => { needPerm(u, "packages"); db.settings.paidPosting = !!v; return { msg: v ? "Paid job posting is on." : "Job posting is free." }; };
A["admin.packages"] = async ({ packages }, u) => {
  needPerm(u, "packages"); must(Array.isArray(packages), "Bad data.");
  db.packages.forEach((p, i) => { const q = packages[i]; if (q) Object.assign(p, { name: str(q.name, 40) || p.name, price: numv(q.price), posts: numv(q.posts, 0, 1000), featured: numv(q.featured, 0, 1000) }); });
  return { msg: "Packages saved." };
};
A["admin.orderPaid"] = async ({ id: oid }, u) => {
  needPerm(u, "packages"); const o = db.orders.find(x => x.id === oid); must(o && o.status === "pending", "Order not found.");
  o.status = "paid"; const x = user(o.uid); if (x) { x.credits = (x.credits || 0) + Number(o.posts); x.featuredCredits = (x.featuredCredits || 0) + Number(o.featured); notify(x.id, `Payment received. ${o.posts} job post credits added.`); }
  return { msg: "Order marked paid; credits added." };
};
A["admin.content"] = async (d, u) => {
  needPerm(u, "content");
  if (d.op === "testimonial") { must(str(d.name) && str(d.text), "Enter the name and feedback."); db.testimonials.unshift({ id: id("tm"), name: str(d.name, 80), role: str(d.role, 80), country: COUNTRIES[d.country] ? d.country : "", rating: numv(d.rating, 1, 5), text: str(d.text, 1000), at: now() }); return { msg: "Testimonial added to the home page." }; }
  if (d.op === "team" || d.op === "teamUpdate") {
    must(str(d.name) && str(d.title), "Enter the name and designation.");
    const data = { name: str(d.name, 80), title: str(d.title, 80), dept: TEAM_DEPTS.includes(d.dept) ? d.dept : TEAM_DEPTS[0], bio: str(d.bio, 600),
      expertise: String(d.expertise || "").split(",").map(x => str(x, 40)).filter(Boolean).slice(0, 8), years: d.years === "" || d.years == null ? "" : numv(d.years, 0, 60),
      phone: str(d.phone, 30), whatsapp: str(d.whatsapp, 20).replace(/\D/g, ""), email: str(d.email, 120), website: webUrl(d.website), order: numv(d.order ?? 99, 0, 999) };
    must(!str(d.website) || data.website, "Enter a valid website address, e.g. www.example.com");
    const m = d.op === "teamUpdate" ? db.team.find(x => x.id === d.id) : { id: id("tm") };
    must(m, "Team member not found.");
    must(!db.team.some(x => x.id !== m.id && Number(x.order) === data.order), "Another team member already has this display order. Each member needs a different number, because it is part of their ID.");
    if (d.file) { const ref = storeFile(d.file, u.id, { pdf: false, isPublic: true }); if (m.photo) dropFile(m.photo); data.photo = ref; }
    else if (d.removePhoto && m.photo) { dropFile(m.photo); data.photo = null; }
    Object.assign(m, data); if (d.op === "team") db.team.push(m);
    return { msg: d.op === "team" ? "Team member added." : "Team member updated." };
  }
  if (d.op === "gallery") { const ref = storeFile(d.file, u.id, { pdf: false, isPublic: true }); db.gallery.unshift({ id: id("g"), fileId: ref.id, caption: str(d.caption, 120), at: now() }); return { msg: "Photo added to the gallery." }; }
  if (d.op === "remove") {
    must(["testimonials", "team", "gallery"].includes(d.list), "Unknown list.");
    if (d.list === "gallery") { const g = db.gallery.find(x => x.id === d.id); if (g) dropFile({ id: g.fileId }); }
    if (d.list === "team") { const m = db.team.find(x => x.id === d.id); if (m?.photo) dropFile(m.photo); }
    db[d.list] = db[d.list].filter(x => x.id !== d.id); return { msg: "Removed." };
  }
  throw new Fail("Unknown operation.");
};
A["admin.staff"] = async (d, u) => {
  must(u?.role === "admin", "Only the admin can manage staff.", 403);
  const perms = (d.perms || []).filter(p => STAFF_PERMS.some(s => s[0] === p));
  if (d.op === "add") {
    const email = str(d.email, 200).toLowerCase(); must((str(d.name) || d.memberId) && emailOk(email), "Enter the name and a valid email."); must(String(d.pass || "").length >= 8, "Password must be at least 8 characters.");
    must(!db.users.some(x => x.email === email), "An account with this email already exists.");
    const role = d.role === "admin" ? "admin" : "staff", m = d.memberId ? db.team.find(x => x.id === d.memberId) : null;
    must(!d.memberId || m, "Team member not found.");
    must(!m || !db.users.some(x => x.memberId === m.id), "This team member already has an ID.");
    db.users.push({ id: id("u"), role, name: str(d.name, 120) || m?.name, email, pass: hashPass(String(d.pass)), status: "active", created: now(), perms: role === "admin" ? [] : perms, ...(m ? { memberId: m.id } : {}) });
    return { msg: role === "admin" ? "Admin account created." : "Staff account created." };
  }
  if (d.op === "perms") { const x = user(d.id); must(x?.role === "staff", "Staff member not found."); x.perms = perms; return {}; }
  if (d.op === "member") { // link an ID to an Expert Team member (name and designation on receipts)
    const x = user(d.id); must(x && (x.role === "staff" || x.role === "admin"), "Account not found.");
    const m = d.memberId ? db.team.find(y => y.id === d.memberId) : null; must(!d.memberId || m, "Team member not found.");
    must(!m || !db.users.some(y => y.id !== x.id && y.memberId === m.id), "This team member already has an ID.");
    if (m) { x.memberId = m.id; x.name = m.name; } else delete x.memberId; return { msg: m ? `Linked to ${m.name}.` : "Link removed." };
  }
  throw new Fail("Unknown operation.");
};
A["admin.post"] = async (d, u) => {
  needPerm(u, "blog");
  if (d.op === "delete") { db.posts = db.posts.filter(p => p.id !== d.id); return { msg: "Post deleted." }; }
  const data = { title: str(d.title, 200), excerpt: str(d.excerpt, 400), body: str(d.body, 20000) }; must(data.title && data.body, "Enter a title and body.");
  if (d.id) { const p = db.posts.find(x => x.id === d.id); must(p, "Post not found."); Object.assign(p, data); return { msg: "Post updated." }; }
  db.posts.unshift({ id: id("p"), ...data, date: now() }); return { msg: "Post published." };
};
A["admin.seo"] = async ({ seo }, u) => { needPerm(u, "seo"); for (const k of Object.keys(db.seo)) if (seo?.[k]) db.seo[k] = { title: str(seo[k].title, 120), desc: str(seo[k].desc, 300) }; return { msg: "SEO settings saved." }; };
A["admin.settings"] = async (d, u) => {
  needPerm(u, "settings"); const s = db.settings;
  must(!str(d.email) || emailOk(str(d.email)), "Enter a valid office email, e.g. info@yourdomain.com");
  for (const k of ["facebook", "youtube", "linkedin", "tiktok"]) must(!str(d[k]) || webUrl(d[k]), { facebook: "Enter a valid Facebook link, e.g. facebook.com/yourpage", youtube: "Enter a valid YouTube link, e.g. youtube.com/@yourchannel", linkedin: "Enter a valid LinkedIn link, e.g. linkedin.com/company/yourpage", tiktok: "Enter a valid TikTok link, e.g. tiktok.com/@yourpage" }[k]);
  Object.assign(s, { phone: str(d.phone, 40), email: str(d.email, 200), address: str(d.address, 300), hours: str(d.hours, 120), moderation: !!d.moderation, clearanceFee: numv(d.clearanceFee, 0, 1e7),
    whatsapp: str(d.whatsapp, 20).replace(/\D/g, ""), social: { facebook: webUrl(d.facebook), youtube: webUrl(d.youtube), linkedin: webUrl(d.linkedin), tiktok: webUrl(d.tiktok) } });
  s.rates = { ...s.rates }; for (const c of Object.values(COUNTRIES)) s.rates[c] = numv(d.rates?.[c], 0, 100000);
  return { msg: "Settings saved." };
};
A["admin.scenery"] = async (d, u) => {
  needPerm(u, "content"); const L = db.scenery; const x = d.id ? L.find(y => y.id === d.id) : null;
  if (d.op === "add") {
    must(L.length < 40, "The slideshow can have up to 40 pictures. Remove one first.");
    const big = storeFile(d.big, u.id, { pdf: false, isPublic: true }); const small = d.small ? storeFile(d.small, u.id, { pdf: false, isPublic: true }) : null;
    L.unshift({ id: id("sc"), big: big.id, small: small?.id || null, alt: str(d.alt, 140) || "Picture of Bangladesh", pos: POS.includes(d.pos) ? d.pos : POS[0], hidden: false, at: now() });
    return { msg: "Picture added to the slideshow." };
  }
  if (d.op === "speed") { db.settings.slideSec = numv(d.sec, 3, 30); return { msg: "Slideshow speed saved." }; }
  if (d.op === "reset") {
    const names = JSON.parse(fs.readFileSync(path.join(HERE, "seed", "scenery.json"), "utf8"));
    for (const n of names) if (!L.some(y => y.builtin === n.name)) L.push({ id: id("sc"), builtin: n.name, alt: n.alt, pos: n.pos || POS[0], hidden: false });
    L.forEach(y => { if (y.builtin) y.hidden = false; }); return { msg: "The original pictures are back in the slideshow." };
  }
  must(x, "Picture not found.");
  if (d.op === "update") { x.alt = str(d.alt, 140) || x.alt; if (d.pos && (POS.includes(d.pos) || /^\d{1,3}% \d{1,3}%$/.test(d.pos))) x.pos = d.pos; if (d.hidden !== undefined) x.hidden = !!d.hidden; return { msg: "Picture updated." }; }
  if (d.op === "move") { const i = L.indexOf(x), j = i + (d.dir < 0 ? -1 : 1); if (j >= 0 && j < L.length) [L[i], L[j]] = [L[j], L[i]]; return {}; }
  if (d.op === "delete") { if (!x.builtin) { dropFile({ id: x.big }); if (x.small) dropFile({ id: x.small }); } db.scenery = L.filter(y => y !== x); return { msg: "Picture removed from the slideshow." }; }
  throw new Fail("Unknown operation.");
};
A["admin.msg"] = async ({ id: mid, op }, u) => {
  needPerm(u, "messages");
  if (op === "read") { const m = db.messages.find(x => x.id === mid); if (m) m.read = true; return {}; }
  if (op === "delete") { db.messages = db.messages.filter(x => x.id !== mid); return {}; }
  throw new Fail("Unknown operation.");
};

/* ======================= HTTP ======================= */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".png": "image/png", ".webp": "image/webp", ".woff": "font/woff", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json" };
const baseHeaders = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", "X-Frame-Options": "SAMEORIGIN" };

function cookies(req) { return Object.fromEntries((req.headers.cookie || "").split(";").map(c => c.trim().split("=")).filter(p => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join("="))])); }
/* separate panels: with ADMIN_HOST (e.g. admin.mamandmam.bd) set, admin and staff work only there; with AGENT_HOST
   (agent.mamandmam.bd) agents work only there. The public domain is for job seekers and employers, and an agent who
   signs in there is handed over to the agent panel. localhost and IP addresses are not split. */
const ADMIN_HOST = (process.env.ADMIN_HOST || "").trim().toLowerCase();
const AGENT_HOST = (process.env.AGENT_HOST || "").trim().toLowerCase();
const reqHost = req => String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim().replace(/:\d+$/, "").toLowerCase();
function hostZone(req) {
  if (!ADMIN_HOST && !AGENT_HOST) return "any";
  const h = reqHost(req);
  if (ADMIN_HOST && h === ADMIN_HOST) return "admin";
  if (AGENT_HOST && h === AGENT_HOST) return "agent";
  if (!h || h === "localhost" || /^[\d.]+$/.test(h) || h.startsWith("[")) return "any";
  return "main";
}
const isStaffRole = x => x && (x.role === "admin" || x.role === "staff");
const zoneAllows = (zone, x) => zone === "any" ? true
  : zone === "admin" ? isStaffRole(x)
  : zone === "agent" ? x?.role === "agent"
  : !(ADMIN_HOST && isStaffRole(x)) && !(AGENT_HOST && x?.role === "agent");
const mainUrl = () => `https://${(process.env.CANONICAL_HOST || "").trim().toLowerCase() || (ADMIN_HOST || AGENT_HOST).replace(/^(admin|agent)\./, "")}`;
// on the public site an admin/staff account looks like a wrong password: the admin panel's address is not shown there
const zoneMsg = zone => zone === "admin" ? `This is the agency's admin panel. Job seekers, employers and agents sign in at ${mainUrl()}`
  : zone === "agent" ? `This is the agent panel. Job seekers and employers sign in at ${mainUrl()}`
  : "Email or password is wrong.";
/* agent signing in on the public site: a one-time pass (2 minutes) that the agent panel exchanges for its own session */
const handoffs = new Map();
function agentHandoff(x, req) {
  const t = crypto.randomBytes(24).toString("hex"); handoffs.set(t, { uid: x.id, exp: Date.now() + 120e3 });
  for (const [k, v] of handoffs) if (v.exp < Date.now()) handoffs.delete(k);
  const port = String(req.headers.host || "").match(/:\d+$/)?.[0] || "";
  return `${secure(req) ? "https" : "http"}://${AGENT_HOST}${secure(req) ? "" : port}/#handoff-${t}`;
}
function sessionUser(req) {
  const t = cookies(req).mam_s; const s = t && db.sessions[t];
  if (!s || Date.parse(s.exp) < Date.now()) return { token: null, u: null };
  const u = user(s.uid); if (!u || u.status === "suspended" || u.status === "unverified") return { token: null, u: null };
  return { token: t, u };
}
function send(res, code, body, headers = {}) {
  const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, { ...baseHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }); res.end(data);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > MAX_BODY) { reject(new Fail("Upload is too large (25 MB max per request).", 413)); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8"))); req.on("error", reject);
  });
}
/* behind nginx/Caddy the proxy appends the real client address as the LAST entry; earlier entries can be faked */
const clientIp = req => (req.headers["x-forwarded-for"] || "").split(",").pop().trim() || req.socket.remoteAddress || "";
const secure = req => req.headers["x-forwarded-proto"] === "https";

async function handleApi(req, res, url) {
  const zone = hostZone(req);
  let { token, u } = sessionUser(req);
  if (u && isStaffRole(u)) { seen.set(u.id, Date.now()); attTouch(u, clientIp(req)); } // online / offline in the team chat; office attendance
  if (u && !zoneAllows(zone, u)) { token = null; u = null; } // a session from the other site does not count here
  if (req.method === "GET" && url.pathname === "/api/state") return send(res, 200, { ...viewFor(u), rev: REV });
  if (req.method === "GET" && url.pathname === "/api/rev") return send(res, 200, { rev: REV, me: u?.id || null });
  const stm = req.method === "GET" && /^\/api\/statement\/([a-f0-9]{24})$/.exec(url.pathname);
  if (stm) { const x = db.statements.list.find(y => y.token === stm[1]); return x ? send(res, 200, { statement: stmtOut(x, true) }) : send(res, 404, { error: "Statement not found." }); }
  const sm = req.method === "GET" && /^\/api\/salary\/([a-f0-9]{24})(\/r?sig)?$/.exec(url.pathname);
  if (sm) { // salary receipt opened from its QR code
    const p = db.salary.pays.find(x => x.token === sm[1]); if (!p) return send(res, 404, { error: "Receipt not found." });
    if (!sm[2]) return send(res, 200, { pay: salaryOut(p, true) });
    const f = db.files[sm[2] === "/rsig" ? p.recv?.sig : p.by?.sig]; if (!f) return send(res, 404, { error: "File not found." });
    res.writeHead(200, { ...baseHeaders, "Content-Type": f.mime, "Content-Length": f.size, "Cache-Control": "private, max-age=3600", "Content-Security-Policy": "default-src 'none'; sandbox" });
    return fs.createReadStream(path.join(DATA_DIR, "files", f.id)).pipe(res);
  }
  const rm = req.method === "GET" && /^\/api\/receipt\/([a-f0-9]{24})(?:\/sig\/([ra]))?$/.exec(url.pathname);
  if (rm) { // money receipt opened from its QR code: anyone with the link may see it
    const r = db.mr.receipts.find(x => x.token === rm[1] && x.status === "approved");
    if (!r) return send(res, 404, { error: "Receipt not found." });
    if (!rm[2]) return send(res, 200, { receipt: mrOut(r, true) });
    const f = db.files[(rm[2] === "r" ? r.received : r.approved)?.sig]; if (!f) return send(res, 404, { error: "File not found." });
    res.writeHead(200, { ...baseHeaders, "Content-Type": f.mime, "Content-Length": f.size, "Cache-Control": "private, max-age=3600", "Content-Security-Policy": "default-src 'none'; sandbox" });
    return fs.createReadStream(path.join(DATA_DIR, "files", f.id)).pipe(res);
  }
  if (req.method === "GET" && url.pathname.startsWith("/api/files/")) {
    const f = db.files[url.pathname.slice(11)];
    if (!f || !(f.chat ? mayReadChatFile(u, f, url.searchParams.get("k")) : mayRead(u, f))) return send(res, 404, { error: "File not found." });
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || ""); // voice messages: Safari plays audio only with byte ranges
    if (range && f.mime.startsWith("audio/")) {
      const start = range[1] ? Number(range[1]) : Math.max(0, f.size - Number(range[2])), end = range[1] && range[2] ? Math.min(Number(range[2]), f.size - 1) : f.size - 1;
      if (start > end || start >= f.size) { res.writeHead(416, { "Content-Range": `bytes */${f.size}` }); return res.end(); }
      res.writeHead(206, { ...baseHeaders, "Content-Type": f.mime, "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${f.size}`, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=300" });
      return fs.createReadStream(path.join(DATA_DIR, "files", f.id), { start, end }).pipe(res);
    }
    const inline = f.mime.startsWith("image/") || f.mime.startsWith("audio/") || url.searchParams.get("inline") === "1";
    res.writeHead(200, { ...baseHeaders, "Content-Type": f.mime, "Content-Length": f.size, "Cache-Control": f.public ? "public, max-age=86400" : "private, max-age=300",
      "Accept-Ranges": f.mime.startsWith("audio/") ? "bytes" : "none", "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${f.name.replace(/"/g, "")}"`, "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" });
    return fs.createReadStream(path.join(DATA_DIR, "files", f.id)).pipe(res);
  }
  if (req.method === "POST" && url.pathname === "/api/act") {
    const origin = req.headers.origin; if (origin && new URL(origin).host !== req.headers.host) return send(res, 403, { error: "Cross-site request refused." });
    if (!(req.headers["content-type"] || "").includes("application/json")) return send(res, 415, { error: "JSON expected." });
    let body; try { body = JSON.parse(await readBody(req)); } catch (e) { return send(res, e.code || 400, { error: e.code ? e.message : "Bad request." }); }
    const fn = A[body?.type]; if (!fn) return send(res, 404, { error: "Unknown action." });
    const setCookie = [];
    const ctx = {
      ip: clientIp(req), token, zone,
      login: x => {
        if (zone === "main" && AGENT_HOST && x.role === "agent") { ctx.redirect = agentHandoff(x, req); return; } // sign in on the agent panel instead
        must(zoneAllows(zone, x), zoneMsg(zone), 403); const t = crypto.randomBytes(32).toString("hex"); db.sessions[t] = { uid: x.id, exp: new Date(Date.now() + SESSION_DAYS * 864e5).toISOString() }; if (token) delete db.sessions[token]; ctx.token = t; ctx.user = x;
        if (isStaffRole(x)) for (const [k, v] of Object.entries(db.sessions)) if (v.uid === x.id && k !== t) delete db.sessions[k]; // admin and staff: one sign-in at a time
        setCookie.push(`mam_s=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure(req) ? "; Secure" : ""}`); },
      logout: () => { if (token) delete db.sessions[token]; ctx.user = null; setCookie.push(`mam_s=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure(req) ? "; Secure" : ""}`); },
      user: u
    };
    try {
      const out = (await fn(body.payload || {}, u, ctx)) || {};
      for (const [t, s] of Object.entries(db.sessions)) if (Date.parse(s.exp) < Date.now()) delete db.sessions[t];
      save();
      if (ctx.redirect) out.redirect = ctx.redirect;
      return send(res, out.error ? 400 : 200, { ...out, state: { ...viewFor(ctx.user), rev: REV } }, setCookie.length ? { "Set-Cookie": setCookie } : {});
    } catch (e) {
      if (!(e instanceof Fail)) { console.error(body.type, e); try { save(); } catch { /* ignore */ } }
      return send(res, e.code || 500, { error: e instanceof Fail ? e.message : "Something went wrong. Please try again.", state: { ...viewFor(ctx.user), rev: REV } }, setCookie.length ? { "Set-Cookie": setCookie } : {});
    }
  }
  if (url.pathname.startsWith("/api/chat")) return chatApi(req, res, url, u, zone);
  if (url.pathname.startsWith("/api/team")) return teamApi(req, res, url, u);
  if (url.pathname === "/api/health") return send(res, 200, { ok: true });
  return send(res, 404, { error: "Not found." });
}

/* /job/<id>: the address people share. Crawlers (Facebook, WhatsApp) read the Open Graph tags; browsers open the job in the app. */
const escHtml = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const siteOrigin = req => `${req.headers["x-forwarded-proto"] || "http"}://${req.headers["x-forwarded-host"] || req.headers.host}`;
/* index.html with absolute addresses in the share tags (Facebook and WhatsApp need full URLs for the logo preview) */
/* aipraktor widget + a "Chat to Ai Assistant" caption. The page inside their frame is white, so the frame is clipped to what
   they draw: closed, the round button; open (desktop popup), their card (16px in, 86px above the bottom) plus the button.
   On phones their window covers the whole screen and is left as it is. The caption is our own element (their button lives in
   their iframe) and hides while their chat window is open. */
const AI_WIDGET = `<style>body.ai-open .floaters,body.ai-open .ai-cap{visibility:hidden}.floaters{bottom:104px}.ai-cap{position:fixed;right:86px;bottom:31px;z-index:2147483646;background:#fff;color:#0b3b2c;border:1px solid #d6e3dd;border-radius:999px;padding:5px 12px;font:600 13px Inter,system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.16);pointer-events:none;white-space:nowrap;transition:opacity .2s}.ai-cap.hide{opacity:0;visibility:hidden}</style>
<script src="https://www.aipraktor.com/embed.js" data-site="site_83b1a0b1018eadaa" async></script>
<script>(function(){
var cap,forced=null,root=document.documentElement;
function vv(){var v=window.visualViewport;return v?{w:v.width,h:v.height,t:v.offsetTop,l:v.offsetLeft}:{w:innerWidth,h:innerHeight,t:0,l:0}}
function setFull(f){var v=vv();var put=function(k,x){if(f.style.getPropertyValue(k)!==x)f.style.setProperty(k,x,"important")};
put("left",v.l+"px");put("top",v.t+"px");put("right","auto");put("bottom","auto");put("width",v.w+"px");put("height",v.h+"px");put("max-width","none");put("max-height","none");put("border-radius","0");f.style.removeProperty("clip-path");
if(root.style.overflow!=="hidden"){root.dataset.aiOv=root.style.overflow||"";root.style.overflow="hidden"}}
function unFull(f){var w=f.style.getPropertyValue("width"),h=f.style.getPropertyValue("height");f.style.cssText=forced;if(w)f.style.setProperty("width",w,"important");if(h)f.style.setProperty("height",h,"important");forced=null;root.style.overflow=root.dataset.aiOv||"";delete root.dataset.aiOv}
/* phones: an open chat fills the whole screen (and follows the on-screen keyboard); computers: the card is clipped to its own shape */
setInterval(function(){var f=document.getElementById("aipraktor-chat");if(!f){if(cap)cap.classList.add("hide");return}
if(!cap){cap=document.createElement("div");cap.className="ai-cap hide";cap.textContent="Chat to Ai Assistant";document.body.appendChild(cap)}
var phone=innerWidth<=640,r=f.getBoundingClientRect(),w=f.offsetWidth,h=f.offsetHeight;
var small=r.width<=120&&r.height<=120&&r.width>0;
if(forced!==null&&(small||!phone||!r.width)){unFull(f);r=f.getBoundingClientRect();w=f.offsetWidth;h=f.offsetHeight;small=r.width<=120&&r.height<=120&&r.width>0}
if(phone&&!small&&r.width>0){if(forced===null)forced=f.style.cssText;setFull(f);cap.classList.add("hide");document.body.classList.add("ai-open");return}
document.body.classList.remove("ai-open");cap.classList.toggle("hide",!small);
var full=w>=innerWidth-4&&h>=innerHeight-4,clip="";if(small)clip="circle(29px at 50% 50%)";else if(!full&&w>150&&h>200){var x0=16,y0=16,x1=w-17,y1=h-86,q=14,cx=w-45,cy=h-44,R=29;clip="path('M"+(x0+q)+","+y0+" H"+(x1-q)+" A"+q+","+q+" 0 0 1 "+x1+","+(y0+q)+" V"+(y1-q)+" A"+q+","+q+" 0 0 1 "+(x1-q)+","+y1+" H"+(x0+q)+" A"+q+","+q+" 0 0 1 "+x0+","+(y1-q)+" V"+(y0+q)+" A"+q+","+q+" 0 0 1 "+(x0+q)+","+y0+" Z M"+(cx-R)+","+cy+" A"+R+","+R+" 0 1 0 "+(cx+R)+","+cy+" A"+R+","+R+" 0 1 0 "+(cx-R)+","+cy+" Z')"}
if(clip){if(f.style.getPropertyValue("clip-path")!==clip)f.style.setProperty("clip-path",clip,"important")}else f.style.removeProperty("clip-path");
if(small){cap.style.bottom=Math.max(8,innerHeight-r.bottom+r.height/2-14)+"px";cap.style.right=Math.max(8,innerWidth-r.left-6)+"px"}},200);
})();</script>`;
function indexHtml(req) {
  const zone = hostZone(req);
  const site = { admin: zone === "admin", agent: zone === "agent", main: ADMIN_HOST || AGENT_HOST ? mainUrl() : "" }; // the admin panel's address is never sent to the public site
  const head = `<script>window.__SITE__=${JSON.stringify(site).replace(/</g, "\\u003c")}</script>${zone === "admin" || zone === "agent" ? '<meta name="robots" content="noindex, nofollow">' : ""}`;
  // the aipraktor chat widget is registered for the public site only (it refuses other addresses)
  // its button sits in the bottom corner, so our WhatsApp / chat / "i" buttons move up above it
  const body = zone === "main" ? AI_WIDGET : "";
  return fs.readFileSync(path.join(STATIC_DIR, "index.html"), "utf8").replace(/__ORIGIN__/g, escHtml(siteOrigin(req))).replace("</head>", head + "</head>").replace("</body>", body + "</body>");
}
function serveJobShare(req, res, jid) {
  const idx = path.join(STATIC_DIR, "index.html"); if (!fs.existsSync(idx)) return send(res, 503, "Site files are missing.", { "Content-Type": "text/plain" });
  let html = indexHtml(req); const j = job(jid);
  if (j && j.status === "active") {
    const origin = siteOrigin(req);
    const company = user(j.employerId)?.company?.name || j.employerName;
    const title = `${j.title} – ${j.city}, ${j.country} | Mam & Mam Overseas Ltd.`;
    const desc = `${j.currency} ${Number(j.salaryMin).toLocaleString("en-US")}–${Number(j.salaryMax).toLocaleString("en-US")}/${j.period === "hour" ? "hour" : "month"} · ${j.vacancies} vacancies${company ? ` · ${company}` : ""}${j.deadline ? ` · Apply by ${j.deadline}` : ""}. Licensed recruiting agency RL 1217.`;
    const tags = [`<title>${escHtml(title)}</title>`, `<meta name="description" content="${escHtml(desc)}">`, `<meta property="og:type" content="website">`, `<meta property="og:site_name" content="Mam &amp; Mam Overseas Ltd.">`,
      `<meta property="og:title" content="${escHtml(title)}">`, `<meta property="og:description" content="${escHtml(desc)}">`, `<meta property="og:url" content="${escHtml(`${origin}/job/${j.id}`)}">`,
      ...(j.card ? [`<meta property="og:image" content="${escHtml(`${origin}/api/files/${j.card.id}`)}">`, `<meta property="og:image:type" content="image/png">`, `<meta property="og:image:width" content="1080">`, `<meta property="og:image:height" content="1350">`, `<meta name="twitter:card" content="summary_large_image">`]
        : [`<meta property="og:image" content="${escHtml(`${origin}/brand/og-image.png?v=2`)}">`, `<meta property="og:image:width" content="1200">`, `<meta property="og:image:height" content="630">`, `<meta name="twitter:card" content="summary_large_image">`])].join("\n");
    html = html.replace(/<title>.*?<\/title>\s*<meta name="description"[^>]*>/s, tags).replace(/<!--og-->[\s\S]*?<!--\/og-->/, "");
  }
  res.writeHead(200, { ...baseHeaders, "Content-Type": MIME[".html"], "Cache-Control": "no-cache" }); res.end(html);
}

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname); if (p === "/") p = "/index.html";
  const file = path.normalize(path.join(STATIC_DIR, p));
  if (!file.startsWith(STATIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    const idx = path.join(STATIC_DIR, "index.html"); // single-page app
    if (!fs.existsSync(idx)) return send(res, 503, "Site files are missing. Run the build.", { "Content-Type": "text/plain" });
    return send(res, 200, indexHtml(req), { "Content-Type": MIME[".html"], "Cache-Control": "no-cache" });
  }
  if (p === "/index.html") return send(res, 200, indexHtml(req), { "Content-Type": MIME[".html"], "Cache-Control": "no-cache" });
  const ext = path.extname(file);
  res.writeHead(200, { ...baseHeaders, "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600" });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "Method not allowed." });
    /* main domain: visitors on any other name (old domain, www.) are sent there with the same path */
    const canon = (process.env.CANONICAL_HOST || "").trim().toLowerCase();
    if (canon) {
      const h = reqHost(req);
      if (h && h !== canon && h !== ADMIN_HOST && h !== AGENT_HOST && h !== "localhost" && !/^[\d.]+$/.test(h) && !h.startsWith("[")) { res.writeHead(301, { Location: `https://${canon}${req.url}`, "Cache-Control": "max-age=3600" }); return res.end(); }
    }
    const m = url.pathname.match(/^\/job\/([a-z0-9]+)\/?$/i); if (m) return serveJobShare(req, res, m[1]);
    return serveStatic(req, res, url);
  } catch (e) { console.error(e); if (!res.headersSent) send(res, 500, { error: "Server error." }); }
});
server.listen(PORT, HOST, () => console.log(`MAM & MAM portal running on http://${HOST}:${PORT} (data: ${DATA_DIR})`));
export { server };


/* ======================= live chat (job seekers, employers, agents and visitors ↔ the agency) =======================
   db.chats: one conversation per account (uid) or per visitor (name + mobile, identified by a secret key kept in the
   visitor's browser). Messages: text, photo or voice; a reply can quote another message; deleted messages keep a stub.
   The agency answers as "Mam & Mam Overseas Ltd."; which staff member wrote is visible only in the admin panel. */
if (!Array.isArray(db.chats)) db.chats = [];
const CHAT_MAX = 2000;
const chatOf = (u, k) => (u && !isStaffRole(u) ? db.chats.find(c => c.uid === u.id) : null) || (k ? db.chats.find(c => c.key && c.key === String(k)) : null);
function mayReadChatFile(u, f, k) {
  const c = db.chats.find(x => x.id === f.chat); if (!c) return false;
  if (u && (u.role === "admin" || (u.role === "staff" && can(u, "chat")))) return true;
  return (u && c.uid === u.id) || (!!k && c.key === k);
}
function chatWho(c) {
  if (c.uid) { const x = user(c.uid); const role = { candidate: "Job seeker", employer: "Employer", agent: "Agent" }[x?.role] || "Account";
    return { name: x ? (x.role === "agent" ? x.agent?.business || x.name : x.role === "employer" ? x.company?.name || x.name : x.name) : "Removed account", sub: `${role}${x ? ` · ${x.role === "candidate" ? x.profile?.phone || x.email : x.email}` : ""}`, role: x?.role || "", contact: x?.name || "" }; }
  return { name: c.guest?.name || "Visitor", sub: `Visitor · ${c.guest?.phone || ""}`, role: "guest", contact: "" };
}
function msgView(c, m, staff, k) {
  const q = k ? `?k=${encodeURIComponent(k)}` : "";
  const base = { id: m.id, from: m.from, at: m.at, deleted: !!m.deleted, kind: m.kind };
  if (m.deleted) return base;
  const r = m.replyTo ? c.msgs.find(x => x.id === m.replyTo) : null;
  return { ...base, text: m.text || "", file: m.file ? { url: `/api/files/${m.file.id}${q}`, name: m.file.name } : null, by: staff && m.from === "agency" ? m.byName || "" : undefined,
    ...(m.from === "agency" && m.by ? (() => { const x = user(m.by); return { staffName: x?.name || m.byName || "", staffRole: x?.role || "" }; })() : {}), // who in the office wrote it (name + badge)
    reply: r ? { id: r.id, from: r.from, kind: r.kind, text: r.deleted ? "" : (r.text || "").slice(0, 120), deleted: !!r.deleted } : null };
}
const chatThread = (c, staff, k) => ({ id: c.id, ...(staff ? chatWho(c) : {}), msgs: c.msgs.map(m => msgView(c, m, staff, k)), unread: staff ? c.unreadAgency : c.unreadUser, joined: true, guest: c.guest ? { name: c.guest.name } : null });
const chatSummary = c => { const l = [...c.msgs].reverse().find(m => !m.deleted); return { id: c.id, ...chatWho(c), last: l ? { from: l.from, text: l.kind === "image" ? "📷 Photo" : l.kind === "voice" ? "🎤 Voice message" : (l.text || "").slice(0, 80), at: l.at } : null, at: c.last, unread: c.unreadAgency }; };
const staffChat = u => u && (u.role === "admin" || (u.role === "staff" && u.status === "active" && u.perms?.includes("chat")));

async function chatApi(req, res, url, u, zone) {
  const staff = staffChat(u) && (zone === "admin" || zone === "any");
  const ip = clientIp(req);
  if (req.method === "GET") {
    if (url.pathname === "/api/chat/inbox") {
      if (!staff) return send(res, 403, { error: "Not allowed." });
      const L = [...db.chats].sort((a, b) => String(b.last).localeCompare(String(a.last))).map(chatSummary);
      return send(res, 200, { chats: L, unread: db.chats.filter(c => c.unreadAgency > 0).length });
    }
    if (url.pathname === "/api/chat/thread") {
      if (!staff) return send(res, 403, { error: "Not allowed." });
      const c = db.chats.find(x => x.id === url.searchParams.get("id")); if (!c) return send(res, 404, { error: "Chat not found." });
      if (c.unreadAgency) { c.unreadAgency = 0; save(); }
      return send(res, 200, { chat: chatThread(c, true) });
    }
    if (url.pathname === "/api/chat") {
      const k = url.searchParams.get("k") || ""; const c = chatOf(u, k);
      if (url.searchParams.get("seen") === "1" && c?.unreadUser) { c.unreadUser = 0; save(); }
      return send(res, 200, { chat: c ? chatThread(c, false, c.uid ? "" : k) : null, account: !!(u && !isStaffRole(u)) });
    }
    return send(res, 404, { error: "Not found." });
  }
  if (req.method !== "POST" || url.pathname !== "/api/chat") return send(res, 405, { error: "Method not allowed." });
  const origin = req.headers.origin; if (origin && new URL(origin).host !== req.headers.host) return send(res, 403, { error: "Cross-site request refused." });
  let d; try { d = JSON.parse(await readBody(req)); } catch (e) { return send(res, e.code || 400, { error: e.code ? e.message : "Bad request." }); }
  try {
    const op = d.op;
    if (op === "join") { // a visitor without an account: name and mobile number
      limit(ip, "chatjoin", 8, 3600e3);
      if (u && !isStaffRole(u)) { const c = chatOf(u) || newChat({ uid: u.id }); save(); return send(res, 200, { chat: chatThread(c, false) }); }
      const name = str(d.name, 80), phone = str(d.phone, 30);
      must(name.length >= 2, "Enter your name."); must(phone.replace(/\D/g, "").length >= 10, "Enter a valid mobile number, e.g. 01XXXXXXXXX.");
      const c = newChat({ guest: { name, phone }, key: crypto.randomBytes(24).toString("hex") });
      save(); return send(res, 200, { key: c.key, chat: chatThread(c, false, c.key) });
    }
    if (op === "send") {
      limit(ip, "chatsend", 60, 60e3);
      let c, from, k = "";
      if (staff && d.chatId) { c = db.chats.find(x => x.id === d.chatId); must(c, "Chat not found."); from = "agency"; }
      else { k = str(d.k, 80); c = chatOf(u, k); if (!c && u && !isStaffRole(u)) c = newChat({ uid: u.id }); must(c, "Join the chat first."); from = "user"; if (c.uid) k = ""; }
      const text = String(d.text ?? "").slice(0, CHAT_MAX).trim();
      let file = null, kind = "text";
      if (d.file) {
        kind = d.kind === "voice" ? "voice" : "image";
        file = storeFile(d.file, u?.id || c.id, kind === "voice" ? { images: false, pdf: false, audio: true, chat: c.id } : { images: true, pdf: false, chat: c.id });
      }
      must(text || file, "Write a message.");
      const replyTo = d.replyTo && c.msgs.some(m => m.id === d.replyTo) ? d.replyTo : null;
      const m = { id: id("cm"), from, kind, text, file, replyTo, at: now(), ...(from === "agency" ? { by: u.id, byName: u.name } : {}) };
      c.msgs.push(m); c.last = m.at;
      if (from === "user") { c.unreadAgency = (c.unreadAgency || 0) + 1; if (c.msgs.filter(x => x.from === "user").length === 1) notifyAdmins(`New live chat from ${chatWho(c).name}.`, "chat"); }
      else { c.unreadUser = (c.unreadUser || 0) + 1; c.unreadAgency = 0; if (c.uid) notify(c.uid, "Mam & Mam Overseas Ltd. replied in the chat."); }
      if (c.msgs.length > 2000) c.msgs.splice(0, c.msgs.length - 2000);
      save(); return send(res, 200, { chat: chatThread(c, from === "agency", k) });
    }
    if (op === "delete") {
      let c, mine, k = "";
      if (staff && d.chatId) { c = db.chats.find(x => x.id === d.chatId); must(c, "Chat not found."); mine = () => true; } // the agency may remove any message
      else { k = str(d.k, 80); c = chatOf(u, k); must(c, "Chat not found."); mine = m => m.from === "user"; if (c.uid) k = ""; }
      const m = c.msgs.find(x => x.id === d.mid); must(m && mine(m), "You can delete only your own messages.");
      if (m.file) dropFile(m.file);
      Object.assign(m, { deleted: true, text: "", file: null }); save();
      return send(res, 200, { chat: chatThread(c, !!(staff && d.chatId), k) });
    }
    if (op === "deleteChat") {
      must(staff, "Not allowed.", 403); const c = db.chats.find(x => x.id === d.chatId); must(c, "Chat not found.");
      c.msgs.forEach(m => m.file && dropFile(m.file)); db.chats = db.chats.filter(x => x !== c); save();
      return send(res, 200, { ok: true, msg: "Chat deleted." });
    }
    return send(res, 400, { error: "Unknown action." });
  } catch (e) {
    if (!(e instanceof Fail)) console.error("chat", e);
    return send(res, e.code || 500, { error: e instanceof Fail ? e.message : "Something went wrong. Please try again." });
  }
}

/* ======================= team chat (admin & staff only) ======================= */
// one-to-one chats and groups between admin and staff IDs; text, photo and voice messages; online = active in the last 70 s
if (!db.tchats) db.tchats = [];
const seen = new Map();
const isOnline = uid => Date.now() - (seen.get(uid) || 0) < 70e3;
const teamMembers = () => db.users.filter(x => isStaffRole(x) && x.status !== "suspended");
function teamPerson(x) {
  const m = x.memberId && db.team.find(t => t.id === x.memberId);
  return { id: x.id, name: x.name, role: x.role, title: m?.title || "", photo: m?.photo?.data || "", online: isOnline(x.id), seen: seen.has(x.id) ? new Date(seen.get(x.id)).toISOString() : x.lastSeen || "" };
}
const tUnread = (c, uid) => c.msgs.filter(m => m.from !== uid && m.at > (c.reads?.[uid] || "")).length;
function tSummary(c, uid) {
  const last = c.msgs[c.msgs.length - 1];
  const other = c.kind === "dm" ? c.members.find(m => m !== uid) : null;
  return { id: c.id, kind: c.kind, name: c.kind === "group" ? c.name : user(other)?.name || "Removed account", other, members: c.members, by: c.by, last: c.last,
    lastText: !last ? "" : last.deleted ? "Message deleted" : last.kind === "image" ? "📷 Photo" : last.kind === "voice" ? "🎤 Voice message" : last.text.slice(0, 80), lastFrom: last?.from || "", unread: tUnread(c, uid) };
}
function tThread(c, uid) {
  const byId = new Map(c.msgs.map(m => [m.id, m]));
  const out = m => ({ id: m.id, from: m.from, name: user(m.from)?.name || "Removed account", kind: m.kind, text: m.deleted ? "" : m.text, deleted: !!m.deleted, at: m.at,
    file: m.deleted || !m.file ? null : { url: `/api/files/${m.file.id}`, name: m.file.name } });
  return { ...tSummary(c, uid), msgs: c.msgs.slice(-400).map(m => ({ ...out(m), reply: m.replyTo && byId.get(m.replyTo) ? out(byId.get(m.replyTo)) : null })),
    reads: Object.fromEntries(c.members.map(m => [m, c.reads?.[m] || ""])) };
}
async function teamApi(req, res, url, u) {
  if (!isStaffRole(u)) return send(res, 403, { error: "Only admin and staff can use the team chat." });
  const mine = c => c.members.includes(u.id);
  if (req.method === "GET") {
    if (url.pathname === "/api/team") {
      const chats = db.tchats.filter(mine).sort((a, b) => String(b.last).localeCompare(String(a.last))).map(c => tSummary(c, u.id));
      return send(res, 200, { me: u.id, members: teamMembers().map(teamPerson), chats, unread: chats.reduce((t, c) => t + c.unread, 0) });
    }
    if (url.pathname === "/api/team/thread") {
      const c = db.tchats.find(x => x.id === url.searchParams.get("id") && mine(x)); if (!c) return send(res, 404, { error: "Chat not found." });
      const last = c.msgs[c.msgs.length - 1]; if (last && (c.reads ||= {})[u.id] !== last.at) { c.reads[u.id] = last.at; save(); }
      return send(res, 200, { chat: tThread(c, u.id) });
    }
    return send(res, 404, { error: "Not found." });
  }
  if (req.method !== "POST" || url.pathname !== "/api/team") return send(res, 405, { error: "Method not allowed." });
  const origin = req.headers.origin; if (origin && new URL(origin).host !== req.headers.host) return send(res, 403, { error: "Cross-site request refused." });
  let d; try { d = JSON.parse(await readBody(req)); } catch (e) { return send(res, e.code || 400, { error: e.code ? e.message : "Bad request." }); }
  try {
    const ok = (c, msg) => { save(); return send(res, 200, { chat: c ? tThread(c, u.id) : null, ...(msg ? { msg } : {}) }); };
    const get = () => { const c = db.tchats.find(x => x.id === d.chatId && mine(x)); must(c, "Chat not found."); return c; };
    const staffIds = arr => [...new Set((Array.isArray(arr) ? arr : []).map(String))].filter(i => isStaffRole(user(i)));
    const boss = c => c.by === u.id || u.role === "admin";
    if (d.op === "dm") {
      const x = user(d.uid); must(isStaffRole(x) && x.id !== u.id, "Choose a team member.");
      let c = db.tchats.find(y => y.kind === "dm" && y.members.includes(u.id) && y.members.includes(x.id));
      if (!c) { c = { id: id("tc"), kind: "dm", members: [u.id, x.id], by: u.id, msgs: [], reads: {}, created: now(), last: now() }; db.tchats.push(c); }
      return ok(c);
    }
    if (d.op === "group") {
      const name = str(d.name, 60); must(name.length >= 2, "Enter a group name.");
      const members = [u.id, ...staffIds(d.members).filter(i => i !== u.id)]; must(members.length >= 2, "Add at least one member.");
      const c = { id: id("tc"), kind: "group", name, members, by: u.id, msgs: [], reads: {}, created: now(), last: now() }; db.tchats.push(c);
      c.msgs.push({ id: id("tm"), from: u.id, kind: "event", text: `${u.name} created the group "${name}".`, at: now() });
      return ok(c, `Group "${name}" created.`);
    }
    if (d.op === "send") {
      const c = get(); limit(u.id, "teamsend", 120, 60e3);
      const text = String(d.text ?? "").slice(0, CHAT_MAX).trim();
      let file = null, kind = "text";
      if (d.file) { kind = d.kind === "voice" ? "voice" : "image"; file = storeFile(d.file, u.id, kind === "voice" ? { images: false, pdf: false, audio: true } : { images: true, pdf: false }); }
      must(text || file, "Write a message.");
      const m = { id: id("tm"), from: u.id, kind, text, file, replyTo: d.replyTo && c.msgs.some(x => x.id === d.replyTo) ? d.replyTo : null, at: now() };
      c.msgs.push(m); c.last = m.at; (c.reads ||= {})[u.id] = m.at;
      if (c.msgs.length > 3000) c.msgs.splice(0, c.msgs.length - 3000);
      return ok(c);
    }
    if (d.op === "delete") {
      const c = get(); const m = c.msgs.find(x => x.id === d.mid); must(m && m.kind !== "event" && (m.from === u.id || u.role === "admin"), "You can delete only your own messages.");
      if (m.file) dropFile(m.file); Object.assign(m, { deleted: true, text: "", file: null }); return ok(c);
    }
    if (d.op === "rename") { const c = get(); must(c.kind === "group" && boss(c), "Only the person who made the group, or the admin, can change it."); const name = str(d.name, 60); must(name.length >= 2, "Enter a group name."); c.name = name; c.msgs.push({ id: id("tm"), from: u.id, kind: "event", text: `${u.name} renamed the group to "${name}".`, at: now() }); return ok(c); }
    if (d.op === "members") {
      const c = get(); must(c.kind === "group" && boss(c), "Only the person who made the group, or the admin, can change it.");
      const next = [...new Set([c.by, ...staffIds(d.members)])].filter(i => user(i)); must(next.length >= 2, "Add at least one member.");
      const added = next.filter(i => !c.members.includes(i)), gone = c.members.filter(i => !next.includes(i)); c.members = next;
      if (added.length) c.msgs.push({ id: id("tm"), from: u.id, kind: "event", text: `${u.name} added ${added.map(i => user(i)?.name).join(", ")}.`, at: now() });
      if (gone.length) c.msgs.push({ id: id("tm"), from: u.id, kind: "event", text: `${u.name} removed ${gone.map(i => user(i)?.name).join(", ")}.`, at: now() });
      return ok(c);
    }
    if (d.op === "leave") {
      const c = get(); must(c.kind === "group", "You can leave only a group.");
      c.members = c.members.filter(i => i !== u.id); c.msgs.push({ id: id("tm"), from: u.id, kind: "event", text: `${u.name} left the group.`, at: now() });
      if (c.by === u.id && c.members.length) c.by = c.members[0];
      if (!c.members.length) { c.msgs.forEach(m => m.file && dropFile(m.file)); db.tchats = db.tchats.filter(x => x !== c); }
      save(); return send(res, 200, { chat: null, msg: "You left the group." });
    }
    if (d.op === "deleteGroup") {
      const c = get(); must(c.kind === "group" && boss(c), "Only the person who made the group, or the admin, can delete it.");
      c.msgs.forEach(m => m.file && dropFile(m.file)); db.tchats = db.tchats.filter(x => x !== c); save(); return send(res, 200, { chat: null, msg: "Group deleted." });
    }
    return send(res, 400, { error: "Unknown action." });
  } catch (e) {
    if (!(e instanceof Fail)) console.error("team", e);
    return send(res, e.code || 500, { error: e instanceof Fail ? e.message : "Something went wrong. Please try again." });
  }
}
function newChat(x) { const c = { id: id("ch"), uid: null, guest: null, key: null, ...x, msgs: [], created: now(), last: now(), unreadAgency: 0, unreadUser: 0 }; db.chats.push(c); return c; }


/* ======================= About page (edited in Admin panel › About page) ======================= */
const ABOUT_DEFAULT = {
  credentials: "Government licensed recruiting agency · RL 1217",
  tagline: "We connect skilled Bangladeshi workers with trusted employers abroad, through a legal, transparent and caring process.",
  stats: [{ value: "", label: "Established", sub: "" }, { value: "", label: "Workers sent abroad", sub: "" }, { value: "RL 1217", label: "Govt. licence", sub: "BMET approved" }, { value: "", label: "Destination countries", sub: "" }],
  overview: "Mam & Mam Overseas Ltd. is a government licensed recruiting agency (RL 1217) that connects job seekers in Bangladesh with employers abroad.\n\nWe handle the full recruitment process: sourcing and screening candidates, arranging interviews, and completing medical, visa and emigration (BMET) formalities, so every worker departs with the right documents and a clear contract.\n\nEvery candidate hears the salary, benefits, contract terms and costs before signing, and all recruitment goes through official channels under our licence.",
  commitment: "Our commitment: honest information, legal processing, and support for every worker before and after departure.",
  leader: { name: "", title: "Managing Director", badge: "Authorized licensee", quote: "", bio: "", photo: null },
  highlights: [{ value: "", label: "Destination countries" }, { value: "100%", label: "Legal processing" }, { value: "RL 1217", label: "Government licence" }],
  mission: { title: "Our mission", text: "To place Bangladeshi workers in safe, well-paid jobs abroad through a recruitment process that is legal, transparent and fair from the first interview to the flight.", points: ["Clear salary and contract information before signing", "All processing through official channels", "Support for workers after departure"], tag: "Trust & transparency" },
  vision: { title: "Our vision", text: "To be the agency employers and workers recommend first, known for skilled candidates, ethical recruitment and long-term relationships.", points: ["Skilled, well-prepared candidates", "Long-term partnerships with employers", "Respect and dignity for every worker"], tag: "Excellence & integrity" },
  docsIntro: "Our licence and company documents. Open any document to check it.",
  docs: [],
  cta: { title: "Ready to work with MAM & MAM Overseas?", text: "Talk to our office about jobs abroad or about hiring workers from Bangladesh." }
};
if (!db.about) db.about = JSON.parse(JSON.stringify(ABOUT_DEFAULT));
const fileView = f => (f ? { name: f.name, mime: db.files[f.id]?.mime || "", url: `/api/files/${f.id}` } : null);
function aboutView() {
  const a = db.about;
  return { ...a, leader: { ...a.leader, photo: fileView(a.leader.photo) }, docs: a.docs.map(d => ({ ...d, file: fileView(d.file) })) };
}
/* ======================= money receipts & payment entry ======================= */
// A payer account is found or created from any of: name, mobile, passport no., email, agent name.
// Each payment gets a numbered money receipt (MR-2026-0001); the payer's details are copied onto the receipt.
if (!db.mr) db.mr = { accounts: [], receipts: [], seq: {} };
if (!db.mr.charges) db.mr.charges = []; // debits on a payer's account (e.g. "1 ITALY (FC) PP", 6000 × 1)
for (const r of db.mr.receipts) { // receipts made before approval existed wait for approval
  if (!r.status) { r.status = "pending"; r.received = { uid: null, name: r.by || "Office", title: "", sig: null }; }
}
// who signs: name, designation (from the Expert Team member, if linked) and the signature file at that moment
const mrSigner = u => { const m = u.memberId && db.team.find(x => x.id === u.memberId); return { uid: u.id, name: u.name || "Office", title: m?.title || u.title || "", sig: u.signature?.id || null, at: now() }; };
// what the browser gets: signature pictures as links (staff: stored files; public page: through the receipt's own link)
const mrOut = (r, pub) => {
  const sig = (s, k) => s ? { name: s.name, title: s.title, at: s.at, sigUrl: s.sig && db.files[s.sig] ? (pub ? `/api/receipt/${r.token}/sig/${k}` : `/api/files/${s.sig}`) : "" } : null;
  const x = { id: r.id, no: r.no, accountId: r.accountId, payer: r.payer, agentId: r.agentId || null, amount: r.amount, method: r.method, channel: r.channel || "", balance: r.balance || null, mailed: r.mailed || null, ref: r.ref, purpose: r.purpose, note: r.note, date: r.date, created: r.created,
    status: r.status, token: r.status === "approved" ? r.token : "", received: sig(r.received, "r"), approved: sig(r.approved, "a"), void: r.void || null };
  if (pub) { delete x.accountId; delete x.id; delete x.mailed; delete x.agentId; if (x.payer) x.payer = { ...x.payer, email: x.payer.email ? x.payer.email.replace(/^(.).*(@.*)$/, "$1***$2") : "" }; }
  return x;
};
const MR_METHODS = ["Cash", "Bank transfer", "Mobile banking", "Cheque", "Card"];
const MR_CHANNEL = ["Bank transfer", "Mobile banking", "Cheque"]; // these name a bank or a mobile banking service
const agentDue = aid => db.ledger.filter(l => l.agentId === aid && l.status === "confirmed").reduce((s, l) => s + (l.type === "charge" ? 1 : -1) * Number(l.amount), 0);
const agentName = a => a?.agent?.business || a?.name || "";
const r2 = n => Math.round(n * 100) / 100;
const mrPayable = acc => r2((acc?.price || 0) + db.mr.charges.filter(c => c.accountId === acc?.id).reduce((s, c) => s + c.amount, 0));
const mrNorm = { mobile: v => String(v || "").replace(/[^\d+]/g, ""), passport: v => String(v || "").replace(/\s+/g, "").toUpperCase(), email: v => String(v || "").trim().toLowerCase() };
const mrPayer = p => {
  const x = { name: str(p?.name, 120), mobile: mrNorm.mobile(p?.mobile).slice(0, 20), passport: mrNorm.passport(p?.passport).slice(0, 20), email: mrNorm.email(p?.email).slice(0, 120), agent: str(p?.agent, 120) };
  if (x.email) must(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.email), "Check the email address.");
  return x;
};
const mrFind = x => ["passport", "mobile", "email"].map(k => x[k] && db.mr.accounts.find(a => a[k] === x[k])).find(Boolean);
const mrTotal = accId => db.mr.receipts.filter(r => r.accountId === accId && !r.void).reduce((s, r) => s + r.amount, 0);
A["admin.mr"] = async (d, u) => {
  needPerm(u, "receipts"); const M = db.mr;
  if (d.op === "entry") {
    const x = mrPayer(d.payer);
    must(Object.values(x).some(Boolean), "Enter at least one of: name, mobile, passport no., email or agent name.");
    // one payment, or several at once (d.lines): each line becomes its own money receipt
    const lines = (Array.isArray(d.lines) && d.lines.length ? d.lines.slice(0, 20) : [d]).map((L, i, all) => {
      const at = all.length > 1 ? ` (payment ${i + 1})` : "";
      const amount = Math.round(Number(L.amount) * 100) / 100; must(amount > 0 && amount < 1e9, `Enter the amount received${at}.`);
      const method = MR_METHODS.includes(L.method) ? L.method : "Cash";
      const channel = MR_CHANNEL.includes(method) ? str(L.channel, 80) : "";
      must(channel || method === "Cheque" || !MR_CHANNEL.includes(method), (method === "Mobile banking" ? "Choose the mobile banking service" : "Choose the bank") + `${at}.`);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(L.date || "") ? L.date : new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10); // Bangladesh date
      return { amount, method, channel, date, ref: str(L.ref, 80), purpose: str(L.purpose ?? d.purpose, 160) };
    });
    const ag = d.agentId ? user(d.agentId) : null; must(!d.agentId || ag?.role === "agent", "Agent not found.");
    if (ag) x.agent = agentName(ag);
    const price = d.price === "" || d.price == null ? null : r2(Number(d.price)); must(price === null || (price >= 0 && price < 1e9), "Check the price.");
    let acc = d.accountId ? M.accounts.find(a => a.id === d.accountId) : mrFind(x);
    if (d.accountId) must(acc, "Account not found.");
    if (acc) { for (const k in x) if (x[k]) acc[k] = x[k]; acc.updated = now(); }
    else { acc = { id: id("ma"), ...x, created: now(), updated: now() }; M.accounts.unshift(acc); }
    if ("agentId" in d) acc.agentId = ag ? ag.id : null;
    if (!acc.agentId && price !== null) acc.price = price; // the total this payer has to pay (not for agents: they have their agent account)
    const made = lines.map(L => {
      const yr = L.date.slice(0, 4); M.seq[yr] = (M.seq[yr] || 0) + 1;
      const r = { id: id("mr"), no: `MR-${yr}-${String(M.seq[yr]).padStart(4, "0")}`, accountId: acc.id, payer: { name: acc.name, mobile: acc.mobile, passport: acc.passport, email: acc.email, agent: acc.agent },
        agentId: acc.agentId || null, ...L, note: str(d.note, 400), status: "pending", received: mrSigner(u), created: now() };
      M.receipts.unshift(r); return r;
    });
    const total = made.reduce((t, r) => t + r.amount, 0), nos = made.map(r => r.no).join(", ");
    notifyAdmins(made.length > 1 ? `${made.length} payments (${nos}, BDT ${total.toLocaleString("en-US")}) are waiting for approval.` : `Payment ${nos} (BDT ${total.toLocaleString("en-US")}) is waiting for approval.`, "receipts");
    return { msg: made.length > 1 ? `${made.length} payments saved (${nos}). They wait for approval by an admin or another staff member.` : `Payment ${nos} saved. It waits for approval by an admin or another staff member.`,
      receiptId: made[0].id, receiptIds: made.map(r => r.id), accountId: acc.id };
  }
  if (d.op === "approve") { // a second person signs as Authorized signature; then the receipt and its QR code exist
    const r = M.receipts.find(x => x.id === d.id); must(r, "Receipt not found."); must(r.status === "pending" && !r.void, "This payment is not waiting for approval.");
    must(u.role === "admin" || r.received?.uid !== u.id, "Another admin or staff member must approve a payment you entered.");
    must(u.signature?.id && db.files[u.signature.id], "Upload your signature first (Money receipts › My signature).");
    r.approved = mrSigner(u); r.status = "approved"; r.token = crypto.randomBytes(12).toString("hex");
    // balance at approval: an agent's account (due / advance), or the payer's set price (due)
    const ag = r.agentId && user(r.agentId), acc = M.accounts.find(a => a.id === r.accountId);
    if (ag) {
      const before = agentDue(ag.id); const l = { id: id("l"), agentId: ag.id, type: "payment", desc: `Money receipt ${r.no}${r.payer.name ? ": " + r.payer.name : ""}`, amount: r.amount, date: r.date, method: [r.method, r.channel].filter(Boolean).join(" · "), ref: r.ref, status: "confirmed", mr: r.id };
      db.ledger.push(l); r.ledgerId = l.id; r.balance = { kind: "agent", agent: agentName(ag), before: r2(before), paid: r.amount, after: r2(before - r.amount) };
      notify(ag.id, `Payment received: BDT ${r.amount.toLocaleString("en-US")} (money receipt ${r.no}).`);
    } else if (mrPayable(acc) > 0) {
      const before = r2(M.receipts.filter(x => x !== r && x.accountId === acc.id && x.status === "approved" && !x.void).reduce((s, x) => s + x.amount, 0)), pay = mrPayable(acc);
      r.balance = { kind: "price", price: pay, before, paid: r.amount, after: r2(pay - before - r.amount) };
    }
    return { msg: `Approved. Money receipt ${r.no} is ready to download.`, email: r.payer.email || "" };
  }
  if (d.op === "mail") { // the approver's browser makes the PDF; the server emails it to the payer
    const r = M.receipts.find(x => x.id === d.id); must(r && r.status === "approved", "Receipt not found.");
    const to = d.to ? mrNorm.email(d.to) : r.payer.email; must(to && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to), "This payer has no email address.");
    const pdf = Buffer.from(String(d.pdf || "").replace(/^data:application\/pdf;base64,/, ""), "base64");
    must(pdf.length > 100 && pdf.length < 4e6 && pdf.subarray(0, 5).toString() === "%PDF-", "The receipt PDF is missing.");
    const m = await getMailer();
    const fail = msg => { r.mailed = { to, at: now(), ok: false }; return { msg }; };
    if (!m) return fail("Email is not set up on this server, so the receipt was not emailed. Download it and send it yourself.");
    const link = ADMIN_HOST || AGENT_HOST || process.env.CANONICAL_HOST ? `${mainUrl()}/r/${r.token}` : "";
    const b = r.balance, money = n => `BDT ${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
    const bal = !b ? "" : b.kind === "agent" ? (b.after > 0 ? `Due on your agent account: ${money(b.after)}\n` : b.after < 0 ? `Advance on your agent account: ${money(-b.after)}\n` : "Your agent account is fully paid.\n")
      : b.after > 0 ? `Remaining due: ${money(b.after)} (total ${money(b.price)})\n` : b.after < 0 ? `Advance: ${money(-b.after)}\n` : "Fully paid.\n";
    try {
      await m.sendMail({ from: `"Mam & Mam Overseas Ltd." <${mailFrom()}>`, to, subject: `Money receipt ${r.no} · Mam & Mam Overseas Ltd.`,
        text: `Assalamu Alaikum${r.payer.name ? " " + r.payer.name : ""},\n\nThank you for your payment. Your money receipt is attached.\n\nReceipt No.: ${r.no}\nDate: ${r.date}\nAmount: ${money(r.amount)}\nPayment: ${[r.method, r.channel].filter(Boolean).join(" · ")}${r.ref ? " · " + r.ref : ""}\n${r.purpose ? `Purpose: ${r.purpose}\n` : ""}${bal}${link ? `\nCheck this receipt online: ${link}\n` : ""}\nMam & Mam Overseas Ltd. · Government Licensed Recruiting Agency · RL1217`,
        attachments: [{ filename: `${r.no}.pdf`, content: pdf, contentType: "application/pdf" }] });
    } catch (e) { console.error("Receipt email failed:", e.message); return fail(`The receipt could not be emailed to ${to}. Check the email settings and try again.`); }
    r.mailed = { to, at: now(), ok: true }; return { msg: `Money receipt ${r.no} emailed to ${to}.` };
  }
  if (d.op === "discard") { // remove an entry that was not approved (wrong entry)
    const r = M.receipts.find(x => x.id === d.id); must(r, "Receipt not found."); must(r.status === "pending" || u.role === "admin", "An approved receipt cannot be deleted. Cancel it instead.");
    must(u.role === "admin" || r.received?.uid === u.id, "Only the admin or the person who entered it can delete this entry.");
    if (r.ledgerId) db.ledger = db.ledger.filter(l => l.id !== r.ledgerId); // the admin deletes an approved receipt: its payment leaves the agent account too
    M.receipts = M.receipts.filter(x => x !== r); return { msg: r.status === "pending" ? `Entry ${r.no} deleted.` : `Money receipt ${r.no} deleted.` };
  }
  if (d.op === "account") { // update a payer's details
    const acc = M.accounts.find(a => a.id === d.id); must(acc, "Account not found.");
    const x = mrPayer(d.payer); must(Object.values(x).some(Boolean), "Enter at least one of: name, mobile, passport no., email or agent name.");
    for (const k of ["passport", "mobile", "email"]) if (x[k]) { const o = M.accounts.find(a => a.id !== acc.id && a[k] === x[k]); must(!o, `Another account already has this ${k === "passport" ? "passport no." : k}: ${o?.name || o?.[k]}`); }
    Object.assign(acc, x, { updated: now() });
    if ("price" in d && !acc.agentId) { const p = d.price === "" || d.price == null ? null : r2(Number(d.price)); must(p === null || (p >= 0 && p < 1e9), "Check the price."); acc.price = p; }
    return { msg: "Account updated." };
  }
  if (d.op === "chargeAdd") { // a debit on a payer's account: quantity × rate
    const acc = M.accounts.find(a => a.id === d.accountId); must(acc, "Account not found."); must(!acc.agentId, "This payer pays through an agent: add charges in Agent accounts.");
    const qty = numv(d.qty ?? 1, 1, 10000), rate = numv(d.rate, 0, 1e8), desc = str(d.desc, 200); must(desc && rate > 0, "Enter the details and the rate.");
    M.charges.push({ id: id("mc"), accountId: acc.id, date: /^\d{4}-\d{2}-\d{2}$/.test(d.date || "") ? d.date : new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10), desc, qty, rate, amount: r2(qty * rate), by: u.name, at: now() });
    return { msg: "Added to the payment history." };
  }
  if (d.op === "chargeEdit") {
    const c = M.charges.find(x => x.id === d.id); must(c, "Entry not found.");
    const qty = numv(d.qty, 1, 10000), rate = numv(d.rate, 0, 1e8); must(rate > 0, "Enter the rate and quantity.");
    Object.assign(c, { qty, rate, amount: r2(qty * rate) }); if (str(d.desc)) c.desc = str(d.desc, 200);
    return { msg: `Saved: ${rate.toLocaleString("en-US")} × ${qty} = ${c.amount.toLocaleString("en-US")} BDT.` };
  }
  if (d.op === "chargeDelete") { const c = M.charges.find(x => x.id === d.id); must(c, "Entry not found."); M.charges = M.charges.filter(x => x !== c); return { msg: "Entry deleted." }; }
  if (d.op === "void") { // cancel a receipt; it stays in the list marked Cancelled
    must(u.role === "admin", "Only the admin can cancel a receipt.", 403);
    const r = M.receipts.find(x => x.id === d.id); must(r, "Receipt not found."); must(!r.void, "This receipt is already cancelled.");
    r.void = { by: u.name || "Admin", at: now(), reason: str(d.reason, 200) };
    if (r.ledgerId) db.ledger = db.ledger.filter(l => l.id !== r.ledgerId); // take the payment off the agent's account again
    return { msg: `Receipt ${r.no} cancelled.` };
  }
  must(false, "Unknown request.");
};
/* signature picture (PNG) of an admin or staff member: their own, or anyone's when the admin sets it */
A["staff.signature"] = async (d, u) => {
  must(u && (u.role === "admin" || u.role === "staff"), "Only admin and staff accounts have a signature.", 403);
  const x = d.uid && d.uid !== u.id ? user(d.uid) : u;
  if (x !== u) must(u.role === "admin" && x && (x.role === "staff" || x.role === "admin"), "Only the admin can change another person's signature.", 403);
  // the old picture is kept: receipts already signed still show it
  if (d.remove) { x.signature = null; return { msg: "Signature removed." }; }
  must(d.file, "Choose your signature picture (PNG).");
  x.signature = storeFile(d.file, x.id, { pdf: false }); return { msg: "Signature saved. It appears on money receipts you sign." };
};


/* ======================= office main account & staff salaries ======================= */
// Main account: the office cash book. Money in (debit) and money out (credit), entered by hand; approved money receipts,
// agent payments and salary payments are added automatically. Salary accounts: pay admin / staff, receipt with a QR code.
if (!db.office) db.office = { entries: [] };
if (!db.salary) db.salary = { profiles: {}, pays: [], seq: {} };
for (const p of db.salary.pays) if (!p.status) p.status = "received"; // paid before the receive step existed
// a salary counts (statement, main account) once the person confirms they received it
const salaryDone = p => !p.void && p.status === "received";
const bdDay = () => new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10);
/* attendance from the day after the last salary up to this payment date: P present, A absent, H holiday */
function salaryAtt(uid, date, period) {
  const prev = db.salary.pays.filter(p => p.uid === uid && !p.void && p.date < date).sort((a, b) => b.date.localeCompare(a.date))[0];
  const addDay = (d, k) => new Date(Date.parse(d + "T00:00:00Z") + k * 864e5).toISOString().slice(0, 10);
  let from = prev ? addDay(prev.date, 1) : addDay(date, period === "weekly" ? -6 : -29);
  if (ATT.since && from < ATT.since) from = ATT.since;
  const to = date < attDay() ? date : attDay(); // days still to come are not counted
  if (from > to) return null;
  const days = []; for (let d = from; d <= to && days.length < 62; d = addDay(d, 1)) days.push({ d, s: attHoliday(d) ? "H" : ATT.marks[uid]?.[d] ? "P" : "A" });
  return { from, to, days };
}
/* ---------- office attendance: a tick per working day; signing in from the office IP ticks it by itself ---------- */
if (!db.attendance) db.attendance = { marks: {}, ipLog: {}, holidays: [{ date: "2026-12-16", name: "Victory Day" }, { date: "2026-12-25", name: "Christmas" }], office: { mode: "auto", ip: "", autoIp: "" } };
const ATT = db.attendance;
const attDay = () => process.env.ATT_DAY || bdDay(); // ATT_DAY: tests only
if (!ATT.since) ATT.since = attDay(); // days before this are not counted
// the office network: an IPv4 address as it is; an IPv6 address by its /64 network (every device has its own IPv6 address)
const netOf = ip => { ip = String(ip || "").replace(/^::ffff:/, ""); if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip; const g = ip.split(":"); return g.length > 2 ? g.slice(0, 4).join(":") + "::/64" : ip; };
const attHoliday = d => { const dow = new Date(d + "T00:00:00Z").getUTCDay(); if (dow === 5) return "Weekly holiday (Friday)"; return ATT.holidays.find(h => h.date === d)?.name || ""; };
const officeIp = () => (ATT.office.mode === "manual" && ATT.office.ip) || ATT.office.autoIp || "";
const attMark = (uid, day, m) => { (ATT.marks[uid] ||= {})[day] = m; };
function attTouch(u, ip0) {
  const ip = netOf(ip0); if (!ip) return;
  const day = attDay(), log = (ATT.ipLog[day] ||= {}), list = (log[ip] ||= []);
  let changed = false;
  if (!list.includes(u.id)) { list.push(u.id); changed = true; }
  // automatic office IP: the network most admin/staff use today (at least two people); when it moves, people already seen there are ticked
  // the first office IP: two people on one network; afterwards a new network needs three or more people today, and an admin confirms it
  if (ATT.office.mode !== "manual" && !ATT.office.autoIp && list.length >= 2) {
    ATT.office.autoIp = ip; ATT.office.autoAt = now(); changed = true;
    if (!attHoliday(day)) for (const uid of list) if (!ATT.marks[uid]?.[day]) attMark(uid, day, { at: now(), by: "auto", ip });
  } else if (ip !== officeIp() && list.length >= 3 && list.length > (log[officeIp()] || []).length && ATT.office.candidate?.ip !== ip && !(ATT.office.dismissed || []).includes(ip)) {
    ATT.office.candidate = { ip, at: now(), day }; changed = true;
    notifyAdmins(`${list.length} admin/staff are using a new network (${ip}) today. If the office internet changed, confirm it as the office IP in Site settings › Office attendance.`, "settings");
  }
  if (ip === officeIp() && !attHoliday(day) && !ATT.marks[u.id]?.[day]) { attMark(u.id, day, { at: now(), by: "auto", ip }); changed = true; }
  // keep 60 days of the IP log
  for (const d of Object.keys(ATT.ipLog)) if (d < new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10)) { delete ATT.ipLog[d]; changed = true; }
  if (changed) save();
}
A["attendance.tick"] = async (d, u, ctx) => {
  must(isStaffRole(u), "Not allowed.", 403);
  const day = attDay(), target = d.uid && d.uid !== u.id ? d.uid : u.id, date = okDate(d.date);
  if (target !== u.id || date !== day) {
    must(u.role === "admin", date < day ? "A past day cannot be changed." : "Only today can be ticked.", 403); // admins can correct a day for anyone
    must(date <= day, "A future day cannot be ticked.");
  }
  must(!attHoliday(date) || d.off === true, "This day is a holiday.");
  const was = ATT.marks[target]?.[date];
  if (d.off) { must(u.role === "admin", "Only an admin can remove a tick.", 403); if (ATT.marks[target]) delete ATT.marks[target][date]; return { msg: "Tick removed." }; }
  if (was) return { msg: "Already ticked." };
  const ip = netOf(ctx.ip);
  attMark(target, date, { at: now(), by: target === u.id ? "self" : `admin:${u.name}`, ip, office: ip === officeIp() });
  return { msg: "Present." };
};
/* ---------- HEADLINES on the website: a scrolling news line under the header ---------- */
if (!db.headlines) db.headlines = [];
if (!db.agentBook) db.agentBook = [];
// the old "Visa & BMET processing" department is now two: BMET section and Visa section (a title with BMET goes to BMET section)
for (const m of db.team || []) if (m.dept === "Visa & BMET processing") m.dept = /bmet|clearance|emigration/i.test(`${m.title} ${m.bio}`) ? "BMET section" : "Visa section";
A["admin.headlines"] = async (d, u) => {
  needPerm(u, "headlines"); const L = db.headlines, x = d.id ? L.find(h => h.id === d.id) : null;
  if (d.op === "save") {
    const text = str(d.text, 300); must(text.length >= 3, "Write the headline."); const link = str(d.link, 300);
    must(!link || /^(https?:\/\/|#)/.test(link), "The link must start with https:// or #.");
    const until = /^\d{4}-\d{2}-\d{2}$/.test(d.until || "") ? d.until : "";
    if (x) { Object.assign(x, { text, link, until, hot: !!d.hot, updated: now(), updatedBy: u.name }); return { msg: "Headline saved." }; }
    must(L.length < 50, "Up to 50 headlines.");
    L.unshift({ id: id("hl"), text, link, until, hot: !!d.hot, active: true, by: u.name, at: now() }); return { msg: "Headline added. It shows on the website now." };
  }
  must(x, "Headline not found.");
  if (d.op === "toggle") { x.active = !x.active; return { msg: x.active ? "Shown on the website." : "Hidden from the website." }; }
  if (d.op === "move") { const i = L.indexOf(x), j = i + (d.dir < 0 ? -1 : 1); if (j >= 0 && j < L.length) [L[i], L[j]] = [L[j], L[i]]; return {}; }
  if (d.op === "delete") { db.headlines = L.filter(h => h !== x); return { msg: "Headline deleted." }; }
  must(false, "Unknown request.");
};
A["admin.attendance"] = async (d, u) => {
  must(u.role === "admin", "Only an admin can change this.", 403);
  if (d.op === "dismiss") { ATT.office.dismissed = [...(ATT.office.dismissed || []), ATT.office.candidate?.ip].filter(Boolean).slice(-20); ATT.office.candidate = null; return { msg: "Kept the current office IP." }; }
  if (d.op === "officeIp") {
    if (d.mode === "auto") { ATT.office.mode = "auto"; return { msg: "The office IP is found automatically." }; }
    ATT.office.candidate = null;
    const ip = str(d.ip, 60); must(ip, "Choose an IP."); ATT.office = { ...ATT.office, mode: ATT.office.mode === "manual" ? "manual" : "auto", ip, autoIp: ip, setBy: u.name, setAt: now() };
    const day = attDay(); if (!attHoliday(day)) for (const uid of ATT.ipLog[day]?.[ip] || []) if (!ATT.marks[uid]?.[day]) attMark(uid, day, { at: now(), by: "auto", ip });
    return { msg: `Office IP set to ${ip}.` };
  }
  if (d.op === "holidayAdd") { const date = /^\d{4}-\d{2}-\d{2}$/.test(d.date || "") ? d.date : ""; must(date && str(d.name), "Enter the date and the name."); ATT.holidays = [...ATT.holidays.filter(h => h.date !== date), { date, name: str(d.name, 80) }].sort((a, b) => a.date.localeCompare(b.date)); return { msg: "Holiday added." }; }
  if (d.op === "holidayDelete") { ATT.holidays = ATT.holidays.filter(h => h.date !== d.date); return { msg: "Holiday removed." }; }
  must(false, "Unknown request.");
};
const attView = (u, all) => ({ today: attDay(), since: ATT.since, holidays: ATT.holidays, officeIp: officeIp(), marks: all ? ATT.marks : { [u.id]: ATT.marks[u.id] || {} },
  ...(all ? { office: ATT.office, ipLog: Object.fromEntries(Object.entries(ATT.ipLog).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14)) } : {}) });
const okDate = v => (/^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : bdDay());
function officeAuto() {
  const out = [];
  for (const r of db.mr.receipts) if (r.status === "approved" && !r.void)
    out.push({ id: "a-" + r.id, auto: "receipt", date: r.date, type: "in", desc: `Money receipt ${r.no}${r.payer.name ? " · " + r.payer.name : r.payer.passport ? " · " + r.payer.passport : ""}${r.purpose ? " · " + r.purpose : ""}`, amount: r.amount, method: [r.method, r.channel].filter(Boolean).join(" · "), ref: r.ref, at: r.approved?.at || r.created || null });
  for (const l of db.ledger) if (l.type === "payment" && l.status === "confirmed" && !l.mr) {
    const ag = user(l.agentId);
    out.push({ id: "a-" + l.id, auto: "agent", date: l.date, type: "in", desc: `Agent payment · ${agentName(ag) || "Agent"}${l.desc ? " · " + l.desc : ""}`, amount: Number(l.amount), method: l.method, ref: l.ref, at: l.confirmedAt || l.at || null });
  }
  for (const p of db.salary.pays) if (salaryDone(p) && p.paid > 0)
    out.push({ id: "a-" + p.id, auto: "salary", date: p.date, type: "out", desc: `Salary ${p.no} · ${p.name} · ${monthName(p.month)}`, amount: p.paid, method: [p.method, p.channel].filter(Boolean).join(" · "), ref: p.ref, at: p.recv?.at || p.created || null });
  return out;
}
const monthName = m => { const [y, mo] = String(m).split("-"); return new Date(Date.UTC(+y, +mo - 1, 1)).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }); };
// where money is: office cash, a bank, a mobile wallet, or with the Managing Director / a Director / the Chairman.
// Money with one of them counts only after that person accepts it in their own ID.
// the company's three leaders. Each is found in the Expert Team by name (or title); an admin/staff ID linked to that member confirms money entered as being with them.
const LEADERS = [{ k: "md", name: "Sujon Islam", title: "Managing Director" }, { k: "director", name: "Masud Rana", title: "Director" }, { k: "chairman", name: "Md. Al Mamun Khan", title: "Chairman" }];
const leaders = () => LEADERS.map(L => {
  const norm = x => String(x || "").toLowerCase().replace(/[^a-z]/g, "");
  const m = db.team.find(t => norm(t.name) === norm(L.name)) || db.team.find(t => norm(t.title) === norm(L.title));
  const ok = y => y && isStaffRole(y) && y.status !== "suspended" && y.status !== "deleted";
  // 1) the admin ID chosen for them in Main account, 2) an ID linked to their Expert Team profile, 3) an admin/staff ID with the same name
  const pick = db.office.leaderIds?.[L.k], x = (pick && db.users.find(y => y.id === pick && ok(y))) || (m && db.users.find(y => y.memberId === m.id && ok(y))) || db.users.find(y => ok(y) && norm(y.name) === norm(L.name));
  return { k: L.k, name: m?.name || L.name, title: m?.title || L.title, uid: x?.id || null, idName: x?.name || null };
});
// "Person · md" or "Person · md | Bank transfer · Sonali Bank PLC"
const personOf = method => { const m = /^Person · ([a-z]+)(?: \| (.+))?$/.exec(String(method || "")); return m ? m[1] : null; };
const personVia = method => { const m = /^Person · [a-z]+ \| (.+)$/.exec(String(method || "")); return m ? m[1] : "Cash"; };
A["admin.office"] = async (d, u) => {
  needPerm(u, "office");
  if (d.op === "add") {
    const list = (Array.isArray(d.rows) ? d.rows : [d]).slice(0, 50); must(list.length, "Add at least one entry.");
    const L = leaders(), lead = k => L.find(x => x.k === k), mine = L.find(x => x.uid === u.id)?.k;
    const made = list.map((x, i) => {
      const at = list.length > 1 ? ` (row ${i + 1})` : "", amount = r2(Number(x.amount));
      must(amount > 0 && amount < 1e10 && str(x.desc), `Enter the amount and details${at}.`);
      const type = x.type === "out" ? "out" : x.type === "transfer" ? "transfer" : "in";
      const e = { id: id("of"), date: okDate(x.date), type, desc: str(x.desc, 200), amount, ref: str(x.ref, 80), by: u.name, byId: u.id, at: now() };
      if (type === "transfer") { e.from = str(x.from, 80); e.to = str(x.to, 80); must(e.from && e.to && e.from !== e.to, `Choose where the money goes from and to${at}.`); }
      else e.method = str(x.method, 80) || "Cash";
      const people = [...new Set([e.method, e.from, e.to].map(personOf).filter(Boolean))];
      for (const p of people) must(lead(p), `Choose a Managing Director, Director or Chairman${at}.`);
      e.people = people; e.accepted = people.filter(p => p === mine); e.status = e.accepted.length === people.length ? "accepted" : "pending";
      return e;
    });
    db.office.entries.push(...made);
    for (const e of made) for (const p of e.people.filter(p => !e.accepted.includes(p)).map(lead).filter(x => x.uid).map(x => x.uid))
      notify(p, `${u.name} asks you to confirm BDT ${e.amount.toLocaleString("en-US")} ${e.type === "transfer" ? "moved" : e.type === "out" ? "paid out" : "received"} by you: ${e.desc.slice(0, 80)}. Open Money with me.`);
    const wait = made.filter(e => e.status === "pending").length;
    return { msg: `${made.length > 1 ? `${made.length} entries added.` : "Entry added."}${wait ? ` ${wait} waiting for the director's confirmation.` : ""}` };
  }
  if (d.op === "leaderId") {
    must(u.role === "admin", "Only an admin can do this.", 403); must(LEADERS.some(x => x.k === d.k), "Unknown person.");
    const x = d.uid && db.users.find(y => y.id === d.uid); must(!d.uid || (x && isStaffRole(x)), "Choose an admin or staff ID.");
    db.office.leaderIds = { ...(db.office.leaderIds || {}), [d.k]: d.uid || null };
    const L = leaders().find(y => y.k === d.k);
    if (x) for (const e of db.office.entries.filter(e => e.status === "pending" && e.people?.includes(d.k) && !e.accepted?.includes(d.k))) notify(x.id, `${e.by} asks you to confirm BDT ${e.amount.toLocaleString("en-US")}: ${e.desc.slice(0, 80)}. Open Money with me.`);
    return { msg: x ? `Requests for ${L.name} now go to ${x.name}'s ID.` : "Removed." };
  }
  if (d.op === "delete") { const e = db.office.entries.find(x => x.id === d.id); must(e, "Entry not found."); db.office.entries = db.office.entries.filter(x => x !== e); return { msg: "Entry deleted." }; }
  must(false, "Unknown request.");
};
/* the Managing Director, a Director or the Chairman confirms (or refuses) money entered as being with them */
A["office.accept"] = async (d, u) => {
  must(isStaffRole(u), "Not allowed.", 403);
  const k = leaders().find(x => x.uid === u.id)?.k;
  const e = db.office.entries.find(x => x.id === d.id); must(k && e && e.people?.includes(k), "Request not found."); must(e.status === "pending", "This request is already answered.");
  if (d.ok) {
    e.accepted = [...new Set([...(e.accepted || []), k])]; if (e.accepted.length === e.people.length) e.status = "accepted";
    notifyAdmins(`${u.name} confirmed BDT ${e.amount.toLocaleString("en-US")}: ${e.desc.slice(0, 80)}.`, "office");
    return { msg: e.status === "accepted" ? "Confirmed. It is now in the main account." : "Confirmed. Waiting for the other person." };
  }
  e.status = "rejected"; e.rejected = { by: u.name, at: now(), text: str(d.text, 200) };
  notifyAdmins(`${u.name} did not confirm BDT ${e.amount.toLocaleString("en-US")}: ${e.desc.slice(0, 80)}${e.rejected.text ? ` (${e.rejected.text})` : ""}.`, "office");
  return { msg: "Marked as not received. The office has been told." };
};
const salaryOut = (p, pub) => {
  const sig = p.by?.sig && db.files[p.by.sig] ? (pub ? `/api/salary/${p.token}/sig` : `/api/files/${p.by.sig}`) : "";
  const rsig = p.recv?.sig && db.files[p.recv.sig] ? (pub ? `/api/salary/${p.token}/rsig` : `/api/files/${p.recv.sig}`) : "";
  const x = { ...p, by: p.by ? { name: p.by.name, title: p.by.title, at: p.by.at, sigUrl: sig } : null, recv: p.recv ? { name: p.recv.name, at: p.recv.at, sigUrl: rsig } : null };
  if (pub) { delete x.uid; delete x.id; delete x.mailed; delete x.email; delete x.note; }
  return x;
};

/* the person who is paid: confirm receiving a salary (or say it was not received); their copy of the receipt */
A["staff.salary"] = async (d, u) => {
  must(isStaffRole(u), "Only admin and staff accounts have a salary account.", 403);
  const p = db.salary.pays.find(x => x.id === d.id && x.uid === u.id); must(p && !p.void, "Salary receipt not found.");
  if (d.op === "receive") {
    must(p.status !== "received", "You already confirmed this salary.");
    p.status = "received"; p.recv = { name: u.name, at: now(), sig: u.signature?.id || null }; delete p.problem;
    notifyAdmins(`${u.name} confirmed receiving salary ${p.no} (${monthName(p.month)}, BDT ${p.paid.toLocaleString("en-US")}).`, "salary");
    return { msg: `Thank you. Salary ${p.no} is added to your salary statement.`, email: p.email || "" };
  }
  if (d.op === "problem") {
    must(p.status !== "received", "You already confirmed this salary.");
    p.status = "problem"; p.problem = { text: str(d.text, 300) || "Not received", at: now() };
    notifyAdmins(`${u.name} says salary ${p.no} (${monthName(p.month)}) was not received: ${p.problem.text}`, "salary");
    return { msg: "The office has been told. They will contact you." };
  }
  if (d.op === "mail") { // the person's own browser makes the PDF after confirming
    must(p.status === "received", "Confirm receiving the salary first.");
    return A["admin.salary"]({ op: "mail", id: p.id, pdf: d.pdf }, { ...u, role: "admin" });
  }
  must(false, "Unknown request.");
};
A["admin.salary"] = async (d, u) => {
  needPerm(u, "salary"); const S = db.salary;
  if (d.op === "monthly") { // the usual monthly salary of a person
    const x = user(d.uid); must(isStaffRole(x), "Choose an admin or staff ID.");
    const m = d.monthly === "" || d.monthly == null ? null : r2(Number(d.monthly)); must(m === null || (m >= 0 && m < 1e8), "Check the salary.");
    S.profiles[x.id] = { ...(S.profiles[x.id] || {}), monthly: m }; return { msg: "Monthly salary saved." };
  }
  if (d.op === "pay") {
    const x = user(d.uid); must(isStaffRole(x), "Choose an admin or staff ID.");
    must(x.id !== u.id || u.role === "admin", "You cannot pay your own salary. Ask the admin.");
    must(/^\d{4}-\d{2}$/.test(d.month || ""), "Choose the salary month.");
    const num = (v, lab) => { const n = v === "" || v == null ? 0 : r2(Number(v)); must(n >= 0 && n < 1e8, `Check the ${lab}.`); return n; };
    const basic = num(d.basic, "salary"), bonus = num(d.bonus, "bonus"), deduct = num(d.deduct, "deduction"), net = r2(basic + bonus - deduct);
    must(net > 0, "The net salary must be more than 0.");
    const paid = d.paid === "" || d.paid == null ? net : num(d.paid, "amount paid"); must(paid > 0, "Enter the amount paid.");
    const method = MR_METHODS.includes(d.method) ? d.method : "Cash", channel = MR_CHANNEL.includes(method) ? str(d.channel, 80) : "";
    must(channel || method === "Cheque" || !MR_CHANNEL.includes(method), method === "Mobile banking" ? "Choose the mobile banking service." : "Choose the bank.");
    const date = okDate(d.date), yr = date.slice(0, 4); S.seq[yr] = (S.seq[yr] || 0) + 1;
    const m = x.memberId && db.team.find(t => t.id === x.memberId);
    const p = { id: id("sp"), no: `SP-${yr}-${String(S.seq[yr]).padStart(4, "0")}`, uid: x.id, name: x.name, title: m?.title || "", email: x.email, role: x.role,
      month: d.month, period: d.period === "weekly" ? "weekly" : "monthly", basic, bonus, deduct, net, paid, date, method, channel, ref: str(d.ref, 80), note: str(d.note, 300),
      att: salaryAtt(x.id, date, d.period === "weekly" ? "weekly" : "monthly"),
      by: mrSigner(u), token: crypto.randomBytes(12).toString("hex"), created: now() };
    p.status = "pending"; S.pays.unshift(p);
    notify(x.id, `Salary for ${monthName(p.month)}: BDT ${paid.toLocaleString("en-US")} was paid to you (${p.no}). Open My salary and confirm that you received it.`);
    return { msg: `Salary ${p.no} saved. ${x.name} will be asked to confirm receiving it; then it is added to the statement and the receipt is emailed.`, payId: p.id };
  }
  if (d.op === "mail") { // the payer's browser makes the PDF; the server emails it to the staff member
    const p = S.pays.find(x => x.id === d.id); must(p && !p.void, "Salary receipt not found."); must(p.email, "This person has no email address.");
    must(p.status === "received", "The salary receipt is emailed after the person confirms receiving the salary.");
    const pdf = Buffer.from(String(d.pdf || "").replace(/^data:application\/pdf;base64,/, ""), "base64");
    must(pdf.length > 100 && pdf.length < 4e6 && pdf.subarray(0, 5).toString() === "%PDF-", "The receipt PDF is missing.");
    const mailer = await getMailer(); const fail = msg => { p.mailed = { to: p.email, at: now(), ok: false }; return { msg }; };
    if (!mailer) return fail("Email is not set up on this server, so the salary receipt was not emailed. Download it and send it yourself.");
    const link = ADMIN_HOST || AGENT_HOST || process.env.CANONICAL_HOST ? `${mainUrl()}/s/${p.token}` : "", money = n => `BDT ${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
    try {
      await mailer.sendMail({ from: `"Mam & Mam Overseas Ltd." <${mailFrom()}>`, to: p.email, subject: `Salary receipt ${p.no} · ${monthName(p.month)}`,
        text: `Assalamu Alaikum ${p.name},\n\nYour salary for ${monthName(p.month)} has been paid. The salary receipt is attached.\n\nReceipt No.: ${p.no}\nSalary: ${money(p.basic)}${p.bonus ? `\nBonus / allowance: ${money(p.bonus)}` : ""}${p.deduct ? `\nDeduction: ${money(p.deduct)}` : ""}\nNet salary: ${money(p.net)}\nPaid: ${money(p.paid)} (${[p.method, p.channel].filter(Boolean).join(" · ")}${p.ref ? " · " + p.ref : ""})\n${link ? `\nCheck this receipt online: ${link}\n` : ""}\nMam & Mam Overseas Ltd. · Government Licensed Recruiting Agency · RL1217`,
        attachments: [{ filename: `${p.no}.pdf`, content: pdf, contentType: "application/pdf" }] });
    } catch (e) { console.error("Salary email failed:", e.message); return fail(`The salary receipt could not be emailed to ${p.email}.`); }
    p.mailed = { to: p.email, at: now(), ok: true }; return { msg: `Salary receipt ${p.no} emailed to ${p.email}.` };
  }
  if (d.op === "void") {
    must(u.role === "admin", "Only the admin can cancel a salary receipt.", 403);
    const p = S.pays.find(x => x.id === d.id); must(p && !p.void, "Salary receipt not found."); p.void = { by: u.name, at: now() }; return { msg: `Salary receipt ${p.no} cancelled.` };
  }
  must(false, "Unknown request.");
};

/* ======================= statements (with a QR code to check them) ======================= */
// A statement is issued from the server's own records (agent account, money-receipt payer, salary, main account);
// the issued copy is kept, so the QR code on the printout shows exactly what was issued.
if (!db.statements) db.statements = { list: [], seq: {} };
const STMT_PERM = { agent: "ledger", payer: "receipts", staff: "salary", office: "office" };
const short = (m, c) => { const x = String(c || "").replace(/\s*\(.*\)\s*$/, "") || String(m || "").split("·").pop().trim().replace(/\s*\(.*\)\s*$/, ""); return (x || "Cash").toUpperCase(); };
const fmtN = n => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
function stmtSource(kind, ref) {
  if (kind === "agent") {
    const a = user(ref); must(a?.role === "agent", "Agent not found.");
    return { title: agentName(a), sub: [a.name, a.agent?.phone, a.email].filter(Boolean).join(" · "), email: a.email, label: "PAYMENT HISTORY",
      rows: db.ledger.filter(l => l.agentId === a.id && l.status === "confirmed").map(l => ({ date: l.date, details: l.desc, rate: l.type === "charge" ? `${fmtN(l.rate || l.amount)}X${l.qty || 1}` : short(l.method), debit: l.type === "charge" ? Number(l.amount) : 0, credit: l.type === "payment" ? Number(l.amount) : 0 })) };
  }
  if (kind === "payer") {
    const acc = db.mr.accounts.find(x => x.id === ref); must(acc, "Account not found.");
    const rows = [];
    if (acc.price > 0) rows.push({ date: (acc.created || "").slice(0, 10), details: "Total price", rate: `${fmtN(acc.price)}X1`, debit: acc.price, credit: 0 });
    for (const c of db.mr.charges.filter(c => c.accountId === acc.id)) rows.push({ date: c.date, details: c.desc, rate: `${fmtN(c.rate)}X${c.qty}`, debit: c.amount, credit: 0 });
    for (const r of db.mr.receipts.filter(r => r.accountId === acc.id && r.status === "approved" && !r.void)) rows.push({ date: r.date, details: `Money Received${r.purpose ? " · " + r.purpose : ""} (${r.no})`, rate: short(r.method, r.channel), debit: 0, credit: r.amount });
    return { title: acc.name || acc.passport || acc.mobile || "Account", sub: [acc.passport && `Passport ${acc.passport}`, acc.mobile, acc.email, acc.agent && `Agent: ${acc.agent}`].filter(Boolean).join(" · "), email: acc.email, label: "PAYMENT HISTORY", rows };
  }
  if (kind === "staff") {
    const x = user(ref); must(isStaffRole(x), "Account not found."); const m = x.memberId && db.team.find(t => t.id === x.memberId);
    return { title: x.name, sub: [m?.title || (x.role === "admin" ? "Admin" : "Staff"), x.email].filter(Boolean).join(" · "), email: x.email, label: "SALARY ACCOUNT", heads: ["Salary (net)", "Paid"],
      rows: db.salary.pays.filter(p => p.uid === x.id && salaryDone(p)).map(p => ({ date: p.date, details: `Salary ${monthName(p.month)} (${p.no})`, rate: short(p.method, p.channel), debit: p.net, credit: p.paid })) };
  }
  if (kind === "office") {
    return { title: "Mam & Mam Overseas Ltd. · Main account", sub: "Office cash book", email: "", label: "MAIN ACCOUNT", cash: true, heads: ["Money in", "Money out"],
      rows: [...db.office.entries.filter(e => (e.status || "accepted") === "accepted" && e.type !== "transfer"), ...officeAuto()].map(e => ({ date: e.date, details: e.desc, rate: personOf(e.method) ? short(personVia(e.method)) : short(e.method), debit: e.type === "in" ? e.amount : 0, credit: e.type === "out" ? e.amount : 0 })) };
  }
  must(false, "Choose an account.");
}
function stmtCalc(rows, from, to) {
  const all = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)) || (a.debit ? -1 : 1) - (b.debit ? -1 : 1));
  let bal = 0; const out = [];
  const before = from ? all.filter(r => r.date < from) : [];
  if (before.length) { bal = r2(before.reduce((t, r) => t + r.debit - r.credit, 0)); out.push({ date: from, details: "Opening balance", rate: "", debit: bal > 0 ? bal : 0, credit: bal < 0 ? -bal : 0, balance: bal, opening: true }); }
  for (const r of all) { if (from && r.date < from) continue; if (to && r.date > to) continue; bal = r2(bal + r.debit - r.credit); out.push({ ...r, balance: bal }); }
  const live = out.filter(r => !r.opening);
  return { rows: out.slice(-1500), debit: r2(live.reduce((t, r) => t + r.debit, 0)), credit: r2(live.reduce((t, r) => t + r.credit, 0)), balance: bal };
}
const stmtOut = (x, pub) => { const o = { ...x }; delete o.token; if (pub) { delete o.id; delete o.ref; delete o.email; delete o.mailed; } else o.url = `/st/${x.token}`; return o; };
A["admin.statement"] = async (d, u) => {
  const L = db.statements;
  if (d.op === "issue") {
    const kind = d.kind; must(STMT_PERM[kind], "Choose an account."); needPerm(u, STMT_PERM[kind]);
    const src = stmtSource(kind, d.ref), day = v => (/^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : "");
    const from = day(d.from), to = day(d.to), calc = stmtCalc(src.rows, from, to), yr = bdDay().slice(0, 4); L.seq[yr] = (L.seq[yr] || 0) + 1;
    const st = { id: id("st"), no: `ST-${yr}-${String(L.seq[yr]).padStart(4, "0")}`, token: crypto.randomBytes(12).toString("hex"), kind, ref: d.ref, label: src.label, cash: !!src.cash, heads: src.heads || null,
      title: src.title, sub: src.sub, email: src.email || "", from, to, ...calc, issuedBy: u.name || "Office", at: now() };
    L.list.unshift(st); if (L.list.length > 3000) L.list.length = 3000;
    return { statement: { ...stmtOut(st), token: st.token } };
  }
  if (d.op === "mail") {
    const st = L.list.find(x => x.id === d.id); must(st, "Statement not found."); needPerm(u, STMT_PERM[st.kind]);
    const to = mrNorm.email(d.to || st.email); must(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to), "Enter the email address.");
    const pdf = Buffer.from(String(d.pdf || "").replace(/^data:application\/pdf;base64,/, ""), "base64");
    must(pdf.length > 100 && pdf.length < 12e6 && pdf.subarray(0, 5).toString() === "%PDF-", "The statement PDF is missing.");
    const mailer = await getMailer(); must(mailer, "Email is not set up on this server. Download the PDF and send it yourself.");
    const link = ADMIN_HOST || AGENT_HOST || process.env.CANONICAL_HOST ? `${mainUrl()}/st/${st.token}` : "", money = n => `BDT ${fmtN(n)}`;
    const end = st.cash ? `Balance: ${money(st.balance)}` : st.kind === "staff" ? (st.balance > 0 ? `Still to pay: ${money(st.balance)}` : st.balance < 0 ? `Paid in advance: ${money(-st.balance)}` : "All paid.") : st.balance > 0 ? `Due: ${money(st.balance)}` : st.balance < 0 ? `Advance: ${money(-st.balance)}` : "Settled.";
    try {
      await mailer.sendMail({ from: `"Mam & Mam Overseas Ltd." <${mailFrom()}>`, to, subject: `Statement ${st.no} · ${st.title}`,
        text: `Assalamu Alaikum,\n\nYour statement from Mam & Mam Overseas Ltd. is attached.\n\nStatement No.: ${st.no}\nAccount: ${st.title}\nPeriod: ${st.from || "start"} to ${st.to || st.at.slice(0, 10)}\n${end}\n${link ? `\nCheck this statement online: ${link}\n` : ""}\nMam & Mam Overseas Ltd. · Government Licensed Recruiting Agency · RL1217`,
        attachments: [{ filename: `${st.no}.pdf`, content: pdf, contentType: "application/pdf" }] });
    } catch (e) { console.error("Statement email failed:", e.message); must(false, `The statement could not be emailed to ${to}. Try again later.`); }
    st.mailed = { to, at: now() }; return { msg: `Statement ${st.no} emailed to ${to}.` };
  }
  must(false, "Unknown request.");
};

/* ======================= passport entry (BMET Clearance) ======================= */
// The office keeps a list of passports (name, number, country, gender, reference). It is used when making money receipts,
// account entries and BMET clearance applications. A reference that is one of our agents lets that agent use the passport too.
if (!db.passports) db.passports = [];
/* ---------- Visa applications › KSA visa › HR files ---------- */
if (!db.visa) db.visa = { files: [], seq: 0 };
const MOFA_ST = ["Not applied", "Applied", "Issued", "Rejected", "Cancelled"], VISA_ST = ["Pending", "Applied", "Issued", "Stamped", "Rejected", "Cancelled"];
const okDay = v => (/^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : "");
/* ---------- MOFA visa information (Enjaz): the office types the captcha, the server fetches visa date, sponsor and occupation ---------- */
const ENJAZ = process.env.ENJAZ_BASE || "https://visa.mofa.gov.sa", ENJAZ_PAGE = "/Enjaz/GetVisaInformation/Person", enjazSessions = new Map();
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const htmlText = h => String(h || "").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x([0-9a-f]+);/gi, (_, x) => String.fromCodePoint(parseInt(x, 16))).replace(/&#(\d+);/g, (_, x) => String.fromCodePoint(+x)).replace(/\s+/g, " ").trim();
async function enjazFetch(sess, path, opt = {}) {
  let url = ENJAZ + path, method = opt.method || "GET", body = opt.body;
  for (let hop = 0; hop < 4; hop++) {
    const r = await fetch(url, { method, body, redirect: "manual", signal: AbortSignal.timeout(20000), headers: { "User-Agent": UA, "Accept-Language": "ar,en;q=0.8", Referer: ENJAZ + (sess.page || ENJAZ_PAGE), Cookie: [...sess.jar].map(([k, v]) => `${k}=${v}`).join("; "), ...(body ? { "Content-Type": "application/x-www-form-urlencoded", Origin: ENJAZ } : {}) } });
    for (const c of r.headers.getSetCookie?.() || []) { const [kv] = c.split(";"); const i = kv.indexOf("="); if (i > 0) sess.jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); }
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { url = new URL(r.headers.get("location"), url).href; method = "GET"; body = undefined; continue; }
    return r;
  }
  throw new Error("Too many redirects.");
}
const MOFA_APPLICANT = "/VisaPerson/GetApplicantData", MOFA_MEDICAL = "/VisaPerson/CheckMedicalResult";
/* MOFA "check that the health certificate was issued": application number + passport + the image code the office types */
async function medSubmit(d) {
  const sess = enjazSessions.get(d.sid); must(sess && sess.page === MOFA_MEDICAL, "The image code has expired. Press Check again.");
  const pp = ppNorm(d.passport), app = str(d.appNo, 20).toUpperCase(), code = str(d.code, 10);
  must(/^[A-Z0-9]{6,15}$/.test(pp), "Enter the passport number."); must(/^E?\d{6,12}$/.test(app), "Enter the MOFA application ID (E…)."); must(code, "Type the image code.");
  const form = new URLSearchParams({ AppNo: app, PassportNo: pp, Captcha: code }); if (sess.token) form.set("__RequestVerificationToken", sess.token);
  const r = await enjazFetch(sess, MOFA_MEDICAL, { method: "POST", body: form.toString() }), html = await r.text();
  const L = pageLines(html).filter(l => !/^(التأكد من اصدار الشهادة الصحية|التأكد من إصدار الشهادة الصحية|check medical result)$/i.test(l));
  const msg = L.find(l => /(تم|لم يتم|has been|not been|no medical|لا يوجد|غير)\s.*(الشهاد|certificate|medical|الطبي)|medical certificate|الشهادة الصحية/i.test(l) && l.length < 220) || "";
  if (!msg) {
    const err = (/class="[^"]*(?:validation-summary-errors|alert-danger|field-validation-error|error)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span|ul)>/i.exec(html) || [])[1];
    const img = (/id=['"]imgCaptcha['"][^>]*src=['"]([^'"]+)['"]/i.exec(html) || [])[1];
    const tok = (/name="__RequestVerificationToken"[^>]*value="([^"]+)"/.exec(html) || [])[1]; if (tok) sess.token = tok; sess.t = Date.now();
    return { ok: false, problem: htmlText(err || "") || (img ? "No answer. Check the image code." : "The MOFA page answered in a way this form does not know yet."), img: img ? await enjazCaptcha(sess, img).catch(() => null) : null, lines: img ? undefined : L.slice(0, 60) };
  }
  enjazSessions.delete(d.sid);
  const issued = !/لم|not been|not issued|no medical|لا يوجد|غير/i.test(msg) && /تم|has been|issued|صدر/i.test(msg);
  return { ok: true, issued, message: msg };
}
const optsOf = (html, name) => { const m = new RegExp(`<select\\b[^>]*name="${name}"[^>]*>([\\s\\S]*?)<\\/select>`, "i").exec(html); return m ? [...m[1].matchAll(/<option\b[^>]*value="([^"]*)"[^>]*>([^<]*)</gi)].map(o => ({ value: o[1], text: htmlText(o[2]) })).filter(o => o.value) : []; };
async function enjazStart(page = ENJAZ_PAGE) {
  must(typeof fetch === "function", "The server's Node.js is too old for this.");
  for (const [k, v] of enjazSessions) if (v.t < Date.now() - 10 * 60e3) enjazSessions.delete(k);
  const sess = { jar: new Map(), t: Date.now(), page }, r = await enjazFetch(sess, page), html = await r.text();
  if (page === MOFA_APPLICANT) {
    const nat = optsOf(html, "Nationality"), vt = optsOf(html, "VisaType");
    sess.nationality = (nat.find(o => /بنغلاد|بنجلاد|بنقلاد|bangla/i.test(o.text)) || {}).value || "";
    sess.visaTypes = vt; sess.natOpts = nat;
  }
  must(r.ok, `The MOFA site did not open (${r.status}). Try again.`);
  sess.token = (/name="__RequestVerificationToken"[^>]*value="([^"]+)"/.exec(html) || /value="([^"]+)"[^>]*name="__RequestVerificationToken"/.exec(html) || [])[1] || "";
  const sel = /<select\b[^>]*name="Embassy"[^>]*>([\s\S]*?)<\/select>/i.exec(html);
  sess.embassy = (sel && [...sel[1].matchAll(/<option\b[^>]*value="(\d+)"[^>]*>\s*(دكا|Dhaka)\s*</gi)][0]?.[1]) || "218";
  const img = (/id=['"]imgCaptcha['"][^>]*src=['"]([^'"]+)['"]/i.exec(html) || /src=['"](\/Base\/GetRandomCaptchaImage\/[^'"]+)['"]/i.exec(html) || [])[1];
  must(img, "The MOFA page has changed (no image code found).");
  const sid = crypto.randomBytes(12).toString("hex"); enjazSessions.set(sid, sess);
  return { sid, img: await enjazCaptcha(sess, img), ...(page === MOFA_APPLICANT ? { visaTypes: sess.visaTypes, nationality: sess.nationality, natOpts: sess.nationality ? undefined : sess.natOpts } : {}) };
}
/* MOFA application by passport: application status, visa number and visa status */
const mofaStatusOf = t => /reject|رفض|مرفوض/i.test(t) ? "Rejected" : /cancel|ملغ|الغاء|إلغاء/i.test(t) ? "Cancelled" : /issued|صدر|اصدار|إصدار|approved|موافق/i.test(t) ? "Issued" : t ? "Applied" : "";
async function mofaSubmit(d) {
  const sess = enjazSessions.get(d.sid); must(sess && sess.page === MOFA_APPLICANT, "The image code has expired. Press Fetch again.");
  const pp = ppNorm(d.passport), code = str(d.code, 10), nat = str(d.nationality, 10) || sess.nationality, vt = str(d.visaType, 10);
  must(/^[A-Z0-9]{6,15}$/.test(pp), "Enter the passport number."); must(code, "Type the image code."); must(nat, "Choose the nationality.");
  const form = new URLSearchParams({ PassportNumber: pp, Nationality: nat, VisaType: vt, Embassy: sess.embassy, Captcha: code });
  if (sess.token) form.set("__RequestVerificationToken", sess.token);
  const r = await enjazFetch(sess, MOFA_APPLICANT, { method: "POST", body: form.toString() }), html = await r.text();
  const L = pageLines(html), get = re => valueAfter(L, re);
  // the result is the printed application (Application Number, Name, Passport Number, Occupation…); a visa number or status shows once the visa is issued
  const appNo = (/\b(E\d{8,10})\b/.exec(get(/^(application number|رقم الطلب|رقم الإنجاز|رقم انجاز)$/i) || L.join(" ")) || [])[1] || "";
  const passOn = ppNorm(get(/^(passport number|رقم الجواز)$/i));
  const found = appNo && (!passOn || passOn === pp);
  if (!found) {
    const err = (/class="[^"]*(?:validation-summary-errors|alert-danger|field-validation-error|error)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span|ul)>/i.exec(html) || [])[1];
    const img = (/id=['"]imgCaptcha['"][^>]*src=['"]([^'"]+)['"]/i.exec(html) || [])[1];
    const tok = (/name="__RequestVerificationToken"[^>]*value="([^"]+)"/.exec(html) || [])[1]; if (tok) sess.token = tok; sess.t = Date.now();
    return { ok: false, problem: htmlText(err || "") || (img ? "Nothing found. Check the image code and the visa type (Work)." : "The MOFA page answered in a way this form does not know yet."), img: img ? await enjazCaptcha(sess, img).catch(() => null) : null, lines: img ? undefined : L.slice(0, 80) };
  }
  enjazSessions.delete(d.sid);
  const K = [["Application Number", /^(application number|رقم الطلب|رقم الإنجاز)$/i], ["Application Date", /^(application date|تاريخ الطلب)$/i], ["Saudi Mission in", /^(saudi mission in|الممثلية|البعثة)/i], ["Visa Type", /^(visa type|نوع التأشيرة|نوع التاشيرة)$/i],
    ["Number of Entries", /^(number of entries|عدد مرات الدخول)$/i], ["Sponsor Name", /^(sponsor name|اسم الكفيل|اسم صاحب العمل)$/i], ["Name", /^(name|الاسم)$/i], ["Passport Number", /^(passport number|رقم الجواز)$/i],
    ["Date of Expiry", /^(date of expiry|تاريخ الانتهاء|تاريخ انتهاء)/i], ["Date of Birth", /^(date of birth|تاريخ الميلاد)$/i], ["Place of Birth", /^(place of birth|مكان الميلاد|محل الميلاد)$/i], ["Gender", /^(gender|الجنس)$/i],
    ["Occupation", /^(occupation|المهنة)$/i], ["Purpose", /^(purpose|الغرض|الغاية)/i], ["Visa Number", /^(visa (no|number)|رقم التأشيرة|رقم التاشيرة)$/i], ["Visa Status", /^(visa status|حالة التأشيرة|حالة الطلب|status|الحالة)$/i]];
  // a value is the first line after its label that is not itself a label (the printed form repeats some labels, e.g. Name / Name)
  const isLabel = x => K.some(([k, re]) => re.test(String(x).replace(/\s*[:：]\s*$/, "")) || k.toLowerCase() === String(x).trim().toLowerCase());
  const getV = re => { for (let i = 0; i < L.length - 1; i++) { const l = L[i].replace(/\s*[:：]\s*$/, ""); if (l.length < 50 && re.test(l)) { const m = /[:：]\s*(.+)$/.exec(L[i]); if (m && m[1].trim() && !isLabel(m[1])) return m[1].trim(); for (let j = i + 1; j < Math.min(L.length, i + 4); j++) if (!isLabel(L[j]) && L[j].length < 200) return L[j]; } } return ""; };
  const pairs = K.map(([k, re]) => [k, k === "Application Number" ? appNo : getV(re)]).filter(([, v]) => v && v !== "0");
  const v = Object.fromEntries(pairs), vs = v["Visa Status"] || "";
  const visaNo = (/^\d{8,12}$/.test(v["Visa Number"] || "") ? v["Visa Number"] : "");
  const dmy = x => { const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(x || ""); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : ""; };
  return { ok: true, pairs, lines: L.slice(0, 150), found: {
    mofaStatus: /reject|رفض/i.test(vs) ? "Rejected" : /cancel|ملغ/i.test(vs) ? "Cancelled" : visaNo || /issued|صدر|إصدار/i.test(vs) ? "Issued" : "Applied",
    visaStatus: /stamp|مختوم/i.test(vs) ? "Stamped" : /reject|رفض/i.test(vs) ? "Rejected" : /cancel|ملغ/i.test(vs) ? "Cancelled" : visaNo || /issued|صدر|إصدار/i.test(vs) ? "Issued" : "Applied",
    mofaId: appNo, visaNo, mofaProfession: v.Occupation || "", dob: dmy(v["Date of Birth"]), expiryDate: dmy(v["Date of Expiry"]), birthPlace: v["Place of Birth"] || "",
    name: (v.Name || "").replace(/\s+/g, " ").trim(), sex: /^(male|ذكر)/i.test(v.Gender || "") ? "Male" : /^(female|أنثى|انثى)/i.test(v.Gender || "") ? "Female" : "",
    issuePlaceEn: /dhaka|دكا|داكا/i.test(v["Saudi Mission in"] || "") ? "Dhaka" : "", travelPurpose: /work|عمل/i.test(v["Visa Type"] || v.Purpose || "") ? "Work" : "",
    occupationAr: /[\u0600-\u06FF]/.test(v.Occupation || "") ? v.Occupation : "", sponsorNameAr: v["Sponsor Name"] || "" } };
}
async function enjazCaptcha(sess, img) {
  const r = await enjazFetch(sess, img.startsWith("/") ? img : "/Base/GetRandomCaptchaImage/" + Math.floor(Math.random() * 1e9));
  must(r.ok, "The image code did not load. Try again.");
  return `data:${r.headers.get("content-type") || "image/jpeg"};base64,${Buffer.from(await r.arrayBuffer()).toString("base64")}`;
}
/* the page as lines of text, input values included, in reading order */
const pageLines = html => String(html || "").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<option[\s\S]*?<\/option>/gi, " ")
  .replace(/<input\b[^>]*\bvalue="([^"]*)"[^>]*>/gi, (m, v) => /type="hidden"/i.test(m) ? "\n" : `\n${v}\n`).replace(/<[^>]+>/g, "\n")
  .split("\n").map(x => htmlText(x)).filter(Boolean);
/* a value printed after its label (label on one line or cell, value on the next) */
function valueAfter(lines, re) {
  for (let i = 0; i < lines.length - 1; i++) {
    const l = lines[i].replace(/\s*[:：]\s*$/, "");
    if (l.length < 50 && re.test(l)) { const m = /[:：]\s*(.+)$/.exec(lines[i]); if (m && m[1].trim()) return m[1].trim(); const v = lines[i + 1]; if (v && !/[:：]\s*$/.test(v) && v.length < 200) return v; }
  }
  return "";
}
/* reads label → value pairs and the jobs table from the MOFA result page */
function enjazParse(html) {
  const pairs = [], seen = new Set();
  for (const m of html.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/gi)) {
    const label = htmlText(m[1]).replace(/[:：]\s*$/, ""); if (!label || label.length > 60 || seen.has(label)) continue;
    const after = html.slice(m.index + m[0].length, m.index + m[0].length + 900).split(/<label\b|<h\d\b|<table\b/i)[0];
    const v = (/<input\b[^>]*\bvalue="([^"]*)"/i.exec(after) || [])[1] ?? htmlText((/<(?:div|span|p|td)\b[^>]*>([\s\S]*?)<\/(?:div|span|p|td)>/i.exec(after) || [])[1]);
    const val = htmlText(v || ""); if (val && val.length < 200) { seen.add(label); pairs.push([label, val]); }
  }
  const jobs = [];
  for (const t of html.matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
    const rows = [...t[0].matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map(r => [...r[0].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(c => htmlText(c[1])));
    if (rows.length > 1) jobs.push({ head: rows[0], rows: rows.slice(1).filter(r => r.some(Boolean)) });
  }
  const pick = re => pairs.find(([l]) => re.test(l))?.[1] || "";
  const jt = jobs.find(j => j.head.some(h => /occupation|المهنة/i.test(h))), oc = jt ? jt.head.findIndex(h => /occupation|المهنة/i.test(h)) : -1;
  const found = { visaDate: pick(/visa date|تاريخ (ال)?تأشيرة|تاريخ الصادر|تاريخ التاشيرة/i), sponsorName: pick(/full name|الاسم|اسم صاحب|اسم الكفيل/i), sponsorAddress: pick(/address|العنوان/i), sponsorIdNo: pick(/residence|national id|رقم الهوية|السجل المدني|رقم الإقامة/i), occupation: oc >= 0 ? jt.rows.map(r => r[oc]).filter(Boolean).join(" / ") : "" };
  if (!found.visaDate && found.sponsorName) found.visaDate = (/\b1[45]\d\d\/\d{1,2}\/\d{1,2}\b/.exec(htmlText(html)) || [])[0] || "";
  return { found, pairs, jobs };
}
async function enjazSubmit(d) {
  const sess = enjazSessions.get(d.sid); must(sess, "The image code has expired. Press Search again.");
  const code = str(d.code, 10), visaNo = str(d.visaNo, 20).replace(/\D/g, ""), sponsor = str(d.sponsorId, 20).replace(/\D/g, "");
  must(visaNo && sponsor, "Enter the visa number and the sponsor ID."); must(code, "Type the image code.");
  const form = new URLSearchParams({ VisaNumber: visaNo, Embassy: sess.embassy, SponserID: sponsor, Captcha: code, VisaInformation: "" });
  if (sess.token) form.set("__RequestVerificationToken", sess.token);
  const r = await enjazFetch(sess, ENJAZ_PAGE, { method: "POST", body: form.toString() }), html = await r.text();
  const out = enjazParse(html), text = htmlText(html);
  if (!out.found.visaDate && !out.found.sponsorName) {
    // still on the search page: wrong image code or no visa found; give a fresh image code
    const err = (/class="[^"]*(?:validation-summary-errors|alert-danger|field-validation-error|error)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span|ul)>/i.exec(html) || [])[1];
    const img = (/id=['"]imgCaptcha['"][^>]*src=['"]([^'"]+)['"]/i.exec(html) || [])[1];
    const tok = (/name="__RequestVerificationToken"[^>]*value="([^"]+)"/.exec(html) || [])[1]; if (tok) sess.token = tok; sess.t = Date.now();
    return { ok: false, problem: htmlText(err || "") || (img ? "Nothing found. Check the image code, visa number and sponsor ID." : "The MOFA page answered in a way this form does not know yet."), img: img ? await enjazCaptcha(sess, img).catch(() => null) : null, sample: img ? undefined : text.slice(0, 600) };
  }
  enjazSessions.delete(d.sid);
  return { ok: true, ...out };
}
A["admin.visa"] = async (d, u) => {
  needPerm(u, "visa");
  if (d.op === "save") {
    const x = d.file || {}, old = d.id && db.visa.files.find(f => f.id === d.id); must(!d.id || old, "File not found.");
    const ag = x.agentId ? user(x.agentId) : null; must(!x.agentId || ag?.role === "agent", "Agent not found.");
    const v = { country: "KSA" };
    for (const k of VISA_FIELDS) v[k] = VISA_DATES.includes(k) ? okDay(x[k]) : str(x[k], ["address", "note", "pcUrl", "remark"].includes(k) ? 1000 : 160);
    Object.assign(v, { passport: ppNorm(x.passport).slice(0, 20), agentId: ag ? ag.id : null, agent: ag ? agentName(ag) : "",
      mofaStatus: MOFA_ST.includes(x.mofaStatus) ? x.mofaStatus : "Not applied", visaStatus: VISA_ST.includes(x.visaStatus) ? x.visaStatus : "Pending", name: str(x.name, 120) });
    must(v.name.length >= 2, "Enter the client's full name."); must(/^[A-Z0-9]{6,15}$/.test(v.passport), "Check the passport number (letters and numbers, 6 to 15).");
    must(!db.visa.files.some(f => f !== old && f.passport === v.passport && f.visaStatus !== "Cancelled"), `A file for passport ${v.passport} already exists.`);
    if (old) { Object.assign(old, v, { updated: now(), updatedBy: u.name }); return { msg: "Client file saved.", id: old.id }; }
    const f = { id: id("vf"), sl: ++db.visa.seq, ...v, created: now(), by: u.name }; db.visa.files.push(f);
    return { msg: `Client file created for ${v.name}.`, id: f.id };
  }
  /* Fetch by passport: what the office already has for this passport (passport entry, BMET clearance workers, earlier visa files) */
  if (d.op === "fetch") {
    const pp = ppNorm(d.passport); must(/^[A-Z0-9]{6,15}$/.test(pp), "Enter the passport number.");
    const out = {}, put = o => { for (const [k, w] of Object.entries(o)) if (w && !out[k]) out[k] = w; };
    const med = db.visa.medical?.[pp]; if (med) put({ medicalResult: med.medicalResult, medicalCenter: med.medicalCenter, medicalSlipDate: med.medicalSlipDate });
    const p = db.passports.find(x => x.passport === pp);
    if (p) put({ name: p.name, sex: p.gender, agentId: p.agentId, ...(p.info || {}) }); // the Passport Entry first: it is the office's checked copy
    const old = db.visa.files.filter(f => f.passport === pp && f.id !== d.id).sort((a, b) => b.created.localeCompare(a.created))[0];
    if (old) { const { id: _i, sl, created, by, updated, updatedBy, ...rest } = old; put(rest); }
    const w = (db.workers || []).find(x => ppNorm(x.passport) === pp); if (w) put({ name: w.name, agentId: w.agentId, address: w.district, mofaProfession: w.trade });
    const c = db.users.find(x => x.role === "candidate" && ppNorm(x.profile?.passport) === pp); if (c) put({ name: c.name, dob: c.profile?.dob, sex: c.profile?.gender, address: c.profile?.address, mofaProfession: c.profile?.trade });
    const dupFile = old && { id: old.id, name: old.name, sl: old.sl, created: old.created }, inList = !!p;
    if (!Object.keys(out).length) return { problem: `Nothing found for passport ${pp} in the office records.`, exists: { file: dupFile || null, passport: inList } };
    return { exists: { file: dupFile || null, passport: inList }, msg: `Found passport ${pp}${p ? " (Passport Entry)" : old ? " (from an earlier file)" : ""}.`, found: out };
  }
  /* Search by visa number / sponsor ID: copy the visa and sponsor details from another file with the same visa */
  if (d.op === "visaSearch") {
    const vn = str(d.visaNo, 40), si = str(d.sponsorId, 40); must(vn || si, "Enter the visa number or the sponsor ID.");
    const hit = db.visa.files.filter(f => f.id !== d.id && ((vn && f.visaNo === vn) || (!vn && si && f.sponsorId === si))).sort((a, b) => b.created.localeCompare(a.created))[0];
    if (!hit && d.soft) return { found: {} };
    must(hit, `No earlier file with this ${vn ? "visa number" : "sponsor ID"}. Fill in the visa details (Visa Check opens Enjaz).`);
    const K = ["visaNo", "visaDate", "sponsorName", "sponsorId", "issuePlaceEn", "issuePlaceAr", "qualificationEn", "qualificationAr", "professionEn", "professionAr", "travelPurpose", "musaned", "wakala", "enjazProfessionAr", "enjazProfessionEn", "stayEn", "stayAr", "salary", "food"];
    return { msg: `Visa details copied from ${hit.name}'s file (SL ${hit.sl}).`, found: Object.fromEntries(K.filter(k => hit[k]).map(k => [k, hit[k]])) };
  }
  if (d.op === "mofaStart") { try { return await enjazStart(MOFA_APPLICANT); } catch (e) { if (e instanceof Fail) throw e; must(false, `Could not reach the MOFA site: ${e.message}`); } }
  if (d.op === "medStart") { try { return await enjazStart(MOFA_MEDICAL); } catch (e) { if (e instanceof Fail) throw e; must(false, `Could not reach the MOFA site: ${e.message}`); } }
  if (d.op === "medSubmit") { try { return await medSubmit(d); } catch (e) { if (e instanceof Fail) throw e; must(false, `Could not reach the MOFA site: ${e.message}`); } }
  if (d.op === "mofaSubmit") { try { return await mofaSubmit(d); } catch (e) { if (e instanceof Fail) throw e; must(false, `Could not reach the MOFA site: ${e.message}`); } }
  /* Medical result brought from Wafid by the office's bookmark: saved on every file of the passport, and kept for files made later */
  if (d.op === "medical") {
    const pp = ppNorm(d.passport); must(/^[A-Z0-9]{6,15}$/.test(pp), "No passport number in the Wafid result.");
    const m = { medicalResult: ["FIT", "UNFIT"].includes(d.medicalResult) ? d.medicalResult : "", medicalCenter: str(d.medicalCenter, 160), medicalSlipDate: okDay(d.medicalSlipDate) };
    must(m.medicalResult || m.medicalCenter, "Nothing to save.");
    if (!db.visa.medical) db.visa.medical = {};
    db.visa.medical[pp] = { ...m, name: str(d.name, 120), at: now(), by: u.name };
    const hit = db.visa.files.filter(f => f.passport === pp && f.visaStatus !== "Cancelled");
    for (const f of hit) Object.assign(f, Object.fromEntries(Object.entries(m).filter(([, v]) => v)), { updated: now(), updatedBy: u.name });
    return { msg: hit.length ? `Medical result saved on ${hit.length > 1 ? `${hit.length} client files` : `${hit[0].name}'s client file`}.` : `Medical result saved for passport ${pp}. Fetch will fill it in the client file.` };
  }
  if (d.op === "enjazStart") { try { return await enjazStart(); } catch (e) { if (e instanceof Fail) throw e; must(false, `Could not reach the MOFA site: ${e.message}`); } }
  if (d.op === "enjazCaptcha") { const sess = enjazSessions.get(d.sid); must(sess, "Press Search again."); try { return { img: await enjazCaptcha(sess, "/Base/GetRandomCaptchaImage/" + Math.floor(Math.random() * 1e9)) }; } catch (e) { must(false, e.message); } }
  if (d.op === "enjazSubmit") { try { return await enjazSubmit(d); } catch (e) { if (e instanceof Fail) throw e; must(false, `Could not reach the MOFA site: ${e.message}`); } }
  if (d.op === "delete") { must(db.visa.files.some(f => f.id === d.id), "File not found."); db.visa.files = db.visa.files.filter(f => f.id !== d.id); return { msg: "Client file deleted." }; }
  must(false, "Unknown request.");
};
const ppNorm = v => String(v || "").replace(/\s+/g, "").toUpperCase();
const PP_PERMS = ["clearance", "receipts", "ledger", "office", "visa"];
// which entry lists a passport belongs to: BMET, KSA, Fiji (one passport can be in several)
const ppLists = p => p.lists || (p.lists = [p.fiji && "fiji", p.info && "ksa", !p.fiji && !p.info && "bmet"].filter(Boolean));
for (const p of db.passports || []) ppLists(p);
const PP_INFO = ["fatherName", "motherName", "dob", "birthPlace", "prevNationality", "nationality", "marital", "sect", "religion", "address", "mofaId", "oldMofaId", "issuePlace", "issueDate", "expiryDate", "validity"];
A["admin.passport"] = async (d, u) => {
  must(can(u, "clearance") || can(u, "visa"), "You do not have permission for this.", 403);
  const read = x => {
    const name = str(x.name, 120), passport = ppNorm(x.passport).slice(0, 20), country = str(x.country, 60), gender = x.gender === "Female" ? "Female" : x.gender === "Male" ? "Male" : "";
    must(name.length >= 2, "Enter the full name."); must(/^[A-Z0-9]{6,15}$/.test(passport), "Check the passport number (letters and numbers, 6 to 15).");
    must(country, "Choose the country."); must(gender, "Choose Male or Female.");
    const ag = x.agentId ? user(x.agentId) : null; must(!x.agentId || ag?.role === "agent", "Agent not found.");
    const info = x.info && typeof x.info === "object" ? Object.fromEntries(PP_INFO.map(k => [k, VISA_DATES.includes(k) ? okDay(x.info[k]) : str(x.info[k], k === "address" ? 1000 : 160)]).filter(([, v]) => v)) : undefined;
    return { name, passport, country, gender, ref: ag ? agentName(ag) : str(x.ref, 120), agentId: ag ? ag.id : null, ...(info ? { info } : {}) };
  };
  if (d.op === "add") {
    const list = (Array.isArray(d.rows) ? d.rows : [d]).slice(0, 100); must(list.length, "Add at least one passport.");
    const made = list.map((x, i) => { let v; try { v = read(x); } catch (e) { if (list.length > 1 && e instanceof Fail) e.message += ` (row ${i + 1})`; throw e; } return v; });
    const tag = d.list === "ksa" ? "ksa" : "bmet";
    must(!made.find((v, i) => made.findIndex(w => w.passport === v.passport) !== i), "The same passport is twice in the list.");
    // a passport already in another list is added to this one (its details updated), not entered twice
    const dup = made.find(v => db.passports.some(p => p.passport === v.passport && ppLists(p).includes(tag)));
    must(!dup, `Passport ${dup?.passport} is already in the list.`);
    let merged = 0;
    for (const v of made) {
      const old = db.passports.find(p => p.passport === v.passport);
      if (old) { Object.assign(old, v, { info: { ...(old.info || {}), ...(v.info || {}) }, lists: [...new Set([...ppLists(old), tag])], updated: now() }); merged++; }
      else db.passports.unshift({ id: id("pp"), ...v, lists: [tag], by: u.name, at: now() });
    }
    return { msg: made.length > 1 ? `${made.length} passports added.` : merged ? `Passport ${made[0].passport} was already entered elsewhere; it is now in this list too.` : `Passport ${made[0].passport} added.` };
  }
  if (d.op === "update") {
    const p = db.passports.find(x => x.id === d.id); must(p, "Passport not found."); const v = read(d);
    must(!db.passports.some(x => x !== p && x.passport === v.passport), `Passport ${v.passport} is already in the list.`);
    Object.assign(p, v, { updated: now() }); if (v.info) p.lists = [...new Set([...ppLists(p), "ksa"])]; return { msg: "Passport updated." };
  }
  if (d.op === "delete") { // from one list; the passport is removed when it is in no list any more
    const p = db.passports.find(x => x.id === d.id); must(p, "Passport not found.");
    const left = d.list ? ppLists(p).filter(k => k !== d.list) : [];
    if (left.length) { p.lists = left; if (d.list === "fiji") delete p.fiji; return { msg: `Passport ${p.passport} removed from this list.` }; }
    db.passports = db.passports.filter(x => x !== p); return { msg: `Passport ${p.passport} deleted.` };
  }
  /* Visa applications entry: the worker's status in one list (KSA or Fiji) */
  if (d.op === "status") {
    const p = db.passports.find(x => x.id === d.id); must(p, "Passport not found."); must(["ksa", "fiji", "bmet"].includes(d.list), "Unknown list.");
    const t = str(d.status, 60); p.vstatus = p.vstatus || {};
    if (!t) { delete p.vstatus[d.list]; return { msg: "Status cleared." }; }
    if (p.vstatus[d.list]?.s === t) return {};
    p.vstatus[d.list] = { s: t, at: now(), by: u.name }; p.vhist = [...(p.vhist || []), { list: d.list, s: t, at: now(), by: u.name }].slice(-50);
    return { msg: `Status: ${t}` };
  }
  /* Fiji Passport Entry: work details and what was handed in with the passport; an existing passport gets these added */
  if (d.op === "fiji") {
    const name = str(d.name, 120), passport = ppNorm(d.passport).slice(0, 20), x = d.fiji || {};
    must(name.length >= 2, "Enter the full name."); must(/^[A-Z0-9]{6,15}$/.test(passport), "Check the passport number (letters and numbers, 6 to 15).");
    const ag = d.agentId ? user(d.agentId) : null; must(!d.agentId || ag?.role === "agent", "Agent not found.");
    const returnee = x.returnee === "yes" ? "yes" : "no";
    const fiji = { profession: str(x.profession, 80), experience: Math.max(0, Math.min(50, Number(x.experience) || 0)), returnee, prevCountry: returnee === "yes" ? str(x.prevCountry, 80) : "",
      submitted: x.submitted === "photocopy" ? "photocopy" : "original", docs: ["photo", "police", "medical"].filter(k => (x.docs || []).includes(k)), note: str(x.note, 1000), at: now(), by: u.name };
    must(fiji.profession, "Enter the profession."); must(returnee === "no" || fiji.prevCountry, "Enter the country the person came back from.");
    const ref = ag ? agentName(ag) : str(d.ref, 120);
    const old = d.id ? db.passports.find(p => p.id === d.id) : db.passports.find(p => p.passport === passport);
    must(!d.id || old, "Passport not found.");
    if (old) {
      must(!db.passports.some(p => p !== old && p.passport === passport), `Passport ${passport} is already in the list.`);
      Object.assign(old, { name, passport, ref, agentId: ag ? ag.id : null, fiji, lists: [...new Set([...ppLists(old), "fiji"])], updated: now() }); if (!old.country) old.country = "Fiji";
      return { msg: d.id ? "Passport updated." : `Fiji details added to passport ${passport}.` };
    }
    db.passports.unshift({ id: id("pp"), name, passport, country: "Fiji", gender: "", ref, agentId: ag ? ag.id : null, fiji, lists: ["fiji"], by: u.name, at: now() });
    return { msg: `Passport ${passport} added.` };
  }
  must(false, "Unknown request.");
};
/* Agent list: agents typed by name (not registered on the site). The first time a new name is written as the agent
   (passport entry, Fiji entry, clearance, money receipt) it is saved here, so it can be picked from the list next time. */
const bookKey = v => String(v || "").trim().replace(/\s+/g, " ").toLowerCase();
function bookAgent(name, u) {
  const n = str(name, 120).replace(/\s+/g, " "), k = bookKey(n);
  if (n.length < 2 || ["self", "office", "self (no agent)"].includes(k)) return null;
  if (db.users.some(x => x.role === "agent" && bookKey(agentName(x)) === k)) return null;
  const old = db.agentBook.find(a => bookKey(a.name) === k); if (old) return old;
  const a = { id: id("ab"), name: n, fullName: "", mobile: "", email: "", agency: "", address: "", created: now(), by: u?.name || "" };
  db.agentBook.push(a); return a;
}
/* a typed agent name is written the same way as the agent it matches: a registered agent (then linked by id) or a name in the agent list */
const agentMatch = n => { const k = bookKey(n); if (!k) return null; const r = db.users.find(x => x.role === "agent" && bookKey(agentName(x)) === k); if (r) return { id: r.id, name: agentName(r) }; const b = db.agentBook.find(a => bookKey(a.name) === k); return b ? { name: b.name } : null; };
{ const wrap = (k, fix, names) => { const f = A[k]; A[k] = async (d, u) => { try { fix(d); } catch {} const r = await f(d, u); try { names(d).forEach(n => bookAgent(n, u)); } catch {} return r; }; };
  const ppRows = d => ["add", "update", "fiji"].includes(d.op) ? (Array.isArray(d.rows) ? d.rows : [d]) : [];
  wrap("admin.passport", d => ppRows(d).forEach(x => { if (x.agentId || !x.ref) return; const m = agentMatch(x.ref); if (m) { x.ref = m.name; if (m.id) x.agentId = m.id; } }),
    d => ppRows(d).filter(x => !x.agentId).map(x => x.ref));
  wrap("admin.clearance", d => { if (d.agentId || !d.agentName) return; const m = agentMatch(d.agentName); if (m) { if (m.id) d.agentId = m.id; else d.agentName = m.name; } }, d => d.agentId ? [] : [d.agentName]);
  wrap("admin.mr", d => { if (d.op !== "entry" || d.agentId || !d.payer?.agent) return; const m = agentMatch(d.payer.agent); if (m) { d.payer.agent = m.name; if (m.id) d.agentId = m.id; } },
    d => d.op === "entry" && !d.agentId ? [d.payer?.agent] : []); }
/* an agent from the Agents list who opens their own agent account: same name, mobile or email joins them.
   Everything written under the name (passports, workers, clearance files, money receipts, balance updates) moves to the account. */
const dig10 = v => String(v || "").replace(/\D/g, "").slice(-10);
function bookMatches(x) {
  if (x?.role !== "agent") return [];
  const names = [agentName(x), x.name].map(bookKey).filter(Boolean), ph = [x.agent?.phone, x.phone].map(dig10).filter(v => v.length >= 10), em = String(x.email || "").trim().toLowerCase();
  return db.agentBook.filter(a => names.includes(bookKey(a.name)) || (a.fullName && names.includes(bookKey(a.fullName))) || (a.agency && names.includes(bookKey(a.agency))) || (dig10(a.mobile).length >= 10 && ph.includes(dig10(a.mobile))) || (a.email && em && a.email.toLowerCase() === em));
}
function linkBookAgent(b, x) {
  const k = bookKey(b.name), n = { passports: 0, workers: 0, files: 0, receipts: 0, entries: 0 }, today = now().slice(0, 10);
  for (const p of db.passports) if (!p.agentId && bookKey(p.ref) === k) {
    p.agentId = x.id; p.ref = agentName(x); n.passports++;
    // the agent sees the person in My workers
    const pp = String(p.passport || "").replace(/\s+/g, "").toUpperCase();
    if (pp && !db.workers.some(w => String(w.passport).replace(/\s+/g, "").toUpperCase() === pp)) db.workers.push({ id: id("w"), agentId: x.id, name: p.name, father: "", passport: pp, passportExpiry: p.info?.expiryDate || "", dob: p.info?.dob || "", phone: "", district: "", trade: p.fiji?.profession || p.info?.profession || "", experience: Number(p.fiji?.experience) || 0, created: p.at || now(), by: "agency" });
  }
  for (const w of db.workers) if (!w.agentId && bookKey(w.agentName) === k) { w.agentId = x.id; delete w.agentName; n.workers++; }
  for (const c of db.clearances) if (!c.agentId && !c.candidateId && bookKey(c.agentName) === k) {
    c.agentId = x.id; delete c.agentName; n.files++; const w = worker(c.workerId), nm = w?.name || "";
    if (c.fee > 0) db.ledger.push({ id: id("l"), agentId: x.id, type: "charge", desc: `BMET clearance processing: ${nm} (${c.ref})`, amount: c.fee, date: (c.created || today).slice(0, 10), method: "", ref: "", status: "confirmed" });
    if (c.due > 0) db.ledger.push({ id: id("l"), agentId: x.id, type: "charge", desc: `Previous due: ${nm} (${c.ref})`, amount: c.due, date: (c.created || today).slice(0, 10), method: "", ref: "", status: "confirmed" });
  }
  for (const r of db.mr.receipts) if (!r.agentId && bookKey(r.payer?.agent) === k) {
    r.agentId = x.id; r.payer.agent = agentName(x); n.receipts++;
    if (r.status === "approved" && !r.void && !r.ledgerId) { const l = { id: id("l"), agentId: x.id, type: "payment", desc: `Money receipt ${r.no}${r.payer.name ? ": " + r.payer.name : ""}`, amount: r.amount, date: r.date, method: [r.method, r.channel].filter(Boolean).join(" · "), ref: r.ref || "", status: "confirmed", mr: r.id }; db.ledger.push(l); r.ledgerId = l.id; }
  }
  for (const a of db.mr.accounts || []) if (!a.agentId && bookKey(a.agent) === k) { a.agentId = x.id; a.agent = agentName(x); }
  for (const e of b.entries || []) { db.ledger.push({ id: id("l"), at: e.at, agentId: x.id, type: e.type, desc: e.desc, amount: e.amount, ...(e.type === "charge" ? { qty: e.qty, rate: e.rate } : {}), date: e.date, method: e.method || "", ref: e.ref || "", status: "confirmed" }); n.entries++; }
  // keep the details the office wrote, where the account has none
  x.agent = x.agent || {}; if (!x.agent.phone && b.mobile) x.agent.phone = b.mobile; if (!x.agent.address && b.address) x.agent.address = b.address;
  x.linkedBook = [...(x.linkedBook || []), { name: b.name, at: now(), ...n }];
  db.agentBook = db.agentBook.filter(a => a !== b);
  return n;
}
function linkAgentAccount(x) {
  const done = bookMatches(x).map(b => ({ name: b.name, ...linkBookAgent(b, x) }));
  if (done.length) notify(x.id, `Your earlier records with the agency (${done.map(d => d.name).join(", ")}) are now in your account: passports, workers, clearance files and payments.`);
  return done;
}
A["admin.agentBook"] = async (d, u) => {
  must(PP_PERMS.some(k => can(u, k)), "You do not have permission for this.", 403);
  const F = x => ({ fullName: str(x.fullName, 120), mobile: str(x.mobile, 30), email: str(x.email, 120).toLowerCase(), agency: str(x.agency, 150), address: str(x.address, 500) });
  if (d.op === "save") {
    const v = F(d); must(!v.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email), "Check the email address.");
    if (d.id) { const a = db.agentBook.find(x => x.id === d.id); must(a, "Agent not found."); Object.assign(a, v, { updated: now() }); return { msg: "Agent updated." }; }
    const name = str(d.name, 120).replace(/\s+/g, " ") || v.agency || v.fullName; must(name.length >= 2, "Enter the agent name.");
    must(!db.agentBook.some(a => bookKey(a.name) === bookKey(name)) && !db.users.some(x => x.role === "agent" && bookKey(agentName(x)) === bookKey(name)), `${name} is already in the agent list.`);
    db.agentBook.push({ id: id("ab"), name, ...v, created: now(), by: u.name }); return { msg: `${name} added to the agent list.` };
  }
  if (d.op === "delete") { const a = db.agentBook.find(x => x.id === d.id); must(a, "Agent not found."); db.agentBook = db.agentBook.filter(x => x !== a); return { msg: `${a.name} removed from the agent list.` }; }
  /* balance update: charges (agent owes) and money received, like Agent accounts */
  if (d.op === "entries") {
    must(can(u, "ledger") || can(u, "receipts") || u.role === "admin", "You do not have permission for this.", 403);
    const a = db.agentBook.find(x => x.id === d.id); must(a, "Agent not found.");
    const rows = (Array.isArray(d.rows) ? d.rows : [d]).slice(0, 30); must(rows.length, "Add an entry.");
    const made = rows.map((r, i) => {
      const at = rows.length > 1 ? ` (row ${i + 1})` : "", type = r.type === "payment" ? "payment" : "charge";
      const rate = Math.round(Number(r.rate) * 100) / 100, qty = type === "charge" ? Math.max(1, Math.min(10000, Math.round(Number(r.qty) || 1))) : 1;
      must(rate > 0 && rate < 1e9 && str(r.desc), `Enter the amount and description${at}.`);
      return { id: id("ae"), type, date: /^\d{4}-\d{2}-\d{2}$/.test(r.date || "") ? r.date : now().slice(0, 10), desc: str(r.desc, 200), rate, qty, amount: Math.round(rate * qty * 100) / 100, method: type === "payment" ? str(r.method, 40) : "", ref: str(r.ref, 80), by: u.name, at: now() };
    });
    a.entries = [...(a.entries || []), ...made]; return { msg: made.length > 1 ? `${made.length} entries added.` : "Added to the account." };
  }
  if (d.op === "entryDelete") {
    must(can(u, "ledger") || can(u, "receipts") || u.role === "admin", "You do not have permission for this.", 403);
    const a = db.agentBook.find(x => x.id === d.id); must(a, "Agent not found."); must((a.entries || []).some(e => e.id === d.eid), "Entry not found.");
    a.entries = a.entries.filter(e => e.id !== d.eid); return { msg: "Entry deleted." };
  }
  must(false, "Unknown request.");
};
A["admin.about"] = async (d, u) => {
  needPerm(u, "content"); const a = db.about;
  const L = (v, n) => String(v ?? "").slice(0, n).trim();
  if (d.op === "save") { // all texts of the page
    const x = d.about || {};
    a.credentials = L(x.credentials, 200); a.tagline = L(x.tagline, 400); a.overview = L(x.overview, 6000); a.commitment = L(x.commitment, 400); a.docsIntro = L(x.docsIntro, 300);
    a.stats = [0, 1, 2, 3].map(i => ({ value: L(x.stats?.[i]?.value, 30), label: L(x.stats?.[i]?.label, 60), sub: L(x.stats?.[i]?.sub, 60) }));
    a.highlights = [0, 1, 2].map(i => ({ value: L(x.highlights?.[i]?.value, 30), label: L(x.highlights?.[i]?.label, 60) }));
    a.leader = { ...a.leader, name: L(x.leader?.name, 80), title: L(x.leader?.title, 80), badge: L(x.leader?.badge, 60), quote: L(x.leader?.quote, 500), bio: L(x.leader?.bio, 2000) };
    for (const k of ["mission", "vision"]) a[k] = { title: L(x[k]?.title, 80), text: L(x[k]?.text, 800), tag: L(x[k]?.tag, 60), points: (x[k]?.points || []).map(p => L(p, 160)).filter(Boolean).slice(0, 6) };
    a.cta = { title: L(x.cta?.title, 120), text: L(x.cta?.text, 300) };
    return { msg: "About page saved." };
  }
  if (d.op === "leaderPhoto") {
    if (d.remove) { if (a.leader.photo) dropFile(a.leader.photo); a.leader.photo = null; return { msg: "Photo removed." }; }
    must(d.file, "Choose a photo."); const ref = storeFile(d.file, u.id, { pdf: false, isPublic: true }); if (a.leader.photo) dropFile(a.leader.photo); a.leader.photo = ref;
    return { msg: "Photo saved." };
  }
  if (d.op === "docAdd" || d.op === "docUpdate") {
    const data = { title: L(d.title, 120), issuer: L(d.issuer, 120), number: L(d.number, 80), valid: L(d.valid, 60) };
    must(data.title.length >= 2, "Enter the document name, e.g. RL Licence.");
    if (d.op === "docAdd") {
      must(d.file, "Choose the document (PDF or photo)."); must(a.docs.length < 30, "Too many documents.");
      a.docs.push({ id: id("ad"), ...data, file: storeFile(d.file, u.id, { pdf: true, images: true, isPublic: true }) });
      return { msg: "Document added to the About page." };
    }
    const x = a.docs.find(z => z.id === d.id); must(x, "Document not found.");
    Object.assign(x, data);
    if (d.file) { const ref = storeFile(d.file, u.id, { pdf: true, images: true, isPublic: true }); dropFile(x.file); x.file = ref; }
    return { msg: "Document saved." };
  }
  if (d.op === "docDelete") { const x = a.docs.find(z => z.id === d.id); must(x, "Document not found."); dropFile(x.file); a.docs = a.docs.filter(z => z !== x); return { msg: "Document removed." }; }
  if (d.op === "docMove") { const i = a.docs.findIndex(z => z.id === d.id), j = i + (d.dir < 0 ? -1 : 1); must(i >= 0, "Document not found."); if (j >= 0 && j < a.docs.length) [a.docs[i], a.docs[j]] = [a.docs[j], a.docs[i]]; return {}; }
  if (d.op === "reset") { must(d.confirm === true, "Not confirmed."); const keep = { docs: a.docs, leader: a.leader }; db.about = { ...JSON.parse(JSON.stringify(ABOUT_DEFAULT)), ...keep }; return { msg: "Texts reset to the defaults (documents and leader kept)." }; }
  must(false, "Unknown action.");
};
