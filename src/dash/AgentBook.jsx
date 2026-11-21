// Agent list: agents written by name (not registered on the site). A new name typed as the agent anywhere
// (passport entry, Fiji entry, clearance, money receipt) is saved here by the server; details can be added later.
import React from "react";
import { LuPencil, LuTrash2, LuSearch, LuPlus, LuWallet, LuCheck, LuX } from "react-icons/lu";
import { store, bdtFmt, fdate } from "../store.js";
import { act, openModal, closeModal, confirmBox, toast } from "../actions.js";
import { Field } from "./shared.jsx";
import { Empty } from "../ui.jsx";

export const bookAgents = () => store.S.agentBook || [];
const key = v => String(v || "").trim().replace(/\s+/g, " ").toLowerCase();
export const regAgents = () => (store.S.users || []).filter(u => u.role === "agent").map(u => ({ id: u.id, name: u.agent?.business || u.name, phone: u.agent?.phone || u.phone || "" }));
/* every agent name to offer in an Agent field: registered agents and the agent list */
export const agentNames = () => [...new Set([...regAgents().map(a => a.name), ...bookAgents().map(a => a.name)])].sort((a, b) => a.localeCompare(b));
export const AgentDatalist = ({ id }) => <datalist id={id}>{agentNames().map(n => <option key={n} value={n} />)}</datalist>;
export const bookByName = n => bookAgents().find(a => key(a.name) === key(n));

/* what a list agent owes: clearance fees and dues for files under this name, less approved money receipts paid under this name */
export function bookAccount(a) {
  const S = store.S, k = key(a.name);
  const charges = (S.clearances || []).filter(c => !c.agentId && key(c.agentName) === k).flatMap(c => {
    const w = (S.workers || []).find(x => x.id === c.workerId), nm = w?.name || "";
    return [c.fee > 0 && { date: c.created.slice(0, 10), desc: `BMET clearance processing: ${nm} (${c.ref})`, amount: c.fee }, c.due > 0 && { date: c.created.slice(0, 10), desc: `Previous due: ${nm} (${c.ref})`, amount: c.due }].filter(Boolean);
  });
  const pays = (S.mr?.receipts || []).filter(r => !r.agentId && key(r.payer?.agent) === k && !r.void).map(r => ({ date: r.date, desc: `Money receipt ${r.no}${r.payer?.name ? ": " + r.payer.name : ""}`, amount: r.amount, pending: r.status !== "approved" }));
  const owed = charges.reduce((s, x) => s + x.amount, 0), paid = pays.filter(x => !x.pending).reduce((s, x) => s + x.amount, 0);
  const pps = (S.passports || []).filter(p => !p.agentId && key(p.ref) === k).length;
  return { charges, pays, owed, paid, due: owed - paid, pps };
}

const FIELDS = [["fullName", "Full name", "text"], ["mobile", "Mobile number", "tel"], ["email", "Email", "email"], ["agency", "Agency name", "text"], ["address", "Address", "text"]];

export function AgentBookList() {
  const [q, setQ] = React.useState("");
  const all = [...bookAgents()].sort((a, b) => a.name.localeCompare(b.name));
  const s = key(q), list = all.filter(a => !s || [a.name, a.fullName, a.mobile, a.email, a.agency, a.address].some(v => key(v).includes(s)));
  const reg = regAgents();
  return <>
    <div className="ec-head"><div><h2>Agent list</h2><p className="muted small">An agent name written for the first time (passport entry, clearance, money receipt) is saved here, so it can be picked next time. Add the details with Update. Registered agents ({reg.length}) are in Accounts and Agent accounts.</p></div>
      <button className="btn pri" onClick={() => openModal("agentBook", {})}><LuPlus /> Add agent</button></div>
    <div className="card">
      <div className="vf-tools"><b>{`Agents (${all.length})`}</b><span className="grow" />
        <label className="ec-search mr-search"><input type="text" value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, mobile, email, agency" aria-label="Search agents" /><LuSearch /></label></div>
      {list.length ? <div className="tbl vf-tbl"><table><thead><tr><th>SL</th><th>Agent</th><th>Full name</th><th>Mobile</th><th>Email</th><th>Agency name</th><th>Address</th><th>Passports</th><th>Balance</th><th>Actions</th></tr></thead><tbody>
        {list.map((a, i) => { const b = bookAccount(a); return <tr key={a.id}>
          <td className="num">{i + 1}</td><td className="b" data-notr>{a.name}</td><td data-notr>{a.fullName || "—"}</td><td className="num" data-notr>{a.mobile || "—"}</td><td data-notr>{a.email || "—"}</td>
          <td data-notr>{a.agency || "—"}</td><td className="fj-note" data-notr>{a.address || "—"}</td><td className="num">{b.pps}</td>
          <td className={`num nowrap ${b.due > 0 ? "bad" : ""}`}>{b.owed || b.paid ? (b.due > 0 ? `Due ${bdtFmt(b.due)}` : b.due < 0 ? `Advance ${bdtFmt(-b.due)}` : "Paid") : "—"}</td>
          <td className="nowrap"><button className="btn sm" onClick={() => openModal("agentBook", { id: a.id })}><LuPencil /> Update</button>
            <button className="btn sm" onClick={() => openModal("agentBookAcc", { id: a.id })}><LuWallet /> Account</button>
            <button className="btn sm link danger" aria-label={`Remove ${a.name}`} onClick={() => confirmBox(`Remove ${a.name} from the agent list? Entries already made keep the name.`, () => act("admin.agentBook", { op: "delete", id: a.id }), "Remove")}><LuTrash2 /></button></td>
        </tr>; })}
      </tbody></table></div> : <Empty>{q ? "No agent matches." : "No agents yet. A new agent name written in an entry is added here."}</Empty>}
    </div>
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

/* modal: the account of a list agent */
export function AgentBookAccount({ id }) {
  const a = bookAgents().find(x => x.id === id); if (!a) return null;
  const b = bookAccount(a);
  const rows = [...b.charges.map(x => ({ ...x, dr: x.amount })), ...b.pays.map(x => ({ ...x, cr: x.amount }))].sort((x, y) => x.date.localeCompare(y.date));
  return <>
    <h3>{`Agent account: ${a.name}`}</h3>
    <p className="muted small mb14" data-notr>{[a.fullName, a.mobile, a.email, a.agency].filter(Boolean).join(" · ") || "No details yet"}</p>
    <div className="vf-tiles"><div className="vf-tile"><b>{bdtFmt(b.owed)}</b><span>Charges</span></div><div className="vf-tile ok"><b>{bdtFmt(b.paid)}</b><span>Paid (approved)</span></div>
      <div className={`vf-tile ${b.due > 0 ? "bad" : "ok"}`}><b>{bdtFmt(Math.abs(b.due))}</b><span>{b.due >= 0 ? "Due" : "Advance"}</span></div></div>
    {rows.length ? <div className="tbl"><table><thead><tr><th>Date</th><th>Details</th><th>Charge</th><th>Paid</th></tr></thead><tbody>
      {rows.map((x, i) => <tr key={i}><td className="nowrap">{fdate(x.date)}</td><td>{x.desc}{x.pending && <span className="ec-badge pay-pending"> Waiting for approval</span>}</td><td className="num">{x.dr ? bdtFmt(x.dr) : ""}</td><td className="num">{x.cr ? bdtFmt(x.cr) : ""}</td></tr>)}
    </tbody></table></div> : <Empty>No charges or payments yet.</Empty>}
    <p className="muted small mt8">Charges come from BMET clearance files (processing fee and previous due). Payments are money receipts made with this agent name.</p>
  </>;
}

/* Visa applications entry: status of a worker in one list (KSA or Fiji) */
export const VSTATUS = ["New", "Documents received", "Medical done", "MOFA done", "Visa applied", "Visa issued", "Fingerprint done", "BMET clearance", "Ticket booked", "Flown", "On hold", "Cancelled"];
export function VStatusCell({ p, list }) {
  const cur = p.vstatus?.[list]?.s || ""; const [custom, setCustom] = React.useState(false); const [t, setT] = React.useState("");
  const set = s => act("admin.passport", { op: "status", id: p.id, list, status: s }, { quiet: true });
  if (custom) return <div className="row6 nowrap"><input type="text" value={t} maxLength={60} autoFocus placeholder="Write the status" onChange={e => setT(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (t.trim()) { set(t.trim()); setCustom(false); } } }} style={{ width: 150 }} aria-label="Custom status" />
    <button className="btn sm pri" aria-label="Save status" onClick={() => { if (t.trim()) { set(t.trim()); setCustom(false); } }}><LuCheck /></button><button className="btn sm" aria-label="Cancel" onClick={() => setCustom(false)}><LuX /></button></div>;
  const st = cur === "Cancelled" ? "bad" : cur === "Flown" || cur === "Visa issued" ? "ok" : cur ? "info" : "";
  return <div><select className={`vs-sel ${st}`} value={cur} aria-label="Status" onChange={e => { if (e.target.value === "__custom") { setT(VSTATUS.includes(cur) ? "" : cur); setCustom(true); } else set(e.target.value); }}>
    <option value="">— Set status —</option>{[...VSTATUS, ...(cur && !VSTATUS.includes(cur) ? [cur] : [])].map(x => <option key={x} value={x}>{x}</option>)}<option value="__custom">Custom…</option></select>
    {cur && <div className="muted tiny-d">{fdate(p.vstatus[list].at)}</div>}</div>;
}
