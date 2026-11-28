// BMET Clearance › Passport entry: the office's list of passports (full name, passport number, country, gender, reference).
// The same list is offered when making money receipts, account entries and BMET clearance applications.
import React from "react";
import { LuPlus, LuX, LuSearch, LuPencil, LuTrash2, LuCheck, LuReceipt, LuBookUser, LuFileSpreadsheet, LuShieldCheck, LuRefreshCw, LuSignature, LuUpload, LuFileText } from "react-icons/lu";
import { store } from "../store.js";
import { act, openModal, toast, confirmBox, readUpload } from "../actions.js";
import { contractFor } from "../contract.js";
import { Field } from "./shared.jsx";
import { Empty } from "../ui.jsx";
import { COUNTRIES, MIDDLE_EAST, ASIA } from "../constants.js";
import { xlsx } from "../receipt.js";
import { AgentDatalist } from "./AgentBook.jsx";

export const passports = () => store.S.passports || [];
/* the passports of one entry list: "bmet", "ksa" or "fiji" */
export const inList = k => p => (p.lists || [p.fiji && "fiji", p.info && "ksa", !p.fiji && !p.info && "bmet"].filter(Boolean)).includes(k);
export const agentsList = () => store.S.users.filter(u => u.role === "agent").map(u => ({ id: u.id, name: u.agent?.business || u.name })).sort((a, b) => a.name.localeCompare(b.name));
const countries = () => [...new Set([...Object.keys(COUNTRIES), ...passports().map(p => p.country)])];
/* our destination countries first, then every country of the Middle East and Asia */
export function CountrySelect({ value, onChange, placeholder = "— Choose —", label }) {
  const ours = countries().filter(Boolean), me = MIDDLE_EAST.filter(c => !ours.includes(c)), as = ASIA.filter(c => !ours.includes(c));
  return <select value={value || ""} onChange={e => onChange(e.target.value)} aria-label={label}><option value="">{placeholder}</option>
    <optgroup label="Our destinations">{ours.map(c => <option key={c}>{c}</option>)}</optgroup>
    {me.length > 0 && <optgroup label="Middle East">{me.map(c => <option key={c}>{c}</option>)}</optgroup>}
    {as.length > 0 && <optgroup label="Asia">{as.map(c => <option key={c}>{c}</option>)}</optgroup>}</select>;
}
export const ppMatch = q => { const s = q.trim().toLowerCase(), n = s.replace(/\s+/g, ""); return p => !s || p.passport.toLowerCase().includes(n) || p.name.toLowerCase().includes(s) || String(p.bmet?.regNo || "").toLowerCase().includes(n) || String(p.bmet?.nid || "").includes(n) || (p.ref || "").toLowerCase().includes(s) || p.country.toLowerCase().includes(s); };
/** text for an account line, like the office sheet: "1 FIJI PP (A0123456) · Name" */
export const ppLine = p => `1 ${p.country.toUpperCase()} PP (${p.passport}) · ${p.name}`;
const fdate = iso => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export function PassportEntry({ title } = {}) {
  const [q, setQ] = React.useState(""); const [edit, setEdit] = React.useState(null); const [n, setN] = React.useState(50);
  const mine = passports().filter(inList("bmet")), list = mine.filter(ppMatch(q));
  const miss = mine.filter(p => !p.bmet?.regNo).length; const [filling, setFilling] = React.useState(false);
  const fill = async () => { setFilling(true); await act("admin.passport", { op: "raimsFill" }); setTimeout(() => setFilling(false), 4000); };
  const exportXlsx = () => xlsx("Passports", [["Full name", "Bangali Name", "Passport No.", "BMET Reg. No", "BIO Finger", "Availability", "NID", "Date of Birth", "Father's Name", "Mother's Name", "Mobile", "Country", "Gender", "Ref.", "Added"].map(v => ({ v, s: 1 })), ...list.map(p => [p.name, p.bmet?.nameBn || "", p.passport, p.bmet?.regNo || "", p.bmet?.finger || "", p.bmet?.available || "", p.bmet?.nid || "", p.bmet?.dob || "", p.bmet?.father || "", p.bmet?.mother || "", p.bmet?.mobile || "", p.country, p.gender, p.ref, p.at.slice(0, 10)])], [28, 22, 15, 18, 12, 14, 15, 12, 22, 22, 15, 16, 10, 26, 12], `passports-${new Date().toISOString().slice(0, 10)}.xlsx`);
  return <>
    <div className="ec-head"><div><h2>{title || "Passport entry"}</h2><p className="muted small">Enter passports once; use them in BMET clearance applications, money receipts and account entries. A Ref. that is one of our agents lets that agent use the passport too.</p></div></div>
    <PassportForm />
    <div className="ec-tools mt14">
      <b>{`Passports (${mine.length})`}</b><span className="grow" />
      <label className="ec-search mr-search"><input type="text" value={q} onChange={e => { setQ(e.target.value); setN(50); }} placeholder="Search name, passport number, country or Ref." aria-label="Search passports" /><LuSearch /></label>
      {miss > 0 && store.S.raims?.saved && <button className="btn soft" disabled={filling} onClick={fill} title="Reads BMET Reg. No, BIO Finger, Availability, NID and Date of Birth from RAIMS Pre EC Check"><LuRefreshCw /> {`Fill from RAIMS (${miss})`}</button>}
      <button className="btn" disabled={!list.length} onClick={exportXlsx}><LuFileSpreadsheet /> Excel</button>
    </div>
    {list.length ? <div className="tbl ec-tbl grid"><table><thead><tr><th>SL</th><th>Full name</th><th>Passport No.</th><th>BMET Reg. No</th><th>BIO Finger</th><th>Availability</th><th>NID</th><th>Date of Birth</th><th>Country</th><th>Male/Female</th><th>Ref.</th><th>Added</th><th>Actions</th></tr></thead><tbody>
      {list.slice(0, n).map((p, i) => edit === p.id ? <EditRow key={p.id} p={p} onDone={() => setEdit(null)} /> : <tr key={p.id}>
        <td>{i + 1}</td><td className="b" data-notr>{p.name}{p.bmet?.nameBn && p.bmet.nameBn !== p.name && <div className="muted small">{p.bmet.nameBn}</div>}</td><td className="num ec-ref" data-notr>{p.passport}</td>
        <td className="num" data-notr>{p.bmet?.regNo || "—"}</td>
        <td>{p.bmet?.finger ? <span className={`ec-badge ${/success/i.test(p.bmet.finger) ? "s-approved" : "s-rejected"}`}>{p.bmet.finger}</span> : "—"}</td>
        <td>{p.bmet?.available ? <span className={`ec-badge ${/^available/i.test(p.bmet.available) ? "s-approved" : "s-rejected"}`}>{p.bmet.available}</span> : "—"}</td>
        <td className="num" data-notr>{p.bmet?.nid || "—"}</td><td className="num nowrap" data-notr>{p.bmet?.dob || "—"}</td><td>{p.country}</td><td>{p.gender}</td><td data-notr>{p.ref || "—"}</td>
        <td className="num small">{fdate(p.at)}<div className="muted">{p.by}</div></td>
        <td><div className="row6 nowrap">
          <button className="btn sm" title="Money receipt for this passport" onClick={() => openModal("mrEntry", { pp: p.id })}><LuReceipt /> Receipt</button>
          {contractFor(p.country) && <button className="btn sm" title={p.contract ? "Employment contract saved — open or make again" : "Generate Employment Contract"}
            onClick={() => openModal("contract", { v: { ...p, id: p.id, job: p.job || {}, ppCopyRef: p.ppCopy ? { ...p.ppCopy, data: `/api/files/${p.ppCopy.id}` } : null }, sig: true })}><LuSignature /> {p.contract ? "Contract ✓" : "Contract"}</button>}
          <button className="ec-ico view" aria-label="Edit" title="Edit" onClick={() => setEdit(p.id)}><LuPencil /></button>
          <button className="ec-ico pdf" aria-label="Delete" title="Delete" onClick={() => confirmBox(`Delete passport ${p.passport} (${p.name}) from the list?`, () => act("admin.passport", { op: "delete", id: p.id, list: "bmet" }), "Delete")}><LuTrash2 /></button>
        </div></td>
      </tr>)}
    </tbody></table></div> : <Empty>{q ? "No passport matches your search." : "No passports yet. Add the first one above."}</Empty>}
    {list.length > n && <div className="center mt14"><button className="btn" onClick={() => setN(n + 100)}>Show more</button></div>}
  </>;
}

/* BMET details, laid out as RAIMS Pre EC Check shows them */
export const BMET_FIELDS = [["regNo", "BMET Registration No"], ["finger", "BIO Finger"], ["available", "Availability"], ["nameBn", "Bangali Name"], ["nid", "NID Number"], ["dob", "Date of Birth"], ["father", "Father's Name"], ["mother", "Mother's Name"], ["mobile", "Mobile"], ["profession", "Profession"], ["address", "Permanent Address"], ["training", "Training"], ["pdo", "PDO Completed"], ["issueDate", "Passport Issue Date"], ["expiryDate", "Passport Expire Date"]];
function Fields({ v, set, idx }) {
  const ags = agentsList(), refAgent = v.agentId && ags.find(a => a.id === v.agentId);
  const [busy, setBusy] = React.useState(false);
  const B = v.bmet || {}, setB = x => set({ bmet: { ...B, ...x } });
  const fill = async () => { // the passport's details from RAIMS (Pre EC Check)
    const pp = String(v.passport || "").replace(/\s+/g, ""); if (pp.length < 6) return toast("Enter the passport number first.");
    setBusy(true); const r = await act("raims.preEc", { passport: pp, returnee: "no" }, { quiet: true }); setBusy(false);
    if (!r?.ok) return toast(r?.problem || "RAIMS did not show a result for this passport.");
    const e = r.entry || {}; set({ ...(e.name && !v.name.trim() ? { name: e.name } : {}), ...(e.gender && !v.gender ? { gender: e.gender } : {}), bmet: { ...B, ...Object.fromEntries(Object.entries(e.bmet || {}).filter(([, x]) => x)) } });
    toast("Filled from RAIMS Pre EC Check.");
  };
  return <>
    <Field label="Full name"><input type="text" value={v.name} onChange={e => set({ name: e.target.value })} maxLength={120} placeholder="As in the passport" aria-label={`Full name${idx ? ` ${idx}` : ""}`} /></Field>
    <Field label="Passport number"><div className="preec-pp"><input type="text" value={v.passport} onChange={e => set({ passport: e.target.value.toUpperCase() })} maxLength={20} placeholder="A01234567" style={{ textTransform: "uppercase" }} />
      {store.S.raimsReady && <button type="button" className="btn sm" disabled={busy} title="Fill from RAIMS Pre EC Check" onClick={fill}><LuShieldCheck /> {busy ? "…" : "Pre EC"}</button>}</div></Field>
    <Field label="Country"><CountrySelect value={v.country} onChange={c => set({ country: c })} /></Field>
    <Field label="Male/Female"><div className="seg2" role="radiogroup">{["Male", "Female"].map(g => <button key={g} type="button" role="radio" aria-checked={v.gender === g} className={v.gender === g ? "on" : ""} onClick={() => set({ gender: g })}>{g}</button>)}</div></Field>
    <Field label="BMET Registration No"><input type="text" value={B.regNo || ""} maxLength={40} onChange={e => setB({ regNo: e.target.value.toUpperCase() })} placeholder="RBM2026…" /></Field>
    <Field label="NID Number"><input type="text" inputMode="numeric" value={B.nid || ""} maxLength={20} onChange={e => setB({ nid: e.target.value })} /></Field>
    <Field label="Date of Birth"><input type="text" value={B.dob || ""} maxLength={12} onChange={e => setB({ dob: e.target.value })} placeholder="DD-MM-YYYY" /></Field>
    <Field label="Bangali Name"><input type="text" value={B.nameBn || ""} maxLength={120} onChange={e => setB({ nameBn: e.target.value })} /></Field>
    <Field label="Father's Name"><input type="text" value={B.father || ""} maxLength={120} onChange={e => setB({ father: e.target.value })} /></Field>
    <Field label="Mother's Name"><input type="text" value={B.mother || ""} maxLength={120} onChange={e => setB({ mother: e.target.value })} /></Field>
    <Field label="Mobile"><input type="tel" value={B.mobile || ""} maxLength={20} onChange={e => setB({ mobile: e.target.value })} /></Field>
    {(B.finger || B.available) && <Field label="BIO Finger · Availability"><div className="row6"><span className={`ec-badge ${/success/i.test(B.finger) ? "s-approved" : "s-rejected"}`}>{B.finger || "—"}</span><span className={`ec-badge ${/^available/i.test(B.available) ? "s-approved" : "s-rejected"}`}>{B.available || "—"}</span></div></Field>}
    <Field label="Ref." hint={refAgent ? `${refAgent.name} can use this passport in the agent panel.` : "An agent, or who referred the person"}>
      <input type="text" value={v.ref} list="pp-ref-agents" onChange={e => { const a = ags.find(x => x.name === e.target.value); set({ ref: e.target.value, agentId: a ? a.id : "" }); }} maxLength={120} placeholder="Agent or reference" /></Field>
    <Field label="Worker's address" hint="Filled from RAIMS Pre EC Check" full><input type="text" value={B.address || ""} maxLength={600} onChange={e => setB({ address: e.target.value })} placeholder="Village, post office, upazila, district" /></Field>
    <JobFields v={v} set={set} />
  </>;
}
export const isImgCopy = c => !!c && (/^data:image\//.test(c.data || "") || (/^\/api\/files\//.test(c.data || "") && !/\.pdf$/i.test(c.name || "")));
/* work and company details for the employment contract, and the passport copy (all optional) */
export const JOB_FIELDS = [["visaNo", "Visa Number", "e.g. 382026213657"], ["jobTitle", "Job title / occupation", "e.g. Driver"], ["company", "Department / work company name", "e.g. Red Mango Trading & Contracting"],
  ["companyReg", "Company registration", ""], ["companyEmail", "Company e-mail", "name@company.com"], ["companyMobile", "Company mobile", "+974 …"], ["companyAddress", "Company address", "e.g. Zone 31, Street 8111, Building 11"]];
function JobFields({ v, set }) {
  const J = v.job || {}, setJ = x => set({ job: { ...J, ...x } });
  const pick = async e => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
    try { set({ ppCopy: await readUpload(f, { imageMax: 2200 }) }); } catch (err) { toast(err.message); } };
  const copy = v.ppCopy === null ? null : v.ppCopy?.data ? v.ppCopy : v.ppCopyRef || null;
  return <>
    <div className="full pp-sec"><b>Work & company</b><span className="muted small"> — optional; used in the employment contract</span></div>
    {JOB_FIELDS.map(([k, l, ph]) => <Field key={k} label={l} full={k === "companyAddress" || k === "company"}><input type={k === "companyEmail" ? "email" : k === "companyMobile" ? "tel" : "text"} value={J[k] || ""} maxLength={k === "companyAddress" ? 300 : 160} placeholder={ph}
      onChange={e => setJ({ [k]: k === "visaNo" ? e.target.value.replace(/\s+/g, "") : e.target.value })} /></Field>)}
    <Field label="Passport copy (optional)" hint="A photo or scan of the passport page; its signature can go on the contract" full>
      <div className="fpick has-or-not">
        <label className="fpick-btn"><input className="fpick-in" type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" onChange={pick} /><LuUpload /><span>{copy ? "Change file" : "Choose file"}</span></label>
        {copy && <div className="fpick-files"><div className="fpick-item">{isImgCopy(copy) ? <img src={copy.data} alt="" /> : <span className="fpick-doc"><LuFileText /><em>PDF</em></span>}
          <span className="fpick-meta"><b data-notr>{copy.name || "Passport copy"}</b></span></div>
          <button type="button" className="fpick-x" onClick={() => set({ ppCopy: null })} aria-label="Remove file"><LuX /></button></div>}
      </div></Field>
  </>;
}
/* Generate Employment Contract: the tick for signatures, and the button (opens the contract with these details) */
function ContractBar({ v, id }) {
  const [sig, setSig] = React.useState(true); const T = contractFor(v.country);
  const go = () => { if (!v.country) return toast("Choose the country first.");
    if (!T) return toast(`There is no employment contract form for ${v.country} yet. Only Qatar has one now.`);
    if (!v.name.trim()) return toast("Enter the full name first.");
    openModal("contract", { v: { ...v, id }, sig }); };
  return <div className="pp-contract">
    <label className="chk"><input type="checkbox" checked={sig} onChange={e => setSig(e.target.checked)} /> Worker and company signatures on the contract</label>
    <button type="button" className="btn" onClick={go} title={T ? "Make the employment contract" : "Only Qatar has a contract form now"}><LuSignature /> Generate Employment Contract</button>
  </div>;
}
const blank = (k = Math.random().toString(36).slice(2), country = "") => ({ k, name: "", passport: "", country, gender: "", ref: "", agentId: "", bmet: {}, job: {} });
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
    <AgentDatalist id="pp-ref-agents" />
    <div className="row6 mt8"><button type="button" className="btn sm" onClick={() => { const l = rows[rows.length - 1]; setRows([...rows, blank(undefined, l.country)]); }}><LuPlus /> Add another passport</button></div>
    <div className="mt14 pp-save-row"><button className="btn pri" disabled={busy}>{rows.length > 1 ? `Save ${rows.length} passports` : "Save passport"}</button>
      {rows.length === 1 && <ContractBar v={rows[0]} id={passports().find(p => p.passport === rows[0].passport.replace(/\s+/g, ""))?.id} />}</div>
  </form>;
}
function EditRow({ p, onDone }) {
  const [v, setV] = React.useState({ name: p.name, passport: p.passport, country: p.country, gender: p.gender, ref: p.ref || "", agentId: p.agentId || "", bmet: { ...(p.bmet || {}) }, job: { ...(p.job || {}) },
    ppCopyRef: p.ppCopy ? { ...p.ppCopy, data: `/api/files/${p.ppCopy.id}` } : null });
  const save = async () => { const { ppCopyRef, ...rest } = v; if (await act("admin.passport", { op: "update", id: p.id, ...rest })) onDone(); };
  return <tr className="sel"><td colSpan={13}><div className="fgrid pp-edit"><Fields v={v} set={x => setV({ ...v, ...x })} />
    <AgentDatalist id="pp-ref-agents" />
    <div className="full row6 pp-save-row"><button type="button" className="btn sm pri" onClick={save}><LuCheck /> Save</button><button type="button" className="btn sm" onClick={onDone}><LuX /> Cancel</button>
      <ContractBar v={v} id={p.id} /></div></div></td></tr>;
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
