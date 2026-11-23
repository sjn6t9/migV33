// Pre EC Check: the agency's RAIMS account checks a passport (BMET registration, finger, availability, alerts).
// Admin/staff with the BMET clearance permission, and agents, can use it.
import React from "react";
import { LuSearch, LuTriangleAlert, LuShieldCheck, LuX, LuCircleCheck, LuCircleX, LuListPlus, LuDownload, LuSend, LuFileCheck, LuCirclePlus } from "react-icons/lu";
import { CountrySelect, agentsList } from "./Passports.jsx";
import { AgentDatalist } from "./AgentBook.jsx";
import { AgentPreEcLog } from "./AgentHistory.jsx";
import { store } from "../store.js";
import { act, toast, readUpload } from "../actions.js";
import { Field, ClCountryOptions } from "./shared.jsx";

const rawDl = async () => { const r = await act("admin.raims", { op: "rawPage" }); if (!r?.html) return; const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([r.html], { type: /^\s*[{[]/.test(r.html) ? "application/json" : "text/html" })); a.download = /^\s*[{[]/.test(r.html) ? "raims-pre-ec.json" : "raims-pre-ec.html"; document.body.appendChild(a); a.click(); a.remove(); };
const good = v => /^(success|available|yes|valid|verified|active|eligible|ok|passed)$/i.test(String(v).trim());
const bad = v => /^(fail(ed)?|not available|unavailable|no|invalid|expired|blocked|ineligible|not found|pending)$/i.test(String(v).trim());

/* the worker's name: Name, or Bangali Name when RAIMS shows only that */
const entryName = res => res?.entry?.name || ((res?.fields || []).find(([k, v]) => /^(name|bangali name|bangla name|employee name|full name)$/i.test(k) && v) || [])[1] || "";
/* Add to Entry List: the checked person goes to Passport Entry › BMET Passport Entry with the RAIMS details */
function AddToEntry({ res }) {
  const ags = agentsList();
  const have = (store.S.passports || []).find(p => p.passport === res.passport);
  const [v, setV] = React.useState({ country: have?.country || "", ref: have?.ref || "", agentId: have?.agentId || "", gender: res.entry.gender || have?.gender || "" });
  const [busy, setBusy] = React.useState(false), [done, setDone] = React.useState(res.inList);
  const add = async () => {
    if (!v.country) return toast("Choose the country.");
    if (!v.gender) return toast("Choose Male or Female.");
    const row = { name: res.entry.name, passport: res.passport, country: v.country, gender: v.gender, ref: v.ref, agentId: v.agentId, bmet: res.entry.bmet };
    setBusy(true);
    const old = (store.S.passports || []).find(p => p.passport === res.passport && (p.lists || []).includes("bmet"));
    const r = old ? await act("admin.passport", { op: "update", id: old.id, ...row }) : await act("admin.passport", { op: "add", list: "bmet", rows: [row] });
    setBusy(false); if (r) setDone(true);
  };
  return <div className="preec-add">
    <b><LuListPlus /> Add to Entry List</b> <span className="muted small">{done ? "In Passport Entry › BMET Passport Entry. Adding again updates the details." : "Goes to Passport Entry › BMET Passport Entry with these details."}</span>
    <div className="fgrid mt8">
      <Field label="Country *"><CountrySelect value={v.country} onChange={c => setV({ ...v, country: c })} /></Field>
      {!res.entry.gender && <Field label="Male/Female *"><select value={v.gender} onChange={e => setV({ ...v, gender: e.target.value })}><option value="">Select</option><option>Male</option><option>Female</option></select></Field>}
      <Field label="Ref. / Agent"><input type="text" list="preec-agents" value={v.ref} maxLength={120} placeholder="Agent or reference" onChange={e => { const a = ags.find(x => x.name === e.target.value); setV({ ...v, ref: e.target.value, agentId: a ? a.id : "" }); }} /><AgentDatalist id="preec-agents" /></Field>
    </div>
    <button type="button" className="btn pri mt8" disabled={busy} onClick={add}><LuListPlus /> {busy ? "Adding…" : done ? "Update in Entry List" : "Add to Entry List"}</button>
  </div>;
}
/* agent: a clean Pre EC result (nothing red) → Apply BMET Clearance → country + documents → Submit Application.
   The file goes to the agency's Applications › Clearance applications (Received, then Send to BMET). */
function ApplyClearance({ res, onDone }) {
  const [open, setOpen] = React.useState(false), [busy, setBusy] = React.useState(false);
  const name = entryName(res), pp = res.passport;
  const C = store.S.clearances || [], W = store.S.workers || [];
  const w = W.find(x => String(x.passport || "").replace(/\s+/g, "").toUpperCase() === pp);
  const openFile = w && C.find(c => c.workerId === w.id && c.status !== "rejected");
  if (openFile) return <p className="small mt10 preec-ok"><LuFileCheck /> {`${name || pp} already has a BMET clearance file.`}</p>;
  const submit = async e => {
    e.preventDefault(); const fd = new FormData(e.currentTarget), pick = n => { const f = fd.get(n); return f && f.size ? f : null; };
    if (!fd.get("country")) return toast("Select a country.");
    if (!pick("passport") || !pick("visa")) return toast("Upload the passport copy and visa copy.");
    const others = fd.getAll("others").filter(f => f && f.size); if (others.length > 3) return toast("Upload at most 3 other documents.");
    setBusy(true);
    try {
      const up = f => readUpload(f, { imageMax: 1800 });
      const files = { passport: await up(pick("passport")), visa: await up(pick("visa")), contract: pick("contract") ? await up(pick("contract")) : null, others: await Promise.all(others.map(up)) };
      const r = await act("agent.clearance", { ...(w ? { workerId: w.id } : { newWorker: { name: name || pp, passport: pp, phone: res.entry?.bmet?.mobile || "" } }), country: fd.get("country"), files, preEc: { bmet: res.entry?.bmet || {} } });
      if (r) { setOpen(false); onDone?.(); }
    } catch (err) { toast(err.message); } finally { setBusy(false); }
  };
  if (!open) return <div className="preec-apply mt10"><p className="small preec-ok"><LuCircleCheck /> Nothing to fix on BMET. You can apply for BMET clearance.</p>
    <button type="button" className="btn pri" onClick={() => setOpen(true)}><LuSend /> Apply BMET Clearance</button></div>;
  return <form className="card fgrid mt10 preec-apply-form" onSubmit={submit} noValidate>
    <h4 className="full">{`Apply BMET Clearance · ${name || pp}`}</h4>
    <Field label="Country *" full><select name="country" defaultValue=""><option value="">Select country</option><ClCountryOptions /></select></Field>
    <Field label="Passport copy *" hint="PDF or JPG"><input type="file" name="passport" accept=".pdf,image/*" /></Field>
    <Field label="Visa copy *" hint="PDF or JPG"><input type="file" name="visa" accept=".pdf,image/*" /></Field>
    <Field label="Employment contract (optional)"><input type="file" name="contract" accept=".pdf,image/*" /></Field>
    <Field label="Other documents (optional)" hint="Up to 3 files"><input type="file" name="others" accept=".pdf,image/*" multiple /></Field>
    <div className="row full"><button className="btn pri" disabled={busy}><LuSend /> {busy ? "Submitting…" : "Submit Application"}</button><button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button></div>
  </form>;
}

export function PreEcCheck({ onClose, onManual }) {
  const me = (store.S.users || []).find(x => x.id === store.S.session), canAdd = me && me.role !== "agent" && store.S.passports !== undefined;
  const [f, setF] = React.useState({ returnee: "no", other: "", passport: "" });
  const [busy, setBusy] = React.useState(false), [res, setRes] = React.useState(null), [failed, setFailed] = React.useState(false);
  const ready = store.S.raimsReady ?? !!store.S.raims?.saved;
  const go = async e => {
    e?.preventDefault(); const pp = f.passport.replace(/\s+/g, "").toUpperCase();
    if (pp.length < 6) return toast("Enter the passport number.");
    if (f.returnee === "other" && f.other.replace(/\s+/g, "").length < 6) return toast("Enter the returnee's other passport number.");
    setBusy(true); setRes(null); setFailed(false); const r = await act("raims.preEc", { passport: pp, returnee: f.returnee, otherPassport: f.other.replace(/\s+/g, "").toUpperCase() }, { quiet: true }); setBusy(false);
    if (r) setRes(r); else setFailed(true);
  };
  return <div className="card preec">
    <div className="row between"><h3 className="bulk-h"><LuShieldCheck /> {me?.role === "agent" ? "Check & Application" : "Pre EC Check"}</h3>{onClose && <button type="button" className="btn sm link" onClick={onClose} aria-label="Close"><LuX /></button>}</div>
    {!ready ? <p className="muted small">{me?.role === "agent" ? "BMET could not be checked right now. Please try again in a few minutes." : "The admin has not signed in to RAIMS yet (BMET clearance › RAIMS)."}</p> : <form className="fgrid" onSubmit={go} noValidate>
      <Field label="Has returnee? *" full><select value={f.returnee} onChange={e => setF({ ...f, returnee: e.target.value })}><option value="no">No</option><option value="same">Returnee with same passport</option><option value="other">Returnee with other passport</option></select></Field>
      {f.returnee === "other" && <Field label="Returnee other passport no. *" full><input type="text" value={f.other} maxLength={15} autoCapitalize="characters" autoCorrect="off" spellCheck={false} onChange={e => setF({ ...f, other: e.target.value.toUpperCase() })} placeholder="Passport no" /></Field>}
      <Field label="Passport number *" full><div className="preec-pp"><input type="text" value={f.passport} maxLength={15} autoCapitalize="characters" autoCorrect="off" spellCheck={false} onChange={e => setF({ ...f, passport: e.target.value.toUpperCase() })} placeholder="A12345678" />
        <button className="btn pri" disabled={busy}><LuSearch /> {busy ? "Checking…" : "Search"}</button></div></Field>
    </form>}
    {res && (res.ok ? <div className="preec-res">
      <h4 className="mt14 mb6">Employee information</h4>
      {res.alerts.map((a, i) => <div key={i} className="preec-alert"><LuTriangleAlert /> <span data-notr>{a}</span></div>)}
      {me?.role === "agent" && res.fields.every(([, v]) => !bad(v)) && !res.alerts.length && <ApplyClearance res={res} onDone={() => setRes(null)} />}
      {canAdd && entryName(res) && <AddToEntry res={{ ...res, entry: { ...(res.entry || {}), name: entryName(res), bmet: res.entry?.bmet || {} } }} />}
      <div className="preec-grid">{res.fields.map(([k, v], i) => <div key={i} className={`preec-f${good(v) ? " ok" : bad(v) ? " bad" : ""}`}><span>{k}</span><b data-notr dir="auto">{good(v) ? <LuCircleCheck /> : bad(v) ? <LuCircleX /> : null}{v || "—"}</b></div>)}</div>
      {store.S.users?.find(x => x.id === store.S.session)?.role === "admin" && <button type="button" className="btn sm link mt8" onClick={rawDl}><LuDownload /> RAIMS data (for checking)</button>}
    </div> : <div className="mt10"><p className="vf-err small">{res.problem}</p>
      {(res.page || res.tried) && <details className="vf-det small" open><summary>What RAIMS showed</summary>{(res.tried || []).map((t, i) => <p key={i} className="muted" data-notr>{t}</p>)}<p className="muted" data-notr>{res.page}</p></details>}</div>)}
    {/* agents: when BMET (RAIMS) cannot be checked or reached, they apply by hand */}
    {onManual && me?.role === "agent" && (!ready || failed || (res && !res.ok && res.canManual)) && <div className="preec-manual mt10">
      {failed && <p className="vf-err small">BMET could not be checked right now. Please try again in a few minutes.</p>}
      <p className="muted small">You can still apply: fill in the worker and documents yourself.</p>
      <button type="button" className="btn dark" onClick={onManual}><LuCirclePlus /> Create New Application Manually</button></div>}
    {canAdd && <AgentPreEcLog />}
  </div>;
}
