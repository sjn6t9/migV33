import React from "react";
import {
  LuLayoutDashboard, LuUsers, LuBriefcase, LuFileText, LuStamp, LuWallet, LuPackage, LuNewspaper, LuSearch, LuSettings, LuMessageSquare,
  LuCheck, LuX, LuTrash2, LuPencil, LuEye, LuEyeOff, LuBadgeCheck, LuRotateCcw, LuBan, LuTicket, LuUpload, LuImage, LuUserCog, LuImagePlus, LuQuote, LuGalleryHorizontal, LuArrowUp, LuArrowDown, LuTimer, LuPlus, LuDownload
} from "react-icons/lu";
import { FaWhatsapp, FaFacebookF, FaYoutube, FaLinkedinIn, FaTiktok } from "react-icons/fa6";
import { clStage, STAFF_PERMS, TEAM_DEPTS, store, commit, user, job, worker, company, live, money, num, fdate, bdtFmt, balanceOf, candOf, clPerson, clOpen, cardPending, now, COUNTRIES, STAGES, CL_STAGES, CL_DOCS, PAY_METHODS, PAGES, LABEL } from "../store.js";
import { toast, formData, setTab, openModal, confirmBox, deleteUser, act, readUpload, compressImage } from "../actions.js";
import { downloadFile as dlFile } from "../actions.js";
import { Rail, Tiles, Pill, Empty, Bars, Stars, Avatar } from "../ui.jsx";
import { LedgerTable, StatusSelect, Field, Options, JobFields, blankJob } from "./shared.jsx";
import { setClStatus } from "../actions.js";
import { ShareButton, storeCard } from "../Share.jsx";

const ui = store.ui;
const openCl = clOpen;

function FilterButtons({ items, cur, onPick }) {
  return <div className="row">{items.map(([k, t, n]) => <button key={k} className={`btn sm${cur === k ? " pri" : ""}`} onClick={() => onPick(k)}>{t}{n !== undefined ? ` (${n})` : ""}</button>)}</div>;
}

const TABS = [
  ["overview", "Overview", LuLayoutDashboard], ["users", "Accounts", LuUsers], ["jobs", "Job moderation", LuBriefcase], ["apps", "Applications", LuFileText],
  ["clearance", "BMET clearance", LuStamp], ["tickets", "Air tickets", LuTicket], ["ledger", "Agent accounts", LuWallet], ["packages", "Payments & packages", LuPackage],
  ["content", "Website content", LuImage], ["slides", "Home slideshow", LuGalleryHorizontal], ["blog", "Blog", LuNewspaper], ["seo", "SEO", LuSearch], ["settings", "Site settings", LuSettings],
  ["messages", "Messages", LuMessageSquare], ["staff", "Staff & permissions", LuUserCog]
];

export function Admin({ u }) {
  const S = store.S; const R = u.role; const isAdmin = R === "admin";
  const can = k => k === "overview" || isAdmin || (k !== "staff" && u.perms?.includes(k === "slides" ? "content" : k));
  if (!can(ui.tab[R])) ui.tab[R] = "overview";
  const t = ui.tab[R];
  const go = tab => setTab(R, tab);
  const agents = S.users.filter(x => x.role === "agent");
  const pendU = S.users.filter(x => x.status === "pending" || x.company?.verify === "pending").length;
  const pendJ = S.jobs.filter(j => j.status === "pending").length;
  const newMsg = S.messages.filter(m => !m.read).length;
  const pendO = S.orders.filter(o => o.status === "pending").length;
  const pendC = S.clearances.filter(c => c.status === "pending" || cardPending(c)).length;
  const pendP = S.ledger.filter(l => l.status === "pending").length;
  const pendT = S.tickets.filter(x => x.status === "requested").length;
  let body;

  if (t === "tickets") {
    const T = [...S.tickets].sort((a, b) => (a.status === "requested" ? -1 : 0) - (b.status === "requested" ? -1 : 0) || b.created.localeCompare(a.created));
    const sel = ui.bookTicket ? S.tickets.find(x => x.id === ui.bookTicket) : null;
    const book = async e => {
      const [d] = formData(e);
      const r = await act("admin.ticketBook", { id: sel.id, airline: d.airline, pnr: d.pnr, flightDate: d.flightDate, fare: d.fare, charge: !!d.charge });
      if (r) { ui.bookTicket = null; commit(); }
    };
    body = <>
      <h2>Air ticket requests</h2>
      <div className="tbl"><table><thead><tr><th>Worker</th><th>Agent</th><th>Route</th><th>Preferred</th><th>Booking</th><th>Status</th><th></th></tr></thead><tbody>
        {T.length ? T.map(x => { const w = worker(x.workerId) || { name: "Removed worker" }; const ag = user(x.agentId); return (
          <tr key={x.id} className={sel?.id === x.id ? "sel" : ""}><td><b>{w.name}</b><div className="muted small">{w.passport}</div></td><td>{ag?.agent?.business || "—"}</td><td>{x.from} → {x.to}{x.notes && <div className="muted small">{x.notes}</div>}</td><td>{fdate(x.prefDate)}</td>
            <td>{x.status === "booked" ? <>{x.airline} · <b>{x.pnr}</b><div className="muted small">{fdate(x.flightDate)}{x.fare ? ` · ${bdtFmt(x.fare)}` : ""}</div></> : "—"}</td><td><Pill s={x.status} /></td>
            <td><div className="row tight nowrap">{x.status === "requested" && <><button className="btn sm pri" onClick={() => { ui.bookTicket = x.id; commit(); }}><LuTicket /> Book</button><button className="btn sm danger" onClick={() => act("admin.ticketCancel", { id: x.id })}><LuX /> Cancel</button></>}</div></td></tr>); })
          : <tr><td colSpan={7}><Empty>No ticket requests.</Empty></td></tr>}
      </tbody></table></div>
      {sel && <form className="card fgrid" onSubmit={book} key={sel.id}>
        <h3 className="full">Book ticket: {worker(sel.workerId)?.name} · {sel.from} → {sel.to}</h3>
        <Field label="Airline"><input type="text" name="airline" required /></Field>
        <Field label="PNR / booking reference"><input type="text" name="pnr" required /></Field>
        <Field label="Flight date"><input type="date" name="flightDate" defaultValue={sel.prefDate} required /></Field>
        <Field label="Fare (BDT)"><input type="number" name="fare" min="0" /></Field>
        {sel.agentId && <label className="check full"><input type="checkbox" name="charge" defaultChecked /> Add the fare to the agent's account statement</label>}
        <div className="full row"><button className="btn pri" type="submit"><LuCheck /> Mark as booked</button><button className="btn" type="button" onClick={() => { ui.bookTicket = null; commit(); }}>Close</button></div>
      </form>}
    </>;
  }

  if (t === "content") {
    const addT = e => { const [d] = formData(e); const form = e.currentTarget; act("admin.content", { op: "testimonial", ...d }).then(r => r && form.reset()); };
    const editM = ui.editTeam ? S.team.find(m => m.id === ui.editTeam) : null;
    const addM = async e => {
      const [d, fd] = formData(e); const form = e.currentTarget; const f = fd.get("photo");
      let file = null; if (f && f.size) { try { file = await readUpload(f, { imageMax: 900, photo: true }); } catch (err) { return toast(err.message); } }
      const r = await act("admin.content", { op: editM ? "teamUpdate" : "team", id: editM?.id, ...d, file, removePhoto: !!d.removePhoto });
      if (r) { if (editM) { ui.editTeam = null; commit(); } else form.reset(); }
    };
    const addG = async e => {
      const [d, fd] = formData(e); const f = fd.get("photo"); const form = e.currentTarget;
      if (!f || !f.size) return toast("Choose a photo first.");
      if (!/^image\//.test(f.type)) return toast("Please choose an image file (JPG or WebP photo).");
      let file; try { file = await readUpload(f, { imageMax: 1600, photo: true }); } catch (err) { return toast(err.message); }
      const r = await act("admin.content", { op: "gallery", file, caption: d.caption }); if (r) form.reset();
    };
    const del = (key, id) => confirmBox("Remove this item from the website?", () => act("admin.content", { op: "remove", list: key, id }), "Remove");
    body = <>
      <h2>Website content</h2>
      <p className="muted">Sections on the home page appear only after you add content here.</p>
      <div className="card stack">
        <h3><LuQuote /> Testimonials</h3>
        <div className="notice">Add only real feedback from real candidates or employers, with their permission. Do not publish invented reviews.</div>
        <form className="fgrid" onSubmit={addT}>
          <Field label="Name"><input type="text" name="name" required /></Field>
          <Field label="Trade / role"><input type="text" name="role" placeholder="e.g. Electrician" /></Field>
          <Field label="Working in"><select name="country"><Options list={Object.keys(COUNTRIES)} blank="—" /></select></Field>
          <Field label="Rating"><select name="rating" defaultValue="5"><Options list={["5", "4", "3", "2", "1"]} /></select></Field>
          <Field label="Feedback (Bangla or English)" full><textarea name="text" className="short" required /></Field>
          <div className="full"><button className="btn pri" type="submit">Add testimonial</button></div>
        </form>
        {S.testimonials.map(x => <div key={x.id} className="listrow row between"><div><b>{x.name}</b> <span className="muted small">{x.role}{x.country ? ` · ${x.country}` : ""}</span> <Stars n={x.rating} /><div className="small">{x.text}</div></div><button className="btn sm danger" onClick={() => del("testimonials", x.id)} aria-label="Remove"><LuTrash2 /></button></div>)}
      </div>
      <div className="card stack">
        <h3><LuUsers /> Expert team <span className="muted small fw4">· shown on the Expert Team page</span></h3>
        <form className="fgrid" onSubmit={addM} key={editM?.id || "new"}>
          <h4 className="full">{editM ? `Edit ${editM.name}` : "Add a team member"}</h4>
          <Field label="Name"><input type="text" name="name" required defaultValue={editM?.name} /></Field>
          <Field label="Designation"><input type="text" name="title" required placeholder="e.g. Managing Director" defaultValue={editM?.title} /></Field>
          <Field label="Department"><select name="dept" defaultValue={editM?.dept || TEAM_DEPTS[0]}><Options list={TEAM_DEPTS} /></select></Field>
          <Field label="Years of experience"><input type="number" name="years" min="0" max="60" defaultValue={editM?.years ?? ""} /></Field>
          <Field label="Areas of expertise" hint="Separate with commas, e.g. Saudi visa, BMET clearance" full><input type="text" name="expertise" defaultValue={editM?.expertise?.join(", ")} /></Field>
          <Field label="Short bio" full><textarea name="bio" className="short" maxLength={600} defaultValue={editM?.bio} /></Field>
          <Field label="Phone (optional)"><input type="tel" name="phone" defaultValue={editM?.phone} /></Field>
          <Field label="WhatsApp (optional)" hint="With country code, e.g. 8801XXXXXXXXX"><input type="tel" name="whatsapp" defaultValue={editM?.whatsapp} /></Field>
          <Field label="Email (optional)"><input type="email" name="email" defaultValue={editM?.email} /></Field>
          <Field label="Website (optional)" hint="e.g. www.example.com"><input type="text" name="website" defaultValue={editM?.website} /></Field>
          <Field label="Display order" hint="Lower numbers show first. Also the end of the member ID on the visiting card: 12172026 + this number."><input type="number" name="order" min="0" max="999" defaultValue={editM?.order ?? 10} /></Field>
          <Field label={editM?.photo ? "Replace photo" : "Photo (optional)"} hint="A clear, professional photo. Resized automatically."><input type="file" name="photo" accept="image/*" /></Field>
          {editM?.photo && <label className="check"><input type="checkbox" name="removePhoto" /> Remove current photo</label>}
          <div className="full row"><button className="btn pri" type="submit">{editM ? "Save changes" : "Add team member"}</button>{editM && <button className="btn" type="button" onClick={() => { ui.editTeam = null; commit(); }}>Cancel</button>}</div>
        </form>
        <div className="tbl"><table><thead><tr><th>Member</th><th>Department</th><th>Order</th><th></th></tr></thead><tbody>
          {S.team.length ? S.team.map(m => <tr key={m.id}><td><div className="row tight nowrap"><Avatar name={m.name} src={m.photo?.data} size={40} /><div><b>{m.name}</b><div className="muted small">{m.title}</div></div></div></td><td>{m.dept}</td><td className="num">{m.order ?? "—"}</td>
            <td><div className="row tight nowrap"><button className="btn sm" onClick={() => { ui.editTeam = m.id; commit(); }}><LuPencil /> Edit</button><button className="btn sm danger" onClick={() => del("team", m.id)} aria-label={`Remove ${m.name}`}><LuTrash2 /></button></div></td></tr>)
            : <tr><td colSpan={4}><Empty>No team members yet. The Expert Team page shows them once added.</Empty></td></tr>}
        </tbody></table></div>
      </div>
      <div className="card stack">
        <h3><LuImagePlus /> Photo gallery</h3>
        <form className="fgrid" onSubmit={addG}>
          <Field label="Photo" hint="Photos are resized to 1200px JPEG. Use real photos of your office, departures or events."><input type="file" name="photo" accept="image/*" required /></Field>
          <Field label="Caption"><input type="text" name="caption" required placeholder="e.g. Workers departing for Riyadh" /></Field>
          <div className="full"><button className="btn pri" type="submit">Add photo</button></div>
        </form>
        <div className="grid g4">{S.gallery.map(g => <figure key={g.id} className="gal"><img src={g.src} alt={g.caption} /><figcaption className="row between"><span className="small">{g.caption}</span><button className="btn sm link danger" onClick={() => del("gallery", g.id)} aria-label="Remove photo"><LuTrash2 /></button></figcaption></figure>)}</div>
      </div>
    </>;
  }

  if (t === "staff") {
    const staff = S.users.filter(x => x.role === "staff");
    const add = e => {
      const [d, fd] = formData(e);
      const form = e.currentTarget;
      act("admin.staff", { op: "add", name: d.name, email: d.email, pass: d.pass, perms: fd.getAll("perms") }).then(r => r && form.reset());
    };
    const toggle = (x, k) => act("admin.staff", { op: "perms", id: x.id, perms: x.perms.includes(k) ? x.perms.filter(p => p !== k) : [...x.perms, k] }, { quiet: true });
    body = <>
      <h2>Staff &amp; permissions</h2>
      <p className="muted">Staff (employee) accounts sign in like everyone else and see only the sections you allow.</p>
      <form className="card fgrid" onSubmit={add}>
        <h3 className="full">Add staff member</h3>
        <Field label="Name"><input type="text" name="name" required /></Field>
        <Field label="Email (login)"><input type="email" name="email" required /></Field>
        <Field label="Password" hint="At least 6 characters"><input type="password" name="pass" minLength={6} required /></Field>
        <fieldset className="plain full"><legend className="small b">Can open</legend><div className="grid checkgrid">{STAFF_PERMS.map(([k, l]) => <label key={k} className="check"><input type="checkbox" name="perms" value={k} defaultChecked={["apps", "clearance", "tickets"].includes(k)} /> {l}</label>)}</div></fieldset>
        <div className="full"><button className="btn pri" type="submit">Create staff account</button></div>
      </form>
      {staff.length ? staff.map(x => (
        <div className="card stack8" key={x.id}>
          <div className="row between"><div className="row"><Avatar name={x.name} size={40} /><div><b>{x.name}</b><div className="muted small">{x.email}</div></div><Pill s={x.status} /></div>
            <div className="row tight">{x.status === "active" ? <button className="btn sm" onClick={() => act("admin.userState", { id: x.id, status: "suspended" })}><LuBan /> Suspend</button> : <button className="btn sm" onClick={() => act("admin.userState", { id: x.id, status: "active" })}>Reactivate</button>}<button className="btn sm danger" onClick={() => deleteUser(x.id)} aria-label={`Delete ${x.name}`}><LuTrash2 /></button></div></div>
          <div className="grid checkgrid">{STAFF_PERMS.map(([k, l]) => <label key={k} className="check"><input type="checkbox" checked={x.perms.includes(k)} onChange={() => toggle(x, k)} /> {l}</label>)}</div>
        </div>
      )) : <Empty>No staff accounts yet.</Empty>}
    </>;
  }

  if (t === "overview") {
    const byStatus = [...STAGES, "rejected"].map(s => [LABEL[s], S.applications.filter(a => a.status === s).length]);
    const byCountry = Object.keys(COUNTRIES).map(c => [c, live().filter(j => j.country === c).length]).filter(x => x[1]);
    const queue = [[pendC, "Clearance files to act on (new / card to upload)", "clearance"], [pendT, "Air ticket requests", "tickets"], [pendP, "Agent payments to confirm", "ledger"], [pendJ, "Jobs awaiting review", "jobs"], [pendU, "Accounts to approve / verify", "users"], [pendO, "Package orders", "packages"], [newMsg, "New messages", "messages"]].filter(q => q[0] && can(q[2]));
    body = <>
      <h2>System overview</h2>
      <Tiles items={[[S.users.filter(x => x.role === "candidate").length, "Candidates"], [S.users.filter(x => x.role === "employer").length, "Employers"], [agents.length, "Agents"], [live().length, "Live jobs"], [S.applications.length, "Applications"], [S.applications.filter(a => a.status === "hired").length, "Hired"], [S.clearances.filter(openCl).length, "Clearances in progress"]]} />
      {queue.length ? <div className="tiles">{queue.map(([n, l, tab]) => <button key={tab} className="tile alert tilebtn" onClick={() => go(tab)}><b>{n}</b><span>{l} →</span></button>)}</div> : <div className="notice ok">Nothing waiting for review.</div>}
      <div className="grid g2"><div className="card"><h3 className="mb12">Applications by stage</h3><Bars rows={byStatus} /></div><div className="card"><h3 className="mb12">Live jobs by country</h3>{byCountry.length ? <Bars rows={byCountry} /> : <p className="muted">No live jobs.</p>}</div></div>
      {!isAdmin && <div className="notice">Signed in as staff. You can open: {STAFF_PERMS.filter(([k]) => can(k)).map(p => p[1]).join(", ") || "overview only"}.</div>}
    </>;
  }

  if (t === "users") {
    const f = ui.userFilter;
    const L = S.users.filter(x => f === "all" || x.role === f || (f === "pending" && (x.status === "pending" || x.company?.verify === "pending")));
    const setState = (x, v) => act("admin.userState", { id: x.id, status: v });
    const verify = x => act("admin.verifyCompany", { id: x.id });
    body = <>
      <h2>Accounts</h2>
      <FilterButtons cur={f} onPick={k => { ui.userFilter = k; commit(); }} items={[["all", "All"], ["candidate", "Candidates"], ["employer", "Employers"], ["agent", "Agents"], ["pending", "Needs action"], ["staff", "Staff"], ["admin", "Admins"]]} />
      <div className="tbl"><table><thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Company / office</th><th>Joined</th><th>Actions</th></tr></thead><tbody>
        {L.map(x => (
          <tr key={x.id}><td><b>{x.name}</b><div className="muted small">{x.email}{x.profile?.phone ? ` · ${x.profile.phone}` : ""}</div></td><td>{x.role === "candidate" ? "job seeker" : x.role}</td><td><Pill s={x.status} /></td>
            <td>{x.agent ? <>{x.agent.business}<div className="muted small">Agent · {x.agent.phone} · {["photo", "nid", "tradeLicense"].filter(k => x.agent.docs?.[k]).length}/3 documents</div><button className="btn sm mt4" onClick={() => openModal("agentdocs", { uid: x.id })}><LuEye /> Documents</button></> : x.company ? <>{x.company.name}<div>{x.company.verify === "verified" ? <Pill s="verified" /> : x.company.verify === "pending" ? <Pill s="pending" /> : <span className="muted small">Not verified</span>}</div></> : "—"}</td>
            <td>{fdate(x.created)}</td>
            <td>{x.id === u.id ? <span className="muted small">You</span> : !isAdmin && ["admin", "staff"].includes(x.role) ? <span className="muted small">Admin only</span> : <div className="row tight nowrap">
              {x.status === "pending" && <button className="btn sm pri" onClick={() => setState(x, "active")}><LuCheck /> Approve</button>}
              {x.status === "unverified" && <button className="btn sm" onClick={() => act("admin.markVerified", { id: x.id })}><LuCheck /> Mark email verified</button>}
              {x.status === "active" && <button className="btn sm" onClick={() => setState(x, "suspended")}><LuBan /> Suspend</button>}
              {x.status === "suspended" && <button className="btn sm" onClick={() => setState(x, "active")}>Reactivate</button>}
              {x.company && x.company.verify !== "verified" && <button className="btn sm" onClick={() => verify(x)}><LuBadgeCheck /> Verify company</button>}
              <button className="btn sm danger" onClick={() => deleteUser(x.id)} aria-label={`Delete ${x.name}`}><LuTrash2 /></button>
            </div>}</td></tr>
        ))}
      </tbody></table></div>
    </>;
  }

  if (t === "jobs" && ui.adminJob) body = <AdminJobForm />;
  else if (t === "jobs") {
    const f = ui.jobFilter;
    const L = S.jobs.filter(j => f === "all" || j.status === f).sort((a, b) => (a.status === "pending" ? -1 : 0) - (b.status === "pending" ? -1 : 0));
    const pub = async j => { const r = await act("admin.job", { id: j.id, op: "publish" }); if (r) { const fresh = job(j.id); if (fresh) storeCard(fresh); } };
    const reject = j => act("admin.job", { id: j.id, op: "reject" });
    const del = j => confirmBox("Delete this job and its applications?", () => act("admin.job", { id: j.id, op: "delete" }), "Delete");
    body = <>
      <div className="row between"><h2>Job circulars</h2><button className="btn pri" onClick={() => { ui.adminJob = "new"; commit(); }}><LuPlus /> Post a job</button></div>
      <FilterButtons cur={f} onPick={k => { ui.jobFilter = k; commit(); }} items={["all", "pending", "active", "paused", "closed", "rejected"].map(k => [k, k[0].toUpperCase() + k.slice(1), k === "all" ? S.jobs.length : S.jobs.filter(j => j.status === k).length])} />
      <div className="tbl"><table><thead><tr><th>Job</th><th>Employer</th><th>Salary</th><th>Status</th><th>Featured</th><th>Actions</th></tr></thead><tbody>
        {L.length ? L.map(j => (
          <tr key={j.id}><td><a href={`#job-${j.id}`}>{j.title}</a><div className="muted small">{j.city}, {j.country} · {fdate(j.created)}</div></td><td>{company(j) || "—"}</td><td className="num">{money(j.salaryMin, j.currency)}{j.period === "hour" ? " /hr" : ""}</td><td><Pill s={j.status} /></td>
            <td><label className="check"><input type="checkbox" checked={j.featured} onChange={e => act("admin.job", { id: j.id, op: "feature", v: e.target.checked })} /> <span className="small">Featured</span></label></td>
            <td><div className="row tight nowrap">
              {j.status === "pending" && <><button className="btn sm pri" onClick={() => pub(j)}><LuCheck /> Approve</button><button className="btn sm danger" onClick={() => reject(j)}><LuX /> Reject</button></>}
              <button className="btn sm" onClick={() => { ui.adminJob = j.id; commit(); }}><LuPencil /> Edit</button>
              {j.status === "active" && <ShareButton j={j} small />}
              {j.status === "active" && <button className="btn sm" onClick={() => act("admin.job", { id: j.id, op: "pause" })}><LuEyeOff /> Unpublish</button>}
              {["paused", "rejected", "closed"].includes(j.status) && <button className="btn sm" onClick={() => pub(j)}><LuEye /> Publish</button>}
              <button className="btn sm danger" onClick={() => del(j)} aria-label="Delete job"><LuTrash2 /></button>
            </div></td></tr>
        )) : <tr><td colSpan={6}><Empty>No jobs in this list.</Empty></td></tr>}
      </tbody></table></div>
    </>;
  }

  if (t === "apps") body = <>
    <h2>All applications</h2>
    {S.applications.length ? <div className="tbl"><table><thead><tr><th>Candidate</th><th>Job</th><th>Employer</th><th>Applied</th><th>Status</th></tr></thead><tbody>
      {[...S.applications].reverse().map(a => { const j = job(a.jobId); const c = candOf(a); return (
        <tr key={a.id}><td>{c.name}{c.via && <div className="muted small">via {c.via}</div>}</td><td>{j?.title || "—"}</td><td>{j ? company(j) : "—"}</td><td>{fdate(a.appliedAt)}</td><td><StatusSelect a={a} /></td></tr>); })}
    </tbody></table></div> : <Empty>No applications.</Empty>}
  </>;

  if (t === "clearance") body = <AdminClearanceList />;

  if (t === "ledger") {
    const sel = ui.ledgerAgent ? user(ui.ledgerAgent) : null;
    const totalDue = agents.reduce((s, a) => s + balanceOf(a.id), 0);
    const add = e => { const [d] = formData(e); const form = e.currentTarget; act("admin.ledgerAdd", { ...d, agentId: sel.id }).then(r => r && form.reset()); };
    body = <>
      <h2>Agent accounts</h2>
      <Tiles items={[[agents.length, "Agents"], [bdtFmt(totalDue), "Total due from agents", true], [pendP, "Payments to confirm"]]} />
      <div className="tbl"><table><thead><tr><th>Agent</th><th>Charges (BDT)</th><th>Paid (BDT)</th><th>Balance due</th><th>Pending</th><th></th></tr></thead><tbody>
        {agents.length ? agents.map(a => {
          const conf = S.ledger.filter(l => l.agentId === a.id && l.status === "confirmed");
          const ch = conf.filter(l => l.type === "charge").reduce((s, l) => s + Number(l.amount), 0);
          const pd = conf.filter(l => l.type === "payment").reduce((s, l) => s + Number(l.amount), 0);
          const pp = S.ledger.filter(l => l.agentId === a.id && l.status === "pending").length;
          const on = sel?.id === a.id;
          return <tr key={a.id} className={on ? "sel" : ""}><td><b>{a.agent?.business || a.name}</b><div className="muted small">{a.name} · {a.agent?.phone}</div></td><td className="num">{num(ch)}</td><td className="num">{num(pd)}</td><td className="num"><b>{num(ch - pd)}</b></td><td>{pp ? <span className="count">{pp}</span> : "—"}</td><td><button className={`btn sm${on ? " pri" : ""}`} onClick={() => { ui.ledgerAgent = a.id; commit(); }}>Statement</button></td></tr>;
        }) : <tr><td colSpan={6}><Empty>No agents yet.</Empty></td></tr>}
      </tbody></table></div>
      {sel ? <div className="card stack">
        <div className="row between"><h3>Statement: {sel.agent?.business || sel.name}</h3><span>Balance due <b className="num">{bdtFmt(balanceOf(sel.id))}</b></span></div>
        <LedgerTable agentId={sel.id} admin />
        <form className="fgrid divider" onSubmit={add} key={sel.id}>
          <h4 className="full">Add entry</h4>
          <Field label="Type"><select name="type"><Options list={[["charge", "Charge (agent owes)"], ["payment", "Payment received"]]} /></select></Field>
          <Field label="Amount (BDT)"><input type="number" name="amount" min="1" required /></Field>
          <Field label="Date"><input type="date" name="date" defaultValue={now().slice(0, 10)} required /></Field>
          <Field label="Method (payments)"><select name="method"><Options list={PAY_METHODS} blank="—" /></select></Field>
          <Field label="Reference no."><input type="text" name="ref" /></Field>
          <Field label="Description" full><input type="text" name="desc" required placeholder="e.g. Visa processing fee: Sohel Rana" /></Field>
          <div className="full"><button className="btn pri" type="submit">Add to statement</button></div>
        </form>
      </div> : <p className="muted">Choose an agent to see the full statement, confirm payments and add charges.</p>}
    </>;
  }

  if (t === "packages") {
    const savePk = e => { const [d] = formData(e); act("admin.packages", { packages: S.packages.map((p, i) => ({ name: d[`name${i}`], price: d[`price${i}`], posts: d[`posts${i}`], featured: d[`featured${i}`] })) }); };
    const paid = o => act("admin.orderPaid", { id: o.id });
    body = <>
      <h2>Payments &amp; packages</h2>
      <div className="card"><label className="check"><input type="checkbox" checked={S.settings.paidPosting} onChange={e => act("admin.paidPosting", { v: e.target.checked })} /> <b>Paid job posting</b>: employers need credits to post a job</label></div>
      <form className="card stack" onSubmit={savePk}>
        <h3>Packages</h3>
        <div className="tbl"><table><thead><tr><th>Name</th><th>Price (BDT)</th><th>Job posts</th><th>Featured</th></tr></thead><tbody>
          {S.packages.map((p, i) => <tr key={p.id}><td><input type="text" name={`name${i}`} defaultValue={p.name} aria-label="Package name" /></td><td><input type="number" name={`price${i}`} defaultValue={p.price} min="0" aria-label="Price" /></td><td><input type="number" name={`posts${i}`} defaultValue={p.posts} min="0" aria-label="Job posts" /></td><td><input type="number" name={`featured${i}`} defaultValue={p.featured} min="0" aria-label="Featured" /></td></tr>)}
        </tbody></table></div>
        <div><button className="btn pri" type="submit">Save packages</button></div>
      </form>
      <div className="card"><h3 className="mb12">Orders</h3>{S.orders.length ? <div className="tbl"><table><thead><tr><th>Employer</th><th>Package</th><th>Amount</th><th>Date</th><th>Status</th><th></th></tr></thead><tbody>
        {[...S.orders].reverse().map(o => <tr key={o.id}><td>{user(o.uid)?.company?.name || "—"}</td><td>{o.name}</td><td className="num">BDT {num(o.price)}</td><td>{fdate(o.at)}</td><td><Pill s={o.status} /></td><td>{o.status === "pending" && <button className="btn sm pri" onClick={() => paid(o)}>Mark paid &amp; add credits</button>}</td></tr>)}
      </tbody></table></div> : <p className="muted">No orders yet.</p>}</div>
    </>;
  }

  if (t === "blog") {
    const e0 = ui.editPost ? S.posts.find(p => p.id === ui.editPost) : null; const p = e0 || {};
    const save = e => {
      const [d] = formData(e); const form = e.currentTarget;
      act("admin.post", { id: e0?.id, title: d.title, excerpt: d.excerpt, body: d.body }).then(r => { if (!r) return; if (e0) { ui.editPost = null; commit(); } else form.reset(); });
    };
    body = <>
      <h2>Blog management</h2>
      <form className="card stack12" onSubmit={save} key={e0?.id || "new"}>
        <h3>{e0 ? "Edit post" : "New post"}</h3>
        <Field label="Title"><input type="text" name="title" defaultValue={p.title} required /></Field>
        <Field label="Short summary"><input type="text" name="excerpt" defaultValue={p.excerpt} required /></Field>
        <Field label="Body" hint="Start a line with ### to make a sub-heading"><textarea name="body" className="tall" defaultValue={p.body} required /></Field>
        <div className="row"><button className="btn pri" type="submit">{e0 ? "Save post" : "Publish post"}</button>{e0 && <button className="btn" type="button" onClick={() => { ui.editPost = null; commit(); }}>Cancel</button>}</div>
      </form>
      <div className="tbl"><table><thead><tr><th>Post</th><th>Date</th><th></th></tr></thead><tbody>
        {S.posts.map(p => <tr key={p.id}><td><a href={`#post-${p.id}`}>{p.title}</a></td><td>{fdate(p.date)}</td><td><div className="row tight nowrap"><button className="btn sm" onClick={() => { ui.editPost = p.id; commit(); window.scrollTo(0, 0); }}><LuPencil /> Edit</button><button className="btn sm danger" onClick={() => confirmBox("Delete this blog post?", () => act("admin.post", { op: "delete", id: p.id }), "Delete")} aria-label="Delete post"><LuTrash2 /></button></div></td></tr>)}
      </tbody></table></div>
    </>;
  }

  if (t === "seo") {
    const save = e => { const [d] = formData(e); act("admin.seo", { seo: Object.fromEntries(PAGES.map(pg => [pg, { title: d[`t-${pg}`], desc: d[`d-${pg}`] }])) }); };
    body = <>
      <h2>SEO settings</h2><p className="muted">Page titles and meta descriptions for search engines. Changes apply immediately.</p>
      <form className="card stack18" onSubmit={save}>
        {PAGES.map(pg => <fieldset key={pg} className="plain stack8"><legend className="b cap mb6">{pg} page</legend>
          <Field label="Title" hint={`${S.seo[pg].title.length} characters · aim for under 60`}><input type="text" name={`t-${pg}`} defaultValue={S.seo[pg].title} /></Field>
          <Field label="Meta description" hint={`${S.seo[pg].desc.length} characters · aim for 120–160`}><textarea name={`d-${pg}`} className="short" defaultValue={S.seo[pg].desc} /></Field>
        </fieldset>)}
        <div><button className="btn pri" type="submit">Save SEO settings</button></div>
      </form>
    </>;
  }

  if (t === "slides") body = <SlidesAdmin />;

  if (t === "settings") {
    const s = S.settings;
    const save = e => { const [d] = formData(e); act("admin.settings", { ...d, moderation: !!d.moderation, rates: Object.fromEntries(Object.values(COUNTRIES).map(c => [c, d[`rate-${c}`]])) }); };
    body = <>
      <h2>Site settings</h2>
      <form className="card fgrid" onSubmit={save} noValidate>
        <Field label="Office phone"><input type="tel" name="phone" defaultValue={s.phone} placeholder="+880" /></Field>
        <Field label="Office email"><input type="email" inputMode="email" name="email" defaultValue={s.email} /></Field>
        <Field label="Office address" full><input type="text" name="address" defaultValue={s.address} /></Field>
        <Field label="Office hours" full><input type="text" name="hours" defaultValue={s.hours} /></Field>
        <Field label={<span className="row tight"><FaWhatsapp /> WhatsApp number</span>} hint="Shows the WhatsApp chat button on every page. Include country code, e.g. 8801XXXXXXXXX"><input type="tel" name="whatsapp" defaultValue={s.whatsapp} /></Field>
        <Field label={<span className="row tight"><FaFacebookF /> Facebook page URL</span>}><input type="text" inputMode="url" name="facebook" defaultValue={s.social.facebook} placeholder="facebook.com/…" /></Field>
        <Field label={<span className="row tight"><FaYoutube /> YouTube URL</span>}><input type="text" inputMode="url" name="youtube" defaultValue={s.social.youtube} placeholder="youtube.com/…" /></Field>
        <Field label={<span className="row tight"><FaLinkedinIn /> LinkedIn URL</span>}><input type="text" inputMode="url" name="linkedin" defaultValue={s.social.linkedin} placeholder="linkedin.com/…" /></Field>
        <Field label={<span className="row tight"><FaTiktok /> TikTok URL</span>}><input type="text" inputMode="url" name="tiktok" defaultValue={s.social.tiktok} placeholder="tiktok.com/…" /></Field>
        <label className="check full"><input type="checkbox" name="moderation" defaultChecked={s.moderation} /> Review employer jobs before they go live</label>
        <Field label="BMET clearance processing charge (BDT)" hint="Added to the agent's statement on each new clearance application. 0 = add charges manually."><input type="number" name="clearanceFee" min="0" defaultValue={s.clearanceFee || 0} /></Field>
        <fieldset className="plain full"><legend className="b mb6">Currency rates (BDT per 1 unit)</legend><p className="muted small mb12">Used for the approximate BDT salary shown on jobs and for the salary filter. Update these regularly.</p>
          <div className="grid rategrid">{Object.entries(COUNTRIES).map(([n, c]) => <Field key={c} label={`${c} (${n})`}><input type="number" step="0.01" min="0" name={`rate-${c}`} defaultValue={s.rates[c] ?? ""} /></Field>)}</div></fieldset>
        <div className="full"><button className="btn pri" type="submit">Save settings</button></div>
      </form>
      {isAdmin && <EmailSettings />}
    </>;
  }

  if (t === "messages") body = <>
    <h2>Contact messages</h2>
    {S.messages.length ? S.messages.map(m => (
      <div key={m.id} className={`card stack8${m.read ? "" : " unreadcard"}`}>
        <div className="row between"><b>{m.name} <span className="muted small fw4">· {m.type}{m.country ? ` · ${m.country}` : ""}</span></b><span className="muted small">{fdate(m.at)}</span></div>
        <div className="small">{m.phone}{m.email ? ` · ${m.email}` : ""}</div><p>{m.message}</p>
        <div className="row">{!m.read && <button className="btn sm" onClick={() => act("admin.msg", { id: m.id, op: "read" }, { quiet: true })}><LuCheck /> Mark as read</button>}<button className="btn sm danger" onClick={() => confirmBox("Delete this message?", () => act("admin.msg", { id: m.id, op: "delete" }), "Delete")}><LuTrash2 /> Delete</button></div>
      </div>
    )) : <Empty>No messages yet. Messages sent from the Contact page appear here.</Empty>}
  </>;

  return (
    <div className="wrap dash">
      <Rail role={R} items={TABS.filter(([k]) => can(k)).map(([k, l, I]) => [k, l, I, { users: pendU, jobs: pendJ, clearance: pendC, tickets: pendT, ledger: pendP, packages: pendO, messages: newMsg }[k]])} />
      <div className="panel">{body}</div>
    </div>
  );
}

/* Admin only: the mailbox that sends verification codes (password is write-only) */
function EmailSettings() {
  const m = store.S.smtp || {};
  const save = e => { const [d] = formData(e); act("admin.smtp", d); };
  if (m.local) return (
    <div className="card">
      <h3>Email sending (verification codes)</h3>
      <p>Codes are sent from <b data-notr>{m.from}</b> by this server's own mail service. Nothing to set up here.</p>
      <div className="row"><button className="btn" type="button" onClick={() => act("admin.smtpTest")}>Send test email to me</button></div>
    </div>
  );
  return (
    <form className="card fgrid" onSubmit={save} key={m.host + m.user}>
      <h3 className="full">Email sending (verification codes)</h3>
      <p className="muted small full">Use a mailbox such as noreply@yourdomain. For Hostinger mail: server <b>smtp.hostinger.com</b>, port <b>465</b>, username = the full email address.</p>
      <Field label="SMTP server"><input type="text" name="host" defaultValue={m.host} placeholder="smtp.hostinger.com" /></Field>
      <Field label="Port"><input type="number" name="port" defaultValue={m.port || 465} /></Field>
      <Field label="Username (email address)"><input type="email" name="user" defaultValue={m.user} /></Field>
      <Field label="Password" hint={m.hasPass ? "Saved. Leave empty to keep it." : "The mailbox password"}><input type="password" name="pass" autoComplete="new-password" /></Field>
      <Field label="Send as (optional)" hint="Defaults to the username"><input type="email" name="from" defaultValue={m.from} /></Field>
      <div className="full row"><button className="btn pri" type="submit">Save email settings</button><button className="btn" type="button" onClick={() => act("admin.smtpTest")}>Send test email to me</button>
        <span className="muted small">{m.host && m.user && m.hasPass ? "Email sending is set up." : "Not set up yet: job seekers can't receive codes. You can verify them manually in Accounts."}</span></div>
    </form>
  );
}

/* Home page slideshow: add, caption, reorder, hide or remove pictures, and set the speed */
const FOCUS = [["50% 50%", "Center"], ["50% 25%", "Top"], ["50% 75%", "Bottom"], ["25% 50%", "Left"], ["75% 50%", "Right"]];
function SlidesAdmin() {
  const S = store.S; const L = S.scenery || []; const [busy, setBusy] = React.useState(false);
  const add = async e => {
    e.preventDefault(); const form = e.currentTarget; const f = form.file.files[0];
    if (!f) return toast("Choose a picture first.");
    if (!/^image\//.test(f.type) && !/\.(jpe?g|png|webp)$/i.test(f.name)) return toast("Choose a photo (JPG or WebP).");
    setBusy(true);
    try {
      let big, small;
      try { big = await compressImage(f, 1920, 0.82); small = await compressImage(f, 960, 0.8); } catch { return toast("This image could not be read. Try another file."); }
      const base = f.name.replace(/\.[^.]+$/, "");
      const r = await act("admin.scenery", { op: "add", big: { name: `${base}.jpg`, data: big }, small: { name: `${base}-small.jpg`, data: small }, alt: form.alt.value, pos: form.pos.value });
      if (r) form.reset();
    } finally { setBusy(false); }
  };
  const upd = (x, ch) => act("admin.scenery", { op: "update", id: x.id, ...ch }, { quiet: true });
  const shown = L.filter(x => !x.hidden).length;
  return <>
    <h2>Home slideshow</h2>
    <p className="muted">Pictures at the top of the home page. They change every few seconds and fill the screen on computers, tablets and phones. {shown} of {L.length} pictures are showing.</p>
    <form className="card fgrid" onSubmit={add}>
      <h3 className="full"><LuImagePlus /> Add a picture</h3>
      <Field label="Picture (JPG or WebP)" hint="Wide landscape photos work best (at least 1600 px wide). Large photos are made smaller before upload." full><input type="file" name="file" accept="image/jpeg,image/png,image/webp" /></Field>
      <Field label="Description" hint="Read out by screen readers, e.g. Rice fields in Sylhet"><input type="text" name="alt" maxLength={140} /></Field>
      <Field label="Keep in view when cropped" hint="Phones show a narrower part of the picture"><select name="pos" defaultValue="50% 50%">{FOCUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      <div className="full"><button className="btn pri" type="submit" disabled={busy}><LuUpload /> {busy ? "Uploading…" : "Add to slideshow"}</button></div>
    </form>
    <form className="card row wrap" onSubmit={e => { e.preventDefault(); act("admin.scenery", { op: "speed", sec: e.currentTarget.sec.value }); }}>
      <LuTimer /> <label htmlFor="slsec" className="b">Seconds per picture</label>
      <input id="slsec" type="number" name="sec" min="3" max="30" step="0.5" defaultValue={S.settings.slideSec || 6.5} style={{ width: 90 }} />
      <button className="btn" type="submit">Save speed</button>
      <button className="btn link" type="button" onClick={() => confirmBox("Bring back the original pictures that came with the website? Your own pictures stay.", () => act("admin.scenery", { op: "reset" }), "Restore")}><LuRotateCcw /> Restore original pictures</button>
    </form>
    {L.length ? <div className="grid slidegrid">{L.map((x, k) => (
      <figure key={x.id} className={`card slidecard${x.hidden ? " off" : ""}`}>
        <div className="slidethumb"><img src={x.src} srcSet={x.srcSet || undefined} sizes="320px" alt={x.alt} style={{ objectPosition: x.pos }} loading="lazy" />
          <span className="slidenum">{k + 1}</span>{x.hidden && <span className="pill">Hidden</span>}</div>
        <figcaption className="stack8">
          <input type="text" defaultValue={x.alt} maxLength={140} aria-label="Description" onBlur={e => { if (e.target.value.trim() && e.target.value !== x.alt) upd(x, { alt: e.target.value }); }} />
          <div className="row between">
            <select value={FOCUS.some(([v]) => v === x.pos) ? x.pos : "50% 50%"} aria-label="Keep in view when cropped" onChange={e => upd(x, { pos: e.target.value })}>{FOCUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <div className="row tight">
              <button className="btn sm icon" disabled={k === 0} onClick={() => act("admin.scenery", { op: "move", id: x.id, dir: -1 }, { quiet: true })} aria-label="Move earlier" title="Move earlier"><LuArrowUp /></button>
              <button className="btn sm icon" disabled={k === L.length - 1} onClick={() => act("admin.scenery", { op: "move", id: x.id, dir: 1 }, { quiet: true })} aria-label="Move later" title="Move later"><LuArrowDown /></button>
              <button className="btn sm icon" onClick={() => upd(x, { hidden: !x.hidden })} aria-label={x.hidden ? "Show on the website" : "Hide from the website"} title={x.hidden ? "Show on the website" : "Hide from the website"}>{x.hidden ? <LuEye /> : <LuEyeOff />}</button>
              <button className="btn sm icon danger" onClick={() => confirmBox("Remove this picture from the slideshow?", () => act("admin.scenery", { op: "delete", id: x.id }), "Remove")} aria-label="Remove picture" title="Remove picture"><LuTrash2 /></button>
            </div>
          </div>
        </figcaption>
      </figure>))}</div>
      : <Empty>No pictures in the slideshow. The home page shows a plain green banner until you add one.</Empty>}
  </>;
}

/* Admin / staff: post a job for any employer (registered or not) or edit any job */
function AdminJobForm() {
  const S = store.S; const editing = ui.adminJob !== "new" ? S.jobs.find(x => x.id === ui.adminJob) : null;
  const j = editing || blankJob();
  const employers = S.users.filter(x => x.role === "employer").map(x => [x.id, x.company?.name || x.name]);
  const [emp, setEmp] = React.useState(editing ? (editing.employerId || "") : "");
  const close = () => { ui.adminJob = null; commit(); };
  const submit = async e => {
    const [d, fd] = formData(e);
    if (Number(d.salaryMax) < Number(d.salaryMin)) return toast("“Salary to” must be equal to or higher than “Salary from”.");
    const r = await act("admin.jobSave", { ...d, id: editing?.id, employerId: emp, benefits: fd.getAll("benefits"), publish: !!d.publish, featured: !!d.featured });
    if (r) { const fresh = editing ? job(editing.id) : store.S.jobs.find(x => x.id === r.jobId); if (fresh?.status === "active") storeCard(fresh); close(); }
  };
  return <>
    <div className="row between"><h2>{editing ? "Edit job" : "Post a new job"}</h2><button className="btn" onClick={close}><LuX /> Cancel</button></div>
    {editing && <p className="muted small">Changes go live straight away. {editing.employerId ? "The employer is told that the agency updated the job." : ""}</p>}
    <form className="card fgrid" onSubmit={submit} key={editing?.id || "new"}>
      <Field label="Employer" hint="Pick a registered employer, or type the company name for an employer without an account">
        <select value={emp} onChange={e => setEmp(e.target.value)}><option value="">Not registered (type the name)</option>{employers.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      {!emp ? <Field label="Employer / company name (optional)" hint="Leave empty to post without showing an employer name"><input type="text" name="employerName" defaultValue={editing?.employerName || ""} maxLength={120} /></Field> : <div />}
      <JobFields j={j} templates />
      {!editing && <label className="check full"><input type="checkbox" name="publish" defaultChecked /> Publish now (otherwise saved as unpublished)</label>}
      <label className="check full"><input type="checkbox" name="featured" defaultChecked={!!j.featured} /> Featured job (shown first on the home page)</label>
      <div className="full row"><button className="btn pri" type="submit">{editing ? "Save changes" : "Post job"}</button><button className="btn" type="button" onClick={close}>Cancel</button></div>
    </form>
  </>;
}


/* clearance payment (agent files): the agent's receipt after Final Approval, approved or rejected here */
export function ClPayCell({ c }) {
  const p = c.payment;
  if (!c.agentId || !["final", "approved"].includes(clStage(c))) return <span className="muted small">N/A</span>;
  if (p?.status === "paid" || c.card?.feePaid) return <span className="ec-badge pay-paid">Paid</span>;
  if (p?.status === "submitted") return (
    <div className="stack6 small">
      <span><b className="num">{bdtFmt(p.amount)}</b> · {p.method}{p.ref ? <> · <span className="num" data-notr>{p.ref}</span></> : null}</span>
      <div className="row tight nowrap">
        <button className="btn sm" title="View receipt" aria-label="View receipt" onClick={() => dlFile(p.file.data, p.file.name)}><LuEye /></button>
        <button className="btn sm pri" onClick={() => confirmBox(`Approve the payment of ${bdtFmt(p.amount)}? The agent will see Paid.`, () => act("admin.clPayment", { id: c.id, op: "approve" }), "Approve")}><LuCheck /> Approve</button>
        <button className="btn sm danger" onClick={() => confirmBox("Reject this receipt? The agent is asked to send it again.", () => act("admin.clPayment", { id: c.id, op: "reject" }), "Reject")}><LuX /></button>
      </div>
    </div>);
  return <span className="ec-badge pay-unpaid">{p?.status === "rejected" ? "Receipt rejected" : "Unpaid"}</span>;
}


/* ---------- BMET clearance applications (admin): one row per worker, bordered grid ---------- */
const ecDay = iso => { const d = new Date(iso); return isNaN(d) ? "—" : `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`; };
const SENT_IDX = CL_STAGES.indexOf("sent_bmet");
const pastSent = c => c.status === "rejected" || CL_STAGES.indexOf(clStage(c)) >= SENT_IDX; // from "Send to BMET" on, Details replaces the document downloads

function AdminClearanceList() {
  const S = store.S; const f = ui.clFilter || "all";
  const [q, setQ] = React.useState(""); const [per, setPer] = React.useState(25); const [page, setPage] = React.useState(1);
  const match = (k, c) => k === "all" || (k === "open" ? clOpen(c) : k === "card" ? cardPending(c) : k === "sent" ? !!c.card : k === "pay" ? c.payment?.status === "submitted" : c.status === k);
  const cnt = k => S.clearances.filter(c => match(k, c)).length;
  const rows = S.clearances.filter(c => match(f, c)).sort((a, b) => b.created.localeCompare(a.created))
    .map(c => ({ c, p: clPerson(c) }))
    .filter(({ c, p }) => { const k = q.trim().toLowerCase(); return !k || [c.ref, p.name, p.passport, c.country].some(v => String(v || "").toLowerCase().includes(k)); });
  const pages = Math.max(1, Math.ceil(rows.length / per)); const pg = Math.min(page, pages);
  const shown = rows.slice((pg - 1) * per, pg * per);
  return <>
    <h2>BMET clearance applications</h2>
    <p className="muted small">{`Status flow: ${CL_STAGES.map(x => LABEL[x]).join(" › ")}. Choose “Custom…” in Status to write your own status. The EC Ref No can be changed until the file is Approved. When a file reaches Final Approval, the agent sends a payment receipt (Payments to check). When a file is Approved, upload the clearance card in Details: the agent then sees Approved and can download it.`}</p>
    <FilterButtons cur={f} onPick={k => { ui.clFilter = k; setPage(1); commit(); }} items={[["all", "All"], ["pending", "New (Pending)"], ["open", "In progress"], ["card", "Card to upload"], ["pay", "Payments to check"], ["sent", "Card sent"], ["rejected", "Rejected"]].map(([k, l]) => [k, l, cnt(k)])} />
    <div className="ec-tools mt8">
      <label className="ec-show">Show <select value={per} onChange={e => { setPer(Number(e.target.value)); setPage(1); }}>{[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
      <span className="grow" />
      <label className="ec-search"><input type="text" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} placeholder="EC Ref No, name or passport" /><LuSearch /></label>
    </div>
    <div className="tbl ec-tbl grid"><table><thead><tr><th>SL</th><th>Worker name</th><th>Passport No</th><th>EC Ref No</th><th>Country</th><th>Status</th><th>Submission</th><th>Download Documents</th></tr></thead><tbody>
      {shown.length ? shown.map(({ c, p }, i) => (
        <tr key={c.id}>
          <td>{(pg - 1) * per + i + 1}</td>
          <td><b>{p.name}</b></td>
          <td className="num" data-notr>{p.passport || "—"}</td>
          <td><RefCell c={c} /></td>
          <td>{c.country}</td>
          <td><StatusCell c={c} /></td>
          <td><div className="ec-sub"><b>{p.via}</b><span className="num">{ecDay(c.created)}</span></div></td>
          <td>{pastSent(c)
            ? <div className="stack6"><button className="btn sm" onClick={() => openModal("clearance", { cid: c.id, admin: true })}><LuEye /> Details</button>
                {c.payment?.status === "submitted" && <span className="ec-badge pay-pending">Payment to check</span>}
                {cardPending(c) && <span className="ec-badge s-final">Card to upload</span>}
                {c.card && <span className="ec-badge s-approved">Card sent</span>}</div>
            : <DocButtons c={c} />}</td>
        </tr>)) : <tr><td colSpan={8}><Empty>No clearance applications in this list.</Empty></td></tr>}
    </tbody></table></div>
    {rows.length > 0 && <div className="row between mt8"><span className="muted small">{`Showing ${(pg - 1) * per + 1} to ${Math.min(pg * per, rows.length)} of ${rows.length} entries`}</span>
      <div className="row tight"><button className="btn sm" disabled={pg <= 1} onClick={() => setPage(pg - 1)}>Previous</button><span className="small b">{pg} / {pages}</span><button className="btn sm" disabled={pg >= pages} onClick={() => setPage(pg + 1)}>Next</button></div></div>}
  </>;
}

function DocButtons({ c }) {
  const F = c.files ? [["passport", "Passport copy"], ["visa", "Visa copy"], ["contract", "Employment contract"]].filter(([k]) => c.files[k]).map(([k, l]) => [l, c.files[k]]).concat((c.files.others || []).map((x, i) => [`Other document ${i + 1}`, x])) : [];
  if (!F.length) return <button className="btn sm" onClick={() => openModal("clearance", { cid: c.id, admin: true })}><LuEye /> Details</button>;
  return <DocMenu files={F} />;
}

/* "Downloads" button: opens a small list with one download button per uploaded document */
function DocMenu({ files }) {
  const [open, setOpen] = React.useState(null); const ref = React.useRef(); // open = where to draw the list (fixed, so the table never cuts it off)
  React.useEffect(() => {
    if (!open) return;
    const off = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(null); };
    const esc = e => { if (e.key === "Escape") setOpen(null); };
    const close = () => setOpen(null);
    document.addEventListener("mousedown", off); document.addEventListener("keydown", esc); window.addEventListener("scroll", close, true); window.addEventListener("resize", close);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [open]);
  const toggle = e => {
    if (open) return setOpen(null);
    const r = e.currentTarget.getBoundingClientRect(), W = 240, H = 16 + files.length * 52;
    const left = Math.max(8, Math.min(window.innerWidth - W - 8, document.dir === "rtl" ? r.left : r.right - W));
    const top = r.bottom + 4 + H > window.innerHeight ? Math.max(8, r.top - 4 - H) : r.bottom + 4;
    setOpen({ left, top, width: W });
  };
  return (
    <div className="ec-dl" ref={ref}>
      <button className="btn sm" aria-expanded={!!open} onClick={toggle}><LuDownload /> Downloads <span className="ec-dl-n">{files.length}</span></button>
      {open && <div className="ec-dl-menu" role="menu" style={open}>
        {files.map(([l, x]) => <button key={l} role="menuitem" className="ec-dl-item" title={x.name} onClick={() => dlFile(x.data, x.name)}><LuDownload /> <span>{l}</span><small data-notr>{x.name}</small></button>)}
      </div>}
    </div>
  );
}

function RefCell({ c }) {
  const [ed, setEd] = React.useState(false); const [v, setV] = React.useState(c.ref || "");
  const locked = c.status === "approved" || !!c.card;
  const save = async () => { if (await act("admin.clRef", { id: c.id, ref: v })) setEd(false); };
  if (ed) return (
    <div className="ec-refedit"><input type="text" value={v} onChange={e => setV(e.target.value.toUpperCase())} onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEd(false); }} autoFocus aria-label="EC Ref No" data-notr />
      <button className="btn sm pri" onClick={save} aria-label="Save"><LuCheck /></button><button className="btn sm" onClick={() => setEd(false)} aria-label="Cancel"><LuX /></button></div>);
  return <div className="ec-refcell"><span className="ec-ref" data-notr>{c.ref || "—"}</span>
    {!locked && <button className="btn sm link" title="Change EC Ref No" aria-label="Change EC Ref No" onClick={() => { setV(c.ref || ""); setEd(true); }}><LuPencil /></button>}</div>;
}

export function StatusCell({ c, wide }) {
  const [custom, setCustom] = React.useState(false); const [v, setV] = React.useState(c.status === "custom" ? c.statusText || "" : "");
  const pick = val => { if (val === "custom") { setV(c.status === "custom" ? c.statusText || "" : ""); setCustom(true); } else { setCustom(false); setClStatus(c.id, val); } };
  const saveCustom = async () => { if (await act("admin.clStatus", { id: c.id, status: "custom", text: v })) setCustom(false); };
  return (
    <div className={`stack6${wide ? "" : " ec-status"}`}>
      <select className="auto slim" value={custom ? "custom" : c.status} onChange={e => pick(e.target.value)} aria-label="Clearance status">
        {[...CL_STAGES, "rejected"].map(x => <option key={x} value={x}>{LABEL[x]}</option>)}
        <option value="custom">{c.status === "custom" && !custom ? `Custom: ${c.statusText}` : "Custom…"}</option>
      </select>
      {custom && <div className="ec-refedit"><input type="text" value={v} maxLength={80} placeholder="Write the status" onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === "Enter") saveCustom(); if (e.key === "Escape") setCustom(false); }} autoFocus />
        <button className="btn sm pri" onClick={saveCustom} aria-label="Save status"><LuCheck /></button><button className="btn sm" onClick={() => setCustom(false)} aria-label="Cancel"><LuX /></button></div>}
    </div>
  );
}
