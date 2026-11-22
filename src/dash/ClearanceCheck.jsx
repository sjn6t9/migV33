// RAIMS Clearance Check: passport number or Clearance ID → the clearance information as RAIMS shows it,
// with EC Card Download (…/clearance-check/download/card/<Clearance ID>) and Send Card to the file's agent.
import React from "react";
import { LuSearch, LuX, LuBadgeCheck, LuDownload, LuSend } from "react-icons/lu";
import { store } from "../store.js";
import { act, toast, downloadFile } from "../actions.js";
import { Field } from "./shared.jsx";

const ppOf = c => (store.S.workers || []).find(w => w.id === c.workerId)?.passport || (store.S.users || []).find(u => u.id === c.candidateId)?.profile?.passportNo || c.passport || "";
const SECTIONS = [["Clearance Information", ["Clearance Type", "Clearance Date", "Permit Id", "Visa No", "Visa Issue Date", "Visa Expire Date", "Country", "Post", "Employer Name", "Employer Address", "Agent Name", "Agent License No", "Agent Address", "Referral No", "Sponsor ID", "Passport Number", "Passport Issue Date", "Passport Expire Date"]],
  ["Personal Information", ["Father's Name", "Mother's Name", "NID Number", "Phone Number", "Present Address", "Permanent Address"]]];

export function ClearanceCheck({ onClose }) {
  const [by, setBy] = React.useState("passport"), [q, setQ] = React.useState(""), [busy, setBusy] = React.useState(""), [res, setRes] = React.useState(null);
  const ready = store.S.raimsReady ?? !!store.S.raims?.saved;
  const go = async e => {
    e?.preventDefault(); const v = q.replace(/\s+/g, "").toUpperCase();
    if (v.length < 6) return toast(by === "id" ? "Enter the Clearance ID, e.g. IT-I-2026-6009034." : "Enter the passport number.");
    setBusy("search"); setRes(null); const r = await act("raims.clearanceCheck", { q: v, by }, { quiet: true }); setBusy(""); if (r) setRes(r);
  };
  const val = k => (res?.fields || []).find(([x]) => x === k)?.[1] || "";
  const file = res?.ok && res.passport ? (store.S.clearances || []).find(c => ppOf(c).toUpperCase() === res.passport.toUpperCase()) : null;
  const dl = async () => { setBusy("dl"); const r = await act("raims.ecCard", { no: res.id || res.q }, { quiet: true }); setBusy(""); if (r?.file) downloadFile(r.file.data, r.file.name); };
  const send = async () => { setBusy("send"); await act("admin.clRaimsCard", { id: file.id, no: res.id, op: "send", fee: 0 }); setBusy(""); };
  return <div className="card preec cc">
    <div className="row between"><h3 className="bulk-h"><LuBadgeCheck /> Clearance Check</h3>{onClose && <button type="button" className="btn sm link" onClick={onClose} aria-label="Close"><LuX /></button>}</div>
    {!ready ? <p className="muted small">The admin has not signed in to RAIMS yet (BMET clearance › RAIMS).</p> : <form className="fgrid" onSubmit={go} noValidate>
      <Field label="Select Input Type *"><select value={by} onChange={e => setBy(e.target.value)}><option value="passport">Passport</option><option value="id">Clearance ID</option></select></Field>
      <Field label="Type Clearance ID or Passport Number *"><div className="preec-pp"><input type="text" value={q} maxLength={30} placeholder={by === "id" ? "IT-I-2026-6009034" : "A08621040"} autoCapitalize="characters" autoCorrect="off" spellCheck={false} onChange={e => setQ(e.target.value.toUpperCase())} />
        <button className="btn pri" disabled={!!busy}><LuSearch /> {busy === "search" ? "Checking…" : "Search"}</button></div></Field>
    </form>}
    {res && (res.ok ? <div className="cc-res">
      <h4 className="mt14 mb6">Clearance Information</h4>
      <div className="cc-head">{res.photo && <img className="cc-photo" src={res.photo} alt="" width="110" height="128" />}
        <div className="cc-top">{["Name", "BMET No", "Clearance ID"].filter(val).map(k => <p key={k}><span>{k}:</span> <b data-notr>{val(k)}</b></p>)}</div></div>
      {SECTIONS.map(([h, keys], i) => { const rows = keys.filter(val); return rows.length ? <React.Fragment key={h}>{i > 0 && <h4 className="mt14 mb6">{h}</h4>}
        <dl className="cc-grid">{rows.map(k => <div key={k}><dt>{k}</dt><dd data-notr>{val(k)}</dd></div>)}</dl></React.Fragment> : null; })}
      {res.id ? <div className="cc-actions">
        <button type="button" className="btn pri" disabled={!!busy} onClick={dl}><LuDownload /> {busy === "dl" ? "Getting…" : "EC Card Download"}</button>
        {file && file.status === "approved" && <button type="button" className="btn" disabled={!!busy} onClick={send}><LuSend /> {busy === "send" ? "Sending…" : file.card ? "Send Card again" : `Send Card to ${file.agentId ? "the agent" : "the job seeker"}`}</button>}
        <a className="btn sm link" href={`https://raims.oep.gov.bd/agency/employee/clearance-check/download/card/${encodeURIComponent(res.id)}`} target="_blank" rel="noopener noreferrer">Open in RAIMS</a>
        {file && file.status !== "approved" && <p className="muted small">The file {file.ref} is not Approved here yet; Send Card opens when it is.</p>}
        {!file && <p className="muted small">No BMET clearance file here has this passport.</p>}
      </div> : <p className="muted small mt10">RAIMS shows no Clearance ID for this yet.</p>}
    </div> : <div className="mt10"><p className="vf-err small">{res.problem}</p>
      {/^[A-Z]{1,4}-[A-Z]{1,3}-\d{4}-\d{4,}$/.test(res.q || "") && <div className="cc-actions"><button type="button" className="btn pri" disabled={!!busy} onClick={dl}><LuDownload /> {busy === "dl" ? "Getting…" : "EC Card Download"}</button>
        <a className="btn sm link" href={`https://raims.oep.gov.bd/agency/ec/application/${encodeURIComponent(res.q)}/card`} target="_blank" rel="noopener noreferrer">Open in RAIMS</a></div>}
      {res.tried && <details className="vf-det small" open><summary>What RAIMS showed</summary>{res.tried.map((t, i) => <p key={i} className="muted" data-notr>{t}</p>)}</details>}</div>)}
  </div>;
}
