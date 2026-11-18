import React from "react";
import { LuLayoutDashboard, LuBuilding2, LuPlus, LuBriefcase, LuUsers, LuPackage, LuBell, LuPencil, LuPause, LuPlay, LuCircleX, LuRotateCcw } from "react-icons/lu";
import { store, commit, appsFor, fdate, num, unread, COUNTRIES, CATS, TYPES, BENEFITS, STAGES, LABEL } from "../store.js";
import { toast, formData, setTab, act } from "../actions.js";
import { Rail, Tiles, Pill, Empty } from "../ui.jsx";
import { NotifPanel, ApplicantTable, Field, Options, JobFields, blankJob } from "./shared.jsx";
import { ShareButton } from "../Share.jsx";

const ui = store.ui;

export function Employer({ u }) {
  const S = store.S; const t = ui.tab.employer;
  const myJobs = S.jobs.filter(j => j.employerId === u.id);
  const myApps = S.applications.filter(a => myJobs.some(j => j.id === a.jobId));
  const c = u.company || {};
  const banner = u.status === "pending"
    ? <div className="notice">Your account is waiting for admin approval. You can complete your company profile meanwhile.</div>
    : c.verify !== "verified" ? <div className="notice">Company not verified yet. {c.verify === "pending" ? "Verification request is under review." : <button className="btn link sm" onClick={() => setTab("employer", "company")}>Submit for verification</button>}</div> : null;
  let body;

  if (t === "overview") body = <>
    <h2>{c.name || "Your company"}</h2>{banner}
    <Tiles items={[[myJobs.filter(j => j.status === "active").length, "Live jobs"], [myJobs.filter(j => j.status === "pending").length, "Awaiting approval"], [myApps.length, "Applicants"], [myApps.filter(a => a.status === "shortlisted").length, "Shortlisted"], [myApps.filter(a => a.status === "hired").length, "Hired"]]} />
    {S.settings.paidPosting && <div className="card row between"><span>Job post credits: <b className="num">{u.credits || 0}</b> · Featured credits: <b className="num">{u.featuredCredits || 0}</b></span><button className="btn sm" onClick={() => setTab("employer", "package")}>Buy package</button></div>}
    <div className="card"><div className="row between mb12"><h3>Recent applicants</h3><button className="btn sm" onClick={() => setTab("employer", "applicants")}>All applicants</button></div><ApplicantTable list={myApps.slice(-5).reverse()} /></div>
  </>;

  if (t === "company") {
    const save = e => { const [d] = formData(e); act("emp.company", d); };
    body = <>
      <h2>Company profile</h2>{banner}
      <form className="card fgrid" onSubmit={save} key={u.id}>
        <Field label="Company name"><input type="text" name="name" defaultValue={c.name} required /></Field>
        <Field label="Industry"><select name="industry" defaultValue={c.industry}><Options list={CATS} /></select></Field>
        <Field label="Country"><select name="country" defaultValue={c.country}><Options list={Object.keys(COUNTRIES)} /></select></Field>
        <Field label="City"><input type="text" name="city" defaultValue={c.city} /></Field>
        <Field label="Website"><input type="url" name="website" defaultValue={c.website} placeholder="https://" /></Field>
        <Field label="Commercial registration / trade licence no."><input type="text" name="licenseNo" defaultValue={c.licenseNo} /></Field>
        <Field label="Contact person"><input type="text" name="person" defaultValue={u.name} /></Field>
        <Field label="About the company" full><textarea name="about" defaultValue={c.about} /></Field>
        <div className="full row"><button className="btn pri" type="submit">Save profile</button>
          {c.verify === "verified" ? <Pill s="verified" /> : c.verify === "pending" ? <Pill s="pending" /> :
            <button className="btn" type="button" onClick={() => act("emp.requestVerify")}>Submit for verification</button>}</div>
      </form>
    </>;
  }

  if (t === "post") {
    const e0 = ui.editJob ? S.jobs.find(j => j.id === ui.editJob) : null;
    const j = e0 || blankJob(c.country || "Saudi Arabia", c.industry || "Construction");
    const noCredit = S.settings.paidPosting && !e0 && (u.credits || 0) < 1;
    const submit = async e => {
      const [d, fd] = formData(e);
      if (Number(d.salaryMax) < Number(d.salaryMin)) return toast("“Salary to” must be equal to or higher than “Salary from”.");
      const r = await act("emp.jobSave", { ...d, id: e0?.id, benefits: fd.getAll("benefits") });
      if (r) { ui.editJob = null; ui.tab.employer = "jobs"; commit(); }
    };
    body = <>
      <h2>{e0 ? "Edit job" : "Post a new job"}</h2>
      {u.status !== "active" && <div className="notice">Job posting opens after the admin approves your account.</div>}
      {noCredit && <div className="notice">You have no job post credits. <button className="btn link sm" onClick={() => setTab("employer", "package")}>Buy a package</button></div>}
      {S.settings.moderation && <p className="muted small">New and edited jobs are reviewed by the agency before they go live.</p>}
      <form className="card fgrid" onSubmit={submit} key={e0?.id || "new"}>
        <JobFields j={j} />
        <div className="full row"><button className="btn pri" type="submit" disabled={u.status !== "active" || noCredit}>{e0 ? "Save changes" : "Submit job"}</button>
          {e0 && <button className="btn" type="button" onClick={() => { ui.editJob = null; setTab("employer", "jobs"); }}>Cancel</button>}</div>
      </form>
    </>;
  }

  if (t === "jobs") {
    const state = (j, v) => act("emp.jobState", { id: j.id, v });
    body = <>
      <div className="row between"><h2>My jobs</h2><button className="btn pri sm" onClick={() => { ui.editJob = null; setTab("employer", "post"); }}><LuPlus /> Post a job</button></div>
      <div className="tbl"><table><thead><tr><th>Job</th><th>Status</th><th>Applicants</th><th>Deadline</th><th>Actions</th></tr></thead><tbody>
        {myJobs.length ? myJobs.map(j => (
          <tr key={j.id}><td><a href={`#job-${j.id}`}>{j.title}</a><div className="muted small">{j.city}, {j.country}</div></td><td><Pill s={j.status} /></td><td className="num">{appsFor(j.id).length}</td><td>{fdate(j.deadline)}</td>
            <td><div className="row tight nowrap">
              <button className="btn sm" onClick={() => { ui.editJob = j.id; setTab("employer", "post"); }}><LuPencil /> Edit</button>
              {j.status === "active" && <ShareButton j={j} small />}
              {j.status === "active" && <button className="btn sm" onClick={() => state(j, "paused")}><LuPause /> Pause</button>}
              {j.status === "paused" && <button className="btn sm" onClick={() => state(j, "active")}><LuPlay /> Resume</button>}
              {["active", "paused"].includes(j.status) && <button className="btn sm danger" onClick={() => state(j, "closed")}><LuCircleX /> Close</button>}
              {j.status === "closed" && <button className="btn sm" onClick={() => state(j, "reopen")}><LuRotateCcw /> Reopen</button>}
              <button className="btn sm" onClick={() => { ui.appFilter = { job: j.id, status: "" }; setTab("employer", "applicants"); }}><LuUsers /> Applicants</button>
            </div></td></tr>
        )) : <tr><td colSpan={5}><Empty>No jobs yet.</Empty></td></tr>}
      </tbody></table></div>
    </>;
  }

  if (t === "applicants") {
    const f = ui.appFilter;
    const L = myApps.filter(a => (!f.job || a.jobId === f.job) && (!f.status || a.status === f.status));
    const setF = p => { ui.appFilter = { ...f, ...p }; commit(); };
    body = <>
      <h2>Applicants</h2>
      <div className="row">
        <select className="auto" value={f.job} onChange={e => setF({ job: e.target.value })} aria-label="Filter by job"><option value="">All jobs</option>{myJobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}</select>
        <select className="auto" value={f.status} onChange={e => setF({ status: e.target.value })} aria-label="Filter by status"><option value="">All statuses</option>{[...STAGES, "rejected"].map(s => <option key={s} value={s}>{LABEL[s]}</option>)}</select>
      </div>
      <ApplicantTable list={L} full />
    </>;
  }

  if (t === "package") {
    const orders = S.orders.filter(o => o.uid === u.id);
    const buy = p => act("emp.buy", { pkgId: p.id });
    body = <>
      <h2>Job posting packages</h2><p className="muted">Credits remaining: <b className="num">{u.credits || 0}</b> job posts · <b className="num">{u.featuredCredits || 0}</b> featured</p>
      <div className="grid g3">{S.packages.map(p => <div className="card stack8" key={p.id}><h3>{p.name}</h3><div className="sal num">{p.price ? `BDT ${num(p.price)}` : "Free"}</div><div className="muted small">{p.posts} job post{p.posts > 1 ? "s" : ""} · {p.featured} featured</div><button className="btn pri sm mtauto" onClick={() => buy(p)}>{p.price ? "Request package" : "Claim"}</button></div>)}</div>
      <div className="card"><h3 className="mb12">My orders</h3>{orders.length ? <div className="tbl"><table><thead><tr><th>Package</th><th>Amount</th><th>Date</th><th>Status</th></tr></thead><tbody>{orders.map(o => <tr key={o.id}><td>{o.name}</td><td className="num">BDT {num(o.price)}</td><td>{fdate(o.at)}</td><td><Pill s={o.status} /></td></tr>)}</tbody></table></div> : <p className="muted">No orders yet.</p>}
        <p className="muted small mt12">Paid packages are activated by the agency after payment is received (bKash, bank or cash at the office). Online card payment can be connected on the live server.</p></div>
    </>;
  }

  if (t === "notifications") body = <NotifPanel u={u} />;

  return (
    <div className="wrap dash">
      <Rail role="employer" items={[["overview", "Overview", LuLayoutDashboard], ["company", "Company profile", LuBuilding2], ["post", ui.editJob ? "Edit job" : "Post a job", LuPlus], ["jobs", "My jobs", LuBriefcase, myJobs.length], ["applicants", "Applicants", LuUsers, myApps.filter(a => a.status === "applied").length], ...(S.settings.paidPosting ? [["package", "Packages", LuPackage]] : [])]} />
      <div className="panel">{body}</div>
    </div>
  );
}
