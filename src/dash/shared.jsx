import React from "react";
import { LuEye, LuCheck, LuX, LuTrash2, LuUpload, LuSend, LuDownload, LuCamera, LuFileText, LuIdCard, LuFileBadge } from "react-icons/lu";
import { store, num, fdate, kb, bdtFmt, candOf, clPerson, job, STAGES, LABEL, CARD_TYPES, COUNTRIES, CATS, TYPES, BENEFITS } from "../store.js";
import { openModal, setAppStatus, confirmPayment, confirmBox, toast, downloadFile, cardFileName, formData, act } from "../actions.js";
import { Pill, Empty, Avatar } from "../ui.jsx";
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
export const Options = ({ list, blank }) => <>{blank !== undefined && <option value="">{blank}</option>}{list.map(v => Array.isArray(v) ? <option key={v[0]} value={v[0]}>{v[1]}</option> : <option key={v}>{v}</option>)}</>;

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
      <form className="fgrid" onSubmit={send}>
        <Field label={c.card ? "Replace card file" : "Upload Clearance Card"} hint="PDF, JPG or WebP, up to 1.5 MB"><input type="file" name="card" accept={CARD_TYPES} required /></Field>
        {!c.card && <Field label="Card fee (BDT)" hint={p.kind === "agent" ? "Added to the agent's account statement" : "Shown to the job seeker; mark it received when paid"}><input type="number" name="fee" min="0" defaultValue="0" /></Field>}
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
export function JobFields({ j }) {
  return <>
    <Field label="Job title"><input type="text" name="title" defaultValue={j.title} required /></Field>
    <Field label="Industry"><select name="category" defaultValue={j.category}><Options list={CATS} /></select></Field>
    <Field label="Country"><select name="country" defaultValue={j.country}><Options list={Object.keys(COUNTRIES)} /></select></Field>
    <Field label="City"><input type="text" name="city" defaultValue={j.city} required /></Field>
    <Field label="Salary from (local currency / month)"><input type="number" name="salaryMin" min="0" defaultValue={j.salaryMin} required /></Field>
    <Field label="Salary to"><input type="number" name="salaryMax" min="0" defaultValue={j.salaryMax} required /></Field>
    <Field label="Job type"><select name="type" defaultValue={j.type}><Options list={TYPES} /></select></Field>
    <Field label="Minimum experience (years)"><input type="number" name="experience" min="0" defaultValue={j.experience} /></Field>
    <Field label="Contract length (years)"><input type="number" name="contract" min="1" defaultValue={j.contract} /></Field>
    <Field label="Vacancies"><input type="number" name="vacancies" min="1" defaultValue={j.vacancies} /></Field>
    <Field label="Age limit"><input type="text" name="age" defaultValue={j.age} /></Field>
    <Field label="Application deadline"><input type="date" name="deadline" defaultValue={j.deadline} /></Field>
    <fieldset className="plain full"><legend className="small b">Benefits</legend><div className="row">{BENEFITS.map(b => <label key={b} className="check"><input type="checkbox" name="benefits" value={b} defaultChecked={j.benefits.includes(b)} /> {b}</label>)}</div></fieldset>
    <Field label="Job description" full><textarea name="description" defaultValue={j.description} required /></Field>
    <Field label="Requirements" full><textarea name="requirements" defaultValue={j.requirements} /></Field>
  </>;
}
