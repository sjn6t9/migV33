import React from "react";
import {
  LuLayoutDashboard, LuUsers, LuBriefcase, LuFileText, LuStamp, LuWallet, LuPackage, LuNewspaper, LuSearch, LuSettings, LuMessageSquare,
  LuCheck, LuX, LuTrash2, LuPencil, LuEye, LuEyeOff, LuBadgeCheck, LuRotateCcw, LuBan, LuTicket, LuUpload, LuImage, LuUserCog, LuImagePlus, LuQuote
} from "react-icons/lu";
import { FaWhatsapp, FaFacebookF, FaYoutube, FaLinkedinIn, FaTiktok } from "react-icons/fa6";
import { STAFF_PERMS, TEAM_DEPTS, store, commit, user, job, worker, company, live, money, num, fdate, bdtFmt, balanceOf, candOf, clPerson, clOpen, cardPending, now, COUNTRIES, STAGES, CL_STAGES, CL_DOCS, PAY_METHODS, PAGES, LABEL } from "../store.js";
import { toast, formData, setTab, openModal, confirmBox, deleteUser, act, readUpload } from "../actions.js";
import { Rail, Tiles, Pill, Empty, Bars, Stars, Avatar } from "../ui.jsx";
import { LedgerTable, StatusSelect, Field, Options } from "./shared.jsx";
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
  ["content", "Website content", LuImage], ["blog", "Blog", LuNewspaper], ["seo", "SEO", LuSearch], ["settings", "Site settings", LuSettings],
  ["messages", "Messages", LuMessageSquare], ["staff", "Staff & permissions", LuUserCog]
];

export function Admin({ u }) {
  const S = store.S; const R = u.role; const isAdmin = R === "admin";
  const can = k => k === "overview" || isAdmin || (k !== "staff" && u.perms?.includes(k));
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
          <Field label="Display order" hint="Lower numbers show first"><input type="number" name="order" min="0" max="999" defaultValue={editM?.order ?? 10} /></Field>
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

  if (t === "jobs") {
    const f = ui.jobFilter;
    const L = S.jobs.filter(j => f === "all" || j.status === f).sort((a, b) => (a.status === "pending" ? -1 : 0) - (b.status === "pending" ? -1 : 0));
    const pub = async j => { const r = await act("admin.job", { id: j.id, op: "publish" }); if (r) { const fresh = job(j.id); if (fresh) storeCard(fresh); } };
    const reject = j => act("admin.job", { id: j.id, op: "reject" });
    const del = j => confirmBox("Delete this job and its applications?", () => act("admin.job", { id: j.id, op: "delete" }), "Delete");
    body = <>
      <h2>Job circular moderation</h2>
      <FilterButtons cur={f} onPick={k => { ui.jobFilter = k; commit(); }} items={["all", "pending", "active", "paused", "closed", "rejected"].map(k => [k, k[0].toUpperCase() + k.slice(1), k === "all" ? S.jobs.length : S.jobs.filter(j => j.status === k).length])} />
      <div className="tbl"><table><thead><tr><th>Job</th><th>Employer</th><th>Salary</th><th>Status</th><th>Featured</th><th>Actions</th></tr></thead><tbody>
        {L.length ? L.map(j => (
          <tr key={j.id}><td><a href={`#job-${j.id}`}>{j.title}</a><div className="muted small">{j.city}, {j.country} · {fdate(j.created)}</div></td><td>{company(j)}</td><td className="num">{money(j.salaryMin, j.currency)}</td><td><Pill s={j.status} /></td>
            <td><label className="check"><input type="checkbox" checked={j.featured} onChange={e => act("admin.job", { id: j.id, op: "feature", v: e.target.checked })} /> <span className="small">Featured</span></label></td>
            <td><div className="row tight nowrap">
              {j.status === "pending" && <><button className="btn sm pri" onClick={() => pub(j)}><LuCheck /> Approve</button><button className="btn sm danger" onClick={() => reject(j)}><LuX /> Reject</button></>}
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

  if (t === "clearance") {
    const f = ui.clFilter;
    const match = (k, c) => k === "all" || (k === "open" ? openCl(c) : k === "card" ? cardPending(c) : k === "sent" ? !!c.card : c.status === k);
    const L = S.clearances.filter(c => match(f, c)).sort((a, b) => b.created.localeCompare(a.created));
    const cnt = k => S.clearances.filter(c => match(k, c)).length;
    body = <>
      <h2>BMET clearance applications</h2>
      <p className="muted small">Status flow: {CL_STAGES.map(s => LABEL[s]).join(" › ")}. When a file is Approved, upload the clearance card and send it to the agent or job seeker.</p>
      <FilterButtons cur={f} onPick={k => { ui.clFilter = k; commit(); }} items={[["all", "All"], ["pending", "New (Pending)"], ["open", "In progress"], ["card", "Card to upload"], ["sent", "Card sent"], ["rejected", "Rejected"]].map(([k, l]) => [k, l, cnt(k)])} />
      <div className="tbl"><table><thead><tr><th>Applicant</th><th>Filed by</th><th>Destination</th><th>Documents</th><th>Submitted</th><th>Status</th><th>Clearance card</th></tr></thead><tbody>
        {L.length ? L.map(c => { const p = clPerson(c); return (
          <tr key={c.id}><td><b>{p.name}</b><div className="muted small num">{p.passport || "No passport no."}</div></td><td>{p.via}</td><td>{c.country}<div className="muted small">{c.employer}</div></td><td className="num">{c.files ? `${c.docs.length} uploaded` : `${c.docs.length} listed`}</td><td>{fdate(c.created)}</td>
            <td><select className="auto slim" value={c.status} onChange={e => setClStatus(c.id, e.target.value)} aria-label="Clearance status">{[...CL_STAGES, "rejected"].map(s => <option key={s} value={s}>{LABEL[s]}</option>)}</select></td>
            <td><div className="row tight nowrap">
              {c.card ? <span className="pill p-approved">Sent {fdate(c.card.sentAt)}</span> : c.status === "approved" ? <button className="btn sm acc" onClick={() => openModal("clearance", { cid: c.id, admin: true })}><LuUpload /> Upload card</button> : <span className="muted small">After approval</span>}
              <button className="btn sm" onClick={() => openModal("clearance", { cid: c.id, admin: true })}><LuEye /> Details</button>
            </div></td></tr>); })
          : <tr><td colSpan={7}><Empty>No clearance applications in this list.</Empty></td></tr>}
      </tbody></table></div>
    </>;
  }

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

  if (t === "settings") {
    const s = S.settings;
    const save = e => { const [d] = formData(e); act("admin.settings", { ...d, moderation: !!d.moderation, rates: Object.fromEntries(Object.values(COUNTRIES).map(c => [c, d[`rate-${c}`]])) }); };
    body = <>
      <h2>Site settings</h2>
      <form className="card fgrid" onSubmit={save}>
        <Field label="Office phone"><input type="tel" name="phone" defaultValue={s.phone} placeholder="+880" /></Field>
        <Field label="Office email"><input type="email" name="email" defaultValue={s.email} /></Field>
        <Field label="Office address" full><input type="text" name="address" defaultValue={s.address} /></Field>
        <Field label="Office hours" full><input type="text" name="hours" defaultValue={s.hours} /></Field>
        <Field label={<span className="row tight"><FaWhatsapp /> WhatsApp number</span>} hint="Shows the WhatsApp chat button on every page. Include country code, e.g. 8801XXXXXXXXX"><input type="tel" name="whatsapp" defaultValue={s.whatsapp} /></Field>
        <Field label={<span className="row tight"><FaFacebookF /> Facebook page URL</span>}><input type="url" name="facebook" defaultValue={s.social.facebook} placeholder="https://" /></Field>
        <Field label={<span className="row tight"><FaYoutube /> YouTube URL</span>}><input type="url" name="youtube" defaultValue={s.social.youtube} placeholder="https://" /></Field>
        <Field label={<span className="row tight"><FaLinkedinIn /> LinkedIn URL</span>}><input type="url" name="linkedin" defaultValue={s.social.linkedin} placeholder="https://" /></Field>
        <Field label={<span className="row tight"><FaTiktok /> TikTok URL</span>}><input type="url" name="tiktok" defaultValue={s.social.tiktok} placeholder="https://" /></Field>
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
