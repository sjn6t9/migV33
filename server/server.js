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
  if (x.photo) x.photo = fileRef(x.photo);
  if (x.profile) x.profile = { ...x.profile, photo: fileRef(x.profile.photo), passportFile: fileRef(x.profile.passportFile), cv: fileRef(x.profile.cv) };
  if (x.agent?.docs) x.agent = { ...x.agent, docs: Object.fromEntries(Object.entries(x.agent.docs).map(([k, v]) => [k, fileRef(v)])) };
  if (!full) { delete x.email; if (x.profile) delete x.profile.passportFile; if (x.agent) x.agent = { business: x.agent.business, phone: x.agent.phone }; delete x.perms; }
  return x;
};
const cleanCl = c => ({ ...c, files: c.files ? { passport: fileRef(c.files.passport), visa: fileRef(c.files.visa), contract: fileRef(c.files.contract), others: (c.files.others || []).map(fileRef) } : c.files, card: c.card ? { ...c.card, data: `/api/files/${c.card.id}` } : null, payment: c.payment ? { ...c.payment, file: fileRef(c.payment.file) } : null });

function viewFor(u) {
  const live = db.jobs.filter(j => j.status === "active");
  const pub = { build: BUILD,
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
    pub.tickets = db.tickets.filter(t => t.candidateId === u.id); pub.flightsReady = !!db.wftt?.token;
    pub.myPassports = myPassports(u);
  } else if (u.role === "employer") {
    const mine = db.jobs.filter(j => j.employerId === u.id);
    pub.jobs = [...live.filter(j => j.employerId !== u.id), ...mine];
    pub.applications = db.applications.filter(a => mine.some(j => j.id === a.jobId));
    addUsers(pub.applications.map(a => user(a.candidateId)).filter(Boolean));
    addUsers(pub.applications.filter(a => a.agentId).map(a => user(a.agentId)), false);
    pub.workers = db.workers.filter(w => pub.applications.some(a => a.workerId === w.id)).map(w => ({ id: w.id, agentId: w.agentId, name: w.name, trade: w.trade, experience: w.experience, district: w.district }));
    pub.orders = db.orders.filter(o => o.uid === u.id);
  } else if (u.role === "agent") {
    pub.workers = db.workers.filter(w => w.agentId === u.id); pub.raimsReady = !!db.raims?.pass;
    pub.clearances = db.clearances.filter(c => c.agentId === u.id).map(cleanCl);
    pub.applications = db.applications.filter(a => a.agentId === u.id);
    pub.jobs = db.jobs.filter(j => j.status === "active" || pub.applications.some(a => a.jobId === j.id));
    pub.tickets = db.tickets.filter(t => t.agentId === u.id); pub.flightsReady = !!db.wftt?.token;
    pub.leaders = leaders().map(({ k, name, title }) => ({ k, name, title })); // agents can say they paid one of them
    pub.ledger = db.ledger.filter(l => l.agentId === u.id);
    pub.passports = db.passports.filter(p => p.agentId === u.id).map(({ by, ...p }) => p); // passports the office entered with this agent as reference
  } else if (u.role === "admin" || u.role === "staff") {
    Object.assign(pub, {
      jobs: db.jobs, applications: db.applications, orders: db.orders, messages: can(u, "messages") ? db.messages : [], workers: db.workers,
      clearances: db.clearances.map(cleanCl), ledger: db.ledger, tickets: db.tickets, users: db.users.map(x => cleanUser(x, true))
    });
    if (can(u, "jobs")) pub.jobTemplates = db.jobTemplates;
    if (can(u, "office")) pub.office = { entries: db.office.entries, auto: officeAuto(), leaders: leaders(), from: db.office.from || "" };
    { const me = leaders().find(x => x.uid === u.id); if (isStaffRole(u)) { const ow = me ? me.k : `u:${u.id}`; pub.myKhata = db.khata.filter(x => x.owner === ow); } if (me) pub.myMoney = { entries: [...db.office.entries.filter(e => e.people?.includes(me.k)), ...officeAuto().filter(e => personOf(e.method) === me.k)], me }; }
    if (can(u, "ledger") || can(u, "office") || can(u, "receipts")) pub.leaders = leaders().map(({ k, name, title }) => ({ k, name, title }));
    if (can(u, "clearance") || u.role === "agent") pub.raimsReady = !!db.raims?.pass;
    if (can(u, "tickets")) { pub.wftt = db.wftt ? { ...(u.role === "admin" ? { email: db.wftt.email } : {}), since: db.wftt.since || null, ready: !!db.wftt.token, markup: Number(db.settings.ticketMarkup || 0) } : null; pub.flightsReady = !!db.wftt?.token; }
    if (can(u, "clearance")) pub.raims = db.raims ? { ...(u.role === "admin" ? { email: db.raims.email } : {}), auto: db.raims.auto, saved: !!db.raims.pass, since: db.raims.since || null, last: db.raims.last || null } : null;
    if (PP_PERMS.some(k => can(u, k))) { pub.passports = db.passports; pub.agentBook = db.agentBook; pub.bookMatch = Object.fromEntries(db.users.filter(x => x.role === "agent" && x.status !== "active").map(x => [x.id, bookMatches(x).map(b => b.name)]).filter(([, v]) => v.length)); }
    if (can(u, "visa")) pub.visa = db.visa;
    if (isStaffRole(u)) pub.attendance = attView(u, u.role === "admin");
    if (can(u, "headlines")) pub.headlinesAll = db.headlines || [];
    if (isStaffRole(u)) pub.mySalary = { monthly: db.salary.profiles[u.id]?.monthly ?? null, pays: db.salary.pays.filter(p => p.uid === u.id).map(p => salaryOut(p)) };
    if (can(u, "salary")) pub.salary = { profiles: db.salary.profiles, pays: db.salary.pays.map(p => salaryOut(p)) };
    if (can(u, "office") || can(u, "receipts") || can(u, "ledger")) pub.khata = db.khata.filter(x => !x.owner);
    if (can(u, "receipts") || can(u, "ledger")) pub.dueReceipts = (db.dueReceipts?.list || []).slice(0, 3000).map(x => ({ ...x, received: { ...x.received, sigUrl: x.received?.sig && db.files[x.received.sig] ? `/api/files/${x.received.sig}` : "" } }));
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
  // the agent panel takes new agent accounts only; the admin panel takes none
  must(ctx.zone !== "admin" && (ctx.zone !== "agent" || d.role === "agent"), zoneMsg(ctx.zone), 403);
  limit(ctx.ip, "register", 6, 3600e3);
  const role = ctx.zone === "agent" ? "agent" : ["candidate", "employer", "agent"].includes(d.role) ? d.role : "candidate";
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
  if (role === "agent") { // an agent confirms the email with a 6-digit code first; the agency is told once it is confirmed
    must(str(d.business).length >= 2, "Enter your business name."); must(str(d.aphone, 30).replace(/\D/g, "").length >= 10, "Enter a valid mobile number, e.g. 01XXXXXXXXX.");
    nu.agent = { business: str(d.business, 150), phone: str(d.aphone, 30), district: "", address: "", docs: {} }; nu.status = "unverified";
    newCode(nu); db.users.push(nu);
    const sent = await sendCode(nu);
    return { verify: nu.id, email, sent, ...(SHOW_CODES ? { code: nu.verify.code } : {}) };
  }
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
  x.emailVerified = now(); delete x.verify;
  if (x.role === "agent") { // email confirmed: the agency checks and approves the agent next
    x.status = "pending";
    notifyAdmins(`New agent registration: ${x.agent?.business || x.name}.${(m => m.length ? ` Matches the Agents list: ${m.map(b => b.name).join(", ")} (joined on approval).` : "")(bookMatches(x))}`, "users");
    notify(x.id, "Welcome! Your email is confirmed. Your account will be activated after the agency approves it.");
    ctx.login(x); return { msg: "Email verified. The agency will approve your account soon." };
  }
  x.status = "active"; ctx.login(x); return { msg: "Email verified." };
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
A["notif.read"] = async (d, u) => { must(u, "Sign in first.", 401); const n = db.notifications.find(x => x.id === d.id && x.uid === u.id); if (n) n.read = true; return {}; };
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
  must(u, "Sign in to track your file.", 401);
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
  const pre = d.preEc && typeof d.preEc === "object" ? d.preEc : null; // filed from Pre EC Check: the employer is not asked
  if (!d.workerId && d.newWorker) { const own = db.workers.find(x => x.agentId === u.id && x.passport.replace(/\s+/g, "").toUpperCase() === str(d.newWorker.passport, 30).replace(/\s+/g, "").toUpperCase()); if (own) d.workerId = own.id; }
  if (!d.workerId && d.newWorker) { // a worker typed into the application form is added to "My workers" first
    const nw = d.newWorker, pass = str(nw.passport, 30).toUpperCase();
    must(str(nw.name).length >= 2 && pass, "Enter the worker's name and passport number.");
    must(!db.workers.some(x => x.passport.toUpperCase() === pass), `A worker with passport ${pass} is already registered. Choose them from your workers.`);
    must(clCountryOk(d.country), "Select a country."); must(d.files?.passport && d.files?.visa, "Upload the passport copy and visa copy."); must(pre || str(d.employer), "Enter the employer / sponsor name.");
    const nwr = { id: id("w"), agentId: u.id, name: str(nw.name, 120), father: "", passport: pass, passportExpiry: "", dob: "", phone: str(nw.phone, 30), district: "", trade: str(nw.trade, 80), experience: 0, created: now() };
    db.workers.push(nwr); d.workerId = nwr.id;
  }
  const w = worker(d.workerId); must(w && w.agentId === u.id, "Choose one of your workers."); must(clCountryOk(d.country), "Select a country.");
  must(!db.clearances.some(c => c.workerId === w.id && c.status !== "rejected"), "This worker already has an open clearance file.");
  must(d.files?.passport && d.files?.visa, "Upload the passport copy and visa copy."); must(pre || str(d.employer), "Enter the employer / sponsor name.");
  const others = Array.isArray(d.files.others) ? d.files.others.filter(Boolean).slice(0, 3) : [];
  const files = { passport: storeFile(d.files.passport, u.id), visa: storeFile(d.files.visa, u.id), contract: d.files.contract ? storeFile(d.files.contract, u.id) : null, others: others.map(f => storeFile(f, u.id)) };
  const docs = ["Passport copy", "Visa copy", ...(files.contract ? ["Employment contract"] : []), ...(files.others.length ? ["Other documents"] : [])];
  if (pre) { // the RAIMS details from Pre EC Check go with the worker
    const b = pre.bmet && typeof pre.bmet === "object" ? pre.bmet : {};
    if (!w.father && b.father) w.father = str(b.father, 120); if (!w.dob && b.dob) w.dob = str(b.dob, 20); if (!w.phone && b.mobile) w.phone = str(b.mobile, 30);
  }
  db.clearances.push({ id: id("c"), via: "agent", ...(pre ? { preEc: true } : {}), agentId: u.id, workerId: w.id, candidateId: null, country: d.country, employer: str(d.employer, 150), visaNo: str(d.visaNo, 40), visaType: str(d.visaType, 40), flightDate: str(d.flightDate, 10), docs, files, notes: str(d.notes, 2000), status: "pending", history: [{ s: "pending", at: now() }], created: now() });
  { const c = db.clearances[db.clearances.length - 1]; c.ref = ecRef(c); }
  const fee = Number(db.settings.clearanceFee || 0);
  if (fee > 0) db.ledger.push(clCharge(u.id, db.clearances[db.clearances.length - 1], "BMET clearance processing", fee));
  notifyAdmins(`New BMET clearance application: ${w.name} (${d.country}) from ${u.agent.business}. See Applications › Clearance applications.`, "clearance");
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
  for (const r of rows) await A["admin.clearance"]({ bulk: true, agentId: r.agentId || "", agentName: r.agentName, newWorker: { name: r.name, passport: r.passport, phone: r.phone }, icNo: r.icNo, raimsId: r.raimsId, fee: r.fee, due: r.due, country: d.country, employer: d.employer, visaType: d.visaType, flightDate: d.flightDate, notes: d.notes }, u);
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
  const c = { id: id("c"), agentId: ag ? ag.id : null, ...(ag ? {} : { agentName }), workerId: w.id, candidateId: null, country: d.country, employer: str(d.employer, 150), visaNo: str(d.visaNo, 40), visaType: str(d.visaType, 40), flightDate: str(d.flightDate, 10), icNo: str(d.icNo, 40), ...(/^\d{4,12}$/.test(String(d.raimsId || "")) ? { raimsId: String(d.raimsId) } : {}), fee, due, docs, files, notes: str(d.notes, 2000), status: "pending", history: [{ s: "pending", at: now() }], created: now(), by: u.id };
  // a RAIMS IC number given with the file becomes its reference number; one IC covers every worker of that RAIMS application, so files can share it
  const icRef = c.icNo.replace(/\s+/g, "").toUpperCase();
  db.clearances.push(c); c.ref = /^IC[-A-Z0-9/]{3,39}$/.test(icRef) ? icRef : ecRef(c);
  if (ag && fee > 0) db.ledger.push(clCharge(ag.id, c, "BMET clearance processing", fee));
  if (ag && due > 0) db.ledger.push(clCharge(ag.id, c, "Previous due", due));
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
const TITLES = ["MR", "MRS", "MS", "MSTR", "MISS"];
/* Book Now: the travellers' details as the airline needs them (WFTT form), passport copy required, visa copy optional (each up to 2.5 MB) */
function ticketTravellers(list, owner) {
  must(Array.isArray(list) && list.length >= 1 && list.length <= 9, "Fill in the travellers.");
  const small = (f, what, at) => { must(f?.data, `Upload the ${what}${at}.`); must(Math.floor((f.data.length - f.data.indexOf(",") - 1) * 3 / 4) <= 2.5 * 1024 * 1024 + 1024, `The ${what}${at} is larger than 2.5 MB.`); return storeFile(f, owner); };
  return list.map((x, i) => {
    const at = list.length > 1 ? ` (traveller ${i + 1})` : "";
    const t = { title: TITLES.includes(x.title) ? x.title : "MR", given: str(x.given, 60).toUpperCase(), surname: str(x.surname, 60).toUpperCase(), dob: str(x.dob, 10), nationality: str(x.nationality, 60) || "BANGLADESH", passport: str(x.passport, 20).replace(/\s+/g, "").toUpperCase(), expiry: str(x.expiry, 10), type: ["ADT", "CHD", "INF"].includes(x.type) ? x.type : "ADT" };
    must(t.given && t.surname, `Enter the given name and surname${at}.`); must(/^\d{4}-\d{2}-\d{2}$/.test(t.dob), `Enter the date of birth${at}.`);
    must(/^[A-Z0-9]{6,15}$/.test(t.passport), `Enter the passport number${at}.`); must(/^\d{4}-\d{2}-\d{2}$/.test(t.expiry), `Enter the passport expiry date${at}.`);
    t.passportFile = small(x.passportFile, "passport copy", at); if (x.visaFile?.data) t.visaFile = small(x.visaFile, "visa copy", at);
    return t;
  });
}
A["agent.ticket"] = async (d, u) => {
  needRole(u, "agent"); must(str(d.from) && str(d.to) && str(d.prefDate), "Fill in the route and date.");
  const trav = d.travellers ? ticketTravellers(d.travellers, u.id) : null;
  const w = d.workerId ? worker(d.workerId) : null; must(trav || (w && w.agentId === u.id), "Choose one of your workers."); if (w) must(w.agentId === u.id, "Choose one of your workers.");
  const fl = flightSnap(d.flight);
  const lead = trav?.[0];
  db.tickets.push({ id: id("t"), agentId: u.id, workerId: w?.id || null, ...(trav ? { travellers: trav, name: `${lead.title} ${lead.given} ${lead.surname}${trav.length > 1 ? ` +${trav.length - 1}` : ""}`, passport: lead.passport } : {}), from: str(d.from, 80), to: str(d.to, 80), prefDate: str(d.prefDate, 10), returnDate: str(d.returnDate, 10), pax: str(d.pax, 60), notes: str(d.notes, 500), ...(fl ? { flight: fl } : {}), status: "requested", fare: "", pnr: "", airline: "", flightDate: "", created: now() });
  notifyAdmins(`Air ticket booking: ${w?.name || `${lead.given} ${lead.surname}`}, ${str(d.from, 80)} → ${str(d.to, 80)}${fl ? ` (${fl.airline}, ৳ ${fl.price})` : ""} (${u.agent.business}).`, "tickets");
  return { msg: "Booking request sent. The agency will book the ticket and confirm." };
};
/* ======================= Air tickets: live fares from WFTT BD (b2b.wfttbd.com), the agency's own B2B account =======================
   The admin signs in once (email + password, kept sealed on this server); the server keeps the 15-minute token fresh.
   Agents and job seekers search flights here and send a request; the agency books it in WFTT. */
const WFTT = process.env.WFTT_BASE || "https://wftt-server.m360ictapi.com/api/v1";
const wfJar = () => { const J = jar(); try { if (db.wftt?.cookies) Object.assign(J.c, JSON.parse(unseal(db.wftt.cookies))); } catch {} return J; };
const jwtExp = t => { try { return JSON.parse(Buffer.from(String(t).split(".")[1], "base64url").toString()).exp * 1000; } catch { return 0; } };
async function wfReq(path, opt = {}, J = wfJar()) {
  const r = await fetch(WFTT + path, { ...opt, headers: { "User-Agent": "Mozilla/5.0 (MAM Overseas portal)", Accept: "application/json", Origin: "https://b2b.wfttbd.com", Referer: "https://b2b.wfttbd.com/", ...(opt.headers || {}), ...(J.get() ? { Cookie: J.get() } : {}) }, signal: opt.signal || AbortSignal.timeout(30000) });
  J.set(r); return { r, J };
}
function wfKeep(J, token) { db.wftt.token = seal(token); db.wftt.cookies = seal(JSON.stringify(J.c)); db.wftt.since = db.wftt.since || now(); save(); }
async function wfLogin() {
  must(db.wftt?.pass, "WFTT is not signed in. The admin signs in from Air tickets › WFTT.");
  const { r, J } = await wfReq("/auth/agent/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: db.wftt.email, password: unseal(db.wftt.pass) }) }, jar());
  const j = await r.json().catch(() => ({}));
  must(r.ok && j.success !== false, `WFTT sign-in failed: ${j.message || r.status}`);
  must(j.token, j.data?.twoFA ? "WFTT asks for an email code (two-step sign-in). Turn it off in WFTT, or sign in again here when asked." : "WFTT gave no sign-in token.");
  wfKeep(J, j.token); return j.token;
}
let wfBusy = null;
async function wfToken() {
  must(db.wftt?.email, "WFTT is not signed in. The admin signs in from Air tickets › WFTT.");
  let t = ""; try { t = db.wftt.token ? unseal(db.wftt.token) : ""; } catch {}
  if (t && jwtExp(t) - Date.now() > 30e3) return t;
  if (wfBusy) return wfBusy;
  wfBusy = (async () => {
    if (t) try { const J = wfJar(); const { r } = await wfReq("/auth/agent/refresh", { method: "POST", headers: { Authorization: `Bearer ${t}` } }, J); const j = await r.json().catch(() => ({})); if (r.ok && j.token) { wfKeep(J, j.token); return j.token; } } catch {}
    return await wfLogin();
  })().finally(() => { wfBusy = null; });
  return wfBusy;
}
setInterval(() => { if (db.wftt?.token) wfToken().catch(() => {}); }, 10 * 60e3).unref(); // keep the WFTT sign-in alive
const AIRPORTS = new Map();
A["flight.airports"] = async (d, u) => {
  must(u, "Sign in first.", 401); const q = str(d.q, 40).trim(); if (q.length < 2) return { list: [] };
  const k = q.toLowerCase(); if (AIRPORTS.has(k)) return { list: AIRPORTS.get(k) };
  const { r } = await wfReq(`/common/airport?name=${encodeURIComponent(q)}`, {}, jar()); const j = await r.json().catch(() => ({}));
  const list = (j.data || []).slice(0, 15).map(a => ({ code: a.iata_code, name: a.name, city: a.city_name, country: a.country }));
  AIRPORTS.set(k, list); if (AIRPORTS.size > 500) AIRPORTS.delete(AIRPORTS.keys().next().value); return { list };
};
const FLIGHTS = new Map(); // search results kept 15 minutes, so a request can point at the flight that was shown
const fmtFlight = (x, staff) => {
  const pax = (x.passengers || []).reduce((t, p) => t + Number(p.number || 0), 0) || 1;
  const mark = Number(db.settings.ticketMarkup || 0) * pax, gross = Math.round(Number(x.fare?.total_price || x.fare?.vendor_fare?.gross_fare || x.fare?.payable || 0));
  const avail = x.availability || [];
  const legs = (x.flights || []).map((f, li) => ({ stops: f.stoppage ?? Math.max(0, (f.options || []).length - 1), minutes: f.elapsed_time || 0, layovers: (f.layover_time || []).slice(0, Math.max(0, (f.options || []).length - 1)),
    segs: (f.options || []).map((o, si) => { const pa = avail[li]?.segments?.[si]?.passenger?.[0] || {}; return {
      from: o.departure?.airport_code, fromCity: String(o.departure?.city || "").split(" - ")[0], fromAirport: o.departure?.airport || "", fromTerm: o.departure?.terminal || "", dep: `${o.departure?.date || ""} ${String(o.departure?.time || "").slice(0, 5)}`,
      to: o.arrival?.airport_code, toCity: String(o.arrival?.city || "").split(" - ")[0], toAirport: o.arrival?.airport || "", toTerm: o.arrival?.terminal || "", arr: `${o.arrival?.date || ""} ${String(o.arrival?.time || "").slice(0, 5)}`,
      flight: `${o.carrier?.carrier_marketing_code || ""}${o.carrier?.carrier_marketing_flight_number || ""}`, flightNo: `${o.carrier?.carrier_marketing_code || ""}-${o.carrier?.carrier_marketing_flight_number || ""}`,
      airline: o.carrier?.carrier_marketing_airline || x.carrier_name, operator: o.carrier?.carrier_operating_airline && o.carrier.carrier_operating_airline !== o.carrier?.carrier_marketing_airline ? o.carrier.carrier_operating_airline : "",
      aircraft: o.carrier?.carrier_aircraft_name || o.carrier?.carrier_aircraft_code || "", minutes: o.elapsedTime || 0,
      cabin: pa.cabin_type || "", rbd: pa.booking_code || "", bag: pa.baggage_count != null ? `${pa.baggage_count} ${String(pa.baggage_unit || "").toUpperCase()}` : "" }; }) }));
  const pa0 = avail[0]?.segments?.[0]?.passenger?.[0];
  const seats = Math.min(...avail.flatMap(a => (a.segments || []).flatMap(g => (g.passenger || []).map(p => Number(p.available_seat)).filter(n => n > 0))), 99);
  // fare per traveller type: the price the customer sees (gross), with the service charge on top
  const fares = (x.passengers || []).map(p => ({ type: p.type, n: Number(p.number || 1), base: Math.round(Number(p.fare?.base_fare || 0)), tax: Math.round(Number(p.fare?.tax || 0)), total: Math.round(Number(p.fare?.total_fare || 0)) }));
  return { id: x.flight_id, airline: x.carrier_name, code: x.carrier_code, logo: x.carrier_logo ? `https://m360-trabill.s3.ap-south-1.amazonaws.com/wftt-storage/${x.carrier_logo}` : "",
    refundable: !!x.refundable, baggage: pa0?.baggage_count != null ? `${pa0.baggage_count} ${String(pa0.baggage_unit || "").toUpperCase()}` : "", cabin: pa0?.cabin_type || "", rbd: pa0?.booking_code || "", seats: seats < 99 ? seats : null, legs, price: gross + mark, pax,
    fare: { base: Math.round(Number(x.fare?.base_fare || 0)), tax: Math.round(Number(x.fare?.total_tax || 0)), service: mark, total: gross + mark, perPax: fares },
    ...(staff ? { net: Math.round(Number(x.fare?.payable || 0)), gross, discount: Math.round(Number(x.fare?.discount || 0)), ait: Math.round(Number(x.fare?.ait || 0)), api: x.api } : {}) };
};
A["flight.rules"] = async (d, u) => { // the refund / re-issue policy of one flight (WFTT fare rules)
  must(u, "Sign in first.", 401); const fid = str(d.flightId, 60), sid = str(d.searchId, 60); must(/^[\w-]{2,80}$/.test(fid) && /^[\w-]{2,80}$/.test(sid), "Search again.");
  const token = await wfToken();
  const { r } = await wfReq(`/btoc/multi-api/flight/fare-rules?flight_id=${encodeURIComponent(fid)}&search_id=${encodeURIComponent(sid)}`, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json().catch(() => ({})); must(r.ok && j.success !== false, j.message || "The policy is not available for this flight.");
  const t = typeof j.data === "string" ? j.data : JSON.stringify(j.data || "");
  const text = t.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|li|div|h\d|tr)>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .split("\n").map(l => l.replace(/[ \t]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text: text.slice(0, 6000) };
};
A["flight.search"] = async (d, u) => {
  must(u && (u.role === "candidate" || (u.role === "agent" && u.status === "active") || can(u, "tickets")), "Sign in to search flights.", 401);
  limit(u.id, "flight", u.role === "candidate" ? 30 : 120, 3600e3);
  const code = v => { const c = String(v || "").toUpperCase().match(/\b([A-Z]{3})\b/g); return c ? c[c.length - 1] : ""; };
  const from = code(d.from), to = code(d.to), dep = str(d.date, 10), ret = str(d.returnDate, 10);
  must(from && to && from !== to, "Choose the From and To airports."); must(/^\d{4}-\d{2}-\d{2}$/.test(dep) && dep >= now().slice(0, 10), "Choose the travel date.");
  must(!ret || (/^\d{4}-\d{2}-\d{2}$/.test(ret) && ret >= dep), "The return date must be after the travel date.");
  const n = (v, a, b) => Math.max(a, Math.min(b, Math.floor(Number(v) || 0)));
  const adults = n(d.adults || 1, 1, 9), children = n(d.children, 0, 8), infants = n(d.infants, 0, adults), cabin = { economy: "1", premium: "2", business: "3", first: "4" }[d.cabin] || "1";
  const leg = (rph, a, b, day) => ({ RPH: rph, DepartureDateTime: `${day}T00:00:00`, OriginLocation: { LocationCode: a }, DestinationLocation: { LocationCode: b }, TPA_Extensions: { CabinPref: { Cabin: cabin, PreferLevel: "Preferred" } } });
  const odi = [leg("1", from, to, dep), ...(ret ? [leg("2", to, from, ret)] : [])];
  const ptq = [{ Code: "ADT", Quantity: adults }, ...Array.from({ length: children }, () => ({ Code: "C08", Quantity: 1 })), ...(infants ? [{ Code: "INF", Quantity: infants }] : [])];
  const key = JSON.stringify([odi, ptq]), hit = FLIGHTS.get(key);
  let raw = hit && Date.now() - hit.at < 10 * 60e3 ? hit.raw : null, info = hit?.info || null;
  if (!raw) {
    const token = await wfToken();
    const q = `JourneyType=${ret ? 2 : 1}&airline_code=[]&PassengerTypeQuantity=${encodeURIComponent(JSON.stringify(ptq))}&OriginDestinationInformation=${encodeURIComponent(JSON.stringify(odi))}&token=${encodeURIComponent("Bearer " + token)}`;
    const { r } = await wfReq(`/btob/multi-api/flight/search/sse?${q}`, { headers: { Accept: "text/event-stream" }, signal: AbortSignal.timeout(60000) });
    must(r.ok, `WFTT search failed (${r.status}).`);
    raw = []; const dec = new TextDecoder(); let buf = "", ended = false; const t0 = Date.now();
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true }); let i;
      while ((i = buf.indexOf("\n\n")) >= 0) { const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = (/^event:\s*(.*)$/m.exec(block) || [])[1] || "message", data = block.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trimStart()).join("\n");
        if (ev === "end") { ended = true; break; } if (!data) continue;
        try { const j = JSON.parse(data); if (ev === "search_info") info = j; else if (ev === "message" && j.flight_id) raw.push(j); } catch {} }
      if (ended || Date.now() - t0 > 55e3 || raw.length > 400) break;
    }
    try { r.body.cancel?.(); } catch {}
    FLIGHTS.set(key, { at: Date.now(), raw, info }); if (FLIGHTS.size > 60) FLIGHTS.delete(FLIGHTS.keys().next().value);
  }
  const staff = u.role === "admin" || u.role === "staff";
  const list = raw.filter(x => !x.booking_block).map(x => fmtFlight(x, staff)).sort((a, b) => a.price - b.price).slice(0, 80);
  return { list, searchId: info?.search_id || "", q: { from, to, date: dep, returnDate: ret, adults, children, infants, cabin: d.cabin || "economy" }, total: raw.length };
};
const flightSnap = f => f && typeof f === "object" ? { id: str(f.id, 60), airline: str(f.airline, 80), code: str(f.code, 4), logo: /^https:\/\/m360-trabill\.s3\.[a-z0-9-]+\.amazonaws\.com\//.test(f.logo || "") ? String(f.logo).slice(0, 200) : "",
  refundable: !!f.refundable, baggage: str(f.baggage, 30), cabin: str(f.cabin, 30), rbd: str(f.rbd, 4), price: numv(f.price, 0, 1e8), searchId: str(f.searchId, 60),
  legs: (Array.isArray(f.legs) ? f.legs : []).slice(0, 4).map(l => ({ stops: numv(l.stops, 0, 9), minutes: numv(l.minutes, 0, 9999), segs: (Array.isArray(l.segs) ? l.segs : []).slice(0, 5).map(g => Object.fromEntries(["from", "fromCity", "fromAirport", "dep", "to", "toCity", "toAirport", "arr", "flight", "flightNo", "airline", "aircraft", "cabin", "bag"].map(k => [k, str(g[k], 80)]))) })) } : null;
A["cand.ticket"] = async (d, u) => {
  needRole(u, "candidate"); must(str(d.from) && str(d.to) && str(d.prefDate), "Fill in the route and date.");
  const name = str(d.name, 120) || u.name, passport = ppNorm(d.passport || u.profile?.passportNo || "");
  must(passport.length >= 6, "Enter your passport number."); limit(u.id, "candticket", 10, 3600e3);
  const fl = flightSnap(d.flight);
  db.tickets.push({ id: id("t"), candidateId: u.id, name, passport, phone: str(d.phone || u.profile?.phone, 30), from: str(d.from, 80), to: str(d.to, 80), prefDate: str(d.prefDate, 10), returnDate: str(d.returnDate, 10), pax: str(d.pax, 60), notes: str(d.notes, 500), ...(fl ? { flight: fl } : {}), status: "requested", fare: "", pnr: "", airline: "", flightDate: "", created: now() });
  notifyAdmins(`Air ticket request from job seeker ${name}: ${str(d.from, 80)} → ${str(d.to, 80)}${fl ? ` (${fl.airline}, ৳ ${fl.price})` : ""}.`, "tickets");
  return { msg: "Ticket request sent. The agency will confirm the fare and booking." };
};
A["cand.ticketCancel"] = async ({ id: tid }, u) => { const t = db.tickets.find(x => x.id === tid); must(u?.role === "candidate" && t && t.candidateId === u.id && t.status === "requested", "Not allowed.", 403); t.status = "cancelled"; return { msg: "Request cancelled." }; };
A["admin.wftt"] = async (d, u) => {
  needPerm(u, "tickets");
  if (d.op === "save") {
    must(u.role === "admin", "Only the admin can change the WFTT sign-in.", 403);
    const email = str(d.email, 200).trim().toLowerCase(); must(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), "Enter the WFTT email."); must(d.password || db.wftt?.pass, "Enter the WFTT password.");
    db.wftt = { email, pass: d.password ? seal(String(d.password).slice(0, 200)) : db.wftt.pass };
    await wfLogin(); return { msg: "Signed in to WFTT. Flight search is on for agents and job seekers." };
  }
  if (d.op === "logout") { must(u.role === "admin", "Only the admin can do this.", 403); try { const t = unseal(db.wftt?.token || ""); if (t) await wfReq("/btob/profile/logout", { method: "POST", headers: { Authorization: `Bearer ${t}` } }); } catch {} delete db.wftt; return { msg: "Signed out of WFTT. Flight search is off." }; }
  if (d.op === "markup") { must(u.role === "admin", "Only the admin can change this.", 403); db.settings.ticketMarkup = numv(d.markup, 0, 1e6); return { msg: `Service charge per ticket: ৳ ${db.settings.ticketMarkup}.` }; }
  must(false, "Unknown request.");
};
A["agent.ticketCancel"] = async ({ id: tid }, u) => { const t = db.tickets.find(x => x.id === tid); must(u?.role === "agent" && t && t.agentId === u.id && t.status === "requested", "Not allowed.", 403); t.status = "cancelled"; return { msg: "Request cancelled." }; };
A["agent.payment"] = async (d, u) => {
  must(u?.role === "agent", "Not allowed.", 403); const amount = numv(d.amount, 0, 1e8); must(amount >= 1, "Enter the amount.");
  // paid to the Managing Director / a Director / the Chairman: the payment is counted with that person ("Person · md | bKash")
  const lead = d.paidTo ? leaders().find(x => x.k === d.paidTo) : null, m0 = str(d.method, 60);
  const method = lead ? `Person · ${lead.k}${m0 && !/^cash/i.test(m0) ? ` | ${m0}` : ""}` : m0;
  db.ledger.push({ id: id("l"), at: now(), agentId: u.id, type: "payment", desc: str(d.desc, 200) || (lead ? `Payment given to ${lead.name} · ${lead.title}` : "Payment sent by agent"), amount, date: str(d.date, 10) || now().slice(0, 10), method, ref: str(d.ref, 80), status: "pending", ...(d.proof?.data ? { proof: storeFile(d.proof, u.id) } : {}) });
  notifyAdmins(`Payment reported by ${u.agent.business}: ${bdt(amount)} ${lead ? `given to ${lead.name} (${lead.title})` : `via ${m0}`}.`, "ledger");
  if (lead?.uid) notify(lead.uid, `${u.agent.business} says they gave you ${bdt(amount)}. It counts as money with you once the agency confirms it.`);
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
A["admin.markVerified"] = async ({ id: xid }, u) => { needPerm(u, "users"); const x = user(xid); must(x && x.status === "unverified", "Not needed."); x.status = x.role === "agent" ? "pending" : "active"; x.emailVerified = now(); delete x.verify; return { msg: "Email marked as verified." }; };
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
/* what an agent's account line says about a clearance file: "<what> · Applicant: … · Passport no: … · Country: …"; cl links the line to the file */
const clFacts = c => { const w = c.workerId ? worker(c.workerId) : null, cu = c.candidateId ? user(c.candidateId) : null;
  return { name: w?.name || cu?.name || c.fullName || "", passport: String(w?.passport || cu?.profile?.passportNo || c.passport || "").replace(/\s+/g, "").toUpperCase(), country: c.country || "" }; };
const clDesc = (what, c) => { const f = clFacts(c); return `${what} · Applicant: ${f.name || "—"} · Passport no: ${f.passport || "—"} · Country: ${f.country || "—"}`; };
const clCharge = (agentId, c, what, amount, date) => ({ id: id("l"), agentId, cl: c.id, type: "charge", desc: clDesc(what, c), amount, date: (date || now()).slice(0, 10), method: "", ref: "", status: "confirmed" });
// does an account line belong to this clearance file (lines made before the cl link name the worker and the EC Ref No)
const clOwns = (l, c, name) => l.type === "charge" && (l.cl === c.id || (!l.cl && c.ref && String(l.desc || "").includes(`${name} (${c.ref})`)));
// once: the clearance lines already in agents' accounts get the same wording (Applicant · Passport no · Country) and the cl link
if (!db.clDescFix) {
  const RX = /^(BMET clearance processing|BMET clearance card fee|Previous due): (.+?)(?: \(([^()]+)\))?$/;
  for (const l of db.ledger) { if (l.type !== "charge" || l.cl) continue; const m = RX.exec(String(l.desc || "")); if (!m) continue;
    const c = db.clearances.find(x => x.agentId === l.agentId && (!m[3] || x.ref === m[3]) && clFacts(x).name === m[2]); if (!c) continue;
    l.cl = c.id; l.desc = clDesc(m[1], c); }
  db.clDescFix = true;
}
A["admin.clDelete"] = async ({ id: cid }, u) => {
  must(u?.role === "admin", "Only the admin can delete a clearance file.", 403);
  const c = db.clearances.find(x => x.id === cid); must(c, "File not found.");
  const w = c.workerId ? worker(c.workerId) : null, name = w?.name || c.fullName || "the worker";
  for (const f of [c.files?.passport, c.files?.visa, c.files?.contract, ...(c.files?.others || []), c.card, c.payment?.file]) if (f) { try { dropFile(f); } catch {} }
  db.ledger = db.ledger.filter(l => !(l.agentId === c.agentId && clOwns(l, c, name)));
  db.clearances = db.clearances.filter(x => x !== c);
  let gone = false;
  if (w && !db.clearances.some(x => x.workerId === w.id) && !db.applications.some(a => a.workerId === w.id)) { db.workers = db.workers.filter(x => x !== w); gone = true; }
  return { msg: `Clearance file ${c.ref || ""} for ${name} deleted${gone ? ", with the worker" : ""}.` };
};
// the files under one RAIMS IC number (EC Ref No or IC No.)
const icOf = c => { const r = String(c.icNo || "").replace(/\s+/g, "").toUpperCase() || (/^IC-/.test(String(c.ref || "").toUpperCase()) ? String(c.ref).toUpperCase() : ""); return r; };
const icFiles = ic => db.clearances.filter(x => icOf(x) === ic || String(x.ref || "").toUpperCase() === ic);
/* Applications › Clearance applications: after Received, Save to Entry List puts the worker in Passport Entry › BMET Passport Entry
   (an existing passport gets the BMET list added); then Send to BMET. */
A["admin.clEntry"] = async (d, u) => {
  needPerm(u, "clearance");
  const c = db.clearances.find(x => x.id === d.id); must(c, "File not found."); must(c.status === "received", "Mark the file Received first.");
  const w = worker(c.workerId), cu = user(c.candidateId), ag = c.agentId ? user(c.agentId) : null;
  const passport = ppNorm(w?.passport || cu?.profile?.passportNo || c.passport || "").slice(0, 20), name = str(w?.name || cu?.name || c.name, 120);
  must(/^[A-Z0-9]{6,15}$/.test(passport), "This file has no passport number."); must(name.length >= 2, "This file has no worker name.");
  const v = { name, country: c.country || "", ref: ag ? agentName(ag) : str(c.agentName, 120), agentId: ag ? ag.id : null };
  const old = db.passports.find(p => p.passport === passport);
  if (old) Object.assign(old, { ...v, lists: [...new Set([...ppLists(old), "bmet"])], updated: now() }, old.country ? { country: old.country } : {});
  else db.passports.unshift({ id: id("pp"), ...v, passport, gender: w?.gender === "Female" ? "Female" : w?.gender === "Male" ? "Male" : "", ...(w?.phone && !ag ? { mobile: w.phone } : {}), lists: ["bmet"], by: u.name, at: now() });
  c.entryList = now();
  ppFillQueue([db.passports.find(p => p.passport === passport)].filter(Boolean)); // BMET details from RAIMS, when signed in
  return { msg: `${name} (${passport}) saved to BMET Passport Entry. Now enter the IC number and Send to BMET.` };
};
A["admin.clStatus"] = async (d, u) => {
  const r = await clStatusOne(d, u);
  if (d.status === "sent_bmet") syncSoon();
  // the same IC number = the same RAIMS application: the other files under it take the same status
  const c = db.clearances.find(x => x.id === d.id), ic = c && icOf(c);
  if (c && ic && d.group !== false && u?.id !== "raims") {
    let n = 0;
    for (const x of icFiles(ic)) { if (x === c || x.status === "approved") continue; // an Approved file keeps its status
      if (x.status === c.status && (c.status !== "custom" || x.statusText === c.statusText)) continue;
      await clStatusOne({ id: x.id, status: c.status, text: c.statusText }, u); n++; }
    if (n && r?.msg) r.msg += ` ${n} more file(s) with ${ic} changed too.`;
  }
  return r;
};
/* a file is Approved: tell the agent (or job seeker) and the admin / clearance staff, with name, passport, country and IC number */
function clApprovedNotice(c, extra = "") {
  const name = worker(c.workerId)?.name || user(c.candidateId)?.name || c.fullName || c.name || "Worker";
  const pp = worker(c.workerId)?.passport || user(c.candidateId)?.profile?.passportNo || c.passport || "—";
  const line = `BMET clearance Approved ✓ ${name} · Passport ${pp} · ${c.country || "—"} · IC No: ${c.icNo || c.ref}`;
  if (c.agentId || c.candidateId) notify(c.agentId || c.candidateId, `${line}. The clearance card will be sent to your portal.${extra}`);
  notifyAdmins(`${line}${c.agentId ? ` · Agent: ${agentName(user(c.agentId)) || "—"}` : ""}.`, "clearance");
}
async function clStatusOne({ id: cid, status, text }, u) {
  needPerm(u, "clearance"); const c = db.clearances.find(x => x.id === cid); must(c, "File not found."); must([...CL_STAGES, "rejected", "custom"].includes(status), "Unknown status.");
  if (c.status === "approved" && status !== "approved") return must(false, "This file is Approved — its status can no longer be changed.");
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
  must(!(c.via === "agent" && !c.entryList && !["pending", "received", "rejected"].includes(status)), "Save to Entry List first, then Send to BMET.");
  must(!(c.via === "agent" && !c.icNo && !["pending", "received", "rejected"].includes(status)), "Enter the IC number from RAIMS first, then Send to BMET.");
  c.status = status; delete c.statusText; c.history.push({ s: status, at: now() });
  const payNow = c.agentId && ["final", "approved"].includes(status) && !["submitted", "paid"].includes(c.payment?.status) ? " Send the payment receipt from BMET clearance (Unpaid)." : "";
  if (status === "approved") clApprovedNotice(c, payNow); else notify(c.agentId || c.candidateId, `BMET clearance for ${name}: ${LABEL[status]}.${payNow}`);
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
/* addresses a RAIMS page's own script reads its data from (DataTables ajax, axios, fetch, $.get …) */
const dataHints = h => [...new Set([...String(h || "").matchAll(/(?:ajax|url|axios\.(?:get|post)|fetch|\$\.(?:get|post|ajax)|route)\s*[:(=]\s*\{?\s*(?:url\s*:\s*)?["'`]([^"'`\s]{3,200})["'`]/gi)].map(m => m[1]).filter(u => !/\.(js|css|png|jpe?g|svg|woff2?)(\?|$)/i.test(u)))].slice(0, 10);
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
/* a signed-in RAIMS session, kept for 15 minutes so several checks in a row do not sign in each time */
let raimsSess = null; // the admin's RAIMS sign-in: kept until the admin logs out of RAIMS (also across restarts); signed in again by itself if RAIMS ends it
function raimsRestore() { if (raimsSess || !db.raims?.cookies) return; try { const J = jar(); Object.assign(J.c, JSON.parse(unseal(db.raims.cookies))); raimsSess = { J, at: Date.now(), email: db.raims.email }; } catch {} }
function raimsKeep(J) { raimsSess = { J, at: Date.now(), email: db.raims.email }; try { db.raims.cookies = seal(JSON.stringify(J.c)); db.raims.since = db.raims.since || now(); save(); } catch {} }
async function raimsLogin(fresh = false) {
  const R = db.raims; must(R?.email && R?.pass, "The admin has not signed in to RAIMS yet (BMET clearance › RAIMS).");
  raimsRestore();
  if (!fresh && raimsSess && raimsSess.email === R.email) return raimsSess.J;
  raimsSess = null; const J = jar();
  try {
    const lp = await rq(J, "/agency/login");
    const tok = (/name="_token"[^>]*value="([^"]+)"/.exec(lp.text) || /name="csrf-token"[^>]*content="([^"]+)"/.exec(lp.text) || [])[1];
    const action = (/<form[^>]*action="([^"]*login[^"]*)"/i.exec(lp.text) || [])[1] || "/agency/login";
    must(tok, "The RAIMS sign-in page did not load. The site may be down or blocking this server.");
    const li = await rq(J, action.replace(/&amp;/g, "&"), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: lp.url }, body: new URLSearchParams({ _token: tok, email: R.email, password: unseal(R.pass), remember: "on" }).toString() });
    must(!(/name="password"/i.test(li.text) && /login/i.test(li.url)), "RAIMS did not accept the sign-in. Check the RAIMS email and password.");
    db.raims.since = now(); raimsKeep(J); return J;
  } catch (e) { if (e instanceof Fail) throw e; must(false, `Could not reach RAIMS: ${e.message}`); }
}
/* label → value pairs of a RAIMS page (labels with inputs, or label / value boxes), and its alert messages */
function raimsFields(html) {
  const h = String(html || "").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " "), out = [], seen = new Set();
  const val = tag => { const v = (/\bvalue\s*=\s*"([^"]*)"/i.exec(tag) || /\bvalue\s*=\s*'([^']*)'/i.exec(tag) || [])[1]; return v == null ? null : htmlText(v).trim(); };
  for (const m of h.matchAll(/<label[^>]*>([\s\S]*?)<\/label>([\s\S]{0,1500}?)(?=<label|$)/gi)) {
    const lab = htmlText(m[1]).replace(/\s*\*\s*$/, "").trim(); if (!lab || lab.length > 80 || seen.has(lab)) continue;
    const rest = m[2]; let v = null;
    const inp = /<input\b[^>]*>/i.exec(rest); if (inp && !/type\s*=\s*["']?(hidden|submit|button|file)/i.test(inp[0])) v = val(inp[0]);
    if (v == null) { const ta = /<textarea[^>]*>([\s\S]*?)<\/textarea>/i.exec(rest); if (ta) v = htmlText(ta[1]).trim(); }
    if (v == null) { const sel = /<select[\s\S]*?<\/select>/i.exec(rest); if (sel) { const o = /<option[^>]*selected[^>]*>([\s\S]*?)<\/option>/i.exec(sel[0]); v = o ? htmlText(o[1]).trim() : ""; } }
    if (v == null) { const t = htmlText(rest.split(/<label/i)[0]).trim(); if (t && t.length < 200) v = t; }
    if (v != null) { seen.add(lab); out.push([lab, v]); }
  }
  const alerts = [...h.matchAll(/<div[^>]*class="[^"]*\b(alert|alert-danger|alert-warning|alert-success|text-danger)\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi)].map(m => htmlText(m[2]).replace(/\s+/g, " ").trim()).filter(t => t && t.length < 400);
  return { fields: out, alerts: [...new Set(alerts)] };
}
/* the RAIMS Pre EC answer (JSON) shown the way the RAIMS page shows it: its alerts, then Employee Information */
function preEcView(j, pp) {
  const m = {}; const walk = (v, k) => { if (Array.isArray(v)) v.forEach(x => walk(x, k)); else if (v && typeof v === "object") Object.entries(v).forEach(([a, b]) => walk(b, a)); else if (k && !(k.toLowerCase() in m) && v != null && String(v).trim() !== "") m[k.toLowerCase()] = v; };
  walk(j);
  if (!Object.keys(m).some(k => /registration_no|passport_number|national_id|bmet_bio_finger|is_available_for_job/.test(k))) return null;
  // the person's own names. RAIMS sends places, offices and relatives under "…name" keys too (e.g. an upazila {name: "Narsingdi Sadar"}),
  // so every value is judged by its whole path: nothing under a place / office / relative key is the person's name.
  const BN = /[ঀ-৿]/;
  const NOT_PERSON = /gender|sex|marital|blood|religion|father|mother|spouse|husband|wife|contact|nominee|guardian|relation|institut|center|centre|district|division|upazila|upazilla|thana|police|station|post|union|village|ward|city|area|address|zone|country|countr|nationality|file|user|bank|branch|company|agency|agent|employer|training|profession|occupation|trade|course|embassy|office|batch|religion|type|status|created|updated|by_|_by|place|location|permanent|present|_pa_|^pa_|_pr_|^pr_|recruit|sponsor|job|visa|demand/i;
  const PERSON_KEYS = /national_id|^nid|fathers?_name|date_of_birth|^dob$|passport_number|passport_no|name_bn|bn_name|bangla|mothers?_name/i;
  const cands = []; // [path, key, value, holder object]
  const scan = (v, path) => { if (Array.isArray(v)) return v.forEach(x => scan(x, path)); if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) { if (x && typeof x === "object") { scan(x, [...path, k]); continue; }
      if (!/name/i.test(k) || x == null) continue; const t = String(x).trim(); if (!t || t === "null" || t.length > 120 || /\d{3,}|@/.test(t)) continue;
      if (/^(male|female|other|third gender|hijra|yes|no|n\/?a|single|married|unmarried|divorced|widowed|islam|hindu|christian|buddhist|bangladeshi|bangladesh|active|inactive|pending|approved)$/i.test(t)) continue; // a value, not a name
      const P2 = [...path, k]; if (P2.some(z => NOT_PERSON.test(z))) { if (!P2.some(z => HARD_NOT.test(z))) weak.push({ path, k, t, o: v }); continue; } cands.push({ path, k, t, o: v }); } };
  // HARD_NOT: relatives, places and organisations — never the person. Words like file / user / type / status / post can be in the key of the person's own record (e.g. profile), so those are a fallback
  const HARD_NOT = /gender|sex|marital|blood|religion|father|mother|spouse|husband|wife|contact|nominee|guardian|relation|institut|center|centre|district|division|upazila|upazilla|thana|police|station|union|village|ward|city|area|address|zone|country|countr|nationality|bank|branch|company|agency|agent|employer|training|profession|occupation|trade|course|embassy|office|batch|place|location|permanent|present|_pa_|^pa_|_pr_|^pr_|recruit|sponsor|job|visa|demand|created|updated|by_|_by/i, weak = [];
  scan(j, []);
  const ownObj = o => Object.keys(o).some(k => PERSON_KEYS.test(k));
  const stem = k => k.toLowerCase().replace(/(^|_)(bn|bangla|bengali|bangali|en|english|eng)(_|$)/g, "$1$3").replace(/^_+|_+$/g, "");
  const rank = c => (ownObj(c.o) ? 0 : 10) + (/^(name|name_en|full_name|employee_name|applicant_name|name_english|en_name)$/i.test(c.k) ? 0 : 3) + c.path.length;
  const bnC = cands.filter(c => BN.test(c.t)).sort((x, y) => rank(x) - rank(y))[0] || weak.filter(c => BN.test(c.t) && !/type|status|file$/i.test(c.k)).sort((x, y) => rank(x) - rank(y))[0];
  const enAll = cands.filter(c => !BN.test(c.t) && /^[A-Za-z][A-Za-z .'-]*$/.test(c.t));
  // English name: first next to the Bangla name (same object, same key stem), then in the person's own object
  // a value RAIMS also gives as a place (under an upazila / district / thana … key) is a place, not the person
  const places = new Set(); const pl = (v, path) => { if (Array.isArray(v)) return v.forEach(x => pl(x, path)); if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) { if (x && typeof x === "object") pl(x, [...path, k]); else if (x != null && [...path, k].some(z => /district|division|upazila|upazilla|thana|police|station|post|union|village|city|address|(^|_)(ps|po|upz|dist|div)(_|$)/i.test(z))) places.add(String(x).trim().toLowerCase()); } };
  pl(j, []);
  const enOk = enAll.filter(c => !places.has(c.t.toLowerCase()) && !/(^|_)(ps|po|upz|dist|div)(_|$)/i.test(c.k));
  const best = L => L.sort((x, y) => rank(x) - rank(y))[0];
  let enC = (bnC && (enOk.find(c => c.o === bnC.o && stem(c.k) === stem(bnC.k)) || best(enOk.filter(c => c.o === bnC.o)))) || best(enOk);
  if (!enC) { const W = weak.filter(c => !BN.test(c.t) && /^[A-Za-z][A-Za-z .'-]*\s[A-Za-z .'-]+$/.test(c.t) && !places.has(c.t.toLowerCase()) && !/(^|_)(ps|po|upz|dist|div)(_|$)|type|status|user_?name|file/i.test(c.k));
    if (!W.length && bnC) for (const [k, x] of Object.entries(bnC.o)) if (typeof x === "string" && /^[A-Z][A-Za-z.'-]*(\s+[A-Za-z.'-]+){1,5}$/.test(x.trim()) && !HARD_NOT.test(k) && !/date|type|status|code|no$|number|id$/i.test(k) && !places.has(x.trim().toLowerCase())) W.push({ path: bnC.path, k, t: x.trim(), o: bnC.o });
    enC = (bnC && (W.find(c => c.o === bnC.o) || W.find(c => stem(c.k) === stem(bnC.k)))) || best(W.filter(c => ownObj(c.o))) || best(W.filter(c => /^(name|name_en|full_name|employee_name|applicant_name|name_english|en_name)$/i.test(c.k))) || null; }
  let person = enC ? enC.t : "";
  const names = { en: person, bn: bnC ? bnC.t : "" };
  if (!person) { const fp = /passport_([A-Z_]+?)_\d{6,}/.exec(String(m.file_path || "")); if (fp) person = fp[1].replace(/_/g, " ").trim(); }
  const g = (...ks) => { for (const k of ks) if (m[k] != null && String(m[k]).trim() !== "" && String(m[k]) !== "null") return String(m[k]).trim(); return ""; };
  const yes = v => ["1", "true", "yes"].includes(String(v).toLowerCase());
  const day = v => { const x = String(v || ""); const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(x); return d ? `${d[3]}-${d[2]}-${d[1]}` : x; };
  const ymd = v => { const x = String(v || ""); return (/^(\d{4}-\d{2}-\d{2})/.exec(x) || [])[1] || x; }; // RAIMS shows dates as 2024-02-08
  const alerts = [];
  for (const k of ["message", "msg", "alert", "warning"]) if (m[k] && !/success/i.test(m[k])) alerts.push(String(m[k]));
  if (Array.isArray(j?.alerts)) alerts.push(...j.alerts.map(String));
  const exp = g("expire_date", "expiry_date", "passport_expiry_date", "date_of_expiry");
  if (exp && /^\d{4}-\d{2}-\d{2}/.test(exp)) { const t = new Date(exp.slice(0, 10)); const lim = new Date(); lim.setMonth(lim.getMonth() + 3); if (t < lim) alerts.push("Alert: Passport expired date must be at least 3 months from today."); }
  const finger = g("bmet_bio_finger", "bio_finger", "is_bio_finger", "finger_status");
  const avail = g("is_available_for_job", "availability", "is_available");
  const gender = { 1: "Male", 2: "Female", 3: "Third gender" }[g("gender_id")] || g("gender");
  const addr = [g("pa_house_no_road_village", "house_no_road_village"), g("pa_post_office_name_code", "post_office_name_code"), g("pa_police_station", "police_station")].filter(Boolean).join(", ");
  const F = [
    ["BMET Registration No", g("registration_no", "bmet_registration_no", "reg_no")],
    ["BIO Finger", finger === "" ? "" : yes(finger) ? "Success" : "Not Found"],
    ["Availability", avail === "" ? "" : yes(avail) || /^available$/i.test(avail) ? "Available" : "Not Available"],
    ["Name", person],
    ["Bangali Name", names.bn || person],
    ["NID Number", g("national_id", "nid", "nid_number", "nid_no")],
    ["Date of Birth", ymd(g("date_of_birth", "dob", "birth_date"))],
    ["Father's Name", g("fathers_name", "father_name", "father_name_en")],
    ["Mother's Name", g("mothers_name", "mother_name", "mother_name_en")],
    ["Phone Number", g("mobile", "phone", "phone_number", "mobile_no", "contact_number")],
    ["Gender", gender],
    ["Passport Issue Date", ymd(g("issue_date", "passport_issue_date"))],
    ["Passport Expire Date", ymd(exp)],
    ["Contact Person Name", g("contact_person_name")],
    ["Contact Person Phone Number", g("contact_person_mobile", "contact_person_phone", "contact_person_phone_number")],
    ["Training Info", [g("pdo_completed") !== "" && yes(g("pdo_completed")) ? `PDO: ${ymd(g("pdo_completed_at", "pdo_date")) || "Yes"}` : "", g("name_of_institution", "training_center", "institute_name")].filter(Boolean).join(" · ")],
    ["Passport No", g("passport_number", "passport_no") || pp],
    ["Permanent Address", addr],
    ["Profession", g("profession", "occupation")],
  ].filter(([k, v]) => v || k === "Name"); // RAIMS always shows Name and Bangali Name
  const val = l => (F.find(([k]) => k === l) || [])[1] || "";
  const entry = { name: val("Name") || val("Bangali Name"), gender: gender === "Female" ? "Female" : gender === "Male" ? "Male" : "", bmet: { regNo: val("BMET Registration No"), finger: val("BIO Finger"), available: val("Availability"), nameBn: val("Bangali Name"), nid: val("NID Number"), dob: day(val("Date of Birth")),
    father: val("Father's Name"), mother: val("Mother's Name"), mobile: val("Phone Number"), profession: val("Profession"), address: val("Permanent Address"), training: g("name_of_institution", "training_center", "institute_name"), pdo: (/PDO: ([^·]+)/.exec(val("Training Info")) || [])[1]?.trim() || "", issueDate: day(val("Passport Issue Date")), expiryDate: day(val("Passport Expire Date")), checked: true } };
  return { fields: F, alerts: [...new Set(alerts)], entry };
}
async function preEcCheck({ passport, returnee, otherPassport }) {
  const pp = ppNorm(passport); must(/^[A-Z0-9]{6,15}$/.test(pp), "Enter the passport number.");
  for (let attempt = 0; attempt < 2; attempt++) {
    const J = await raimsLogin(attempt > 0);
    const pg = await rq(J, "/agency/employee/pre-ec-check");
    if (/name="password"/i.test(pg.text) && /login/i.test(pg.url)) { raimsSess = null; continue; }
    const tok = (/name="_token"[^>]*value="([^"]+)"/.exec(pg.text) || /name="csrf-token"[^>]*content="([^"]+)"/.exec(pg.text) || [])[1] || "";
    // the form on the page: its address and the names of its fields
    const form = [...pg.text.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].find(f => /passport/i.test(f[2])) || null;
    const names = form ? [...form[2].matchAll(/<(?:input|select|textarea)\b[^>]*name="([^"]+)"[^>]*>/gi)].map(m => [m[1], m[0]]) : [];
    const pick = re => (names.find(([n]) => re.test(n)) || [])[0];
    const ppName = (names.find(([n]) => /passport/i.test(n) && !/other|return/i.test(n)) || [])[0] || pick(/passport/i) || "passport", rtName = pick(/has_?return|return(ee)?_?type|is_?return/i) || (names.find(([n, t]) => /return/i.test(n) && /^<select/i.test(t)) || [])[0];
    const otherName = (names.find(([n]) => /other|return/i.test(n) && /pass/i.test(n) && n !== rtName) || [])[0];
    const rtOpts = form ? [...((new RegExp(`<select[^>]*name="${(rtName || "x").replace(/[[\]]/g, "\\$&")}"[\\s\\S]*?<\\/select>`, "i").exec(form[2]) || [""])[0]).matchAll(/<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/gi)].map(m => [m[1], htmlText(m[2]).trim()]) : [];
    const rtVal = (re, dflt) => (rtOpts.find(([v, t]) => v !== "" && re.test(t)) || [])[0] ?? dflt;
    const body = new URLSearchParams(); if (tok) body.set("_token", tok);
    for (const [n, tag] of names) if (/type="hidden"/i.test(tag) && n !== "_token") body.set(n, (/value="([^"]*)"/.exec(tag) || [])[1] || "");
    body.set(ppName, pp);
    if (rtName) body.set(rtName, returnee === "other" ? rtVal(/other/i, "2") : returnee === "same" ? rtVal(/same/i, "1") : rtVal(/^no$/i, "0"));
    if (returnee === "other") { const op = ppNorm(otherPassport); must(/^[A-Z0-9]{6,15}$/.test(op), "Enter the returnee's other passport number."); if (otherName) body.set(otherName, op); }
    const method = form && /method\s*=\s*"?post/i.test(form[1]) ? "POST" : "GET";
    const action = form ? ((/action="([^"]*)"/i.exec(form[1]) || [])[1] || "/agency/employee/pre-ec-check").replace(/&amp;/g, "&") : "";
    let res = null, tried = [], notFound = false;
    // RAIMS checks with its API (api/v1/agency/employee/pre-ec-check/details/:passport_no/…, Bearer = the page's apiKey): ask it first, the form only if that fails
    const apiFirst = !!raimsApiKey(pg.text) && /pre-ec-check\/details\//.test(pg.text);
    const sendForm = async () => { if (action) { res = method === "POST" ? await rq(J, action, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: pg.url, "X-CSRF-TOKEN": tok }, body: body.toString() }) : await rq(J, action + (action.includes("?") ? "&" : "?") + body.toString()); } };
    if (!apiFirst) await sendForm();
    // a page that searches with its own script: ask the same address the script asks
    if (res) tried.push(`form ${method} ${action} → ${res.r.status} ${htmlText(res.text).replace(/\s+/g, " ").slice(0, 60)}`);
    let fx = res ? raimsFields(res.text) : { fields: [], alerts: [] };
    if (fx.fields.filter(([, v]) => v).length < 3) {
      // the search runs in the page's script: ask its addresses the way a browser does (session cookie, XSRF token, same-site Referer/Origin)
      const xsrf = decodeURIComponent(J.c["XSRF-TOKEN"] || ""), origin = new URL(pg.url).origin;
      // the RAIMS API (/api/v1/…) wants a token the page holds for its script (meta tag, script value, or a cookie)
      const bearer = (() => { const t = pg.text; const ak = raimsApiKey(t); if (ak) return { v: ak, from: "page apiKey" };
        const m = /Bearer\s*["'`]?\s*\+?\s*["'`]?([A-Za-z0-9._|\-]{20,})/.exec(t) || /(?:api_?token|access_?token|auth_?token|bearer_?token|jwt|token)["']?\s*[:=,]\s*["'`]([A-Za-z0-9._|\-]{20,})["'`]/i.exec(t) || /<meta[^>]*name=["'](?:api-token|access-token|token|jwt)["'][^>]*content=["']([^"']{20,})["']/i.exec(t);
        if (m) return { v: m[1], from: "page" };
        const ck = Object.entries(J.c).find(([k, v]) => /token|jwt|auth/i.test(k) && !/xsrf|csrf/i.test(k) && v.length > 20); return ck ? { v: decodeURIComponent(ck[1]), from: `cookie ${ck[0]}` } : null; })();
      tried.push(bearer ? `token for the API: found (${bearer.from})` : "token for the API: not found on the page");
      for (const m of pg.text.matchAll(/.{0,80}(?:Authorization|Bearer|localStorage|sessionStorage|api_token|access_token).{0,80}/gi)) tried.push(`page script: ${m[0].replace(/[A-Za-z0-9._|\-]{24,}/g, x => x.slice(0, 6) + "…").trim()}`);
      const xh = extra => ({ "X-Requested-With": "XMLHttpRequest", Accept: "application/json, text/html, */*", "X-CSRF-TOKEN": tok, ...(xsrf ? { "X-XSRF-TOKEN": xsrf } : {}), ...(bearer ? { Authorization: `Bearer ${bearer.v}` } : {}), Referer: pg.url, Origin: origin, ...extra });
      const hints = [...new Set([...raimsApis(pg.text).filter(u => /pre-ec-check\/details/i.test(u)), ...dataHints(pg.text).filter(u => /pre|ec|check|passport|employee|search|emigrant|worker/i.test(u))])].slice(0, 6);
      const rtCode = rtName ? body.get(rtName) : "no", oldPp = returnee === "other" ? ppNorm(otherPassport) : "null";
      for (const h of hints) { if (notFound) break;
        tried.push(`address: ${h}`);
        // fill the route's own parts (…/details/:passport_no/:returnee/:old_passport/:ap_house_…)
        const u = h.replace(/:([a-z_]+)/gi, (all, k) => /^passport/i.test(k) ? pp : /returnee|return/i.test(k) ? encodeURIComponent(rtCode || "no") : /old|other/i.test(k) ? encodeURIComponent(oldPp || "null") : /^\d+$/.test(k) ? all : "null").replace(/\{[^}]*\}|\$\{[^}]*\}/g, pp);
        for (const m of ["GET", "POST", "POSTJSON"]) {
          let x; try {
            x = m === "GET" ? await rq(J, u + (u.includes(pp) ? "" : (u.includes("?") ? "&" : "?") + `${ppName}=${pp}&passport=${pp}`), { headers: xh() })
              : m === "POST" ? await rq(J, u, { method: "POST", headers: xh({ "Content-Type": "application/x-www-form-urlencoded" }), body: body.toString() })
              : await rq(J, u, { method: "POST", headers: xh({ "Content-Type": "application/json" }), body: JSON.stringify({ ...Object.fromEntries(body), passport: pp, passport_no: pp, passport_number: pp }) });
          } catch (e) { tried.push(`${m} ${u} → ${e.message}`); continue; }
          tried.push(`${m === "POSTJSON" ? "POST(json)" : m} ${u} → ${x.r.status} ${htmlText(x.text).replace(/\s+/g, " ").slice(0, 90)}`);
          if (x.r.status >= 400) { if (/not ?found/i.test(x.text) && /pre-ec-check\/details/i.test(u)) { notFound = true; break; } continue; }
          let got = null;
          try { const j = JSON.parse(x.text);
            if (typeof j?.html === "string") { const f = raimsFields(j.html); if (f.fields.length) got = f; }
            if (!got) { const v = preEcView(j, pp); if (v) { got = v; lastRaims.set("page", { url: "pre-ec-check.json", html: JSON.stringify(j, null, 2).slice(0, 600000) }); } }
            if (!got) { const flat = []; const walk = (v, k) => { if (v && typeof v === "object") Object.entries(v).forEach(([a2, b2]) => walk(b2, a2)); else if (k && v != null && String(v).trim()) flat.push([k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()), htmlText(String(v)).trim()]); }; walk(j);
              if (flat.length >= 3 || flat.some(([, v]) => v.toUpperCase() === pp)) got = { fields: flat.slice(0, 80), alerts: [] }; }
          } catch { const f = raimsFields(x.text); if (f.fields.filter(([, v]) => v).length >= 3 && f.fields.some(([, v]) => v && v.toUpperCase() !== pp)) got = f; }
          if (got) { fx = got; res = x; break; }
        }
        if (res && fx.fields.length >= 3) break;
      }
      if (!hints.length) tried.push("the page names no search address");
    }
    if (notFound) return { ok: false, notFound: true, passport: pp, problem: "No information on BMET for this passport. Check the passport number.", tried };
    if (apiFirst && fx.fields.filter(([, v]) => v).length < 3) { await sendForm(); if (res) { tried.push(`form ${method} ${action} → ${res.r.status}`); const f2 = raimsFields(res.text); if (f2.fields.filter(([, v]) => v).length >= 3) fx = f2; } }
    lastRaims.set("page", { url: res?.url || pg.url, html: (res?.text || pg.text).slice(0, 600000) });
    const fields = fx.fields.filter(([k, v]) => v && !/^(type passport|has returnee|ami probashi|returnee other passport|_token)/i.test(k));
    { const nm = fields.find(([k]) => /^name$/i.test(k)), bi = fields.findIndex(([k]) => /^bang(a|la)li? name$/i.test(k)); if (nm && bi < 0) fields.splice(fields.indexOf(nm) + 1, 0, ["Bangali Name", nm[1]]);
      else if (!nm && bi >= 0 && !/[\u0980-\u09FF]/.test(fields[bi][1])) fields.splice(bi, 0, ["Name", fields[bi][1]]); }
    if (fields.length <= 2 && fields.some(([k, v]) => /^(message|error)$/i.test(k) && /unauth|login|expired|forbidden|csrf/i.test(v))) return { ok: false, problem: `RAIMS answered: ${fields.map(([, v]) => v).join(" ")}`, tried, page: htmlText(pg.text).slice(0, 600) };
    if (!fields.length && !fx.alerts.length) return { ok: false, problem: "RAIMS did not show a result for this passport.", tried, page: htmlText(res?.text || pg.text).slice(0, 800) };
    const entry = fx.entry || (() => { const v = l => (fields.find(([k]) => new RegExp(`^${l}`, "i").test(k)) || [])[1] || ""; return { name: v("Name") || v("Bang") || v("Employee Name") || v("Full Name"), gender: /female/i.test(v("Gender")) ? "Female" : /male/i.test(v("Gender")) ? "Male" : "", bmet: { regNo: v("BMET Registration"), finger: v("BIO Finger"), available: v("Availability"), nameBn: v("Bangali Name"), nid: v("NID"), dob: v("Date of Birth"), checked: true } }; })();
    const have = db.passports.find(p => p.passport === pp);
    return { ok: true, passport: pp, alerts: fx.alerts, fields, entry, inList: !!(have && ppLists(have).includes("bmet")) };
  }
  must(false, "RAIMS signed out. Try again.");
}
/* signs in and reads the EC application list; throws a Fail with a plain message when something is wrong */
async function raimsOpen(search = "") {
  must(db.raims?.email && db.raims?.pass, "The admin has not signed in to RAIMS yet (BMET clearance › RAIMS).");
  try {
    let J = await raimsLogin(), lst = await rq(J, "/agency/ec/application/list");
    if (/name="password"/i.test(lst.text) && /login/i.test(lst.url)) { J = await raimsLogin(true); lst = await rq(J, "/agency/ec/application/list"); }
    must(!/name="password"/i.test(lst.text), "RAIMS signed out before the list opened. Try again.");
    const li = { url: "(kept sign-in)", r: { status: 200 } };
    let parsed = raimsRows(lst.text), ajax = "", pages = 1;
    if (!parsed.rows.length) { // a list filled by the page's script: ask the same address the script asks
      const aj = (/ajax\s*:\s*\{?\s*(?:url\s*:\s*)?["'`]([^"'`]+)["'`]/i.exec(lst.text) || /url\s*:\s*["'`]([^"'`]*(?:ec|application)[^"'`]*)["'`]/i.exec(lst.text) || [])[1];
      if (aj) { const q = new URLSearchParams({ draw: "1", start: "0", length: "1000", "search[value]": search, "search[regex]": "false" }); const j = await rq(J, aj.replace(/&amp;/g, "&") + (aj.includes("?") ? "&" : "?") + q, { headers: { "X-Requested-With": "XMLHttpRequest", Accept: "application/json", "X-CSRF-TOKEN": (/name="csrf-token"[^>]*content="([^"]+)"/.exec(lst.text) || [])[1] || "" } }); try { parsed = raimsRows("", JSON.parse(j.text)); ajax = aj; } catch {} }
    } else { // a list in pages (?page=2 …): read them all (at most 60)
      const last = Math.min(60, Math.max(1, ...[...lst.text.matchAll(/[?&]page=(\d+)/g)].map(m => +m[1])));
      for (let pg = 2; pg <= last; pg++) { const x = raimsRows((await rq(J, `/agency/ec/application/list?page=${pg}`)).text); if (!x.rows.length) break; parsed.rows.push(...x.rows); parsed.links.push(...x.links); pages = pg; }
    }
    parsed.page = { url: lst.url, status: lst.r.status, title: htmlText((/<title>([\s\S]*?)<\/title>/i.exec(lst.text) || [])[1] || ""), tables: (lst.text.match(/<table/gi) || []).length, scripts: [...lst.text.matchAll(/<script[^>]*src="([^"]+)"/gi)].map(m => m[1]).filter(x => !/jquery|bootstrap|cdn/i.test(x)).slice(0, 6), hints: dataHints(lst.text), text: htmlText(lst.text).slice(0, 1200), login: { url: li.url, status: li.r.status } };
    return { J, lst, parsed, ajax, pages };
  } catch (e) { if (e instanceof Fail) throw e; must(false, `Could not reach RAIMS: ${e.message}`); }
}
/* the RAIMS EC application list from its API: rows [EC Ref No (IC), status name, RID:<application id>] */
const raimsApis = t => [...new Set([...String(t || "").matchAll(/["'`]((?:https?:\/\/raims\.oep\.gov\.bd)?\/?api\/v\d\/[^"'`\s$]{3,160})["'`]/gi)].map(m => m[1]))];
/* workers of one EC application from the RAIMS API (api/v1/agency/ec/application/individual/<id>…, as the RAIMS page asks) */
let raimsAppTpl = "";
async function raimsAppApi(J, rid, key, referer) {
  const T = [...new Set([raimsAppTpl, "/api/v1/agency/ec/application/individual/{id}", "/api/v1/agency/ec/application/individual/{id}/show", "/api/v1/agency/ec/application/{id}", "/api/v1/agency/ec/application/{id}/show", "/api/v1/agency/ec/application/individual/{id}/details"].filter(Boolean))];
  for (const t of T) {
    let x; try { x = await rq(J, t.replace("{id}", rid), { headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "X-Requested-With": "XMLHttpRequest", Referer: referer } }); } catch { continue; }
    if (x.r.status >= 400) continue; let j; try { j = JSON.parse(x.text); } catch { continue; }
    const out = [], walk = (v, up) => { if (Array.isArray(v)) return v.forEach(z => walk(z, up)); if (!v || typeof v !== "object") return;
      const E = Object.entries(v), pv = E.find(([k, z]) => /passport/i.test(k) && !/old|other|prev|return|issue|expir|date|place|type/i.test(k) && typeof z === "string" && /^[A-Z]{1,2}\d{7,8}$/.test(z.trim()));
      if (pv) { const nm = (E.find(([k, z]) => /^(full_?)?name(_?en(glish)?)?$|^(employee|emigrant|worker)_?name$/i.test(k) && typeof z === "string") || [])[1] || "";
        const ct = (E.find(([k, z]) => /country/i.test(k) && typeof z === "string") || [])[1] || (E.find(([k, z]) => /country/i.test(k) && z && typeof z === "object" && z.name) || [])[1]?.name || up || "";
        out.push({ name: String(nm).trim(), passport: pv[1].trim(), country: String(ct).trim() }); }
      const c2 = (E.find(([k, z]) => /country/i.test(k) && typeof z === "string") || [])[1] || (E.find(([k, z]) => /country/i.test(k) && z && typeof z === "object" && z.name) || [])[1]?.name || up;
      for (const [, z] of E) if (z && typeof z === "object") walk(z, c2); };
    walk(j, "");
    const seen = new Set(), people = out.filter(p => !seen.has(p.passport) && seen.add(p.passport));
    if (people.length) { raimsAppTpl = t; return { people, json: j }; }
  }
  return { people: [] };
}
const raimsApiKey = t => { const k = [...String(t || "").matchAll(/jsUtlt\[['"]apiKey['"]\]\s*=\s*['"]([^'"]{20,})['"]/g)].map(m => m[1]); return k[k.length - 1] || ""; };
async function raimsApiList(search = "") {
  for (let attempt = 0; attempt < 2; attempt++) {
    const J = await raimsLogin(attempt > 0);
    const pg = await rq(J, "/agency/ec/application/list");
    if (/name="password"/i.test(pg.text) && /login/i.test(pg.url)) { raimsSess = null; continue; }
    const key = raimsApiKey(pg.text);
    must(key, "RAIMS list page gave no API key.");
    const rows = [], raw = []; let total = Infinity;
    // newest first; stop once every IC number of our open files is seen (RAIMS holds thousands of older applications)
    const want = new Set(db.clearances.filter(c => c.status !== "approved" && c.status !== "rejected" && !c.card).map(icOf).filter(Boolean));
    for (let start = 0, draw = 1; start < Math.min(total, 6000); start += 100, draw++) {
      const q = new URLSearchParams({ draw: String(draw), start: String(start), length: "100", status: "1", ap_type: "", "search[value]": search, "search[regex]": "false", "order[0][column]": "0", "order[0][dir]": "desc", "columns[0][data]": "id" });
      const x = await rq(J, `/api/v1/agency/ec/apllication/list?${q}`, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "X-Requested-With": "XMLHttpRequest", Referer: pg.url } });
      must(x.r.status < 400, `RAIMS list API answered ${x.r.status}.`);
      const j = JSON.parse(x.text), P = j.payload || j; const data = P.data || [];
      total = Number(P.recordsFiltered ?? P.recordsTotal ?? data.length) || data.length;
      for (const r of data) if (!r.is_draft) raw.push(r);
      for (const r of data) if (!r.is_draft) rows.push([String(r.ref_no || ""), String(r.status?.name || ""), `RID:${r.id}`, r.country?.name || "", `approved ${r.approval_summary?.approved_count ?? 0}/${r.apply_qty ?? ""}`]);
      if (data.length < 100 || search) break;
      if (!want.size || [...want].every(ic => rows.some(r => r[0].toUpperCase() === ic))) break;
    }
    return { head: ["EC Ref No", "Status", "ID", "Country", "Approved"], rows, raw, J, key };
  }
  must(false, "RAIMS signed out.");
}
async function raimsSync(by = "auto") {
  const R = db.raims, out = { at: now(), by, rows: 0, matched: 0, updated: [], statuses: {} };
  try {
    // the list page fills its table from the RAIMS API (api/v1/agency/ec/apllication/list, Bearer = the page's jsUtlt apiKey)
    let parsed = null; try { parsed = await raimsApiList(); out.via = "api"; } catch (e) { out.apiError = e.message; }
    if (!parsed || !parsed.rows.length) { const o2 = await raimsOpen(); parsed = o2.parsed; if (o2.ajax) out.ajax = o2.ajax; out.via = "page"; }
    out.head = parsed.head; out.rows = parsed.rows.length; out.sample = parsed.rows.slice(0, 3);
    const si = parsed.head.findIndex(h => /status/i.test(h));
    for (const row of parsed.rows) {
      const line = row.join(" | "), ic = (/\bIC[-\s]?[A-Z0-9][A-Z0-9-]{3,}/i.exec(line) || [])[0]?.replace(/\s+/g, "").toUpperCase();
      const pp = (/\b([A-Z]{1,2}\d{7,8})\b/.exec(line) || [])[1];
      const st = si >= 0 ? row[si] : (row.find(v => raimsStage(v.replace(/^status:\s*/i, ""))) || "").replace(/^status:\s*/i, "");
      if (st) out.statuses[st] = (out.statuses[st] || 0) + 1;
      // a row with a passport is that worker's file; a row with only the IC number is every file under that IC
      const byPp = pp && db.clearances.find(x => ppNorm(worker(x.workerId)?.passport || user(x.candidateId)?.profile?.passportNo || x.passport || "") === pp);
      // one IC number is one RAIMS application: its status is every worker's status under that IC
      const rid = (/\bRID:(\d+)/.exec(line) || [])[1];
      const files = [...new Set([...(ic ? icFiles(ic) : []), ...(rid ? db.clearances.filter(x => String(x.raimsId || "") === rid) : []), ...(byPp ? [byPp] : [])])];
      if (!files.length) continue; out.matched += files.length;
      const stage = raimsStage(st); if (!stage) continue;
      const cardNo = (/\b(IT-[A-Z]-\d{4}-\d{4,})\b/i.exec(line) || [])[1]?.toUpperCase();
      for (const c of files) {
        if (cardNo && !c.cardNo) c.cardNo = cardNo;
        // RAIMS decides the status only after we sent the file to BMET; before that (Pending / Received) it stays ours
        const cur = c.status === "custom" ? c.baseStage : c.status, ci = CL_STAGES.indexOf(cur);
        if (c.status === "approved" || c.card || c.status === "rejected") continue; // done here already
        if (ci < CL_STAGES.indexOf("sent_bmet")) continue;
        // the same as RAIMS, step by step: a file can go back (Director → Section …) and up again until Approved
        if (c.status === stage && c.raims?.status === st) continue;
        const name = worker(c.workerId)?.name || c.fullName || user(c.candidateId)?.name || "the worker";
        c.status = stage; delete c.statusText; delete c.baseStage;
        c.history.push({ s: stage, t: st, at: now(), by: "RAIMS" }); c.raims = { status: st, stage, at: now() };
        const payNow = c.agentId && ["final", "approved"].includes(stage) && !["submitted", "paid"].includes(c.payment?.status) ? " Send the payment receipt from BMET clearance (Unpaid)." : "";
        if (stage === "approved") clApprovedNotice(c, payNow); else notify(c.agentId || c.candidateId, `BMET clearance for ${name}: ${st}.${payNow}`);
        if (stage === "approved" && !c.cardNo) { const pp = worker(c.workerId)?.passport || user(c.candidateId)?.profile?.passportNo || c.passport; if (pp) try { await clearanceCheck({ q: pp }); } catch {} }
        out.updated.push({ ref: c.ref, name, passport: worker(c.workerId)?.passport || user(c.candidateId)?.profile?.passportNo || c.passport || "", from: c.history.length > 1 ? (c.history[c.history.length - 2].t || LABEL[cur] || cur) : LABEL[cur] || cur, to: st, raims: st });
      }
    }
    out.ok = true;
  } catch (e) { out.ok = false; out.error = e instanceof Fail ? e.message : `Could not reach RAIMS: ${e.message}`; }
  if (db.raims) db.raims.last = out; save(); return out;
}
// every 15 minutes while RAIMS is signed in (unless the admin turned automatic sync off); and shortly after a file is Sent to BMET
let syncing = false, soonT = null;
const autoSync = () => { if (syncing || !db.raims || db.raims.auto === false || !(db.raims.pass || db.raims.cookies)) return; syncing = true; raimsSync("auto").catch(() => {}).finally(() => { syncing = false; }); };
setInterval(autoSync, 15 * 60e3).unref();
const syncSoon = () => { clearTimeout(soonT); soonT = setTimeout(autoSync, 20e3); soonT.unref?.(); };
const lastRaims = new Map(); // the last RAIMS page read, for the admin to download when a page is not read right
/* Pre EC Check (RAIMS): admin/staff with the BMET clearance permission, and agents */
/* ======================= agent history: what each agent did, from where (IP, place, device) ======================= */
// repair: Pre EC entries saved with a gender word as the name ("Male") take the worker's real name
setImmediate(() => { let fixed = 0; for (const p of db.passports || []) if (/^(male|female|other|third gender)$/i.test(String(p.name || "").trim())) {
  const w = (db.workers || []).find(x => ppNorm(x.passport) === p.passport), c = db.clearances.find(x => ppNorm(x.passport || "") === p.passport && x.fullName);
  const nm = w?.name || c?.fullName || (p.bmet?.nameBn && !/[\u0980-\u09FF]/.test(p.bmet.nameBn) ? p.bmet.nameBn : "");
  if (nm && !/^(male|female)$/i.test(nm)) { p.name = nm; fixed++; }
} if (fixed) { console.log(`repaired ${fixed} passport name(s)`); save(); } });
if (!db.agentLog) db.agentLog = [];
if (!db.ipGeo) db.ipGeo = {};
const AG_TRAIL = { "auth.login": "Signed in", "auth.otp": "Signed in", "auth.handoff": "Signed in", "auth.logout": "Signed out", "auth.changePassword": "Changed password",
  "raims.preEc": "Pre EC Check", "agent.payment": "Payment sent", "agent.clPayment": "Clearance payment sent", "agent.clearance": "BMET clearance application",
  "agent.workerSave": "Worker saved", "agent.workerDelete": "Worker deleted", "agent.applyJob": "Job application", "agent.ticket": "Air ticket request",
  "agent.ticketCancel": "Air ticket cancelled", "agent.profile": "Profile updated", "agent.upload": "Document uploaded", "agent.removeDoc": "Document removed" };
const device = ua => { const s = String(ua || "");
  const os = /iPhone/.test(s) ? "iPhone" : /iPad/.test(s) ? "iPad" : /Android/.test(s) ? "Android" : /Windows/.test(s) ? "Windows" : /Mac OS X|Macintosh/.test(s) ? "Mac" : /Linux/.test(s) ? "Linux" : "";
  const br = /Edg\//.test(s) ? "Edge" : /OPR\/|Opera/.test(s) ? "Opera" : /SamsungBrowser/.test(s) ? "Samsung Internet" : /CriOS|Chrome\//.test(s) ? "Chrome" : /FxiOS|Firefox\//.test(s) ? "Firefox" : /Safari\//.test(s) ? "Safari" : "";
  return [os, br].filter(Boolean).join(" · ") || s.slice(0, 60); };
const privateIp = ip => !ip || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80|::ffff:127\.|::ffff:10\.|::ffff:192\.168\.)/i.test(ip);
const geoBusy = new Set();
async function ipPlace(ip) { // the place an address belongs to (city, region, country · network); cached for 30 days
  const c = db.ipGeo[ip]; if (c && Date.now() - Date.parse(c.at) < 30 * 864e5) return c.loc;
  if (process.env.GEO_OFF || privateIp(ip) || geoBusy.has(ip)) return "";
  geoBusy.add(ip);
  try {
    const r = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip.replace(/^::ffff:/, ""))}?fields=status,country,regionName,city,isp`, { signal: AbortSignal.timeout(4000) });
    const j = await r.json(); if (j.status !== "success") return "";
    const loc = [[j.city, j.regionName, j.country].filter((x, i, a) => x && a.indexOf(x) === i).join(", "), j.isp].filter(Boolean).join(" · ");
    db.ipGeo[ip] = { loc, at: now() }; const ks = Object.keys(db.ipGeo); if (ks.length > 3000) ks.slice(0, 500).forEach(k => delete db.ipGeo[k]);
    return loc;
  } catch { return ""; } finally { geoBusy.delete(ip); }
}
/* staff (and admin) work history for the admin: every change they make, when, from where */
if (!db.staffLog) db.staffLog = [];
const ST_SKIP = /^(chat\.|notif|inbox\.|me\.read|admin\.(agentLog|staffLog)$|flight\.(search|rules|airports)$|pub\.)/;
const ST_AREA = [[/^auth\./, "Sign-in"], [/clearance|^admin\.cl|^raims\.|clStatus|clRef|clAgent|bulk/i, "BMET clearance"], [/passport|agentBook/i, "Passport Entry / Agents"], [/ledger|^admin\.agent/i, "Agent accounts"],
  [/receipt|^mr\./i, "Money receipts"], [/office/i, "Main account"], [/salary/i, "Salary"], [/ticket|wftt|flight/i, "Air tickets"], [/visa|mofa|hr/i, "Visa applications"], [/job/i, "Jobs"],
  [/attendance/i, "Attendance"], [/user|staff|perm/i, "Accounts / staff"], [/content|blog|seo|slide|headline|about|setting/i, "Website"]];
function staffTrail(type, d, out, who, ip, ua) {
  try {
    if (!who || !isStaffRole(who) || ST_SKIP.test(type)) return;
    if ((type === "auth.login" || type === "auth.otp") && out?.otp) return;
    const pre = type === "raims.preEc", login = type === "auth.login" || type === "auth.otp";
    if (!out?.msg && !pre && !login) return; // a read: nothing changed
    // which record: a clearance file, ticket or ledger entry named by its id
    const cl = d.id && db.clearances.find(x => x.id === d.id), tk = !cl && d.id && db.tickets.find(x => x.id === d.id);
    const who2 = cl ? [worker(cl.workerId)?.name || user(cl.candidateId)?.name || cl.name, worker(cl.workerId)?.passport || cl.passport, cl.icNo || cl.ref].filter(Boolean).join(" · ") : tk ? [tk.name || worker(tk.workerId)?.name, `${tk.from} → ${tk.to}`].filter(Boolean).join(" · ") : "";
    const pick = [who2, d.passport, d.name, d.ref, d.ic, d.status, d.op, d.amount ?? d.rate, d.date].filter(v => v !== undefined && v !== null && v !== "" && typeof v !== "object").map(v => String(v).slice(0, 60));
    const detail = pre ? `Pre EC Check · ${ppNorm(d.passport)}${out?.ok ? "" : ` · ${out?.problem || "no result"}`}` : login ? "Signed in" : `${out.msg}${pick.length ? ` (${pick.join(" · ")})` : ""}`;
    const e = { id: id("sh"), at: now(), uid: who.id, type, area: (ST_AREA.find(([re]) => re.test(type)) || [0, "Other"])[1], detail: str(detail, 300), ip: String(ip || "").replace(/^::ffff:/, ""), device: device(ua), office: isOffice(netOf(ip)) };
    db.staffLog.push(e); if (db.staffLog.length > 30000) db.staffLog.splice(0, db.staffLog.length - 30000);
  } catch (err) { console.error("staffTrail", err); }
}
A["admin.staffLog"] = async (d, u) => {
  must(u?.role === "admin", "Only the admin can see this.", 403);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(d.day || "") ? d.day : "", q = String(d.q || "").trim().toLowerCase();
  const bd = iso => new Date(Date.parse(iso) + 6 * 3600e3).toISOString().slice(0, 10);
  const L = db.staffLog.filter(x => (!d.uid || x.uid === d.uid) && (!day || bd(x.at) === day) && (!q || `${x.detail} ${x.area}`.toLowerCase().includes(q)));
  return { log: L.slice(-1500).reverse().map(x => ({ ...x, name: user(x.uid)?.name || "Removed ID" })), total: L.length };
};
function agentTrail(type, d, out, who, ip, ua) {
  try {
    if (!AG_TRAIL[type] || !who || who.role !== "agent" || (type !== "raims.preEc" && out?.error)) return;
    if ((type === "auth.login" || type === "auth.otp") && out?.otp) return; // waiting for the code: not signed in yet
    let detail = "", passport = "", ref = "";
    const amt = v => `৳ ${Number(v || 0).toLocaleString("en-IN")}`;
    if (type === "raims.preEc") { passport = ppNorm(d.passport); detail = out?.ok ? (out.entry?.name || (out.fields || []).find(([k, v]) => /name/i.test(k) && v)?.[1] || (out.alerts || [])[0] || "Checked") : (out?.problem || out?.error || "No result"); }
    else if (type === "agent.payment") { detail = [amt(d.amount), str(d.method, 40), str(d.ref, 80)].filter(Boolean).join(" · "); const l = [...db.ledger].reverse().find(x => x.agentId === who.id && x.type === "payment"); ref = l?.id || ""; }
    else if (type === "agent.clPayment") { const c = db.clearances.find(x => x.id === d.id); passport = c?.passport || ""; detail = [amt(d.amount), c?.ref, c?.name].filter(Boolean).join(" · "); }
    else if (type === "agent.clearance") { const w = d.workerId ? worker(d.workerId) : null; passport = (w?.passport || str(d.newWorker?.passport, 30)).toUpperCase(); detail = [w?.name || str(d.newWorker?.name, 120), str(d.country, 60)].filter(Boolean).join(" · "); }
    else if (type === "agent.workerSave") { passport = str(d.passport, 30).toUpperCase(); detail = str(d.name, 120); }
    else if (type === "agent.applyJob") { detail = `${job(d.jobId)?.title || "Job"} · ${(d.workerIds || []).length} worker(s)`; }
    else if (type === "agent.ticket") { detail = `${str(d.from, 80)} → ${str(d.to, 80)}`; }
    const e = { id: id("h"), at: now(), agentId: who.id, type, what: AG_TRAIL[type], detail: str(detail, 200), passport, ...(ref ? { ref } : {}), ip: String(ip || "").replace(/^::ffff:/, ""), device: device(ua), loc: db.ipGeo[ip]?.loc || "" };
    db.agentLog.push(e); if (db.agentLog.length > 20000) db.agentLog.splice(0, db.agentLog.length - 20000);
    if (!e.loc) ipPlace(ip).then(loc => { if (loc) { e.loc = loc; save(); } });
  } catch (err) { console.error("agentTrail", err); }
}
A["admin.agentLog"] = async (d, u) => {
  must(u && isStaffRole(u) && (u.role === "admin" || PP_PERMS.some(k => can(u, k))), "You do not have permission for this.", 403);
  const nm = id => { const x = db.users.find(y => y.id === id); return x ? agentName(x) : "—"; };
  if (d.preEc) return { log: db.agentLog.filter(x => x.type === "raims.preEc").slice(-500).reverse().map(x => ({ ...x, agent: nm(x.agentId) })) };
  must(db.users.some(x => x.id === d.agentId && x.role === "agent"), "Agent not found.");
  const log = db.agentLog.filter(x => x.agentId === d.agentId);
  // payments from before the history began (no address recorded)
  const seen = new Set(log.map(x => x.ref).filter(Boolean));
  const older = db.ledger.filter(l => l.agentId === d.agentId && l.type === "payment" && !seen.has(l.id) && !log.some(x => x.type === "agent.payment" && Math.abs(Date.parse(x.at) - Date.parse(l.at)) < 5000))
    .map(l => ({ id: "old" + l.id, at: l.at, type: "agent.payment", what: "Payment", detail: [`৳ ${Number(l.amount || 0).toLocaleString("en-IN")}`, l.method, l.ref, l.desc].filter(Boolean).join(" · "), ip: "", device: "", loc: "" }));
  return { log: [...log, ...older].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 1000) };
};
/* ---- RAIMS Clearance Check (…/agency/employee/clearance-check): passport number or Clearance ID → the clearance
   information and the Clearance ID (IT-I-2026-6009034) whose EC card is at …/clearance-check/download/card/<Clearance ID> ---- */
const CC_ID = /\b([A-Z]{1,4}-[A-Z]{1,3}-\d{4}-\d{4,})\b/;
const CC_LABELS = ["Name", "BMET No", "Clearance ID", "Clearance Type", "Clearance Date", "Permit Id", "Visa No", "Visa Issue Date", "Visa Expire Date", "Country", "Post", "Employer Name", "Employer Address",
  "Agent Name", "Agent License No", "Agent Address", "Passport Number", "Passport Issue Date", "Passport Expire Date", "Father's Name", "Mother's Name", "NID Number", "Phone Number", "Present Address", "Permanent Address"];
const CC_KEYS = { "Name": ["name", "name_en", "full_name", "employee_name"], "BMET No": ["registration_no", "bmet_no", "bmet_registration_no", "reg_no"], "Clearance ID": ["clearance_id", "clearance_no", "ec_no", "ec_number", "card_no"],
  "Clearance Type": ["clearance_type", "type"], "Clearance Date": ["clearance_date", "approved_at", "issue_date_time"], "Permit Id": ["permit_id", "ic_no", "ic_number", "permission_id", "application_no"], "Visa No": ["visa_no", "visa_number"],
  "Visa Issue Date": ["visa_issue_date"], "Visa Expire Date": ["visa_expire_date", "visa_expiry_date"], "Country": ["country", "country_name", "destination_country"], "Post": ["post", "designation", "profession", "occupation"],
  "Employer Name": ["employer_name", "company_name"], "Employer Address": ["employer_address", "company_address"], "Agent Name": ["agent_name", "agency_name", "ra_name"], "Agent License No": ["agent_license_no", "license_no", "rl_no"],
  "Agent Address": ["agent_address", "agency_address"], "Passport Number": ["passport_number", "passport_no"], "Passport Issue Date": ["passport_issue_date", "issue_date"], "Passport Expire Date": ["passport_expire_date", "passport_expiry_date", "expire_date"],
  "Father's Name": ["fathers_name", "father_name"], "Mother's Name": ["mothers_name", "mother_name"], "NID Number": ["national_id", "nid", "nid_number"], "Phone Number": ["mobile", "phone", "phone_number"],
  "Present Address": ["present_address"], "Permanent Address": ["permanent_address"] };
function ccFromJson(j) {
  const m = {}; const walk = (v, k) => { if (Array.isArray(v)) v.forEach(x => walk(x, k)); else if (v && typeof v === "object") Object.entries(v).forEach(([a, b]) => walk(b, a)); else if (k && !(k.toLowerCase() in m) && v != null && String(v).trim() !== "" && String(v) !== "null") m[k.toLowerCase()] = String(v).trim(); };
  walk(j);
  const F = CC_LABELS.map(l => [l, (CC_KEYS[l] || []).map(k => m[k]).find(Boolean) || ""]).filter(([, v]) => v);
  const all = JSON.stringify(j); const id = (F.find(([k]) => k === "Clearance ID") || [])[1] || (CC_ID.exec(all) || [])[1] || "";
  if (id && !F.some(([k]) => k === "Clearance ID")) F.splice(Math.min(2, F.length), 0, ["Clearance ID", id]);
  return F.length >= 3 ? { fields: F, id } : null;
}
function ccFromHtml(html) {
  const P = String(html || "").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<form\b[\s\S]*?<\/form>|<select\b[\s\S]*?<\/select>/gi, " ").split(/<[^>]+>/).map(x => htmlText(x).trim()).filter(Boolean);
  const F = []; const L = new Map(CC_LABELS.map(l => [l.toLowerCase(), l]));
  for (let i = 0; i < P.length - 1; i++) { const lab = L.get(P[i].replace(/\s*:\s*$/, "").toLowerCase()); if (!lab || F.some(([k]) => k === lab)) continue; const v = P[i + 1]; if (!v || L.has(v.replace(/\s*:\s*$/, "").toLowerCase())) continue; F.push([lab, v]); }
  const id = (CC_ID.exec((F.find(([k]) => k === "Clearance ID") || [])[1] || "") || /download\/card\/([A-Z]{1,4}-[A-Z]{1,3}-\d{4}-\d{4,})/i.exec(html) || [])[1] || "";
  const G = F.filter(([k, v]) => k !== "Clearance ID" || CC_ID.test(v)); if (id && !G.some(([k]) => k === "Clearance ID")) G.push(["Clearance ID", id]);
  return G.length >= 3 || id ? { fields: CC_LABELS.map(l => G.find(([k]) => k === l)).filter(Boolean), id } : null;
}
async function clearanceCheck({ q, by }) {
  const v = String(q || "").trim().toUpperCase().replace(/\s+/g, ""), isId = by === "id" || CC_ID.test(v);
  must(isId ? CC_ID.test(v) : /^[A-Z0-9]{6,15}$/.test(v), isId ? "Enter the Clearance ID, e.g. IT-I-2026-6009034." : "Enter the passport number.");
  for (let attempt = 0; attempt < 2; attempt++) {
    const J = await raimsLogin(attempt > 0);
    const pg = await rq(J, "/agency/employee/clearance-check");
    if (/name="password"/i.test(pg.text) && /login/i.test(pg.url)) { raimsSess = null; continue; }
    const tok = (/name="_token"[^>]*value="([^"]+)"/.exec(pg.text) || /name="csrf-token"[^>]*content="([^"]+)"/.exec(pg.text) || [])[1] || "";
    const tried = []; let got = null, raw = "";
    // 0) what the page itself does: POST clearance_input_type (1 passport, 2 Clearance ID) + passport_or_clearance_no, X-CSRF-TOKEN from the meta tag
    try {
      const csrf = (/name="csrf-token"[^>]*content="([^"]+)"/.exec(pg.text) || [])[1] || tok;
      const fd = new URLSearchParams({ clearance_input_type: isId ? "2" : "1", passport_or_clearance_no: v });
      const x = await rq(J, "/agency/employee/clearance-check", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-CSRF-TOKEN": csrf, "X-Requested-With": "XMLHttpRequest", Accept: "application/json", Referer: pg.url }, body: fd.toString() });
      tried.push(`POST /agency/employee/clearance-check → ${x.r.status} ${htmlText(x.text).replace(/\s+/g, " ").slice(0, 120)}`);
      const j = JSON.parse(x.text);
      if (j.success && j.payload) { const R = j.payload.payload || j.payload, A = R.ADDRESS || {};
        const F = [["Name", R.NAME], ["BMET No", R.EMP_REG_ID], ["Clearance ID", R.CLEARANCE_ID], ["Clearance Type", R.CLEARANCE_TYPE], ["Clearance Date", R.CLEARANCE_DATE], ["Permit Id", R.APPLICATION_REF_NO], ["Visa No", R.VISA_NO],
          ["Visa Issue Date", R.VISA_ISSUE_DATE], ["Visa Expire Date", R.VISA_EXPIRE_DATE], ["Country", R.COUNTRY], ["Post", R.JOB_CATEGORY], ["Employer Name", R.EMPLOYER_NAME], ["Employer Address", R.EMPLOYER_ADDRESS],
          ["Agent Name", R.AGENT_NAME], ["Agent License No", R.AGENT_LICENSE_NO], ["Agent Address", R.AGENT_ADDRESS], ["Referral No", R.REFERRAL_NO], ["Sponsor ID", R.SPONSOR_ID], ["Passport Number", R.PASSPORT_ID], ["Passport Issue Date", R.ISSUE_DATE], ["Passport Expire Date", R.EXPIRE_DATE],
          ["Father's Name", R.FATHER_NAME], ["Mother's Name", R.MOTHER_NAME], ["NID Number", R.NID], ["Phone Number", R.PHONE],
          ["Present Address", [A.ML_ADDRESS, A.ML_VILL, A.ML_THANA, A.ML_DISTRICT, A.ML_DIVISION].filter(Boolean).join(", ")], ["Permanent Address", [A.PM_ADDRESS, A.PM_VILL, A.PM_THANA, A.PM_DISTRICT, A.PM_DIVISION].filter(Boolean).join(", ")]]
          .map(([k, x2]) => [k, x2 == null ? "" : String(x2).trim()]).filter(([, x2]) => x2 && x2 !== "null");
        got = { fields: F, id: String(R.CLEARANCE_ID || "").trim(), photo: R.PHOTO ? `data:${R.MYME_TYPE || "image/jpeg"};base64,${R.PHOTO}` : "" }; raw = x.text; }
      else if (j.success === false || j.message) { lastRaims.set("page", { url: "clearance-check", html: x.text.slice(0, 600000) }); return { ok: false, q: v, problem: j.message || "RAIMS did not show a clearance for this number.", tried }; }
    } catch (e) { tried.push(`POST clearance-check → ${e.message}`); }
    // 1) the page's own form (server-rendered result)
    const form = got ? null : [...pg.text.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].find(f => /passport|clearance/i.test(f[2]) && /action=/i.test(f[1]));
    if (form) {
      const names = [...form[2].matchAll(/<(?:input|select|textarea)\b[^>]*name="([^"]+)"[^>]*>/gi)].map(m => [m[1], m[0]]);
      const body = new URLSearchParams(); if (tok) body.set("_token", tok);
      for (const [n, tag] of names) {
        if (/^<select/i.test(tag)) { const sel = new RegExp(`<select[^>]*name="${n.replace(/[[\]]/g, "\\$&")}"[\\s\\S]*?<\\/select>`, "i").exec(form[2])?.[0] || ""; const opts = [...sel.matchAll(/<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/gi)].map(m => [m[1], htmlText(m[2])]);
          body.set(n, (opts.find(([, t]) => (isId ? /clearance/i : /passport/i).test(t)) || opts.find(([x]) => x) || [""])[0]); }
        else if (/type="hidden"/i.test(tag)) { if (n !== "_token") body.set(n, (/value="([^"]*)"/.exec(tag) || [])[1] || ""); }
        else if (/passport|clearance|number|search|value|keyword|input/i.test(n)) body.set(n, v);
      }
      const post = /method\s*=\s*"?post/i.test(form[1]), action = ((/action="([^"]*)"/i.exec(form[1]) || [])[1] || "/agency/employee/clearance-check").replace(/&amp;/g, "&");
      try { const x = post ? await rq(J, action, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: pg.url, "X-CSRF-TOKEN": tok }, body: body.toString() }) : await rq(J, action + (action.includes("?") ? "&" : "?") + body.toString());
        tried.push(`form ${post ? "POST" : "GET"} ${action} → ${x.r.status}`); got = ccFromHtml(x.text); raw = x.text; } catch (e) { tried.push(`form → ${e.message}`); }
    }
    // 2) the page's script addresses (as Pre EC Check: session cookie, XSRF token, the page's Bearer token)
    if (!got && !form) {
      const xsrf = decodeURIComponent(J.c["XSRF-TOKEN"] || ""), origin = new URL(pg.url).origin;
      const bm = /Bearer\s*["'`]?\s*\+?\s*["'`]?([A-Za-z0-9._|\-]{20,})/.exec(pg.text) || /(?:api_?token|access_?token|auth_?token|bearer_?token|jwt|token)["']?\s*[:=,]\s*["'`]([A-Za-z0-9._|\-]{20,})["'`]/i.exec(pg.text);
      const ck = Object.entries(J.c).find(([k, x]) => /token|jwt|auth/i.test(k) && !/xsrf|csrf/i.test(k) && x.length > 20), bearer = bm ? bm[1] : ck ? decodeURIComponent(ck[1]) : "";
      const xh = { "X-Requested-With": "XMLHttpRequest", Accept: "application/json, text/html, */*", "X-CSRF-TOKEN": tok, ...(xsrf ? { "X-XSRF-TOKEN": xsrf } : {}), ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), Referer: pg.url, Origin: origin };
      // the page's own addresses first, then the RAIMS API addresses built like Pre EC Check's (/api/v1/agency/employee/pre-ec-check/details/…)
      const T = isId ? ["clearance_id", "clearance", "2"] : ["passport", "1"];
      const hints = [...new Set([...dataHints(pg.text).filter(u => /clearance|check|passport|search|employee/i.test(u) && !/download\/card/i.test(u)).slice(0, 6),
        ...T.map(t => `/api/v1/agency/employee/clearance-check/details/${t}/${v}`), `/api/v1/agency/employee/clearance-check/details/${v}`, `/api/v1/agency/employee/clearance-check/${v}`,
        `/api/v1/agency/employee/clearance-check?input_type=${T[0]}&search_value=${v}&passport_no=${v}&clearance_id=${v}`, `/agency/employee/clearance-check/search?input_type=${T[0]}&search_value=${v}`])].slice(0, 14);
      for (const h of hints) {
        const u = h.replace(/:([a-z_]+)/gi, (all, k) => /type|input/i.test(k) ? (isId ? "clearance" : "passport") : /^\d+$/.test(k) ? all : encodeURIComponent(v)).replace(/\{[^}]*\}|\$\{[^}]*\}/g, v);
        for (const m of ["GET", "POSTJSON"]) {
          let x; try { x = m === "GET" ? await rq(J, u + (u.includes(v) ? "" : (u.includes("?") ? "&" : "?") + `type=${isId ? "clearance" : "passport"}&passport=${v}&search=${v}`), { headers: xh })
            : await rq(J, u, { method: "POST", headers: { ...xh, "Content-Type": "application/json" }, body: JSON.stringify({ type: isId ? "clearance" : "passport", input_type: isId ? "clearance_id" : "passport", passport: v, passport_no: v, clearance_id: v, search: v }) }); }
          catch (e) { tried.push(`${m} ${u} → ${e.message}`); continue; }
          tried.push(`${m} ${u} → ${x.r.status} ${htmlText(x.text).replace(/\s+/g, " ").slice(0, 80)}`);
          if (x.r.status >= 400) continue;
          try { const j = JSON.parse(x.text); got = (typeof j?.html === "string" && ccFromHtml(j.html)) || ccFromJson(j); } catch { got = ccFromHtml(x.text); }
          if (got) { raw = x.text; break; }
        }
        if (got) break;
      }
      if (!hints.length) tried.push("the page names no search address");
    }
    lastRaims.set("page", { url: "clearance-check", html: String(raw || pg.text).slice(0, 600000) });
    if (!got) return { ok: false, q: v, problem: "RAIMS did not show a clearance for this number.", tried };
    const pp = (got.fields.find(([k]) => k === "Passport Number") || [])[1] || (isId ? "" : v);
    // the file here with this passport takes the Clearance ID (for Download Card / Send Card)
    if (got.id && pp) for (const c of db.clearances) if (ppNorm(worker(c.workerId)?.passport || user(c.candidateId)?.profile?.passportNo || c.passport || "") === ppNorm(pp) && !c.cardNo) c.cardNo = got.id;
    return { ok: true, q: v, id: got.id, passport: pp, fields: got.fields, photo: got.photo || "" };
  }
  must(false, "RAIMS signed out. Try again.");
}
A["raims.clearanceCheck"] = async (d, u) => { needPerm(u, "clearance"); limit(u.id, "cccheck", 200, 3600e3); return await clearanceCheck(d); };
A["raims.preEc"] = async (d, u, ctx) => { // uses the admin's RAIMS sign-in
  must(u && (u.role === "agent" ? u.status === "active" : can(u, "clearance")), "You do not have permission for this.", 403);
  limit(u.id, "preec", u.role === "agent" ? 40 : 200, 3600e3);
  const r = await preEcCheck(d);
  if (u.role !== "admin" && !r.ok) { // agents and staff see a plain message, not what the agency's RAIMS session read
    const nf = r.notFound || /did not show a result|not found/i.test(r.problem || "");
    return { ok: false, passport: r.passport, canManual: !nf, problem: nf ? "No information on BMET for this passport. Check the passport number." : "BMET could not be checked right now. Please try again in a few minutes." };
  }
  return r;
};
A["admin.raims"] = async (d, u) => {
  needPerm(u, "clearance");
  if (d.op === "save") {
    must(u.role === "admin", "Only the admin can change the RAIMS sign-in.", 403);
    const email = str(d.email, 120).toLowerCase(); must(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), "Enter the RAIMS email.");
    db.raims = { ...(db.raims || {}), email, auto: d.auto !== false, ...(d.password ? { pass: seal(String(d.password).slice(0, 200)) } : {}) };
    must(db.raims.pass, "Enter the RAIMS password.");
    raimsSess = null; delete db.raims.cookies;
    try { await raimsLogin(true); } catch (e) { delete db.raims.pass; throw e; }
    return { msg: `Signed in to RAIMS as ${email}.` };
  }
  if (d.op === "rawPage") { must(u.role === "admin", "Only the admin can download this.", 403); const x = lastRaims.get("page"); must(x, "Search RAIMS first."); return { url: x.url, html: x.html }; }
  if (d.op === "remove" || d.op === "logout") {
    must(u.role === "admin", "Only the admin can change the RAIMS sign-in.", 403);
    try { raimsRestore(); if (raimsSess) { const pg = await rq(raimsSess.J, "/agency/dashboard"); const tok = (/name="csrf-token"[^>]*content="([^"]+)"/.exec(pg.text) || /name="_token"[^>]*value="([^"]+)"/.exec(pg.text) || [])[1] || "";
      const act = (/<form[^>]*action="([^"]*logout[^"]*)"/i.exec(pg.text) || [])[1] || "/agency/logout"; await rq(raimsSess.J, act.replace(/&amp;/g, "&"), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ _token: tok }).toString() }); } } catch {}
    raimsSess = null; delete db.raims; return { msg: "Logged out of RAIMS." };
  }
  /* Add bulk: an IC number or application ID → every worker under it (name, passport, country, IC number) */
  if (d.op === "lookup") {
    const raw = str(d.q, 300).trim(), q = raw.replace(/\s+/g, "").toUpperCase(); must(q.length >= 3, "Enter the IC number, the RAIMS link or its number.");
    const norm = v => String(v || "").replace(/\s+/g, "").toUpperCase(), PPR = /\b([A-Z]{1,2}\d{7,8})\b/;
    // the RAIMS page of one application (…/agency/ec/application/individual/1705123/show): its workers
    const showPage = async (J, link, ic0, country0, key0) => {
      const pg = await rq(J, link), txt = htmlText(pg.text), title = htmlText((/<title>([\s\S]*?)<\/title>/i.exec(pg.text) || [])[1] || ""), tables = (pg.text.match(/<table/gi) || []).length;
      must(!/name="password"/i.test(pg.text), "RAIMS signed out. Try again.");
      // the application's IC number; an IC-… number written after an employer / company registration label is not it
      const icp = (() => { const P = pg.text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").split(/<[^>]+>/).map(x => htmlText(x)).filter(Boolean);
        let fallback = ""; for (let i = 0; i < P.length; i++) { const m = /\bIC[-\s]?\d{4}[-\s]?[A-Z0-9]+[-\s]?\d+/i.exec(P[i]); if (!m) continue;
          const lab = P.slice(Math.max(0, i - 2), i).join(" ") + " " + P[i].slice(0, m.index);
          if (/registration|employer|company|owner|permission|demand|visa/i.test(lab)) continue;
          if (/\b(IC|EC|clearance)\b/i.test(lab)) return norm(m[0]); if (!fallback) fallback = norm(m[0]); }
        return ic0 || fallback; })();
      const ctry = country0 || (() => { const i = txt.search(/country/i); if (i < 0) return ""; const seg = txt.slice(i, i + 80).toLowerCase(); let best = ""; let at = 1e9;
        for (const c of [...Object.keys(COUNTRIES), ...CL_REGIONS.flatMap(([, L]) => L)]) { const j = seg.indexOf(c.toLowerCase()); if (j >= 0 && (j < at || (j === at && c.length > best.length))) { at = j; best = c; } } return best; })();
      const people = [];
      { const rid = (/individual\/(\d+)/.exec(link) || [])[1], ak = raimsApiKey(pg.text) || key0;
        if (rid && ak) { const a = await raimsAppApi(J, rid, ak, pg.url).catch(() => ({ people: [] })); for (const x of a.people) people.push({ ic: icp, name: x.name, passport: x.passport, country: x.country || ctry }); } }
      if (!people.length) for (const m of pg.text.matchAll(/<table[\s\S]*?<\/table>/gi)) {
        const t = raimsRows(m[0]); if (!t.rows.some(r => PPR.test(r.join(" ")))) continue;
        const H = t.head.map(h => h.toLowerCase()), c = re => H.findIndex(h => re.test(h)), ci = { name: c(/name/), pp: c(/passport/), country: c(/country|destination/), ic: c(/\bic\b|clearance/) };
        for (const r of t.rows) { const pp = (PPR.exec(r.join(" ")) || [])[1]; if (!pp) continue;
          people.push({ ic: (ci.ic >= 0 && norm(r[ci.ic])) || icp, name: ci.name >= 0 ? r[ci.name] : r.find(v => /^[A-Za-z][A-Za-z .'-]{4,}$/.test(v) && /\s/.test(v) && !PPR.test(v)) || "", passport: pp, country: (ci.country >= 0 && r[ci.country]) || ctry }); }
      }
      if (!people.length) { // the page fills its list with a script: read the same addresses the script reads
        const xsrf = (/name="csrf-token"[^>]*content="([^"]+)"/.exec(pg.text) || [])[1] || "";
        const objs = []; const walk = v => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") { if (Object.values(v).some(x => typeof x === "string" && /^[A-Z]{1,2}\d{7,8}$/.test(x.trim()))) objs.push(v); else Object.values(v).forEach(walk); } };
        for (const h of dataHints(pg.text).filter(u => /ec|worker|emigrant|applica|passport|individual|candidate/i.test(u)).slice(0, 5)) {
          try { const ak = raimsApiKey(pg.text), x = await rq(J, h, { headers: { "X-Requested-With": "XMLHttpRequest", Accept: "application/json, text/html", "X-CSRF-TOKEN": xsrf, ...(ak && /api\/v\d/.test(h) ? { Authorization: `Bearer ${ak}` } : {}) } });
            try { walk(JSON.parse(x.text)); } catch { for (const m of x.text.matchAll(/<table[\s\S]*?<\/table>/gi)) { const t = raimsRows(m[0]), H = t.head.map(z => z.toLowerCase()), ni = H.findIndex(z => /name/.test(z)); for (const r of t.rows) { const pp = (PPR.exec(r.join(" ")) || [])[1]; if (pp) people.push({ ic: icp, name: ni >= 0 ? r[ni] : "", passport: pp, country: ctry }); } } }
          } catch {}
        }
        for (const o of objs) { const e = Object.entries(o), pp = e.find(([, v]) => typeof v === "string" && /^[A-Z]{1,2}\d{7,8}$/.test(v.trim()))[1].trim();
          const nm = (e.find(([k, v]) => /name/i.test(k) && !/father|mother|spouse|agency|agent|employer|company|file|user/i.test(k) && typeof v === "string") || [])[1] || "";
          const ct = (e.find(([k, v]) => /country/i.test(k) && typeof v === "string") || [])[1] || ctry;
          people.push({ ic: icp, name: String(nm).trim(), passport: pp, country: ct }); }
      }
      // pages laid out as label / value boxes (RAIMS cards): read the text pieces in order
      const N = pg.text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").split(/<[^>]+>/).map(x => htmlText(x)).filter(Boolean);
      const isLab = x => x.length < 60 && /[a-z]/.test(x) && !PPR.test(x);
      const valOf = re => { for (let i = 0; i < N.length - 1; i++) if (re.test(N[i]) && isLab(N[i])) { const v = N[i + 1]; if (v && !(isLab(v) && /:$|number|name|date|country/i.test(v))) return v; } return ""; };
      const icLabel = valOf(/^(IC|EC|Clearance)\s*(No\.?|Number|Ref\.?)?\s*:?$/i).replace(/\s+/g, "").toUpperCase();
      const country2 = ctry || valOf(/^(Destination\s*)?Country\s*:?$/i);
      const nameRe = /^((emigrant|worker|candidate|applicant|migrant|passport\s*holder)('?s)?\s*)?(full\s*)?name(\s*\(.*\))?\s*:?$/i, notName = /father|mother|spouse|employer|company|owner|contact|agency|agent|nominee|user|bank|person/i;
      // RAIMS cards: each "Employee Information - n" block has "Name" then its value, "Passport Number" then its value — read exactly those
      { const starts = N.map((x, i) => /^Employee Information\b/i.test(x) ? i : -1).filter(i => i >= 0);
        starts.forEach((st, bi) => { const B = N.slice(st, starts[bi + 1] ?? N.length);
          const after = re => { const k = B.findIndex(x => re.test(x.trim())); return k >= 0 ? (B[k + 1] || "").trim() : ""; };
          const nm = after(/^Name\s*:?$/i), pp = after(/^Passport\s*(No\.?|Number)\s*:?$/i).replace(/\s+/g, "").toUpperCase();
          if (!/^[A-Z0-9]{6,15}$/.test(pp)) return; const ex = people.find(x => x.passport === pp);
          if (ex) { if (!ex.name && nm && !/^(N\/?A|-|—)$/i.test(nm)) ex.name = nm; return; }
          people.push({ ic: icLabel || icp, name: /^(N\/?A|-|—)$/i.test(nm) ? "" : nm, passport: pp, country: after(/^Visa Issue Country\s*:?$/i) || country2 }); }); }
      // a number is a passport only when its label says so: visa / work-permit / sticker numbers (e.g. Maldives ST00078814, WP00851002) look the same
      const ppLabelled = N.some(x => /^passport\s*(no\.?|number)?\s*:?$/i.test(x));
      const labelOf = i => { for (let j = i - 1; j >= Math.max(0, i - 3); j--) if (isLab(N[j])) return N[j]; return ""; };
      for (let i = 0; i < N.length; i++) {
        const pp = (/^\s*([A-Z]{1,2}\d{7,8})\s*$/.exec(N[i]) || [])[1]; if (!pp || people.some(x => x.passport === pp)) continue;
        const lab = labelOf(i); if (/visa|sticker|permit|referral|sponsor|returnee|demand|job/i.test(lab) || (ppLabelled && !/passport/i.test(lab))) continue;
        // the value after a "Name" label (names can be "RAJU AHMED" or "Raju Ahmed"; the next label is not a name)
        const nameVal = v => !!v && v.length <= 80 && !/:\s*$/.test(v) && !PPR.test(v) && !/\d{3,}/.test(v) && !/\b(name|number|date|gender|address|type|country|place|passport|phone|mobile|nid|visa|sponsor|father|mother|issue|expire|referral|sticker|returnee|employee|information|documents?)\b/i.test(v);
        let nm = ""; for (let j = i - 1; j >= Math.max(0, i - 40); j--) { if (nameRe.test(N[j]) && !notName.test(N[j]) && nameVal(N[j + 1])) { nm = N[j + 1]; break; } if (/^\s*[A-Z]{1,2}\d{7,8}\s*$/.test(N[j])) break; }
        if (!nm) for (let j = i + 1; j < Math.min(N.length, i + 30); j++) { if (/^\s*[A-Z]{1,2}\d{7,8}\s*$/.test(N[j])) break; if (nameRe.test(N[j]) && !notName.test(N[j]) && nameVal(N[j + 1])) { nm = N[j + 1]; break; } }
        people.push({ ic: icLabel || icp, name: nm, passport: pp, country: country2 });
      }
      for (const x of people) { if (!x.ic) x.ic = icLabel || icp; if (!x.country) x.country = country2; }
      lastRaims.set("page", { url: pg.url, html: pg.text.slice(0, 600000) });
      return { people, txt, title, url: pg.url, tables, hints: dataHints(pg.text) };
    };
    // a RAIMS page link pasted as it is (any page on raims.oep.gov.bd), or only the number in such a link
    const link = /^https?:\/\/raims\.oep\.gov\.bd(\/[^\s]*)$/i.exec(raw)?.[1] || (/^(\d{4,10})$/.test(raw) ? `/agency/ec/application/individual/${raw}/show` : "");
    if (link) {
      const { J } = await raimsOpen(); const r = await showPage(J, link);
      if (!r.people.length) return { problem: "That RAIMS page has no workers that this site can read.", seen: { page: link, title: r.title, url: r.url, text: r.txt.slice(0, 1500), tables: r.tables, hints: r.hints } };
      return { people: r.people.slice(0, 100) };
    }
    // the RAIMS list API (the same one the RAIMS list page uses) finds the application; its own page gives the workers
    try {
      const A2 = await raimsApiList(q), hits = A2.raw.filter(r => norm(String(r.ref_no || "")).includes(q) || JSON.stringify(r).toUpperCase().includes(q)).slice(0, 20);
      let people = [];
      for (const r of hits) {
        const ic = norm(String(r.ref_no || "")), ct = r.country?.name || "";
        const objs = []; const walk = v => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") { const pv = Object.entries(v).find(([k, x]) => /passport/i.test(k) && typeof x === "string" && /^[A-Z]{1,2}\d{7,8}$/.test(x.trim())); if (pv) objs.push([v, pv[1].trim()]); else Object.values(v).forEach(walk); } }; walk(r);
        if (objs.length) { for (const [o, pp] of objs) people.push({ ic, name: String((Object.entries(o).find(([k, x]) => /name/i.test(k) && !/father|mother|spouse|agency|agent|employer|company|file|user|country|bn|bangla/i.test(k) && typeof x === "string") || [])[1] || "").trim(), passport: pp, country: ct }); continue; }
        if (r.id) { const x = await showPage(A2.J, `/agency/ec/application/individual/${r.id}/show`, ic, ct, A2.key); people.push(...x.people); }
      }
      const seen = new Set(); people = people.filter(x => x.passport && !seen.has(x.passport) && seen.add(x.passport));
      if (people.length) return { people: people.slice(0, 100), via: "api" };
    } catch {}
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
  if (d.op === "api") { // which RAIMS API addresses its own pages use (read only): helps move each task to the API
    must(u.role === "admin", "Only the admin can do this.");
    const J = await raimsLogin(), out = { pages: [] }, jsSeen = new Map();
    const apis = raimsApis;
    for (const path of ["/agency/dashboard", "/agency/ec/application/list", "/agency/employee/pre-ec-check", "/agency/employee/clearance-check", ...(d.page && /^\/agency\/[\w\/-]{3,120}$/.test(d.page) ? [d.page] : [])]) {
      try { const pg = await rq(J, path); if (/name="password"/i.test(pg.text) && /login/i.test(pg.url)) { out.pages.push({ path, error: "signed out" }); continue; }
        const found = new Set([...apis(pg.text), ...dataHints(pg.text)]);
        for (const src of [...pg.text.matchAll(/<script[^>]*src="([^"]+)"/gi)].map(m => m[1].replace(/&amp;/g, "&")).filter(x => !/jquery|bootstrap|cdn|select2|datatables|moment|sweetalert|toastr|chart/i.test(x) && (/^\//.test(x) || /raims\.oep\.gov\.bd/i.test(x))).slice(0, 12)) {
          if (!jsSeen.has(src)) { try { const x = await rq(J, src); jsSeen.set(src, apis(x.text)); } catch { jsSeen.set(src, []); } }
          for (const a of jsSeen.get(src)) found.add(a);
        }
        out.pages.push({ path, key: !!raimsApiKey(pg.text), apis: [...found].slice(0, 40) }); } catch (e) { out.pages.push({ path, error: e.message }); }
    }
    return out;
  }
  if (d.op === "sync") { const r = await raimsSync(u.name); return r.ok ? { msg: `RAIMS: ${r.rows} files read, ${r.matched} matched, ${r.updated.length} updated.` } : { problem: r.error }; }
  must(false, "Unknown request.");
};
/* change the agent (reference) of a clearance file: a registered agent, or a name (Self, a book agent …).
   The file's worker, its Passport Entry Ref. and the charges the file added to the agent account move with it. */
A["admin.clAgent"] = async (d, u) => {
  needPerm(u, "clearance"); const c = db.clearances.find(x => x.id === d.id); must(c, "File not found.");
  must(!c.candidateId, "This file belongs to a job seeker, not an agent.");
  const ag = d.agentId ? db.users.find(x => x.id === d.agentId && x.role === "agent") : null; must(!d.agentId || ag, "Agent not found.");
  const name = ag ? "" : str(d.agentName, 120); must(ag || name.length >= 2, "Choose the agent or write a name.");
  const oldId = c.agentId || null, oldName = oldId ? agentName(user(oldId)) : c.agentName || "—", newName = ag ? agentName(ag) : name;
  if ((ag && oldId === ag.id) || (!ag && !oldId && c.agentName === name)) return { msg: "The agent is the same." };
  const w = c.workerId ? worker(c.workerId) : null, wname = w?.name || c.fullName || "";
  c.agentId = ag ? ag.id : null; if (ag) delete c.agentName; else c.agentName = name;
  if (w) { w.agentId = ag ? ag.id : null; if (ag) delete w.agentName; else w.agentName = name; }
  // the processing fee / previous due this file charged move to the new registered agent
  let moved = 0, left = 0;
  if (oldId) for (const l of db.ledger) if (l.agentId === oldId && clOwns(l, c, wname)) { if (ag) { l.agentId = ag.id; moved++; } else left++; }
  const pp = w ? db.passports.find(x => x.passport === ppNorm(w.passport)) : null; if (pp) { pp.agentId = ag ? ag.id : null; pp.ref = newName; }
  c.history.push({ s: c.status, t: `Agent changed: ${oldName} → ${newName}`, at: now(), by: u.name });
  if (ag) notify(ag.id, `BMET clearance file ${c.ref} (${wname}) is now under your account.`);
  if (oldId && oldId !== ag?.id) notify(oldId, `BMET clearance file ${c.ref} (${wname}) was moved to another agent.`);
  return { msg: `Agent changed to ${newName}.${moved ? ` ${moved} charge(s) moved to the new agent's account.` : ""}${left ? ` ${left} charge(s) stay on ${oldName}'s account: adjust it in Agent accounts.` : ""}` };
};
/* the EC reference number can be set or changed by the agency until the file is Approved */
A["admin.clRef"] = async ({ id: cid, ref }, u) => {
  needPerm(u, "clearance"); const c = db.clearances.find(x => x.id === cid); must(c, "File not found.");
  must(c.status !== "approved" && !c.card, "The EC Ref No cannot be changed after the file is Approved.");
  const r = str(ref, 40).toUpperCase().replace(/\s+/g, ""); must(/^[A-Z0-9][A-Z0-9\-/]{3,39}$/.test(r), "Enter a valid EC Ref No (letters, numbers and dashes).");
  // an IC number from RAIMS covers all the workers of one application: several files may share it
  must(/^IC/.test(r) || !db.clearances.some(x => x.id !== c.id && String(x.ref || "").toUpperCase() === r), "Another file already has this EC Ref No.");
  if (/^IC/.test(r)) c.icNo = r;
  c.ref = r; return { msg: `EC Ref No saved: ${r}` };
};
A["admin.card"] = async ({ id: cid, file, fee, other }, u) => {
  needPerm(u, "clearance"); const c = db.clearances.find(x => x.id === cid); must(c && c.status === "approved", "Upload the card after the file is Approved.");
  const owner = c.agentId || c.candidateId; const ref = storeFile(file, owner || u.id);
  // a fee is charged once: a card sent again keeps the fee already charged; one sent first with no fee can get it now
  const replacing = !!c.card, had = Number(c.card?.fee || 0), f = had > 0 ? had : numv(fee, 0, 1e7), charge = had <= 0 && f > 0;
  // Others fee (optional): "Stamp fee" unless a custom name is written; charged once, like the card fee
  const oHad = c.card?.other?.amount > 0 ? c.card.other : null, oAmt = oHad ? 0 : numv(other?.amount, 0, 1e7);
  const oth = oHad || (oAmt > 0 ? { label: str(other?.label, 60) || "Stamp fee", amount: oAmt } : null);
  if (c.card) dropFile(c.card);
  const isCand = !c.agentId;
  c.card = { ...ref, fee: f, ...(oth ? { other: oth } : {}), feeNote: isCand && f > 0 ? (c.card?.feePaid ? "paid" : "pay at the office") : "", sentAt: now(), feePaid: c.card?.feePaid || c.payment?.status === "paid" || false };
  const name = c.workerId ? worker(c.workerId)?.name : c.fullName;
  if (charge && c.agentId) db.ledger.push(clCharge(c.agentId, c, "BMET clearance card fee", f));
  if (oAmt > 0 && c.agentId) db.ledger.push(clCharge(c.agentId, c, oth.label, oAmt));
  notify(owner, `${replacing ? "Updated clearance card" : "Clearance card"} for ${name} is ready. Download it from your portal${charge ? `. Card fee: ${bdt(f)}` : ""}${oAmt > 0 ? `. ${oth.label}: ${bdt(oAmt)}` : ""}.`);
  return { msg: (c.agentId ? "Clearance card sent to the agent." : c.candidateId ? "Clearance card sent to the job seeker." : "Clearance card saved.") + ((charge || oAmt > 0) && !c.candidateId ? ` ${[charge ? `Card fee ${bdt(f)}` : "", oAmt > 0 ? `${oth.label} ${bdt(oAmt)}` : ""].filter(Boolean).join(" and ")} added to ${c.agentId ? agentName(user(c.agentId)) : c.agentName || "the agent"}'s account.` : "") };
};
/* the EC card PDF RAIMS gives at …/clearance-check/download/card/<Clearance ID> */
async function raimsCardFile(no) {
  let buf = null, type = "", why = "";
  // two addresses give the card: …/clearance-check/download/card/<ID> and …/ec/application/<ID>/card
  const urls = [`/agency/employee/clearance-check/download/card/${encodeURIComponent(no)}`, `/agency/ec/application/${encodeURIComponent(no)}/card`];
  for (let attempt = 0; attempt < 2 && !buf; attempt++) {
    const J = await raimsLogin(attempt > 0); let signedOut = false;
    for (const u of urls) {
      const r = await fetch(RAIMS + u, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0 (MAM Overseas portal)", Accept: "application/pdf,image/*,*/*", Cookie: J.get() }, signal: AbortSignal.timeout(45000) });
      J.set(r); const b = Buffer.from(await r.arrayBuffer());
      if (r.status >= 300 && r.status < 400) { signedOut = /login/i.test(r.headers.get("location") || "login"); why = `${r.status}`; continue; }
      if (!r.ok) { why = `${r.status}`; continue; }
      if (b.slice(0, 4).toString() === "%PDF") { buf = b; type = "application/pdf"; break; }
      if (b[0] === 0xff && b[1] === 0xd8) { buf = b; type = "image/jpeg"; break; }
      if (b.slice(1, 4).toString() === "PNG") { buf = b; type = "image/png"; break; }
      if (/name="password"/i.test(b.toString("utf8", 0, 20000))) signedOut = true; why = "not a card";
    }
    if (!buf && !signedOut) break; if (signedOut) raimsSess = null;
  }
  must(buf, why === "not a card" || /^4/.test(why) ? `RAIMS did not give a card for ${no}. Check the Clearance ID.` : "RAIMS signed out. Sign in to RAIMS again from BMET clearance › RAIMS.");
  const ext = type === "application/pdf" ? "pdf" : type === "image/png" ? "png" : "jpg";
  const file = { name: `${no}.${ext}`, data: `data:${type};base64,${buf.toString("base64")}` };
  return file;
}
A["raims.ecCard"] = async (d, u) => { needPerm(u, "clearance"); const no = str(d.no, 40).toUpperCase().replace(/\s+/g, ""); must(CC_ID.test(no), "Enter the Clearance ID, e.g. IT-I-2026-6009034."); return { file: await raimsCardFile(no) }; };
/* the clearance card from RAIMS (…/agency/employee/clearance-check/download/card/IT-I-2026-6009034):
   download it here, or send it to the agent's portal (as the file's clearance card) */
A["admin.clRaimsCard"] = async (d, u) => {
  needPerm(u, "clearance"); const c = db.clearances.find(x => x.id === d.id); must(c, "File not found.");
  let no = str(d.no, 40).toUpperCase().replace(/\s+/g, "");
  if (d.op === "find" || !no) { // the Clearance ID from RAIMS Clearance Check, by the file's passport number
    const pp = worker(c.workerId)?.passport || user(c.candidateId)?.profile?.passportNo || c.passport; must(pp, "This file has no passport number.");
    const r = await clearanceCheck({ q: pp }); must(r.ok && r.id, "RAIMS Clearance Check did not show a Clearance ID for this passport yet.");
    c.cardNo = r.id; if (d.op === "find") return { msg: `Clearance ID from RAIMS: ${r.id}`, no: r.id }; no = r.id;
  }
  must(/^[A-Z]{1,4}(-[A-Z0-9]{1,12}){2,4}$/.test(no), "Enter the Clearance ID, e.g. IT-I-2026-6009034.");
  c.cardNo = no;
  if (d.op === "save") return { msg: `Card number saved: ${no}` };
  must(c.status === "approved", "The card can be taken after the file is Approved.");
  const file = await raimsCardFile(no);
  if (d.op === "send") { const r = await A["admin.card"]({ id: c.id, file, fee: d.fee, other: d.other }, u); return { ...r, msg: `${r.msg} (${no})` }; }
  return { file };
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
  must(d.ticketFile?.data, "Add the ticket copy.");
  const tf = storeFile(d.ticketFile, t.agentId || t.candidateId); // the agent / job seeker who asked can download it
  Object.assign(t, { airline: str(d.airline, 80), pnr: str(d.pnr, 20).toUpperCase(), flightDate: str(d.flightDate, 10), fare: numv(d.fare, 0, 1e7), status: "booked", ticketFile: tf, bookedAt: now() });
  const w = worker(t.workerId);
  if (d.charge && t.agentId && t.fare > 0) db.ledger.push({ id: id("l"), agentId: t.agentId, type: "charge", desc: `Air ticket ${t.from} → ${t.to}: ${w?.name}`, amount: t.fare, date: now().slice(0, 10), method: "", ref: t.pnr, status: "confirmed" });
  notify(t.agentId || t.candidateId, `Ticket confirmed for ${w?.name || t.name}: ${t.airline}, PNR ${t.pnr}, flight ${t.flightDate}. Download the ticket from Air tickets.`);
  return { msg: "Booking confirmed. The ticket is ready to download." };
};
A["admin.ticketCancel"] = async ({ id: tid }, u) => { needPerm(u, "tickets"); const t = db.tickets.find(x => x.id === tid); must(t && t.status === "requested", "Ticket not found."); t.status = "cancelled"; notify(t.agentId || t.candidateId, `Ticket request for ${worker(t.workerId)?.name || t.name} was cancelled by the agency.`); return { msg: "Request cancelled." }; };
A["admin.ledgerAdd"] = async (d, u) => { // one entry, or several at once (d.rows)
  needPerm(u, "ledger"); const ag = user(d.agentId); must(ag?.role === "agent", "Choose an agent.");
  const list = Array.isArray(d.rows) ? d.rows.slice(0, 50) : [d]; must(list.length, "Add at least one entry.");
  const made = list.map((x, i) => {
    const at = list.length > 1 ? ` (row ${i + 1})` : "";
    const charge = x.type !== "payment", qty = charge && x.qty != null && x.qty !== "" ? numv(x.qty, 1, 10000) : 1;
    const rate = x.rate != null && x.rate !== "" ? numv(x.rate, 0, 1e8) : numv(x.amount, 0, 1e8);
    const amount = Math.round(qty * rate * 100) / 100; must(amount >= 1 && amount <= 1e9 && str(x.desc), `Enter the amount and description${at}.`);
    return { id: id("l"), at: now(), agentId: ag.id, type: charge ? "charge" : "payment", desc: str(x.desc, 200), amount, ...(charge ? { qty, rate } : {}), date: /^\d{4}-\d{2}-\d{2}$/.test(x.date || "") ? x.date : now().slice(0, 10), method: charge || x.opening ? "" : str(x.method, 120), ref: charge ? "" : str(x.ref, 80), status: "confirmed", ...(x.opening ? { opening: true } : {}) };
  });
  db.ledger.push(...made);
  for (const l of made) if (!l.opening) notify(ag.id, l.type === "charge" ? `New charge on your account: ${l.desc.slice(0, 100)} (${bdt(l.amount)}).` : `Payment of ${bdt(l.amount)} recorded.`);
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
      phone: str(d.phone, 30), whatsapp: str(d.whatsapp, 20).replace(/\D/g, ""), email: str(d.email, 120), website: webUrl(d.website), order: numv(d.order ?? 99, 0, 999),
      names: { bn: str(d.name_bn, 80), ar: str(d.name_ar, 80), hi: str(d.name_hi, 80) } }; // the name in other languages (visiting cards)
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
  s.addresses = { bn: str(d.address_bn, 300), ar: str(d.address_ar, 300), hi: str(d.address_hi, 300) }; // office address in other languages (visiting cards)
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
/* the visitor's address. Our own proxy adds it last to X-Forwarded-For. When the site is behind Cloudflare that last address is a Cloudflare
   server (it changes all the time), so the real one is in CF-Connecting-IP — trusted only when the request really came from Cloudflare. */
const CF_NETS = ["173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22"]
  .map(c => { const [a, b] = c.split("/"); return [a.split(".").reduce((n, x) => n * 256 + +x, 0), +b]; });
const CF6 = ["2400:cb00:", "2606:4700:", "2803:f800:", "2405:b500:", "2405:8100:", "2a06:98c", "2a06:98c", "2c0f:f248:"];
const isCf = ip => { ip = String(ip || "").replace(/^::ffff:/, "").toLowerCase();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) { const n = ip.split(".").reduce((t, x) => t * 256 + +x, 0); return CF_NETS.some(([a, b]) => Math.floor(n / 2 ** (32 - b)) === Math.floor(a / 2 ** (32 - b))); }
  return CF6.some(p => ip.startsWith(p)); };
const clientIp = req => {
  const last = (req.headers["x-forwarded-for"] || "").split(",").pop().trim() || req.socket.remoteAddress || "";
  const cf = String(req.headers["cf-connecting-ip"] || "").trim();
  return cf && isCf(last) ? cf : last;
};
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
      agentTrail(body.type, body.payload || {}, out, ctx.user || u, ctx.ip, req.headers["user-agent"]);
      staffTrail(body.type, body.payload || {}, out, ctx.user || u, ctx.ip, req.headers["user-agent"]);
      for (const [t, s] of Object.entries(db.sessions)) if (Date.parse(s.exp) < Date.now()) delete db.sessions[t];
      save();
      if (ctx.redirect) out.redirect = ctx.redirect;
      return send(res, out.error ? 400 : 200, { ...out, state: { ...viewFor(ctx.user), rev: REV } }, setCookie.length ? { "Set-Cookie": setCookie } : {});
    } catch (e) {
      if (!(e instanceof Fail)) console.error(body.type, e);
      if (body.type === "raims.preEc" && e instanceof Fail) { agentTrail(body.type, body.payload || {}, { problem: e.message }, u, ctx.ip, req.headers["user-agent"]); staffTrail(body.type, body.payload || {}, { problem: e.message }, u, ctx.ip, req.headers["user-agent"]); }
      try { save(); } catch { /* ignore */ }
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
// this build of the site (changes on every deploy): an open page sees a new one and offers to reload
const BUILD = (() => { try { return crypto.createHash("sha1").update(fs.readFileSync(path.join(STATIC_DIR, "index.html"))).digest("hex").slice(0, 10); } catch { return String(Date.now()); } })();
function indexHtml(req) {
  const zone = hostZone(req);
  const site = { admin: zone === "admin", agent: zone === "agent", main: ADMIN_HOST || AGENT_HOST ? mainUrl() : "" }; // the admin panel's address is never sent to the public site
  const head = `<script>window.__SITE__=${JSON.stringify(site).replace(/</g, "\\u003c")}</script>${zone === "admin" || zone === "agent" ? '<meta name="robots" content="noindex, nofollow">' : ""}`;
  // the aipraktor chat widget is registered for the public site only (it refuses other addresses)
  // its button sits in the bottom corner, so our WhatsApp / chat / "i" buttons move up above it
  const body = zone === "main" ? AI_WIDGET : "";
  // the page's own code (inlined) can hold these words in its text, so insert at the first </head> (before the code) and the last </body>
  const html = fs.readFileSync(path.join(STATIC_DIR, "index.html"), "utf8").replace(/__ORIGIN__/g, escHtml(siteOrigin(req))).replace("</head>", () => head + "</head>");
  const at = html.lastIndexOf("</body>"); return at < 0 ? html + body : html.slice(0, at) + body + html.slice(at);
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
  res.writeHead(200, { ...baseHeaders, "Content-Type": MIME[".html"], "Cache-Control": "no-cache, must-revalidate", "CDN-Cache-Control": "no-store", "Cloudflare-CDN-Cache-Control": "no-store" }); res.end(html);
}

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname); if (p === "/") p = "/index.html";
  const file = path.normalize(path.join(STATIC_DIR, p));
  if (!file.startsWith(STATIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    const idx = path.join(STATIC_DIR, "index.html"); // single-page app
    if (!fs.existsSync(idx)) return send(res, 503, "Site files are missing. Run the build.", { "Content-Type": "text/plain" });
    return send(res, 200, indexHtml(req), { "Content-Type": MIME[".html"], "Cache-Control": "no-cache, must-revalidate", "CDN-Cache-Control": "no-store", "Cloudflare-CDN-Cache-Control": "no-store" });
  }
  if (p === "/index.html") return send(res, 200, indexHtml(req), { "Content-Type": MIME[".html"], "Cache-Control": "no-cache, must-revalidate", "CDN-Cache-Control": "no-store", "Cloudflare-CDN-Cache-Control": "no-store" });
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
// an advance on a money receipt paid back later: main account entries (money out) that name the receipt
const mrRefunds = r => db.office.entries.filter(e => e.mr?.rid === r.id && e.status !== "rejected");
const mrOut = (r, pub) => {
  const sig = (s, k) => s ? { name: s.name, title: s.title, at: s.at, sigUrl: s.sig && db.files[s.sig] ? (pub ? `/api/receipt/${r.token}/sig/${k}` : `/api/files/${s.sig}`) : "" } : null;
  const x = { id: r.id, no: r.no, accountId: r.accountId, payer: r.payer, agentId: r.agentId || null, amount: r.amount, method: r.method, channel: r.channel || "", paidTo: r.paidTo || "", balance: r.balance || null, mailed: r.mailed || null, ref: r.ref, purpose: r.purpose, note: r.note, date: r.date, created: r.created,
    status: r.status, token: r.status === "approved" ? r.token : "", received: sig(r.received, "r"), approved: sig(r.approved, "a"), void: r.void || null, refunds: mrRefunds(r).map(e => ({ amount: e.amount, date: e.date, status: e.status || "accepted", method: e.method })) };
  if (pub) { delete x.accountId; delete x.id; delete x.mailed; delete x.agentId; delete x.paidTo; if (x.payer) x.payer = { ...x.payer, email: x.payer.email ? x.payer.email.replace(/^(.).*(@.*)$/, "$1***$2") : "" }; }
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
      const paidTo = leaders().some(x => x.k === L.paidTo) ? L.paidTo : ""; // given to the MD / a Director / the Chairman: not in the main account
      return { amount, method, channel, date, ref: str(L.ref, 80), purpose: str(L.purpose ?? d.purpose, 160), ...(paidTo ? { paidTo } : {}) };
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
  /* Advance paid back: give the earlier receipt number; the payment is a main account money-out entry naming that receipt.
     Paid from office cash / bank / wallet: the main account; paid by the MD / a Director / the Chairman: their account (they confirm it). */
  if (d.op === "refundFind") {
    const no = str(d.no, 30).replace(/\s+/g, "").toUpperCase(); const r = M.receipts.find(x => x.no.toUpperCase() === no);
    must(r, `Money receipt ${no || ""} not found.`); must(r.status === "approved" && !r.void, `Money receipt ${r.no} is not approved, or it is cancelled.`);
    const paid = mrRefunds(r).reduce((t, e) => t + e.amount, 0);
    return { receipt: { id: r.id, no: r.no, date: r.date, amount: r.amount, payer: r.payer, purpose: r.purpose, paid: r2(paid), left: r2(r.amount - paid) } };
  }
  if (d.op === "refund") {
    const r = M.receipts.find(x => x.id === d.id); must(r && r.status === "approved" && !r.void, "Money receipt not found.");
    const left = r2(r.amount - mrRefunds(r).reduce((t, e) => t + e.amount, 0)), amount = r2(Number(d.amount));
    must(amount > 0, "Enter the amount paid back."); must(amount <= left + 0.001, `Only BDT ${left.toLocaleString("en-US")} of ${r.no} is left to pay back.`);
    const method = str(d.method, 80) || "Cash", k = personOf(method), L = leaders(), lead = k && L.find(x => x.k === k), mine = L.find(x => x.uid === u.id)?.k;
    must(!k || lead, "Choose a Managing Director, Director or Chairman.");
    const who = r.payer.name || r.payer.passport || r.payer.mobile || "the payer";
    const e = { id: id("of"), date: okDate(d.date), type: "out", desc: `Advance paid back to ${who} · against ${r.no}${str(d.note, 120) ? " · " + str(d.note, 120) : ""}`, amount, method, ref: str(d.ref, 80),
      mr: { rid: r.id, no: r.no }, by: u.name, byId: u.id, at: now(), people: k ? [k] : [], accepted: k && k === mine ? [k] : [] };
    e.status = e.accepted.length === e.people.length ? "accepted" : "pending";
    db.office.entries.push(e);
    if (e.status === "pending" && lead?.uid) notify(lead.uid, `${u.name} asks you to confirm BDT ${amount.toLocaleString("en-US")} paid out by you: ${e.desc.slice(0, 90)}. Open Money with me.`);
    return { msg: `BDT ${amount.toLocaleString("en-US")} paid back against ${r.no}.${e.status === "pending" ? ` Waiting for ${lead.name}'s confirmation.` : ""}` };
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

/* profile picture of a panel user (admin, staff, agent): shown in the panel header */
A["me.photo"] = async (d, u) => {
  must(u && ["admin", "staff", "agent"].includes(u.role), "Not allowed.", 403);
  if (d.remove) { u.photo = null; return { msg: "Profile picture removed." }; }
  must(d.file?.data && /^data:image\//.test(d.file.data), "Choose a photo (JPG or PNG).");
  u.photo = storeFile(d.file, u.id, { pdf: false }); return { msg: "Profile picture saved." };
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
/* once: the office network is the one most IDs used on 21 Nov 2026 (as the admin said); self ticks made outside the office are removed */
if (!ATT.fix2611) {
  const L = ATT.ipLog?.["2026-11-21"]; const best = L && Object.entries(L).sort((a, b) => b[1].length - a[1].length)[0];
  if (best && best[1].length >= 2) { ATT.office = { ...ATT.office, mode: "auto", autoIp: best[0], ip: ATT.office.mode === "manual" ? best[0] : ATT.office.ip, autoAt: new Date().toISOString(), candidate: null }; }
  for (const [uid, days] of Object.entries(ATT.marks || {})) for (const [d, m] of Object.entries(days)) if (m?.by === "self" && m.office === false) delete days[d];
  ATT.fix2611 = true;
}
const officeIp = () => (ATT.office.mode === "manual" && ATT.office.ip) || ATT.office.autoIp || "";
/* the office can reach the internet through several addresses of one provider block (e.g. 165.101.133.33 and .39):
   the office IP may be an address, a block like 165.101.133.0/24, or several of them separated by commas */
const v4n = ip => /^\d+\.\d+\.\d+\.\d+$/.test(ip) ? ip.split(".").reduce((t, x) => t * 256 + +x, 0) : null;
const officeSpecs = () => String(officeIp()).split(/[,\s]+/).map(x => x.trim()).filter(Boolean);
const isOffice = net => { net = String(net || ""); if (!net) return false;
  return officeSpecs().some(sp => { const [a, b] = sp.split("/"); const n = v4n(net), base = v4n(a);
    if (b && n != null && base != null) { const bits = Math.max(8, Math.min(32, +b)); return Math.floor(n / 2 ** (32 - bits)) === Math.floor(base / 2 ** (32 - bits)); }
    return sp === net; }); };
const officePeople = day => [...new Set(Object.entries(ATT.ipLog[day] || {}).filter(([k]) => isOffice(k)).flatMap(([, l]) => l))];
const attMark = (uid, day, m) => { (ATT.marks[uid] ||= {})[day] = m; };
const attSeen = {}; // admin/staff: the network each was last seen on, and when (kept in memory: "who is signed in now")
function attTouch(u, ip0) {
  const ip = netOf(ip0); if (!ip) return;
  attSeen[u.id] = { ip, at: Date.now() };
  const day = attDay(), log = (ATT.ipLog[day] ||= {}), list = (log[ip] ||= []);
  let changed = false;
  if (!list.includes(u.id)) { list.push(u.id); changed = true; }
  // automatic office IP: the network most admin/staff use today (at least two people); when it moves, people already seen there are ticked
  // the first office IP: two people on one network; afterwards a new network with two or more people today is only a suggestion, and changes nothing until an admin confirms it
  if (ATT.office.mode !== "manual" && !ATT.office.autoIp && list.length >= 2) {
    ATT.office.autoIp = ip; ATT.office.autoAt = now(); changed = true;
    if (!attHoliday(day)) for (const uid of list) if (!ATT.marks[uid]?.[day]) attMark(uid, day, { at: now(), by: "auto", ip });
  } else if (!isOffice(ip) && list.length >= 2 && list.length >= officePeople(day).length && ATT.office.candidate?.ip !== ip && !(ATT.office.dismissed || []).includes(ip)) {
    // two or more IDs on a new network: ask the admin; the office IP stays as it is until the admin confirms
    ATT.office.candidate = { ip, at: now(), day }; changed = true;
    notifyAdmins(`${list.length} admin/staff are using a new network (${ip}) today. If the office internet changed, confirm it as the office IP in Site settings › Office attendance.`, "settings");
  }
  if (isOffice(ip) && !attHoliday(day) && !ATT.marks[u.id]?.[day]) { attMark(u.id, day, { at: now(), by: "auto", ip }); changed = true; }
  // keep 60 days of the IP log
  for (const d of Object.keys(ATT.ipLog)) if (d < new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10)) { delete ATT.ipLog[d]; changed = true; }
  if (changed) save();
}
/* staff ranking for the Overview: work done (changes they made) and who reaches the office first — today, this week (from Saturday), this month */
A["staff.rank"] = async ({ period, back }, u) => {
  must(isStaffRole(u), "Not allowed.", 403);
  const today = bdDay(), bd = iso => new Date(Date.parse(iso) + 6 * 3600e3).toISOString();
  const B = Math.max(0, Math.min(400, Math.floor(+back || 0))); // 0 = today / this week / this month; 1 = the one before …
  const ymd = d => d.toISOString().slice(0, 10), T = new Date(today + "T00:00:00Z");
  let from = today, to = today;
  if (period === "week") { const st = new Date(T - ((T.getUTCDay() + 1) % 7) * 864e5 - B * 7 * 864e5); from = ymd(st); to = ymd(new Date(+st + 6 * 864e5)); }
  else if (period === "month") { const st = new Date(Date.UTC(T.getUTCFullYear(), T.getUTCMonth() - B, 1)); from = ymd(st); to = ymd(new Date(Date.UTC(st.getUTCFullYear(), st.getUTCMonth() + 1, 0))); }
  else { from = to = ymd(new Date(+T - B * 864e5)); }
  if (to > today) to = today;
  const inRange = day => day >= from && day <= to;
  const people = db.users.filter(x => x.role === "staff" && x.status !== "suspended");
  const ids = new Set(people.map(x => x.id)), work = {};
  for (const e of db.staffLog) { if (!ids.has(e.uid) || e.area === "Sign-in" || !inRange(bd(e.at).slice(0, 10))) continue;
    const w = (work[e.uid] ||= { n: 0, areas: {} }); w.n++; w.areas[e.area] = (w.areas[e.area] || 0) + 1; }
  // work an admin added by hand (done outside the panel) counts the same
  for (const e of db.manualWork || []) { if (!ids.has(e.uid) || !inRange(e.date)) continue;
    const w = (work[e.uid] ||= { n: 0, areas: {} }); w.n += e.count; w.manual = (w.manual || 0) + e.count; w.areas[e.area] = (w.areas[e.area] || 0) + e.count; }
  const rows = people.map(x => {
    // arrival: the time the office network first saw them that day (automatic or their own tick); a tick an admin made has no arrival time
    const mins = Object.entries(ATT.marks[x.id] || {}).filter(([d, m]) => inRange(d) && m?.at && (m.by === "auto" || m.by === "self"))
      .map(([, m]) => { const t = bd(m.at); return +t.slice(11, 13) * 60 + +t.slice(14, 16); });
    const w = work[x.id] || { n: 0, areas: {} };
    const m = x.memberId && db.team.find(y => y.id === x.memberId);
    return { id: x.id, name: x.name, title: m?.title || x.title || "", memberId: m?.id || "", work: w.n, manual: w.manual || 0, areas: Object.entries(w.areas).sort((a, b) => b[1] - a[1]).slice(0, 3),
      days: mins.length, avg: mins.length ? Math.round(mins.reduce((a, b) => a + b, 0) / mins.length) : null, first: mins.length ? Math.min(...mins) : null };
  });
  const manual = (db.manualWork || []).filter(e => ids.has(e.uid) && inRange(e.date)).sort((a, b) => (b.date + b.at).localeCompare(a.date + a.at))
    .map(e => ({ ...e, name: user(e.uid)?.name || "", byName: user(e.by)?.name || "" }));
  return { from, to, back: B, period: ["week", "month"].includes(period) ? period : "day", rows, manual, areas: [...ST_AREA.map(a => a[1]).filter(a => a !== "Sign-in"), "Other"] };
};
/* admin: add (or remove) work a staff member did by hand, outside the panel — it counts in the staff ranking */
if (!db.manualWork) db.manualWork = [];
A["admin.manualWork"] = async (d, u) => {
  must(u?.role === "admin", "Only an admin can add manual work.", 403);
  if (d.op === "del") { const i = db.manualWork.findIndex(e => e.id === d.id); must(i >= 0, "Entry not found."); db.manualWork.splice(i, 1); return { msg: "Manual work removed." }; }
  const x = user(d.uid); must(x && x.role === "staff", "Choose a staff member.");
  const date = okDate(d.date) || bdDay(); must(date <= bdDay(), "The date cannot be in the future.");
  const count = Math.floor(+d.count || 0); must(count >= 1 && count <= 500, "Enter how many (1–500).");
  const area = str(d.area, 60) || "Other", note = str(d.note, 200); must(note.length >= 2, "Write what the work was.");
  db.manualWork.push({ id: id("mw"), uid: x.id, date, area, note, count, by: u.id, at: now() });
  return { msg: `Added ${count} manual ${count === 1 ? "task" : "tasks"} for ${x.name}.` };
};
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
  must(target !== u.id || isOffice(ip), "You can tick only from the office network. Open the site on the office internet.");
  attMark(target, date, { at: now(), by: target === u.id ? "self" : `admin:${u.name}`, ip, office: isOffice(ip) });
  return { msg: "Present." };
};
/* ---------- HEADLINES on the website: a scrolling news line under the header ---------- */
if (!db.headlines) db.headlines = [];
if (!db.agentBook) db.agentBook = [];
if (!db.khata) db.khata = [];
if (!db.dueReceipts) db.dueReceipts = { seq: {}, list: [] }; // due receipts: a paper telling an agent what they owe; no money moves // Payments & receipts › Other accounts: named accounts kept only for the record
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
    let ip = str(d.ip, 200).replace(/\s+/g, "");
    const parts = ip.split(",").filter(Boolean); must(parts.length && parts.length <= 6, "Enter the office IP.");
    for (const x of parts) must(/^\d{1,3}(\.\d{1,3}){3}(\/(8|1[0-9]|2[0-9]|3[0-2]))?$/.test(x) || /^[0-9a-f:]+(\/64)?$/i.test(x), `${x} is not an IP address.`);
    // "the IPs that go with it": an IPv4 address also covers its /24 block when asked (the provider gives the office several addresses)
    if (d.block) ip = parts.map(x => /^\d+\.\d+\.\d+\.\d+$/.test(x) ? x.replace(/\.\d+$/, ".0/24") : x).join(",");
    ATT.office = { ...ATT.office, mode: d.manual ? "manual" : ATT.office.mode === "manual" ? "manual" : "auto", ip, autoIp: ip, setBy: u.name, setAt: now(), candidate: null };
    const day = attDay(); let n = 0;
    if (!attHoliday(day)) for (const [net, uids] of Object.entries(ATT.ipLog[day] || {})) if (isOffice(net)) for (const uid of uids) if (!ATT.marks[uid]?.[day]) { attMark(uid, day, { at: now(), by: "auto", ip: net }); n++; }
    return { msg: `Office IP set to ${ip}.${n ? ` ${n} ID(s) signed in from it today are marked present.` : ""}` };
  }
  if (d.op === "holidayAdd") { const date = /^\d{4}-\d{2}-\d{2}$/.test(d.date || "") ? d.date : ""; must(date && str(d.name), "Enter the date and the name."); ATT.holidays = [...ATT.holidays.filter(h => h.date !== date), { date, name: str(d.name, 80) }].sort((a, b) => a.date.localeCompare(b.date)); return { msg: "Holiday added." }; }
  if (d.op === "holidayDelete") { ATT.holidays = ATT.holidays.filter(h => h.date !== d.date); return { msg: "Holiday removed." }; }
  must(false, "Unknown request.");
};
const attView = (u, all) => ({ today: attDay(), since: ATT.since, holidays: ATT.holidays, officeIp: officeIp(), ...(all ? { officeNets: Object.keys(Object.assign({}, ...Object.values(ATT.ipLog || {}))).filter(isOffice), seen: Object.fromEntries(Object.entries(attSeen).filter(([, v]) => Date.now() - v.at < 30 * 60e3).map(([k, v]) => [k, { ip: v.ip, ago: Math.round((Date.now() - v.at) / 60e3), office: isOffice(v.ip) }])) } : {}), marks: all ? ATT.marks : { [u.id]: ATT.marks[u.id] || {} },
  ...(all ? { office: ATT.office, ipLog: Object.fromEntries(Object.entries(ATT.ipLog).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14)) } : {}) });
const okDate = v => (/^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : bdDay());
function officeAuto() {
  // after a reset, only what happened after it (by the time it was confirmed / paid; by date if no time is known)
  const out = [], from = db.office?.from || "", fromAt = db.office?.fromAt || "", keep = e => !from || (fromAt && e.at ? String(e.at) >= fromAt : String(e.date || "") >= from);
  for (const r of db.mr.receipts) if (r.status === "approved" && !r.void)
    out.push({ id: "a-" + r.id, auto: "receipt", date: r.date, type: "in", desc: `Money receipt ${r.no}${r.payer.name ? " · " + r.payer.name : r.payer.passport ? " · " + r.payer.passport : ""}${r.purpose ? " · " + r.purpose : ""}`, amount: r.amount, method: (r.paidTo ? `Person · ${r.paidTo} | ` : "") + [r.method, r.channel].filter(Boolean).join(" · "), ref: r.ref, at: r.approved?.at || r.created || null });
  for (const l of db.ledger) if (l.type === "payment" && l.status === "confirmed" && !l.mr && !l.opening) { // opening balances (previous due / advance) stay out of the Main account
    const ag = user(l.agentId);
    out.push({ id: "a-" + l.id, auto: "agent", date: l.date, type: "in", desc: `Agent payment · ${agentName(ag) || "Agent"}${l.desc ? " · " + l.desc : ""}`, amount: Number(l.amount), method: l.method, ref: l.ref, at: l.confirmedAt || l.at || null });
  }
  // agents kept in the office's own agent list (no account of their own): money received from them counts the same way
  for (const b of db.agentBook || []) for (const e of b.entries || []) if (e.type === "payment" && !e.opening)
    out.push({ id: "a-" + e.id, auto: "agent", date: e.date, type: "in", desc: `Agent payment · ${b.name}${e.desc ? " · " + e.desc : ""}`, amount: Number(e.amount), method: e.method || "Cash", ref: e.ref, at: e.at || null });
  for (const p of db.salary.pays) if (salaryDone(p) && p.paid > 0)
    out.push({ id: "a-" + p.id, auto: "salary", date: p.date, type: "out", desc: `Salary ${p.no} · ${p.name} · ${monthName(p.month)}`, amount: p.paid, method: [p.method, p.channel].filter(Boolean).join(" · "), ref: p.ref, at: p.recv?.at || p.created || null });
  return out.filter(keep); // books started again on db.office.from: older automatic entries stay out
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
const dhakaDay = () => new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10);
A["admin.office"] = async (d, u) => {
  needPerm(u, "office");
  if (d.op === "reset") { // start the books again: money receipts and the main account; agents' own accounts are not touched
    must(u.role === "admin", "Only the admin can do this.");
    must(String(d.confirm || "").trim().toUpperCase() === "RESET", "Type RESET to confirm.");
    const day = dhakaDay(), snap = { at: now(), by: u.name, from: db.office.from || null, office: db.office.entries, receipts: db.mr.receipts, seq: db.mr.seq };
    fs.writeFileSync(path.join(DATA_DIR, `accounts-reset-${Date.now()}.json`), JSON.stringify(snap)); // a copy, in case it is ever needed
    const nOf = db.office.entries.length, nMr = db.mr.receipts.length;
    db.office.entries = []; db.mr.receipts = []; db.mr.seq = {}; db.office.from = day; db.office.fromAt = now();
    return { msg: `Accounts reset: ${nMr} money receipt(s) and ${nOf} main account entr${nOf === 1 ? "y" : "ies"} removed. The main account starts from ${day}.` };
  }
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
/* the MD / a Director / the Chairman, from their own admin ID: give money to the office (it goes into the main account) */
/* Payments & receipts › Other accounts: an account by name, kept only for the record (not in the main account, not in the bosses' accounts) */
/* Agents › Due receipt: tells an agent (registered, or in the agent list) how much is due from before. Nothing is added
   to the main account or anywhere else: the office's browser makes the PDF and the server emails it to the agent. */
A["admin.dueReceipt"] = async (d, u) => {
  must(can(u, "ledger") || can(u, "receipts"), "You do not have permission for this.", 403);
  const D = db.dueReceipts;
  if (d.op === "make") {
    const ag = d.agentId ? user(d.agentId) : null, bk = d.book ? db.agentBook.find(x => x.id === d.book) : null;
    must(ag?.role === "agent" || bk, "Agent not found.");
    const amount = r2(Number(d.amount)); must(amount > 0 && amount < 1e10, "Enter the due amount.");
    const date = okDate(d.date), yr = date.slice(0, 4); D.seq[yr] = (D.seq[yr] || 0) + 1;
    const x = { id: id("dr"), no: `DR-${yr}-${String(D.seq[yr]).padStart(4, "0")}`, kind: "due", date, amount, agentId: ag ? ag.id : null, book: bk ? bk.id : null,
      payer: ag ? { name: agentName(ag), mobile: ag.agent?.phone || ag.phone || "", email: ag.email || "", passport: "", agent: agentName(ag) } : { name: bk.fullName || bk.name, mobile: bk.mobile || "", email: bk.email || "", passport: "", agent: bk.name },
      purpose: str(d.purpose, 160) || "Due from before", note: str(d.note, 300), status: "approved", received: mrSigner(u), created: now() };
    D.list.unshift(x); if (D.list.length > 5000) D.list.length = 5000;
    const sig = x.received.sig && db.files[x.received.sig] ? `/api/files/${x.received.sig}` : "";
    return { receipt: { ...x, received: { ...x.received, sigUrl: sig } } };
  }
  if (d.op === "mail") {
    const x = D.list.find(r => r.id === d.id); must(x, "Due receipt not found.");
    const to = mrNorm.email(d.to || x.payer.email); must(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to), "This agent has no email address. Enter one.");
    const pdf = Buffer.from(String(d.pdf || "").replace(/^data:application\/pdf;base64,/, ""), "base64");
    must(pdf.length > 100 && pdf.length < 4e6 && pdf.subarray(0, 5).toString() === "%PDF-", "The receipt PDF is missing.");
    const m = await getMailer(); must(m, "Email is not set up on this server. Download the PDF and send it yourself.");
    const money = n => `BDT ${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
    try {
      await m.sendMail({ from: `"Mam & Mam Overseas Ltd." <${mailFrom()}>`, to, subject: `Due receipt ${x.no} · Mam & Mam Overseas Ltd.`,
        text: `Assalamu Alaikum ${x.payer.name},\n\nYour due receipt is attached.\n\nReceipt No.: ${x.no}\nDate: ${x.date}\nAmount due: ${money(x.amount)}\n${x.purpose ? `Details: ${x.purpose}\n` : ""}${x.note ? `Note: ${x.note}\n` : ""}\nPlease pay the due amount to the office.\n\nMam & Mam Overseas Ltd. · Government Licensed Recruiting Agency · RL1217`,
        attachments: [{ filename: `${x.no}.pdf`, content: pdf, contentType: "application/pdf" }] });
    } catch (e) { console.error("Due receipt email failed:", e.message); must(false, `The due receipt could not be emailed to ${to}. Try again later.`); }
    x.mailed = { to, at: now() };
    if (x.agentId) notify(x.agentId, `Due receipt ${x.no}: ${money(x.amount)} due. It has been emailed to you.`);
    return { msg: `Due receipt ${x.no} emailed to ${to}.` };
  }
  must(false, "Unknown request.");
};
A["admin.khata"] = async (d, u) => {
  // own: the MD / a Director / the Chairman keeps their own accounts (only they see them); otherwise the office's accounts
  // own: personal accounts (only that person sees them): the MD / a Director / the Chairman under their key, any other admin / staff ID under its own
  const owner = d.own && isStaffRole(u) ? (leaders().find(x => x.uid === u.id)?.k || `u:${u.id}`) : null;
  if (d.own) must(owner, "Not allowed.", 403);
  else must(can(u, "office") || can(u, "receipts") || can(u, "ledger"), "You do not have permission for this.", 403);
  const K = db.khata.filter(x => (x.owner || null) === owner), acc = d.id ? K.find(x => x.id === d.id) : null;
  if (d.op === "add" || d.op === "edit") {
    const name = str(d.name, 120); must(name.length >= 2, "Enter the name.");
    must(!K.some(x => x !== acc && x.name.toLowerCase() === name.toLowerCase()), `An account named ${name} already exists.`);
    const v = { name, mobile: str(d.mobile, 30), note: str(d.note, 300) };
    if (d.op === "edit") { must(acc, "Account not found."); Object.assign(acc, v, { updated: now() }); return { msg: "Saved." }; }
    const x = { id: id("kh"), ...v, ...(owner ? { owner } : {}), entries: [], by: u.name, at: now() }; db.khata.unshift(x); return { msg: `Account ${name} made.`, id: x.id };
  }
  must(acc, "Account not found.");
  if (d.op === "remove") { must(owner || u.role === "admin" || !acc.entries.length, "Only an admin can remove an account that has entries."); db.khata = db.khata.filter(x => x !== acc); return { msg: `${acc.name} removed.` }; }
  if (d.op === "entry") {
    const amount = r2(Number(d.amount)); must(amount > 0 && amount < 1e10, "Enter the amount.");
    const v = { date: okDate(d.date), type: d.type === "got" ? "got" : "gave", amount, desc: str(d.desc, 200), method: str(d.method, 80), ref: str(d.ref, 80) };
    if (d.eid) { const e = acc.entries.find(x => x.id === d.eid); must(e, "Entry not found."); Object.assign(e, v, { edited: { by: u.name, at: now() } }); return { msg: "Entry updated." }; }
    acc.entries.push({ id: id("ke"), ...v, by: u.name, at: now() }); return { msg: "Entry added." };
  }
  if (d.op === "entryDelete") { const e = acc.entries.find(x => x.id === d.eid); must(e, "Entry not found."); acc.entries = acc.entries.filter(x => x !== e); return { msg: "Entry deleted." }; }
  must(false, "Unknown request.");
};
A["office.give"] = async (d, u) => {
  must(isStaffRole(u), "Not allowed.", 403);
  const L = leaders().find(x => x.uid === u.id); must(L, "Only the Managing Director, a Director or the Chairman can do this.");
  const amount = r2(Number(d.amount)); must(amount > 0 && amount < 1e10, "Enter the amount.");
  const to = str(d.to, 80) || "Cash"; must(!personOf(to), "Choose where the office receives it.");
  const via = str(d.via, 80) || "Cash";
  const e = { id: id("of"), date: okDate(d.date), type: "transfer", from: `Person · ${L.k} | ${via}`, to, desc: str(d.desc, 200) || `Given to the office by ${L.name}`, amount, ref: str(d.ref, 80), by: u.name, byId: u.id, at: now(), people: [L.k], accepted: [L.k], status: "accepted" };
  db.office.entries.push(e);
  notifyAdmins(`${u.name} gave BDT ${amount.toLocaleString("en-US")} to the office (${to}).`, "office");
  return { msg: "Done. It is now in the main account." };
};
A["office.accept"] = async (d, u) => {
  must(isStaffRole(u), "Not allowed.", 403);
  const k = leaders().find(x => x.uid === u.id)?.k;
  const e = db.office.entries.find(x => x.id === d.id); must(k && e && e.people?.includes(k), "Request not found."); must(e.status === "pending", "This request is already answered.");
  if (d.ok) {
    e.accepted = [...new Set([...(e.accepted || []), k])]; if (e.accepted.length === e.people.length) e.status = "accepted";
    notifyAdmins(`${u.name} confirmed BDT ${e.amount.toLocaleString("en-US")}: ${e.desc.slice(0, 80)}.`, "office");
    return { msg: e.status === "accepted" ? "Confirmed." : "Confirmed. Waiting for the other person." };
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
      // only the office's own money: money with the MD / Directors / Chairman stays out until they give it to the office (a transfer)
      rows: [...db.office.entries.filter(e => (e.status || "accepted") === "accepted"), ...officeAuto()].flatMap(e => {
        if (e.type === "transfer") { const pf = personOf(e.from), pt = personOf(e.to); if (!!pf === !!pt) return [];
          return [{ date: e.date, details: `${e.desc} — ${pf ? "received from" : "given to"} ${leaders().find(x => x.k === (pf || pt))?.name || "director"}`, rate: short(pf ? e.to : e.from), debit: pf ? e.amount : 0, credit: pt ? e.amount : 0 }]; }
        if (personOf(e.method)) return [];
        return [{ date: e.date, details: e.desc, rate: short(e.method), debit: e.type === "in" ? e.amount : 0, credit: e.type === "out" ? e.amount : 0 }]; }) };
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
/* BMET Passport Entry: fill a passport's BMET details (Reg. No, finger, availability, NID, birth date …) from RAIMS Pre EC Check,
   one passport at a time in the background — for rows added from Add bulk, which bring only the name and passport number */
const ppFillQ = new Set(); let ppFilling = false;
const ppNeedsFill = p => ppLists(p).includes("bmet") && !p.bmet?.regNo && !(p.bmet?.tried && Date.now() - Date.parse(p.bmet.tried) < 6 * 3600e3);
const raimsReady = () => !!(db.raims && (db.raims.pass || db.raims.cookies));
function ppFillQueue(list) { if (!raimsReady()) return 0; let n = 0; for (const p of list) if (ppNeedsFill(p)) { ppFillQ.add(p.passport); n++; } ppFillRun(); return n; }
async function ppFillRun() {
  if (ppFilling) return; ppFilling = true;
  try {
    while (ppFillQ.size) {
      const pp = ppFillQ.values().next().value; ppFillQ.delete(pp);
      const p = db.passports.find(x => x.passport === pp); if (!p || p.bmet?.regNo) continue;
      try {
        const r = await preEcCheck({ passport: pp, returnee: "no" });
        if (r.ok && r.entry && (r.entry.bmet?.regNo || r.entry.bmet?.nid)) {
          const b = r.entry.bmet || {}, bm = Object.fromEntries(PP_BMET.map(k => [k, str(b[k], k === "address" ? 600 : 160)]).filter(([, v]) => v));
          const { tried, ...old } = p.bmet || {}; p.bmet = { ...old, ...bm, checked: now() };
          const nm = String(r.entry.name || "").trim(); if (nm && /^[A-Za-z]/.test(nm) && (!p.name || /[\u0980-\u09FF]/.test(p.name))) p.name = nm.slice(0, 120);
          if (!p.gender && /^(Male|Female)$/.test(r.entry.gender || "")) p.gender = r.entry.gender;
          p.updated = now();
        } else p.bmet = { ...(p.bmet || {}), tried: now() };
        save();
      } catch (e) { if (/sign|log ?in|password|signed out/i.test(e.message)) { ppFillQ.clear(); break; } p.bmet = { ...(p.bmet || {}), tried: now() }; }
      await new Promise(res => setTimeout(res, 1200));
    }
  } finally { ppFilling = false; }
}
const PP_BMET = ["regNo", "finger", "available", "nameBn", "nid", "dob", "father", "mother", "mobile", "profession", "address", "training", "pdo", "issueDate", "expiryDate"];
const PP_INFO = ["fatherName", "motherName", "dob", "birthPlace", "prevNationality", "nationality", "marital", "sect", "religion", "address", "mofaId", "oldMofaId", "issuePlace", "issueDate", "expiryDate", "validity"];
// a passenger's mobile on a passport entry: digits (with an optional +), checked loosely; matched on the last 10 digits
const ppMobile = v => { const m = String(v || "").replace(/[^\d+]/g, "").slice(0, 16); must(!m || m.replace(/\D/g, "").length >= 10, "Check the passenger's mobile number."); return m; };
const last10 = v => String(v || "").replace(/\D/g, "").slice(-10);
// the passports the office entered for this passenger: by the mobile on the entry, or by their passport number
const myPassports = u => { const M = last10(u.profile?.phone || u.phone), P = String(u.profile?.passportNo || "").replace(/\s+/g, "").toUpperCase();
  return db.passports.filter(p => (M.length === 10 && p.mobile && last10(p.mobile) === M) || (P.length >= 6 && p.passport === P))
    .map(p => ({ id: p.id, name: p.name, passport: p.passport, country: p.country || "", lists: ppLists(p), vstatus: p.vstatus || {}, profession: p.fiji?.profession || "", at: p.at,
      clearance: (() => { const c = db.clearances.find(c => String(worker(c.workerId)?.passport || c.passport || "").replace(/\s+/g, "").toUpperCase() === p.passport); return c ? { status: c.status, statusText: c.statusText || "", country: c.country } : null; })() })); };
A["admin.passport"] = async (d, u) => {
  must(can(u, "clearance") || can(u, "visa"), "You do not have permission for this.", 403);
  const read = x => {
    const name = str(x.name, 120), passport = ppNorm(x.passport).slice(0, 20), country = str(x.country, 60), gender = x.gender === "Female" ? "Female" : x.gender === "Male" ? "Male" : "";
    must(name.length >= 2, "Enter the full name."); must(/^[A-Z0-9]{6,15}$/.test(passport), "Check the passport number (letters and numbers, 6 to 15).");
    must(country, "Choose the country."); must(gender, "Choose Male or Female.");
    const ag = x.agentId ? user(x.agentId) : null; must(!x.agentId || ag?.role === "agent", "Agent not found.");
    const info = x.info && typeof x.info === "object" ? Object.fromEntries(PP_INFO.map(k => [k, VISA_DATES.includes(k) ? okDay(x.info[k]) : str(x.info[k], k === "address" ? 1000 : 160)]).filter(([, v]) => v)) : undefined;
    // BMET details (from Pre EC Check, or typed): registration, finger, availability, Bangla name, NID, parents, mobile …
    const bm = x.bmet && typeof x.bmet === "object" ? Object.fromEntries(PP_BMET.map(k => [k, str(x.bmet[k], k === "address" ? 600 : 160)]).filter(([, v]) => v)) : undefined;
    const ref = ag ? agentName(ag) : str(x.ref, 120), mobile = ag || ref ? "" : ppMobile(x.mobile); // no agent: the passenger's own mobile, so their portal account finds the passport
    return { name, passport, country, gender, ref, agentId: ag ? ag.id : null, mobile, ...(info ? { info } : {}), ...(bm && Object.keys(bm).length ? { bmet: { ...bm, ...(x.bmet.checked ? { checked: now() } : {}) } } : {}) };
  };
  if (d.op === "add") {
    const list = (Array.isArray(d.rows) ? d.rows : [d]).slice(0, 100); must(list.length, "Add at least one passport.");
    const made = list.map((x, i) => { let v; try { v = read(x); } catch (e) { if (list.length > 1 && e instanceof Fail) e.message += ` (row ${i + 1})`; throw e; } return v; });
    const tag = d.list === "ksa" ? "ksa" : "bmet";
    must(!made.find((v, i) => made.findIndex(w => w.passport === v.passport) !== i), "The same passport is twice in the list.");
    // a passport already in another list is added to this one (its details updated), not entered twice
    const dup = made.find(v => db.passports.some(p => p.passport === v.passport && ppLists(p).includes(tag)));
    must(!dup || d.upsert, `Passport ${dup?.passport} is already in the list.`);
    let merged = 0;
    for (const v of made) {
      const old = db.passports.find(p => p.passport === v.passport);
      // Add bulk › Add to Entry List: a passport already entered keeps its Male/Female and gets the new name, country and Ref.
      if (old && d.upsert) { const { gender, ...rest } = v; Object.assign(old, rest, old.gender ? {} : { gender }, { lists: [...new Set([...ppLists(old), tag])], updated: now() }); merged++; continue; }
      if (old) { Object.assign(old, v, { info: { ...(old.info || {}), ...(v.info || {}) }, ...(v.bmet || old.bmet ? { bmet: { ...(old.bmet || {}), ...(v.bmet || {}) } } : {}), lists: [...new Set([...ppLists(old), tag])], updated: now() }); merged++; }
      else db.passports.unshift({ id: id("pp"), ...v, lists: [tag], by: u.name, at: now() });
    }
    if (tag === "bmet") ppFillQueue(made.map(v => db.passports.find(p => p.passport === v.passport)).filter(Boolean));
    return { msg: made.length > 1 ? `${made.length} passports added.` : merged ? `Passport ${made[0].passport} was already entered elsewhere; it is now in this list too.` : `Passport ${made[0].passport} added.` };
  }
  if (d.op === "raimsFill") { // fill BMET details from RAIMS for every passport in the list that has none yet
    must(raimsReady(), "RAIMS is not signed in. The admin signs in under BMET clearance › RAIMS.");
    const all = db.passports.filter(p => ppLists(p).includes("bmet") && !p.bmet?.regNo); all.forEach(p => { if (p.bmet?.tried) { const { tried, ...rest } = p.bmet; p.bmet = rest; } });
    const n = ppFillQueue(all); return { msg: n ? `Reading ${n} passport(s) from RAIMS. The rows fill in one by one.` : "Every passport already has its BMET details." };
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
    const ref = ag ? agentName(ag) : str(d.ref, 120), mobile = ag || ref ? "" : ppMobile(d.mobile);
    const old = d.id ? db.passports.find(p => p.id === d.id) : db.passports.find(p => p.passport === passport);
    must(!d.id || old, "Passport not found.");
    if (old) {
      must(!db.passports.some(p => p !== old && p.passport === passport), `Passport ${passport} is already in the list.`);
      Object.assign(old, { name, passport, ref, agentId: ag ? ag.id : null, mobile, fiji, lists: [...new Set([...ppLists(old), "fiji"])], updated: now() }); if (!old.country) old.country = "Fiji";
      return { msg: d.id ? "Passport updated." : `Fiji details added to passport ${passport}.` };
    }
    db.passports.unshift({ id: id("pp"), name, passport, country: "Fiji", gender: "", ref, agentId: ag ? ag.id : null, mobile, fiji, lists: ["fiji"], by: u.name, at: now() });
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
    if (c.fee > 0) db.ledger.push(clCharge(x.id, c, "BMET clearance processing", c.fee, c.created || today));
    if (c.due > 0) db.ledger.push(clCharge(x.id, c, "Previous due", c.due, c.created || today));
    if (c.card?.fee > 0) db.ledger.push(clCharge(x.id, c, "BMET clearance card fee", c.card.fee, c.card.sentAt || today));
    if (c.card?.other?.amount > 0) db.ledger.push(clCharge(x.id, c, c.card.other.label || "Stamp fee", c.card.other.amount, c.card.sentAt || today));
  }
  for (const r of db.mr.receipts) if (!r.agentId && bookKey(r.payer?.agent) === k) {
    r.agentId = x.id; r.payer.agent = agentName(x); n.receipts++;
    if (r.status === "approved" && !r.void && !r.ledgerId) { const l = { id: id("l"), agentId: x.id, type: "payment", desc: `Money receipt ${r.no}${r.payer.name ? ": " + r.payer.name : ""}`, amount: r.amount, date: r.date, method: [r.method, r.channel].filter(Boolean).join(" · "), ref: r.ref || "", status: "confirmed", mr: r.id }; db.ledger.push(l); r.ledgerId = l.id; }
  }
  for (const a of db.mr.accounts || []) if (!a.agentId && bookKey(a.agent) === k) { a.agentId = x.id; a.agent = agentName(x); }
  for (const e of b.entries || []) { db.ledger.push({ id: id("l"), at: e.at, agentId: x.id, type: e.type, desc: e.desc, amount: e.amount, ...(e.type === "charge" ? { qty: e.qty, rate: e.rate } : {}), date: e.date, method: e.method || "", ref: e.ref || "", status: "confirmed", ...(e.opening ? { opening: true } : {}) }); n.entries++; }
  // keep the details the office wrote, where the account has none
  x.agent = x.agent || {}; if (!x.agent.phone && b.mobile) x.agent.phone = b.mobile; if (!x.agent.address && b.address) x.agent.address = b.address;
  x.linkedBook = [...(x.linkedBook || []), { name: b.name, at: now(), ...n }];
  db.agentBook = db.agentBook.filter(a => a !== b);
  return n;
}
/* an agent ID and an agent in the office's list with the same mobile number or email are the same agent: join them
   (at start-up, and whenever an agent ID or the list changes). A name alone is joined only when the admin approves the ID. */
function strongBookMatches(x) {
  if (x?.role !== "agent" || x.status !== "active") return []; // approved IDs only: an ID waiting for approval is linked when the admin approves it
  const ph = [x.agent?.phone, x.phone].map(dig10).filter(v => v.length >= 10), em = String(x.email || "").trim().toLowerCase();
  return db.agentBook.filter(a => (dig10(a.mobile).length >= 10 && ph.includes(dig10(a.mobile))) || (a.email && em && a.email.trim().toLowerCase() === em));
}
function autoLinkBooks() {
  let n = 0;
  for (const x of db.users) for (const b of strongBookMatches(x)) {
    const r = linkBookAgent(b, x); n++;
    notify(x.id, `Your earlier records with the agency (${b.name}) are now in your account: passports, workers, clearance files and payments.`);
    console.log(`linked agent list "${b.name}" to agent ID ${x.email}`, JSON.stringify(r));
  }
  if (n) save();
  return n;
}
setTimeout(() => { try { autoLinkBooks(); } catch (e) { console.error("autoLinkBooks", e); } }, 1500);
function linkAgentAccount(x) {
  const done = bookMatches(x).map(b => ({ name: b.name, ...linkBookAgent(b, x) }));
  if (done.length) notify(x.id, `Your earlier records with the agency (${done.map(d => d.name).join(", ")}) are now in your account: passports, workers, clearance files and payments.`);
  return done;
}
A["admin.agentBook"] = async (d, u) => { const r = await agentBookOp(d, u); const n = autoLinkBooks(); if (n && r?.msg) r.msg += ` This agent already has an agent ID with the same mobile or email: the records are now in that account.`; return r; };
async function agentBookOp(d, u) {
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
      return { id: id("ae"), type, date: /^\d{4}-\d{2}-\d{2}$/.test(r.date || "") ? r.date : now().slice(0, 10), desc: str(r.desc, 200), rate, qty, amount: Math.round(rate * qty * 100) / 100, method: type === "payment" && !r.opening ? str(r.method, 120) : "", ref: str(r.ref, 80), by: u.name, at: now(), ...(r.opening ? { opening: true } : {}) };
    });
    a.entries = [...(a.entries || []), ...made]; return { msg: made.length > 1 ? `${made.length} entries added.` : "Added to the account." };
  }
  if (d.op === "entryDelete") {
    must(can(u, "ledger") || can(u, "receipts") || u.role === "admin", "You do not have permission for this.", 403);
    const a = db.agentBook.find(x => x.id === d.id); must(a, "Agent not found."); must((a.entries || []).some(e => e.id === d.eid), "Entry not found.");
    a.entries = a.entries.filter(e => e.id !== d.eid); return { msg: "Entry deleted." };
  }
  must(false, "Unknown request.");
}
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
