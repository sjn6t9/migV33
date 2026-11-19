// Visa applications › KSA visa › HR files: a dashboard of client files (MOFA, visa, sponsor, medical) and the Create Client File form.
import React from "react";
import { LuFilePlus2, LuSearch, LuPencil, LuTrash2, LuFileSpreadsheet, LuX } from "react-icons/lu";
import { store, commit } from "../store.js";
import { act, openModal, closeModal, confirmBox } from "../actions.js";
import { Field } from "./shared.jsx";
import { Empty } from "../ui.jsx";
import { PassportPick } from "./Passports.jsx";
import { xlsx } from "../receipt.js";

export const MOFA_ST = ["Not applied", "Applied", "Issued", "Rejected", "Cancelled"];
export const VISA_ST = ["Pending", "Applied", "Issued", "Stamped", "Rejected", "Cancelled"];
const files = () => store.S.visa?.files || [];
const agentsList = () => store.S.users.filter(u => u.role === "agent").map(u => ({ id: u.id, name: u.agent?.business || u.name })).sort((a, b) => a.name.localeCompare(b.name));
const day = v => (v ? new Date(v.length === 10 ? v + "T00:00:00" : v).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const norm = v => String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
/** "Match" when the client's profession is the visa profession, "Not match" when both are known and differ */
export const profMatch = f => (!f.profession || !f.visaProfession ? null : norm(f.profession) === norm(f.visaProfession));
const tone = s => (/issued|stamped/i.test(s) ? "ok" : /rejected|cancelled/i.test(s) ? "bad" : /applied/i.test(s) ? "info" : "wait");
const Pill = ({ s }) => <span className={`vf-pill ${tone(s)}`}>{s}</span>;

export function VisaAdmin() {
  const ui = store.ui, sub = ui.visaSub || "ksa";
  return <>
    <nav className="pay-tabs" aria-label="Visa applications"><button className={sub === "ksa" ? "on" : ""} aria-current={sub === "ksa" ? "page" : undefined} onClick={() => { ui.visaSub = "ksa"; commit(); }}>KSA Visa</button></nav>
    <nav className="pay-tabs vf-sub" aria-label="KSA Visa"><button className="on" aria-current="page">HR Files<span className="count soft">{files().length}</span></button></nav>
    <HrFiles />
  </>;
}

function HrFiles() {
  const [q, setQ] = React.useState(""), [mofa, setMofa] = React.useState(""), [visa, setVisa] = React.useState(""), [ag, setAg] = React.useState(""), [n, setN] = React.useState(50);
  const all = [...files()].sort((a, b) => a.sl - b.sl);
  const s = q.trim().toLowerCase(), sn = s.replace(/\s+/g, "");
  const list = all.filter(f => (!mofa || f.mofaStatus === mofa) && (!visa || f.visaStatus === visa) && (!ag || f.agentId === ag || (ag === "-" && !f.agentId))
    && (!s || [f.name, f.agent, f.sponsorName, f.profession, f.visaProfession].some(v => (v || "").toLowerCase().includes(s)) || [f.passport, f.mofaId, f.visaNo, f.sponsorId].some(v => (v || "").toLowerCase().includes(sn))));
  const c = p => all.filter(p).length;
  const tiles = [[all.length, "Total files", ""], [c(f => f.mofaStatus === "Issued"), "MOFA issued", "ok"], [c(f => ["Issued", "Stamped"].includes(f.visaStatus)), "Visa issued / stamped", "ok"],
    [c(f => ["Pending", "Applied"].includes(f.visaStatus)), "Visa in process", "wait"], [c(f => f.medicalSlipDate), "Medical slip taken", ""], [c(f => profMatch(f) === false), "Profession not matching", "bad"]];
  const HEAD = ["SL", "Agent", "Name", "Mofa ID", "Passport", "Visa Number", "Sponsor ID", "Mofa Status", "Visa Status", "Actions", "Created Date", "Medical Slip Date", "Sponsor Name", "Profession Match"];
  const excel = () => xlsx("HR Files", [HEAD.filter(h => h !== "Actions").map(v => ({ v, s: 1 })), ...list.map(f => [f.sl, f.agent, f.name, f.mofaId, f.passport, f.visaNo, f.sponsorId, f.mofaStatus, f.visaStatus, f.created.slice(0, 10), f.medicalSlipDate, f.sponsorName, profMatch(f) == null ? "" : profMatch(f) ? "Match" : "Not match"])],
    [6, 24, 26, 14, 13, 14, 14, 12, 12, 12, 14, 28, 14], `ksa-hr-files-${new Date().toISOString().slice(0, 10)}.xlsx`);
  const filtered = q || mofa || visa || ag;
  return <>
    <div className="ec-head"><div><h2>KSA Visa · HR Files</h2><p className="muted small">Client files for Saudi visas: MOFA, visa, sponsor and medical, with the agent who sent each client.</p></div>
      <button className="btn pri" onClick={() => openModal("visaFile", {})}><LuFilePlus2 /> Create Client File</button></div>
    <div className="vf-tiles">{tiles.map(([v, l, t]) => <div key={l} className={`vf-tile ${t}`}><b>{v}</b><span>{l}</span></div>)}</div>
    <div className="card">
      <div className="vf-tools">
        <label className="ec-search mr-search"><input type="text" value={q} onChange={e => { setQ(e.target.value); setN(50); }} placeholder="Search name, passport, MOFA ID, visa no., sponsor" aria-label="Search client files" /><LuSearch /></label>
        <select value={mofa} onChange={e => setMofa(e.target.value)} aria-label="Mofa status"><option value="">All MOFA status</option>{MOFA_ST.map(x => <option key={x}>{x}</option>)}</select>
        <select value={visa} onChange={e => setVisa(e.target.value)} aria-label="Visa status"><option value="">All visa status</option>{VISA_ST.map(x => <option key={x}>{x}</option>)}</select>
        <select value={ag} onChange={e => setAg(e.target.value)} aria-label="Agent"><option value="">All agents</option><option value="-">No agent (office)</option>{agentsList().map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        {filtered && <button className="btn sm link" onClick={() => { setQ(""); setMofa(""); setVisa(""); setAg(""); }}><LuX /> Clear</button>}
        <span className="grow" /><button className="btn" disabled={!list.length} onClick={excel}><LuFileSpreadsheet /> Excel</button>
      </div>
      {list.length ? <div className="tbl vf-tbl"><table><thead><tr>{HEAD.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>
        {list.slice(0, n).map(f => { const pm = profMatch(f); return <tr key={f.id}>
          <td className="num">{f.sl}</td><td>{f.agent || <span className="muted">Office</span>}</td><td className="b">{f.name}</td><td className="num">{f.mofaId || "—"}</td><td className="num">{f.passport}</td>
          <td className="num">{f.visaNo || "—"}</td><td className="num">{f.sponsorId || "—"}</td><td><Pill s={f.mofaStatus} /></td><td><Pill s={f.visaStatus} /></td>
          <td className="nowrap"><button className="btn sm" onClick={() => openModal("visaFile", { id: f.id })}><LuPencil /> Edit</button>
            <button className="btn sm link danger" aria-label={`Delete ${f.name}`} onClick={() => confirmBox(`Delete the client file of ${f.name}?`, () => act("admin.visa", { op: "delete", id: f.id }), "Delete")}><LuTrash2 /></button></td>
          <td className="nowrap">{day(f.created)}</td><td className="nowrap">{day(f.medicalSlipDate)}</td><td>{f.sponsorName || "—"}</td>
          <td>{pm == null ? <span className="muted">—</span> : <span className={`vf-pill ${pm ? "ok" : "bad"}`} title={`${f.profession} / ${f.visaProfession}`}>{pm ? "Match" : "Not match"}</span>}</td>
        </tr>; })}</tbody></table></div> : <Empty>{filtered ? "No client files match." : "No client files yet. Use Create Client File to add the first one."}</Empty>}
      {list.length > n && <div className="mt8"><button className="btn sm" onClick={() => setN(n + 100)}>{`Show more (${list.length - n})`}</button></div>}
    </div>
  </>;
}

/* Create / edit a client file */
export function VisaFileForm({ id }) {
  const old = id && files().find(f => f.id === id);
  const [f, setF] = React.useState(() => ({ name: "", passport: "", agentId: "", agent: "", mofaId: "", visaNo: "", sponsorId: "", sponsorName: "", mofaStatus: "Not applied", visaStatus: "Pending", medicalSlipDate: "", profession: "", visaProfession: "", note: "", ...(old || {}) }));
  const [busy, setBusy] = React.useState(false);
  const set = v => setF({ ...f, ...v }), inp = (k, p = {}) => <input type="text" value={f[k] || ""} onChange={e => set({ [k]: e.target.value })} {...p} />;
  const pm = profMatch(f);
  const save = async e => { e.preventDefault(); setBusy(true); const r = await act("admin.visa", { op: "save", id, file: f }); setBusy(false); if (r) closeModal(); };
  return <form onSubmit={save} noValidate>
    <h2>{old ? `Client file · SL ${old.sl}` : "Create Client File"}</h2><p className="muted small">KSA Visa · HR Files</p>
    <h4 className="mt14">Client</h4>
    <div className="fgrid">
      <Field label={<span className="field-head">Full name<PassportPick onPick={p => set({ name: p.name, passport: p.passport, agentId: p.agentId || f.agentId })} /></span>}>{inp("name", { maxLength: 120, autoComplete: "off" })}</Field>
      <Field label="Passport number">{inp("passport", { maxLength: 20, autoComplete: "off" })}</Field>
      <Field label="Agent"><select value={f.agentId || ""} onChange={e => set({ agentId: e.target.value })}><option value="">No agent (office client)</option>{agentsList().map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
      <Field label="Medical slip date"><input type="date" value={f.medicalSlipDate || ""} onChange={e => set({ medicalSlipDate: e.target.value })} /></Field>
    </div>
    <h4 className="mt14">MOFA and visa</h4>
    <div className="fgrid">
      <Field label="Mofa ID">{inp("mofaId", { maxLength: 40 })}</Field>
      <Field label="Mofa status"><select value={f.mofaStatus} onChange={e => set({ mofaStatus: e.target.value })}>{MOFA_ST.map(x => <option key={x}>{x}</option>)}</select></Field>
      <Field label="Visa number">{inp("visaNo", { maxLength: 40 })}</Field>
      <Field label="Visa status"><select value={f.visaStatus} onChange={e => set({ visaStatus: e.target.value })}>{VISA_ST.map(x => <option key={x}>{x}</option>)}</select></Field>
    </div>
    <h4 className="mt14">Sponsor</h4>
    <div className="fgrid">
      <Field label="Sponsor ID">{inp("sponsorId", { maxLength: 40 })}</Field>
      <Field label="Sponsor name">{inp("sponsorName", { maxLength: 160 })}</Field>
      <Field label="Client's profession">{inp("profession", { maxLength: 120, placeholder: "e.g. Electrician" })}</Field>
      <Field label="Profession on the visa">{inp("visaProfession", { maxLength: 120, placeholder: "e.g. Electrician" })}</Field>
      {pm != null && <div className="full"><span className={`vf-pill ${pm ? "ok" : "bad"}`}>{pm ? "Profession match" : "Profession does not match the visa"}</span></div>}
      <Field label="Note" full><textarea rows={2} value={f.note || ""} maxLength={1000} onChange={e => set({ note: e.target.value })} /></Field>
    </div>
    <div className="row6 mt14"><button className="btn pri" type="submit" disabled={busy}>{old ? "Save" : "Create Client File"}</button><button className="btn" type="button" onClick={closeModal}>Cancel</button></div>
  </form>;
}
