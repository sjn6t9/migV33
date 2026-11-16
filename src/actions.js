import { store, touch, setState, me, clPerson } from "./store.js";

const ui = store.ui;

let toastTimer;
export function toast(msg) { if (!msg) return; ui.toast = msg; touch(); clearTimeout(toastTimer); toastTimer = setTimeout(() => { ui.toast = ""; touch(); }, 3600); }
export function openModal(type, props = {}) { ui.modal = { type, ...props }; touch(); }
export function closeModal() { ui.modal = null; touch(); }
export function confirmBox(msg, onYes, yes = "Confirm") { openModal("confirm", { msg, onYes, yes }); }
export const go = hash => { if (location.hash === "#" + hash) touch(); else location.hash = hash; };
export function setTab(role, tab) { ui.tab[role] = tab; if (tab !== "post") ui.editJob = null; go("dashboard"); }

/* Every change goes to the server. Returns the server's reply (or null on failure) and shows its message. */
export async function act(type, payload = {}, { quiet = false } = {}) {
  ui.busy = true; touch();
  try {
    const r = await fetch("/api/act", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, payload }) });
    let out = {}; try { out = await r.json(); } catch { out = { error: r.status === 413 ? "Upload is too large." : "The server did not answer correctly. Try again." }; }
    if (out.state) setState(out.state);
    if (out.error) { toast(out.error); return null; }
    if (!quiet && out.msg) toast(out.msg);
    return out;
  } catch {
    toast("No connection to the server. Check your internet and try again."); return null;
  } finally { ui.busy = false; touch(); }
}

/* ---- account ---- */
export async function signOut() { ui.apply = null; ui.modal = null; const r = await act("auth.logout", {}, { quiet: true }); if (r) { toast("Signed out."); go("home"); } }
export function afterLogin(r) { if (!r) return; ui.modal = null; touch(); go("dashboard"); }

/* ---- job seeker ---- */
export async function toggleSave(jid) {
  const u = me();
  if (!u) { toast("Sign in as a job seeker to save jobs."); openModal("auth", { mode: "login" }); return; }
  if (u.role !== "candidate") { toast("Only job seeker accounts can save jobs."); return; }
  await act("cand.save", { jobId: jid });
}
/* Apply = guided flow in the job seeker panel: Select job post → Update profile → Apply */
export function apply(jid) {
  const u = me();
  if (!u) { ui.apply = { step: 2, jobId: jid }; ui.tab.candidate = "applications"; toast("Sign in or create an account to apply."); openModal("auth", { mode: "register", role: "candidate" }); return; }
  if (u.role !== "candidate") { toast("Only job seeker accounts can apply."); return; }
  if (store.S.applications.some(a => a.jobId === jid && a.candidateId === u.id)) { toast("You already applied for this job."); return; }
  ui.apply = { step: 2, jobId: jid }; ui.tab.candidate = "applications"; go("dashboard");
}
export function withdraw(aid) { confirmBox("Withdraw this application? The employer will no longer see it.", () => act("app.withdraw", { id: aid }), "Withdraw"); }

/* ---- staff / admin shortcuts ---- */
export const setAppStatus = (aid, s) => act("app.status", { id: aid, status: s });
export const setClStatus = (cid, s) => act("admin.clStatus", { id: cid, status: s });
export function deleteUser(id) { const x = store.S.users.find(u => u.id === id); confirmBox(`Delete ${x?.name || "this account"}? Their jobs, applications and files are removed too.`, () => act("admin.deleteUser", { id }), "Delete"); }
export const confirmPayment = (lid, ok) => act("admin.ledgerConfirm", { id: lid, ok });

/* ---- uploads: images are shrunk to JPEG before sending, PDFs/Word sent as they are ---- */
export function readAsDataUrl(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
}
export async function compressImage(file, max = 1400, q = 0.8) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    const sc = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas"); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", q);
  } finally { URL.revokeObjectURL(url); }
}
export const DOC_TYPES = ".pdf,.jpg,.jpeg,.png,.webp";
/* Returns { name, data } ready to send, or throws an Error with a message for the user */
export async function readUpload(file, { imageMax = 1600, pdfMaxMB = 5, photo = false, word = false } = {}) {
  if (!file || !file.size) throw new Error("Choose a file first.");
  const isImg = /^image\//.test(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name);
  const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
  const isWord = word && /\.docx?$/i.test(file.name);
  if (photo && !isImg) throw new Error("Choose a photo (JPG or WebP).");
  if (!isImg && !isPdf && !isWord) throw new Error(word ? "Upload a PDF, DOC or DOCX file." : "Upload a PDF or a JPG/WebP image.");
  if (isPdf || isWord) {
    if (file.size > pdfMaxMB * 1048576) throw new Error(`File is larger than ${pdfMaxMB} MB.`);
    return { name: file.name, data: await readAsDataUrl(file) };
  }
  let data;
  try { data = await compressImage(file, imageMax); } catch { throw new Error("This image could not be read. Try another file."); }
  return { name: `${file.name.replace(/\.[^.]+$/, "")}.jpg`, data };
}
export const fileExt = f => (f?.name.split(".").pop() || "pdf").toLowerCase();

/* Download a stored file (URL from the server) with a friendly file name */
export async function downloadFile(src, filename) {
  try {
    const r = await fetch(src, { credentials: "same-origin" });
    if (!r.ok) { toast("The file could not be opened. You may not have access to it."); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch { toast("Download failed. Check your connection and try again."); }
}
export const cardFileName = c => `BMET-Clearance-Card-${(clPerson(c).passport || c.id).replace(/[^\w-]/g, "")}.${(c.card?.name.split(".").pop() || "pdf").toLowerCase()}`;

/* read a <form> into a plain object; multi-value fields via fd.getAll */
export function formData(e) {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  return [Object.fromEntries(fd.entries()), fd];
}
