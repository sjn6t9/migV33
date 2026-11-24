import React from "react";
import { LuPlus, LuPencil, LuRotateCcw, LuEye, LuCheck, LuX, LuTrash2, LuUpload, LuSend, LuDownload, LuCamera, LuFileText, LuIdCard, LuFileBadge, LuShieldCheck, LuSearch } from "react-icons/lu";
import { store, num, fdate, kb, bdtFmt, candOf, clPerson, job, STAGES, LABEL, CARD_TYPES, COUNTRIES, CATS, TYPES, BENEFITS, HOURLY } from "../store.js";
import { openModal, setAppStatus, confirmPayment, confirmBox, toast, downloadFile, cardFileName, formData, act } from "../actions.js";
import { Pill, Empty, Avatar } from "../ui.jsx";
import { descriptionFor, requirementsFor, toLines, PASSPORT_LINE, TERM_BENEFITS } from "../jobtpl.js";
import { HOURS_PER_DAY, CL_REGIONS } from "../constants.js";
import { readUpload, fileExt } from "../actions.js";

export function NotifPanel({ u }) {
  const N = store.S.notifications.filter(n => n.uid === u.id);
  const readAll = () => act("notif.readAll", {}, { quiet: true });
  return (
    <>
      <div className="row between"><h2>Notifications</h2>{N.some(n => !n.read) && <button className="btn sm" onClick={readAll}><LuCheck /> Mark all as read</button>}</div>
      <div className="card">{N.length ? N.map(n => (
        <div key={n.id} className="notif">{!n.read && <span className="count">new</span>}<div><div>{n.text}</div><div className="muted small">{fdate(n.at)}</div></div></div>
      )) : <Empty>No notifications.</Empty>}</div>
    </>
  );
}

export function StatusSelect({ a }) {
  return (
    <select className="auto slim" value={a.status} onChange={e => setAppStatus(a.id, e.target.value)} aria-label="Change status">
      {[...STAGES, "rejected"].map(s => <option key={s} value={s}>{LABEL[s]}</option>)}
    </select>
  );
}

export function ApplicantTable({ list, full }) {
  if (!list.length) return <Empty>No applicants yet.</Empty>;
  return (
    <div className="tbl"><table><thead><tr><th>Candidate</th><th>Job</th><th>Experience</th><th>CV</th><th>Status</th>{full && <th></th>}</tr></thead><tbody>
      {list.map(a => {
        const c = candOf(a); const j = job(a.jobId) || { title: "—" }; const p = c.profile || {};
        return (
          <tr key={a.id}>
            <td><div className="row tight nowrap"><Avatar name={c.name} src={p.photo?.data} size={34} /><div><b>{c.name}</b><div className="muted small">{p.trade}{p.district ? ` · ${p.district}` : ""}{c.via ? ` · via agent ${c.via}` : ""}</div></div></div></td>
            <td>{j.title}</td><td className="num">{p.experience === "" || p.experience == null ? "—" : `${p.experience} yr`}</td>
            <td>{p.cv || c.via ? <button className="btn sm" onClick={() => openModal("cand", { aid: a.id })}><LuEye /> {p.cv ? "View CV" : "Details"}</button> : <span className="muted small">None</span>}</td>
            <td>{full ? <StatusSelect a={a} /> : <Pill s={a.status} />}</td>
            {full && <td><button className="btn sm link" onClick={() => openModal("cand", { aid: a.id })}>Profile</button></td>}
          </tr>
        );
      })}
    </tbody></table></div>
  );
}

/* Agent account statement with running balance (confirmed entries only) */
export function LedgerTable({ agentId, admin }) {
  const L = store.S.ledger.filter(l => l.agentId === agentId).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  if (!L.length) return <Empty>No entries yet.</Empty>;
  let run = 0;
  const del = id => confirmBox("Delete this statement entry?", () => act("admin.ledgerDelete", { id }), "Delete");
  return (
    <div className="tbl"><table className="ledger"><thead><tr><th>Date</th><th>Description</th><th>Charge (BDT)</th><th>Payment (BDT)</th><th>Balance due</th><th>Status</th>{admin && <th></th>}</tr></thead><tbody>
      {L.map(l => {
        const ok = l.status === "confirmed"; if (ok) run += (l.type === "charge" ? 1 : -1) * Number(l.amount);
        return (
          <tr key={l.id} className={ok ? "" : "dim"}>
            <td>{fdate(l.date)}</td>
            <td>{l.desc}{l.method && <div className="muted small">{l.method}{l.ref ? ` · Ref ${l.ref}` : ""}</div>}</td>
            <td className="num dr">{l.type === "charge" ? num(l.amount) : ""}</td>
            <td className="num cr">{l.type === "payment" ? num(l.amount) : ""}</td>
            <td className="num">{ok ? num(run) : "—"}</td>
            <td><Pill s={l.status} /></td>
            {admin && <td><div className="row tight nowrap">
              {l.status === "pending" && <><button className="btn sm pri" onClick={() => confirmPayment(l.id, true)}><LuCheck /> Confirm</button><button className="btn sm danger" onClick={() => confirmPayment(l.id, false)}><LuX /> Reject</button></>}
              <button className="btn sm link danger" onClick={() => del(l.id)} aria-label="Delete entry"><LuTrash2 /></button>
            </div></td>}
          </tr>
        );
      })}
    </tbody></table></div>
  );
}

export const Field = ({ label, hint, children, full }) => <label className={`f${full ? " full" : ""}`}>{label}{children}{hint && <span className="hint">{hint}</span>}</label>;
/* country options for BMET clearance forms: our destinations, then Middle East, Asia, Europe and Oceania */
export const ClCountryOptions = () => { const ours = Object.keys(COUNTRIES); return <><optgroup label="Our destinations">{ours.map(c => <option key={c}>{c}</option>)}</optgroup>
  {CL_REGIONS.map(([g, L]) => <optgroup key={g} label={g}>{L.filter(c => !ours.includes(c)).map(c => <option key={c}>{c}</option>)}</optgroup>)}</>; };
export const Options = ({ list, blank }) => <>{blank !== undefined && <option value="">{blank}</option>}{list.map(v => Array.isArray(v) ? <option key={v[0]} value={v[0]}>{v[1]}</option> : <option key={v}>{v}</option>)}</>;

/* The clearance card from RAIMS by its card number (IT-I-2026-6009034): the server takes it from
   raims.oep.gov.bd/agency/employee/clearance-check/download/card/<number> with the agency's RAIMS sign-in */
function RaimsCard({ c, who }) {
  // no Clearance ID to type: the server checks RAIMS Clearance Check with the file's passport and takes the card from there
  const [fee, setFee] = React.useState("0"), [busy, setBusy] = React.useState("");
  const run = async op => {
    setBusy(op); const r = await act("admin.clRaimsCard", { id: c.id, no: c.cardNo || "", op, fee: Number(fee || 0) }, op === "download" ? { quiet: true } : undefined); setBusy("");
    if (op === "download" && r?.file) downloadFile(r.file.data, r.file.name);
  };
  return <div className="raims-card">
    <b><LuShieldCheck /> Clearance card from RAIMS</b>
    <p className="muted small">{c.cardNo ? <>Clearance ID <b data-notr>{c.cardNo}</b> (from RAIMS Clearance Check).</> : "The card is found in RAIMS Clearance Check by the worker's passport number."}</p>
    {!(c.card?.fee > 0) && <div className="raims-card-row"><label className="f">Card fee (BDT)<input type="number" min="0" value={fee} onChange={e => setFee(e.target.value)} /></label></div>}
    <div className="row tight wrap">
      <button type="button" className="btn" disabled={!!busy} onClick={() => run("download")}><LuDownload /> {busy === "download" ? "Getting…" : "Download Card"}</button>
      <button type="button" className="btn pri" disabled={!!busy} onClick={() => run("send")}><LuSend /> {busy === "send" ? "Sending…" : c.card ? "Send Card again" : "Send Card"}</button>
      {c.cardNo && <a className="btn sm link" href={`https://raims.oep.gov.bd/agency/employee/clearance-check/download/card/${encodeURIComponent(c.cardNo)}`} target="_blank" rel="noopener noreferrer">Open in RAIMS</a>}
    </div>
    <p className="muted small">Send Card puts the card in the {who}'s portal to download.</p>
  </div>;
}

/* Admin: upload the BMET clearance card for an approved file, set the card fee and send it to the agent or job seeker */
export function CardAdmin({ c }) {
  const p = clPerson(c); const who = p.kind === "agent" ? `agent (${p.via})` : "job seeker";
  if (c.status !== "approved") return <p className="muted small">The Upload Clearance Card option appears when the status is Approved.</p>;
  const send = async e => {
    const [d, fd] = formData(e); const form = e.currentTarget; const f = fd.get("card");
    if (!f || !f.size) return toast("Choose the clearance card file first.");
    let file; try { file = await readUpload(f, { imageMax: 2000 }); } catch (err) { return toast(err.message); }
    const r = await act("admin.card", { id: c.id, file, fee: Number(d.fee || 0) }); if (r) form.reset();
  };
  return (
    <div className="card-admin stack8">
      {c.card ? (
        <div className="notice ok cardbox">
          <span><b>Card sent</b> {fdate(c.card.sentAt)} · {c.card.name} ({kb(c.card.size)}){Number(c.card.fee) > 0 && <> · Fee {bdtFmt(c.card.fee)}</>}</span>
          <div className="row tight">
            <button type="button" className="btn sm" onClick={() => downloadFile(c.card.data, cardFileName(c))}><LuDownload /> Download</button>
            {p.kind === "candidate" && Number(c.card.fee) > 0 && <label className="check small"><input type="checkbox" checked={!!c.card.feePaid} onChange={e => act("admin.cardFeePaid", { id: c.id, v: e.target.checked })} /> Fee received</label>}
          </div>
        </div>
      ) : <div className="notice">Approved. Upload the clearance card and send it to the {who}.</div>}
      <RaimsCard c={c} who={p.kind === "agent" ? "agent" : "job seeker"} />
      <form className="fgrid" onSubmit={send}>
        <Field label={c.card ? "Replace card file" : "Upload Clearance Card"} hint="PDF, JPG or WebP, up to 1.5 MB"><input type="file" name="card" accept={CARD_TYPES} required /></Field>
        {!(c.card?.fee > 0) && <Field label="Card fee (BDT)" hint={p.kind === "agent" ? "Added to the agent's account statement" : "Shown to the job seeker; mark it received when paid"}><input type="number" name="fee" min="0" defaultValue="0" /></Field>}
        <div className="full"><button className="btn pri" type="submit"><LuSend /> {c.card ? "Replace & notify" : `Upload & send to ${p.kind === "agent" ? "agent" : "job seeker"}`}</button></div>
      </form>
    </div>
  );
}

/* Agent KYC documents: photo, NID, trade licence */
export const AGENT_DOCS = [
  ["photo", "Photo", LuCamera, "A clear face photo.", true],
  ["nid", "NID", LuIdCard, "Both sides of the National ID card. PDF or JPG.", false],
  ["tradeLicense", "Trade License", LuFileBadge, "Current trade licence of your office. PDF or JPG.", false]
];
export function AgentDocUploads({ u }) {
  const ag = { ...u.agent, docs: u.agent?.docs || {} };
  const up = (key, photo) => async e => {
    const f = e.target.files[0]; const input = e.target; if (!f) return;
    try { const file = await readUpload(f, photo ? { imageMax: 480, photo: true } : { imageMax: 1800 }); await act("agent.upload", { key, file }); }
    catch (err) { toast(err.message); }
    input.value = "";
  };
  return (
    <div className="grid g3">
      {AGENT_DOCS.map(([k, label, Icon, hint, photo]) => {
        const f = ag.docs[k];
        return (
          <div className="card stack8 upcard" key={k}>
            <h4><Icon /> {label}</h4>
            {photo ? <div className="row"><Avatar name={u.name} src={f?.data} size={72} /><span className="muted small">{f ? "Photo uploaded" : hint}</span></div>
              : f ? <div className="small"><b>{f.name}</b> · {kb(f.size)}</div> : <span className="muted small">{hint}</span>}
            <label className="btn sm"><LuUpload /> {f ? `Replace ${label}` : `Upload ${label}`}<input type="file" accept={photo ? "image/*" : DOC_TYPES_LOCAL} hidden onChange={up(k, photo)} /></label>
            {f && !photo && <button className="btn sm" onClick={() => downloadFile(f.data, `${label.replace(/\s+/g, "-")}-${u.agent.business.replace(/[^\w-]/g, "")}.${fileExt(f)}`)}><LuDownload /> Download</button>}
            {f && <button className="btn sm link danger" onClick={() => act("agent.removeDoc", { key: k })}>Remove</button>}
          </div>
        );
      })}
    </div>
  );
}
const DOC_TYPES_LOCAL = ".pdf,.jpg,.jpeg,.png,.webp";
export function AgentDocsView({ u }) {
  const docs = u.agent?.docs || {};
  return (
    <>
      <div className="row"><Avatar name={u.name} src={docs.photo?.data} size={64} /><div><h3>{u.agent?.business}</h3><div className="muted small">{u.name} · {u.agent?.phone} · {u.email}</div><Pill s={u.status} /></div></div>
      <table className="mt14"><tbody>{[["District", u.agent?.district], ["Office address", u.agent?.address], ["Registered", fdate(u.created)]].map(([k, v]) => <tr key={k}><th>{k}</th><td>{v || "—"}</td></tr>)}</tbody></table>
      <h4 className="mt16 mb6">Documents</h4>
      <div className="stack8">{AGENT_DOCS.map(([k, label, Icon]) => { const f = docs[k]; return (
        <div key={k} className="row between filerow"><span><Icon /> <b>{label}</b> <span className="muted small">{f ? `${f.name} · ${kb(f.size)}` : "Not uploaded"}</span></span>
          {f && <button className="btn sm" onClick={() => downloadFile(f.data, `${label.replace(/\s+/g, "-")}-${(u.agent?.business || "agent").replace(/[^\w-]/g, "")}.${fileExt(f)}`)}><LuDownload /> Download</button>}</div>); })}</div>
    </>
  );
}

/* the job fields shared by the employer's and the admin's job forms */
export const blankJob = (country = "Saudi Arabia", category = "Construction") => ({ title: "", city: "", salaryMin: "", salaryMax: "", description: "", requirements: "", benefits: [], type: "Contract", contract: 2, experience: 0, vacancies: 10, age: "21–40", country, category, deadline: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) });
export function JobFields({ j, templates = false }) {
  const [country, setCountry] = React.useState(j.country);
  const hourly = HOURLY.includes(country); const cur = COUNTRIES[country];
  const r = { title: React.useRef(), cat: React.useRef(), desc: React.useRef(), req: React.useRef(), contract: React.useRef() };
  const auto = React.useRef({ title: "", desc: "", req: "" }); // what the template last wrote
  const [tid, setTid] = React.useState("");
  const [edit, setEdit] = React.useState(null); // null | "new" | template id
  const list = store.S.jobTemplates || [];
  const edited = () => {
    const d = r.desc.current.value.trim(), q = r.req.current.value.trim();
    return (d && d !== auto.current.desc.trim()) || (q && q !== auto.current.req.trim());
  };
  const apply = (id, ctry, onlyTerms) => {
    const t = (store.S.jobTemplates || []).find(x => x.id === id); if (!t) return;
    if (ctry === "Fiji" && r.contract.current && !onlyTerms) r.contract.current.value = "3"; // Fiji contracts run 3 years
    const desc = descriptionFor(t, ctry, r.contract.current?.value), req = requirementsFor(t);
    r.desc.current.value = desc; auto.current.desc = desc;
    if (!onlyTerms) {
      r.req.current.value = req; auto.current.req = req;
      const ti = r.title.current; if (!ti.value.trim() || ti.value === auto.current.title) { ti.value = t.name; auto.current.title = t.name; }
      if (t.category && CATS.includes(t.category)) r.cat.current.value = t.category;
    } else auto.current.req = r.req.current.value;
    const form = r.desc.current.form;
    (TERM_BENEFITS[ctry] || []).forEach(b => { const box = form?.querySelector(`input[name="benefits"][value="${b}"]`); if (box) box.checked = true; });
  };
  const pick = id => {
    if (!id) { setTid(""); return; }
    const go = () => { setTid(id); apply(id, country); };
    edited() ? confirmBox("Replace the job description and requirements you edited with this job's template?", go, "Replace") : go();
  };
  const changeCountry = c => {
    setCountry(c);
    if (!tid) return;
    const d = r.desc.current.value.trim();
    if (!d || d === auto.current.desc.trim()) apply(tid, c, true);
    else confirmBox(`Update the benefits in the job description for ${c}? Your other edits in the description will be replaced.`, () => apply(tid, c, true), "Update");
  };
  const del = () => { const t = list.find(x => x.id === tid); if (t) confirmBox(`Remove “${t.name}” from the job list? Jobs already posted are not changed.`, async () => { if (await act("admin.jobTemplate", { op: "delete", id: tid })) setTid(""); }, "Remove"); };
  return <>
    {templates && <div className="full jobtpl">
      <div className="row">
        <Field label="Job (profession)" hint="Fills the job title, description and requirements. You can still edit them before posting.">
          <select value={tid} onChange={e => pick(e.target.value)}><option value="">Choose a job…</option>{list.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
        <div className="row tight jobtpl-btns">
          <button type="button" className="btn sm" onClick={() => setEdit("new")}><LuPlus /> Add job</button>
          {tid && <button type="button" className="btn sm" onClick={() => setEdit(tid)}><LuPencil /> Edit template</button>}
          {tid && <button type="button" className="btn sm" onClick={() => apply(tid, country)}><LuRotateCcw /> Reset text</button>}
          {tid && <button type="button" className="btn sm danger" onClick={del} aria-label="Remove template"><LuTrash2 /></button>}
        </div>
      </div>
      {edit && <TemplateEditor t={edit === "new" ? null : list.find(x => x.id === edit)} onClose={() => setEdit(null)}
        onSaved={id => { setEdit(null); setTid(id); const go = () => apply(id, country); edited() ? confirmBox("Put this job's template into the job description and requirements? Your edits there will be replaced.", go, "Replace") : go(); }} />}
    </div>}
    <Field label="Job title"><input type="text" name="title" ref={r.title} defaultValue={j.title} required /></Field>
    <Field label="Industry"><select name="category" ref={r.cat} defaultValue={j.category}><Options list={CATS} /></select></Field>
    <Field label="Country"><select name="country" value={country} onChange={e => changeCountry(e.target.value)}><Options list={Object.keys(COUNTRIES)} /></select></Field>
    <Field label="City"><input type="text" name="city" defaultValue={j.city} required /></Field>
    {hourly
      ? <Field label={`Hourly wage from (${cur} / hour)`} hint="Fiji wages are paid per hour, e.g. 5.5"><input type="number" name="salaryMin" min="0" max="500" step="0.01" defaultValue={j.period === "hour" ? j.salaryMin : ""} key="hmin" required /></Field>
      : <Field label={`Salary from (${cur} / month)`}><input type="number" name="salaryMin" min="0" step="any" defaultValue={j.period === "hour" ? "" : j.salaryMin} key="mmin" required /></Field>}
    {hourly
      ? <Field label={`Hourly wage to (${cur} / hour)`} hint="e.g. 6.5"><input type="number" name="salaryMax" min="0" max="500" step="0.01" defaultValue={j.period === "hour" ? j.salaryMax : ""} key="hmax" required /></Field>
      : <Field label={`Salary to (${cur} / month)`}><input type="number" name="salaryMax" min="0" step="any" defaultValue={j.period === "hour" ? "" : j.salaryMax} key="mmax" required /></Field>}
    <Field label="Job type"><select name="type" defaultValue={j.type}><Options list={TYPES} /></select></Field>
    <Field label="Minimum experience (years)"><input type="number" name="experience" min="0" defaultValue={j.experience} /></Field>
    <Field label="Contract length (years)"><input type="number" name="contract" min="1" ref={r.contract} defaultValue={j.contract} /></Field>
    <Field label="Vacancies"><input type="number" name="vacancies" min="1" defaultValue={j.vacancies} /></Field>
    <Field label="Age limit"><input type="text" name="age" defaultValue={j.age} /></Field>
    <Field label="Application deadline"><input type="date" name="deadline" defaultValue={j.deadline} /></Field>
    <Field label="Job status" hint="Shown on the job card; the border flashes in its colour"><select name="label" defaultValue={j.label || ""}><option value="">None</option><option value="urgent">Urgent (red)</option><option value="new">New (blue)</option><option value="upcoming">Upcoming (green)</option></select></Field>
    <fieldset className="plain full"><legend className="small b">Benefits</legend><div className="row">{BENEFITS.map(b => <label key={b} className="check"><input type="checkbox" name="benefits" value={b} defaultChecked={j.benefits.includes(b)} /> {b}</label>)}</div></fieldset>
    <Field label="Job description" full><textarea name="description" ref={r.desc} rows={templates ? 12 : undefined} defaultValue={j.description} required /></Field>
    <Field label="Requirements" full><textarea name="requirements" ref={r.req} rows={templates ? 6 : undefined} defaultValue={j.requirements} /></Field>
  </>;
}

/* add or edit a profession template (no <form>: it sits inside the job form) */
function TemplateEditor({ t, onClose, onSaved }) {
  const [v, setV] = React.useState(() => ({ name: t?.name || "", category: t?.category || "Construction", duties: (t?.duties || []).join("\n"), requirements: (t?.requirements || [PASSPORT_LINE]).join("\n") }));
  const set = k => e => setV({ ...v, [k]: e.target.value });
  const save = async () => {
    const res = await act("admin.jobTemplate", { op: t ? "update" : "add", id: t?.id, ...v, duties: toLines(v.duties), requirements: toLines(v.requirements) });
    if (res) onSaved(res.id || t?.id);
  };
  return (
    <div className="card jobtpl-edit fgrid" onKeyDown={e => { if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); save(); } }}>
      <h3 className="full">{t ? `Edit template: ${t.name}` : "Add a new job"}</h3>
      <Field label="Job name"><input type="text" value={v.name} onChange={set("name")} placeholder="e.g. Electrician" maxLength={60} /></Field>
      <Field label="Industry"><select value={v.category} onChange={set("category")}><Options list={CATS} /></select></Field>
      <Field label="Responsibilities" hint="One per line" full><textarea rows={4} value={v.duties} onChange={set("duties")} placeholder="Installation and repair of electrical wiring and fittings." /></Field>
      <Field label="Requirements" hint="One per line" full><textarea rows={4} value={v.requirements} onChange={set("requirements")} /></Field>
      <p className="muted small full">{`Working hours (${HOURS_PER_DAY} hours per day) and the benefits for the chosen country are added by themselves.`}</p>
      <div className="full row"><button type="button" className="btn pri" onClick={save}><LuCheck /> {t ? "Save template" : "Add job"}</button><button type="button" className="btn" onClick={onClose}>Cancel</button></div>
    </div>
  );
}
