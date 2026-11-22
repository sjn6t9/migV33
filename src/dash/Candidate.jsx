import React, { useState } from "react";
import {
  LuLayoutDashboard, LuUser, LuFileText, LuBookmark, LuBell, LuMail, LuUpload, LuTrash2, LuStamp, LuSend, LuEye,
  LuCamera, LuDownload, LuCircleCheck, LuCircle, LuArrowLeft, LuArrowRight, LuMapPin, LuBriefcase, LuSearch, LuTicket, LuPlaneTakeoff
} from "react-icons/lu";
import { store, commit, job, live, company, money, isHourly, fdate, kb, completeness, unread, bdtFmt, COUNTRIES, CATS } from "../store.js";
import { FlightSearch, FlightRequest, TicketFlight } from "./Flights.jsx";
import { toast, formData, withdraw, setTab, openModal, readUpload, downloadFile, fileExt, act, DOC_TYPES } from "../actions.js";
import { Rail, Tiles, Pipe, ClPipe, Pill, Empty, JobCard, CardDownload, Avatar } from "../ui.jsx";
import { NotifPanel, Field, Options, ClCountryOptions } from "./shared.jsx";

const ui = store.ui;

function AppRow({ a }) {
  const j = job(a.jobId); if (!j) return null;
  return (
    <div className="listrow">
      <div className="row between"><div><a href={`#job-${j.id}`}><b>{j.title}</b></a> <span className="muted small">· {company(j)} · {j.city}, {j.country}</span></div><Pill s={a.status} /></div>
      <Pipe a={a} />
      <div className="row between mt6"><span className="muted small">Applied {fdate(a.appliedAt)} · Last update {fdate(a.history[a.history.length - 1].at)}</span>
        {["applied", "shortlisted"].includes(a.status) && <button className="btn sm link danger" onClick={() => withdraw(a.id)}>Withdraw</button>}</div>
    </div>
  );
}

/* What a job seeker must have before applying */
export const applyChecks = u => {
  const p = u.profile || {};
  return [["Full name", !!u.name], ["Mobile number", !!p.phone], ["Passport number", !!p.passportNo], ["Trade / profession", !!p.trade], ["Profile photo", !!p.photo], ["CV uploaded", !!p.cv]];
};

/* ---------- uploads: profile photo, passport copy, CV ---------- */
function Uploads({ u }) {
  const p = u.profile;
  const up = (key, opts, okMsg) => async e => {
    const f = e.target.files[0]; const input = e.target; if (!f) return;
    try {
      const file = key === "cv" ? await readUpload(f, { word: true, pdfMaxMB: 5, imageMax: 1600 }) : await readUpload(f, opts);
      await act("cand.upload", { key, file });
    } catch (err) { toast(err.message); }
    input.value = "";
  };
  const remove = key => act("cand.removeFile", { key });
  return (
    <div className="grid g3">
      <div className="card stack8 upcard">
        <h4><LuCamera /> Profile photo</h4>
        <div className="row"><Avatar name={u.name} src={p.photo?.data} size={72} /><span className="muted small">{p.photo ? "Photo uploaded" : "A clear face photo with a plain background."}</span></div>
        <label className="btn sm"><LuUpload /> {p.photo ? "Change photo" : "Upload Profile Photo"}<input type="file" accept="image/*" hidden onChange={up("photo", { imageMax: 480, photo: true }, "Profile photo uploaded.")} /></label>
        {p.photo && <button className="btn sm link danger" onClick={() => remove("photo")}>Remove photo</button>}
      </div>
      <div className="card stack8 upcard">
        <h4><LuFileText /> Passport copy</h4>
        {p.passportFile ? <div className="small"><b>{p.passportFile.name}</b> · {kb(p.passportFile.size)}</div> : <span className="muted small">Scan or photo of the passport information page. PDF or JPG.</span>}
        <label className="btn sm"><LuUpload /> {p.passportFile ? "Replace passport" : "Upload Passport"}<input type="file" accept={DOC_TYPES} hidden onChange={up("passportFile", { imageMax: 1600 }, "Passport copy uploaded.")} /></label>
        {p.passportFile && <div className="row tight"><button className="btn sm" onClick={() => downloadFile(p.passportFile.data, `Passport-${p.passportNo || "copy"}.${fileExt(p.passportFile)}`)}><LuDownload /> Download</button><button className="btn sm link danger" onClick={() => remove("passportFile")}>Remove</button></div>}
      </div>
      <div className="card stack8 upcard">
        <h4><LuFileText /> CV</h4>
        {p.cv ? <div className="small"><b>{p.cv.name}</b> · {kb(p.cv.size)}</div> : <span className="muted small">PDF, DOC or DOCX, up to 5 MB.</span>}
        <label className="btn sm"><LuUpload /> {p.cv ? "Replace CV" : "Upload CV"}<input type="file" accept=".pdf,.doc,.docx" hidden onChange={up("cv", {}, "CV uploaded.")} /></label>
        {p.cv && <button className="btn sm link danger" onClick={() => remove("cv")}><LuTrash2 /> Remove CV</button>}
      </div>
    </div>
  );
}

function ProfileForm({ u, onSaved, submitLabel = "Save profile" }) {
  const p = u.profile || {};
  const save = async e => {
    const [d] = formData(e);
    const r = await act("cand.profile", d, { quiet: !!onSaved }); if (r && onSaved) onSaved();
  };
  return (
    <form className="card fgrid" onSubmit={save} key={u.id}>
      <Field label="Full name (as in passport)"><input type="text" name="name" defaultValue={u.name} required /></Field>
      <Field label="Mobile number"><input type="tel" name="phone" defaultValue={p.phone} required /></Field>
      <Field label="Passport number" hint="Also used on the Track Status page"><input type="text" name="passportNo" defaultValue={p.passportNo} /></Field>
      <Field label="Passport expiry"><input type="date" name="passportExpiry" defaultValue={p.passportExpiry} /></Field>
      <Field label="Passport status" hint="If you have no passport yet"><select name="passport" defaultValue={p.passport || "No"}><Options list={["Yes", "Applied", "No"]} /></select></Field>
      <Field label="Home district"><input type="text" name="district" defaultValue={p.district} /></Field>
      <Field label="Trade / profession"><input type="text" name="trade" defaultValue={p.trade} placeholder="e.g. Electrician" required={!!onSaved} /></Field>
      <Field label="Years of experience"><input type="number" name="experience" min="0" max="40" defaultValue={p.experience} /></Field>
      <Field label="Languages"><input type="text" name="languages" defaultValue={p.languages} /></Field>
      <Field label="Skills" full><input type="text" name="skills" defaultValue={p.skills} /></Field>
      <Field label="Preferred countries" full><input type="text" name="countries" defaultValue={p.countries} /></Field>
      <div className="full"><button className="btn pri" type="submit">{submitLabel}</button></div>
    </form>
  );
}

/* ---------- Applications: Job → Select Job Post → Update Profile → Apply ---------- */
function ApplyFlow({ u, apps }) {
  const st = ui.apply || { step: 1, jobId: "" };
  const set = patch => { ui.apply = { ...st, ...patch }; commit(); window.scrollTo(0, 0); };
  const [q, setQ] = useState(""); const [country, setCountry] = useState("");
  const applied = new Set(apps.map(a => a.jobId));
  const j = st.jobId ? job(st.jobId) : null;
  const checks = applyChecks(u); const ready = checks.every(c => c[1]);
  const steps = ["Select job post", "Update profile", "Apply"];
  const Stepper = () => <ol className="wizard">{steps.map((s, i) => <li key={s} className={st.step === i + 1 ? "cur" : st.step > i + 1 ? "done" : ""}><span>{i + 1}</span>{s}</li>)}</ol>;

  if (st.step === 1) {
    const L = live().filter(x => (!country || x.country === country) && (!q || `${x.title} ${x.city} ${x.category}`.toLowerCase().includes(q.toLowerCase())));
    return <div className="card stack">
      <Stepper />
      <h3>Step 1 · Select a job post</h3>
      <div className="row"><label className="f grow">Search<input type="text" value={q} onChange={e => setQ(e.target.value)} placeholder="Title, trade or city" /></label>
        <label className="f">Country<select value={country} onChange={e => setCountry(e.target.value)}><option value="">All countries</option>{Object.keys(COUNTRIES).map(c => <option key={c}>{c}</option>)}</select></label></div>
      <div className="joblist">{L.length ? L.map(x => {
        const done = applied.has(x.id);
        return <label key={x.id} className={`jobpick${st.jobId === x.id ? " on" : ""}${done ? " dim" : ""}`}>
          <input type="radio" name="job" checked={st.jobId === x.id} disabled={done} onChange={() => set({ jobId: x.id })} />
          <div className="grow"><b>{x.title}</b> {company(x) ? <span className="muted small">· {company(x)}</span> : null}
            <div className="meta"><span><LuMapPin /> {x.city}, {x.country}</span><span><LuBriefcase /> {x.type} · {x.contract} yr</span><span className="sal-inline">{money(x.salaryMin, x.currency)}+ {isHourly(x) ? "/hour" : "/month"}</span></div></div>
          {done ? <span className="pill p-applied">Applied</span> : <a href={`#job-${x.id}`} className="small" onClick={e => e.stopPropagation()}>Details</a>}
        </label>;
      }) : <Empty>No jobs match. Clear the search.</Empty>}</div>
      <div className="row"><button className="btn pri" disabled={!st.jobId} onClick={() => set({ step: 2 })}>Next: update profile <LuArrowRight /></button></div>
    </div>;
  }
  if (!j || j.status !== "active") return <div className="card stack"><Stepper /><div className="notice">This job is no longer open.</div><button className="btn" onClick={() => set({ step: 1, jobId: "" })}><LuArrowLeft /> Choose another job</button></div>;
  if (applied.has(j.id)) return <div className="card stack"><Stepper /><div className="notice ok">You already applied for {j.title}.</div><button className="btn" onClick={() => set({ step: 1, jobId: "" })}>Apply for another job</button></div>;

  const JobLine = () => <div className="notice row between"><span>Applying for <b>{j.title}</b>{company(j) ? <> · {company(j)}</> : null} · {j.city}, {j.country} · {money(j.salaryMin, j.currency)}+</span><button className="btn sm link" onClick={() => set({ step: 1 })}>Change job</button></div>;
  if (st.step === 2) return <div className="stack">
    <div className="card stack"><Stepper /><h3>Step 2 · Update your profile</h3><JobLine />
      <div className="checklist">{checks.map(([l, ok]) => <span key={l} className={ok ? "ok" : ""}>{ok ? <LuCircleCheck /> : <LuCircle />} {l}</span>)}</div></div>
    <Uploads u={u} />
    <ProfileForm u={u} submitLabel="Save & continue" onSaved={() => set({ step: 3 })} />
    <div className="row"><button className="btn" onClick={() => set({ step: 1 })}><LuArrowLeft /> Back</button>{ready && <button className="btn" onClick={() => set({ step: 3 })}>Continue without changes <LuArrowRight /></button>}</div>
  </div>;

  const p = u.profile;
  const send = async e => { e.preventDefault(); const r = await act("cand.apply", { jobId: j.id }); if (r) { ui.apply = null; commit(); } };
  return <form className="card stack" onSubmit={send}>
    <Stepper /><h3>Step 3 · Review and apply</h3><JobLine />
    <div className="row"><Avatar name={u.name} src={p.photo?.data} size={64} /><div><b>{u.name}</b><div className="muted small">{p.trade || "—"} · {p.experience || 0} yr · {p.district || "—"}</div><div className="small">Mobile {p.phone || "—"} · Passport {p.passportNo || "—"}</div></div></div>
    <div className="checklist">{checks.map(([l, ok]) => <span key={l} className={ok ? "ok" : "bad"}>{ok ? <LuCircleCheck /> : <LuCircle />} {l}</span>)}</div>
    {!ready && <div className="notice">Complete the missing items in step 2 before applying.</div>}
    <label className="check"><input type="checkbox" required /> I confirm that the information and documents in my profile are correct.</label>
    <div className="row"><button type="button" className="btn" onClick={() => set({ step: 2 })}><LuArrowLeft /> Back</button><button className="btn pri" type="submit" disabled={!ready}><LuSend /> Apply</button></div>
  </form>;
}

/* ---------- BMET clearance: Select country → name, passport no, documents ---------- */
function ClearanceForm({ u }) {
  const p = u.profile || {};
  const [busy, setBusy] = useState(false);
  const submit = async e => {
    const [d, fd] = formData(e); const form = e.currentTarget;
    const pick = name => { const f = fd.get(name); return f && f.size ? f : null; };
    const passF = pick("passportCopy"), visaF = pick("visaCopy"), contractF = pick("contract"), others = fd.getAll("others").filter(f => f && f.size);
    if (!passF && !p.passportFile) return toast("Upload the passport copy.");
    if (!visaF) return toast("Upload the visa copy.");
    if (others.length > 3) return toast("Upload at most 3 other documents.");
    setBusy(true);
    try {
      const files = {
        passport: passF ? await readUpload(passF, { imageMax: 1800 }) : null,
        visa: await readUpload(visaF, { imageMax: 1600 }),
        contract: contractF ? await readUpload(contractF, { imageMax: 1600 }) : null,
        others: await Promise.all(others.map(f => readUpload(f, { imageMax: 1400 })))
      };
      const r = await act("cand.clearance", { country: d.country, fullName: d.fullName, passportNo: d.passportNo, files });
      if (r) form.reset();
    } catch (err) { toast(err.message); } finally { setBusy(false); }
  };
  return (
    <form className="card fgrid" onSubmit={submit}>
      <h3 className="full">New clearance application</h3>
      <Field label="Select country"><select name="country" required defaultValue=""><option value="" disabled>Choose destination country</option><ClCountryOptions /></select></Field>
      <Field label="Full name (as in passport)"><input type="text" name="fullName" defaultValue={u.name.replace(" (sample)", "")} required /></Field>
      <Field label="Passport number"><input type="text" name="passportNo" defaultValue={p.passportNo} required /></Field>
      <Field label="Upload passport copy" hint={p.passportFile ? `Leave empty to use the passport in your profile (${p.passportFile.name})` : "PDF or JPG"}><input type="file" name="passportCopy" accept={DOC_TYPES} required={!p.passportFile} /></Field>
      <Field label="Upload visa copy" hint="PDF or JPG"><input type="file" name="visaCopy" accept={DOC_TYPES} required /></Field>
      <Field label="Upload employment contract (optional)"><input type="file" name="contract" accept={DOC_TYPES} /></Field>
      <Field label="Upload other documents (optional)" hint="Up to 3 files, e.g. training certificate, medical report"><input type="file" name="others" accept={DOC_TYPES} multiple /></Field>
      <div className="full"><button className="btn pri" type="submit" disabled={busy}><LuSend /> {busy ? "Uploading…" : "Submit application"}</button></div>
    </form>
  );
}

export function Candidate({ u }) {
  const S = store.S; const t = ui.tab.candidate;
  const apps = S.applications.filter(a => a.candidateId === u.id).sort((a, b) => b.appliedAt.localeCompare(a.appliedAt));
  const pc = completeness(u);
  let body;

  if (t === "overview") body = <>
    <div className="row"><Avatar name={u.name} src={u.profile?.photo?.data} size={56} /><h2>Welcome, {u.name.replace(" (sample)", "")}</h2></div>
    <Tiles items={[[apps.length, "Applications"], [apps.filter(a => !["applied", "hired", "rejected"].includes(a.status)).length, "In progress"], [u.saved.length, "Saved jobs"], [`${pc}%`, "Profile complete"]]} />
    {!applyChecks(u).every(c => c[1]) && <div className="notice">Complete your profile (photo, passport number, CV) so you can apply for jobs. <button className="btn link sm" onClick={() => setTab("candidate", "profile")}>Go to profile</button></div>}
    <div className="row"><button className="btn pri" onClick={() => { ui.apply = { step: 1, jobId: "" }; setTab("candidate", "applications"); }}><LuSearch /> Apply for a job</button><button className="btn" onClick={() => setTab("candidate", "clearance")}><LuStamp /> BMET clearance</button></div>
    <div className="card"><div className="row between mb12"><h3>Latest applications</h3><button className="btn sm" onClick={() => setTab("candidate", "applications")}>View all</button></div>
      {apps.length ? apps.slice(0, 3).map(a => <AppRow key={a.id} a={a} />) : <Empty>You have not applied yet.</Empty>}</div>
  </>;

  if (t === "profile") body = <>
    <h2>Profile &amp; CV</h2>
    <div className="card"><div className="row between"><span>Profile completeness</span><b className="num">{pc}%</b></div><div className="prog mt8"><i style={{ width: `${pc}%` }} /></div></div>
    <Uploads u={u} />
    <ProfileForm u={u} />
  </>;

  if (t === "applications") body = <>
    <div className="row between"><h2>Applications</h2>{!ui.apply && <button className="btn pri" onClick={() => { ui.apply = { step: 1, jobId: "" }; commit(); }}><LuSearch /> Apply for a job</button>}</div>
    {ui.apply && <><ApplyFlow u={u} apps={apps} /><button className="btn sm link" onClick={() => { ui.apply = null; commit(); }}>Cancel application</button></>}
    <div className="card"><h3 className="mb6">My applications</h3>{apps.length ? apps.map(a => <AppRow key={a.id} a={a} />) : <Empty>No applications yet.</Empty>}</div>
  </>;

  if (t === "saved") {
    const L = u.saved.map(job).filter(Boolean);
    body = <><h2>Saved jobs</h2><div className="grid g2">{L.length ? L.map(j => <JobCard key={j.id} j={j} />) : <Empty>No saved jobs. Tap the bookmark on any job to save it.</Empty>}</div></>;
  }

  if (t === "clearance") {
    const C = S.clearances.filter(c => c.candidateId === u.id).sort((a, b) => b.created.localeCompare(a.created));
    const openFile = C.find(c => c.status !== "rejected" && !c.card);
    body = <>
      <h2>BMET clearance</h2>
      <p className="muted">Apply for BMET emigration clearance once your visa is ready. When it is approved, your clearance card appears here to download.</p>
      {openFile ? <div className="notice">You already have a clearance file in progress. You can apply again after it is completed or rejected.</div> : <ClearanceForm u={u} />}
      <div className="card"><h3 className="mb6">My clearance files</h3>
        {C.length ? C.map(c => (
          <div className="listrow" key={c.id}>
            <div className="row between"><div><b>{c.country}</b> <span className="muted small">· {c.fullName || u.name} · {c.passportNo || u.profile?.passportNo}</span></div><Pill s={c.status} label={c.status === "custom" ? c.statusText : undefined} /></div>
            <ClPipe c={c} />
            {c.card && <div className="mt8"><CardDownload c={c} /></div>}
            {c.status === "approved" && !c.card && <p className="muted small mt6">Approved. The agency will send your clearance card here.</p>}
            <div className="row between mt6"><span className="muted small">Submitted {fdate(c.created)} · {c.docs.length} document(s)</span><button className="btn sm link" onClick={() => openModal("clearance", { cid: c.id })}><LuEye /> Details</button></div>
          </div>)) : <Empty>No clearance applications yet.</Empty>}
      </div>
    </>;
  }

  if (t === "alerts") {
    const a = u.alerts || { on: false, freq: "daily", cats: [], countries: [] };
    const save = e => { const [d, fd] = formData(e); act("cand.alerts", { on: !!d.on, freq: d.freq, cats: fd.getAll("cats"), countries: fd.getAll("countries") }); };
    body = <>
      <h2>Email job alerts</h2>
      <form className="card stack16" onSubmit={save} key={u.id}>
        <label className="check"><input type="checkbox" name="on" defaultChecked={a.on} /> <LuMail /> Send me job alerts at <b>{u.email}</b></label>
        <Field label="How often"><select name="freq" defaultValue={a.freq} className="w260"><Options list={[["instant", "As soon as a job is posted"], ["daily", "Daily summary"], ["weekly", "Weekly summary"]]} /></select></Field>
        <fieldset className="plain"><legend className="small b">Categories</legend><div className="grid checkgrid">{CATS.map(c => <label key={c} className="check"><input type="checkbox" name="cats" value={c} defaultChecked={a.cats.includes(c)} /> {c}</label>)}</div></fieldset>
        <fieldset className="plain"><legend className="small b">Countries</legend><div className="grid checkgrid">{Object.keys(COUNTRIES).map(c => <label key={c} className="check"><input type="checkbox" name="countries" value={c} defaultChecked={a.countries.includes(c)} /> {c}</label>)}</div></fieldset>
        <div><button className="btn pri" type="submit">Save alert settings</button></div>
        <p className="muted small">In this demo, matching alerts appear under Notifications. On the live server they are also emailed.</p>
      </form>
    </>;
  }

  if (t === "tickets") {
    const T = (S.tickets || []).filter(x => x.candidateId === u.id).sort((a, b) => b.created.localeCompare(a.created));
    const fp = ui.flightPick;
    const send = async d => { if (await act("cand.ticket", d)) { ui.flightPick = null; commit(); } };
    const manual = e => { e.preventDefault(); const d = Object.fromEntries(new FormData(e.currentTarget)); const form = e.currentTarget; act("cand.ticket", d).then(r => r && form.reset()); };
    body = <>
      <h2>Air tickets</h2>
      <p className="muted">Search live fares and send the flight you want. The agency confirms the fare, books the ticket and sends you the PNR here.</p>
      {fp ? <FlightRequest pick={fp.f} q={fp.q} onClose={() => { ui.flightPick = null; commit(); }} onSend={send}>
        <Field label="Passenger name (as in passport)"><input type="text" name="name" required maxLength={120} defaultValue={u.name} /></Field>
        <Field label="Passport number"><input type="text" name="passport" required maxLength={15} defaultValue={u.profile?.passportNo || ""} autoCapitalize="characters" /></Field>
        <Field label="Mobile"><input type="tel" name="phone" maxLength={30} defaultValue={u.profile?.phone || ""} /></Field>
      </FlightRequest> : <FlightSearch onPick={(f, q) => { ui.flightPick = { f, q }; commit(); window.scrollTo({ top: 0, behavior: "smooth" }); }} />}
      <details className="vf-det mt14" open={!S.flightsReady}><summary>Or send a request without choosing a flight</summary>
        <form className="card fgrid" onSubmit={manual}>
          <Field label="Passenger name"><input type="text" name="name" required defaultValue={u.name} /></Field>
          <Field label="Passport number"><input type="text" name="passport" required defaultValue={u.profile?.passportNo || ""} /></Field>
          <Field label="From"><input type="text" name="from" defaultValue="Dhaka (DAC)" required /></Field>
          <Field label="To (city / airport)"><input type="text" name="to" required placeholder="e.g. Riyadh (RUH)" /></Field>
          <Field label="Preferred date"><input type="date" name="prefDate" required /></Field>
          <Field label="Notes" full><input type="text" name="notes" placeholder="Airline preference, baggage, etc." /></Field>
          <div className="full"><button className="btn pri" type="submit"><LuPlaneTakeoff /> Request ticket</button></div>
        </form></details>
      <h3 className="mt14">My ticket requests</h3>
      <div className="tbl"><table><thead><tr><th>Route</th><th>Date</th><th>Booking</th><th>Status</th><th></th></tr></thead><tbody>
        {T.length ? T.map(x => <tr key={x.id}><td>{x.from} → {x.to}<TicketFlight x={x} /></td><td>{fdate(x.prefDate)}</td>
          <td>{x.status === "booked" ? <>{x.airline} · PNR <b>{x.pnr || "—"}</b><div className="muted small">Flight {fdate(x.flightDate)}{x.fare ? ` · ${bdtFmt(x.fare)}` : ""}</div></> : "—"}</td>
          <td><Pill s={x.status} /></td><td>{x.status === "requested" && <button className="btn sm link danger" onClick={() => act("cand.ticketCancel", { id: x.id })}>Cancel</button>}</td></tr>)
          : <tr><td colSpan={5}><Empty>No ticket requests yet.</Empty></td></tr>}
      </tbody></table></div>
    </>;
  }

  if (t === "notifications") body = <NotifPanel u={u} />;

  return (
    <div className="wrap dash">
      <Rail role="candidate" items={[["overview", "Overview", LuLayoutDashboard], ["profile", "Profile & CV", LuUser], ["applications", "Applications", LuFileText, apps.length], ["clearance", "BMET clearance", LuStamp, S.clearances.filter(c => c.candidateId === u.id && c.card).length], ["tickets", "Air tickets", LuTicket, (S.tickets || []).filter(x => x.candidateId === u.id && x.status === "booked").length], ["saved", "Saved jobs", LuBookmark, u.saved.length], ["alerts", "Job alerts", LuMail]]} />
      <div className="panel">{body}</div>
    </div>
  );
}
