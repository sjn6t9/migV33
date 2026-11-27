import { StaffRank } from "./StaffRank.jsx";
import React from "react";
import {
  LuLayoutDashboard, LuSend, LuHistory, LuChevronLeft, LuChevronRight, LuUsers, LuBriefcase, LuFileText, LuStamp, LuWallet, LuPackage, LuNewspaper, LuSearch, LuSettings, LuMessageSquare,
  LuCheck, LuX, LuTrash2, LuPencil, LuEye, LuEyeOff, LuBadgeCheck, LuRotateCcw, LuBan, LuTicket, LuUpload, LuImage, LuUserCog, LuImagePlus, LuQuote, LuGalleryHorizontal, LuArrowUp, LuArrowDown, LuTimer, LuPlus, LuDownload, LuMessagesSquare, LuInfo
} from "react-icons/lu";
import { FaWhatsapp, FaFacebookF, FaYoutube, FaLinkedinIn, FaTiktok } from "react-icons/fa6";
import { clStage, STAFF_PERMS, TEAM_DEPTS, store, commit, user, job, worker, company, live, money, num, fdate, bdtFmt, balanceOf, candOf, clPerson, clOpen, cardPending, now, COUNTRIES, STAGES, CL_STAGES, CL_DOCS, PAY_METHODS, PAGES, LABEL } from "../store.js";
import { toast, formData, setTab, openModal, closeModal, confirmBox, deleteUser, act, readUpload, compressImage } from "../actions.js";
import { downloadFile as dlFile } from "../actions.js";
import { FilePick, Rail, Tiles, Pill, Empty, Bars, Stars, Avatar, RoleBadges } from "../ui.jsx";
import { StatusSelect, Field, Options, JobFields, blankJob } from "./shared.jsx";
import { setClStatus, signOut } from "../actions.js";
import { ReceiptsAdmin, SignatureBox, DueList } from "./Receipts.jsx";
import { VisaAdmin, VisaPassportEntry } from "./Visa.jsx";
import { FijiPassportEntry } from "./FijiPassports.jsx";
import { HeadlinesAdmin } from "./Headlines.jsx";
import { MySettings, Attendance, AttendanceSettings } from "./MySettings.jsx";
import { OfficeAccount, SalaryAdmin, MySalary, MoneyWithMe, TransactionHistory, OtherAccounts, PassportDelivery } from "./Accounts.jsx";
import { StatementsAdmin } from "./Statements.jsx";
import { PassportEntry, PassportPick, ppLine } from "./Passports.jsx";
import { Statement } from "./Statement.jsx";
import { GroupEcForm } from "./Agent.jsx";
import { BulkEcForm } from "./BulkClearance.jsx";
import { AgentsPage } from "./AgentBook.jsx";
import { PreEcCheck } from "./PreEc.jsx";
import { tone } from "../sound.js";
import { ClearanceCheck } from "./ClearanceCheck.jsx";
import { FlightSearch, FlightCard, TicketFlight } from "./Flights.jsx";
import { agentRows } from "../statement.js";
import { MFS, BANKS } from "../banks.js";
import { LuNotebookPen, LuReceipt, LuLandmark, LuBanknote, LuScrollText, LuBookUser, LuFileCheck2, LuHandCoins, LuPlaneTakeoff, LuCalendarCheck, LuSettings2, LuLogOut, LuMegaphone, LuCirclePlus, LuListPlus, LuContact, LuGlobe, LuRefreshCw, LuShieldCheck, LuLogIn, LuCircleCheck } from "react-icons/lu";
import { ShareButton, storeCard } from "../Share.jsx";
import { ChatInbox, useInboxUnread } from "../LiveChat.jsx";

const ui = store.ui;
const openCl = clOpen;

function FilterButtons({ items, cur, onPick }) {
  return <div className="row">{items.map(([k, t, n]) => <button key={k} className={`btn sm${cur === k ? " pri" : ""}`} onClick={() => onPick(k)}>{t}{n !== undefined ? ` (${n})` : ""}</button>)}</div>;
}

// sections inside "Payments & receipts" (each still needs its own staff permission)
const PAY_SUB = [["receipts", "Money receipts", LuReceipt], ["ledger", "Agent accounts", LuWallet], ["office", "Main account", LuLandmark], ["txhist", "Transaction history", LuHistory], ["khata", "Other accounts", LuNotebookPen], ["delivery", "Passport Delivery List", LuStamp], ["duelist", "Due Amount List", LuReceipt], ["salary", "Salary accounts", LuBanknote], ["statements", "Statements", LuScrollText], ["packages", "Employer packages", LuPackage]];
// sections inside "Website" (each still needs its own staff permission)
const WEB_SUB = [["content", "Website content", LuImage], ["headlines", "Headlines", LuMegaphone], ["about", "About page", LuInfo], ["slides", "Home slideshow", LuGalleryHorizontal], ["blog", "Blog", LuNewspaper], ["seo", "SEO", LuSearch], ["settings", "Site settings", LuSettings], ["staff", "Staff & permissions", LuUserCog], ["staffhist", "Staff history", LuHistory]];
const TABS = [
  ["overview", "Overview", LuLayoutDashboard], ["users", "Accounts", LuUsers], ["jobs", "Job moderation", LuBriefcase], ["apps", "Applications", LuFileText],
  ["clearance", "BMET clearance", LuStamp], ["passports", "Passport Entry", LuBookUser], ["agents", "Agents", LuContact], ["visa", "Visa applications", LuPlaneTakeoff], ["tickets", "Air tickets", LuTicket], ["pay", "Payments & receipts", LuReceipt], ["mysalary", "My salary", LuWallet], ["myaccounts", "My Accounts", LuNotebookPen], ["mymoney", "Money with me", LuHandCoins], ["attendance", "Office attendance", LuCalendarCheck],
  ["chat", "Live chat", LuMessagesSquare], ["messages", "Messages", LuMessageSquare], ["web", "Website", LuGlobe]
];

export function Admin({ u }) {
  const S = store.S; const R = u.role; const isAdmin = R === "admin";
  const chatUnread = useInboxUnread(isAdmin || !!u.perms?.includes("chat"));
  const can0 = k => k === "agents" ? ["clearance", "receipts", "ledger", "office", "visa"].some(can0) : k === "passports" ? can0("clearance") || can0("visa") : k === "mymoney" ? !!S.myMoney : k === "myaccounts" ? !S.myMoney : k === "overview" || k === "mysalary" || k === "attendance" || k === "mysettings" || isAdmin || (k !== "staff" && k !== "staffhist" && u.perms?.includes(k === "slides" || k === "about" ? "content" : k));
  // employer packages only matter when paid job posting is on (or orders are still open)
  const paySubs = PAY_SUB.filter(([k]) => (k === "statements" ? ["ledger", "receipts", "salary", "office"].some(can0) : k === "txhist" || k === "khata" ? ["office", "ledger", "receipts"].some(can0) : k === "delivery" ? ["office", "ledger", "receipts", "clearance"].some(can0) : k === "duelist" ? ["ledger", "receipts"].some(can0) : can0(k)) && (k !== "packages" || S.settings.paidPosting || S.orders.some(o => o.status === "pending")));
  const webSubs = WEB_SUB.filter(([k]) => can0(k));
  const can = k => k === "pay" ? paySubs.length > 0 : k === "web" ? webSubs.length > 0 : PAY_SUB.some(x => x[0] === k) ? paySubs.some(x => x[0] === k) : can0(k);
  if (PAY_SUB.some(x => x[0] === ui.tab[R])) { ui.paySub = ui.tab[R]; ui.tab[R] = "pay"; } // old links to the separate sections
  if (WEB_SUB.some(x => x[0] === ui.tab[R])) { ui.webSub = ui.tab[R]; ui.tab[R] = "web"; }
  if (!can(ui.tab[R])) ui.tab[R] = "overview";
  if (ui.tab[R] === "pay" && !paySubs.some(x => x[0] === ui.paySub)) ui.paySub = paySubs[0]?.[0];
  if (ui.tab[R] === "web" && !webSubs.some(x => x[0] === ui.webSub)) ui.webSub = webSubs[0]?.[0];
  const top = ui.tab[R], t = top === "pay" ? ui.paySub : top === "web" ? ui.webSub : top;
  const go = tab => { if (PAY_SUB.some(x => x[0] === tab)) { ui.paySub = tab; tab = "pay"; } if (WEB_SUB.some(x => x[0] === tab)) { ui.webSub = tab; tab = "web"; } setTab(R, tab); };
  const agents = S.users.filter(x => x.role === "agent");
  const pendU = S.users.filter(x => x.status === "pending" || x.company?.verify === "pending").length;
  const pendJ = S.jobs.filter(j => j.status === "pending").length;
  const newMsg = S.messages.filter(m => !m.read).length;
  const pendO = S.orders.filter(o => o.status === "pending").length;
  const pendC = S.clearances.filter(c => !clInApps(c) && (c.status === "pending" || cardPending(c))).length, pendA = can0("clearance") ? S.clearances.filter(c => clInApps(c) && c.status === "pending").length : 0;
  const pendP = S.ledger.filter(l => l.status === "pending").length;
  const pendT = S.tickets.filter(x => x.status === "requested").length;
  const pendR = (S.mr?.receipts || []).filter(r => r.status === "pending" && !r.void).length;
  let body;

  if (t === "tickets") {
    const T = [...S.tickets].sort((a, b) => (a.status === "requested" ? -1 : 0) - (b.status === "requested" ? -1 : 0) || b.created.localeCompare(a.created));
    const sel = ui.bookTicket ? S.tickets.find(x => x.id === ui.bookTicket) : null;
    const book = async e => {
      const [d, fd] = formData(e); const f = fd.get("ticketFile");
      if (!f || !f.size) return toast("Add the ticket copy.");
      let ticketFile; try { ticketFile = await readUpload(f, { imageMax: 2000 }); } catch (err) { return toast(err.message); }
      const r = await act("admin.ticketBook", { id: sel.id, airline: d.airline, pnr: d.pnr, flightDate: d.flightDate, fare: d.fare, charge: !!d.charge, ticketFile });
      if (r) { ui.bookTicket = null; commit(); }
    };
    body = <>
      <h2>Air tickets</h2>
      {user(store.S.session)?.role === "admin" && <details className="vf-det mt10" open={wfttShown()} onToggle={e => { if (ui.wfttShow !== e.currentTarget.open) { ui.wfttShow = e.currentTarget.open; try { localStorage.setItem("wfttShow", ui.wfttShow ? "1" : ""); } catch {} } }}>
        <summary>{store.S.wftt?.ready ? "WFTT BD sign-in" : "WFTT BD sign-in (not signed in)"}</summary><WfttPanel /></details>}
      <details className="vf-det mt10" open={!flHidden()} onToggle={e => { if (ui.flHide !== !e.currentTarget.open) { ui.flHide = !e.currentTarget.open; try { localStorage.setItem("flHide", ui.flHide ? "1" : ""); } catch {} } }}><summary>Search flights (net and gross fares)</summary><FlightSearch staff /></details>
      <h3 className="mt14">Ticket requests</h3>
      <div className="tbl"><table><thead><tr><th>Passenger</th><th>From</th><th>Route / flight</th><th>Preferred</th><th>Booking</th><th>Status</th><th></th></tr></thead><tbody>
        {T.length ? T.map(x => { const w = x.candidateId || x.travellers ? { name: x.name, passport: x.passport } : worker(x.workerId) || { name: "Removed worker" }; const ag = user(x.agentId); return (
          <tr key={x.id} className={sel?.id === x.id ? "sel" : ""}><td><b>{w.name}</b><div className="muted small">{w.passport}{x.phone ? ` · ${x.phone}` : ""}</div></td><td>{ag ? ag.agent?.business || ag.name : x.candidateId ? <span className="muted">Job seeker</span> : "—"}</td><td>{x.from} → {x.to}<TicketFlight x={x} />{x.notes && <div className="muted small">{x.notes}</div>}</td><td>{fdate(x.prefDate)}{x.returnDate ? <div className="muted small">Return {fdate(x.returnDate)}</div> : null}</td>
            <td>{x.status === "booked" ? <>{x.airline} · <b>{x.pnr}</b><div className="muted small">{fdate(x.flightDate)}{x.fare ? ` · ${bdtFmt(x.fare)}` : ""}</div>{x.ticketFile && <button className="btn sm link" onClick={() => dlFile(`/api/files/${x.ticketFile.id}`, x.ticketFile.name)}><LuDownload /> Ticket</button>}</> : "—"}</td><td><Pill s={x.status} /></td>
            <td><div className="row tight nowrap">{x.status === "requested" && <><button className="btn sm pri" onClick={() => { ui.bookTicket = x.id; commit(); }}><LuTicket /> Book</button><button className="btn sm danger" onClick={() => act("admin.ticketCancel", { id: x.id })}><LuX /> Cancel</button></>}</div></td></tr>); })
          : <tr><td colSpan={7}><Empty>No ticket requests.</Empty></td></tr>}
      </tbody></table></div>
      {sel && <form className="card fgrid" onSubmit={book} key={sel.id}>
        <h3 className="full">Book ticket: {sel.travellers ? sel.name : worker(sel.workerId)?.name || sel.name} · {sel.from} → {sel.to}</h3>
        {sel.flight && <div className="full"><FlightCard f={sel.flight} compact /><p className="muted small">Book this flight in WFTT (b2b.wfttbd.com), then fill in the PNR here.</p></div>}
        {sel.travellers && <div className="full tbl"><table><thead><tr><th>Traveller</th><th>Date of birth</th><th>Nationality</th><th>Passport</th><th>Expiry</th><th>Copies</th></tr></thead><tbody>
          {sel.travellers.map((t, i) => <tr key={i}><td data-notr><b>{`${t.title} ${t.given} ${t.surname}`}</b><div className="muted small">{{ ADT: "Adult", CHD: "Child", INF: "Infant" }[t.type]}</div></td><td className="num">{t.dob}</td><td>{t.nationality}</td><td className="num" data-notr>{t.passport}</td><td className="num">{t.expiry}</td>
            <td><div className="row tight">{t.passportFile && <button type="button" className="btn sm" onClick={() => dlFile(`/api/files/${t.passportFile.id}`, t.passportFile.name)}><LuEye /> Passport</button>}{t.visaFile && <button type="button" className="btn sm" onClick={() => dlFile(`/api/files/${t.visaFile.id}`, t.visaFile.name)}><LuEye /> Visa</button>}</div></td></tr>)}</tbody></table></div>}
        <Field label="Airline"><input type="text" name="airline" required defaultValue={sel.flight?.airline || ""} /></Field>
        <Field label="PNR / booking reference"><input type="text" name="pnr" required /></Field>
        <Field label="Flight date"><input type="date" name="flightDate" defaultValue={sel.prefDate} required /></Field>
        <Field label="Fare (BDT)"><input type="number" name="fare" min="0" defaultValue={sel.flight?.price || ""} /></Field>
        <Field label="Ticket copy *" hint="The e-ticket from WFTT: PDF or JPG. The agent / job seeker downloads it." full><FilePick name="ticketFile" accept=".pdf,image/*" /></Field>
        {sel.agentId && <label className="check full"><input type="checkbox" name="charge" defaultChecked /> Add the fare to the agent's account statement</label>}
        <div className="full row"><button className="btn pri" type="submit"><LuCheck /> Booking Confirm</button><button className="btn" type="button" onClick={() => { ui.bookTicket = null; commit(); }}>Close</button></div>
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
          <details className="full vf-det"><summary>Name in other languages (visiting card)</summary>
            <p className="muted small">Common Bangladeshi names are written in Bangla, Arabic and Hindi by themselves. Write a name here only if it comes out wrong or is not written.</p>
            <div className="fgrid mt8"><Field label="বাংলা"><input type="text" name="name_bn" lang="bn" defaultValue={editM?.names?.bn} /></Field>
              <Field label="العربية"><input type="text" name="name_ar" lang="ar" dir="rtl" defaultValue={editM?.names?.ar} /></Field>
              <Field label="हिन्दी"><input type="text" name="name_hi" lang="hi" defaultValue={editM?.names?.hi} /></Field></div></details>
          <Field label="Display order" hint="Lower numbers show first. Also the end of the member ID on the visiting card: 12172026 + this number."><input type="number" name="order" min="0" max="999" defaultValue={editM?.order ?? 10} /></Field>
          <Field label={editM?.photo ? "Replace photo" : "Photo (optional)"} hint="A clear, professional photo. Resized automatically."><FilePick name="photo" accept="image/*" /></Field>
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
          <Field label="Photo" hint="Photos are resized to 1200px JPEG. Use real photos of your office, departures or events."><FilePick name="photo" accept="image/*" required /></Field>
          <Field label="Caption"><input type="text" name="caption" required placeholder="e.g. Workers departing for Riyadh" /></Field>
          <div className="full"><button className="btn pri" type="submit">Add photo</button></div>
        </form>
        <div className="grid g4">{S.gallery.map(g => <figure key={g.id} className="gal"><img src={g.src} alt={g.caption} /><figcaption className="row between"><span className="small">{g.caption}</span><button className="btn sm link danger" onClick={() => del("gallery", g.id)} aria-label="Remove photo"><LuTrash2 /></button></figcaption></figure>)}</div>
      </div>
    </>;
  }

  if (t === "staff") body = <StaffAdmin u={u} />;
  if (t === "staffhist") body = <StaffHistory />;

  if (t === "overview") {
    const byStatus = [...STAGES, "rejected"].map(s => [LABEL[s], S.applications.filter(a => a.status === s).length]);
    const byCountry = Object.keys(COUNTRIES).map(c => [c, live().filter(j => j.country === c).length]).filter(x => x[1]);
    const queue = [[pendA, "Clearance applications from agents", "apps"], [pendC, "Clearance files to act on (new / card to upload)", "clearance"], [pendT, "Air ticket requests", "tickets"], [pendP, "Agent payments to confirm", "ledger"], [pendJ, "Jobs awaiting review", "jobs"], [pendU, "Accounts to approve / verify", "users"], [pendO, "Package orders", "packages"], [newMsg, "New messages", "messages"]].filter(q => q[0] && can(q[2]));
    body = <>
      <h2>System overview</h2>
      <Tiles items={[[S.users.filter(x => x.role === "candidate").length, "Candidates"], [S.users.filter(x => x.role === "employer").length, "Employers"], [agents.length, "Agents"], [live().length, "Live jobs"], [S.applications.length, "Applications"], [S.applications.filter(a => a.status === "hired").length, "Hired"], [S.clearances.filter(openCl).length, "Clearances in progress"]]} />
      {queue.length ? <div className="tiles">{queue.map(([n, l, tab]) => <button key={tab} className="tile alert tilebtn" onClick={() => go(tab)}><b>{n}</b><span>{l} →</span></button>)}</div> : <div className="notice ok">Nothing waiting for review.</div>}
      <StaffRank />
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
              {x.role === "agent" && S.bookMatch?.[x.id]?.length > 0 && <div className="small mt4 ag-match" data-notr>{`Matches the Agents list: ${S.bookMatch[x.id].join(", ")}. Approving joins their earlier records to this account.`}</div>}
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

  if (t === "apps") { const nCl = can("clearance") ? S.clearances.filter(clInApps).length : 0, sub = can("clearance") && (ui.appsSub || (nCl ? "cl" : "jobs")) === "cl" ? "cl" : "jobs"; body = <>
    <h2>Applications</h2>
    {can("clearance") && <nav className="pay-tabs" aria-label="Applications"><button className={sub === "jobs" ? "on" : ""} onClick={() => { ui.appsSub = "jobs"; commit(); }}><LuBriefcase /> Job applications</button>
      <button className={sub === "cl" ? "on" : ""} onClick={() => { ui.appsSub = "cl"; commit(); }}><LuStamp /> {`Clearance applications${nCl ? ` (${nCl})` : ""}`}</button></nav>}
    {sub === "cl" ? <ClearanceApps /> : S.applications.length ? <div className="tbl"><table><thead><tr><th>Candidate</th><th>Job</th><th>Employer</th><th>Applied</th><th>Status</th></tr></thead><tbody>
      {[...S.applications].reverse().map(a => { const j = job(a.jobId); const c = candOf(a); return (
        <tr key={a.id}><td>{c.name}{c.via && <div className="muted small">via {c.via}</div>}</td><td>{j?.title || "—"}</td><td>{j ? company(j) : "—"}</td><td>{fdate(a.appliedAt)}</td><td><StatusSelect a={a} /></td></tr>); })}
    </tbody></table></div> : <Empty>No applications.</Empty>}
  </>; }

  if (t === "visa") body = <VisaAdmin />;
  if (t === "clearance") body = <AdminClearanceList />;
  if (t === "agents") body = <AgentsPage AddForm={can("ledger") || can("receipts") ? LedgerAddForm : null} canLedger={can("ledger")} canMr={can("receipts")} />;
  if (t === "passports") { // BMET Passport Entry, and Visa applications entry (choose KSA or Fiji)
    const subs = [can("clearance") && ["bmet", "BMET Passport Entry", LuStamp], ["visa", "Visa applications entry", LuPlaneTakeoff]].filter(Boolean);
    const pp = subs.some(x => x[0] === ui.ppSub) ? ui.ppSub : subs[0][0];
    const vc = (ui.ppCountry === "ksa" && !can("visa")) ? "" : ui.ppCountry || "";
    body = <>
      {subs.length > 1 && <nav className="pay-tabs" aria-label="Passport Entry">{subs.map(([k, l, I]) => <button key={k} className={pp === k ? "on" : ""} aria-current={pp === k ? "page" : undefined} onClick={() => { ui.ppSub = k; commit(); }}><I /> {l}</button>)}</nav>}
      {pp === "bmet" ? <PassportEntry title="BMET Passport Entry" /> : <>
        <div className="ec-head"><div><h2>Visa applications entry</h2><p className="muted small">Choose the country to open its passport entry.</p></div></div>
        <div className="pp-country" role="radiogroup" aria-label="Country">{[can("visa") && ["ksa", "KSA", "Saudi Arabia"], ["fiji", "Fiji", "Republic of Fiji"]].filter(Boolean).map(([k, l, sub]) =>
          <button key={k} type="button" role="radio" aria-checked={vc === k} className={vc === k ? "on" : ""} onClick={() => { ui.ppCountry = k; commit(); }}><b>{l}</b><span className="small muted">{sub}</span></button>)}</div>
        {vc === "ksa" ? <VisaPassportEntry /> : vc === "fiji" ? <FijiPassportEntry /> : <p className="muted mt14">Select KSA or Fiji above.</p>}
      </>}</>;
  }


  if (t === "ledger" && ui.agentView) body = <AgentsPage AddForm={LedgerAddForm} canLedger={can("ledger")} canMr={can("receipts")} />; // an agent opened from the list below
  else if (t === "ledger") {
    const sel = ui.ledgerAgent ? user(ui.ledgerAgent) : null;
    const totalDue = agents.reduce((s, a) => s + balanceOf(a.id), 0);
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
          return <tr key={a.id} className={on ? "sel" : ""}><td><b>{a.agent?.business || a.name}</b><div className="muted small">{a.name} · {a.agent?.phone}</div></td><td className="num">{num(ch)}</td><td className="num">{num(pd)}</td><td className="num"><b>{num(ch - pd)}</b></td><td>{pp ? <span className="count">{pp}</span> : "—"}</td><td><button className={`btn sm${on ? " pri" : ""}`} onClick={() => { ui.ledgerAgent = a.id; commit(); setTimeout(() => document.getElementById("agent-history")?.scrollIntoView({ behavior: "smooth" }), 80); }}>Payment history</button></td></tr>;
        }) : <tr><td colSpan={6}><Empty>No agents yet.</Empty></td></tr>}
      </tbody></table></div>
      {sel ? <div className="card stack" id="agent-history">
        <div className="row between"><h3>{`Payment history: ${sel.agent?.business || sel.name}`}</h3><button className="btn sm" onClick={() => { ui.ledgerAgent = null; commit(); }}><LuX /> Close</button></div>
        <Statement key={sel.id} title={sel.agent?.business || sel.name} sub={[sel.name, sel.agent?.phone, sel.email].filter(Boolean).join(" · ")} rows={agentRows(S.ledger, sel.id)}
          onRate={(r, v) => act("admin.ledgerEdit", { id: r.id, ...v })}
          actions={r => <div className="row tight nowrap">
            {r.src?.proof?.id && <button className="btn sm" onClick={() => dlFile(`/api/files/${r.src.proof.id}`, r.src.proof.name || "payment-proof")}><LuEye /> Proof</button>}
            {r.pending && <><button className="btn sm pri" onClick={() => confirmLedger(r.id, true)}><LuCheck /> Confirm</button><button className="btn sm danger" onClick={() => confirmLedger(r.id, false)}><LuX /> Reject</button></>}
            {!r.src?.mr && <button className="btn sm link danger" aria-label="Delete entry" onClick={() => confirmBox("Delete this entry from the payment history?", () => act("admin.ledgerDelete", { id: r.id }), "Delete")}><LuTrash2 /></button>}
          </div>} />
        <LedgerAddForm sel={sel} />
      </div> : <p className="muted">Choose an agent to see the full statement, confirm payments and add charges.</p>}
      <div className="mt14 ledger-agents"><AgentsPage AddForm={LedgerAddForm} canLedger={can("ledger")} canMr={can("receipts")} /></div>
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
      <div className="card mb14">
        <h3>Website buttons</h3>
        <p className="muted small">Buttons at the bottom corner of every page. “Chat to Human” (live chat) is always on.</p>
        <div className="switch-list">
          <Switch on={!!s.fabWhatsapp} onChange={v => act("admin.fabs", { key: "fabWhatsapp", v })} label={<span className="row tight"><FaWhatsapp /> WhatsApp button</span>} hint={s.whatsapp ? `Opens WhatsApp chat with +${s.whatsapp}` : "Set the WhatsApp number below first."} />
          <Switch on={!!s.fabHelp} onChange={v => act("admin.fabs", { key: "fabHelp", v })} label={<span className="row tight"><LuInfo /> Help (i) button</span>} hint="Automatic answers about jobs, salary, countries and file status." />
        </div>
      </div>
      <form className="card fgrid" onSubmit={save} noValidate>
        <Field label="Office phone"><input type="tel" name="phone" defaultValue={s.phone} placeholder="+880" /></Field>
        <Field label="Office email"><input type="email" inputMode="email" name="email" defaultValue={s.email} /></Field>
        <Field label="Office address" full><input type="text" name="address" defaultValue={s.address} /></Field>
        <details className="full vf-det"><summary>Office address in other languages (visiting cards)</summary>
          <div className="fgrid mt8"><Field label="বাংলা" full><input type="text" name="address_bn" lang="bn" defaultValue={s.addresses?.bn} /></Field>
            <Field label="العربية" full><input type="text" name="address_ar" lang="ar" dir="rtl" defaultValue={s.addresses?.ar} /></Field>
            <Field label="हिन्दी" full><input type="text" name="address_hi" lang="hi" defaultValue={s.addresses?.hi} /></Field></div></details>
        <Field label="Office hours" full><input type="text" name="hours" defaultValue={s.hours} /></Field>
        <Field label={<span className="row tight"><FaWhatsapp /> WhatsApp number</span>} hint="Used by the WhatsApp button (switch it on above). Include country code, e.g. 8801XXXXXXXXX"><input type="tel" name="whatsapp" defaultValue={s.whatsapp} /></Field>
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
      {isAdmin && <AttendanceSettings />}
    </>;
  }

  if (t === "chat") body = <ChatInbox />;
  if (t === "about") body = <AboutAdmin />;
  if (t === "receipts") body = <ReceiptsAdmin />;
  if (t === "office") body = <OfficeAccount />;
  if (t === "txhist") body = <TransactionHistory />;
  if (t === "khata") body = <OtherAccounts />;
  if (t === "delivery") body = <PassportDelivery />;
  if (t === "duelist") body = <DueList />;
  if (t === "salary") body = <SalaryAdmin />;
  if (t === "mysalary") body = <MySalary />;
  if (t === "myaccounts") body = <OtherAccounts own title="My Accounts" />;
  if (t === "mymoney") body = <MoneyWithMe />;
  if (t === "mysettings") body = <MySettings />;
  if (t === "headlines") body = <HeadlinesAdmin />;
  if (t === "attendance") body = <Attendance />;
  if (t === "statements") body = <StatementsAdmin can={can0} />;
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
      {can0("clearance") && <ClearanceSounds />}
      <Rail role={R} items={TABS.filter(([k]) => can(k)).map(([k, l, I]) => [k, l, I, { users: pendU, jobs: pendJ, apps: pendA, clearance: pendC, tickets: pendT, mysalary: (S.mySalary?.pays || []).filter(p => !p.void && p.status === "pending").length, mymoney: (S.myMoney?.entries || []).filter(e => e.status === "pending" && !e.accepted?.includes(S.myMoney.me?.k)).length, attendance: S.attendance && !S.attendance.marks?.[u.id]?.[S.attendance.today] && new Date(S.attendance.today + "T00:00:00Z").getUTCDay() !== 5 && !(S.attendance.holidays || []).some(h => h.date === S.attendance.today) ? 1 : 0, pay: (can("ledger") ? pendP : 0) + (can("packages") ? pendO : 0) + (can("receipts") ? pendR : 0), messages: newMsg, chat: chatUnread }[k]])}
        foot={[["mysettings", "Settings", LuSettings2], ["logout", "Log out", LuLogOut, 0, signOut]]} />
      <div className="panel">{top === "pay" && <nav className="pay-tabs" aria-label="Payments & receipts">
        {paySubs.map(([k, l, I]) => { const n = { ledger: pendP, packages: pendO, receipts: pendR }[k]; return <button key={k} className={t === k ? "on" : ""} aria-current={t === k ? "page" : undefined} onClick={() => { ui.paySub = k; commit(); }}><I /> {l}{n > 0 && <span className="count">{n}</span>}</button>; })}
      </nav>}{top === "web" && <nav className="pay-tabs" aria-label="Website">
        {webSubs.map(([k, l, I]) => <button key={k} className={t === k ? "on" : ""} aria-current={t === k ? "page" : undefined} onClick={() => { ui.webSub = k; commit(); }}><I /> {l}</button>)}
      </nav>}{body}</div>
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
      <Field label="Picture (JPG or WebP)" hint="Wide landscape photos work best (at least 1600 px wide). Large photos are made smaller before upload." full><FilePick name="file" accept="image/jpeg,image/png,image/webp" /></Field>
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

export const clDelete = c => { const p = clPerson(c); confirmBox(`Delete the clearance file ${c.ref || ""} of ${p.name}? Its documents and the charges it added to the agent account are deleted too. This cannot be undone.`, async () => { if (await act("admin.clDelete", { id: c.id })) closeModal(); }, "Delete"); };
/* RAIMS: the agency's own sign-in on raims.oep.gov.bd; the server reads the EC application list and moves each file here
   (same IC number, or passport) to the RAIMS status, up to Approved. Checked every 30 minutes, or with Sync now. */
/* what RAIMS did on one day: each file's last RAIMS status that day (from the files' history), today first; Previous / Next day */
const bdDayOf = iso => new Date(Date.parse(iso) + 6 * 3600e3).toISOString().slice(0, 10);
/* admin: what each staff member did — every change, the time, and where from (office network or not) */
/* a sound when a file is newly Approved (RAIMS) or a new clearance application arrives — for admin / staff who handle clearance */
const clSeen = { ap: null, apps: null };
function ClearanceSounds() {
  const C = store.S.clearances || [];
  React.useEffect(() => {
    const ap = new Set(C.filter(c => c.status === "approved").map(c => c.id)), apps = new Set(C.filter(clInApps).map(c => c.id));
    if (clSeen.ap) { if ([...ap].some(x => !clSeen.ap.has(x))) tone("approved"); if ([...apps].some(x => !clSeen.apps.has(x))) setTimeout(() => tone("app"), 700); }
    clSeen.ap = ap; clSeen.apps = apps;
  }, [C]);
  return null;
}
function StaffHistory() {
  const S = store.S, staff = S.users.filter(x => x.role === "staff" || x.role === "admin");
  const today = new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10);
  const [f, setF] = React.useState({ uid: "", day: today, q: "" }), [res, setRes] = React.useState(null), [busy, setBusy] = React.useState(false);
  const load = async (x = f) => { setBusy(true); const r = await act("admin.staffLog", x, { quiet: true }); setBusy(false); if (r) setRes(r); };
  React.useEffect(() => { load(); }, []);
  const set = v => { const x = { ...f, ...v }; setF(x); load(x); };
  const step = n => set({ day: new Date(Date.parse((f.day || today) + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10) });
  const tm = iso => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Dhaka" });
  const dt = iso => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "Asia/Dhaka" });
  return <>
    <h2>Staff history</h2>
    <p className="muted small">Every change admin and staff make in the panel: what, when and from where. Only the admin sees this.</p>
    <div className="card row6 wrap sh-tools">
      <select value={f.uid} onChange={e => set({ uid: e.target.value })} aria-label="Staff"><option value="">All admin / staff</option>{staff.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      <button className="btn sm" onClick={() => step(-1)} disabled={!f.day}><LuChevronLeft /> Previous day</button>
      <input type="date" value={f.day} max={today} onChange={e => set({ day: e.target.value })} aria-label="Day" />
      <button className="btn sm" onClick={() => step(1)} disabled={!f.day || f.day >= today}>Next day <LuChevronRight /></button>
      <button className={`btn sm ${f.day ? "" : "pri"}`} onClick={() => set({ day: f.day ? "" : today })}>{f.day ? "All days" : "One day"}</button>
      <input type="search" value={f.q} onChange={e => setF({ ...f, q: e.target.value })} onKeyDown={e => { if (e.key === "Enter") load(); }} placeholder="Search: passport, name, IC…" aria-label="Search" />
      <button className="btn sm pri" disabled={busy} onClick={() => load()}><LuSearch /> {busy ? "Loading…" : "Search"}</button>
    </div>
    {res && <p className="muted small mt8">{`${res.total} entr${res.total === 1 ? "y" : "ies"}${res.total > res.log.length ? ` · showing the latest ${res.log.length}` : ""}`}</p>}
    <div className="tbl mt8"><table><thead><tr><th>Time</th><th>Staff</th><th>Section</th><th>What they did</th><th>From</th></tr></thead><tbody>
      {res?.log.length ? res.log.map(x => <tr key={x.id}><td className="nowrap num">{f.day ? tm(x.at) : `${dt(x.at)} · ${tm(x.at)}`}</td><td data-notr><b>{x.name}</b></td><td>{x.area}</td><td className="small" data-notr>{x.detail}</td>
        <td className="small nowrap" data-notr>{x.office ? <span className="vf-pill ok">Office</span> : <span className="vf-pill">Outside</span>}<div className="muted">{x.ip}{x.device ? ` · ${x.device}` : ""}</div></td></tr>)
        : <tr><td colSpan={5}><Empty>{busy ? "Loading…" : "Nothing found."}</Empty></td></tr>}
    </tbody></table></div>
  </>;
}
function RaimsDay() {
  const today = bdDayOf(new Date().toISOString()), [day, setDay] = React.useState(today);
  const step = n => setDay(d => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10));
  // each file RAIMS moved that day: where it was before the day's first move, and where it is after the last one
  const rows = []; for (const c of store.S.clearances) { const H = c.history || []; let first = -1, lastI = -1;
    H.forEach((h, i) => { if (h.by === "RAIMS" && h.at && bdDayOf(h.at) === day) { if (first < 0) first = i; lastI = i; } });
    if (lastI < 0) continue;
    // only files still on the way: now at Pending Section / AD / DD / Director / ADG Approval (approved files drop out)
    const cur = H[H.length - 1]; if (c.status === "approved" || c.status === "rejected" || !/^pending .+approval$/i.test(String(cur?.t || LABEL[cur?.s] || ""))) continue;
    const pv = H[first - 1], nw = H[lastI], p = clPerson(c);
    if (!/^pending .+approval$/i.test(String(pv ? pv.t || LABEL[pv.s] || "" : ""))) continue; // Last Position must already be a Pending … Approval stage (from Pending Section Approval on)
    rows.push({ id: c.id, name: p.name, passport: p.passport || "—", country: c.country || "—", ic: c.icNo || c.ref, from: pv ? pv.t || LABEL[pv.s] || pv.s : "—", to: nw.t || LABEL[nw.s] || nw.s, at: nw.at }); }
  rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const cnt = {}; for (const r of rows) cnt[r.to] = (cnt[r.to] || 0) + 1;
  const label = new Date(day + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return <div className="raims-day mt8">
    <div className="row6"><button className="btn sm" onClick={() => step(-1)} disabled={day <= new Date(Date.parse(today) - 30 * 864e5).toISOString().slice(0, 10)}><LuChevronLeft /> Previous day</button>
      <b className="small">{day === today ? `Today · ${label}` : label}</b>
      <button className="btn sm" onClick={() => step(1)} disabled={day >= today}>Next day <LuChevronRight /></button></div>
    {rows.length ? <><div className="tbl mt8"><table><thead><tr><th>Name</th><th>Passport No</th><th>Country</th><th>IC No</th><th>Last Position</th><th>Current Position</th></tr></thead><tbody>
      {rows.map(r => <tr key={r.id}><td data-notr><b>{r.name}</b></td><td className="num" data-notr>{r.passport}</td><td>{r.country}</td><td className="num" data-notr>{r.ic}</td><td>{r.from}</td><td className="b">{r.to}</td></tr>)}</tbody></table></div>
      <p className="muted small mt6" data-notr>{`Statuses on RAIMS that day: ${Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} (${v})`).join(", ")}`}</p></>
      : <p className="muted small mt6">No status changes from RAIMS that day.</p>}
  </div>;
}
function RaimsPanel() {
  const R = store.S.raims, isAdmin = user(store.S.session)?.role === "admin";
  const [edit, setEdit] = React.useState(!R?.saved); React.useEffect(() => { if (!R?.saved) setEdit(true); }, [R?.saved]); const [busy, setBusy] = React.useState(false);
  const save = async e => { e.preventDefault(); const [d] = formData(e); setBusy(true); const r = await act("admin.raims", { op: "save", email: d.email, password: d.password, auto: !!d.auto }); setBusy(false); if (r) setEdit(false); };
  const sync = async () => { setBusy(true); const r = await act("admin.raims", { op: "sync" }); setBusy(false); if (r?.problem) toast(r.problem); };
  const L = R?.last; const [api, setApi] = React.useState(null);
  const scan = async () => { setBusy(true); const r = await act("admin.raims", { op: "api" }); setBusy(false); if (r?.pages) setApi(r.pages); };
  return <div className="card raims">
    <div className="row between"><div>{isAdmin ? <><h3 className="bulk-h"><LuRefreshCw /> RAIMS status sync</h3>
      <p className="muted small">Reads the EC application list from RAIMS and sets each file here that was Sent to BMET to the same status (files with the same IC number change together).</p></> : <h3 className="bulk-h"><LuRefreshCw /> Emigration Clearance status</h3>}</div>
      {R?.saved && <button className="btn pri" disabled={busy} onClick={sync}><LuRefreshCw /> {busy ? "Reading RAIMS…" : "Sync now"}</button>}</div>
    {R?.saved && <RaimsDay />}
    {isAdmin && R?.saved && !edit && <p className="small mt8 raims-on" data-notr><LuCircleCheck /> {`Signed in to RAIMS as ${R.email}${R.since ? ` since ${new Date(R.since).toLocaleString("en-GB")}` : ""} · Pre EC Check, Add bulk and status sync use this sign-in until the admin logs out · ${R.auto ? "status checked every 15 minutes" : "status only with Sync now"}`}
      {isAdmin && <button className="btn sm link" disabled={busy} onClick={scan}><LuSearch /> RAIMS API addresses</button>}
      {isAdmin && <button className="btn sm link danger" onClick={() => confirmBox("Log out of RAIMS? Pre EC Check, Add bulk search and status sync stop until the admin signs in again.", () => act("admin.raims", { op: "logout" }), "Log out")}><LuLogOut /> Log out of RAIMS</button>}</p>}
    {edit && (isAdmin ? <form className="fgrid mt8" onSubmit={save} noValidate autoComplete="off">
      <Field label="RAIMS email"><input type="email" name="email" defaultValue={R?.email || ""} autoComplete="off" /></Field>
      <Field label="RAIMS password" hint="Kept encrypted on this server; never shown again"><input type="password" name="password" autoComplete="new-password" /></Field>
      <label className="check full"><input type="checkbox" name="auto" defaultChecked={R ? R.auto : true} /> Check RAIMS every 15 minutes</label>
      <div className="row full"><button className="btn pri" disabled={busy}><LuLogIn /> {busy ? "Signing in…" : "Sign in to RAIMS"}</button>{R?.saved && <button type="button" className="btn" onClick={() => setEdit(false)}>Cancel</button>}</div>
    </form> : <p className="muted small mt8">The admin sets the RAIMS sign-in.</p>)}
    {api && <details className="vf-det mt8" open><summary>RAIMS API addresses its pages use</summary>
      {api.map(x => <div key={x.path} className="mt8 small" data-notr><b>{x.path}</b>{x.error ? <span className="vf-err">{` · ${x.error}`}</span> : <span className="muted">{` · API key ${x.key ? "found" : "not found"} · ${x.apis.length} addresses`}</span>}
        {x.apis?.length > 0 && <ul className="api-list">{x.apis.map(a => <li key={a}><code>{a}</code></li>)}</ul>}</div>)}</details>}
    {L && <div className="mt10 small">
      {L.ok ? <p>{`Last check ${new Date(L.at).toLocaleString("en-GB")} (${L.by}): ${L.rows} files on RAIMS, ${L.matched} matched here, ${L.updated.length} updated.`}</p> : <p className="vf-err">{`Last check ${new Date(L.at).toLocaleString("en-GB")}: ${L.error}`}</p>}

      {L.ok && !L.rows && <details className="vf-det mt8"><summary>RAIMS list was empty — what was read</summary><p className="muted" data-notr>{`Columns: ${(L.head || []).join(", ") || "none"}${L.ajax ? ` · list address ${L.ajax}` : ""}`}</p></details>}
    </div>}
  </div>;
}
const clInApps = c => c.via === "agent" && ["pending", "received"].includes(c.status);
/* Applications › Clearance applications: files agents submitted (e.g. from Pre EC Check). Received tells the agent the file arrived;
   Send to BMET moves it to BMET clearance, where RAIMS sync takes over its status. */
function ClearanceApps() { return <AdminClearanceList apps />; }
/* IC number from RAIMS for an agent's application, then Send to BMET (both needed: the IC links the file to RAIMS status sync) */
function AppIcCell({ c }) {
  const [v, setV] = React.useState(c.icNo || ""), [busy, setBusy] = React.useState(false);
  const send = async () => {
    const ic = v.trim().toUpperCase().replace(/\s+/g, ""); if (!/^IC[-A-Z0-9]{6,}$/.test(ic)) return toast("Enter the IC number from RAIMS, e.g. IC-2026-RL1217-602390.");
    setBusy(true); const ok = (ic === c.icNo || await act("admin.clRef", { id: c.id, ref: ic }, { quiet: true })) && await act("admin.clStatus", { id: c.id, status: "sent_bmet" }); setBusy(false);
  };
  if (c.status === "pending") return <span className="muted small">Mark the file Received first.</span>;
  if (!c.entryList) return <button className="btn sm pri" disabled={busy} onClick={async () => { setBusy(true); await act("admin.clEntry", { id: c.id }); setBusy(false); }}><LuListPlus /> Save to Entry List</button>;
  return <div className="stack6 app-ic"><span className="small ok-txt"><LuCheck /> In Entry List</span><input type="text" value={v} onChange={e => setV(e.target.value.toUpperCase())} onKeyDown={e => { if (e.key === "Enter") send(); }} placeholder="IC number" aria-label="IC number" data-notr />
    <button className="btn sm pri" disabled={busy} onClick={send}><LuSend /> Send to BMET</button></div>;
}
function AdminClearanceList({ apps }) {
  const S = store.S; const isAdmin = user(store.S.session)?.role === "admin"; const fk = apps ? "clAppFilter" : "clFilter", f = ui[fk] || "all";
  const [q, setQ] = React.useState(""); const [per, setPer] = React.useState(25); const [page, setPage] = React.useState(1);
  const match = (k, c) => k === "all" || (k === "open" ? clOpen(c) : k === "card" ? cardPending(c) : k === "sent" ? !!c.card : k === "pay" ? c.payment?.status === "submitted" : c.status === k);
  // agent applications stay in Applications › Clearance applications until the agency sends them to BMET
  const ALL = S.clearances.filter(c => apps ? clInApps(c) : !clInApps(c));
  const cnt = k => ALL.filter(c => match(k, c)).length;
  // in All, files whose card has been sent go to the end (newest first within each part)
  const rows = ALL.filter(c => match(f, c)).sort((a, b) => (f === "all" && !apps ? (a.card ? 1 : 0) - (b.card ? 1 : 0) : 0) || b.created.localeCompare(a.created))
    .map(c => ({ c, p: clPerson(c) }))
    .filter(({ c, p }) => { const k = q.trim().toLowerCase(); return !k || [c.ref, p.name, p.passport, c.country].some(v => String(v || "").toLowerCase().includes(k)); });
  const pages = Math.max(1, Math.ceil(rows.length / per)); const pg = Math.min(page, pages);
  const shown = rows.slice((pg - 1) * per, pg * per);
  const [form, setForm] = React.useState("");
  return <>
    {apps ? <p className="muted small">Agents' BMET clearance applications. Received tells the agent the file has arrived. Then Save to Entry List adds the worker to BMET Passport Entry. Enter the IC number from RAIMS and Send to BMET: the file moves to BMET clearance and its status then follows RAIMS.</p> : <div className="ec-head">
      <h2>BMET clearance applications</h2>
      <div className="ec-head-btns">
        <button className={`btn ${form === "one" ? "dark" : "soft"}`} onClick={() => setForm(x => x === "one" ? "" : "one")}>{form === "one" ? <LuX /> : <LuCirclePlus />} {form === "one" ? "Close the form" : "Create application"}</button>
        <button className={`btn ${form === "bulk" ? "dark" : "soft"}`} onClick={() => setForm(x => x === "bulk" ? "" : "bulk")}>{form === "bulk" ? <LuX /> : <LuListPlus />} {form === "bulk" ? "Close bulk entry" : "Add bulk"}</button>
        <button className={`btn ${form === "raims" ? "dark" : "soft"}`} onClick={() => setForm(x => x === "raims" ? "" : "raims")}>{form === "raims" ? <LuX /> : <LuRefreshCw />} Emigration Clearance</button>
        <button className={`btn ${form === "preec" ? "dark" : "soft"}`} onClick={() => setForm(x => x === "preec" ? "" : "preec")}>{form === "preec" ? <LuX /> : <LuShieldCheck />} Pre EC Check</button>
        <button className={`btn ${form === "cc" ? "dark" : "soft"}`} onClick={() => setForm(x => x === "cc" ? "" : "cc")}>{form === "cc" ? <LuX /> : <LuBadgeCheck />} Clearance Check</button>
      </div>
    </div>}
    {form === "raims" && <RaimsPanel />}
    {form === "preec" && <PreEcCheck onClose={() => setForm("")} />}
    {form === "cc" && <ClearanceCheck onClose={() => setForm("")} />}
    {form === "one" && <GroupEcForm admin onDone={() => setForm("")} />}
    {form === "bulk" && <BulkEcForm onDone={() => setForm("")} />}
    <FilterButtons cur={f} onPick={k => { ui[fk] = k; setPage(1); commit(); }} items={apps ? [["all", "All"], ["pending", "New (Pending)"], ["received", "Received"]].map(([k, l]) => [k, l, cnt(k)]) : [["all", "All"], ["pending", "New (Pending)"], ["open", "In progress"], ["card", "Card to upload"], ["pay", "Payments to check"], ["sent", "Card sent"], ["rejected", "Rejected"]].map(([k, l]) => [k, l, cnt(k)])} />
    <div className="ec-tools mt8">
      <label className="ec-show">Show <select value={per} onChange={e => { setPer(Number(e.target.value)); setPage(1); }}>{[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
      <span className="grow" />
      <label className="ec-search"><input type="text" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} placeholder="EC Ref No, name or passport" /><LuSearch /></label>
    </div>
    <div className="tbl ec-tbl grid"><table><thead><tr><th>SL</th><th>Worker name</th><th>Passport No</th><th>{apps ? "IC number · Send to BMET" : "EC Ref No"}</th><th>Country</th><th>Status</th><th>Submission</th><th>Download Documents</th></tr></thead><tbody>
      {shown.length ? shown.map(({ c, p }, i) => (
        <tr key={c.id}>
          <td>{(pg - 1) * per + i + 1}</td>
          <td><b>{p.name}</b>{apps && c.preEc && <div className="muted small">From Pre EC Check</div>}</td>
          <td className="num" data-notr>{p.passport || "—"}</td>
          <td>{apps ? <AppIcCell c={c} /> : <RefCell c={c} />}</td>
          <td>{c.country}</td>
          <td><StatusCell c={c} only={apps ? ["pending", "received", "rejected"] : null} /></td>
          <td><div className="ec-sub">{c.candidateId ? <b>{p.via}</b> : <AgentCell c={c} via={p.via} />}<span className="num">{ecDay(c.created)}</span></div></td>
          <td>{pastSent(c)
            ? <div className="stack6"><button className="btn sm" onClick={() => openModal("clearance", { cid: c.id, admin: true })}><LuEye /> Details</button>
                {c.payment?.status === "submitted" && <span className="ec-badge pay-pending">Payment to check</span>}
                {cardPending(c) && <span className="ec-badge s-final">Card to upload</span>}
                {c.card && <span className="ec-badge s-approved">Card sent</span>}</div>
            : <DocButtons c={c} />}
            {isAdmin && <button className="btn sm link danger mt4" aria-label={`Delete file of ${p.name}`} title="Delete (admin only)" onClick={() => clDelete(c)}><LuTrash2 /> Delete</button>}</td>
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
    const r = e.currentTarget.getBoundingClientRect(), W = 300, H = 16 + files.length * 52;
    const left = Math.max(8, Math.min(window.innerWidth - W - 8, document.dir === "rtl" ? r.left : r.right - W));
    const top = r.bottom + 4 + H > window.innerHeight ? Math.max(8, r.top - 4 - H) : r.bottom + 4;
    setOpen({ left, top, width: W });
  };
  return (
    <div className="ec-dl" ref={ref}>
      <button className="btn sm" aria-expanded={!!open} onClick={toggle}><LuDownload /> Documents <span className="ec-dl-n">{files.length}</span></button>
      {open && <div className="ec-dl-menu" role="menu" style={open}>
        {files.map(([l, x]) => <div key={l} className="ec-dl-row">
          <button role="menuitem" className="ec-dl-item" title={x.name} onClick={() => dlFile(x.data, x.name)}><LuDownload /> <span>{l}</span><small data-notr>{x.name}</small></button>
          <button role="menuitem" className="ec-dl-view" title={`View ${l}`} aria-label={`View ${l}`} onClick={() => { setOpen(null); openModal("docView", { src: x.data, name: x.name, label: l }); }}><LuEye /> View</button></div>)}
      </div>}
    </div>
  );
}

/* WFTT BD sign-in for live fares (the agency's B2B account); service charge added to every fare shown to agents and job seekers */
// Air tickets › Search flights: open unless this person hid it (remembered in this browser)
// the WFTT sign-in box is hidden unless the admin opens it (remembered); it opens by itself while WFTT is not signed in
const wfttShown = () => { if (ui.wfttShow === undefined) { try { ui.wfttShow = localStorage.getItem("wfttShow") === "1"; } catch { ui.wfttShow = false; } } return ui.wfttShow || !store.S.wftt?.ready; };
const flHidden = () => { if (ui.flHide === undefined) { try { ui.flHide = localStorage.getItem("flHide") === "1"; } catch { ui.flHide = false; } } return ui.flHide; };
function WfttPanel() {
  const W = store.S.wftt, me = user(store.S.session), admin = me?.role === "admin";
  const [f, setF] = React.useState({ email: W?.email || "", password: "" }), [mk, setMk] = React.useState(String(W?.markup ?? 0)), [busy, setBusy] = React.useState(false);
  const save = async e => { e.preventDefault(); setBusy(true); const r = await act("admin.wftt", { op: "save", ...f }); setBusy(false); if (r) setF({ ...f, password: "" }); };
  return <div className={`card raims-panel${W?.ready ? " raims-on" : ""}`}>
    <h3 className="bulk-h"><LuPlaneTakeoff /> WFTT BD (live flight fares)</h3>
    {W?.ready ? <p className="small">Signed in as <b data-notr>{W.email}</b>{W.since ? ` since ${fdate(W.since)}` : ""}. Agents and job seekers can search flights; the sign-in stays until the admin signs out.</p>
      : <p className="muted small">Sign in with the agency's WFTT B2B account (b2b.wfttbd.com). Agents and job seekers then see live fares and send ticket requests here.</p>}
    {admin && <form className="fgrid" onSubmit={save}>
      <Field label="WFTT email"><input type="email" value={f.email} required autoComplete="off" onChange={e => setF({ ...f, email: e.target.value })} /></Field>
      <Field label={W?.ready ? "Password (only to change it)" : "WFTT password"}><input type="password" value={f.password} autoComplete="new-password" onChange={e => setF({ ...f, password: e.target.value })} /></Field>
      <div className="full row tight wrap"><button className="btn pri" disabled={busy}>{busy ? "Signing in…" : W?.ready ? "Sign in again" : "Sign in to WFTT"}</button>
        {W?.ready && <button type="button" className="btn soft" onClick={() => confirmBox("Sign out of WFTT? Flight search stops for agents and job seekers.", () => act("admin.wftt", { op: "logout" }), "Sign out")}>Sign out of WFTT</button>}</div>
    </form>}
    {admin && <div className="row tight wrap mt10"><label className="f">Service charge per ticket (BDT), added to the fare agents and job seekers see<input type="number" min="0" value={mk} onChange={e => setMk(e.target.value)} /></label><button type="button" className="btn sm" onClick={() => act("admin.wftt", { op: "markup", markup: Number(mk || 0) })}>Save</button></div>}
  </div>;
}
/* the file's agent (reference): admin/staff can change it — a registered agent, or a name such as Self */
function AgentCell({ c, via }) {
  const [ed, setEd] = React.useState(false), [v, setV] = React.useState("");
  const ags = (store.S.users || []).filter(x => x.role === "agent" && x.status === "active");
  const nm = a => a.agent?.business || a.name;
  const save = async () => {
    const t = v.trim(); if (t.length < 2) return toast("Choose the agent or write a name.");
    const a = ags.find(x => nm(x).trim().toLowerCase() === t.toLowerCase() || x.agent?.phone === t || x.email === t.toLowerCase());
    if (await act("admin.clAgent", { id: c.id, ...(a ? { agentId: a.id } : { agentName: t }) })) setEd(false);
  };
  if (ed) return <div className="ec-refedit"><input type="text" list={`ag-${c.id}`} value={v} maxLength={120} placeholder="Agent or Self" onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEd(false); }} autoFocus aria-label="Agent" data-notr />
    <datalist id={`ag-${c.id}`}><option value="Self" />{ags.map(a => <option key={a.id} value={nm(a)}>{[a.name !== nm(a) ? a.name : "", a.agent?.phone].filter(Boolean).join(" · ")}</option>)}</datalist>
    <button className="btn sm pri" onClick={save} aria-label="Save"><LuCheck /></button><button className="btn sm" onClick={() => setEd(false)} aria-label="Cancel"><LuX /></button></div>;
  return <div className="ec-refcell"><b data-notr>{via}</b><button className="btn sm link" title="Change agent" aria-label="Change agent" onClick={() => { setV(""); setEd(true); }}><LuPencil /></button></div>;
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

export function StatusCell({ c, wide, only }) {
  const [custom, setCustom] = React.useState(false); const [v, setV] = React.useState(c.status === "custom" ? c.statusText || "" : "");
  const pick = val => { if (val === "custom") { setV(c.status === "custom" ? c.statusText || "" : ""); setCustom(true); } else { setCustom(false); setClStatus(c.id, val); } };
  const saveCustom = async () => { if (await act("admin.clStatus", { id: c.id, status: "custom", text: v })) setCustom(false); };
  // an Approved file is final: a green Approved bar instead of the status list
  if (c.status === "approved") return <div className={`stack6${wide ? "" : " ec-status"}`}><span className="ec-approved"><LuCircleCheck /> {LABEL.approved}</span></div>;
  return (
    <div className={`stack6${wide ? "" : " ec-status"}`}>
      <select className="auto slim" value={custom ? "custom" : c.status} onChange={e => pick(e.target.value)} aria-label="Clearance status">
        {(only || [...CL_STAGES, "rejected"]).map(x => <option key={x} value={x}>{LABEL[x]}</option>)}
        {!only && <option value="custom">{c.status === "custom" && !custom ? `Custom: ${c.statusText}` : "Custom…"}</option>}
      </select>
      {custom && <div className="ec-refedit"><input type="text" value={v} maxLength={80} placeholder="Write the status" onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === "Enter") saveCustom(); if (e.key === "Escape") setCustom(false); }} autoFocus />
        <button className="btn sm pri" onClick={saveCustom} aria-label="Save status"><LuCheck /></button><button className="btn sm" onClick={() => setCustom(false)} aria-label="Cancel"><LuX /></button></div>}
      {c.raims?.status && c.raims.stage === c.status && <span className="muted small raims-st" title={`RAIMS · ${fdate(c.raims.at)}`}><LuRefreshCw /> RAIMS: {c.raims.status}</span>}
    </div>
  );
}


/* an On/Off switch */
function Switch({ on, onChange, label, hint }) {
  return (
    <div className="switch-row">
      <div><div className="b">{label}</div>{hint && <div className="muted small">{hint}</div>}</div>
      <button type="button" role="switch" aria-checked={on} className={`switch${on ? " on" : ""}`} onClick={() => onChange(!on)}>
        <span className="switch-knob" /><span className="switch-txt">{on ? "On" : "Off"}</span></button>
    </div>
  );
}


/* ---------- About page editor ---------- */
function AboutAdmin() {
  const a = store.S.about; const [k, setK] = React.useState(0); // k remounts the form after a reset
  const [docEdit, setDocEdit] = React.useState(null);
  if (!a) return null;
  const save = e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.currentTarget));
    const pts = v => String(v || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    act("admin.about", { op: "save", about: {
      credentials: d.credentials, tagline: d.tagline, overview: d.overview, commitment: d.commitment, docsIntro: d.docsIntro,
      stats: [0, 1, 2, 3].map(i => ({ value: d[`sv${i}`], label: d[`sl${i}`], sub: d[`ss${i}`] })),
      highlights: [0, 1, 2].map(i => ({ value: d[`hv${i}`], label: d[`hl${i}`] })),
      leader: { name: d.lname, title: d.ltitle, badge: d.lbadge, quote: d.lquote, bio: d.lbio },
      mission: { title: d.mt, text: d.mx, tag: d.mg, points: pts(d.mp) }, vision: { title: d.vt, text: d.vx, tag: d.vg, points: pts(d.vp) },
      cta: { title: d.ct, text: d.cx } } });
  };
  const photo = async e => { const f = e.target.files[0]; e.target.value = ""; if (!f) return; try { act("admin.about", { op: "leaderPhoto", file: await readUpload(f, { imageMax: 1200, photo: true }) }); } catch (er) { toast(er.message); } };
  return <>
    <div className="row between"><h2>About page</h2><a className="btn sm" href="#about" target="_blank" rel="noopener"><LuEye /> View page</a></div>
    <p className="muted small mb14">Everything on the About page. Empty boxes are hidden on the page (for example, a number you have not filled in).</p>
    <form key={k} className="stack" onSubmit={save} noValidate>
      <div className="card fgrid"><h3 className="full">Top of the page</h3>
        <Field label="Credentials line" hint="e.g. Government licensed RL 1217 · BAIRA member ___ · Est. 20__" full><input type="text" name="credentials" defaultValue={a.credentials} maxLength={200} /></Field>
        <Field label="Tagline" full><textarea name="tagline" className="short" defaultValue={a.tagline} maxLength={400} /></Field>
        {a.stats.map((x, i) => <fieldset key={i} className="plain ab-ed-stat"><legend className="small b">{`Number box ${i + 1}`}</legend>
          <Field label="Number / value"><input type="text" name={`sv${i}`} defaultValue={x.value} maxLength={30} placeholder={["2015", "5,000+", "RL 1217", "auto"][i]} /></Field>
          <Field label="Label"><input type="text" name={`sl${i}`} defaultValue={x.label} maxLength={60} /></Field>
          <Field label="Small text (optional)"><input type="text" name={`ss${i}`} defaultValue={x.sub} maxLength={60} /></Field></fieldset>)}
        <p className="muted small full">Number box 4 shows the number of destination countries by itself when its value is empty.</p>
      </div>
      <div className="card fgrid"><h3 className="full">Company overview</h3>
        <Field label="Overview text" hint="Leave an empty line between paragraphs." full><textarea name="overview" rows={9} defaultValue={a.overview} maxLength={6000} /></Field>
        <Field label="Commitment (shown in bold)" full><input type="text" name="commitment" defaultValue={a.commitment} maxLength={400} /></Field>
      </div>
      <div className="card fgrid"><h3 className="full">Leadership</h3>
        <p className="muted small full">The leadership section appears when a name is filled in.</p>
        <div className="full row ab-ed-photo">{a.leader.photo ? <img src={a.leader.photo.url} alt="" /> : <span className="muted small">No photo</span>}
          <label className="btn sm"><LuUpload /> {a.leader.photo ? "Change photo" : "Upload photo"}<input type="file" accept="image/*" hidden onChange={photo} /></label>
          {a.leader.photo && <button type="button" className="btn sm danger" onClick={() => act("admin.about", { op: "leaderPhoto", remove: true })}><LuTrash2 /> Remove</button>}</div>
        <Field label="Name"><input type="text" name="lname" defaultValue={a.leader.name} maxLength={80} /></Field>
        <Field label="Title"><input type="text" name="ltitle" defaultValue={a.leader.title} maxLength={80} /></Field>
        <Field label="Badge"><input type="text" name="lbadge" defaultValue={a.leader.badge} maxLength={60} /></Field>
        <Field label="Quote" full><textarea name="lquote" className="short" defaultValue={a.leader.quote} maxLength={500} /></Field>
        <Field label="Short biography" full><textarea name="lbio" rows={4} defaultValue={a.leader.bio} maxLength={2000} /></Field>
        {a.highlights.map((x, i) => <fieldset key={i} className="plain ab-ed-stat"><legend className="small b">{`Highlight ${i + 1}`}</legend>
          <Field label="Value"><input type="text" name={`hv${i}`} defaultValue={x.value} maxLength={30} /></Field>
          <Field label="Label"><input type="text" name={`hl${i}`} defaultValue={x.label} maxLength={60} /></Field></fieldset>)}
      </div>
      <div className="card fgrid"><h3 className="full">Mission &amp; vision</h3>
        {[["m", a.mission, "Mission"], ["v", a.vision, "Vision"]].map(([p, m, l]) => <fieldset key={p} className="plain full fgrid"><legend className="b">{l}</legend>
          <Field label="Heading"><input type="text" name={`${p}t`} defaultValue={m.title} maxLength={80} /></Field>
          <Field label="Value tag"><input type="text" name={`${p}g`} defaultValue={m.tag} maxLength={60} /></Field>
          <Field label="Text" full><textarea name={`${p}x`} className="short" defaultValue={m.text} maxLength={800} /></Field>
          <Field label="Points" hint="One per line" full><textarea name={`${p}p`} rows={3} defaultValue={m.points.join("\n")} /></Field></fieldset>)}
      </div>
      <div className="card fgrid"><h3 className="full">Bottom banner</h3>
        <Field label="Heading" full><input type="text" name="ct" defaultValue={a.cta.title} maxLength={120} /></Field>
        <Field label="Text" full><input type="text" name="cx" defaultValue={a.cta.text} maxLength={300} /></Field>
        <p className="muted small full">Office address, phone and WhatsApp come from Site settings.</p>
        <Field label="Documents section intro" full><input type="text" name="docsIntro" defaultValue={a.docsIntro} maxLength={300} /></Field>
      </div>
      <div className="row"><button className="btn pri" type="submit"><LuCheck /> Save About page</button>
        <button type="button" className="btn" onClick={() => confirmBox("Put back the original texts? Documents and the leader photo are kept.", async () => { if (await act("admin.about", { op: "reset", confirm: true })) setK(x => x + 1); }, "Reset")}><LuRotateCcw /> Reset texts</button></div>
    </form>

    <div className="card mt16">
      <div className="row between"><h3>Licences &amp; documents</h3><button className="btn sm pri" onClick={() => setDocEdit("new")}><LuPlus /> Add document</button></div>
      <p className="muted small">PDF or photo, e.g. RL licence, trade licence, certificate of incorporation, BAIRA membership, TIN/VAT. Shown with a Verified badge.</p>
      {docEdit && <DocForm d={docEdit === "new" ? null : a.docs.find(x => x.id === docEdit)} onDone={() => setDocEdit(null)} />}
      {a.docs.length ? <div className="tbl ec-tbl grid mt8"><table><thead><tr><th>Document</th><th>Number</th><th>Valid</th><th>File</th><th></th></tr></thead><tbody>
        {a.docs.map((d, i) => <tr key={d.id}>
          <td><b>{d.title}</b><div className="muted small">{d.issuer}</div></td><td data-notr>{d.number || "—"}</td><td>{d.valid || "—"}</td>
          <td><a href={d.file?.url} target="_blank" rel="noopener noreferrer" className="small">{d.file?.name}</a></td>
          <td><div className="row tight nowrap">
            <button className="btn sm" disabled={i === 0} onClick={() => act("admin.about", { op: "docMove", id: d.id, dir: -1 }, { quiet: true })} aria-label="Move up"><LuArrowUp /></button>
            <button className="btn sm" disabled={i === a.docs.length - 1} onClick={() => act("admin.about", { op: "docMove", id: d.id, dir: 1 }, { quiet: true })} aria-label="Move down"><LuArrowDown /></button>
            <button className="btn sm" onClick={() => setDocEdit(d.id)} aria-label="Edit"><LuPencil /></button>
            <button className="btn sm danger" onClick={() => confirmBox(`Remove “${d.title}” from the About page?`, () => act("admin.about", { op: "docDelete", id: d.id }), "Remove")} aria-label="Remove"><LuTrash2 /></button>
          </div></td></tr>)}
      </tbody></table></div> : <Empty>No documents yet. The documents section stays hidden until you add one.</Empty>}
    </div>
  </>;
}

function DocForm({ d, onDone }) {
  const [busy, setBusy] = React.useState(false);
  const submit = async e => {
    e.preventDefault(); const fd = new FormData(e.currentTarget); const f = fd.get("file");
    setBusy(true);
    try {
      const file = f && f.size ? await readUpload(f, { imageMax: 2200 }) : null;
      const r = await act("admin.about", { op: d ? "docUpdate" : "docAdd", id: d?.id, title: fd.get("title"), issuer: fd.get("issuer"), number: fd.get("number"), valid: fd.get("valid"), file });
      if (r) onDone();
    } catch (er) { toast(er.message); } finally { setBusy(false); }
  };
  return (
    <form className="card fgrid mt8 jobtpl-edit" onSubmit={submit} noValidate>
      <h4 className="full">{d ? `Edit: ${d.title}` : "Add a document"}</h4>
      <Field label="Document name"><input type="text" name="title" defaultValue={d?.title} placeholder="e.g. RL Licence (BMET)" maxLength={120} required /></Field>
      <Field label="Issued by"><input type="text" name="issuer" defaultValue={d?.issuer} placeholder="e.g. Ministry of Expatriates' Welfare" maxLength={120} /></Field>
      <Field label="Number"><input type="text" name="number" defaultValue={d?.number} placeholder="e.g. RL 1217" maxLength={80} /></Field>
      <Field label="Valid until / date"><input type="text" name="valid" defaultValue={d?.valid} placeholder="e.g. 31 Dec 2028" maxLength={60} /></Field>
      <Field label={d ? "Replace file (optional)" : "File (PDF or photo)"} full><FilePick name="file" accept="application/pdf,image/*" /></Field>
      <div className="full row"><button className="btn pri" type="submit" disabled={busy}><LuCheck /> {busy ? "Uploading…" : d ? "Save" : "Add document"}</button><button type="button" className="btn" onClick={onDone}>Cancel</button></div>
    </form>
  );
}

/* Staff & permissions: admin and staff IDs, made from an Expert Team member or by hand; each has a signature for money receipts */
function StaffAdmin({ u }) {
  const S = store.S; const team = S.team || [];
  const ids = S.users.filter(x => (x.role === "staff" || x.role === "admin") && x.id !== u.id);
  const taken = new Set(S.users.map(x => x.memberId).filter(Boolean));
  const [mid, setMid] = React.useState(""); const [role, setRole] = React.useState("staff");
  const m = team.find(x => x.id === mid);
  const add = e => {
    const [d, fd] = formData(e); const form = e.currentTarget;
    act("admin.staff", { op: "add", role, memberId: mid || undefined, name: d.name, email: d.email, pass: d.pass, perms: fd.getAll("perms") }).then(r => { if (r) { form.reset(); setMid(""); setRole("staff"); } });
  };
  const toggle = (x, k) => act("admin.staff", { op: "perms", id: x.id, perms: x.perms.includes(k) ? x.perms.filter(p => p !== k) : [...x.perms, k] }, { quiet: true });
  const member = x => team.find(y => y.id === x.memberId);
  return <>
    <h2>Staff &amp; permissions</h2>
    <p className="muted">Admin and staff accounts sign in like everyone else. Staff see only the sections you allow; an admin sees everything.</p>
    {!u.signature && <div className="notice mb14">Upload your signature in Settings (bottom of the menu). It is shown on money receipts you enter or approve. <button className="btn link sm" onClick={() => setTab(u.role, "mysettings")}>Open Settings</button></div>}
    <form className="card fgrid" onSubmit={add} key={mid + role}>
      <h3 className="full">Create admin / staff ID</h3>
      <Field label="From Expert Team" hint="Choose a team member: the name and designation come from the Expert Team." full>
        <select value={mid} onChange={e => setMid(e.target.value)}><option value="">— Not from the team (type the name) —</option>
          {team.map(t => <option key={t.id} value={t.id} disabled={taken.has(t.id)} data-notr>{`${t.name} · ${t.title}${taken.has(t.id) ? " (has an ID)" : ""}`}</option>)}</select></Field>
      {m ? <div className="mr-member full">{m.photo?.data ? <img src={m.photo.data} alt="" /> : <Avatar name={m.name} size={44} />}<div><b data-notr>{m.name}</b><div className="muted small" data-notr>{m.title}{m.dept ? ` · ${m.dept}` : ""}</div></div></div>
        : <Field label="Name"><input type="text" name="name" required /></Field>}
      <Field label="ID type"><select value={role} onChange={e => setRole(e.target.value)}><option value="staff">Staff</option><option value="admin">Admin (full access)</option></select></Field>
      <Field label="Email (login)"><input type="email" name="email" required defaultValue={m?.email || ""} /></Field>
      <Field label="Password" hint="At least 8 characters"><input type="password" name="pass" minLength={8} required autoComplete="new-password" /></Field>
      {role === "staff" && <fieldset className="plain full"><legend className="small b">Can open</legend><div className="grid checkgrid">{STAFF_PERMS.map(([k, l]) => <label key={k} className="check"><input type="checkbox" name="perms" value={k} defaultChecked={["apps", "clearance", "tickets"].includes(k)} /> {l}</label>)}</div></fieldset>}
      <div className="full"><button className="btn pri" type="submit">{role === "admin" ? "Create admin ID" : "Create staff ID"}</button></div>
    </form>
    {ids.length ? ids.map(x => { const tm = member(x); return (
      <div className="card stack8" key={x.id}>
        <div className="row between"><div className="row">{tm?.photo?.data ? <img className="mr-av" src={tm.photo.data} alt="" /> : <Avatar name={x.name} size={40} />}<div><b data-notr>{x.name}</b><RoleBadges role={x.role} /> <span className="ec-badge">{x.role === "admin" ? "Admin" : "Staff"}</span><div className="muted small" data-notr>{[tm?.title, x.email].filter(Boolean).join(" · ")}</div></div><Pill s={x.status} /></div>
          <div className="row tight">{x.status === "active" ? <button className="btn sm" onClick={() => act("admin.userState", { id: x.id, status: "suspended" })}><LuBan /> Suspend</button> : <button className="btn sm" onClick={() => act("admin.userState", { id: x.id, status: "active" })}>Reactivate</button>}<button className="btn sm danger" onClick={() => deleteUser(x.id)} aria-label={`Delete ${x.name}`}><LuTrash2 /></button></div></div>
        <label className="f mr-link">Expert Team member<select value={x.memberId || ""} onChange={e => act("admin.staff", { op: "member", id: x.id, memberId: e.target.value })}><option value="">— Not linked —</option>
          {team.map(t => <option key={t.id} value={t.id} disabled={taken.has(t.id) && t.id !== x.memberId} data-notr>{`${t.name} · ${t.title}`}</option>)}</select></label>
        <SignatureBox u={x} title="Signature" note="Shown on money receipts this person enters or approves." />
        {x.role === "staff" && <div className="grid checkgrid">{STAFF_PERMS.map(([k, l]) => <label key={k} className="check"><input type="checkbox" checked={x.perms.includes(k)} onChange={() => toggle(x, k)} /> {l}</label>)}</div>}
      </div>); }) : <Empty>No other admin or staff IDs yet.</Empty>}
  </>;
}

const confirmLedger = (lid, ok) => act("admin.ledgerConfirm", { id: lid, ok });
/* add a line to an agent's payment history: a charge (quantity × rate) or a payment received */
function LedgerAddForm({ sel, book, title = "Add to payment history" }) {
  const day = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const blankRow = (type = "charge", date = day()) => ({ k: Math.random().toString(36).slice(2), type, date, rate: "", qty: "1", method: "Cash", ref: "", desc: "" });
  const [rows, setRows] = React.useState(() => [blankRow()]); const [busy, setBusy] = React.useState(false);
  const set = (i, v) => setRows(rows.map((r, j) => (j === i ? { ...r, ...v } : r)));
  // opening balances, kept out of the Main account: "due" = owed from before (a charge), "advance" = advance money paid before (a credit)
  const OPEN = { due: ["charge", "Previous due"], advance: ["payment", "Advance money"] };
  const total = r => (r.type === "charge" ? Number(r.qty) || 0 : 1) * (Number(r.rate) || 0);
  const add = async e => {
    e.preventDefault();
    for (const [i, r] of rows.entries()) if (!(total(r) >= 1) || (!r.desc.trim() && !OPEN[r.type])) { toast(`Enter the amount and description${rows.length > 1 ? ` (row ${i + 1})` : ""}.`); return; }
    setBusy(true);
    const res = await act(book ? "admin.agentBook" : "admin.ledgerAdd", { ...(book ? { op: "entries", id: sel.id } : { agentId: sel.id }), rows: rows.map(r => { const o = OPEN[r.type]; return o ? { type: o[0], opening: true, date: r.date, desc: `${o[1]}${r.desc.trim() ? `: ${r.desc.trim()}` : ""}`, rate: r.rate, qty: 1, method: "", ref: r.ref } : { type: r.type, date: r.date, desc: r.desc, rate: r.rate, qty: r.type === "charge" ? r.qty : 1, method: r.method, ref: r.ref }; }) });
    setBusy(false); if (res) setRows([blankRow(rows[rows.length - 1].type, rows[rows.length - 1].date)]);
  };
  const sum = rows.reduce((t, r) => t + (r.type === "payment" || r.type === "advance" ? -1 : 1) * total(r), 0);
  return <form className="divider ledger-add" onSubmit={add} noValidate key={sel.id}>
    <h4>{title}</h4>
    {rows.map((r, i) => <div key={r.k} className={`fgrid${rows.length > 1 ? " mr-line" : ""}`}>
      {rows.length > 1 && <div className="mr-line-head full"><b>{`Entry ${i + 1}`}</b><button type="button" className="btn sm link danger" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={`Remove entry ${i + 1}`}><LuX /> Remove</button></div>}
      <Field label="Type"><select value={r.type} onChange={e => set(i, { type: e.target.value })}><option value="charge">Debit: charge (agent owes)</option><option value="payment">Credit: money received</option><optgroup label="Opening balance (not added to the Main account)"><option value="due">Previous due (owed from before)</option><option value="advance">Advance money (paid before)</option></optgroup></select></Field>
      <Field label="Date"><input type="date" value={r.date} onChange={e => set(i, { date: e.target.value })} required /></Field>
      {r.type === "due" ? <>
        <Field label="Previous due (BDT)" hint="The amount the agent already owed before this account. Not added to the Main account."><input type="number" min="1" value={r.rate} onChange={e => set(i, { rate: e.target.value })} placeholder="e.g. 25000" /></Field>
      </> : r.type === "advance" ? <>
        <Field label="Advance money (BDT)" hint="Money the agent paid in advance before this account. Not added to the Main account."><input type="number" min="1" value={r.rate} onChange={e => set(i, { rate: e.target.value })} placeholder="e.g. 10000" /></Field>
      </> : r.type === "charge" ? <>
        <Field label="Rate (BDT) × Quantity" hint={total(r) ? `Debit: ${num(r.rate)} × ${r.qty || 0} = ${num(total(r))} BDT` : "e.g. 6000 × 1"}><div className="st-rq">
          <input type="number" min="1" value={r.rate} onChange={e => set(i, { rate: e.target.value })} placeholder="6000" aria-label="Rate (BDT)" /><span>X</span>
          <input type="number" min="1" step="1" value={r.qty} onChange={e => set(i, { qty: e.target.value })} aria-label="Quantity" className="q" /></div></Field>
      </> : <>
        <Field label="Amount (BDT)"><input type="number" min="1" value={r.rate} onChange={e => set(i, { rate: e.target.value })} /></Field>
        <Field label="Received by"><select value={r.method} onChange={e => set(i, { method: e.target.value })}><option>Cash</option><optgroup label="Mobile banking">{MFS.map(x => <option key={x} value={`Mobile banking · ${x}`}>{x}</option>)}</optgroup><optgroup label="Bank">{BANKS.map(x => <option key={x} value={`Bank transfer · ${x}`}>{x}</option>)}</optgroup><option value="Cheque">Cheque</option><optgroup label="Given to (counted with them, not in office cash)">{(store.S.leaders || store.S.office?.leaders || []).map(l => <option key={l.k} value={`Person · ${l.k}`}>{`${l.name} · ${l.title}`}</option>)}</optgroup></select></Field>
        <Field label="Reference no."><input type="text" value={r.ref} onChange={e => set(i, { ref: e.target.value })} /></Field>
      </>}
      <Field label={<span className="field-head">Details<PassportPick onPick={pp => set(i, { desc: ppLine(pp) })} /></span>} full><input type="text" value={r.desc} onChange={e => set(i, { desc: e.target.value })} placeholder={OPEN[r.type] ? "Optional, e.g. Old account up to Oct 2026" : r.type === "charge" ? "e.g. 1 QATAR (NON) (FC) PP (A16406219)" : "e.g. Money Received"} /></Field>
    </div>)}
    <div className="row6 mt8"><button type="button" className="btn sm" onClick={() => { const l = rows[rows.length - 1]; setRows([...rows, blankRow(l.type, l.date)]); }}><LuPlus /> Add another entry</button>
      {rows.length > 1 && <span className="muted small">{`${rows.length} entries · balance change ${sum >= 0 ? "+" : "−"}${num(Math.abs(sum))} BDT`}</span>}</div>
    <div className="mt14"><button className="btn pri" type="submit" disabled={busy}>{rows.length > 1 ? `Add ${rows.length} entries` : "Add"}</button></div>
  </form>;
}
