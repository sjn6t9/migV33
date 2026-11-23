import { FlightSearch, FlightRequest, TicketFlight } from "./Flights.jsx";
import React from "react";
import { Statement } from "./Statement.jsx";
import { agentRows } from "../statement.js";
import { LuLayoutDashboard, LuUser, LuUsers, LuStamp, LuBriefcase, LuWallet, LuBell, LuPencil, LuTrash2, LuSend, LuPlus, LuEye, LuTicket, LuPlaneTakeoff } from "react-icons/lu";
import { store, commit, worker, job, live, money, fdate, bdtFmt, balanceOf, unread, now, COUNTRIES, CL_DOCS, PAY_METHODS, loadState } from "../store.js";
import { toast, formData, setTab, openModal, closeModal, confirmBox, withdraw, readUpload, act, DOC_TYPES, downloadFile, cardFileName } from "../actions.js";
import { LuShieldCheck, LuDownload, LuMaximize2, LuMinimize2, LuRefreshCw, LuSearch, LuFileText, LuBanknote, LuCirclePlus, LuX } from "react-icons/lu";
import { Rail, Tiles, Pill, Pipe, ClPipe, Empty, CardDownload, Avatar } from "../ui.jsx";
import { AgentDatalist } from "./AgentBook.jsx";
import { PreEcCheck } from "./PreEc.jsx";
import { JobSlides } from "./JobSlides.jsx";
import { NotifPanel, Field, Options, ClCountryOptions, AgentDocUploads, AGENT_DOCS } from "./shared.jsx";

const ui = store.ui;
const open = c => !["approved", "rejected"].includes(c.status);

function ClRow({ c }) {
  const w = worker(c.workerId) || { name: "Removed worker" };
  return (
    <div className="listrow">
      <div className="row between"><div><b>{w.name}</b> <span className="muted small">· {w.passport} · {c.country}</span></div><Pill s={c.status} label={c.status === "custom" ? c.statusText : undefined} /></div>
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
            <td>{w.trade || "—"} <span className="muted small">{w.experience ? `${w.experience} yr` : ""}</span></td><td>{c ? <Pill s={c.status} label={c.status === "custom" ? c.statusText : undefined} /> : <span className="muted small">None</span>}</td>
            <td><div className="row tight nowrap"><button className="btn sm" onClick={() => { ui.editWorker = w.id; commit(); window.scrollTo(0, 0); }}><LuPencil /> Edit</button>
              {!c && <button className="btn sm" onClick={() => { ui.clWorker = w.id; setTab("agent", "clearance"); }}><LuStamp /> Apply clearance</button>}
              <button className="btn sm danger" onClick={() => del(w)} aria-label={`Remove ${w.name}`}><LuTrash2 /></button></div></td></tr>); })
          : <tr><td colSpan={5}><Empty>No workers yet. Add your first worker above.</Empty></td></tr>}
      </tbody></table></div>
    </>;
  }

  if (t === "clearance") body = <>{banner}<ClearanceList C={C} W={W} active={active} /></>;

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
      <JobSlides workers={W} apps={A} active={active} />
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
    const pay = async e => {
      const [d, fd] = formData(e); const form = e.currentTarget; const f = fd.get("proof");
      try { const proof = f && f.size ? await readUpload(f, { imageMax: 1800 }) : null; const r = await act("agent.payment", { ...d, proof }); if (r) form.reset(); } catch (err) { toast(err.message); }
    };
    body = <>
      <h2>Payment history</h2>
      <div className="card"><Statement title={u.agent?.business || u.name} sub={[u.name, u.agent?.phone].filter(Boolean).join(" · ")} rows={agentRows(S.ledger, u.id)} /></div>
      <form className="card fgrid" onSubmit={pay}>
        <h3 className="full">Report a payment</h3>
        <Field label="Amount (BDT)"><input type="number" name="amount" min="1" required /></Field>
        <Field label="Payment method"><select name="method"><Options list={PAY_METHODS} /></select></Field>
        <Field label="Transaction / reference no."><input type="text" name="ref" /></Field>
        <Field label="Payment date"><input type="date" name="date" defaultValue={now().slice(0, 10)} required /></Field>
        <Field label="Note" full><input type="text" name="desc" placeholder="e.g. Payment for Jamal Hossain clearance" /></Field>
        <Field label="Payment proof (optional)" hint="Screenshot of the bKash / bank transfer or a photo of the receipt. JPG, PNG or PDF." full><input type="file" name="proof" accept="image/*,.pdf" /></Field>
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
    const fp = ui.flightPick;
    const sendPick = async d => { if (!active) return toast("Your account must be approved first."); if (await act("agent.ticket", d)) { ui.flightPick = null; commit(); } };
    body = <>
      <h2>Air tickets</h2>{banner}
      <p className="muted">Search live fares, pick a flight and send it for a worker. The agency books the ticket and adds the fare to your account statement.</p>
      {fp ? <FlightRequest pick={fp.f} q={fp.q} onClose={() => { ui.flightPick = null; commit(); }} onSend={sendPick} travellers={{ workers: W }} /> : <FlightSearch onPick={(f, q) => { ui.flightPick = { f, q }; commit(); window.scrollTo({ top: 0, behavior: "smooth" }); }} />}
      <details className="vf-det mt14" open={!S.flightsReady}><summary>Or send a request without choosing a flight</summary>
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
      ) : <div className="notice">Add a worker first. <button className="btn link sm" onClick={() => setTab("agent", "workers")}>Add worker</button></div>}</details>
      <h3 className="mt14">My ticket requests</h3>
      <div className="tbl"><table><thead><tr><th>Worker</th><th>Route</th><th>Preferred date</th><th>Booking</th><th>Status</th><th></th></tr></thead><tbody>
        {T.length ? T.map(x => { const w = worker(x.workerId) || (x.name ? { name: x.name, passport: x.passport } : { name: "Removed worker" }); return (
          <tr key={x.id}><td><b>{w.name}</b><div className="muted small">{w.passport}</div></td><td>{x.from} → {x.to}<TicketFlight x={x} /></td><td>{fdate(x.prefDate)}</td>
            <td>{x.status === "booked" ? <>{x.airline} · PNR <b>{x.pnr || "—"}</b><div className="muted small">Flight {fdate(x.flightDate)}{x.fare ? ` · ${bdtFmt(x.fare)}` : ""}</div></> : "—"}</td>
            <td><Pill s={x.status} /></td><td>{x.status === "booked" && x.ticketFile && <button className="btn sm pri" onClick={() => downloadFile(`/api/files/${x.ticketFile.id}`, x.ticketFile.name || "ticket")}><LuDownload /> Download Ticket</button>}{x.status === "requested" && <button className="btn sm link danger" onClick={() => cancel(x)}>Cancel</button>}</td></tr>); })
          : <tr><td colSpan={6}><Empty>No ticket requests yet.</Empty></td></tr>}
      </tbody></table></div>
    </>;
  }

  if (t === "notifications") body = <NotifPanel u={u} />;

  return (
    <div className="wrap dash">
      <Rail role="agent" items={[["overview", "Overview", LuLayoutDashboard], ["profile", "Agent profile", LuUser], ["workers", "My workers", LuUsers, W.length], ["clearance", "BMET clearance", LuStamp, C.filter(open).length], ["jobs", "Job applications", LuBriefcase, A.length], ["tickets", "Air tickets", LuTicket, S.tickets.filter(x => x.agentId === u.id && x.status === "requested").length], ["account", "Payment history", LuWallet]]} />
      <div className="panel">{body}</div>
    </div>
  );
}


/* ---------- BMET clearance: list of EC applications (one row per worker) ---------- */
const EC_STATUS = {
  pending: "Pending Agency Review", received: "Received by Agency", sent_bmet: "Sent to BMET", section: "Pending Section Approval", ad: "Pending AD Approval",
  dd: "Pending DD Approval", director: "Pending Director Approval", adg: "Pending ADG Approval", final: "Pending Final Approval", approved: "Final Approved", rejected: "Rejected"
};
// "Approved" only once the agency has uploaded the clearance card; before that a finally approved file shows "Final Approved"
// after the file is sent to BMET the status is the one RAIMS shows (it can go back, e.g. Director → Section, and up again until Approved)
const ecStatus = c => c.status === "custom" ? [c.statusText || "Custom", "s-custom"] : c.status === "approved" ? ["Approved", "s-approved"] : [(c.raims?.stage === c.status && c.raims.status) || EC_STATUS[c.status] || c.status, `s-${c.status}`];
const ecPay = c => {
  if (!["final", "approved"].includes(c.status === "custom" ? c.baseStage : c.status)) return "na";
  if (c.payment?.status === "paid" || c.card?.feePaid) return "paid";
  return c.payment?.status === "submitted" ? "pending" : "unpaid";
};
const ecDate = iso => { const d = new Date(iso); return isNaN(d) ? "N/A" : `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`; };
const PAY_LABEL = { na: "N/A", paid: "Paid", unpaid: "Unpaid", pending: "Payment Pending" };
const TYPES = [["all", "All Types"], ["open", "In progress"], ["approved", "Approved"], ["card", "Card received"], ["rejected", "Rejected"]];

function ClearanceList({ C, W, active }) {
  const [q, setQ] = React.useState(""); const [type, setType] = React.useState("all");
  const [per, setPer] = React.useState(10); const [page, setPage] = React.useState(1);
  const [full, setFull] = React.useState(false); const [spin, setSpin] = React.useState(false);
  const [form, setForm] = React.useState(!!ui.clWorker);
  const rows = C.map(c => ({ c, w: worker(c.workerId) || { name: "Removed worker", passport: "" } }))
    .filter(({ c }) => type === "all" || (type === "open" ? open(c) : type === "card" ? !!c.card : c.status === type))
    .filter(({ c, w }) => { const k = q.trim().toLowerCase(); return !k || [c.ref, w.name, w.passport].some(v => String(v || "").toLowerCase().includes(k)); });
  const pages = Math.max(1, Math.ceil(rows.length / per)); const pg = Math.min(page, pages);
  const shown = rows.slice((pg - 1) * per, pg * per);
  const refresh = async () => { setSpin(true); await loadState(); setSpin(false); toast("List refreshed."); };
  const exportCsv = () => {
    const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["SL", "Worker name", "Passport No", "EC Ref No", "Country", "Status", "Submission Date", "Payment Status"].map(esc).join(",")]
      .concat(rows.map(({ c, w }, i) => [i + 1, w.name, w.passport, c.ref, c.country, ecStatus(c)[0], ecDate(c.created), PAY_LABEL[ecPay(c)]].map(esc).join(",")));
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `EC-Applications-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  return <>
    <div className="ec-head">
      <div><h2>BMET clearance applications</h2><div className="crumbs"><a href="#dashboard" onClick={e => { e.preventDefault(); setTab("agent", "overview"); }}>Home</a> <span>›</span> <b>EC Application List</b></div></div>
      <div className="ec-head-btns"><button className={`btn ${form === "preec" ? "dark" : "soft"}`} onClick={() => setForm(f => f === "preec" ? false : "preec")}>{form === "preec" ? <LuX /> : <LuShieldCheck />} Check &amp; Application</button>
      {form === true && <button className="btn dark" onClick={() => setForm(false)}><LuX /> Close the form</button>}</div>
    </div>
    {form === "preec" && <PreEcCheck onClose={() => setForm(false)} onManual={() => setForm(true)} />}
    {form === true && <GroupEcForm C={C} W={W} active={active} onDone={() => setForm(false)} />}
    <div className={`card ec-card${full ? " ec-full" : ""}`}>
      <div className="ec-tools">
        <button className="btn sm" onClick={exportCsv} disabled={!rows.length}><LuDownload /> Export</button>
        <button className="btn sm soft" onClick={() => setFull(f => !f)}>{full ? <LuMinimize2 /> : <LuMaximize2 />} {full ? "Normal View" : "Full View"}</button>
        <button className="btn sm soft" onClick={refresh} disabled={spin}><LuRefreshCw className={spin ? "spin" : ""} /> Refresh</button>
        <label className="ec-show">Show <select value={per} onChange={e => { setPer(Number(e.target.value)); setPage(1); }}>{[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
        <span className="grow" />
        <select className="ec-type" value={type} onChange={e => { setType(e.target.value); setPage(1); }} aria-label="Type">{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <label className="ec-search"><input type="text" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} placeholder="EC Ref No, name or passport" /><LuSearch /></label>
      </div>
      <div className="tbl ec-tbl grid"><table><thead><tr><th>SL</th><th>Worker name</th><th>Passport No</th><th>EC Ref No</th><th>Country</th><th>Status</th><th>Submission Date</th><th>Payment Status</th><th>Option</th></tr></thead><tbody>
        {shown.length ? shown.map(({ c, w }, i) => { const pay = ecPay(c); return (
          <tr key={c.id}>
            <td>{(pg - 1) * per + i + 1}</td>
            <td><b>{w.name}</b></td>
            <td className="num" data-notr>{w.passport || "—"}</td>
            <td><a href="#" className="ec-ref" data-notr onClick={e => { e.preventDefault(); openModal("clearance", { cid: c.id }); }}>{c.ref || c.id}</a></td>
            <td>{c.country}</td>
            <td><span className={`ec-badge ${ecStatus(c)[1]}`}>{ecStatus(c)[0]}</span></td>
            <td className="num">{ecDate(c.created)}</td>
            <td><span className={`ec-badge pay-${pay}`}>{PAY_LABEL[pay]}</span>{pay === "unpaid" && c.payment?.status === "rejected" && <div className="small bad mt4">{c.payment.note ? `Receipt not accepted: ${c.payment.note}` : "Receipt not accepted"}</div>}</td>
            <td><div className="ec-opts">
              <button className="ec-ico view" title="View details" aria-label="View details" onClick={() => openModal("clearance", { cid: c.id })}><LuEye /></button>
              {c.card && <button className="ec-ico pdf" title="Download clearance card" aria-label="Download clearance card" onClick={() => downloadFile(c.card.data, cardFileName(c))}><LuFileText /></button>}
              {pay === "unpaid" && <button className="ec-ico pay" title="Submit payment receipt" aria-label="Submit payment receipt" onClick={() => openModal("clPay", { cid: c.id })}><LuBanknote /></button>}
            </div></td>
          </tr>); }) : <tr><td colSpan={9}><Empty>{C.length ? "No application matches your search." : "No clearance applications yet."}</Empty></td></tr>}
      </tbody></table></div>
      {rows.length > 0 && <div className="row between mt8 ec-foot"><span className="muted small">{`Showing ${(pg - 1) * per + 1} to ${Math.min(pg * per, rows.length)} of ${rows.length} entries`}</span>
        <div className="row tight"><button className="btn sm" disabled={pg <= 1} onClick={() => setPage(pg - 1)}>Previous</button><span className="small b">{pg} / {pages}</span><button className="btn sm" disabled={pg >= pages} onClick={() => setPage(pg + 1)}>Next</button></div></div>}
    </div>
  </>;
}

/* one form for one or more workers going to the same country and employer; each worker gets their own EC file */
export function GroupEcForm({ C, W, active, onDone, admin }) {
  const S = store.S; const fee = Number(S.settings.clearanceFee || 0);
  // admin/staff: the agent is picked from the registered agents or typed as a custom name
  const [agText, setAgText] = React.useState("");
  const agName = a => a.agent?.business || a.name;
  const agents = admin ? (S.users || []).filter(x => x.role === "agent") : [];
  const ag = admin ? agents.find(a => agName(a).trim().toLowerCase() === agText.trim().toLowerCase()) : null;
  if (admin) {
    C = S.clearances || []; active = true;
    const k = agText.trim().toLowerCase();
    W = (S.workers || []).filter(w => ag ? w.agentId === ag.id : k && !w.agentId && String(w.agentName || "").trim().toLowerCase() === k);
  }
  const free = W.filter(w => !C.some(c => c.workerId === w.id && c.status !== "rejected"));
  const [sel, setSel] = React.useState(() => ui.clWorker && free.some(w => w.id === ui.clWorker) ? [ui.clWorker] : []);
  const [busy, setBusy] = React.useState(false);
  const [fresh, setFresh] = React.useState(() => (ui.clWorker || W.length ? [] : [1])); // workers typed in here (not yet in My workers)
  const nextKey = React.useRef(2);
  const toggle = id => setSel(L => L.includes(id) ? L.filter(x => x !== id) : [...L, id]);
  React.useEffect(() => { if (admin) setSel([]); }, [admin, ag?.id, ag ? "" : agText.trim().toLowerCase()]);
  const submit = async e => {
    e.preventDefault(); const form = e.currentTarget; const fd = new FormData(form); const d = Object.fromEntries(fd);
    if (!active) return toast("Your account must be approved first.");
    const list = [...sel.map(id => ({ key: id, id })), ...fresh.map(k => ({ key: `n${k}`, nw: { name: (d[`nwName_n${k}`] || "").trim(), passport: (d[`nwPass_n${k}`] || "").trim(), phone: d[`nwPhone_n${k}`] || "", trade: d[`nwTrade_n${k}`] || "" } }))];
    if (admin && !agText.trim()) return toast("Select the agent or write a name.");
    if (!list.length) return toast("Select at least one worker.");
    if (!String(d.employer || "").trim()) return toast("Enter the employer / sponsor name.");
    const pick = n => { const f = fd.get(n); return f && f.size ? f : null; };
    for (const x of list) {
      const name = x.id ? worker(x.id).name : x.nw.name || "the new worker";
      if (x.nw && (x.nw.name.length < 2 || !x.nw.passport)) return toast("Enter the worker's name and passport number.");
      if (!pick(`pass_${x.key}`) || !pick(`visa_${x.key}`)) return toast(`Upload the passport copy and visa copy for ${name}.`);
    }
    setBusy(true); let ok = 0;
    try {
      for (const x of list) {
        const contractF = pick(`contract_${x.key}`);
        const files = { passport: await readUpload(pick(`pass_${x.key}`), { imageMax: 1800 }), visa: await readUpload(pick(`visa_${x.key}`), { imageMax: 1800 }), contract: contractF ? await readUpload(contractF, { imageMax: 1800 }) : null };
        const r = await act(admin ? "admin.clearance" : "agent.clearance", { ...(admin ? (ag ? { agentId: ag.id } : { agentName: agText.trim() }) : {}), ...(x.id ? { workerId: x.id } : { newWorker: x.nw }), country: d.country, employer: d.employer, visaNo: d[`visaNo_${x.key}`] || "", visaType: d.visaType, flightDate: d.flightDate, notes: d.notes, files }, { quiet: true });
        if (r) ok++; else break; // the server's reason is shown; the workers already sent leave the list
      }
      if (ok && ok < list.length) { const done = new Set(list.slice(0, ok).map(x => x.key)); setSel(L => L.filter(id => !done.has(id))); setFresh(L => L.filter(k => !done.has(`n${k}`))); }
      if (ok === list.length) { toast(`${ok} EC application(s) submitted.`); ui.clWorker = ""; setSel([]); setFresh([]); form.reset(); onDone(); }
    } catch (err) { toast(err.message); }
    finally { setBusy(false); }
  };
  return (
    <form className="card fgrid ec-form" onSubmit={submit} noValidate>
      <h3 className="full">Create New Application Manually</h3>
      <p className="muted small full">Choose the workers going to the same country and employer. Each worker gets their own EC Ref No.</p>
      {admin && <Field label="Agent" hint={ag ? "Registered agent: the file also shows in this agent's portal." : agText.trim() ? "From the agent list (a new name is added to it)." : "Pick a registered agent from the list, or type a name."} full>
        <input type="text" list="ec-agent-list" value={agText} onChange={e => setAgText(e.target.value)} maxLength={120} placeholder="Select an agent or type a name" />
        <AgentDatalist id="ec-agent-list" />
      </Field>}
      <Field label="Destination country"><select name="country" defaultValue="Saudi Arabia"><ClCountryOptions /></select></Field>
      <Field label="Employer / sponsor name"><input type="text" name="employer" required /></Field>
      <Field label="Visa type"><select name="visaType"><Options list={["Work visa", "Free visa", "Group visa", "Other"]} /></select></Field>
      <Field label="Planned flight date"><input type="date" name="flightDate" /></Field>
      <fieldset className="plain full"><legend className="small b">Workers</legend>
        {free.length ? <div className="ec-pick">{free.map(w => <label key={w.id} className={`check ec-chip${sel.includes(w.id) ? " on" : ""}`}><input type="checkbox" checked={sel.includes(w.id)} onChange={() => toggle(w.id)} /> {w.name} <span className="muted small" data-notr>{w.passport}</span></label>)}</div>
          : <p className="muted small">{admin ? (W.length ? "All this agent's workers already have an open clearance file." : "No saved workers for this agent. Add a new worker below.") : W.length ? "All your workers already have an open clearance file." : "No saved workers yet. Add a new worker below."}</p>}
      </fieldset>
      {sel.map(id => { const w = worker(id); return (
        <div key={id} className="full ec-worker">
          <div className="b mb6">{w.name} <span className="muted small" data-notr>· {w.passport}</span></div>
          <EcDocs k={id} />
        </div>); })}
      {fresh.map(k => (
        <div key={`n${k}`} className="full ec-worker ec-new">
          <div className="row between mb6"><b>New worker</b><button type="button" className="btn sm link danger" onClick={() => setFresh(L => L.filter(x => x !== k))}><LuX /> Remove</button></div>
          <div className="fgrid mb6">
            <Field label="Worker's full name"><input type="text" name={`nwName_n${k}`} maxLength={120} /></Field>
            <Field label="Passport number" hint={(S.passports || []).length ? "Pick from the office's passport list, or type it" : ""}><input type="text" name={`nwPass_n${k}`} maxLength={30} style={{ textTransform: "uppercase" }} list="ec-pp-list"
              onChange={e => { const pp = (S.passports || []).find(x => x.passport === e.target.value.replace(/\s+/g, "").toUpperCase()); const nm = e.target.form?.elements[`nwName_n${k}`]; if (pp && nm && !nm.value.trim()) nm.value = pp.name; if (admin && pp && !agText.trim()) { const pa = agents.find(a => a.id === pp.agentId); if (pa) setAgText(agName(pa)); } }} /></Field>
            <Field label="Mobile number (optional)"><input type="tel" name={`nwPhone_n${k}`} maxLength={30} /></Field>
            <Field label="Trade (optional)"><input type="text" name={`nwTrade_n${k}`} maxLength={80} placeholder="e.g. Mason" /></Field>
          </div>
          <EcDocs k={`n${k}`} />
          <datalist id="ec-pp-list">{(S.passports || []).filter(x => !W.some(w => (w.passport || "").replace(/\s+/g, "").toUpperCase() === x.passport)).map(x => <option key={x.id} value={x.passport}>{`${x.name} · ${x.country}`}</option>)}</datalist>
        </div>))}
      <div className="full"><button type="button" className="btn sm" onClick={() => setFresh(L => [...L, nextKey.current++])}><LuPlus /> Add a new worker</button>
        <span className="muted small">{admin ? "The new worker is saved under this agent." : "The new worker is also saved in My workers."}</span></div>
      <Field label={admin ? "Notes" : "Notes for the agency"} full><textarea name="notes" className="short" /></Field>
      <div className="full row"><button className="btn pri" type="submit" disabled={!active || busy || !(sel.length + fresh.length)}><LuSend /> {busy ? "Uploading…" : sel.length + fresh.length > 1 ? `Submit ${sel.length + fresh.length} applications` : "Submit application"}</button>
        {fee > 0 && (!admin || ag) && <span className="muted small">{admin ? `Processing charge of ${bdtFmt(fee)} per worker is added to the agent's account.` : `Processing charge of ${bdtFmt(fee)} per worker is added to your account.`}</span>}</div>
    </form>
  );
}

function EcDocs({ k }) {
  return (
    <div className="fgrid">
      <Field label="Visa number"><input type="text" name={`visaNo_${k}`} /></Field>
      <Field label="Upload passport copy" hint="PDF or JPG"><input type="file" name={`pass_${k}`} accept={DOC_TYPES} /></Field>
      <Field label="Upload visa copy" hint="PDF or JPG"><input type="file" name={`visa_${k}`} accept={DOC_TYPES} /></Field>
      <Field label="Upload employment contract (optional)" hint="PDF or JPG"><input type="file" name={`contract_${k}`} accept={DOC_TYPES} /></Field>
    </div>
  );
}

/* modal: the agent sends the payment receipt for a finally approved file */
export function ClPayForm({ cid }) {
  const c = store.S.clearances.find(x => x.id === cid); const [busy, setBusy] = React.useState(false);
  if (!c) return <p className="muted">File not found.</p>;
  const w = worker(c.workerId) || { name: "", passport: "" };
  const submit = async e => {
    e.preventDefault(); const fd = new FormData(e.currentTarget); const f = fd.get("receipt");
    if (!(Number(fd.get("amount")) > 0)) return toast("Enter the amount you paid.");
    if (!f || !f.size) return toast("Attach the payment receipt.");
    setBusy(true);
    try { const file = await readUpload(f, { imageMax: 1800 }); const r = await act("agent.clPayment", { id: c.id, amount: fd.get("amount"), method: fd.get("method"), ref: fd.get("ref"), file }); if (r) closeModal(); }
    catch (err) { toast(err.message); } finally { setBusy(false); }
  };
  return (
    <form className="stack12" onSubmit={submit} noValidate>
      <h3>Submit payment receipt</h3>
      <p className="muted small"><b>{w.name}</b> · <span data-notr>{w.passport} · {c.ref}</span></p>
      <div className="fgrid">
        <Field label="Amount paid (BDT)"><input type="number" name="amount" min="1" step="any" required autoFocus /></Field>
        <Field label="Payment method"><select name="method"><Options list={PAY_METHODS} /></select></Field>
        <Field label="Transaction / reference no."><input type="text" name="ref" maxLength={80} /></Field>
        <Field label="Payment receipt" hint="Photo or PDF of the receipt"><input type="file" name="receipt" accept={DOC_TYPES} required /></Field>
      </div>
      <div className="row"><button className="btn pri" type="submit" disabled={busy}><LuSend /> {busy ? "Uploading…" : "Submit"}</button><button className="btn" type="button" onClick={closeModal}>Cancel</button></div>
    </form>
  );
}
