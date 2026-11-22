// Agent list: agents written by name (not registered on the site). A new name typed as the agent anywhere
// (passport entry, Fiji entry, clearance, money receipt) is saved here by the server; details can be added later.
import React from "react";
import { LuPencil, LuTrash2, LuSearch, LuPlus, LuWallet, LuCheck, LuX, LuArrowLeft, LuReceipt, LuBookUser } from "react-icons/lu";
import { store, commit, bdtFmt, fdate, balanceOf, LABEL } from "../store.js";
import { Statement } from "./Statement.jsx";
import { agentRows } from "../statement.js";
import { act, openModal, closeModal, confirmBox, toast } from "../actions.js";
import { Field } from "./shared.jsx";
import { Empty } from "../ui.jsx";
import { AgentHistory } from "./AgentHistory.jsx";

export const bookAgents = () => store.S.agentBook || [];
const key = v => String(v || "").trim().replace(/\s+/g, " ").toLowerCase();
export const regAgents = () => (store.S.users || []).filter(u => u.role === "agent").map(u => ({ id: u.id, name: u.agent?.business || u.name, phone: u.agent?.phone || u.phone || "" }));
/* every agent name to offer in an Agent field: registered agents and the agent list */
export const agentNames = () => [...new Set([...regAgents().map(a => a.name), ...bookAgents().map(a => a.name)])].sort((a, b) => a.localeCompare(b));
export const AgentDatalist = ({ id }) => <datalist id={id}>{agentNames().map(n => <option key={n} value={n} />)}</datalist>;
export const bookByName = n => bookAgents().find(a => key(a.name) === key(n));

/* account rows of a list agent (for the statement): clearance fees and dues, balance updates, money receipts made with this agent name */
export function bookRows(a) {
  const S = store.S, k = key(a.name), rows = [];
  for (const c of (S.clearances || []).filter(c => !c.agentId && key(c.agentName) === k)) {
    const w = (S.workers || []).find(x => x.id === c.workerId), nm = w?.name || "", d = c.created.slice(0, 10);
    if (c.fee > 0) rows.push({ id: `${c.id}f`, date: d, at: c.created, details: `BMET clearance processing: ${nm} (${c.ref})`, rate: `${amt(c.fee)}X1`, debit: c.fee, credit: 0 });
    if (c.due > 0) rows.push({ id: `${c.id}d`, date: d, at: c.created, details: `Previous due: ${nm} (${c.ref})`, rate: `${amt(c.due)}X1`, debit: c.due, credit: 0 });
  }
  for (const e of a.entries || []) rows.push({ id: e.id, date: e.date, at: e.at, details: e.desc, ref: e.ref, rate: e.type === "charge" ? `${amt(e.rate)}X${e.qty}` : e.opening ? "ADVANCE" : (e.method || "Cash").toUpperCase(), debit: e.type === "charge" ? e.amount : 0, credit: e.type === "payment" ? e.amount : 0, entry: e });
  for (const r of (S.mr?.receipts || []).filter(r => !r.agentId && key(r.payer?.agent) === k && !r.void))
    rows.push({ id: r.id, date: r.date, at: r.created, details: `Money receipt ${r.no}${r.payer?.name && key(r.payer.name) !== k ? ": " + r.payer.name : ""}${r.purpose ? ` · ${r.purpose}` : ""}`, ref: r.ref, rate: [r.method, r.channel].filter(Boolean).join(" · ").toUpperCase(), debit: 0, credit: r.amount, pending: r.status !== "approved", receipt: r });
  return rows;
}
const amt = n => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
export function bookAccount(a) {
  const rows = bookRows(a), live = rows.filter(r => !r.pending);
  const owed = live.reduce((s, r) => s + r.debit, 0), paid = live.reduce((s, r) => s + r.credit, 0);
  return { owed, paid, due: owed - paid, pps: agentPassports({ book: a }).length };
}
/* passports brought by an agent: the office passport lists, and workers of clearance files (not already in a list) */
export function agentPassports({ reg, book }) {
  const S = store.S, k = key(book ? book.name : "");
  const mine = p => reg ? p.agentId === reg.id : !p.agentId && key(p.ref) === k;
  const pp = (S.passports || []).filter(mine).map(p => ({ id: p.id, name: p.name, passport: p.passport, country: p.country, lists: p.lists || [], vstatus: p.vstatus || {}, at: p.at, src: "pp" }));
  const seen = new Set(pp.map(p => String(p.passport).toUpperCase()));
  const ws = (S.workers || []).filter(w => (reg ? w.agentId === reg.id : !w.agentId && key(w.agentName) === k) && !seen.has(String(w.passport).toUpperCase()))
    .map(w => { const c = [...(S.clearances || [])].reverse().find(x => x.workerId === w.id); return { id: w.id, name: w.name, passport: w.passport, country: c?.country || "", lists: c ? ["clearance"] : [], cl: c, at: w.created, src: "worker" }; });
  return [...pp, ...ws].sort((x, y) => String(y.at || "").localeCompare(String(x.at || "")));
}
const LIST_NAME = { bmet: "BMET", ksa: "KSA", fiji: "Fiji", clearance: "BMET clearance" };

const FIELDS = [["fullName", "Full name", "text"], ["mobile", "Mobile number", "tel"], ["email", "Email", "email"], ["agency", "Agency name", "text"], ["address", "Address", "text"]];

/* Agents (main menu): registered agents and the agent list; click a name for passports and account */
export function AgentsPage({ AddForm, canLedger, canMr }) {
  const ui = store.ui; const v = ui.agentView;
  const [q, setQ] = React.useState(""), [kind, setKind] = React.useState("");
  const S = store.S;
  const reg = v?.k === "reg" && (S.users || []).find(x => x.id === v.id), book = v?.k === "book" && bookAgents().find(x => x.id === v.id);
  if (reg || book) return <AgentDetail reg={reg} book={book} AddForm={AddForm} canLedger={canLedger} canMr={canMr} />;
  const open = (k, id) => { ui.agentView = { k, id }; commit(); window.scrollTo?.({ top: 0 }); };
  const all = [
    ...(S.users || []).filter(u => u.role === "agent").map(u => ({ k: "reg", id: u.id, name: u.agent?.business || u.name, fullName: u.name, mobile: u.agent?.phone || u.phone || "", email: u.email || "", agency: u.agent?.business || "", address: u.agent?.address || "", due: balanceOf(u.id), pps: agentPassports({ reg: { id: u.id } }).length })),
    ...bookAgents().map(a => { const b = bookAccount(a); return { k: "book", id: a.id, name: a.name, fullName: a.fullName, mobile: a.mobile, email: a.email, agency: a.agency, address: a.address, due: b.due, pps: b.pps }; })
  ].sort((x, y) => x.name.localeCompare(y.name));
  const s = key(q), list = all.filter(a => (!kind || a.k === kind) && (!s || [a.name, a.fullName, a.mobile, a.email, a.agency, a.address].some(x => key(x).includes(s))));
  const totalDue = all.reduce((t, a) => t + (a.due > 0 ? a.due : 0), 0);
  return <>
    <div className="ec-head"><div><h2>Agents</h2><p className="muted small">Registered agents and agents written by name. A new agent name written in an entry (passport, clearance, money receipt) is added here. Click a name to see the passports and the account.</p></div>
      <button className="btn pri" onClick={() => openModal("agentBook", {})}><LuPlus /> Add agent</button></div>
    <div className="vf-tiles"><div className="vf-tile"><b>{all.length}</b><span>Agents</span></div><div className="vf-tile"><b>{all.filter(a => a.k === "reg").length}</b><span>Registered</span></div>
      <div className="vf-tile bad"><b>{bdtFmt(totalDue)}</b><span>Total due</span></div></div>
    <div className="card">
      <div className="vf-tools"><select value={kind} onChange={e => setKind(e.target.value)} aria-label="Type"><option value="">All agents</option><option value="reg">Registered agents</option><option value="book">Written by name</option></select><span className="grow" />
        <label className="ec-search mr-search"><input type="text" value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, mobile, email, agency" aria-label="Search agents" /><LuSearch /></label></div>
      {list.length ? <div className="tbl vf-tbl"><table><thead><tr><th>SL</th><th>Agent</th><th>Full name</th><th>Mobile</th><th>Email</th><th>Agency name</th><th>Address</th><th>Passports</th><th>Balance</th><th>Actions</th></tr></thead><tbody>
        {list.map((a, i) => <tr key={a.k + a.id}>
          <td className="num">{i + 1}</td>
          <td><button type="button" className="ag-link" onClick={() => open(a.k, a.id)} data-notr>{a.name}</button>{a.k === "reg" && <div><span className="ec-badge s-approved">Registered</span></div>}</td>
          <td data-notr>{a.fullName || "—"}</td><td className="num" data-notr>{a.mobile || "—"}</td><td data-notr>{a.email || "—"}</td>
          <td data-notr>{a.agency || "—"}</td><td className="fj-note" data-notr>{a.address || "—"}</td><td className="num">{a.pps}</td>
          <td className={`num nowrap ${a.due > 0 ? "bad" : ""}`}>{a.due > 0 ? `Due ${bdtFmt(a.due)}` : a.due < 0 ? `Advance ${bdtFmt(-a.due)}` : "—"}</td>
          <td className="nowrap"><button className="btn sm" onClick={() => open(a.k, a.id)}><LuWallet /> Open</button>
            {a.k === "book" && <><button className="btn sm" onClick={() => openModal("agentBook", { id: a.id })}><LuPencil /> Update</button>
              <button className="btn sm link danger" aria-label={`Remove ${a.name}`} onClick={() => confirmBox(`Remove ${a.name} from the agents? Entries already made keep the name.`, () => act("admin.agentBook", { op: "delete", id: a.id }), "Remove")}><LuTrash2 /></button></>}</td>
        </tr>)}
      </tbody></table></div> : <Empty>{q || kind ? "No agent matches." : "No agents yet."}</Empty>}
    </div>
  </>;
}

function AgentDetail({ reg, book, AddForm, canLedger, canMr }) {
  const S = store.S, ui = store.ui;
  const name = reg ? reg.agent?.business || reg.name : book.name;
  const info = reg ? [reg.name, reg.agent?.phone || reg.phone, reg.email, reg.agent?.address].filter(Boolean) : [book.fullName, book.mobile, book.email, book.agency, book.address].filter(Boolean);
  const pps = agentPassports(reg ? { reg: { id: reg.id } } : { book });
  const rows = reg ? agentRows(S.ledger || [], reg.id) : bookRows(book);
  const back = () => { ui.agentView = null; commit(); };
  const mr = () => openModal("mrEntry", reg ? { agentId: reg.id } : { book: book.id });
  return <>
    <div className="ec-head"><div><button className="btn sm link" onClick={back}><LuArrowLeft /> Agents</button>
      <h2 data-notr>{name} {reg && <span className="ec-badge s-approved">Registered</span>}</h2><p className="muted small" data-notr>{info.join(" · ") || "No details yet"}</p></div>
      <div className="row6">{book && <button className="btn" onClick={() => openModal("agentBook", { id: book.id })}><LuPencil /> Update</button>}
        {canMr && <button className="btn pri" onClick={mr}><LuReceipt /> Money receipt</button>}</div></div>
    <div className="card">
      <h3 className="bulk-h"><LuBookUser /> Passports <span className="bulk-count">{pps.length}</span></h3>
      {pps.length ? <div className="tbl vf-tbl"><table><thead><tr><th>SL</th><th>Name</th><th>Passport</th><th>Country</th><th>Entry</th><th>Status</th><th>Added</th></tr></thead><tbody>
        {pps.map((p, i) => <tr key={p.src + p.id}><td className="num">{i + 1}</td><td className="b" data-notr>{p.name}</td><td className="num" data-notr>{p.passport}</td><td>{p.country || "—"}</td>
          <td>{p.lists.map(l => LIST_NAME[l] || l).join(", ") || "—"}</td>
          <td>{p.cl ? (p.cl.status === "custom" ? p.cl.statusText : LABEL[p.cl.status] || p.cl.status) : Object.entries(p.vstatus || {}).map(([l, x]) => `${LIST_NAME[l] || l}: ${x.s}`).join(" · ") || "—"}</td>
          <td className="nowrap small">{p.at ? fdate(p.at) : "—"}</td></tr>)}
      </tbody></table></div> : <Empty>No passports from this agent yet.</Empty>}
    </div>
    <div className="card mt14">
      <h3 className="bulk-h"><LuWallet /> Account</h3>
      <Statement key={name} title={name} sub={info.join(" · ")} rows={rows}
        onRate={reg && canLedger ? (r, v) => act("admin.ledgerEdit", { id: r.id, ...v }) : undefined}
        actions={r => reg ? (canLedger && !r.src?.mr ? <button className="btn sm link danger" aria-label="Delete entry" onClick={() => confirmBox("Delete this entry from the account?", () => act("admin.ledgerDelete", { id: r.id }), "Delete")}><LuTrash2 /></button> : null)
          : r.entry ? <button className="btn sm link danger" aria-label="Delete entry" onClick={() => confirmBox("Delete this entry from the account?", () => act("admin.agentBook", { op: "entryDelete", id: book.id, eid: r.entry.id }), "Delete")}><LuTrash2 /></button>
          : r.pending ? <span className="ec-badge pay-pending">Waiting for approval</span> : null} />
      {AddForm && (reg ? canLedger : true) && <AddForm sel={reg || book} book={!!book} title="Balance update" />}
    </div>
    {reg && <AgentHistory key={reg.id} agentId={reg.id} />}
  </>;
}

/* modal: add an agent, or update the details of one */
export function AgentBookEdit({ id }) {
  const a = id && bookAgents().find(x => x.id === id);
  const [v, setV] = React.useState(() => ({ name: a?.name || "", ...Object.fromEntries(FIELDS.map(([k]) => [k, a?.[k] || ""])) }));
  const [busy, setBusy] = React.useState(false);
  const save = async e => {
    e.preventDefault(); if (!a && !(v.name.trim() || v.agency.trim() || v.fullName.trim())) return toast("Enter the agent name.");
    setBusy(true); const r = await act("admin.agentBook", { op: "save", id: a?.id, ...v }); setBusy(false); if (r) closeModal();
  };
  return <form onSubmit={save} noValidate>
    <h3>{a ? `Update agent: ${a.name}` : "Add agent"}</h3>
    <p className="muted small mb14">All fields are optional.</p>
    <div className="fgrid">
      {!a && <Field label="Agent name" hint="As it is written in entries" full><input type="text" value={v.name} maxLength={120} onChange={e => setV({ ...v, name: e.target.value })} /></Field>}
      {FIELDS.map(([k, l, t]) => <Field key={k} label={l} full={k === "address"}>{k === "address" ? <textarea className="short" value={v[k]} maxLength={500} onChange={e => setV({ ...v, [k]: e.target.value })} />
        : <input type={t} value={v[k]} maxLength={k === "agency" ? 150 : 120} onChange={e => setV({ ...v, [k]: e.target.value })} />}</Field>)}
    </div>
    <div className="row between mt14"><button type="button" className="btn" onClick={closeModal}><LuX /> Cancel</button><button className="btn pri" disabled={busy}><LuCheck /> {a ? "Save" : "Add agent"}</button></div>
  </form>;
}

/* Visa applications entry: status of a worker in one list (KSA or Fiji) */
export const VSTATUS = ["New", "Documents received", "File Processing", "Medical done", "MOFA done", "Visa applied", "Visa issued", "Fingerprint done", "BMET clearance", "Ticket booked", "Flight Done", "Flown", "On hold", "Cancelled"];
/* each status has its own colour; the whole row of the worker takes it */
const VS_COLOR = { "New": "#64748b", "Documents received": "#0ea5e9", "File Processing": "#6366f1", "Medical done": "#14b8a6", "MOFA done": "#8b5cf6", "Visa applied": "#f59e0b", "Visa issued": "#22c55e",
  "Fingerprint done": "#ec4899", "BMET clearance": "#0d9488", "Ticket booked": "#3b82f6", "Flight Done": "#15803d", "Flown": "#15803d", "On hold": "#ea580c", "Cancelled": "#dc2626" };
export const vsColor = s => VS_COLOR[s] || (s ? `hsl(${[...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)} 55% 45%)` : "");
export const vsRow = (p, list) => { const c = vsColor(p.vstatus?.[list]?.s || ""); return c ? { className: "vs-row", style: { "--vs": c } } : {}; };
export function VStatusCell({ p, list }) {
  const cur = p.vstatus?.[list]?.s || ""; const [custom, setCustom] = React.useState(false); const [t, setT] = React.useState("");
  const set = s => act("admin.passport", { op: "status", id: p.id, list, status: s }, { quiet: true });
  if (custom) return <div className="row6 nowrap"><input type="text" value={t} maxLength={60} autoFocus placeholder="Write the status" onChange={e => setT(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (t.trim()) { set(t.trim()); setCustom(false); } } }} style={{ width: 150 }} aria-label="Custom status" />
    <button className="btn sm pri" aria-label="Save status" onClick={() => { if (t.trim()) { set(t.trim()); setCustom(false); } }}><LuCheck /></button><button className="btn sm" aria-label="Cancel" onClick={() => setCustom(false)}><LuX /></button></div>;
  return <div><select className={`vs-sel${cur ? " on" : ""}`} style={cur ? { "--vs": vsColor(cur) } : undefined} value={cur} aria-label="Status" onChange={e => { if (e.target.value === "__custom") { setT(VSTATUS.includes(cur) ? "" : cur); setCustom(true); } else set(e.target.value); }}>
    <option value="">— Set status —</option>{[...VSTATUS, ...(cur && !VSTATUS.includes(cur) ? [cur] : [])].map(x => <option key={x} value={x}>{x}</option>)}<option value="__custom">Custom…</option></select>
    {cur && <div className="muted tiny-d">{fdate(p.vstatus[list].at)}</div>}</div>;
}
