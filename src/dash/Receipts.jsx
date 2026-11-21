// Admin panel › Money receipts: payment entry (any of name, mobile, passport, email, agent),
// search to find and update a payer's account, and receipts downloadable as PNG, PDF and Excel.
import React from "react";
import { LuPlus, LuSearch, LuEye, LuDownload, LuFileSpreadsheet, LuFileText, LuImage, LuPrinter, LuPencil, LuX, LuReceipt, LuUserRound, LuBan, LuCheck, LuSignature, LuUpload, LuTrash2, LuClock, LuQrCode, LuExternalLink, LuMail, LuBookUser } from "react-icons/lu";
import { store, user, balanceOf } from "../store.js";
import { act, openModal, closeModal, toast, confirmBox, setTab } from "../actions.js";
import { Field } from "./shared.jsx";
import { Tiles, Empty } from "../ui.jsx";
import { Statement } from "./Statement.jsx";
import { passports, ppMatch, PassportPick, ppLine } from "./Passports.jsx";
import { agentRows, accountRows } from "../statement.js";
import { bookAgents, bookByName, bookAccount } from "./AgentBook.jsx";
import { drawReceipt, receiptPng, receiptPdf, receiptPdfBlob, receiptXlsx, receiptsXlsx, takaWords, tk, rDate, receiptUrl, payText } from "../receipt.js";

import { METHODS, channelsFor } from "../banks.js";
const PURPOSES = ["Visa processing fee", "Medical fee", "BMET clearance fee", "Air ticket", "Service charge", "Advance payment", "Final payment", "Training fee"];
const PAYER = [["name", "Name", "text", "Full name"], ["mobile", "Mobile number", "tel", "01XXXXXXXXX"], ["passport", "Passport No.", "text", "A01234567"], ["email", "Email address", "email", "name@example.com"], ["agent", "Agent name", "text", "Agent or office"]];
const MR = () => store.S.mr || { accounts: [], receipts: [] };
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const hay = o => [o.name, o.mobile, o.passport, o.email, o.agent].join(" ").toLowerCase();
export function mrMatch(q) {
  const s = q.trim().toLowerCase(); if (!s) return () => true;
  const d = s.replace(/[^\d]/g, "");
  return o => { const h = hay(o.payer || o) + " " + [o.no, o.purpose, o.ref, o.method].join(" ").toLowerCase(); return h.includes(s) || (d.length >= 4 && h.replace(/[^\d]/g, " ").includes(d)); };
}
const charges = aid => (MR().charges || []).filter(c => c.accountId === aid);
const payable = a => (a?.price || 0) + charges(a?.id).reduce((s, c) => s + c.amount, 0);
const accReceipts = aid => MR().receipts.filter(r => r.accountId === aid);
const paid = list => list.filter(r => !r.void).reduce((s, r) => s + r.amount, 0);
const me = () => user(store.S.session);
const ok = r => r.status === "approved" && !r.void;
const canApprove = r => { const u = me(); return r.status === "pending" && !r.void && (u?.role === "admin" || r.received?.uid !== u?.id); };
const canDiscard = r => { const u = me(); return r.status === "pending" && (u?.role === "admin" || r.received?.uid === u?.id); };
export function approve(r) {
  if (!me()?.signature) { toast("Upload your signature first: Settings › My signature."); return; }
  confirmBox(`Approve payment ${r.no} of BDT ${tk(r.amount)} from ${r.payer.name || r.payer.passport || r.payer.mobile || "the payer"}? Your name and signature go on the receipt as Authorized signature.`, async () => { const res = await act("admin.mr", { op: "approve", id: r.id }); if (res) { openModal("mrView", { rid: r.id }); if (res.email) mailReceipt(r.id); } }, "Approve");
}
/** make the PDF here and have the server email it to the payer */
export async function mailReceipt(rid, to) {
  const r = MR().receipts.find(x => x.id === rid); if (!r) return;
  try {
    const blob = await receiptPdfBlob(r, store.S.settings);
    const pdf = await new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = rej; f.readAsDataURL(blob); });
    await act("admin.mr", { op: "mail", id: r.id, pdf, to });
  } catch { toast("The receipt PDF could not be made for the email. Try Send by email again."); }
}
const discard = r => confirmBox(`Delete entry ${r.no}? It was not approved, so no receipt was made.`, async () => { if (await act("admin.mr", { op: "discard", id: r.id })) closeModal(); }, "Delete entry");
export function StatusBadge({ r }) {
  return r.void ? <span className="ec-badge s-rejected">Cancelled</span> : r.status === "approved" ? <span className="ec-badge s-approved">Approved</span> : <span className="ec-badge mr-wait"><LuClock /> Waiting for approval</span>;
}
/* signature picture: keep transparency, make the paper (near-white) transparent, trim the empty edges */
export async function readSignature(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error("Choose a PNG picture of the signature.");
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    const sc = Math.min(1, 900 / img.width, 400 / img.height), w = Math.max(1, Math.round(img.width * sc)), h = Math.max(1, Math.round(img.height * sc));
    const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d"); g.drawImage(img, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h), px = d.data; let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let i = 0; i < px.length; i += 4) {
      const lum = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
      if (lum > 215) px[i + 3] = 0; else if (lum > 170) px[i + 3] = Math.min(px[i + 3], Math.round(255 * (215 - lum) / 45));
      if (px[i + 3] > 24) { const p = i / 4, x = p % w, y = (p - x) / w; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) throw new Error("No signature found in this picture. Sign with a dark pen on white paper.");
    g.putImageData(d, 0, 0); const pad = 6; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
    const t = document.createElement("canvas"); t.width = x1 - x0 + 1; t.height = y1 - y0 + 1; t.getContext("2d").drawImage(c, x0, y0, t.width, t.height, 0, 0, t.width, t.height);
    return { name: "signature.png", data: t.toDataURL("image/png") };
  } catch (e) { throw new Error(e.message && !/decode/i.test(e.message) ? e.message : "This picture could not be read. Try another file."); }
  finally { URL.revokeObjectURL(url); }
}
export function SignatureBox({ u, title = "My signature", note }) {
  const pick = async e => { const f = e.target.files[0]; e.target.value = ""; if (!f) return; try { await act("staff.signature", { uid: u.id, file: await readSignature(f) }); } catch (er) { toast(er.message); } };
  const sig = u.signature?.id ? `/api/files/${u.signature.id}` : "";
  return <div className="mr-sigbox">
    <div className="mr-sigpic">{sig ? <img src={sig} alt={`Signature of ${u.name}`} /> : <span className="muted small"><LuSignature /> No signature yet</span>}</div>
    <div className="stack6"><b className="small">{title}</b><span className="muted small">{note || "PNG picture of the signature (dark pen on white paper is fine: the white is removed)."}</span>
      <div className="row6"><label className="btn sm"><LuUpload /> {sig ? "Change" : "Upload PNG"}<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={pick} /></label>
        {sig && <button type="button" className="btn sm danger" onClick={() => confirmBox("Remove this signature? Receipts already signed keep it.", () => act("staff.signature", { uid: u.id, remove: true }), "Remove")}><LuTrash2 /> Remove</button>}</div></div>
  </div>;
}
const agentNames = () => [...new Set(store.S.users.filter(u => u.role === "agent").map(u => u.agent?.business || u.name).filter(Boolean))];

/* ---------------- main page ---------------- */
export function ReceiptsAdmin() {
  const { accounts, receipts } = MR();
  const [q, setQ] = React.useState(""); const [view, setView] = React.useState("receipts"); const [n, setN] = React.useState(25);
  const m = mrMatch(q);
  const Rall = receipts.filter(m), pend = Rall.filter(r => r.status === "pending" && !r.void);
  const R = view === "pending" ? pend : Rall, Acc = accounts.filter(a => m(a) || (q && accReceipts(a.id).some(m)));
  const d = today(), mo = d.slice(0, 7), live = receipts.filter(ok); const u = me();
  const waiting = receipts.filter(r => r.status === "pending" && !r.void).length;
  const sum = l => `৳ ${tk(paid(l)).replace(/\.00$/, "")}`;
  return <>
    <div className="ec-head"><div><h2>Money receipts</h2><p className="muted small">Payment entry and money receipts. Search by anything to find a payer's account.</p></div>
      <button className="btn pri" onClick={() => openModal("mrEntry", {})}><LuPlus /> New payment entry</button></div>
    {u && !u.signature && <div className="notice">Upload your signature before you approve payments: Settings (bottom of the menu) › My signature. <button className="btn link sm" onClick={() => setTab(u.role, "mysettings")}>Open Settings</button></div>}
    <Tiles items={[[sum(live.filter(r => r.date === d)), "Received today"], [sum(live.filter(r => r.date.startsWith(mo))), "This month"], [String(waiting), "Waiting for approval", waiting > 0], [String(live.length), "Approved receipts"]]} />
    <div className="ec-tools mt14">
      <div className="mr-seg" role="tablist">{[["receipts", "Receipts", Rall.length], ["pending", "Waiting for approval", pend.length], ["accounts", "Accounts", Acc.length]].map(([k, l, c]) => <button key={k} role="tab" aria-selected={view === k} className={view === k ? "on" : ""} onClick={() => setView(k)}>{l} <span>{c}</span></button>)}</div>
      <span className="grow" />
      <label className="ec-search mr-search"><input type="text" value={q} onChange={e => { setQ(e.target.value); setN(25); }} placeholder="Search name, mobile, passport, email, agent or receipt no." /><LuSearch /></label>
      {view !== "accounts" && <button className="btn" disabled={!R.length} onClick={() => receiptsXlsx(R, q ? `Search: ${q}` : "All receipts")}><LuFileSpreadsheet /> Excel</button>}
    </div>
    {view !== "accounts" ? (R.length ? <div className="tbl ec-tbl grid"><table><thead><tr><th>SL</th><th>Receipt No.</th><th>Date</th><th>Name</th><th>Passport / Mobile</th><th>Agent</th><th className="r">Amount (BDT)</th><th>Status</th><th>Entry / approval</th><th>Receipt</th></tr></thead><tbody>
      {R.slice(0, n).map((r, i) => <tr key={r.id} className={r.void ? "mr-void" : ""}>
        <td>{i + 1}</td><td className="ec-ref" data-notr>{r.no}</td><td className="num">{rDate(r.date)}</td>
        <td data-notr>{r.payer.name || "—"}</td><td className="num" data-notr><div className="ec-sub"><span>{r.payer.passport || "—"}</span><span className="muted small">{r.payer.mobile}</span></div></td><td data-notr>{r.payer.agent || "—"}</td>
        <td className="num r"><b>{tk(r.amount)}</b><div className="muted small">{r.method}</div></td>
        <td><StatusBadge r={r} /></td>
        <td><div className="ec-sub"><span className="small" data-notr>{r.received?.name || "—"}</span>{r.approved ? <span className="small mr-ok" data-notr><LuCheck /> {r.approved.name}</span> : null}</div></td>
        <td><div className="row6"><button className="ec-ico view" title="View receipt" aria-label="View receipt" onClick={() => openModal("mrView", { rid: r.id })}><LuEye /></button>
          {ok(r) || r.void ? <DlMenu r={r} /> : canApprove(r) ? <button className="btn sm pri" onClick={() => approve(r)}><LuCheck /> Approve</button> : null}</div></td>
      </tr>)}</tbody></table></div> : <Empty>{q ? "No receipt matches your search." : view === "pending" ? "Nothing is waiting for approval." : "No payments yet. Use New payment entry to add the first one."}</Empty>)
      : (Acc.length ? <div className="tbl ec-tbl grid"><table><thead><tr><th>SL</th><th>Name</th><th>Mobile</th><th>Passport No.</th><th>Email</th><th>Agent</th><th className="r">Receipts</th><th className="r">Total paid (BDT)</th><th className="r">Due / advance</th><th>Actions</th></tr></thead><tbody>
        {Acc.slice(0, n).map((a, i) => { const l = accReceipts(a.id); return <tr key={a.id}>
          <td>{i + 1}</td><td data-notr><b>{a.name || "—"}</b></td><td className="num" data-notr>{a.mobile || "—"}</td><td className="num" data-notr>{a.passport || "—"}</td><td data-notr>{a.email || "—"}</td><td data-notr>{a.agent || "—"}</td>
          <td className="num r">{l.length}</td><td className="num r b">{tk(paid(l.filter(ok)))}</td><td className="num r"><DueCell a={a} l={l} /></td>
          <td><div className="row6"><button className="btn sm pri" onClick={() => openModal("mrEntry", { aid: a.id })}><LuPlus /> Payment</button><button className="btn sm" onClick={() => openModal("mrAccount", { aid: a.id })}><LuPencil /> Account</button></div></td>
        </tr>; })}</tbody></table></div> : <Empty>{q ? "No account matches your search." : "No accounts yet. An account is made with the first payment entry."}</Empty>)}
    {(view !== "accounts" ? R : Acc).length > n && <div className="center mt14"><button className="btn" onClick={() => setN(n + 50)}>Show more</button></div>}
  </>;
}

function DueCell({ a, l }) {
  const d = a.agentId ? balanceOf(a.agentId) : payable(a) > 0 ? payable(a) - paid(l.filter(ok)) : null;
  if (d === null) return <span className="muted">—</span>;
  return d > 0 ? <span className="mr-due">{`Due ${tk(d)}`}</span> : d < 0 ? <span className="mr-ok">{`Advance ${tk(-d)}`}</span> : <span className="mr-ok">Paid</span>;
}
/* download menu: PNG, PDF, Excel */
function DlMenu({ r }) {
  const [open, setOpen] = React.useState(false); const ref = React.useRef(null); const [pos, setPos] = React.useState(null);
  React.useEffect(() => { if (!open) return; const f = e => { if (!ref.current?.contains(e.target)) setOpen(false); }; document.addEventListener("pointerdown", f); const c = () => setOpen(false); window.addEventListener("scroll", c, true); return () => { document.removeEventListener("pointerdown", f); window.removeEventListener("scroll", c, true); }; }, [open]);
  const toggle = e => { const b = e.currentTarget.getBoundingClientRect(); setPos({ top: b.bottom + 4, left: Math.max(8, b.right - 170) }); setOpen(!open); };
  const S = store.S.settings; const go = f => { setOpen(false); f(r, S).catch?.(er => toast(er.message)); };
  return <div ref={ref} className="mr-dl"><button className="ec-ico pdf" title="Download" aria-label="Download receipt" aria-expanded={open} onClick={toggle}><LuDownload /></button>
    {open && pos && <div className="ec-dl-menu mr-menu" style={{ position: "fixed", top: pos.top, left: pos.left, width: 170 }}>
      <button onClick={() => go(receiptPng)}><LuImage /> PNG image</button><button onClick={() => go(receiptPdf)}><LuFileText /> PDF</button><button onClick={() => go(async (a, b) => receiptXlsx(a, b))}><LuFileSpreadsheet /> Excel (.xlsx)</button></div>}
  </div>;
}

/* ---------------- payment entry ---------------- */
export const agents = () => store.S.users.filter(u => u.role === "agent").map(u => ({ id: u.id, name: u.agent?.business || u.name, person: u.name })).sort((x, y) => x.name.localeCompare(y.name));
const money = n => `${n < 0 ? "-" : ""}${tk(Math.abs(n))}`;
/** what the payment does to the balance: agent account (due / advance) or the payer's set price (due) */
export function balanceRows(b) {
  if (!b) return null;
  const end = b.after > 0 ? ["Due", tk(b.after), "due"] : b.after < 0 ? ["Advance", tk(-b.after), "adv"] : ["Fully paid", tk(0), "paid"];
  if (b.kind === "agent") return [[b.before >= 0 ? "Previous due" : "Previous advance", tk(Math.abs(b.before))], ["Paid now", tk(b.paid)], [b.after > 0 ? "New due" : end[0], end[1], end[2]]];
  return [["Total price", tk(b.price)], ["Paid before", tk(b.before)], ...(b.paid ? [["Paid now", tk(b.paid)]] : []), end];
}
export function BalanceBox({ b, note }) {
  const rows = balanceRows(b); if (!rows) return null;
  return <div className="mr-bal">{rows.map(([l, v, k], i) => <div key={i} className={k ? `mr-bal-end ${k}` : ""}><span>{l}</span><b className="num">{v}</b></div>)}{note && <p className="muted small">{note}</p>}</div>;
}

export function MrEntry({ aid: aid0, pp: pp0, agentId: ag0, book: bk0 }) {
  // started from Agents: the payer is the agent itself
  const reg0 = ag0 && store.S.users.find(x => x.id === ag0), bk1 = bk0 && bookAgents().find(x => x.id === bk0);
  const fromAgent = reg0 ? { name: reg0.name || "", mobile: reg0.agent?.phone || reg0.phone || "", passport: "", email: reg0.email || "", agent: "" } : bk1 ? { name: bk1.fullName || bk1.name, mobile: bk1.mobile || "", passport: "", email: bk1.email || "", agent: bk1.name } : null;
  const pp1 = pp0 && passports().find(x => x.id === pp0); // started from Passport entry
  const acc1 = !aid0 && pp1 ? MR().accounts.find(a => a.passport === pp1.passport) : null;
  const [aid, setAid] = React.useState(aid0 || acc1?.id || null);
  const acc = aid && MR().accounts.find(a => a.id === aid);
  const blank = { name: "", mobile: "", passport: "", email: "", agent: "" };
  const [p, setP] = React.useState(fromAgent && !acc ? fromAgent : acc ? { ...blank, ...pick(acc) } : pp1 ? { ...blank, name: pp1.name, passport: pp1.passport, agent: pp1.agentId ? "" : pp1.ref || "" } : blank);
  const [agentId, setAgentId] = React.useState(reg0 ? reg0.id : acc?.agentId || (!acc && pp1?.agentId) || ""); const [agentOther, setAgentOther] = React.useState(() => { if (bk1) return "book"; if (reg0) return false; const n = acc ? !acc.agentId && acc.agent : pp1 && !pp1.agentId && pp1.ref; return n ? (bookByName(n) ? "book" : true) : false; });
  const [price, setPrice] = React.useState(acc?.price != null ? String(acc.price) : "");
  const newLine = () => ({ k: Math.random().toString(36).slice(2), amount: "", date: today(), method: "Cash", channel: "", chOther: false, ref: "", purpose: "" });
  const [lines, setLines] = React.useState(() => [newLine()]);
  const setLine = (i, v) => setLines(lines.map((L, j) => (j === i ? { ...L, ...v } : L)));
  const [q, setQ] = React.useState(""); const [busy, setBusy] = React.useState(false);
  const found = q.trim() ? MR().accounts.filter(mrMatch(q)).slice(0, 6) : [];
  const foundPp = q.trim() ? passports().filter(ppMatch(q)).filter(x => !MR().accounts.some(a => a.passport === x.passport)).slice(0, 5) : [];
  const usePp = x => { setAid(null); setP({ ...blank, name: x.name, passport: x.passport, agent: x.agentId ? "" : x.ref || "" }); setAgentId(x.agentId || ""); setAgentOther(!x.agentId && !!x.ref ? (bookByName(x.ref) ? "book" : true) : false); setPrice(""); setQ(""); };
  const auto = !aid && MR().accounts.find(a => ["passport", "mobile", "email"].some(k => p[k] && norm(k, p[k]) === a[k]));
  const target = acc || auto;
  const choose = a => { setAid(a.id); setP({ ...blank, ...pick(a) }); setAgentId(a.agentId || ""); setAgentOther(!a.agentId && !!a.agent ? (bookByName(a.agent) ? "book" : true) : false); setPrice(a.price != null ? String(a.price) : ""); setQ(""); };
  const clear = () => { setAid(null); setP(blank); setAgentId(""); setAgentOther(false); setPrice(""); };
  const has = Object.values(p).some(v => v.trim()) || !!agentId;
  const amt = lines.reduce((t, L) => t + (Number(L.amount) > 0 ? Number(L.amount) : 0), 0);
  const ag = agentId && agents().find(x => x.id === agentId);
  const before = target ? paid(accReceipts(target.id).filter(ok)) : 0;
  const bal = ag ? { kind: "agent", before: balanceOf(ag.id), paid: amt, after: balanceOf(ag.id) - amt }
    : (Number(price) || 0) + (target ? charges(target.id).reduce((s, c) => s + c.amount, 0) : 0) > 0 ? (() => { const pay = (Number(price) || 0) + (target ? charges(target.id).reduce((s, c) => s + c.amount, 0) : 0); return { kind: "price", price: pay, before, paid: amt, after: pay - before - amt }; })() : null;
  const pickAgent = v => { if (v.startsWith("book:")) { const b = bookAgents().find(x => x.id === v.slice(5)); setAgentId(""); setAgentOther("book"); setP({ ...p, agent: b ? b.name : "" }); } else if (v === "__other") { setAgentId(""); setAgentOther(true); } else { setAgentId(v); setAgentOther(false); const x = agents().find(y => y.id === v); setP({ ...p, agent: x ? x.name : "" }); } };
  const submit = async e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.currentTarget));
    if (!has) { toast("Enter at least one of: name, mobile, passport no., email or agent name."); return; }
    const many = lines.length > 1;
    for (const [i, L] of lines.entries()) {
      const at = many ? ` (payment ${i + 1})` : "", ch = channelsFor(L.method);
      if (!(Number(L.amount) > 0)) { toast(`Enter the amount received${at}.`); return; }
      if (ch && L.method !== "Cheque" && !L.channel.trim()) { toast((L.method === "Mobile banking" ? "Choose the mobile banking service" : "Choose the bank") + `${at}.`); return; }
    }
    setBusy(true);
    const r = await act("admin.mr", { op: "entry", accountId: aid || (auto ? auto.id : undefined), payer: { ...p, agent: ag ? ag.name : agentOther ? p.agent : "" }, agentId: agentId || "",
      price: agentId ? undefined : price, note: d.note,
      lines: lines.map(L => ({ amount: Number(L.amount), date: L.date, method: L.method, channel: channelsFor(L.method) ? L.channel : "", ref: L.ref, purpose: L.purpose })) });
    if (r?.receiptIds?.length > 1) { setBusy(false); openModal("mrAccount", { aid: r.accountId }); return; }
    setBusy(false); if (r?.receiptId) openModal("mrView", { rid: r.receiptId, fresh: true });
  };
  return <form className="mr-entry" onSubmit={submit} noValidate>
    <h2 className="row6"><LuReceipt /> Payment entry</h2>
    <p className="muted small mb14">{`You sign as Received by. After an admin or another staff member approves the payment, the money receipt with its QR code is made.`}</p>
    <div className="mr-find">
      <label className="ec-search"><input type="text" value={q} onChange={e => setQ(e.target.value)} placeholder="Search an existing account: name, mobile, passport, email or agent" aria-label="Search an existing account" /><LuSearch /></label>
      {q.trim() && <div className="mr-found">{found.length || foundPp.length ? <>{found.map(a => <button type="button" key={a.id} onClick={() => choose(a)}>
        <LuUserRound /><span><b data-notr>{a.name || a.passport || a.mobile || a.email}</b><small data-notr>{[a.passport, a.mobile, a.agent].filter(Boolean).join(" · ")}</small></span><em>{`${accReceipts(a.id).length} receipts`}</em></button>)}
        {foundPp.map(x => <button type="button" key={x.id} onClick={() => usePp(x)}><LuBookUser /><span><b data-notr>{x.name}</b><small data-notr>{[x.passport, x.country, x.gender, x.ref].filter(Boolean).join(" · ")}</small></span><em>Passport list</em></button>)}</>
        : <p className="muted small">No account found. Fill in the details below to make a new one.</p>}</div>}
    </div>
    {acc ? <div className="mr-acc"><LuUserRound /><span>Account: <b data-notr>{acc.name || acc.passport || acc.mobile}</b> · <span className="muted">changes below update this account</span></span><button type="button" className="btn sm link" onClick={clear}><LuX /> New account</button></div>
      : auto ? <div className="mr-acc soft"><LuUserRound /><span>This payment will be added to the existing account of <b data-notr>{auto.name || auto.passport || auto.mobile}</b>.</span><button type="button" className="btn sm link" onClick={() => choose(auto)}>Open account</button></div> : null}
    <fieldset className="card mr-box"><legend>Payer details <span className="muted small">· fill in any one or all</span></legend>
      <div className="fgrid">{PAYER.filter(x => x[0] !== "agent").map(([k, l, t, ph]) => <Field key={k} label={l}><input type={t} value={p[k]} onChange={e => setP({ ...p, [k]: e.target.value })} placeholder={ph} maxLength={120} inputMode={k === "mobile" ? "tel" : undefined} /></Field>)}
        <Field label="Agent"><select value={agentOther === "book" && bookByName(p.agent) ? `book:${bookByName(p.agent).id}` : agentOther ? "__other" : agentId} onChange={e => pickAgent(e.target.value)}><option value="">— No agent —</option>
          {agents().map(x => { const d = balanceOf(x.id); return <option key={x.id} value={x.id} data-notr>{`${x.name}${d > 0 ? ` · due ${tk(d)}` : d < 0 ? ` · advance ${tk(-d)}` : ""}`}</option>; })}
          {bookAgents().length > 0 && <optgroup label="Agent list">{[...bookAgents()].sort((x, y) => x.name.localeCompare(y.name)).map(b => { const d = bookAccount(b).due; return <option key={b.id} value={`book:${b.id}`} data-notr>{`${b.name}${d > 0 ? ` · due ${tk(d)}` : ""}`}</option>; })}</optgroup>}
          <option value="__other">Other agent (type the name)</option></select></Field>
        {agentOther === true && <Field label="Agent name"><input type="text" value={p.agent} onChange={e => setP({ ...p, agent: e.target.value })} maxLength={120} placeholder="Agent or office" /></Field>}
      </div>
    </fieldset>
    <fieldset className="card mr-box"><legend>{lines.length > 1 ? `Payments (${lines.length})` : "Payment"}</legend>
      {lines.map((L, i) => { const ch = channelsFor(L.method); return <div key={L.k} className={lines.length > 1 ? "mr-line" : ""}>
        {lines.length > 1 && <div className="mr-line-head"><b>{`Payment ${i + 1}`}</b><button type="button" className="btn sm link danger" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label={`Remove payment ${i + 1}`}><LuX /> Remove</button></div>}
        <div className="fgrid">
          <Field label="Amount (BDT)"><input type="number" min="1" step="0.01" required placeholder="0.00" inputMode="decimal" value={L.amount} onChange={e => setLine(i, { amount: e.target.value })} aria-label={`Amount (BDT), payment ${i + 1}`} /></Field>
          <Field label="Date"><input type="date" value={L.date} onChange={e => setLine(i, { date: e.target.value })} /></Field>
          <Field label="Payment method"><select value={L.method} onChange={e => setLine(i, { method: e.target.value, channel: "", chOther: false })}>{METHODS.map(x => <option key={x}>{x}</option>)}</select></Field>
          {ch && <Field label={L.method === "Mobile banking" ? "Mobile banking service" : "Bank"}>
            <select value={L.chOther ? "__other" : L.channel} onChange={e => setLine(i, e.target.value === "__other" ? { chOther: true, channel: "" } : { chOther: false, channel: e.target.value })}>
              <option value="">{L.method === "Mobile banking" ? "— Choose the service —" : "— Choose the bank —"}</option>
              {ch.map(x => <option key={x} value={x} data-notr>{x}</option>)}<option value="__other">Other (type the name)</option></select></Field>}
          {ch && L.chOther && <Field label={L.method === "Mobile banking" ? "Service name" : "Bank name"}><input type="text" value={L.channel} onChange={e => setLine(i, { channel: e.target.value })} maxLength={80} /></Field>}
          <Field label={L.method === "Mobile banking" ? "Transaction ID" : L.method === "Cheque" ? "Cheque No." : "Transaction / Ref No."}><input type="text" value={L.ref} onChange={e => setLine(i, { ref: e.target.value })} maxLength={80} placeholder="Optional" /></Field>
          <Field label="Purpose of payment" full><input type="text" value={L.purpose} onChange={e => setLine(i, { purpose: e.target.value })} maxLength={160} list="mr-purposes" placeholder="e.g. Visa processing fee" /></Field>
        </div>
      </div>; })}
      <button type="button" className="btn sm mr-add-line" onClick={() => setLines([...lines, { ...newLine(), date: lines[lines.length - 1].date }])}><LuPlus /> Add another payment</button>
      {lines.length > 1 && <p className="muted small">{`Each payment gets its own money receipt. Total: ${tk(amt)} BDT.`}</p>}
      <div className="fgrid mt14">
        {!agentId && <Field label="Total price (BDT)" hint="What this payer has to pay in total. Leave empty if not needed."><input type="number" min="0" step="0.01" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} placeholder="Optional" /></Field>}
        <Field label="Note" full><textarea name="note" className="short" maxLength={400} placeholder="Optional" /></Field>
      </div>
      <datalist id="mr-purposes">{PURPOSES.map(x => <option key={x} value={x} />)}</datalist>
      {bal && <BalanceBox b={bal} note={ag ? `Agent account of ${ag.name}. The payment is added to it when approved.` : "Only approved payments are counted."} />}
    </fieldset>
    <div className="row between mt14"><button type="button" className="btn" onClick={closeModal}>Cancel</button><button className="btn pri" disabled={busy}><LuReceipt /> {lines.length > 1 ? `Save ${lines.length} payments` : "Save entry"}</button></div>
  </form>;
}
const pick = a => ({ name: a.name || "", mobile: a.mobile || "", passport: a.passport || "", email: a.email || "", agent: a.agent || "" });
const norm = (k, v) => k === "mobile" ? v.replace(/[^\d+]/g, "") : k === "passport" ? v.replace(/\s+/g, "").toUpperCase() : v.trim().toLowerCase();

/* ---------------- receipt view ---------------- */
export function MrView({ rid, fresh }) {
  const r = MR().receipts.find(x => x.id === rid); const [src, setSrc] = React.useState(null);
  const S = store.S.settings; const u = me();
  React.useEffect(() => { let on = true; setSrc(null); if (r) drawReceipt(r, S).then(c => on && setSrc(c.toDataURL("image/png"))); return () => { on = false; }; }, [r?.id, r?.void, r?.status, r?.payer?.name]);
  if (!r) return <p>Receipt not found.</p>;
  const run = f => Promise.resolve(f(r, S)).catch(er => toast(er.message));
  const print = () => { const w = window.open("", "_blank"); if (!w) { toast("Allow pop-ups to print."); return; } w.document.write(`<title>${r.no}</title><style>@page{size:A5 landscape;margin:0}body{margin:0}img{width:100%;display:block}</style><img src="${src}" onload="setTimeout(()=>print(),200)">`); w.document.close(); };
  const voidIt = () => confirmBox(`Cancel receipt ${r.no}? It stays in the list marked Cancelled.`, () => act("admin.mr", { op: "void", id: r.id }), "Cancel receipt");
  const done = ok(r) || r.void;
  return <>
    <div className="row between"><h2 className="row6"><LuReceipt /> <span data-notr>{r.no}</span></h2><StatusBadge r={r} /></div>
    {fresh && r.status === "pending" && <p className="ok-note small">{`Payment saved. An admin or another staff member must approve it; then the money receipt can be downloaded.`}</p>}
    <div className="mr-sigs small">
      <span><b>Received by:</b> <span data-notr>{r.received?.name || "—"}</span>{r.received?.at && <span className="muted"> · {fdt(r.received.at)}</span>}</span>
      <span><b>Authorized signature:</b> {r.approved ? <><span data-notr>{r.approved.name}</span><span className="muted"> · {fdt(r.approved.at)}</span></> : <span className="muted">waiting for approval</span>}</span>
    </div>
    <div className="mr-preview">{src ? <img src={src} alt={`Money receipt ${r.no}`} /> : <div className="mr-ph">Making the receipt…</div>}</div>
    <p className="muted small mt8">{`${tk(r.amount)} BDT · ${takaWords(r.amount)} · ${payText(r)}`}</p>
    {r.balance && <BalanceBox b={r.balance} />}
    {r.status === "approved" && r.payer.email && <p className={`small mt8 ${r.mailed?.ok ? "mr-ok" : "muted"}`}>{r.mailed ? (r.mailed.ok ? `Emailed to ${r.mailed.to} · ${fdt(r.mailed.at)}` : `Not emailed to ${r.mailed.to} (${fdt(r.mailed.at)})`) : `Not emailed yet to ${r.payer.email}`}</p>}
    <div className="mr-actions">
      {done ? <>
        {ok(r) && r.payer.email && <button className="btn" onClick={() => mailReceipt(r.id)}><LuMail /> Send by email</button>}
        <button className="btn pri" onClick={() => run(receiptPng)}><LuImage /> PNG</button>
        <button className="btn pri" onClick={() => run(receiptPdf)}><LuFileText /> PDF</button>
        <button className="btn pri" onClick={() => run(receiptXlsx)}><LuFileSpreadsheet /> Excel</button>
        <button className="btn" disabled={!src} onClick={print}><LuPrinter /> Print</button>
        {r.token && <a className="btn" href={receiptUrl(r)} target="_blank" rel="noopener"><LuQrCode /> Verify page</a>}
      </> : <>
        {canApprove(r) ? <button className="btn pri" onClick={() => approve(r)}><LuCheck /> Approve & sign</button>
          : <span className="muted small">{r.received?.uid === u?.id ? "You entered this payment: another admin or staff member approves it." : "Waiting for approval."}</span>}
        {canDiscard(r) && <button className="btn danger" onClick={() => discard(r)}><LuTrash2 /> Delete entry</button>}
      </>}
      <span className="grow" />
      <button className="btn" onClick={() => openModal("mrAccount", { aid: r.accountId })}><LuUserRound /> Account</button>
      {u?.role === "admin" && ok(r) && <button className="btn danger" onClick={voidIt}><LuBan /> Cancel receipt</button>}
    </div>
  </>;
}
const fdt = iso => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/* ---------------- public page: the QR code on a receipt opens /r/<code> ---------------- */
export function VerifyReceipt({ token }) {
  const [st, setSt] = React.useState({ loading: true }); const [src, setSrc] = React.useState(null);
  React.useEffect(() => {
    let on = true;
    fetch(`/api/receipt/${encodeURIComponent(token)}`).then(x => x.ok ? x.json() : null).then(async j => {
      if (!on) return; setSt({ r: j?.receipt || null });
      if (j?.receipt) { const c = await drawReceipt(j.receipt, store.S.settings || {}); if (on) setSrc(c.toDataURL("image/png")); }
    }).catch(() => on && setSt({ error: true }));
    return () => { on = false; };
  }, [token]);
  const r = st.r, S = store.S.settings || {};
  return <div className="verify-page mr-vpage">
    <div className="verify-top"><a className="verify-brand" href="/#home"><img src="/brand/logo-w160.webp?v=2" width="64" height="40" alt="" /> <span className="vb-name">MAM &amp; MAM OVERSEAS LTD.</span></a></div>
    <div className="card mr-vcard">
      {st.loading ? <p className="muted">Checking the receipt…</p> : st.error ? <p>No connection to the server. Check your internet and try again.</p>
        : !r ? <><div className="verify-bad"><LuBan /> <span>Receipt not found</span></div><p className="verify-note">{`This QR code does not match a money receipt of Mam & Mam Overseas Ltd. Contact our office to check.`}</p></>
        : <>
          {r.void ? <div className="verify-bad"><LuBan /> <span>{`Receipt ${r.no} was cancelled`}</span></div>
            : <div className="mr-valid"><LuCheck /> <span>{`Valid money receipt ${r.no}`}</span></div>}
          <dl className="mr-vlist">
            <dt>Received from</dt><dd data-notr>{r.payer.name || r.payer.passport || r.payer.mobile || "—"}</dd>
            {r.payer.passport && <><dt>Passport No.</dt><dd data-notr>{r.payer.passport}</dd></>}
            <dt>Amount</dt><dd><b>{`BDT ${tk(r.amount)}`}</b> <span className="muted small">{takaWords(r.amount)}</span></dd>
            <dt>Date</dt><dd>{rDate(r.date)}</dd>
            {r.purpose && <><dt>Purpose</dt><dd>{r.purpose}</dd></>}
            <dt>Payment</dt><dd>{payText(r)}</dd>
            {r.balance && <><dt>{r.balance.after > 0 ? "Due" : r.balance.after < 0 ? "Advance" : "Balance"}</dt><dd><b>{r.balance.after === 0 ? "Fully paid" : `BDT ${tk(Math.abs(r.balance.after))}`}</b></dd></>}
            <dt>Received by</dt><dd data-notr>{r.received?.name}{r.received?.title ? `, ${r.received.title}` : ""}</dd>
            <dt>Approved by</dt><dd data-notr>{r.approved?.name}{r.approved?.title ? `, ${r.approved.title}` : ""}</dd>
          </dl>
          <div className="mr-preview">{src ? <img src={src} alt={`Money receipt ${r.no}`} /> : <div className="mr-ph">Making the receipt…</div>}</div>
          <div className="mr-actions"><button className="btn pri" onClick={() => receiptPng(r, S)}><LuImage /> PNG</button><button className="btn pri" onClick={() => receiptPdf(r, S)}><LuFileText /> PDF</button><span className="grow" /><a className="btn" href="/#home"><LuExternalLink /> Visit Website</a></div>
        </>}
    </div>
    <p className="verify-foot">Recruiting Licence RL 1217 · {location.host}</p>
  </div>;
}

/* ---------------- account: update details, see all receipts ---------------- */
export function MrAccount({ aid }) {
  const a = MR().accounts.find(x => x.id === aid); const [p, setP] = React.useState(a ? pick(a) : null);
  const [price, setPrice] = React.useState(a?.price != null ? String(a.price) : "");
  if (!a) return <p>Account not found.</p>;
  const l = accReceipts(a.id), done = paid(l.filter(ok));
  const save = e => { e.preventDefault(); act("admin.mr", { op: "account", id: a.id, payer: p, ...(a.agentId ? {} : { price }) }); };
  const bal = null;
  return <>
    <h2 className="row6"><LuUserRound /> Payer account</h2>
    <form className="card mr-box" onSubmit={save} noValidate>
      <div className="fgrid">{PAYER.map(([k, lb, t, ph]) => <Field key={k} label={lb}><input type={t} value={p[k]} onChange={e => setP({ ...p, [k]: e.target.value })} placeholder={ph} maxLength={120} list={k === "agent" ? "mr-agents2" : undefined} /></Field>)}</div>
      <datalist id="mr-agents2">{agentNames().map(n => <option key={n} value={n} />)}</datalist>
      {a.agentId ? <p className="small mt8">{`Agent account: ${a.agent}. `}<DueCell a={a} l={l} /></p>
        : <div className="fgrid mt8"><Field label="Total price (BDT)" hint="What this payer has to pay in total."><input type="number" min="0" step="0.01" value={price} onChange={e => setPrice(e.target.value)} placeholder="Optional" /></Field></div>}
      {bal && <BalanceBox b={bal} />}
      <div className="row between mt14"><span className="muted small">New receipts use these details. Receipts already made keep the details they were made with.</span><button className="btn pri">Update account</button></div>
    </form>
    <div className="row between mt14"><h3>Payment history</h3><div className="row6">
      <button className="btn sm" disabled={!l.length} onClick={() => receiptsXlsx(l, `Account: ${a.name || a.passport || a.mobile}`)}><LuFileSpreadsheet /> Receipts list</button>
      <button className="btn sm pri" onClick={() => openModal("mrEntry", { aid: a.id })}><LuPlus /> New payment</button></div></div>
    {a.agentId ? <>
      <p className="muted small">{`This payer pays through the agent ${a.agent}. The agent's payment history:`}</p>
      <Statement title={a.agent} rows={agentRows(store.S.ledger, a.agentId)} />
    </> : <>
      <Statement title={a.name || a.passport || a.mobile || "Account"} sub={[a.passport && `Passport ${a.passport}`, a.mobile, a.email].filter(Boolean).join(" · ")}
        rows={accountRows(a, MR().charges || [], MR().receipts)}
        onRate={(r, v) => act("admin.mr", { op: "chargeEdit", id: r.id, ...v })}
        actions={r => r.charge ? <button className="btn sm link danger" aria-label="Delete entry" onClick={() => confirmBox("Delete this entry from the payment history?", () => act("admin.mr", { op: "chargeDelete", id: r.id }), "Delete")}><LuTrash2 /></button>
          : r.receipt ? <button className="ec-ico view" aria-label="View receipt" title="View receipt" onClick={() => openModal("mrView", { rid: r.receipt.id })}><LuEye /></button> : null} />
      <ChargeForm aid={a.id} />
    </>}
    {l.some(r => !ok(r)) && <p className="muted small mt8">{`Receipts waiting for approval or cancelled are not in the payment history: ${l.filter(r => !ok(r)).map(r => r.no).join(", ")}.`}</p>}
  </>;
}

/* debit on a payer's account: details, quantity × rate */
function ChargeForm({ aid }) {
  const [qty, setQty] = React.useState("1"); const [rate, setRate] = React.useState("");
  const add = e => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.currentTarget)); const form = e.currentTarget;
    act("admin.mr", { op: "chargeAdd", accountId: aid, desc: d.desc, date: d.date, qty, rate }).then(r => { if (r) { form.reset(); setQty("1"); setRate(""); } }); };
  return <form className="fgrid divider mt14" onSubmit={add} noValidate>
    <h4 className="full">Add a charge (debit)</h4>
    <Field label={<span className="field-head">Details<PassportPick onPick={pp => { const el = document.getElementById("mr-charge-desc"); if (el) el.value = ppLine(pp); }} /></span>} full><input type="text" id="mr-charge-desc" name="desc" maxLength={200} required placeholder="e.g. 1 ITALY (FC) PP (A06852056)" /></Field>
    <Field label="Date"><input type="date" name="date" defaultValue={today()} /></Field>
    <Field label="Rate (BDT) × Quantity" hint={Number(rate) > 0 ? `Debit: ${tk((Number(qty) || 1) * Number(rate))} BDT` : "e.g. 6000 × 1"}><div className="st-rq">
      <input type="number" min="1" value={rate} onChange={e => setRate(e.target.value)} placeholder="6000" aria-label="Rate (BDT)" /><span>X</span>
      <input type="number" min="1" step="1" value={qty} onChange={e => setQty(e.target.value)} aria-label="Quantity" className="q" /></div></Field>
    <div className="full"><button className="btn pri" type="submit"><LuPlus /> Add</button></div>
  </form>;
}
