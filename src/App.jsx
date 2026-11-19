import React, { useState, useEffect, useSyncExternalStore } from "react";
import { LuMenu, LuBell, LuCheck, LuMoon, LuSun, LuLanguages, LuLogOut, LuLayoutDashboard, LuLogIn, LuUserPlus, LuSend, LuMailCheck, LuRefreshCw, LuDownload, LuFileText, LuKeyRound, LuWifiOff, LuPhone, LuMail } from "react-icons/lu";
import { FaWhatsapp, FaFacebookF, FaYoutube, FaLinkedinIn, FaTiktok } from "react-icons/fa6";
import { ChatWidget } from "./Chat.jsx";
import { TeamChatWidget } from "./TeamChat.jsx";
import { ShareJob } from "./Share.jsx";
import { store, subscribe, getVersion, touch, me, user, job, unread, PAGES, fdate, kb, candOf, worker, clPerson, LABEL, CL_STAGES, CL_DOCS , findMember } from "./store.js";
import { openModal, closeModal, signOut, toast, formData, setClStatus, downloadFile, fileExt, act, afterLogin } from "./actions.js";
import { Logo, Toast, ModalFrame, Pill, ClPipe, CardDownload, Avatar, Drawer } from "./ui.jsx";
import { CardAdmin, AgentDocsView } from "./dash/shared.jsx";
import { Home, Jobs, JobDetail, Services, About, Blog, Post, Contact, Track, Setup, Team, waLink } from "./pages/Public.jsx";
import { Dashboard } from "./dash/Dashboard.jsx";
import { ClPayForm } from "./dash/Agent.jsx";
import { MrEntry, MrView, MrAccount, VerifyReceipt } from "./dash/Receipts.jsx";
import { SalaryPay, SalaryView, VerifySalary } from "./dash/Accounts.jsx";
import { StatusCell, ClPayCell } from "./dash/Admin.jsx";
import { LANGS, getLang, setLang, t, onLang } from "./i18n.js";
import { VisitingCard, VerifyMember, VerifyBody } from "./VCard.jsx";
import { currentTheme, toggleTheme } from "./theme.js";
import { SITE } from "./site.js";
import { LuExternalLink, LuShieldCheck } from "react-icons/lu";

function useHash() {
  const [h, setH] = useState(location.hash.slice(1) || "home");
  useEffect(() => {
    const f = () => { setH(location.hash.slice(1) || "home"); store.ui.navOpen = false; window.scrollTo(0, 0); };
    window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f);
  }, []);
  return h;
}

export default function App() {
  useSyncExternalStore(subscribe, getVersion);
  useEffect(() => onLang(() => touch()), []);
  const h = useHash();
  let page = h, arg = null;
  if (h.startsWith("job-")) { page = "job"; arg = h.slice(4); }
  else if (h.startsWith("post-")) { page = "post"; arg = h.slice(5); }
  else if (h === "setup" || h.startsWith("setup-")) { page = "setup"; arg = h.slice(6); }
  else if (h.startsWith("verify-")) { page = "verify"; arg = h.slice(7); }
  else if (h.startsWith("receipt-")) { page = "receipt"; arg = h.slice(8); }
  else if (h.startsWith("salary-")) { page = "salary"; arg = h.slice(7); }
  else if (!PAGES.includes(h) && h !== "dashboard") page = "home";
  const panelSite = SITE.admin ? "admin" : SITE.agent ? "agent" : null; // admin.<domain> or agent.<domain>
  if (panelSite && h.startsWith("handoff-")) { page = "handoff"; arg = h.slice(8); }
  else if (panelSite && !["dashboard", "setup", "job", "post", "verify", "receipt", "salary"].includes(page)) page = "dashboard"; // the panel opens straight to the dashboard
  useEffect(() => {
    if (page !== "handoff") return;
    history.replaceState(null, "", "#dashboard"); // the one-time pass leaves the address bar at once
    act("auth.handoff", { token: arg }, { quiet: true }).then(() => window.dispatchEvent(new HashChangeEvent("hashchange")));
  }, [page, arg]);

  // SEO: title + meta description per page (managed from Admin › SEO)
  useEffect(() => {
    const S = store.S; const key = page === "job" ? "jobs" : page === "post" ? "blog" : PAGES.includes(page) ? page : "home";
    const seo = S.seo[key] || S.seo.home || { title: "Mam & Mam Overseas Ltd.", desc: "" };
    let title = seo.title;
    if (page === "job" && job(arg)) title = `${job(arg).title} in ${job(arg).city} | Mam & Mam Overseas Ltd.`;
    if (page === "post") { const p = S.posts.find(x => x.id === arg); if (p) title = `${p.title} | Mam & Mam Overseas Ltd.`; }
    if (page === "dashboard") title = "Dashboard | Mam & Mam Overseas Ltd.";
    if (page === "verify") title = "Verify team member | Mam & Mam Overseas Ltd.";
    if (page === "receipt") title = "Verify money receipt | Mam & Mam Overseas Ltd.";
    if (page === "salary") title = "Verify salary receipt | Mam & Mam Overseas Ltd.";
    document.title = t(title);
    document.querySelector('meta[name="description"]')?.setAttribute("content", seo.desc);
  });

  if (page === "verify") return <><VerifyMember id={arg} /><Toast /></>;
  if (page === "receipt") return <><VerifyReceipt token={arg} /><Toast /></>;
  if (page === "salary") return <><VerifySalary token={arg} /><Toast /></>;
  if (panelSite) return (
    <>
      <PanelHeader kind={panelSite} dash={!!me() && !["handoff", "setup", "job", "post"].includes(page)} />
      {store.offline && <div className="demo-strip"><div className="wrap"><span><LuWifiOff /> Cannot reach the server. Check your internet connection; the page will work again when it is back.</span></div></div>}
      <main>{page === "handoff" ? <section className="sec"><div className="wrap"><p className="muted">Signing you in…</p></div></section> : page === "setup" && panelSite === "admin" ? <Setup token={arg} /> : page === "job" ? <JobDetail id={arg} /> : page === "post" ? <Post id={arg} /> : me() ? <Dashboard /> : <PanelSignIn kind={panelSite} />}</main>
      <ModalHost />
      {panelSite === "agent" && <ChatWidget assistant={false} />}
      {me() && (me().role === "admin" || me().role === "staff") && <TeamChatWidget me={me()} />}
      <Toast />
    </>
  );

  const body = {
    home: <Home />, jobs: <Jobs />, services: <Services />, track: <Track />, team: <Team />, about: <About />, blog: <Blog />, contact: <Contact />,
    dashboard: <Dashboard />, job: <JobDetail id={arg} />, post: <Post id={arg} />, setup: <Setup token={arg} />
  }[page];
  const navOn = page === "job" ? "jobs" : page === "post" ? "blog" : page;

  return (
    <>
      <Header navOn={navOn} />
      {store.offline && <div className="demo-strip"><div className="wrap"><span><LuWifiOff /> Cannot reach the server. Check your internet connection; the page will work again when it is back.</span></div></div>}
      <main>{body}</main>
      <Footer />
      <ModalHost />
      <ChatWidget onAgent={() => openModal("auth", { mode: "register", role: "agent" })} />
      {!SITE.main && me() && (me().role === "admin" || me().role === "staff") && <TeamChatWidget me={me()} />}
      <Toast />
    </>
  );
}

function Header({ navOn }) {
  const u = me(); const ui = store.ui;
  const links = [["home", "Home"], ["jobs", "Jobs"], ["services", "Services"], ["track", "Track"], ["about", "About"], ["team", "Expert Team"], ["blog", "Blog"], ["contact", "Contact"]];
  const panel = { admin: "Admin panel", staff: "Staff panel", employer: "Employer panel", agent: "Agent panel", candidate: "My dashboard" };
  return (
    <header className="top">
    <div className="utilbar"><div className="wrap"><div className="util-l">
      {store.S.settings.phone ? <a href={`tel:${store.S.settings.phone.replace(/[^\d+]/g, "")}`}><LuPhone /> <span className="num">{store.S.settings.phone}</span></a> : null}
      {store.S.settings.email ? <a className="util-mail" href={`mailto:${store.S.settings.email}`}><LuMail /> {store.S.settings.email}</a> : null}
      <span className="util-lic">Government licensed recruiting agency · RL 1217</span></div><Prefs /></div></div>
    <div className="wrap topbar">
      <button className="btn menu-btn" onClick={() => { ui.navOpen = true; touch(); }} aria-label="Open menu" aria-expanded={!!ui.navOpen}><LuMenu /></button>
      <a className="logo" href="#home" aria-label="Mam & Mam Overseas Ltd. home"><Logo /><div><b>MAM &amp; MAM OVERSEAS LTD.</b><span>Recruiting Licence RL 1217</span></div></a>
      <nav className="main">{links.map(([k, t]) => <a key={k} href={`#${k}`} className={navOn === k ? "on" : ""}>{t}</a>)}</nav>
      <Drawer open={!!ui.navOpen} onClose={() => { ui.navOpen = false; touch(); }} label="Site menu"
        title={<a className="logo drawer-logo" href="#home" onClick={() => { ui.navOpen = false; touch(); }}><Logo size={40} /><div><b>MAM &amp; MAM OVERSEAS LTD.</b><span>Recruiting Licence RL 1217</span></div></a>}>
        <nav className="drawer-nav">{links.map(([k, t]) => <a key={k} href={`#${k}`} className={navOn === k ? "on" : ""} onClick={() => { ui.navOpen = false; touch(); }}>{t}</a>)}
          {u && <a href="#dashboard" className={navOn === "dashboard" ? "on" : ""} onClick={() => { ui.navOpen = false; touch(); }}><LuLayoutDashboard /> {panel[u.role]}</a>}</nav>
        {(store.S.settings.phone || store.S.settings.email) && <div className="drawer-contact">
          {store.S.settings.phone && <a href={`tel:${store.S.settings.phone.replace(/[^\d+]/g, "")}`}><LuPhone /> <span className="num">{store.S.settings.phone}</span></a>}
          {store.S.settings.email && <a href={`mailto:${store.S.settings.email}`}><LuMail /> {store.S.settings.email}</a>}</div>}
        <p className="drawer-lic">Government licensed recruiting agency · RL 1217</p>
      </Drawer>
      <div className="acct">
        {u ? <>
          <a className="btn sm pri" href="#dashboard"><LuLayoutDashboard /> {panel[u.role]}</a>
          <NotifBell u={u} />
          <button className="btn sm" onClick={() => openModal("password")} aria-label="Change password" title="Change password"><LuKeyRound /></button>
          <button className="btn sm" onClick={signOut} aria-label="Sign out" title="Sign out"><LuLogOut /><span className="hide-lg">Sign out</span></button>
        </> : <>
          <a className="btn sm acc" href="#jobs"><LuSend /> Apply now</a>
          <button className="btn sm" onClick={() => openModal("auth", { mode: "login" })}><LuLogIn /> Sign in</button>
        </>}
      </div>
    </div></header>
  );
}

/* bell in the header: unread count and the latest notifications */
function NotifBell({ u }) {
  const [pos, setPos] = useState(null); const ref = React.useRef(null);
  const N = store.S.notifications.filter(n => n.uid === u.id).slice(0, 40); const n = N.filter(x => !x.read).length;
  useEffect(() => {
    if (!pos) return;
    const off = e => { if (ref.current && !ref.current.contains(e.target)) setPos(null); };
    const esc = e => { if (e.key === "Escape") setPos(null); };
    const re = () => setPos(null);
    document.addEventListener("mousedown", off); document.addEventListener("keydown", esc); window.addEventListener("resize", re);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); window.removeEventListener("resize", re); };
  }, [pos]);
  const toggle = e => { if (pos) return setPos(null); const r = e.currentTarget.getBoundingClientRect(), w = Math.min(380, window.innerWidth - 16); setPos({ top: r.bottom + 8, left: Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)), width: w }); };
  return <div className="bell" ref={ref}>
    <button className="btn sm bell-btn" onClick={toggle} aria-label={n ? `Notifications, ${n} new` : "Notifications"} title="Notifications" aria-expanded={!!pos}><LuBell />{n > 0 && <span className="count">{n > 99 ? "99+" : n}</span>}</button>
    {pos && <div className="bell-pop" style={pos} role="dialog" aria-label="Notifications">
      <div className="bell-head"><b>Notifications</b>{n > 0 && <button className="btn sm link" onClick={() => act("notif.readAll", {}, { quiet: true })}><LuCheck /> Mark all as read</button>}</div>
      <div className="bell-list">{N.length ? N.map(x => <div key={x.id} className={`bell-item${x.read ? "" : " new"}`}><span className="bell-dot" /><div><div>{x.text}</div><div className="muted small">{fdate(x.at)}</div></div></div>)
        : <p className="muted small bell-empty">No notifications.</p>}</div>
    </div>}
  </div>;
}

/* the separate panels: admin.<domain> and agent.<domain> */
function PanelHeader({ kind, dash }) {
  const u = me(); const label = kind === "agent" ? "Agent panel" : "Admin panel";
  return (
    <header className="top admin-top">
      <div className="utilbar"><div className="wrap"><div className="util-l"><span className="util-lic"><LuShieldCheck /> {kind === "agent" ? "Agent panel · Mam & Mam Overseas Ltd." : "Admin panel · Mam & Mam Overseas Ltd."}</span></div><Prefs /></div></div>
      <div className="wrap topbar">
        {dash && <button className="btn menu-btn panel-menu" onClick={() => { store.ui.railOpen = true; touch(); }} aria-label="Open menu" aria-expanded={!!store.ui.railOpen}><LuMenu /></button>}
        <a className="logo" href="#dashboard" aria-label={`${label} home`}><Logo /><div><b>MAM &amp; MAM OVERSEAS LTD.</b><span>{label}</span></div></a>
        <div className="acct">
          {SITE.main && <a className="btn sm" href={SITE.main} target="_blank" rel="noopener noreferrer"><LuExternalLink /> <span className="hide-sm">View website</span></a>}
          {u && <>
            <NotifBell u={u} />
            <button className="btn sm" onClick={() => openModal("password")} aria-label="Change password" title="Change password"><LuKeyRound /></button>
            <button className="btn sm" onClick={kind === "agent" && SITE.main ? agentSignOut : signOut} aria-label="Sign out" title="Sign out"><LuLogOut /><span className="hide-lg">Sign out</span></button>
          </>}
        </div>
      </div>
    </header>
  );
}

/* agents came from the public site, so signing out of the agent panel takes them back to its home page */
async function agentSignOut() {
  const r = await act("auth.logout", {}, { quiet: true });
  if (r) location.href = `${SITE.main}/#home`;
}

function PanelSignIn({ kind }) {
  const busy = store.ui.busy; const agent = kind === "agent";
  const login = async e => {
    const [d] = formData(e);
    const r = await act("auth.login", { email: d.email, pass: d.pass });
    if (r?.otp) { openModal("otp", { otp: r.otp, email: r.email, code: r.code }); return; }
    if (r && !r.verify) afterLogin(r);
  };
  return (
    <section className="sec"><div className="wrap admin-signin">
      <form className="card stack12" onSubmit={login}>
        <div className="modal-brand"><Logo size={56} /></div>
        <h1 className="h1s">{agent ? "Agent panel" : "Admin panel"}</h1>
        <p className="muted">{agent ? "For the agency's registered agents." : "For the agency's admin and staff only."}</p>
        <label className="f">Email<input type="email" name="email" required autoComplete="username" autoFocus /></label>
        <label className="f">Password<input type="password" name="pass" required autoComplete="current-password" /></label>
        <button className="btn pri" type="submit" disabled={busy}><LuLogIn /> Sign in</button>
        {SITE.main && (agent
          ? <p className="muted small">New agent? <a href={`${SITE.main}/#home`}>Register on the website</a></p>
          : <p className="muted small">Job seeker, employer or agent? <a href={SITE.main}>Go to the website</a></p>)}
      </form>
    </div></section>
  );
}

function Prefs() {
  const [, setN] = useState(0); const dark = currentTheme() === "dark"; const l = getLang();
  return (
    <div className="prefs">
      <label className="langsel" title="Language" data-notr>
        <LuLanguages aria-hidden="true" />
        <select value={l} aria-label="Language" onChange={async e => { const ok = await setLang(e.target.value); if (!ok) toast("The language could not be loaded. Check your connection and try again."); setN(n => n + 1); }}>
          {LANGS.map(x => <option key={x.code} value={x.code}>{x.name}</option>)}
        </select>
      </label>
      <button className="btn sm icon" onClick={() => { toggleTheme(); setN(n => n + 1); }} aria-label={dark ? "Day mode" : "Night mode"} title={dark ? "Day mode" : "Night mode"}>{dark ? <LuSun /> : <LuMoon />}</button>
    </div>
  );
}

function Footer() {
  const s = store.S.settings; const staffView = ["admin", "staff"].includes(me()?.role); const V = ({ v }) => (v ? v : <span className="unset">Not set yet (Admin › Settings)</span>);
  const reg = role => e => { e.preventDefault(); openModal("auth", { mode: "register", role }); };
  return (
    <footer className="bot"><div className="wrap">
      <div className="cols">
        <div><Logo size={84} className="foot-logo" /><h4>MAM &amp; MAM OVERSEAS LTD.</h4><p className="muted">Licensed recruiting agency<br />Recruiting Licence No. <b className="num ink">RL 1217</b></p>
          <div className="social">{[[s.whatsapp && waLink(s.whatsapp), FaWhatsapp, "WhatsApp"], [s.social?.facebook, FaFacebookF, "Facebook"], [s.social?.youtube, FaYoutube, "YouTube"], [s.social?.linkedin, FaLinkedinIn, "LinkedIn"], [s.social?.tiktok, FaTiktok, "TikTok"]]
            .filter(([h]) => h).map(([h, I, l]) => <a key={l} href={h} target="_blank" rel="noopener noreferrer" aria-label={l} title={l}><I /></a>)}</div></div>
        <div><h4>For job seekers</h4><ul><li><a href="#jobs">Browse jobs</a></li><li><a href="#" onClick={reg("candidate")}>Create profile &amp; upload CV</a></li><li><a href="#track">Track your file</a></li><li><a href="#blog">Guides &amp; checklists</a></li></ul></div>
        <div><h4>For employers</h4><ul><li><a href="#services">Recruitment services</a></li><li><a href="#team">Our expert team</a></li><li><a href="#" onClick={reg("employer")}>Register your company</a></li><li><a href="#contact">Send a demand</a></li></ul></div>
        <div><h4>For agents</h4><ul><li><a href="#" onClick={reg("agent")}>Register as an agent</a></li><li><a href="#" onClick={e => { e.preventDefault(); openModal("auth", { mode: "login" }); }}>Agent sign-in</a></li><li className="muted">BMET clearance &amp; job applications</li></ul></div>
        <div><h4>Contact</h4><ul>{(s.phone || staffView) && <li>Phone: <V v={s.phone} /></li>}{(s.email || staffView) && <li>Email: <V v={s.email} /></li>}{(s.address || staffView) && <li><V v={s.address} /></li>}<li className="muted">{s.hours}</li><li><a href="#contact">Send us a message →</a></li></ul></div>
      </div>
      <p className="muted small mt24">© {new Date().getFullYear()} Mam &amp; Mam Overseas Ltd. · RL 1217 · All rights reserved.</p>
    </div></footer>
  );
}

/* ---------------- modals ---------------- */
function ModalHost() {
  const m = store.ui.modal; if (!m) return null;
  const close = closeModal;
  return (
    <ModalFrame onClose={close} wide={m.type === "share" || m.type === "vcard" || m.type === "mrEntry" || m.type === "mrView" || m.type === "mrAccount" || m.type === "salaryPay" || m.type === "salaryView"} className={m.type === "memberCheck" ? "modal-verify" : ""}>
      {m.type === "confirm" && <>
        <h3>Please confirm</h3><p className="confirm-msg">{m.msg}</p>
        <div className="row"><button className="btn pri" autoFocus onClick={() => { closeModal(); m.onYes(); }}>{m.yes}</button><button className="btn" onClick={close}>Cancel</button></div>
      </>}
      {m.type === "auth" && <Auth mode={m.mode} role={m.role || "candidate"} />}
      {m.type === "cand" && <CandidateCard aid={m.aid} />}
      {m.type === "verify" && <VerifyEmail uid={m.uid} email={m.email} sent={m.sent} code={m.code} />}
      {m.type === "otp" && <LoginCode otp={m.otp} email={m.email} code={m.code} />}
      {m.type === "password" && <ChangePassword />}
      {m.type === "share" && <ShareJob jobId={m.jobId} />}
      {m.type === "vcard" && <VisitingCard teamId={m.teamId} />}
      {m.type === "memberCheck" && <VerifyBody m={findMember(m.key)} onClose={close} />}
      {m.type === "agentdocs" && user(m.uid) && <AgentDocsView u={user(m.uid)} />}
      {m.type === "clearance" && <ClearanceCard cid={m.cid} admin={m.admin} />}
      {m.type === "clPay" && <ClPayForm cid={m.cid} />}
      {m.type === "mrEntry" && <MrEntry key={m.aid || "new"} aid={m.aid} />}
      {m.type === "mrView" && <MrView rid={m.rid} fresh={m.fresh} />}
      {m.type === "mrAccount" && <MrAccount key={m.aid} aid={m.aid} />}
      {m.type === "salaryPay" && <SalaryPay key={m.uid} uid={m.uid} />}
      {m.type === "salaryView" && <SalaryView id={m.id} fresh={m.fresh} />}
    </ModalFrame>
  );
}

function Auth({ mode, role: initialRole }) {
  const [role, setRole] = useState(initialRole);
  const busy = store.ui.busy;
  const login = async e => {
    const [d] = formData(e);
    const r = await act("auth.login", { email: d.email, pass: d.pass });
    if (!r) return;
    if (r.verify) { toast(r.msg); openModal("verify", { uid: r.verify, email: r.email }); return; }
    if (r.otp) { openModal("otp", { otp: r.otp, email: r.email, code: r.code }); return; }
    afterLogin(r);
  };
  const register = async e => {
    const [d] = formData(e);
    if (d.pass !== d.pass2) return toast("Passwords do not match. Type the same password in both fields.");
    const r = await act("auth.register", { ...d, role }, { quiet: true });
    if (!r) return;
    if (role === "employer") store.ui.tab.employer = "company";
    if (role === "agent") store.ui.tab.agent = "profile";
    if (r.verify) { if (!store.ui.apply) store.ui.tab.candidate = "profile"; openModal("verify", { uid: r.verify, email: r.email, sent: r.sent, code: r.code }); return; }
    toast("Account created. The agency will approve it soon."); afterLogin(r);
  };
  const tabBtn = (m, t) => <button className={mode === m ? "on" : ""} onClick={() => openModal("auth", { mode: m, role })}>{t}</button>;
  return (
    <>
      <div className="modal-brand"><Logo size={56} /></div>
      <h3>{mode === "login" ? "Sign in" : "Create an account"}</h3>
      <div className="tabs2">{tabBtn("login", "Sign in")}{tabBtn("register", "Register")}</div>
      {mode === "login" ? (
        <form className="stack12" onSubmit={login}>
          <label className="f">Email<input type="email" name="email" required autoComplete="username" autoFocus /></label>
          <label className="f">Password<input type="password" name="pass" required autoComplete="current-password" /></label>
          <button className="btn pri" type="submit" disabled={busy}><LuLogIn /> Sign in</button>
          <p className="muted small">Forgot your password? Contact the office and we will reset it.</p>
        </form>
      ) : (
        <form className="stack12" onSubmit={register} key={role}>
          <div className="row">{[["candidate", "Job seeker"], ["employer", "Employer"], ["agent", "Agent"]].map(([v, t]) =>
            <label key={v} className="check"><input type="radio" name="role" value={v} checked={role === v} onChange={() => setRole(v)} /> {t}</label>)}</div>
          <label className="f">Full name<input type="text" name="name" required autoFocus autoComplete="name" /></label>
          {role === "employer" && <label className="f">Company name<input type="text" name="company" required /></label>}
          {role === "agent" && <div className="fgrid"><label className="f">Business / office name<input type="text" name="business" required /></label><label className="f">Mobile number<input type="tel" name="aphone" required /></label></div>}
          <label className="f">Email<input type="email" name="email" required autoComplete="email" />{role === "candidate" && <span className="hint">We send a verification code to this email</span>}</label>
          {role === "candidate" && <label className="f">Mobile number<input type="tel" name="mobile" required placeholder="01XXXXXXXXX" autoComplete="tel" /></label>}
          <div className="fgrid">
            <label className="f">Password<input type="password" name="pass" minLength={6} required autoComplete="new-password" /><span className="hint">At least 6 characters</span></label>
            <label className="f">Confirm password<input type="password" name="pass2" minLength={6} required autoComplete="new-password" /></label>
          </div>
          <button className="btn pri" type="submit" disabled={busy}><LuUserPlus /> Create Account</button>
        </form>
      )}
    </>
  );
}

/* admin / staff sign-in: the 6-digit code sent by email */
function LoginCode({ otp, email, code }) {
  const [shown, setShown] = useState(code || "");
  const submit = async e => { const [d] = formData(e); const r = await act("auth.otp", { otp, code: String(d.code).trim() }); if (r) afterLogin(r); };
  const resend = async () => { const r = await act("auth.otpResend", { otp }); if (r?.code) setShown(r.code); };
  return (
    <>
      <h3><LuShieldCheck /> Sign-in code</h3>
      <p className="mt8">For safety, admin and staff sign in with a code as well. We sent a 6-digit code to <b>{email}</b>. It is valid for 10 minutes.</p>
      {shown && <div className="notice mt12"><b>Test mode:</b> your code is <b className="num code">{shown}</b></div>}
      <form className="stack12 mt14" onSubmit={submit}>
        <label className="f">Code from the email<input type="text" name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoFocus autoComplete="one-time-code" placeholder="6 digits" /></label>
        <div className="row"><button className="btn pri" type="submit" disabled={store.ui.busy}>Sign in</button><button type="button" className="btn" onClick={resend}><LuRefreshCw /> Send a new code</button></div>
        <p className="muted small">Signing in here signs this account out on any other device.</p>
      </form>
    </>
  );
}

function VerifyEmail({ uid: id, email, sent, code }) {
  const [shown, setShown] = useState(code || "");
  const submit = async e => { const [d] = formData(e); const r = await act("auth.verify", { uid: id, code: String(d.code).trim() }); afterLogin(r); };
  const resend = async () => { const r = await act("auth.resend", { uid: id }); if (r?.code) setShown(r.code); };
  return (
    <>
      <h3><LuMailCheck /> Verify your email</h3>
      <p className="mt8">We sent a 6-digit code to <b>{email}</b>. Enter it below to activate your account. The code is valid for 30 minutes.</p>
      {sent === false && !shown && <div className="notice mt12">The email could not be sent right now. Tap “Send a new code” in a minute, or contact the office.</div>}
      {shown && <div className="notice mt12"><b>Test mode:</b> email sending is not set up on this server yet. Your code is <b className="num code">{shown}</b></div>}
      <form className="stack12 mt14" onSubmit={submit}>
        <label className="f">Verification code<input type="text" name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoFocus autoComplete="one-time-code" placeholder="6 digits" /></label>
        <div className="row"><button className="btn pri" type="submit" disabled={store.ui.busy}>Verify email</button><button type="button" className="btn" onClick={resend}><LuRefreshCw /> Send a new code</button></div>
      </form>
    </>
  );
}

function ChangePassword() {
  const submit = async e => { const [d] = formData(e); const form = e.currentTarget; const r = await act("auth.changePassword", d); if (r) { form.reset(); closeModal(); } };
  return (
    <>
      <h3><LuKeyRound /> Change password</h3>
      <form className="stack12 mt14" onSubmit={submit}>
        <label className="f">Current password<input type="password" name="old" required autoComplete="current-password" autoFocus /></label>
        <div className="fgrid">
          <label className="f">New password<input type="password" name="pass" minLength={8} required autoComplete="new-password" /><span className="hint">At least 8 characters</span></label>
          <label className="f">Confirm new password<input type="password" name="pass2" minLength={8} required autoComplete="new-password" /></label>
        </div>
        <button className="btn pri" type="submit">Change password</button>
      </form>
    </>
  );
}

function CandidateCard({ aid }) {
  const a = store.S.applications.find(x => x.id === aid); if (!a) return null;
  const c = candOf(a); const p = c.profile || {}; const j = job(a.jobId);
  const rows = [["Passport no.", p.passportNo], ["Trade", p.trade], ["Experience", `${p.experience ?? "—"} years`], ["Home district", p.district], ["Mobile", p.phone], ["Email", c.email], ["Passport", (p.passport || "") + (p.passportExpiry ? ` (expires ${fdate(p.passportExpiry)})` : "")], ["Languages", p.languages], ["Skills", p.skills], ["Preferred countries", p.countries]];
  return (
    <>
      <div className="row"><Avatar name={c.name} src={p.photo?.data} size={56} /><h3>{c.name}</h3></div>
      <p className="muted small mb14 mt8">Applied for {j?.title} on {fdate(a.appliedAt)}{c.via ? ` via agent ${c.via}` : ""} · <Pill s={a.status} /></p>
      <table><tbody>{rows.map(([k, v]) => <tr key={k}><th>{k}</th><td>{v || "—"}</td></tr>)}</tbody></table>
      {p.passportFile && <div className="row between notice mt14"><span><LuFileText /> Passport copy · {p.passportFile.name}</span><button className="btn sm" onClick={() => downloadFile(p.passportFile.data, `Passport-${(p.passportNo || c.name).replace(/[^\w-]/g, "")}.${fileExt(p.passportFile)}`)}><LuDownload /> Download</button></div>}
      <div className="notice mt14">{p.cv ? <>CV file: <b>{p.cv.name}</b> ({kb(p.cv.size)}). On the live server this opens and downloads from secure storage.</> : c.via ? "Submitted by an agent. Documents are held by the agency." : "No CV uploaded."}</div>
      <h4 className="mt16 mb6">Status history</h4>{a.history.map((h, i) => <div key={i} className="small">{fdate(h.at)} — {h.s === "custom" ? h.t : LABEL[h.s]}</div>)}
    </>
  );
}

function ClFile({ c, f, label }) {
  const p = clPerson(c); const fname = `${label.replace(/\s+/g, "-")}-${(p.passport || c.id).replace(/[^\w-]/g, "")}.${fileExt(f)}`;
  return <div className="row between filerow"><span><LuFileText /> <b>{label}</b> <span className="muted small">{f.name} · {kb(f.size)}</span></span><button className="btn sm" onClick={() => downloadFile(f.data, fname)}><LuDownload /> Download</button></div>;
}

function ClearanceCard({ cid, admin }) {
  const c = store.S.clearances.find(x => x.id === cid); if (!c) return null;
  const w = clPerson(c);
  const rows = [["Applicant", w.name], ["Filed by", w.via], ["Father's name", w.father], ["Passport no.", w.passport], ["Passport expiry", fdate(w.passportExpiry)], ["Date of birth", fdate(w.dob)], ["Mobile", w.phone], ["District", w.district], ["Trade", w.trade], ["Destination", c.country], ["Employer / sponsor", c.employer], ["Visa no.", c.visaNo], ["Visa type", c.visaType], ["Planned flight", c.flightDate ? fdate(c.flightDate) : ""], ["Notes", c.notes]];
  return (
    <>
      <h3>BMET clearance: {w.name}</h3>
      <p className="muted small mb14">{c.ref ? <><b data-notr>{c.ref}</b> · </> : null}Submitted {fdate(c.created)} by {w.via} · <Pill s={c.status} label={c.status === "custom" ? c.statusText : undefined} /></p>
      <ClPipe c={c} />
      <table className="mt14"><tbody>{rows.map(([k, v]) => <tr key={k}><th>{k}</th><td>{v || "—"}</td></tr>)}</tbody></table>
      {c.files && <><h4 className="mt16 mb6">Uploaded documents</h4>
        <div className="stack8">{[["passport", "Passport copy"], ["visa", "Visa copy"], ["contract", "Employment contract"]].filter(([k]) => c.files[k]).map(([k, l]) => <ClFile key={k} c={c} f={c.files[k]} label={l} />)}
          {(c.files.others || []).map((f, i) => <ClFile key={i} c={c} f={f} label={`Other document ${i + 1}`} />)}</div></>}
      <h4 className="mt16 mb6">Documents ({c.docs.length}/{CL_DOCS.length})</h4>
      <div className="row tight">{CL_DOCS.map(d => <span key={d} className={`chip${c.docs.includes(d) ? "" : " missing"}`}>{c.docs.includes(d) ? "✓ " : ""}{d}</span>)}</div>
      <h4 className="mt16 mb6">History</h4>{c.history.map((h, i) => <div key={i} className="small">{fdate(h.at)} — {h.s === "custom" ? h.t : LABEL[h.s]}</div>)}
      {admin ? <div className="stack mt16">
        <label className="f">Update status</label><StatusCell c={c} wide />
        {c.agentId && <><h4 className="mb6">Payment</h4><ClPayCell c={c} /></>}
        <CardAdmin c={c} />
      </div> : <div className="mt16"><CardDownload c={c} /></div>}
    </>
  );
}
