// BMET Clearance › Passport entry: the office's list of passports (full name, passport number, country, gender, reference).
// The same list is offered when making money receipts, account entries and BMET clearance applications.
import React from "react";
import { LuPlus, LuX, LuSearch, LuPencil, LuTrash2, LuCheck, LuReceipt, LuBookUser, LuFileSpreadsheet } from "react-icons/lu";
import { store } from "../store.js";
import { act, openModal, toast, confirmBox } from "../actions.js";
import { Field } from "./shared.jsx";
import { Empty } from "../ui.jsx";
import { COUNTRIES } from "../constants.js";
import { xlsx } from "../receipt.js";

export const passports = () => store.S.passports || [];
const agentsList = () => store.S.users.filter(u => u.role === "agent").map(u => ({ id: u.id, name: u.agent?.business || u.name })).sort((a, b) => a.name.localeCompare(b.name));
const countries = () => [...new Set([...Object.keys(COUNTRIES), ...passports().map(p => p.country)])];
export const ppMatch = q => { const s = q.trim().toLowerCase(), n = s.replace(/\s+/g, ""); return p => !s || p.passport.toLowerCase().includes(n) || p.name.toLowerCase().includes(s) || (p.ref || "").toLowerCase().includes(s) || p.country.toLowerCase().includes(s); };
/** text for an account line, like the office sheet: "1 FIJI PP (A0123456) · Name" */
export const ppLine = p => `1 ${p.country.toUpperCase()} PP (${p.passport}) · ${p.name}`;
const fdate = iso => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export function PassportEntry({ title } = {}) {
  const [q, setQ] = React.useState(""); const [edit, setEdit] = React.useState(null); const [n, setN] = React.useState(50);
  const list = passports().filter(ppMatch(q));
  const exportXlsx = () => xlsx("Passports", [["Full name", "Passport No.", "Country", "Gender", "Ref.", "Added"].map(v => ({ v, s: 1 })), ...list.map(p => [p.name, p.passport, p.country, p.gender, p.ref, p.at.slice(0, 10)])], [28, 15, 16, 10, 26, 12], `passports-${new Date().toISOString().slice(0, 10)}.xlsx`);
  return <>
    <div className="ec-head"><div><h2>{title || "Passport entry"}</h2><p className="muted small">Enter passports once; use them in BMET clearance applications, money receipts and account entries. A Ref. that is one of our agents lets that agent use the passport too.</p></div></div>
    <PassportForm />
    <div className="ec-tools mt14">
      <b>{`Passports (${passports().length})`}</b><span className="grow" />
      <label className="ec-search mr-search"><input type="text" value={q} onChange={e => { setQ(e.target.value); setN(50); }} placeholder="Search name, passport number, country or Ref." aria-label="Search passports" /><LuSearch /></label>
      <button className="btn" disabled={!list.length} onClick={exportXlsx}><LuFileSpreadsheet /> Excel</button>
    </div>
    {list.length ? <div className="tbl ec-tbl grid"><table><thead><tr><th>SL</th><th>Full name</th><th>Passport No.</th><th>Country</th><th>Male/Female</th><th>Ref.</th><th>Added</th><th>Actions</th></tr></thead><tbody>
      {list.slice(0, n).map((p, i) => edit === p.id ? <EditRow key={p.id} p={p} onDone={() => setEdit(null)} /> : <tr key={p.id}>
        <td>{i + 1}</td><td className="b" data-notr>{p.name}</td><td className="num ec-ref" data-notr>{p.passport}</td><td>{p.country}</td><td>{p.gender}</td><td data-notr>{p.ref || "—"}</td>
        <td className="num small">{fdate(p.at)}<div className="muted">{p.by}</div></td>
        <td><div className="row6 nowrap">
          <button className="btn sm" title="Money receipt for this passport" onClick={() => openModal("mrEntry", { pp: p.id })}><LuReceipt /> Receipt</button>
          <button className="ec-ico view" aria-label="Edit" title="Edit" onClick={() => setEdit(p.id)}><LuPencil /></button>
          <button className="ec-ico pdf" aria-label="Delete" title="Delete" onClick={() => confirmBox(`Delete passport ${p.passport} (${p.name}) from the list?`, () => act("admin.passport", { op: "delete", id: p.id }), "Delete")}><LuTrash2 /></button>
        </div></td>
      </tr>)}
    </tbody></table></div> : <Empty>{q ? "No passport matches your search." : "No passports yet. Add the first one above."}</Empty>}
    {list.length > n && <div className="center mt14"><button className="btn" onClick={() => setN(n + 100)}>Show more</button></div>}
  </>;
}

function Fields({ v, set, idx }) {
  const ags = agentsList(), refAgent = v.agentId && ags.find(a => a.id === v.agentId);
  return <>
    <Field label="Full name"><input type="text" value={v.name} onChange={e => set({ name: e.target.value })} maxLength={120} placeholder="As in the passport" aria-label={`Full name${idx ? ` ${idx}` : ""}`} /></Field>
    <Field label="Passport number"><input type="text" value={v.passport} onChange={e => set({ passport: e.target.value.toUpperCase() })} maxLength={20} placeholder="A01234567" style={{ textTransform: "uppercase" }} /></Field>
    <Field label="Country"><select value={v.country} onChange={e => set({ country: e.target.value })}><option value="">— Choose —</option>{countries().map(c => <option key={c}>{c}</option>)}</select></Field>
    <Field label="Male/Female"><div className="seg2" role="radiogroup">{["Male", "Female"].map(g => <button key={g} type="button" role="radio" aria-checked={v.gender === g} className={v.gender === g ? "on" : ""} onClick={() => set({ gender: g })}>{g}</button>)}</div></Field>
    <Field label="Ref." hint={refAgent ? `${refAgent.name} can use this passport in the agent panel.` : "An agent, or who referred the person"}>
      <input type="text" value={v.ref} list="pp-ref-agents" onChange={e => { const a = ags.find(x => x.name === e.target.value); set({ ref: e.target.value, agentId: a ? a.id : "" }); }} maxLength={120} placeholder="Agent or reference" /></Field>
  </>;
}
const blank = (k = Math.random().toString(36).slice(2), country = "") => ({ k, name: "", passport: "", country, gender: "", ref: "", agentId: "" });
function PassportForm() {
  const [rows, setRows] = React.useState(() => [blank()]); const [busy, setBusy] = React.useState(false);
  const set = (i, v) => setRows(rows.map((r, j) => (j === i ? { ...r, ...v } : r)));
  const add = async e => {
    e.preventDefault();
    for (const [i, r] of rows.entries()) {
      const at = rows.length > 1 ? ` (row ${i + 1})` : "";
      if (r.name.trim().length < 2) return toast(`Enter the full name${at}.`);
      if (!/^[A-Z0-9]{6,15}$/.test(r.passport.replace(/\s+/g, ""))) return toast(`Check the passport number${at}.`);
      if (!r.country) return toast(`Choose the country${at}.`);
      if (!r.gender) return toast(`Choose Male or Female${at}.`);
    }
    setBusy(true); const res = await act("admin.passport", { op: "add", rows: rows.map(({ k, ...r }) => r) }); setBusy(false);
    if (res) { const l = rows[rows.length - 1]; setRows([blank(undefined, l.country)]); }
  };
  return <form className="card ledger-add" onSubmit={add} noValidate>
    <h4>Add passport</h4>
    {rows.map((r, i) => <div key={r.k} className={`fgrid${rows.length > 1 ? " mr-line" : ""}`}>
      {rows.length > 1 && <div className="mr-line-head full"><b>{`Passport ${i + 1}`}</b><button type="button" className="btn sm link danger" onClick={() => setRows(rows.filter((_, j) => j !== i))}><LuX /> Remove</button></div>}
      <Fields v={r} set={v => set(i, v)} idx={rows.length > 1 ? i + 1 : 0} />
    </div>)}
    <datalist id="pp-ref-agents">{agentsList().map(a => <option key={a.id} value={a.name} />)}</datalist>
    <div className="row6 mt8"><button type="button" className="btn sm" onClick={() => { const l = rows[rows.length - 1]; setRows([...rows, blank(undefined, l.country)]); }}><LuPlus /> Add another passport</button></div>
    <div className="mt14"><button className="btn pri" disabled={busy}>{rows.length > 1 ? `Save ${rows.length} passports` : "Save passport"}</button></div>
  </form>;
}
function EditRow({ p, onDone }) {
  const [v, setV] = React.useState({ name: p.name, passport: p.passport, country: p.country, gender: p.gender, ref: p.ref || "", agentId: p.agentId || "" });
  const save = async () => { if (await act("admin.passport", { op: "update", id: p.id, ...v })) onDone(); };
  return <tr className="sel"><td colSpan={8}><div className="fgrid pp-edit"><Fields v={v} set={x => setV({ ...v, ...x })} />
    <datalist id="pp-ref-agents">{agentsList().map(a => <option key={a.id} value={a.name} />)}</datalist>
    <div className="full row6"><button type="button" className="btn sm pri" onClick={save}><LuCheck /> Save</button><button type="button" className="btn sm" onClick={onDone}><LuX /> Cancel</button></div></div></td></tr>;
}

/* a small search to pick a passport; used in account entry forms ("details" gets the passport line) */
export function PassportPick({ onPick, label = "From passport list" }) {
  const [open, setOpen] = React.useState(false); const [q, setQ] = React.useState(""); const ref = React.useRef(null);
  React.useEffect(() => { if (!open) return; const f = e => { if (!ref.current?.contains(e.target)) setOpen(false); }; document.addEventListener("pointerdown", f); return () => document.removeEventListener("pointerdown", f); }, [open]);
  if (!passports().length) return null;
  const list = passports().filter(ppMatch(q)).slice(0, 8);
  return <span className="pp-pick" ref={ref}>
    <button type="button" className="btn sm link" onClick={() => setOpen(!open)}><LuBookUser /> {label}</button>
    {open && <div className="pp-pop"><label className="ec-search"><input type="text" value={q} onChange={e => setQ(e.target.value)} placeholder="Name or passport number" autoFocus aria-label="Find a passport" /><LuSearch /></label>
      <div className="mr-found">{list.length ? list.map(p => <button type="button" key={p.id} onClick={() => { onPick(p); setOpen(false); setQ(""); }}><LuBookUser /><span><b data-notr>{p.name}</b><small data-notr>{[p.passport, p.country, p.gender, p.ref].filter(Boolean).join(" · ")}</small></span></button>)
        : <p className="muted small">No passport found.</p>}</div></div>}
  </span>;
}
