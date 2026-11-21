// Passport Entry › Fiji Passport Entry: trade, experience, returnee, reference, and what was handed in with the passport
import React from "react";
import { LuCheck, LuSearch, LuPencil, LuTrash2, LuX, LuFileSpreadsheet, LuReceipt } from "react-icons/lu";
import { store } from "../store.js";
import { act, confirmBox, openModal } from "../actions.js";
import { Field } from "./shared.jsx";
import { Empty } from "../ui.jsx";
import { passports, inList, CountrySelect } from "./Passports.jsx";
import { xlsx } from "../receipt.js";
import { AgentDatalist, VStatusCell } from "./AgentBook.jsx";

const agentsList = () => store.S.users.filter(u => u.role === "agent").map(u => ({ id: u.id, name: u.agent?.business || u.name })).sort((a, b) => a.name.localeCompare(b.name));
const DOCS = [["photo", "Photo"], ["police", "Police clearance"], ["medical", "Medical report"]];
const blank = () => ({ name: "", passport: "", ref: "", agentId: "", fiji: { profession: "", experience: "", returnee: "no", prevCountry: "", submitted: "original", docs: [], note: "" } });
const day = iso => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "");

export function FijiPassportEntry() {
  const [f, setF] = React.useState(blank), [edit, setEdit] = React.useState(null), [busy, setBusy] = React.useState(false), [q, setQ] = React.useState("");
  const set = v => setF(o => ({ ...o, ...v })), setJ = v => setF(o => ({ ...o, fiji: { ...o.fiji, ...v } })), J = f.fiji;
  const ags = agentsList(), refAgent = f.agentId && ags.find(a => a.id === f.agentId);
  const all = passports().filter(p => p.fiji && inList("fiji")(p)), s0 = q.trim().toLowerCase();
  const list = all.filter(p => !s0 || [p.name, p.passport, p.ref, p.fiji.profession, p.fiji.prevCountry].some(v => (v || "").toLowerCase().includes(s0)));
  // a passport already entered (e.g. in BMET) fills the name and reference
  const known = !edit && f.passport.length >= 6 && passports().find(p => p.passport === f.passport.replace(/\s+/g, "").toUpperCase());
  const save = async e => {
    e.preventDefault(); setBusy(true);
    const r = await act("admin.passport", { op: "fiji", id: edit, name: f.name, passport: f.passport, ref: f.ref, agentId: f.agentId, fiji: { ...J, experience: Number(J.experience) || 0 } }); setBusy(false);
    if (r) { setF(blank()); setEdit(null); }
  };
  const start = p => { setEdit(p.id); setF({ name: p.name, passport: p.passport, ref: p.ref || "", agentId: p.agentId || "", fiji: { ...blank().fiji, ...p.fiji, experience: String(p.fiji.experience ?? "") } }); window.scrollTo?.({ top: 0, behavior: "smooth" }); };
  const docsText = p => DOCS.filter(([k]) => p.fiji.docs?.includes(k)).map(([, l]) => l);
  const excel = () => xlsx("Fiji passports", [["SL", "Full name", "Passport No.", "Profession", "Experience (years)", "Returnee", "Came back from", "Ref. / Agent", "Passport handed in", "Photo", "Police clearance", "Medical report", "Note", "Added"].map(v => ({ v, s: 1 })),
    ...list.map((p, i) => [i + 1, p.name, p.passport, p.fiji.profession, p.fiji.experience, p.fiji.returnee === "yes" ? "Yes" : "No", p.fiji.prevCountry, p.ref, p.fiji.submitted === "photocopy" ? "Photocopy" : "Original", ...DOCS.map(([k]) => (p.fiji.docs?.includes(k) ? "Yes" : "No")), p.fiji.note, day(p.fiji.at || p.at)])],
    [5, 24, 14, 18, 10, 9, 16, 22, 12, 7, 10, 10, 30, 12], `fiji-passports-${new Date().toISOString().slice(0, 10)}.xlsx`);
  return <>
    <div className="ec-head"><div><h2>Fiji Passport Entry</h2><p className="muted small">Passports for Fiji: trade, experience, whether the person worked abroad before, who referred them, and what was handed in with the passport.</p></div></div>
    <form className="card" onSubmit={save} noValidate>
      {edit && <p className="small"><span className="ec-badge">{`Editing ${f.passport}`}</span><button type="button" className="btn sm link" onClick={() => { setEdit(null); setF(blank()); }}><LuX /> Cancel</button></p>}
      <div className="fgrid">
        <Field label={<span>Full name<span className="req"> *</span></span>}><input type="text" value={f.name} onChange={e => set({ name: e.target.value })} maxLength={120} placeholder="As in the passport" /></Field>
        <Field label={<span>Passport number<span className="req"> *</span></span>} hint={known ? `Already in the passport list (${known.name}); the Fiji details are added to it.` : ""}>
          <input type="text" value={f.passport} onChange={e => { const v = e.target.value.toUpperCase(); const k = !edit && passports().find(p => p.passport === v.replace(/\s+/g, "")); set({ passport: v, ...(k && !f.name ? { name: k.name, ref: k.ref || "", agentId: k.agentId || "" } : {}) }); }} maxLength={20} placeholder="A01234567" autoComplete="off" /></Field>
        <Field label={<span>Profession<span className="req"> *</span></span>}><input type="text" value={J.profession} onChange={e => setJ({ profession: e.target.value })} maxLength={80} placeholder="e.g. Carpenter, Mason, Driver" /></Field>
        <Field label="Work experience (years)"><input type="number" min="0" max="50" step="1" inputMode="numeric" value={J.experience} onChange={e => setJ({ experience: e.target.value })} placeholder="0" /></Field>
        <Field label="Worked abroad before?"><div className="seg2" role="radiogroup" aria-label="Worked abroad before">{[["yes", "Returnee"], ["no", "Not a returnee"]].map(([k, l]) =>
          <button key={k} type="button" role="radio" aria-checked={J.returnee === k} className={J.returnee === k ? "on" : ""} onClick={() => setJ({ returnee: k, ...(k === "no" ? { prevCountry: "" } : {}) })}>{l}</button>)}</div></Field>
        {J.returnee === "yes" && <Field label={<span>Came back from (country)<span className="req"> *</span></span>}><CountrySelect value={J.prevCountry} onChange={c => setJ({ prevCountry: c })} placeholder="— Choose the country —" label="Came back from" /></Field>}
        <Field label="Reference / agent" hint={refAgent ? `Agent: ${refAgent.name}` : "Choose an agent or type who referred the person"}>
          <input type="text" value={f.ref} list="fj-agents" onChange={e => { const a = ags.find(x => x.name === e.target.value); set({ ref: e.target.value, agentId: a ? a.id : "" }); }} maxLength={120} placeholder="Agent or reference name" />
          <AgentDatalist id="fj-agents" /></Field>
        <Field label="Passport handed in"><div className="seg2" role="radiogroup" aria-label="Passport handed in">{[["original", "Original passport"], ["photocopy", "Photocopy"]].map(([k, l]) =>
          <button key={k} type="button" role="radio" aria-checked={J.submitted === k} className={J.submitted === k ? "on" : ""} onClick={() => setJ({ submitted: k })}>{l}</button>)}</div></Field>
        <Field label="Handed in with the passport" full><div className="fj-docs">{DOCS.map(([k, l]) => <label key={k} className="check"><input type="checkbox" checked={J.docs.includes(k)} onChange={e => setJ({ docs: e.target.checked ? [...J.docs, k] : J.docs.filter(x => x !== k) })} /> {l}</label>)}</div></Field>
        <Field label="Note" full><textarea rows={2} value={J.note} maxLength={1000} onChange={e => setJ({ note: e.target.value })} placeholder="Anything else to remember" /></Field>
      </div>
      <div className="row6 mt14"><button className="btn pri" type="submit" disabled={busy}><LuCheck /> {edit ? "Save changes" : "Save passport"}</button></div>
    </form>
    <div className="card mt14">
      <div className="vf-tools"><b>{`Fiji passports (${all.length})`}</b><span className="grow" />
        <label className="ec-search mr-search"><input type="text" value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, passport, profession, reference" aria-label="Search Fiji passports" /><LuSearch /></label>
        <button className="btn" disabled={!list.length} onClick={excel}><LuFileSpreadsheet /> Excel</button></div>
      {list.length ? <div className="tbl vf-tbl"><table><thead><tr><th>SL</th><th>Name</th><th>Passport</th><th>Profession</th><th>Experience</th><th>Returnee</th><th>Ref. / Agent</th><th>Status</th><th>Passport</th><th>Handed in</th><th>Note</th><th>Actions</th></tr></thead><tbody>
        {list.map((p, i) => <tr key={p.id}>
          <td className="num">{list.length - i}</td><td className="b" data-notr>{p.name}</td><td className="num" data-notr>{p.passport}</td><td>{p.fiji.profession}</td><td className="num">{`${p.fiji.experience || 0} yr`}</td>
          <td>{p.fiji.returnee === "yes" ? <span className="vf-pill info">{`Yes · ${p.fiji.prevCountry}`}</span> : <span className="muted">No</span>}</td>
          <td data-notr>{p.ref || <span className="muted">Office</span>}</td>
          <td><VStatusCell p={p} list="fiji" /></td>
          <td><span className={`vf-pill ${p.fiji.submitted === "photocopy" ? "wait" : "ok"}`}>{p.fiji.submitted === "photocopy" ? "Photocopy" : "Original"}</span></td>
          <td>{docsText(p).length ? docsText(p).join(", ") : <span className="muted">—</span>}</td>
          <td className="fj-note">{p.fiji.note || <span className="muted">—</span>}</td>
          <td className="nowrap"><button className="btn sm" title="Money receipt for this worker" onClick={() => openModal("mrEntry", { pp: p.id })}><LuReceipt /> Receipt</button><button className="btn sm" onClick={() => start(p)}><LuPencil /> Edit</button>
            <button className="btn sm link danger" aria-label={`Delete ${p.passport}`} onClick={() => confirmBox(`Delete passport ${p.passport} (${p.name})?`, () => act("admin.passport", { op: "delete", id: p.id, list: "fiji" }), "Delete")}><LuTrash2 /></button></td>
        </tr>)}
      </tbody></table></div> : <Empty>{q ? "No passports match." : "No Fiji passports yet. Add the first one above."}</Empty>}
    </div>
  </>;
}
