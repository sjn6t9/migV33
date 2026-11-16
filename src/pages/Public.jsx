import React from "react";
import {
  LuSearch, LuArrowLeft, LuSend, LuUserPlus, LuLogIn, LuBadgeCheck, LuFileCheck, LuStethoscope, LuStamp, LuPlane,
  LuClipboardList, LuUsers, LuHandshake, LuMessageSquare, LuGraduationCap, LuMapPin, LuPhone, LuMail, LuClock, LuIdCard,
  LuFileSearch, LuTicket, LuPlaneTakeoff, LuShieldCheck, LuScale, LuNetwork, LuHeadset, LuSearchCheck, LuQuote, LuBriefcase, LuLanguages
} from "react-icons/lu";
import { FaWhatsapp } from "react-icons/fa6";
import { LuAward, LuUsersRound, LuGlobe } from "react-icons/lu";
import {
  store, touch, me, user, job, live, money, num, bdtMin, bdtMax, fdate, filteredJobs,
  COUNTRIES, CATS, TYPES, BENEFITS, EMPTY_FILTERS, worker, company, LABEL, TEAM_DEPTS
} from "../store.js";
import { apply, openModal, go, toast, formData, act } from "../actions.js";
import { ShareButton } from "../Share.jsx";
import { JobCard, SaveButton, Pill, Empty, Val, Md, CAT_ICON, Pipe, ClPipe, Stars, Avatar } from "../ui.jsx";

export const waLink = (num, text = "") => `https://wa.me/${num}${text ? `?text=${encodeURIComponent(text)}` : ""}`;

const ui = store.ui;
const setF = patch => { ui.F = { ...ui.F, ...patch }; touch(); };

/* ---------------- Home ---------------- */
export function Home() {
  const S = store.S; const L = live();
  const countries = [...new Set(L.map(j => j.country))];
  const feat = L.filter(j => j.featured).slice(0, 6);
  const onSearch = e => { const [d] = formData(e); ui.F = { ...EMPTY_FILTERS, q: d.q, country: d.country, cat: d.cat }; go("jobs"); };
  const steps = [
    [LuUserPlus, "Application", "Create a profile, upload your CV and apply online, or through one of our agents."],
    [LuFileSearch, "CV screening", "We check experience and documents against the employer's requirements."],
    [LuUsers, "Interview & trade test", "Online or in Dhaka with the employer."],
    [LuStethoscope, "Medical (GAMCA)", "Medical test at an approved centre, booked by us."],
    [LuStamp, "Visa", "Visa, work permit and embassy documents processed."],
    [LuIdCard, "BMET clearance", "Emigration clearance and smart card issued."],
    [LuTicket, "Flight booking", "Air ticket booked on the confirmed date."],
    [LuPlaneTakeoff, "Departure", "Pre-departure briefing, and follow-up after arrival."]
  ];
  const why = [
    [LuShieldCheck, "Licensed agency", "All recruitment runs under government recruiting licence RL 1217."],
    [LuScale, "Costs in writing", "Every candidate gets the salary, contract terms and full cost in writing before signing."],
    [LuSearchCheck, "Track your file online", "Check application, BMET clearance and ticket status any time with your passport number."],
    [LuBriefcase, "Verified employers", "Job orders come from employers we have checked, marked with a verified badge."],
    [LuNetwork, "Agent network", "Registered agents submit files and see their account statement online."],
    [LuHeadset, "Support after arrival", "We stay in contact with workers and employers after deployment."]
  ];
  return (
    <>
      <section className="hero"><div className="wrap">
        <div className="license"><LuBadgeCheck /> Government-licensed recruiting agency · <b>RL 1217</b></div>
        <h1>Overseas jobs with a licensed agency handling every step</h1>
        <p className="lead">Search open job circulars, apply with one click, and follow your application from shortlist to visa and departure.</p>
        <form className="search" role="search" onSubmit={onSearch}>
          <input type="text" name="q" placeholder="Job title or trade, e.g. electrician" aria-label="Job title or trade" />
          <select name="country" aria-label="Country"><option value="">All countries</option>{Object.keys(COUNTRIES).map(c => <option key={c}>{c}</option>)}</select>
          <select name="cat" aria-label="Category"><option value="">All categories</option>{CATS.map(c => <option key={c}>{c}</option>)}</select>
          <button className="btn pri" type="submit"><LuSearch /> Search jobs</button>
        </form>
      </div></section>
      <div className="wrap"><div className="stats">
        {[[L.length, "Open job circulars"], [L.reduce((s, j) => s + Number(j.vacancies), 0), "Total vacancies"], [countries.length, "Destination countries"],
          [S.stats?.employers || 0, "Active employers"], [S.stats?.hired || 0, "Candidates hired"]]
          .map(([v, l]) => <div className="stat" key={l}><b>{num(v)}</b><span>{l}</span></div>)}
      </div></div>
      <section className="sec"><div className="wrap">
        <div className="sec-head"><div><div className="eyebrow">Featured circulars</div><h2>Jobs open now</h2></div><a className="btn" href="#jobs">See all {L.length} jobs</a></div>
        <div className="grid g3">{feat.length ? feat.map(j => <JobCard key={j.id} j={j} />) : <Empty>No featured jobs yet.</Empty>}</div>
      </div></section>
      <section className="sec pt0"><div className="wrap grid g2 top">
        <div><div className="eyebrow">By trade</div><h2 className="mb16">Browse by category</h2>
          <div className="grid tilegrid">{CATS.map(c => { const Icon = CAT_ICON[c]; return (
            <a key={c} className="card cat" href="#jobs" onClick={e => { e.preventDefault(); ui.F = { ...EMPTY_FILTERS, cat: c }; go("jobs"); }}>
              <span className="cat-l"><Icon /> {c}</span><b>{L.filter(j => j.category === c).length}</b></a>); })}</div></div>
        <div><div className="eyebrow">By destination</div><h2 className="mb16">Where we send workers</h2>
          <div className="grid tilegrid">{Object.keys(COUNTRIES).map(c => (
            <a key={c} className="card cat" href="#jobs" onClick={e => { e.preventDefault(); ui.F = { ...EMPTY_FILTERS, country: c }; go("jobs"); }}>
              <span>{c} <span className="muted small">{COUNTRIES[c]}</span></span><b>{L.filter(j => j.country === c).length}</b></a>))}</div></div>
      </div></section>
      <section className="sec pt0"><div className="wrap">
        <div className="eyebrow">Our process</div><h2 className="mb16">From application to departure</h2>
        <ol className="steps steps8">{steps.map(([Icon, h, p]) => <li key={h}><Icon className="step-ic" /><h4>{h}</h4><p className="muted small">{p}</p></li>)}</ol>
        <div className="row mt16"><a className="btn" href="#track"><LuSearchCheck /> Track your file</a></div>
      </div></section>
      <section className="sec pt0"><div className="wrap">
        <div className="eyebrow">Why MAM &amp; MAM</div><h2 className="mb16">Why work with us</h2>
        <div className="grid g3">{why.map(([Icon, h, p]) => <div className="card svc" key={h}><Icon className="svc-ic" /><div><h4>{h}</h4><p className="muted small mt4">{p}</p></div></div>)}</div>
      </div></section>
      {S.testimonials.length > 0 && <section className="sec pt0"><div className="wrap">
        <div className="eyebrow">Testimonials</div><h2 className="mb16">What our workers say</h2>
        <div className="grid g3">{S.testimonials.slice(0, 6).map(x => <figure className="card quote" key={x.id}><LuQuote className="q-ic" /><blockquote>{x.text}</blockquote><figcaption className="row"><Avatar name={x.name} size={40} /><div><b>{x.name}</b><div className="muted small">{x.role}{x.country ? ` · ${x.country}` : ""}</div><Stars n={x.rating} /></div></figcaption></figure>)}</div>
      </div></section>}
      {S.gallery.length > 0 && <section className="sec pt0"><div className="wrap">
        <div className="eyebrow">Gallery</div><h2 className="mb16">From our office and departures</h2>
        <div className="grid g4">{S.gallery.slice(0, 8).map(g => <figure className="gal" key={g.id}><img src={g.src} alt={g.caption} loading="lazy" /><figcaption className="small">{g.caption}</figcaption></figure>)}</div>
      </div></section>}
      {S.team.length > 0 && <section className="sec pt0"><div className="wrap">
        <div className="sec-head"><div><div className="eyebrow">Expert team</div><h2>People who handle your file</h2></div><a className="btn" href="#team">Meet the full team</a></div>
        <div className="grid teamgrid compact">{S.team.slice(0, 4).map(m => <TeamCard key={m.id} m={m} compact />)}</div>
      </div></section>}
      <section className="sec pt0"><div className="wrap"><div className="card row between cta soft">
        <div className="cta-text"><div className="eyebrow">For employers</div><h2>Need workers from Bangladesh?</h2><p className="muted mt8">Post a job order, review CVs and shortlist candidates from your own panel. We handle screening, medical, visa and deployment.</p></div>
        <div className="row"><button className="btn pri" onClick={() => openModal("auth", { mode: "register", role: "employer" })}>Register your company</button><a className="btn" href="#services">Our services</a></div>
      </div></div></section>
      <section className="sec pt0"><div className="wrap"><div className="card row between cta">
        <div className="cta-text"><div className="eyebrow">For agents</div><h2>Agent panel</h2><p className="muted mt8">Agents can submit BMET clearance files, apply their workers to open jobs and see their account statement with us online.</p></div>
        <div className="row"><button className="btn pri" onClick={() => openModal("auth", { mode: "register", role: "agent" })}>Register as an agent</button><button className="btn" onClick={() => openModal("auth", { mode: "login" })}><LuLogIn /> Agent sign-in</button></div>
      </div></div></section>
      {S.posts.length > 0 && <section className="sec pt0"><div className="wrap">
        <div className="sec-head"><div><div className="eyebrow">Resources</div><h2>Guides for workers and employers</h2></div><a className="btn" href="#blog">All articles</a></div>
        <div className="grid g3">{[...S.posts].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3).map(p => <article className="card stack8" key={p.id}><span className="muted small">{fdate(p.date)}</span><h3><a className="plainlink" href={`#post-${p.id}`}>{p.title}</a></h3><p className="muted small">{p.excerpt}</p></article>)}</div>
      </div></section>}
    </>
  );
}

/* ---------------- Job board ---------------- */
export function Jobs() {
  const F = ui.F; const L = filteredJobs(F);
  const toggleBenefit = b => setF({ benefits: F.benefits.includes(b) ? F.benefits.filter(x => x !== b) : [...F.benefits, b] });
  return (
    <section className="sec"><div className="wrap">
      <div className="sec-head"><div><div className="eyebrow">Job board</div><h1 className="h1s">Overseas job circulars</h1></div></div>
      <div className="board">
        <form className="card filters" onSubmit={e => e.preventDefault()}>
          <label className="f">Keyword<input type="text" value={F.q} onChange={e => setF({ q: e.target.value })} placeholder="Title, trade or city" /></label>
          <label className="f">Country / location<select value={F.country} onChange={e => setF({ country: e.target.value })}><option value="">All countries</option>{Object.keys(COUNTRIES).map(c => <option key={c}>{c}</option>)}</select></label>
          <label className="f">Industry<select value={F.cat} onChange={e => setF({ cat: e.target.value })}><option value="">All industries</option>{CATS.map(c => <option key={c}>{c}</option>)}</select></label>
          <label className="f">Job type<select value={F.type} onChange={e => setF({ type: e.target.value })}><option value="">Any type</option>{TYPES.map(c => <option key={c}>{c}</option>)}</select></label>
          <label className="f">My experience<select value={F.exp} onChange={e => setF({ exp: e.target.value })}><option value="">Any</option>{[0, 1, 2, 3, 5].map(v => <option key={v} value={String(v)}>{v === 0 ? "No experience" : `${v} year${v > 1 ? "s" : ""}`}</option>)}</select><span className="hint">Shows jobs you qualify for</span></label>
          <label className="f">Minimum salary (BDT / month)<input type="number" min="0" step="5000" value={F.minBdt} onChange={e => setF({ minBdt: e.target.value })} placeholder="e.g. 50000" /><span className="hint">Converted at approximate rates set by the agency</span></label>
          <fieldset className="plain"><legend className="small b">Benefits</legend>
            {BENEFITS.map(b => <label key={b} className="check"><input type="checkbox" checked={F.benefits.includes(b)} onChange={() => toggleBenefit(b)} /> {b}</label>)}
          </fieldset>
          <button type="button" className="btn" onClick={() => setF({ ...EMPTY_FILTERS })}>Clear filters</button>
        </form>
        <div>
          <div className="row between mb14"><span className="muted">{L.length} job{L.length === 1 ? "" : "s"} found</span>
            <label className="row small tight">Sort <select className="auto" value={F.sort} onChange={e => setF({ sort: e.target.value })}><option value="new">Newest</option><option value="sal">Highest salary</option><option value="dead">Deadline soonest</option></select></label></div>
          <div className="grid g2">{L.length ? L.map(j => <JobCard key={j.id} j={j} />) : <Empty style={{ gridColumn: "1/-1" }}>No jobs match these filters. Try removing one.</Empty>}</div>
        </div>
      </div>
    </div></section>
  );
}

export function JobDetail({ id }) {
  const S = store.S; const j = job(id); const u = me();
  if (!j || (j.status !== "active" && !(u && (u.role === "admin" || u.id === j.employerId))))
    return <section className="sec"><div className="wrap"><Empty>This job is no longer available. <a href="#jobs">Browse open jobs</a></Empty></div></section>;
  const c = user(j.employerId)?.company || {};
  const applied = u?.role === "candidate" && S.applications.find(a => a.jobId === j.id && a.candidateId === u.id);
  const facts = [["Location", `${j.city}, ${j.country}`], ["Industry", j.category], ["Job type", j.type], ["Contract", `${j.contract} year(s)`], ["Experience", j.experience ? `${j.experience}+ years` : "Not required"], ["Age", j.age], ["Vacancies", j.vacancies], ["Deadline", fdate(j.deadline)]];
  let cta;
  if (applied) cta = <><div className="notice ok">You applied on {fdate(applied.appliedAt)}. Status: <Pill s={applied.status} /></div><button className="btn" onClick={() => { ui.tab.candidate = "applications"; go("dashboard"); }}>Track application</button></>;
  else if (u?.role === "agent") cta = <button className="btn pri" onClick={() => { ui.agentJob = j.id; ui.tab.agent = "jobs"; go("dashboard"); }}><LuUsers /> Apply with my workers</button>;
  else if (u && u.role !== "candidate") cta = <p className="muted small">Sign in with a candidate account to apply.</p>;
  else cta = <button className="btn pri" onClick={() => apply(j.id)}><LuSend /> Apply now</button>;
  return (
    <section className="sec"><div className="wrap">
      <a href="#jobs" className="small backlink"><LuArrowLeft /> All jobs</a>
      <div className="grid split mt14">
        <div className="card">
          {j.status !== "active" && <div className="notice mb14">Status: <Pill s={j.status} /> — not visible to the public.</div>}
          {j.featured && <div className="badge-feat">Featured</div>}
          <h1 className="h1s">{j.title}</h1>
          <p className="muted mt8">{c.name} {c.verify === "verified" && <Pill s="verified" />}</p>
          <div className="sal num big mt14">{money(j.salaryMin, j.currency)} – {num(j.salaryMax)} <span className="muted small sal-sub">per month · ≈ BDT {num(bdtMin(j))} – {num(bdtMax(j))}</span></div>
          <h3 className="sub">Job description</h3><p>{j.description}</p>
          <h3 className="sub">Requirements</h3><p>{j.requirements}</p>
          <h3 className="sub">Benefits</h3><div className="row tight">{j.benefits.length ? j.benefits.map(b => <span key={b} className="chip">{b}</span>) : "—"}</div>
        </div>
        <aside className="card stack">
          <table><tbody>{facts.map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}</tbody></table>
          {cta}
          <SaveButton j={j} full />
          {j.status === "active" && <ShareButton j={j} label="Share this job" />}
          <p className="muted small">Never pay anyone outside our office. Processed by MAM &amp; MAM Overseas Ltd., RL 1217.</p>
        </aside>
      </div>
    </div></section>
  );
}

/* ---------------- Services / About ---------------- */
export function Services() {
  const w = [[LuMessageSquare, "Job counselling", "We explain the job, salary, country rules and total costs before you commit."], [LuFileCheck, "Document check", "Passport, certificates and experience letters checked before submission."], [LuStethoscope, "Medical coordination", "Booking and follow-up with approved medical centres."], [LuStamp, "Visa processing", "Visa application, contract and employer paperwork handled by our team."], [LuIdCard, "BMET clearance & smart card", "Registration, fingerprint and emigration clearance before departure."], [LuGraduationCap, "Pre-departure training", "What to expect on arrival: work rules, rights, money transfer and contacts."], [LuStethoscope, "GAMCA medical", "Medical appointment and report follow-up for Gulf countries."], [LuFileCheck, "Embassy documents & work permit", "Attestation, embassy papers and work permit applications."], [LuTicket, "Air ticketing", "Flight booked on the confirmed date, for direct candidates and agent workers."], [LuSearchCheck, "Online file tracking", "Track application, clearance and ticket status with your passport number."]];
  const a = [[LuNetwork, "Agent registration", "Register your office and get an online agent panel."], [LuStamp, "BMET clearance filing", "Submit worker files online and follow every stage."], [LuBriefcase, "Job applications for workers", "Apply your workers to open job orders in a few clicks."], [LuTicket, "Ticket requests", "Request flights for workers whose visa is ready."], [LuScale, "Online account statement", "Charges, payments and balance with the agency, always up to date."], [LuHeadset, "Dedicated support", "Our processing team answers your file questions."]];
  const e = [[LuUsers, "Candidate sourcing", "Large pool of screened workers across construction, hospitality, driving, manufacturing and more."], [LuClipboardList, "Trade testing", "Skill tests arranged for technical trades before your interview."], [LuHandshake, "Interview arrangement", "Online or in-person interviews in Dhaka with shortlisted candidates."], [LuPlane, "Deployment", "Visa, clearance and travel completed on your timeline."], [LuPhone, "Post-arrival follow-up", "We stay in contact with workers and your HR team after arrival."], [LuSearch, "Online employer panel", "Post jobs, review CVs and update candidate status yourself."]];
  const Block = ({ t, list }) => (
    <div><h2 className="mb16">{t}</h2><div className="grid g2">{list.map(([Icon, h, p]) => <div className="card svc" key={h}><Icon className="svc-ic" /><div><h4>{h}</h4><p className="muted small mt4">{p}</p></div></div>)}</div></div>
  );
  return (
    <section className="sec"><div className="wrap stack36">
      <div><div className="eyebrow">Services</div><h1 className="h1s">Recruitment from start to departure</h1><p className="muted mt8 measure">We work with job seekers, agents and overseas employers under recruiting licence RL 1217.</p></div>
      <Block t="For job seekers" list={w} /><Block t="For employers" list={e} /><Block t="For agents" list={a} />
      <div className="row"><a className="btn pri" href="#jobs">Find a job</a><a className="btn" href="#contact">Send an employer demand</a></div>
    </div></section>
  );
}

export function About() {
  const s = store.S.settings;
  return (
    <section className="sec"><div className="wrap grid split">
      <div className="article"><div className="eyebrow">About us</div><h1 className="h1s mb16">MAM &amp; MAM Overseas Ltd.</h1>
        <p>MAM &amp; MAM Overseas Ltd. is a licensed recruiting agency (RL 1217) that connects job seekers in Bangladesh with employers abroad.</p>
        <p>We handle the full recruitment process: sourcing and screening candidates, arranging interviews, and completing medical, visa and emigration formalities so workers depart with the right documents and a clear contract.</p>
        <h3>What we stand for</h3>
        <ul><li><b>Transparency.</b> Every candidate hears the salary, benefits, contract terms and costs before signing.</li><li><b>Legal processing.</b> All recruitment goes through official channels under our licence.</li><li><b>Follow-up.</b> We stay in touch with workers and employers after deployment.</li></ul>
      </div>
      <aside className="card stack">
        <div className="license brandc"><LuBadgeCheck /> Recruiting Licence · <b>RL 1217</b></div>
        <OfficeTable s={s} />
        <a className="btn pri" href="#contact">Contact us</a>
        <a className="btn" href="#team"><LuUsersRound /> Meet our expert team</a>
      </aside>
    </div></section>
  );
}
function OfficeTable({ s }) {
  return <table><tbody>
    <tr><th><LuMapPin /> Office</th><td><Val v={s.address} /></td></tr>
    <tr><th><LuPhone /> Phone</th><td><Val v={s.phone} /></td></tr>
    <tr><th><LuMail /> Email</th><td><Val v={s.email} /></td></tr>
    <tr><th><LuClock /> Hours</th><td>{s.hours}</td></tr>
    <tr><th><LuBadgeCheck /> Licence</th><td>RL 1217</td></tr>
  </tbody></table>;
}

/* ---------------- Blog ---------------- */
export function Blog() {
  const P = [...store.S.posts].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <section className="sec"><div className="wrap"><div className="eyebrow">Blog</div><h1 className="h1s mb20">Guides and news</h1>
      <div className="grid g3">{P.length ? P.map(p => (
        <article className="card stack8" key={p.id}><span className="muted small">{fdate(p.date)}</span><h3><a className="plainlink" href={`#post-${p.id}`}>{p.title}</a></h3><p className="muted small">{p.excerpt}</p><a href={`#post-${p.id}`} className="small mtauto">Read article →</a></article>
      )) : <Empty>No posts yet.</Empty>}</div>
    </div></section>
  );
}
export function Post({ id }) {
  const p = store.S.posts.find(x => x.id === id);
  if (!p) return <section className="sec"><div className="wrap"><Empty>Post not found. <a href="#blog">Back to blog</a></Empty></div></section>;
  return <section className="sec"><div className="wrap"><a href="#blog" className="small backlink"><LuArrowLeft /> Blog</a><article className="article mt14"><span className="muted small">{fdate(p.date)}</span><h1 className="h1s post-h">{p.title}</h1><Md body={p.body} /></article></div></section>;
}

/* ---------------- Contact ---------------- */
export function Contact() {
  const s = store.S.settings;
  const submit = e => {
    const [d] = formData(e);
    const form = e.currentTarget;
    act("contact.send", d).then(r => { if (r) form.reset(); });
  };
  return (
    <section className="sec"><div className="wrap grid split">
      <form className="card stack" onSubmit={submit}>
        <div><div className="eyebrow">Contact</div><h1 className="h1s">Send us a message</h1><p className="muted mt8">Job seekers, agents and employers: we reply within one working day.</p></div>
        <div className="fgrid"><label className="f">Your name<input type="text" name="name" required /></label><label className="f">Phone<input type="tel" name="phone" required /></label></div>
        <label className="f">Email<input type="email" name="email" /></label>
        <div className="fgrid"><label className="f">I am a<select name="type"><option>Job seeker</option><option>Agent</option><option>Employer / company</option><option>Other</option></select></label>
          <label className="f">Interested country<select name="country"><option value="">Any / not sure</option>{Object.keys(COUNTRIES).map(c => <option key={c}>{c}</option>)}</select></label></div>
        <label className="f">Message<textarea name="message" required /></label>
        <button className="btn pri" type="submit"><LuSend /> Send message</button>
      </form>
      <aside className="card stack"><h3>Office</h3><OfficeTable s={s} />
        {s.whatsapp ? <a className="btn wa" href={waLink(s.whatsapp, "Hello MAM & MAM Overseas, I have a question.")} target="_blank" rel="noopener noreferrer"><FaWhatsapp /> Chat on WhatsApp</a> : <p className="muted small">WhatsApp chat appears here once the number is added in Admin › Site settings.</p>}
      </aside>
    </div></section>
  );
}

/* ---------------- Track status (public) ---------------- */
export function Track() {
  const [res, setRes] = React.useState(null);
  const submit = async e => { const [d] = formData(e); const r = await act("track.lookup", { passport: d.passport, phone: d.phone }, { quiet: true }); if (r) setRes(r.result); };
  return (
    <section className="sec"><div className="wrap stack">
      <div><div className="eyebrow">Track status</div><h1 className="h1s">Track your file</h1><p className="muted mt8 measure">Enter your passport number and the mobile number given to us or your agent. You will see your job application, BMET clearance and air ticket status.</p></div>
      <form className="card search track" onSubmit={submit}>
        <input type="text" name="passport" placeholder="Passport number, e.g. A00000001" aria-label="Passport number" required />
        <input type="tel" name="phone" placeholder="Mobile number" aria-label="Mobile number" required />
        <button className="btn pri" type="submit"><LuSearchCheck /> Check status</button>
      </form>
      {res === false && <div className="notice">No file matches this passport and mobile number. Check both numbers, or contact the office.</div>}
      {res && <div className="stack">
        <div className="card row between"><div><h3>{res.name}</h3><div className="muted small">Passport {res.passport}</div></div></div>
        {res.clearances.map(c => <div className="card" key={c.id}><div className="row between"><h4><LuIdCard /> BMET clearance · {c.country}</h4><Pill s={c.status} /></div><ClPipe c={c} /><p className="muted small mt6">Submitted {fdate(c.created)} · last update {fdate(c.history[c.history.length - 1].at)}</p>{c.card && <div className="notice ok mt8">Clearance card is ready. Sign in to your portal (or ask your agent) to download it.</div>}</div>)}
        {res.apps.map(a => { const j = a.job; return <div className="card" key={a.id}><div className="row between"><h4><LuBriefcase /> {j?.title || "Job"}{j ? ` · ${j.city}, ${j.country}` : ""}</h4><Pill s={a.status} /></div><Pipe a={a} /><p className="muted small mt6">Applied {fdate(a.appliedAt)}</p></div>; })}
        {res.tickets.map(x => <div className="card" key={x.id}><div className="row between"><h4><LuTicket /> Air ticket · {x.from} → {x.to}</h4><Pill s={x.status} /></div><p className="small mt6">{x.status === "booked" ? `${x.airline} · PNR ${x.pnr} · Flight ${fdate(x.flightDate)}` : `Preferred date ${fdate(x.prefDate)}`}</p></div>)}
        {!res.clearances.length && !res.apps.length && !res.tickets.length && <Empty>No applications on this file yet.</Empty>}
      </div>}
    </div></section>
  );
}

/* ---------------- first admin account (one-time link from the installer) ---------------- */
export function Setup({ token }) {
  const S = store.S;
  const submit = async e => { const [d] = formData(e); const r = await act("setup.admin", { ...d, token: d.token || token }); if (r) go("dashboard"); };
  if (store.loaded && !S.needsSetup) return <section className="sec"><div className="wrap"><Empty>The admin account is already set up. <a href="#home">Go to the website</a> and sign in.</Empty></div></section>;
  return (
    <section className="sec"><div className="wrap" style={{ maxWidth: 560 }}>
      <form className="card stack12" onSubmit={submit}>
        <div><div className="eyebrow">First-time setup</div><h1 className="h1s">Create the admin account</h1>
          <p className="muted mt8">This account manages the whole website. Use an email you check, and a strong password you keep private.</p></div>
        <label className="f">Your name<input type="text" name="name" required autoComplete="name" /></label>
        <label className="f">Admin email (login)<input type="email" name="email" required autoComplete="email" /></label>
        <div className="fgrid">
          <label className="f">Password<input type="password" name="pass" minLength={8} required autoComplete="new-password" /><span className="hint">At least 8 characters</span></label>
          <label className="f">Confirm password<input type="password" name="pass2" minLength={8} required autoComplete="new-password" /></label>
        </div>
        {!token && <label className="f">Setup code<input type="text" name="token" required /><span className="hint">Printed by the installer on the server</span></label>}
        <button className="btn pri" type="submit" disabled={store.ui.busy}>Create admin account</button>
      </form>
    </div></section>
  );
}

/* ---------------- Expert Team ---------------- */
export function TeamCard({ m, compact }) {
  return (
    <article className={`card teamcard${compact ? " compact" : ""}`}>
      <div className="tc-photo">{m.photo ? <img src={m.photo.data} alt={m.name} loading="lazy" /> : <Avatar name={m.name} size={compact ? 84 : 112} />}</div>
      <div className="tc-body">
        <span className="tc-dept">{m.dept}</span>
        <h3>{m.name}</h3>
        <div className="tc-title">{m.title}</div>
        {!compact && m.years !== "" && m.years != null && <div className="tc-years"><LuAward /> {m.years}+ years in overseas recruitment</div>}
        {!compact && m.bio && <p className="muted small">{m.bio}</p>}
        {!compact && m.expertise?.length > 0 && <div className="row tight">{m.expertise.map(x => <span key={x} className="chip">{x}</span>)}</div>}
        {!compact && (m.phone || m.whatsapp || m.email || m.website) && <div className="tc-contact">
          {m.phone && <span className="small"><LuPhone /> {m.phone}</span>}
          {m.email && <a className="small" href={`mailto:${m.email}`}><LuMail /> {m.email}</a>}
          {m.website && <a className="small" href={m.website} target="_blank" rel="noopener noreferrer"><LuGlobe /> {m.website.replace(/^https?:\/\//, "")}</a>}
          {m.whatsapp && <a className="btn sm wa" href={waLink(m.whatsapp, "Assalamu Alaikum, I contacted you from the MAM & MAM Overseas website.")} target="_blank" rel="noopener noreferrer"><FaWhatsapp /> WhatsApp</a>}
        </div>}
      </div>
    </article>
  );
}

export function Team() {
  const S = store.S; const [dept, setDept] = React.useState("");
  const depts = TEAM_DEPTS.filter(d => S.team.some(m => m.dept === d));
  const L = S.team.filter(m => !dept || m.dept === dept);
  const isStaff = ["admin", "staff"].includes(me()?.role);
  return (
    <>
      <section className="pagehead"><div className="wrap">
        <div className="eyebrow light">Expert team</div>
        <h1>The people behind every file</h1>
        <p className="lead">Recruitment officers, visa and BMET processing staff, accounts and agent support: the MAM &amp; MAM Overseas Ltd. team working under licence RL 1217.</p>
        {S.team.length > 0 && <div className="pagehead-stats"><span><b>{S.team.length}</b> team members</span><span><b>{depts.length}</b> departments</span>
          {S.team.some(m => Number(m.years) > 0) && <span><b>{S.team.reduce((s, m) => s + (Number(m.years) || 0), 0)}+</b> combined years of experience</span>}</div>}
      </div></section>
      <section className="sec"><div className="wrap stack">
        {depts.length > 1 && <div className="row">{[["", "All"], ...depts.map(d => [d, d])].map(([k, l]) => <button key={l} className={`btn sm${dept === k ? " pri" : ""}`} onClick={() => setDept(k)}>{l}</button>)}</div>}
        {L.length ? <div className="grid teamgrid">{L.map(m => <TeamCard key={m.id} m={m} />)}</div>
          : <Empty>Team profiles are being added. {isStaff ? <>Add them in <a href="#dashboard">Admin › Website content</a>.</> : <>Meanwhile, <a href="#contact">contact the office</a>.</>}</Empty>}
        <div className="card row between cta soft">
          <div className="cta-text"><h2>Talk to our team</h2><p className="muted mt8">Visit the office or send a message. We reply within one working day.</p></div>
          <div className="row"><a className="btn pri" href="#contact">Contact us</a><a className="btn" href="#jobs">See open jobs</a></div>
        </div>
      </div></section>
    </>
  );
}
