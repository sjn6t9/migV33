import React from "react";
import { LuLayoutDashboard, LuUser, LuUsers, LuStamp, LuBriefcase, LuWallet, LuBell, LuPencil, LuTrash2, LuSend, LuPlus, LuEye, LuTicket, LuPlaneTakeoff } from "react-icons/lu";
import { store, commit, worker, job, live, money, fdate, bdtFmt, balanceOf, unread, now, COUNTRIES, CL_DOCS, PAY_METHODS } from "../store.js";
import { toast, formData, setTab, openModal, confirmBox, withdraw, readUpload, act, DOC_TYPES } from "../actions.js";
import { Rail, Tiles, Pill, Pipe, ClPipe, Empty, CardDownload, Avatar } from "../ui.jsx";
import { NotifPanel, LedgerTable, Field, Options, AgentDocUploads, AGENT_DOCS } from "./shared.jsx";

const ui = store.ui;
const open = c => !["approved", "rejected"].includes(c.status);

function ClRow({ c }) {
  const w = worker(c.workerId) || { name: "Removed worker" };
  return (
    <div className="listrow">
      <div className="row between"><div><b>{w.name}</b> <span className="muted small">· {w.passport} · {c.country}</span></div><Pill s={c.status} /></div>
      <ClPipe c={c} />
      {c.card && <div className="mt8"><CardDownload c={c} /></div>}
      {c.status === "approved" && !c.card && <p className="muted small mt6">Approved. The agency will send the clearance card here.</p>}
      <div className="row between mt6"><span className="muted small">Submitted {fdate(c.created)} · {c.files ? `${c.docs.length} file(s) uploaded` : `${c.docs.length} document(s)`}</span><button className="btn sm link" onClick={() => openModal("clearance", { cid: c.id })}><LuEye /> Details</button></div>
    </div>
  );
}
function AppRow({ a }) {
  const j = job(a.jobId); const w = worker(a.workerId) || { name: "Removed worker" }; if (!j) return null;
  return (
    <div className="listrow">
      <div className="row between"><div><b>{w.name}</b> <span className="muted small">→ <a href={`#job-${j.id}`}>{j.title}</a> · {j.city}, {j.country}</span></div><Pill s={a.status} /></div>
      <Pipe a={a} />
      <div className="row between mt6"><span className="muted small">Applied {fdate(a.appliedAt)}</span>{["applied", "shortlisted"].includes(a.status) && <button className="btn sm link danger" onClick={() => withdraw(a.id)}>Withdraw</button>}</div>
    </div>
  );
}

export function Agent({ u }) {
  const S = store.S; const t = ui.tab.agent; const ag = u.agent || {};
  const W = S.workers.filter(w => w.agentId === u.id);
  const C = S.clearances.filter(c => c.agentId === u.id).sort((a, b) => b.created.localeCompare(a.created));
  const A = S.applications.filter(a => a.agentId === u.id).sort((a, b) => b.appliedAt.localeCompare(a.appliedAt));
  const bal = balanceOf(u.id); const active = u.status === "active";
  const banner = !active && <div className="notice">Your agent account is waiting for approval by the agency. You can add workers now; clearance and job applications open after approval.</div>;
  let body;

  if (t === "overview") body = <>
    <div className="row"><Avatar name={u.name} src={ag.docs?.photo?.data} size={56} /><h2>{ag.business || u.name}</h2></div>{banner}
    {AGENT_DOCS.some(([k]) => !ag.docs?.[k]) && <div className="notice">Your profile documents are incomplete. <button className="btn link sm" onClick={() => setTab("agent", "profile")}>Upload photo, NID and trade licence</button></div>}
    <Tiles items={[[W.length, "My workers"], [C.filter(open).length, "Clearance in progress"], [C.filter(c => c.card).length, "Clearance cards received"], [A.length, "Job applications"], [bdtFmt(bal), "Balance due to agency", true]]} />
    <div className="row">
      <button className="btn pri" onClick={() => setTab("agent", "clearance")}><LuStamp /> New clearance application</button>
      <button className="btn" onClick={() => setTab("agent", "jobs")}><LuBriefcase /> Apply workers to a job</button>
      <button className="btn" onClick={() => setTab("agent", "workers")}><LuPlus /> Add a worker</button>
    </div>
    <div className="card"><div className="row between mb6"><h3>Latest clearance files</h3><button className="btn sm" onClick={() => setTab("agent", "clearance")}>All files</button></div>
      {C.length ? C.slice(0, 3).map(c => <ClRow key={c.id} c={c} />) : <Empty>No clearance applications yet.</Empty>}</div>
  </>;

  if (t === "profile") {
    const save = e => { const [d] = formData(e); act("agent.profile", d); };
    body = <>
      <h2>Agent profile</h2>{banner}
      {AGENT_DOCS.some(([k]) => !ag.docs?.[k]) && <div className="notice">Upload your photo, NID and trade licence. The agency checks them before approving your agent account.</div>}
      <AgentDocUploads u={u} />
      <form className="card fgrid" onSubmit={save} key={u.id}>
        <Field label="Your name"><input type="text" name="name" defaultValue={u.name} required /></Field>
        <Field label="Business / office name"><input type="text" name="business" defaultValue={ag.business} required /></Field>
        <Field label="Mobile number"><input type="tel" name="phone" defaultValue={ag.phone} /></Field>
        <Field label="District"><input type="text" name="district" defaultValue={ag.district} /></Field>
        <Field label="Office address" full><input type="text" name="address" defaultValue={ag.address} /></Field>
        <div className="full"><button className="btn pri" type="submit">Save profile</button></div>
      </form>
    </>;
  }

  if (t === "workers") {
    const e0 = ui.editWorker ? worker(ui.editWorker) : null; const w = e0 || {};
    const save = e => {
      const [d] = formData(e); const pass = d.passport.trim().toUpperCase();
      if (S.workers.some(x => x.passport.toUpperCase() === pass && x.id !== ui.editWorker)) return toast("A worker with this passport number is already registered.");
      const form = e.currentTarget;
      act("agent.workerSave", { ...d, id: e0?.id }).then(r => { if (!r) return; if (e0) { ui.editWorker = null; commit(); } else form.reset(); });
    };
    const del = w => {
      if (S.clearances.some(c => c.workerId === w.id && c.status !== "rejected") || S.applications.some(a => a.workerId === w.id)) return toast("This worker has a clearance file or job application, so they cannot be removed.");
      confirmBox(`Remove ${w.name} from your list?`, () => act("agent.workerDelete", { id: w.id }), "Remove");
    };
    body = <>
      <h2>My workers</h2>
      <form className="card fgrid" onSubmit={save} key={e0?.id || "new"}>
        <h3 className="full">{e0 ? "Edit worker" : "Add a worker"}</h3>
        <Field label="Full name (as in passport)"><input type="text" name="name" defaultValue={w.name} required /></Field>
        <Field label="Father's name"><input type="text" name="father" defaultValue={w.father} /></Field>
        <Field label="Passport number"><input type="text" name="passport" defaultValue={w.passport} required /></Field>
        <Field label="Passport expiry"><input type="date" name="passportExpiry" defaultValue={w.passportExpiry} /></Field>
        <Field label="Date of birth"><input type="date" name="dob" defaultValue={w.dob} /></Field>
        <Field label="Mobile number"><input type="tel" name="phone" defaultValue={w.phone} /></Field>
        <Field label="District"><input type="text" name="district" defaultValue={w.district} /></Field>
        <Field label="Trade"><input type="text" name="trade" defaultValue={w.trade} placeholder="e.g. Mason" /></Field>
        <Field label="Experience (years)"><input type="number" name="experience" min="0" defaultValue={w.experience ?? 0} /></Field>
        <div className="full row"><button className="btn pri" type="submit">{e0 ? "Save changes" : <><LuPlus /> Add worker</>}</button>{e0 && <button className="btn" type="button" onClick={() => { ui.editWorker = null; commit(); }}>Cancel</button>}</div>
      </form>
      <div className="tbl"><table><thead><tr><th>Worker</th><th>Passport</th><th>Trade</th><th>Clearance</th><th>Actions</th></tr></thead><tbody>
        {W.length ? W.map(w => { const c = C.find(x => x.workerId === w.id); return (
          <tr key={w.id}><td><b>{w.name}</b><div className="muted small">{w.district}{w.phone ? ` · ${w.phone}` : ""}</div></td><td className="num">{w.passport}<div className="muted small">Exp. {fdate(w.passportExpiry)}</div></td>
            <td>{w.trade || "—"} <span className="muted small">{w.experience ? `${w.experience} yr` : ""}</span></td><td>{c ? <Pill s={c.status} /> : <span className="muted small">None</span>}</td>
            <td><div className="row tight nowrap"><button className="btn sm" onClick={() => { ui.editWorker = w.id; commit(); window.scrollTo(0, 0); }}><LuPencil /> Edit</button>
              {!c && <button className="btn sm" onClick={() => { ui.clWorker = w.id; setTab("agent", "clearance"); }}><LuStamp /> Apply clearance</button>}
              <button className="btn sm danger" onClick={() => del(w)} aria-label={`Remove ${w.name}`}><LuTrash2 /></button></div></td></tr>); })
          : <tr><td colSpan={5}><Empty>No workers yet. Add your first worker above.</Empty></td></tr>}
      </tbody></table></div>
    </>;
  }

  if (t === "clearance") {
    const fee = Number(S.settings.clearanceFee || 0);
    const submit = async e => {
      const [d, fd] = formData(e); const form = e.currentTarget;
      if (!active) return toast("Your account must be approved first.");
      const w = worker(d.workerId);
      if (S.clearances.some(c => c.workerId === w.id && c.status !== "rejected")) return toast("This worker already has an open clearance file.");
      const pick = n => { const f = fd.get(n); return f && f.size ? f : null; };
      const passF = pick("passportCopy"), visaF = pick("visaCopy"), contractF = pick("contract");
      if (!passF) return toast("Upload the passport copy.");
      if (!visaF) return toast("Upload the visa copy.");
      ui.clBusy = true; commit();
      try {
        const files = { passport: await readUpload(passF, { imageMax: 1800 }), visa: await readUpload(visaF, { imageMax: 1800 }), contract: contractF ? await readUpload(contractF, { imageMax: 1800 }) : null };
        const r = await act("agent.clearance", { workerId: w.id, country: d.country, employer: d.employer, visaNo: d.visaNo, visaType: d.visaType, flightDate: d.flightDate, notes: d.notes, files });
        if (r) { ui.clWorker = ""; form.reset(); }
      } catch (err) { toast(err.message); }
      finally { ui.clBusy = false; commit(); }
    };
    body = <>
      <h2>BMET clearance applications</h2>{banner}
      {W.length ? (
        <form className="card fgrid" onSubmit={submit} key={ui.clWorker || "cl"}>
          <h3 className="full">New clearance application</h3>
          <Field label="Worker"><select name="workerId" defaultValue={ui.clWorker || W[0].id} required>{W.map(w => <option key={w.id} value={w.id}>{w.name} · {w.passport}</option>)}</select></Field>
          <Field label="Destination country"><select name="country" defaultValue="Saudi Arabia"><Options list={Object.keys(COUNTRIES)} /></select></Field>
          <Field label="Employer / sponsor name"><input type="text" name="employer" required /></Field>
          <Field label="Visa number"><input type="text" name="visaNo" /></Field>
          <Field label="Visa type"><select name="visaType"><Options list={["Work visa", "Free visa", "Group visa", "Other"]} /></select></Field>
          <Field label="Planned flight date"><input type="date" name="flightDate" /></Field>
          <Field label="Upload passport copy" hint="PDF or JPG"><input type="file" name="passportCopy" accept={DOC_TYPES} required /></Field>
          <Field label="Upload visa copy" hint="PDF or JPG"><input type="file" name="visaCopy" accept={DOC_TYPES} required /></Field>
          <Field label="Upload employment contract (optional)" hint="PDF or JPG"><input type="file" name="contract" accept={DOC_TYPES} /></Field>
          <Field label="Notes for the agency" full><textarea name="notes" className="short" /></Field>
          <div className="full row"><button className="btn pri" type="submit" disabled={!active || ui.clBusy}><LuSend /> {ui.clBusy ? "Uploading…" : "Submit application"}</button>{fee > 0 && <span className="muted small">Processing charge of {bdtFmt(fee)} is added to your account.</span>}</div>
        </form>
      ) : <div className="notice">Add a worker first. <button className="btn link sm" onClick={() => setTab("agent", "workers")}>Add worker</button></div>}
      <div className="card"><h3 className="mb6">My clearance files</h3>{C.length ? C.map(c => <ClRow key={c.id} c={c} />) : <Empty>No clearance applications yet.</Empty>}</div>
    </>;
  }

  if (t === "jobs") {
    const L = live(); const sel = L.some(j => j.id === ui.agentJob) ? ui.agentJob : (L[0]?.id || "");
    const already = new Set(A.filter(a => a.jobId === sel).map(a => a.workerId));
    const submit = e => {
      const [, fd] = formData(e);
      if (!active) return toast("Your account must be approved first.");
      const ids = fd.getAll("workers"); const j = job(sel);
      if (!ids.length) return toast("Select at least one worker.");
      act("agent.applyJob", { jobId: j.id, workerIds: ids });
    };
    body = <>
      <h2>Apply workers to a job</h2>{banner}
      {L.length && W.length ? (
        <form className="card stack" onSubmit={submit} key={sel + A.length}>
          <Field label="Job"><select value={sel} onChange={e => { ui.agentJob = e.target.value; commit(); }}>{L.map(j => <option key={j.id} value={j.id}>{j.title} · {j.city}, {j.country} · {money(j.salaryMin, j.currency)}+{j.period === "hour" ? " /hr" : ""}</option>)}</select></Field>
          <fieldset className="plain"><legend className="small b">Select workers</legend><div className="grid checkgrid wide">
            {W.map(w => <label key={w.id} className={`check${already.has(w.id) ? " dim" : ""}`}><input type="checkbox" name="workers" value={w.id} disabled={already.has(w.id)} /> {w.name} <span className="muted small">{w.trade}{already.has(w.id) ? " · already applied" : ""}</span></label>)}
          </div></fieldset>
          <div><button className="btn pri" type="submit" disabled={!active}><LuSend /> Submit applications</button></div>
        </form>
      ) : <div className="notice">{W.length ? "There are no open jobs right now." : "Add workers first, then apply them to open jobs."}</div>}
      <div className="card"><h3 className="mb6">My job applications</h3>{A.length ? A.map(a => <AppRow key={a.id} a={a} />) : <Empty>No job applications yet.</Empty>}</div>
    </>;
  }

  if (t === "account") {
    const conf = S.ledger.filter(l => l.agentId === u.id && l.status === "confirmed");
    const ch = conf.filter(l => l.type === "charge").reduce((s, l) => s + Number(l.amount), 0);
    const pd = conf.filter(l => l.type === "payment").reduce((s, l) => s + Number(l.amount), 0);
    const pay = e => {
      const [d] = formData(e);
      const form = e.currentTarget; act("agent.payment", d).then(r => { if (r) form.reset(); });
    };
    body = <>
      <h2>Account statement</h2>
      <Tiles items={[[bdtFmt(ch), "Total charges"], [bdtFmt(pd), "Total paid"], [bdtFmt(Math.abs(bal)), bal < 0 ? "Advance with agency" : "Balance due", true]]} />
      <LedgerTable agentId={u.id} />
      <form className="card fgrid" onSubmit={pay}>
        <h3 className="full">Report a payment</h3>
        <Field label="Amount (BDT)"><input type="number" name="amount" min="1" required /></Field>
        <Field label="Payment method"><select name="method"><Options list={PAY_METHODS} /></select></Field>
        <Field label="Transaction / reference no."><input type="text" name="ref" /></Field>
        <Field label="Payment date"><input type="date" name="date" defaultValue={now().slice(0, 10)} required /></Field>
        <Field label="Note" full><input type="text" name="desc" placeholder="e.g. Payment for Jamal Hossain clearance" /></Field>
        <div className="full row"><button className="btn pri" type="submit"><LuWallet /> Submit payment</button><span className="muted small">The balance updates after the agency confirms receipt.</span></div>
      </form>
    </>;
  }

  if (t === "tickets") {
    const T = S.tickets.filter(x => x.agentId === u.id).sort((a, b) => b.created.localeCompare(a.created));
    const submit = e => {
      const [d] = formData(e);
      if (!active) return toast("Your account must be approved first.");
      const form = e.currentTarget; act("agent.ticket", d).then(r => { if (r) form.reset(); });
    };
    const cancel = x => confirmBox("Cancel this ticket request?", () => act("agent.ticketCancel", { id: x.id }), "Cancel request");
    body = <>
      <h2>Air ticket requests</h2>{banner}
      <p className="muted">Request a flight for a worker whose visa and clearance are ready. The agency books the ticket and adds the fare to your account statement.</p>
      {W.length ? (
        <form className="card fgrid" onSubmit={submit}>
          <h3 className="full">New ticket request</h3>
          <Field label="Worker"><select name="workerId" required>{W.map(w => <option key={w.id} value={w.id}>{w.name} · {w.passport}</option>)}</select></Field>
          <Field label="From"><input type="text" name="from" defaultValue="Dhaka (DAC)" required /></Field>
          <Field label="To (city / airport)"><input type="text" name="to" required placeholder="e.g. Riyadh (RUH)" /></Field>
          <Field label="Preferred date"><input type="date" name="prefDate" required /></Field>
          <Field label="Notes" full><input type="text" name="notes" placeholder="Airline preference, baggage, etc." /></Field>
          <div className="full"><button className="btn pri" type="submit" disabled={!active}><LuPlaneTakeoff /> Request ticket</button></div>
        </form>
      ) : <div className="notice">Add a worker first. <button className="btn link sm" onClick={() => setTab("agent", "workers")}>Add worker</button></div>}
      <div className="tbl"><table><thead><tr><th>Worker</th><th>Route</th><th>Preferred date</th><th>Booking</th><th>Status</th><th></th></tr></thead><tbody>
        {T.length ? T.map(x => { const w = worker(x.workerId) || { name: "Removed worker" }; return (
          <tr key={x.id}><td><b>{w.name}</b><div className="muted small">{w.passport}</div></td><td>{x.from} → {x.to}</td><td>{fdate(x.prefDate)}</td>
            <td>{x.status === "booked" ? <>{x.airline} · PNR <b>{x.pnr || "—"}</b><div className="muted small">Flight {fdate(x.flightDate)}{x.fare ? ` · ${bdtFmt(x.fare)}` : ""}</div></> : "—"}</td>
            <td><Pill s={x.status} /></td><td>{x.status === "requested" && <button className="btn sm link danger" onClick={() => cancel(x)}>Cancel</button>}</td></tr>); })
          : <tr><td colSpan={6}><Empty>No ticket requests yet.</Empty></td></tr>}
      </tbody></table></div>
    </>;
  }

  if (t === "notifications") body = <NotifPanel u={u} />;

  return (
    <div className="wrap dash">
      <Rail role="agent" items={[["overview", "Overview", LuLayoutDashboard], ["profile", "Agent profile", LuUser], ["workers", "My workers", LuUsers, W.length], ["clearance", "BMET clearance", LuStamp, C.filter(open).length], ["jobs", "Job applications", LuBriefcase, A.length], ["tickets", "Air tickets", LuTicket, S.tickets.filter(x => x.agentId === u.id && x.status === "requested").length], ["account", "Account statement", LuWallet], ["notifications", "Notifications", LuBell, unread(u)]]} />
      <div className="panel">{body}</div>
    </div>
  );
}
