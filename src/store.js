import { getLang } from "./i18n.js";
// Client-side store for the MAM & MAM Overseas portal.
// The server is the source of truth: /api/state returns what the signed-in user may see,
// and every change goes through act() in actions.js, which returns the updated state.

export * from "./constants.js";
import { INITIAL } from "./constants.js";

export const now = () => new Date().toISOString();
export const uid = p => p + Math.random().toString(36).slice(2, 9);


/* ---------------- store + subscription ---------------- */
const EMPTY = {
  v: 5, session: null, settings: structuredClone(INITIAL.settings), seo: INITIAL.seo, packages: [], posts: [], testimonials: [], team: [], gallery: [],
  stats: { employers: 0, hired: 0 }, jobs: [], applications: [], notifications: [], orders: [], messages: [], workers: [], clearances: [], ledger: [], tickets: [], users: []
};
export const EMPTY_FILTERS = { q: "", country: "", cat: "", type: "", exp: "", minBdt: "", benefits: [], sort: "new" };
export const store = {
  S: EMPTY, loaded: false, offline: false,
  ui: {
    tab: { candidate: "overview", employer: "overview", admin: "overview", agent: "overview", staff: "overview" },
    editJob: null, editPost: null, editWorker: null, agentJob: "", clWorker: "", ledgerAgent: "",
    clFilter: "all", userFilter: "all", jobFilter: "all", appFilter: { job: "", status: "" },
    F: { ...EMPTY_FILTERS }, modal: null, toast: "", navOpen: false, busy: false
  }
};
let version = 0;
const subs = new Set();
export const subscribe = fn => { subs.add(fn); return () => subs.delete(fn); };
export const getVersion = () => version;
export function touch() { version++; subs.forEach(f => f()); }
/* re-render after a change to screen-only state (tabs, filters, open forms) */
export function commit() { touch(); return true; }
export function setState(next) { if (next && typeof next === "object" && "session" in next) store.S = next; touch(); }
export async function loadState() {
  try { const r = await fetch("/api/state", { credentials: "same-origin" }); setState(await r.json()); store.loaded = true; store.offline = false; }
  catch { store.offline = true; }
  touch();
}

/* ---------------- read helpers ---------------- */
const S = () => store.S;
export const me = () => (S().session ? S().users.find(u => u.id === S().session) : null);
export const user = id => S().users.find(u => u.id === id);
export const job = id => S().jobs.find(j => j.id === id);
export const worker = id => S().workers.find(w => w.id === id);
export const company = j => user(j.employerId)?.company?.name || "Employer";
export const money = (n, c) => `${c} ${Number(n).toLocaleString("en-US")}`;
export const num = n => Number(n || 0).toLocaleString("en-US");
export const bdtFmt = n => `BDT ${num(n)}`;
export const rate = c => Number(S().settings.rates[c] || 0);
export const bdtMin = j => Math.round(j.salaryMin * rate(j.currency));
export const bdtMax = j => Math.round(j.salaryMax * rate(j.currency));
const LOCALE = { en: "en-GB", bn: "bn-BD", ar: "ar-EG", hi: "hi-IN", fj: "en-GB" };
export const fdate = iso => (iso ? new Date(iso).toLocaleDateString(LOCALE[getLang()] || "en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
export const live = () => S().jobs.filter(j => j.status === "active");
export const appsFor = jid => S().applications.filter(a => a.jobId === jid);
export const kb = b => (b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.round(b / 1024) + " KB");
export const unread = u => S().notifications.filter(n => n.uid === u.id && !n.read).length;
export const balanceOf = aid => S().ledger.filter(l => l.agentId === aid && l.status === "confirmed").reduce((s, l) => s + (l.type === "charge" ? 1 : -1) * Number(l.amount), 0);
export function candOf(a) {
  if (a.workerId) {
    const w = worker(a.workerId) || { name: "Removed worker" }; const ag = user(a.agentId);
    return { name: w.name, email: "", via: ag?.agent?.business || ag?.name || "Agent",
      profile: { trade: w.trade, experience: w.experience, district: w.district, phone: w.phone, passport: w.passport ? "Yes" : "No", passportExpiry: w.passportExpiry, cv: null } };
  }
  const c = user(a.candidateId);
  return c ? { ...c, via: null } : { name: "Removed user", profile: {}, via: null };
}
/* Whose clearance file is this: an agent's worker or a job seeker applying directly */
export function clPerson(c) {
  if (c.workerId) {
    const w = worker(c.workerId) || { name: "Removed worker" }; const ag = user(c.agentId);
    return { ...w, via: ag?.agent?.business || ag?.name || "Agent", kind: "agent", ownerId: c.agentId };
  }
  const u = user(c.candidateId) || { name: "Removed user", profile: {} }; const p = u.profile || {};
  return { name: c.fullName || u.name, passport: c.passportNo || p.passportNo || "", passportExpiry: p.passportExpiry, phone: p.phone, district: p.district, trade: p.trade, father: "", dob: "", via: "Job seeker (direct)", kind: "candidate", ownerId: c.candidateId };
}
export const clOpen = c => !["approved", "rejected"].includes(c.status);
export const cardPending = c => c.status === "approved" && !c.card;

export function completeness(u) {
  const p = u.profile || {}; const keys = ["phone", "district", "trade", "experience", "passport", "languages", "skills", "countries"];
  const n = keys.filter(k => p[k] !== undefined && p[k] !== "").length + (p.cv ? 2 : 0) + (p.photo ? 1 : 0) + (p.passportFile ? 1 : 0) + (p.passportNo ? 1 : 0);
  return Math.round((n / (keys.length + 5)) * 100);
}
export function filteredJobs(F) {
  const q = F.q.trim().toLowerCase();
  const L = live().filter(j =>
    (!q || [j.title, j.category, j.city, j.country, company(j)].join(" ").toLowerCase().includes(q)) &&
    (!F.country || j.country === F.country) && (!F.cat || j.category === F.cat) && (!F.type || j.type === F.type) &&
    (F.exp === "" || j.experience <= Number(F.exp)) &&
    (!F.minBdt || bdtMax(j) >= Number(F.minBdt)) &&
    F.benefits.every(b => j.benefits.includes(b)));
  if (F.sort === "sal") L.sort((a, b) => bdtMax(b) - bdtMax(a));
  else if (F.sort === "dead") L.sort((a, b) => a.deadline.localeCompare(b.deadline));
  else L.sort((a, b) => b.featured - a.featured || b.created.localeCompare(a.created));
  return L;
}

