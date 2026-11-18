// Admin panel › Money receipts: payment entry (any of name, mobile, passport, email, agent),
// search to find and update a payer's account, and receipts downloadable as PNG, PDF and Excel.
import React from "react";
import { LuPlus, LuSearch, LuEye, LuDownload, LuFileSpreadsheet, LuFileText, LuImage, LuPrinter, LuPencil, LuX, LuReceipt, LuUserRound, LuBan } from "react-icons/lu";
import { store, user } from "../store.js";
import { act, openModal, closeModal, toast, confirmBox } from "../actions.js";
import { Field } from "./shared.jsx";
import { Tiles, Empty } from "../ui.jsx";
import { drawReceipt, receiptPng, receiptPdf, receiptXlsx, receiptsXlsx, takaWords, tk, rDate } from "../receipt.js";

const METHODS = ["Cash", "bKash", "Nagad", "Rocket", "Bank transfer", "Cheque", "Card"];
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
const accReceipts = aid => MR().receipts.filter(r => r.accountId === aid);
const paid = list => list.filter(r => !r.void).reduce((s, r) => s + r.amount, 0);
const agentNames = () => [...new Set(store.S.users.filter(u => u.role === "agent").map(u => u.agent?.business || u.name).filter(Boolean))];

/* ---------------- main page ---------------- */
export function ReceiptsAdmin() {
  const { accounts, receipts } = MR();
  const [q, setQ] = React.useState(""); const [view, setView] = React.useState("receipts"); const [n, setN] = React.useState(25);
  const m = mrMatch(q);
  const R = receipts.filter(m), Acc = accounts.filter(a => m(a) || (q && accReceipts(a.id).some(m)));
  const d = today(), mo = d.slice(0, 7), live = receipts.filter(r => !r.void);
  const sum = l => `৳ ${tk(paid(l)).replace(/\.00$/, "")}`;
  return <>
    <div className="ec-head"><div><h2>Money receipts</h2><p className="muted small">Payment entry and money receipts. Search by anything to find a payer's account.</p></div>
      <button className="btn pri" onClick={() => openModal("mrEntry", {})}><LuPlus /> New payment entry</button></div>
    <Tiles items={[[sum(live.filter(r => r.date === d)), "Received today"], [sum(live.filter(r => r.date.startsWith(mo))), "This month"], [String(live.length), "Receipts"], [String(accounts.length), "Accounts"]]} />
    <div className="ec-tools mt14">
      <div className="mr-seg" role="tablist">{[["receipts", "Receipts", R.length], ["accounts", "Accounts", Acc.length]].map(([k, l, c]) => <button key={k} role="tab" aria-selected={view === k} className={view === k ? "on" : ""} onClick={() => setView(k)}>{l} <span>{c}</span></button>)}</div>
      <span className="grow" />
      <label className="ec-search mr-search"><input type="text" value={q} onChange={e => { setQ(e.target.value); setN(25); }} placeholder="Search name, mobile, passport, email, agent or receipt no." /><LuSearch /></label>
      {view === "receipts" && <button className="btn" disabled={!R.length} onClick={() => receiptsXlsx(R, q ? `Search: ${q}` : "All receipts")}><LuFileSpreadsheet /> Excel</button>}
    </div>
    {view === "receipts" ? (R.length ? <div className="tbl ec-tbl grid"><table><thead><tr><th>SL</th><th>Receipt No.</th><th>Date</th><th>Name</th><th>Passport No.</th><th>Mobile</th><th>Agent</th><th>Method</th><th className="r">Amount (BDT)</th><th>Receipt</th></tr></thead><tbody>
      {R.slice(0, n).map((r, i) => <tr key={r.id} className={r.void ? "mr-void" : ""}>
        <td>{i + 1}</td><td className="ec-ref" data-notr>{r.no}{r.void && <span className="ec-badge s-rejected ms6">Cancelled</span>}</td><td className="num">{rDate(r.date)}</td>
        <td data-notr>{r.payer.name || "—"}</td><td className="num" data-notr>{r.payer.passport || "—"}</td><td className="num" data-notr>{r.payer.mobile || "—"}</td><td data-notr>{r.payer.agent || "—"}</td>
        <td>{r.method}</td><td className="num r b">{tk(r.amount)}</td>
        <td><div className="row6"><button className="ec-ico view" title="View receipt" aria-label="View receipt" onClick={() => openModal("mrView", { rid: r.id })}><LuEye /></button><DlMenu r={r} /></div></td>
      </tr>)}</tbody></table></div> : <Empty>{q ? "No receipt matches your search." : "No payments yet. Use New payment entry to add the first one."}</Empty>)
      : (Acc.length ? <div className="tbl ec-tbl grid"><table><thead><tr><th>SL</th><th>Name</th><th>Mobile</th><th>Passport No.</th><th>Email</th><th>Agent</th><th className="r">Receipts</th><th className="r">Total paid (BDT)</th><th>Actions</th></tr></thead><tbody>
        {Acc.slice(0, n).map((a, i) => { const l = accReceipts(a.id); return <tr key={a.id}>
          <td>{i + 1}</td><td data-notr><b>{a.name || "—"}</b></td><td className="num" data-notr>{a.mobile || "—"}</td><td className="num" data-notr>{a.passport || "—"}</td><td data-notr>{a.email || "—"}</td><td data-notr>{a.agent || "—"}</td>
          <td className="num r">{l.length}</td><td className="num r b">{tk(paid(l))}</td>
          <td><div className="row6"><button className="btn sm pri" onClick={() => openModal("mrEntry", { aid: a.id })}><LuPlus /> Payment</button><button className="btn sm" onClick={() => openModal("mrAccount", { aid: a.id })}><LuPencil /> Account</button></div></td>
        </tr>; })}</tbody></table></div> : <Empty>{q ? "No account matches your search." : "No accounts yet. An account is made with the first payment entry."}</Empty>)}
    {(view === "receipts" ? R : Acc).length > n && <div className="center mt14"><button className="btn" onClick={() => setN(n + 50)}>Show more</button></div>}
  </>;
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
export function MrEntry({ aid: aid0 }) {
  const [aid, setAid] = React.useState(aid0 || null);
  const acc = aid && MR().accounts.find(a => a.id === aid);
  const blank = { name: "", mobile: "", passport: "", email: "", agent: "" };
  const [p, setP] = React.useState(acc ? { ...blank, ...pick(acc) } : blank);
  const [q, setQ] = React.useState(""); const [busy, setBusy] = React.useState(false);
  const found = q.trim() ? MR().accounts.filter(mrMatch(q)).slice(0, 6) : [];
  const auto = !aid && MR().accounts.find(a => ["passport", "mobile", "email"].some(k => p[k] && norm(k, p[k]) === a[k]));
  const choose = a => { setAid(a.id); setP({ ...blank, ...pick(a) }); setQ(""); };
  const clear = () => { setAid(null); setP(blank); };
  const has = Object.values(p).some(v => v.trim());
  const submit = async e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.currentTarget));
    if (!has) { toast("Enter at least one of: name, mobile, passport no., email or agent name."); return; }
    if (!(Number(d.amount) > 0)) { toast("Enter the amount received."); return; }
    setBusy(true);
    const r = await act("admin.mr", { op: "entry", accountId: aid || (auto ? auto.id : undefined), payer: p, amount: d.amount, date: d.date, method: d.method, ref: d.ref, purpose: d.purpose, note: d.note });
    setBusy(false); if (r?.receiptId) openModal("mrView", { rid: r.receiptId, fresh: true });
  };
  return <form className="mr-entry" onSubmit={submit} noValidate>
    <h2 className="row6"><LuReceipt /> Payment entry</h2>
    <div className="mr-find">
      <label className="ec-search"><input type="text" value={q} onChange={e => setQ(e.target.value)} placeholder="Search an existing account: name, mobile, passport, email or agent" aria-label="Search an existing account" /><LuSearch /></label>
      {q.trim() && <div className="mr-found">{found.length ? found.map(a => <button type="button" key={a.id} onClick={() => choose(a)}>
        <LuUserRound /><span><b data-notr>{a.name || a.passport || a.mobile || a.email}</b><small data-notr>{[a.passport, a.mobile, a.agent].filter(Boolean).join(" · ")}</small></span><em>{`${accReceipts(a.id).length} receipts`}</em></button>)
        : <p className="muted small">No account found. Fill in the details below to make a new one.</p>}</div>}
    </div>
    {acc ? <div className="mr-acc"><LuUserRound /><span>Account: <b data-notr>{acc.name || acc.passport || acc.mobile}</b> · <span className="muted">changes below update this account</span></span><button type="button" className="btn sm link" onClick={clear}><LuX /> New account</button></div>
      : auto ? <div className="mr-acc soft"><LuUserRound /><span>This payment will be added to the existing account of <b data-notr>{auto.name || auto.passport || auto.mobile}</b>.</span><button type="button" className="btn sm link" onClick={() => choose(auto)}>Open account</button></div> : null}
    <fieldset className="card mr-box"><legend>Payer details <span className="muted small">· fill in any one or all</span></legend>
      <div className="fgrid">{PAYER.map(([k, l, t, ph]) => <Field key={k} label={l}><input type={t} value={p[k]} onChange={e => setP({ ...p, [k]: e.target.value })} placeholder={ph} maxLength={120} list={k === "agent" ? "mr-agents" : undefined} inputMode={k === "mobile" ? "tel" : undefined} /></Field>)}</div>
      <datalist id="mr-agents">{agentNames().map(n => <option key={n} value={n} />)}</datalist>
    </fieldset>
    <fieldset className="card mr-box"><legend>Payment</legend>
      <div className="fgrid">
        <Field label="Amount (BDT)"><input type="number" name="amount" min="1" step="0.01" required placeholder="0.00" inputMode="decimal" /></Field>
        <Field label="Date"><input type="date" name="date" defaultValue={today()} /></Field>
        <Field label="Payment method"><select name="method" defaultValue="Cash">{METHODS.map(x => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Transaction / Ref No."><input type="text" name="ref" maxLength={80} placeholder="Optional" /></Field>
        <Field label="Purpose of payment" full><input type="text" name="purpose" maxLength={160} list="mr-purposes" placeholder="e.g. Visa processing fee" /></Field>
        <Field label="Note" full><textarea name="note" className="short" maxLength={400} placeholder="Optional" /></Field>
      </div>
      <datalist id="mr-purposes">{PURPOSES.map(x => <option key={x} value={x} />)}</datalist>
    </fieldset>
    <div className="row between mt14"><button type="button" className="btn" onClick={closeModal}>Cancel</button><button className="btn pri" disabled={busy}><LuReceipt /> Save & make receipt</button></div>
  </form>;
}
const pick = a => ({ name: a.name || "", mobile: a.mobile || "", passport: a.passport || "", email: a.email || "", agent: a.agent || "" });
const norm = (k, v) => k === "mobile" ? v.replace(/[^\d+]/g, "") : k === "passport" ? v.replace(/\s+/g, "").toUpperCase() : v.trim().toLowerCase();

/* ---------------- receipt view ---------------- */
export function MrView({ rid, fresh }) {
  const r = MR().receipts.find(x => x.id === rid); const [src, setSrc] = React.useState(null);
  const S = store.S.settings; const u = user(store.S.session);
  React.useEffect(() => { let on = true; if (r) drawReceipt(r, S).then(c => on && setSrc(c.toDataURL("image/png"))); return () => { on = false; }; }, [r?.id, r?.void, r?.payer?.name]);
  if (!r) return <p>Receipt not found.</p>;
  const run = f => Promise.resolve(f(r, S)).catch(er => toast(er.message));
  const print = () => { const w = window.open("", "_blank"); if (!w) { toast("Allow pop-ups to print."); return; } w.document.write(`<title>${r.no}</title><style>@page{size:A5 landscape;margin:0}body{margin:0}img{width:100%;display:block}</style><img src="${src}" onload="setTimeout(()=>print(),200)">`); w.document.close(); };
  const voidIt = () => confirmBox(`Cancel receipt ${r.no}? It stays in the list marked Cancelled.`, () => act("admin.mr", { op: "void", id: r.id }), "Cancel receipt");
  return <>
    <div className="row between"><h2 className="row6"><LuReceipt /> <span data-notr>{r.no}</span></h2>{r.void && <span className="ec-badge s-rejected">Cancelled</span>}</div>
    {fresh && <p className="ok-note small">Payment saved. Download or print the receipt.</p>}
    <div className="mr-preview">{src ? <img src={src} alt={`Money receipt ${r.no}`} /> : <div className="mr-ph">Making the receipt…</div>}</div>
    <p className="muted small mt8">{`${tk(r.amount)} BDT · ${takaWords(r.amount)}`}</p>
    <div className="mr-actions">
      <button className="btn pri" onClick={() => run(receiptPng)}><LuImage /> PNG</button>
      <button className="btn pri" onClick={() => run(receiptPdf)}><LuFileText /> PDF</button>
      <button className="btn pri" onClick={() => run(receiptXlsx)}><LuFileSpreadsheet /> Excel</button>
      <button className="btn" disabled={!src} onClick={print}><LuPrinter /> Print</button>
      <span className="grow" />
      <button className="btn" onClick={() => openModal("mrAccount", { aid: r.accountId })}><LuUserRound /> Account</button>
      {u?.role === "admin" && !r.void && <button className="btn danger" onClick={voidIt}><LuBan /> Cancel receipt</button>}
    </div>
  </>;
}

/* ---------------- account: update details, see all receipts ---------------- */
export function MrAccount({ aid }) {
  const a = MR().accounts.find(x => x.id === aid); const [p, setP] = React.useState(a ? pick(a) : null);
  if (!a) return <p>Account not found.</p>;
  const l = accReceipts(a.id);
  const save = e => { e.preventDefault(); act("admin.mr", { op: "account", id: a.id, payer: p }); };
  return <>
    <h2 className="row6"><LuUserRound /> Payer account</h2>
    <form className="card mr-box" onSubmit={save} noValidate>
      <div className="fgrid">{PAYER.map(([k, lb, t, ph]) => <Field key={k} label={lb}><input type={t} value={p[k]} onChange={e => setP({ ...p, [k]: e.target.value })} placeholder={ph} maxLength={120} list={k === "agent" ? "mr-agents2" : undefined} /></Field>)}</div>
      <datalist id="mr-agents2">{agentNames().map(n => <option key={n} value={n} />)}</datalist>
      <div className="row between mt14"><span className="muted small">New receipts use these details. Receipts already made keep the details they were made with.</span><button className="btn pri">Update account</button></div>
    </form>
    <div className="row between mt14"><h3>{`Payments (${l.length}) · Total ${tk(paid(l))} BDT`}</h3><div className="row6">
      <button className="btn sm" disabled={!l.length} onClick={() => receiptsXlsx(l, `Account: ${a.name || a.passport || a.mobile}`)}><LuFileSpreadsheet /> Excel</button>
      <button className="btn sm pri" onClick={() => openModal("mrEntry", { aid: a.id })}><LuPlus /> New payment</button></div></div>
    {l.length ? <div className="tbl ec-tbl grid mt8"><table><thead><tr><th>Receipt No.</th><th>Date</th><th>Purpose</th><th>Method</th><th className="r">Amount</th><th /></tr></thead><tbody>
      {l.map(r => <tr key={r.id} className={r.void ? "mr-void" : ""}><td className="ec-ref" data-notr>{r.no}{r.void && <span className="ec-badge s-rejected ms6">Cancelled</span>}</td><td className="num">{rDate(r.date)}</td><td>{r.purpose || "—"}</td><td>{r.method}</td><td className="num r b">{tk(r.amount)}</td>
        <td><button className="ec-ico view" aria-label="View receipt" title="View receipt" onClick={() => openModal("mrView", { rid: r.id })}><LuEye /></button></td></tr>)}</tbody></table></div>
      : <p className="muted small">No payments yet.</p>}
  </>;
}
