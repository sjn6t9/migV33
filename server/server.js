// MAM & MAM Overseas Ltd. (RL 1217): portal backend.
// Built only on Node's built-in modules, so it runs on any Node 18+ without native packages.
// Data: one JSON document saved atomically to DATA_DIR/db.json (with daily backups); uploaded files in DATA_DIR/files.
// Email: verification codes are sent through SMTP when SMTP_* settings and the `nodemailer` package are present.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { COUNTRIES, HOURLY, STAGES, CL_STAGES, STAFF_PERMS, LABEL, INITIAL, TEAM_DEPTS } from "../src/constants.js";

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

function save() {
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
const ecRef = c => { db.clSeq = (db.clSeq || 100000) + 1; return `EC-${String(c.created || now()).slice(0, 4)}-RL1217-${db.clSeq}`; };
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
  ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", b => b.slice(0, 2).toString() === "PK"]];
/* f = { name, data: "data:...;base64,..." }; kinds limit which formats are accepted */
function storeFile(f, owner, { images = true, pdf = true, word = false, isPublic = false } = {}) {
  must(f && typeof f.data === "string" && f.data.startsWith("data:"), "File is missing.");
  const buf = Buffer.from(f.data.slice(f.data.indexOf(",") + 1), "base64");
  must(buf.length > 0, "File is empty."); must(buf.length <= MAX_FILE, "File is larger than 6 MB.");
  const sig = SIG.find(s => s[2](buf)); must(sig, "Unsupported file. Upload PDF or JPG.");
  const ok = (["jpg", "png", "webp"].includes(sig[0]) && images) || (sig[0] === "pdf" && pdf) || (["doc", "docx"].includes(sig[0]) && word);
  must(ok, images && !pdf ? "Upload a photo (JPG)." : "Upload a PDF or JPG file.");
  const fid = id("f"); fs.writeFileSync(path.join(DATA_DIR, "files", fid), buf);
  const name = str(f.name, 120).replace(/[^\w.\- ]+/g, "_") || `file.${sig[0]}`;
  db.files[fid] = { id: fid, owner, name, size: buf.length, mime: sig[1], public: isPublic, at: now() };
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
const cleanCl = c => ({ ...c, files: c.files ? { passport: fileRef(c.files.passport), visa: fileRef(c.files.visa), contract: fileRef(c.files.contract), others: (c.files.others || []).map(fileRef) } : c.files, card: c.card ? { ...c.card, data: `/api/files/${c.card.id}` } : null });

function viewFor(u) {
  const live = db.jobs.filter(j => j.status === "active");
  const pub = {
    v: db.v, session: u?.id || null, settings: { ...db.settings }, needsSetup: !db.users.some(x => x.role === "admin"), seo: db.seo, packages: db.packages, posts: db.posts,
    testimonials: db.testimonials, team: [...db.team].sort((a, b) => (a.order ?? 99) - (b.order ?? 99)).map(m => ({ ...m, photo: m.photo ? { ...m.photo, data: `/api/files/${m.photo.id}` } : null })), gallery: db.gallery.map(g => ({ ...g, src: `/api/files/${g.fileId}` })), scenery: sceneryView(u),
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
  } else if (u.role === "admin" || u.role === "staff") {
    Object.assign(pub, {
      jobs: db.jobs, applications: db.applications, orders: db.orders, messages: can(u, "messages") ? db.messages : [], workers: db.workers,
      clearances: db.clearances.map(cleanCl), ledger: db.ledger, tickets: db.tickets, users: db.users.map(x => cleanUser(x, true))
    });
    if (can(u, "jobs")) pub.jobTemplates = db.jobTemplates;
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
    await m.sendMail({ from: `"MAM & MAM Overseas Ltd." <${mailFrom()}>`, to: u.email, subject: `Your verification code: ${u.verify.code}`,
      text: `Assalamu Alaikum ${u.name},\n\nYour MAM & MAM Overseas Ltd. verification code is ${u.verify.code}.\nIt expires in 30 minutes.\n\nIf you did not create an account, ignore this email.\n\nMAM & MAM Overseas Ltd. · RL 1217` });
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
  ctx.login(x); return { msg: `Signed in as ${x.name}` };
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
  if (role === "agent") { must(str(d.business).length >= 2, "Enter your business name."); nu.agent = { business: str(d.business, 150), phone: str(d.aphone, 30), district: "", address: "", docs: {} }; notifyAdmins(`New agent registration: ${nu.agent.business}.`, "users"); }
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
A["track.lookup"] = async ({ passport, phone }, u, ctx) => {
  limit(ctx.ip, "track", 30, 3600e3);
  const P = str(passport, 30).toUpperCase(); const dg = v => String(v || "").replace(/\D/g, ""); const pm = (a, b) => dg(a).length >= 6 && dg(b).length >= 6 && dg(a).slice(-6) === dg(b).slice(-6);
  if (!P) return { result: false };
  const strip = c => ({ id: c.id, country: c.country, status: c.status, history: c.history, created: c.created, card: c.card ? { sentAt: c.card.sentAt } : null });
  const appView = a => { const j = job(a.jobId); return { id: a.id, status: a.status, history: a.history, appliedAt: a.appliedAt, job: j ? { title: j.title, city: j.city, country: j.country } : null }; };
  const w = db.workers.find(x => x.passport.toUpperCase() === P && pm(x.phone, phone));
  if (w) return { result: { name: w.name, passport: w.passport, clearances: db.clearances.filter(c => c.workerId === w.id).map(strip), apps: db.applications.filter(a => a.workerId === w.id).map(appView), tickets: db.tickets.filter(t => t.workerId === w.id).map(t => ({ id: t.id, from: t.from, to: t.to, status: t.status, prefDate: t.prefDate, airline: t.airline, pnr: t.pnr, flightDate: t.flightDate })) } };
  const c = db.users.find(x => x.role === "candidate" && (x.profile?.passportNo || "").toUpperCase() === P && pm(x.profile?.phone, phone));
  if (c) return { result: { name: c.name, passport: c.profile.passportNo, clearances: db.clearances.filter(x => x.candidateId === c.id).map(strip), apps: db.applications.filter(a => a.candidateId === c.id).map(appView), tickets: [] } };
  return { result: false };
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
  needRole(u, "candidate"); must(COUNTRIES[d.country], "Select a country.");
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
    benefits: (d.benefits || []).map(x => str(x, 40)).slice(0, 10), description: str(d.description, 5000), requirements: str(d.requirements, 3000) };
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
  needRole(u, "agent"); const w = worker(d.workerId); must(w && w.agentId === u.id, "Choose one of your workers."); must(COUNTRIES[d.country], "Select a country.");
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
  db.ledger.push({ id: id("l"), agentId: u.id, type: "payment", desc: str(d.desc, 200) || "Payment sent by agent", amount, date: str(d.date, 10) || now().slice(0, 10), method: str(d.method, 40), ref: str(d.ref, 80), status: "pending" });
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
  try { await m.sendMail({ from: `"MAM & MAM Overseas Ltd." <${mailFrom()}>`, to: u.email, subject: "Test email from your website", text: "Email sending works. Job seekers will now receive their verification codes." }); }
  catch (e) { throw new Fail(`Sending failed: ${e.message}`); }
  return { msg: `Test email sent to ${u.email}.` };
};

/* ---- admin & staff ---- */
A["admin.userState"] = async ({ id: xid, status }, u) => {
  needPerm(u, "users"); const x = user(xid); must(x && x.id !== u.id, "Not allowed."); must(["active", "suspended"].includes(status), "Unknown status.");
  must(u.role === "admin" || !["admin", "staff"].includes(x.role), "Only the admin can change admin or staff accounts.", 403);
  x.status = status; if (status === "active") notify(x.id, "Your account has been approved.");
  if (status === "suspended") for (const [t, s] of Object.entries(db.sessions)) if (s.uid === x.id) delete db.sessions[t];
  return { msg: `Account ${status === "active" ? "activated" : "suspended"}.` };
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
A["admin.clStatus"] = async ({ id: cid, status }, u) => {
  needPerm(u, "clearance"); const c = db.clearances.find(x => x.id === cid); must(c, "File not found."); must([...CL_STAGES, "rejected"].includes(status), "Unknown status.");
  if (c.status === status) return {};
  c.status = status; c.history.push({ s: status, at: now() });
  const name = c.workerId ? worker(c.workerId)?.name : c.fullName || user(c.candidateId)?.name;
  notify(c.agentId || c.candidateId, `BMET clearance for ${name}: ${LABEL[status]}.${status === "approved" ? " The clearance card will be sent to your portal." : ""}`);
  return { msg: `Clearance status: ${LABEL[status]}. ${c.agentId ? "Agent" : "Job seeker"} notified.` };
};
A["admin.card"] = async ({ id: cid, file, fee }, u) => {
  needPerm(u, "clearance"); const c = db.clearances.find(x => x.id === cid); must(c && c.status === "approved", "Upload the card after the file is Approved.");
  const owner = c.agentId || c.candidateId; const ref = storeFile(file, owner);
  const replacing = !!c.card; const f = replacing ? Number(c.card.fee || 0) : numv(fee, 0, 1e7);
  if (c.card) dropFile(c.card);
  const isCand = !c.agentId;
  c.card = { ...ref, fee: f, feeNote: isCand && f > 0 ? (c.card?.feePaid ? "paid" : "pay at the office") : "", sentAt: now(), feePaid: c.card?.feePaid || false };
  const name = c.workerId ? worker(c.workerId)?.name : c.fullName;
  if (!replacing && f > 0 && c.agentId) db.ledger.push({ id: id("l"), agentId: c.agentId, type: "charge", desc: `BMET clearance card fee: ${name}`, amount: f, date: now().slice(0, 10), method: "", ref: "", status: "confirmed" });
  notify(owner, `${replacing ? "Updated clearance card" : "Clearance card"} for ${name} is ready. Download it from your portal${f > 0 && !replacing ? `. Card fee: ${bdt(f)}` : ""}.`);
  return { msg: `Clearance card sent to the ${c.agentId ? "agent" : "job seeker"}.` };
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
A["admin.ledgerAdd"] = async (d, u) => {
  needPerm(u, "ledger"); const ag = user(d.agentId); must(ag?.role === "agent", "Choose an agent."); const amount = numv(d.amount, 0, 1e8); must(amount >= 1 && str(d.desc), "Enter the amount and description.");
  db.ledger.push({ id: id("l"), agentId: ag.id, type: d.type === "payment" ? "payment" : "charge", desc: str(d.desc, 200), amount, date: str(d.date, 10) || now().slice(0, 10), method: str(d.method, 40), ref: str(d.ref, 80), status: "confirmed" });
  notify(ag.id, d.type === "charge" ? `New charge on your account: ${str(d.desc, 100)} (${bdt(amount)}).` : `Payment of ${bdt(amount)} recorded.`);
  return { msg: "Entry added." };
};
A["admin.ledgerConfirm"] = async ({ id: lid, ok }, u) => {
  needPerm(u, "ledger"); const l = db.ledger.find(x => x.id === lid); must(l && l.status === "pending", "Entry not found.");
  l.status = ok ? "confirmed" : "rejected";
  notify(l.agentId, ok ? `Payment of ${bdt(l.amount)} confirmed. New balance: ${bdt(balanceOf(l.agentId))}.` : `Payment of ${bdt(l.amount)} (ref ${l.ref || "—"}) could not be confirmed. Contact the office.`);
  return { msg: ok ? "Payment confirmed." : "Payment marked as not received." };
};
A["admin.ledgerDelete"] = async ({ id: lid }, u) => { needPerm(u, "ledger"); db.ledger = db.ledger.filter(l => l.id !== lid); return { msg: "Entry deleted." }; };
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
    const email = str(d.email, 200).toLowerCase(); must(str(d.name) && emailOk(email), "Enter the name and a valid email."); must(String(d.pass || "").length >= 8, "Password must be at least 8 characters.");
    must(!db.users.some(x => x.email === email), "An account with this email already exists.");
    db.users.push({ id: id("u"), role: "staff", name: str(d.name, 120), email, pass: hashPass(String(d.pass)), status: "active", created: now(), perms }); return { msg: "Staff account created." };
  }
  if (d.op === "perms") { const x = user(d.id); must(x?.role === "staff", "Staff member not found."); x.perms = perms; return {}; }
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
  if (u && !zoneAllows(zone, u)) { token = null; u = null; } // a session from the other site does not count here
  if (req.method === "GET" && url.pathname === "/api/state") return send(res, 200, viewFor(u));
  if (req.method === "GET" && url.pathname.startsWith("/api/files/")) {
    const f = db.files[url.pathname.slice(11)];
    if (!f || !mayRead(u, f)) return send(res, 404, { error: "File not found." });
    const inline = f.mime.startsWith("image/") || url.searchParams.get("inline") === "1";
    res.writeHead(200, { ...baseHeaders, "Content-Type": f.mime, "Content-Length": f.size, "Cache-Control": f.public ? "public, max-age=86400" : "private, max-age=300",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${f.name.replace(/"/g, "")}"`, "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" });
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
        setCookie.push(`mam_s=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure(req) ? "; Secure" : ""}`); },
      logout: () => { if (token) delete db.sessions[token]; ctx.user = null; setCookie.push(`mam_s=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure(req) ? "; Secure" : ""}`); },
      user: u
    };
    try {
      const out = (await fn(body.payload || {}, u, ctx)) || {};
      for (const [t, s] of Object.entries(db.sessions)) if (Date.parse(s.exp) < Date.now()) delete db.sessions[t];
      save();
      if (ctx.redirect) out.redirect = ctx.redirect;
      return send(res, out.error ? 400 : 200, { ...out, state: viewFor(ctx.user) }, setCookie.length ? { "Set-Cookie": setCookie } : {});
    } catch (e) {
      if (!(e instanceof Fail)) { console.error(body.type, e); try { save(); } catch { /* ignore */ } }
      return send(res, e.code || 500, { error: e instanceof Fail ? e.message : "Something went wrong. Please try again.", state: viewFor(ctx.user) }, setCookie.length ? { "Set-Cookie": setCookie } : {});
    }
  }
  if (url.pathname === "/api/health") return send(res, 200, { ok: true });
  return send(res, 404, { error: "Not found." });
}

/* /job/<id>: the address people share. Crawlers (Facebook, WhatsApp) read the Open Graph tags; browsers open the job in the app. */
const escHtml = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const siteOrigin = req => `${req.headers["x-forwarded-proto"] || "http"}://${req.headers["x-forwarded-host"] || req.headers.host}`;
/* index.html with absolute addresses in the share tags (Facebook and WhatsApp need full URLs for the logo preview) */
function indexHtml(req) {
  const zone = hostZone(req);
  const site = { admin: zone === "admin", agent: zone === "agent", main: ADMIN_HOST || AGENT_HOST ? mainUrl() : "" }; // the admin panel's address is never sent to the public site
  const head = `<script>window.__SITE__=${JSON.stringify(site).replace(/</g, "\\u003c")}</script>${zone === "admin" || zone === "agent" ? '<meta name="robots" content="noindex, nofollow">' : ""}`;
  return fs.readFileSync(path.join(STATIC_DIR, "index.html"), "utf8").replace(/__ORIGIN__/g, escHtml(siteOrigin(req))).replace("</head>", head + "</head>");
}
function serveJobShare(req, res, jid) {
  const idx = path.join(STATIC_DIR, "index.html"); if (!fs.existsSync(idx)) return send(res, 503, "Site files are missing.", { "Content-Type": "text/plain" });
  let html = indexHtml(req); const j = job(jid);
  if (j && j.status === "active") {
    const origin = siteOrigin(req);
    const company = user(j.employerId)?.company?.name || j.employerName;
    const title = `${j.title} – ${j.city}, ${j.country} | MAM & MAM Overseas Ltd.`;
    const desc = `${j.currency} ${Number(j.salaryMin).toLocaleString("en-US")}–${Number(j.salaryMax).toLocaleString("en-US")}/${j.period === "hour" ? "hour" : "month"} · ${j.vacancies} vacancies${company ? ` · ${company}` : ""}${j.deadline ? ` · Apply by ${j.deadline}` : ""}. Licensed recruiting agency RL 1217.`;
    const tags = [`<title>${escHtml(title)}</title>`, `<meta name="description" content="${escHtml(desc)}">`, `<meta property="og:type" content="website">`, `<meta property="og:site_name" content="MAM &amp; MAM Overseas Ltd.">`,
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
