import React from "react";
import { SCENES } from "../scenery.js";
import { VerifyBox } from "../VCard.jsx";
import {
  LuSearch, LuArrowLeft, LuSend, LuUserPlus, LuLogIn, LuBadgeCheck, LuFileCheck, LuStethoscope, LuStamp, LuPlane,
  LuClipboardList, LuUsers, LuHandshake, LuMessageSquare, LuGraduationCap, LuMapPin, LuPhone, LuMail, LuClock, LuIdCard,
  LuFileSearch, LuTicket, LuPlaneTakeoff, LuShieldCheck, LuScale, LuNetwork, LuHeadset, LuSearchCheck, LuQuote, LuBriefcase, LuLanguages
} from "react-icons/lu";
import { FaWhatsapp } from "react-icons/fa6";
import { LuPlaneLanding, LuArrowLeftRight, LuCalendarDays, LuArmchair } from "react-icons/lu";
import { LuAward, LuUsersRound, LuGlobe, LuChevronLeft, LuChevronRight, LuFileText, LuEye, LuDownload, LuX, LuReceipt, LuWallet } from "react-icons/lu";
import {
  store, touch, me, user, job, live, money, num, bdtMin, bdtMax, isHourly, HOURS_PER_MONTH, fdate, filteredJobs,
  COUNTRIES, CATS, TYPES, BENEFITS, EMPTY_FILTERS, worker, company, LABEL, TEAM_DEPTS
, memberCode } from "../store.js";
import { apply, openModal, go, toast, formData, act, flightTab } from "../actions.js";
import { ShareButton } from "../Share.jsx";
import { JobCard, SaveButton, Pill, Empty, Val, Md, CAT_ICON, Pipe, ClPipe, Stars, Avatar , Logo } from "../ui.jsx";

export const waLink = (num, text = "") => `https://wa.me/${num}${text ? `?text=${encodeURIComponent(text)}` : ""}`;

const ui = store.ui;
const setF = patch => { ui.F = { ...ui.F, ...patch }; touch(); };

/* ---------------- Home ---------------- */
// airports workers fly to most; any other airport can be typed as "City (CODE)"
const AIRPORTS = [["Dhaka", "DAC"], ["Chattogram", "CGP"], ["Sylhet", "ZYL"], ["Riyadh", "RUH"], ["Jeddah", "JED"], ["Dammam", "DMM"], ["Madinah", "MED"], ["Dubai", "DXB"], ["Abu Dhabi", "AUH"], ["Sharjah", "SHJ"],
  ["Doha", "DOH"], ["Kuwait", "KWI"], ["Muscat", "MCT"], ["Bahrain", "BAH"], ["Kuala Lumpur", "KUL"], ["Singapore", "SIN"], ["Male", "MLE"], ["Nadi", "NAN"], ["Bucharest", "OTP"], ["Belgrade", "BEG"], ["Tokyo", "NRT"], ["Seoul", "ICN"]].map(([c, k]) => `${c} (${k})`);
const isoDay = (n = 0) => { const d = new Date(Date.now() + n * 864e5); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
/* the home page's flight search: the search itself runs in the Air tickets section, after sign-in */
function HeroFlight() {
  const [q, setQ] = React.useState({ round: false, from: "Dhaka (DAC)", to: "", date: "", returnDate: "", adults: 1, cabin: "economy" });
  const set = p => setQ(x => ({ ...x, ...p }));
  const submit = e => {
    e.preventDefault();
    if (!/\([A-Z]{3}\)\s*$/.test(q.from.trim()) && !/^[A-Za-z]{3}$/.test(q.from.trim())) return toast("Choose where you fly from, e.g. Dhaka (DAC).");
    if (!/\([A-Z]{3}\)\s*$/.test(q.to.trim()) && !/^[A-Za-z]{3}$/.test(q.to.trim())) return toast("Choose where to fly, e.g. Riyadh (RUH).");
    if (!q.date) return toast("Choose the travel date.");
    if (q.round && !q.returnDate) return toast("Choose the return date.");
    const fix = v => /^[A-Za-z]{3}$/.test(v.trim()) ? `(${v.trim().toUpperCase()})` : v.trim();
    ui.flQ = { ...q, from: fix(q.from), to: fix(q.to), returnDate: q.round ? q.returnDate : "", children: 0, infants: 0 };
    if (me()) { if (flightTab()) go("dashboard"); else toast("Flight search is for job seekers and agents."); }
    else { toast("Sign in to see live fares — your search opens right after."); openModal("auth", { mode: "login" }); }
  };
  return <form className="hf" role="search" aria-label="Search flights" onSubmit={submit} noValidate>
    <div className="hf-top">
      <span className="hf-tag"><LuPlane /> Air tickets</span>
      <div className="hf-trip" role="radiogroup" aria-label="Trip type">{[[false, "One way"], [true, "Round trip"]].map(([v, l]) =>
        <button key={l} type="button" role="radio" aria-checked={q.round === v} className={q.round === v ? "on" : ""} onClick={() => set({ round: v })}>{l}</button>)}</div>
    </div>
    <datalist id="hf-airports">{AIRPORTS.map(a => <option key={a} value={a} />)}</datalist>
    <div className={`hf-row${q.round ? " rt" : ""}`}>
      <label className="hf-f hf-from"><span><LuPlaneTakeoff /> From</span><input type="text" list="hf-airports" value={q.from} onChange={e => set({ from: e.target.value })} placeholder="City or airport" autoComplete="off" /></label>
      <button type="button" className="hf-swap" aria-label="Swap From and To" onClick={() => set({ from: q.to, to: q.from })}><LuArrowLeftRight /></button>
      <label className="hf-f hf-to"><span><LuPlaneLanding /> To</span><input type="text" list="hf-airports" value={q.to} onChange={e => set({ to: e.target.value })} placeholder="City or airport" autoComplete="off" /></label>
      <label className="hf-f hf-date"><span><LuCalendarDays /> Travel date</span><input type="date" min={isoDay()} value={q.date} onChange={e => set({ date: e.target.value })} /></label>
      {q.round && <label className="hf-f"><span><LuCalendarDays /> Return</span><input type="date" min={q.date || isoDay()} value={q.returnDate} onChange={e => set({ returnDate: e.target.value })} /></label>}
      <label className="hf-f"><span><LuUsers /> Adults</span><select value={q.adults} onChange={e => set({ adults: +e.target.value })}>{[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
      <label className="hf-f"><span><LuArmchair /> Class</span><select value={q.cabin} onChange={e => set({ cabin: e.target.value })}><option value="economy">Economy</option><option value="premium">Premium economy</option><option value="business">Business</option><option value="first">First</option></select></label>
      <button className="btn pri hf-go" type="submit"><LuSearch /> Search flights</button>
    </div>
  </form>;
}

export function Home() {
  const slides = store.loaded ? (store.S.scenery || []).filter(x => !x.hidden)
    : SCENES.map(x => ({ id: x.name, alt: x.alt, pos: x.pos, src: `/scenery/${x.name}-1280.webp`, srcSet: `/scenery/${x.name}-768.webp 768w, /scenery/${x.name}-1280.webp 1280w, /scenery/${x.name}-1920.webp 1920w` }));
  const S = store.S; const L = live();
  const countries = [...new Set(L.map(j => j.country))];
  const feat = L.filter(j => j.featured).slice(0, 6);
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
      <section className={`hero${slides.length ? " has-slides" : ""}`}>{slides.length > 0 && <HeroSlides list={slides} sec={store.S.settings.slideSec} />}<div className="wrap">
        <div className="license"><LuBadgeCheck /> Government-licensed recruiting agency · <b>RL 1217</b></div>
        <h1>Overseas jobs with a licensed agency handling every step</h1>
        <p className="lead">Find an overseas job, book your air ticket at live fares, and follow every step from application to visa and departure.</p>
        <HeroFlight />
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
        <TeamCarousel list={S.team} compact />
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
          <p className="muted mt8">{c.name || j.employerName} {c.verify === "verified" && <Pill s="verified" />}</p>
          <div className="sal num big mt14">{money(j.salaryMin, j.currency)} – {num(j.salaryMax)} <span className="muted small sal-sub">{isHourly(j) ? "per hour · ≈ BDT" : "per month · ≈ BDT"} {num(bdtMin(j))} – {num(bdtMax(j))}</span>
            {isHourly(j) && <div className="sal-month small">≈ BDT {num(bdtMin(j) * HOURS_PER_MONTH)} – {num(bdtMax(j) * HOURS_PER_MONTH)} <span className="muted">per month (8 hours a day, one day off a week)</span></div>}</div>
          <h3 className="sub">Job description</h3><p className="lines">{j.description}</p>
          <h3 className="sub">Requirements</h3><p className="lines">{j.requirements}</p>
          <h3 className="sub">Benefits</h3><div className="row tight">{j.benefits.length ? j.benefits.map(b => <span key={b} className="chip">{b}</span>) : "—"}</div>
        </div>
        <aside className="card stack">
          <table><tbody>{facts.map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}</tbody></table>
          {cta}
          <SaveButton j={j} full />
          {j.status === "active" && <ShareButton j={j} label="Share this job" />}
          <p className="muted small">Never pay anyone outside our office. Processed by Mam &amp; Mam Overseas Ltd., RL 1217.</p>
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
  const [view, setView] = React.useState(null); // document opened in the viewer
  const s = store.S.settings; const a = store.S.about; if (!a) return null;
  const countries = Object.keys(COUNTRIES);
  const stats = a.stats.map((x, i) => (i === 3 && !x.value ? { ...x, value: String(countries.length), sub: x.sub || countries.join(" · ") } : x)).filter(x => x.value);
  const highlights = a.highlights.map(x => (!x.value && /countr/i.test(x.label) ? { ...x, value: String(countries.length) } : x)).filter(x => x.value);
  const paras = a.overview.split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
  const isPdf = d => /pdf/.test(d.file?.mime || "") || /\.pdf$/i.test(d.file?.name || "");
  return <>
    <section className="ab-hero"><div className="wrap">
      <nav className="crumbs" aria-label="Breadcrumb"><a href="#home">Home</a> <span>/</span> <b>About us</b></nav>
      {a.credentials && <div className="ab-cred"><LuBadgeCheck /> <span>{a.credentials}</span></div>}
      <h1 className="h1s">About us</h1>
      {a.tagline && <p className="ab-tag">{a.tagline}</p>}
      {stats.length > 0 && <div className={`ab-stats n${stats.length}`}>{stats.map((x, i) => <div key={i} className="ab-stat"><b>{x.value}</b><span>{x.label}</span>{x.sub && <small>{x.sub}</small>}</div>)}</div>}
    </div></section>

    <section className="sec"><div className="wrap ab-narrow">
      <div className="eyebrow">Who we are</div><h2 className="mb16">Company overview</h2>
      <div className="article">{paras.map((x, i) => <p key={i}>{x}</p>)}{a.commitment && <p className="ab-commit"><b>{a.commitment}</b></p>}</div>
    </div></section>

    {a.leader.name && <section className="sec alt"><div className="wrap">
      <div className="eyebrow">Leadership</div><h2 className="mb20">Executive leadership &amp; governance</h2>
      <div className="card ab-leader">
        <div className="ab-leader-pic">{a.leader.photo ? <img src={a.leader.photo.url} alt={a.leader.name} loading="lazy" /> : <Avatar name={a.leader.name} size={140} />}
          {a.leader.badge && <span className="ab-badge"><LuBadgeCheck /> {a.leader.badge}</span>}</div>
        <div className="ab-leader-txt">
          <h3>{a.leader.name}</h3><div className="muted b">{a.leader.title}</div>
          {a.leader.quote && <blockquote className="ab-quote">“{a.leader.quote}”</blockquote>}
          {a.leader.bio && a.leader.bio.split(/\n+/).map((x, i) => <p key={i}>{x}</p>)}
        </div>
      </div>
      {highlights.length > 0 && <div className="ab-high">{highlights.map((x, i) => <div key={i} className="card ab-hl"><b>{x.value}</b><span>{x.label}</span></div>)}</div>}
    </div></section>}

    <section className={`sec${a.leader.name ? "" : " alt"}`}><div className="wrap">
      <div className="eyebrow">Purpose</div><h2 className="mb20">Mission &amp; vision</h2>
      <div className="grid g2">{[a.mission, a.vision].map((m, i) => m.title && (
        <article key={i} className="card ab-mv"><span className="ab-num">0{i + 1}</span><h3>{m.title}</h3><p>{m.text}</p>
          {m.points.length > 0 && <ul className="ab-points">{m.points.map((p, j) => <li key={j}><LuBadgeCheck /> {p}</li>)}</ul>}
          {m.tag && <span className="ab-valtag">{m.tag}</span>}</article>))}</div>
    </div></section>

    {a.docs.length > 0 && <section className={`sec${a.leader.name ? " alt" : ""}`}><div className="wrap">
      <div className="eyebrow">Verified</div><h2 className="mb8">Licences &amp; official documents</h2>
      {a.docsIntro && <p className="muted mb20">{a.docsIntro}</p>}
      <div className="grid g3">{a.docs.map(d => (
        <article key={d.id} className="card ab-doc">
          <button type="button" className="ab-thumb" onClick={() => (isPdf(d) ? window.open(`${d.file.url}?inline=1`, "_blank", "noopener") : setView(d))} aria-label={`Inspect ${d.title}`}>
            {isPdf(d) ? <span className="ab-pdf"><LuFileText /><b>PDF</b></span> : <img src={d.file.url} alt={d.title} loading="lazy" />}
            <span className="ab-ok"><LuBadgeCheck /> Verified</span>
          </button>
          <div className="ab-doc-b">
            <h3>{d.title}</h3>
            {d.issuer && <div className="muted small">{d.issuer}</div>}
            <div className="ab-doc-meta">{d.number && <span><b>No.</b> <span data-notr>{d.number}</span></span>}{d.valid && <span><b>Valid:</b> {d.valid}</span>}</div>
            <div className="row tight mt8">
              <button type="button" className="btn sm" onClick={() => (isPdf(d) ? window.open(`${d.file.url}?inline=1`, "_blank", "noopener") : setView(d))}><LuEye /> Inspect</button>
              <a className="btn sm" href={d.file.url} download={d.file.name}><LuDownload /> {isPdf(d) ? "Open PDF" : "Download"}</a>
            </div>
          </div>
        </article>))}</div>
    </div></section>}

    <section className="sec"><div className="wrap"><div className="ab-cta">
      <div><h2>{a.cta.title}</h2><p>{a.cta.text}</p>
        <div className="ab-cta-c">{s.address && <span><LuMapPin /> {s.address}</span>}{s.phone && <a href={`tel:${s.phone.replace(/[^+\d]/g, "")}`}><LuPhone /> {s.phone}</a>}{s.whatsapp && <a href={waLink(s.whatsapp, "Hello MAM & MAM Overseas")} target="_blank" rel="noopener noreferrer"><FaWhatsapp /> +{s.whatsapp}</a>}</div></div>
      <div className="ab-cta-b"><a className="btn pri" href="#contact"><LuMail /> Contact us</a><a className="btn ghost" href="#jobs"><LuBriefcase /> Browse jobs</a><a className="btn ghost" href="#team"><LuUsersRound /> Our team</a></div>
    </div></div></section>

    {view && <div className="ab-viewer" role="dialog" aria-label={view.title} onClick={() => setView(null)}>
      <div className="ab-viewer-in" onClick={e => e.stopPropagation()}>
        <div className="row between"><b>{view.title}</b><button className="btn sm" onClick={() => setView(null)} aria-label="Close"><LuX /></button></div>
        <img src={view.file.url} alt={view.title} />
      </div>
    </div>}
  </>;
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

/* ---------------- Track / Verify (public) ---------------- */
const TV_TABS = [["track", "Track file", LuSearchCheck], ["receipt", "Money receipt", LuReceipt], ["statement", "Statement", LuFileText], ["salary", "Salary receipt", LuWallet], ["member", "Expert Team", LuBadgeCheck]];
export function Track() {
  const [tab, setTab] = React.useState("track");
  return (
    <section className="sec"><div className="wrap stack">
      <div><div className="eyebrow">Track / Verify</div><h1 className="h1s">Track your file or verify a document</h1>
        <p className="muted mt8 measure">Track your application, BMET clearance, visa and air ticket with your passport number or mobile number. Check that a money receipt, statement, salary receipt or team member's card is genuine.</p></div>
      <nav className="tv-tabs" role="tablist" aria-label="Track / Verify">{TV_TABS.map(([k, l, I]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}><I /> <span>{l}</span></button>)}</nav>
      {tab === "track" ? <TrackFile /> : tab === "member" ? <VerifyBox /> : <VerifyDoc key={tab} kind={tab} />}
    </div></section>
  );
}
function TrackFile() {
  const [res, setRes] = React.useState(null); const [busy, setBusy] = React.useState(false);
  // tracking a file needs an account: the Sign in page opens (job seekers then see their files in their own panel too)
  const signed = !!store.S.session;
  React.useEffect(() => { if (!signed) openModal("auth", { mode: "login" }); }, [signed]);
  if (!signed) return <div className="card stack track-signin"><h3><LuLogIn /> Sign in to track your file</h3>
    <p className="muted">Sign in with your account to track your application, BMET clearance, visa and air ticket. New here? Create a free job seeker account with your mobile number; passports the office entered with that number show in your account.</p>
    <div className="row"><button className="btn pri" type="button" onClick={() => openModal("auth", { mode: "login" })}><LuLogIn /> Sign in</button>
      <button className="btn" type="button" onClick={() => openModal("auth", { mode: "register", role: "candidate" })}><LuUserPlus /> Create account</button></div></div>;
  const submit = async e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.currentTarget)); const pass = String(d.passport || "").trim(), ph = String(d.phone || "").replace(/\D/g, "");
    if (pass.length < 6 && ph.length < 10) return toast("Enter the passport number or the mobile number.");
    setBusy(true); const r = await act("track.lookup", { passport: pass, phone: ph }, { quiet: true }); setBusy(false); if (r) setRes(r.result);
  };
  return <>
    <form className="card search track" onSubmit={submit} noValidate>
      <input type="text" name="passport" placeholder="Passport number, e.g. A00000001" aria-label="Passport number" autoComplete="off" style={{ textTransform: "uppercase" }} />
      <span className="tv-or">or</span>
      <input type="tel" name="phone" placeholder="Mobile number" aria-label="Mobile number" />
      <button className="btn pri" type="submit" disabled={busy}><LuSearchCheck /> Check status</button>
    </form>
    <p className="muted small">Fill in either one: the passport number or the mobile number given to us or your agent.</p>
    {res === false && <div className="notice">No file matches. Check the number, or contact the office.</div>}
    {res && res.map((x, i) => <div className="stack" key={i}>
      <div className="card row between"><div><h3>{x.name}</h3><div className="muted small">Passport {x.passport || "—"}</div></div></div>
      {x.visa?.map((v, j) => <div className="card" key={`v${j}`}><div className="row between"><h4><LuPlaneTakeoff /> {`Visa file · ${v.list}`}</h4><span className="ec-badge">{v.status}</span></div><p className="muted small mt6">Updated {fdate(v.at)}</p></div>)}
      {x.clearances.map(c => <div className="card" key={c.id}><div className="row between"><h4><LuIdCard /> BMET clearance · {c.country}</h4><Pill s={c.status} label={c.status === "custom" ? c.statusText : undefined} /></div><ClPipe c={c} /><p className="muted small mt6">Submitted {fdate(c.created)}{c.card ? ` · Clearance card ready (${fdate(c.card.sentAt)})` : ""}</p></div>)}
      {x.apps.map(a => { const j = a.job; return <div className="card" key={a.id}><div className="row between"><h4><LuBriefcase /> {j?.title || "Job"}{j ? ` · ${j.city}, ${j.country}` : ""}</h4><Pill s={a.status} /></div><Pipe a={a} /><p className="muted small mt6">Applied {fdate(a.appliedAt)}</p></div>; })}
      {x.tickets.map(t => <div className="card" key={t.id}><div className="row between"><h4><LuTicket /> Air ticket · {t.from} → {t.to}</h4><Pill s={t.status} /></div><p className="small mt6">{t.status === "booked" ? `${t.airline} · PNR ${t.pnr} · Flight ${fdate(t.flightDate)}` : `Preferred date ${fdate(t.prefDate)}`}</p></div>)}
      {!x.clearances.length && !x.apps.length && !x.tickets.length && !x.visa?.length && <Empty>No applications on this file yet.</Empty>}
    </div>)}
  </>;
}
const DOC = { receipt: ["Money receipt", "Receipt No., e.g. MR-2026-0001", "Amount (BDT)", "Enter the receipt number and the amount printed on the money receipt. Or scan the QR code on the receipt."],
  statement: ["Statement", "Statement No., e.g. ST-2026-0001", "Balance, total debit or total credit (BDT)", "Enter the statement number and one of the totals printed on it (balance, total debit or total credit). Or scan the QR code on the statement."],
  salary: ["Salary receipt", "Receipt No., e.g. SP-2026-0001", "Amount paid (BDT)", "Enter the salary receipt number and the amount paid. Or scan the QR code on the receipt."] };
function VerifyDoc({ kind }) {
  const [t, ph, amt, help] = DOC[kind]; const [busy, setBusy] = React.useState(false); const [msg, setMsg] = React.useState("");
  const submit = async e => {
    e.preventDefault(); const d = Object.fromEntries(new FormData(e.currentTarget)); setMsg("");
    if (!String(d.no || "").trim() || !String(d.amount || "").trim()) return toast("Enter the number and the amount.");
    setBusy(true); const r = await act("verify.find", { kind, no: d.no, amount: d.amount }, { quiet: true }); setBusy(false);
    if (r?.go) location.hash = r.go; else if (r?.error) setMsg(r.error);
  };
  return <form className="card verify-box" onSubmit={submit} noValidate>
    <div className="vb-text"><h2><LuShieldCheck /> {`Verify a ${t.toLowerCase()}`}</h2><p className="muted">{help}</p></div>
    <div className="vb-form tv-doc">
      <input type="text" name="no" placeholder={ph} aria-label={ph} autoComplete="off" style={{ textTransform: "uppercase" }} maxLength={30} />
      <input type="text" name="amount" inputMode="decimal" placeholder={amt} aria-label={amt} maxLength={20} />
      <button className="btn pri" type="submit" disabled={busy}><LuSearch /> Verify</button>
    </div>
    {msg && <div className="notice mt8">{msg}</div>}
  </form>;
}

/* ---------------- first admin account (one-time link from the installer) ---------------- */
export function Setup({ token }) {
  const S = store.S;
  const submit = async e => { const [d] = formData(e); const r = await act("setup.admin", { ...d, token: d.token || token }); if (r) go("dashboard"); };
  if (store.loaded && !S.needsSetup) return <section className="sec"><div className="wrap"><Empty>The admin account is already set up. <a href="#home">Go to the website</a> and sign in.</Empty></div></section>;
  return (
    <section className="sec"><div className="wrap" style={{ maxWidth: 560 }}>
      <form className="card stack12" onSubmit={submit}>
        <div><Logo size={72} /><div className="eyebrow mt8">First-time setup</div><h1 className="h1s">Create the admin account</h1>
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
/* one team member: same-size portrait photo, name, designation and contact buttons */
export function TeamCard({ m, compact }) {
  const contacts = [
    m.phone && { href: `tel:${m.phone.replace(/[^\d+]/g, "")}`, icon: <LuPhone />, label: `Call ${m.name}` },
    m.whatsapp && { href: waLink(m.whatsapp, "Assalamu Alaikum, I contacted you from the MAM & MAM Overseas website."), icon: <FaWhatsapp />, label: `WhatsApp ${m.name}`, cls: " wa", ext: true },
    m.email && { href: `mailto:${m.email}`, icon: <LuMail />, label: `Email ${m.name}` },
    m.website && { href: m.website, icon: <LuGlobe />, label: `Website of ${m.name}`, ext: true },
  ].filter(Boolean);
  return (
    <article className={`teamcard${compact ? " compact" : ""}${/chairman|director/i.test(m.title || "") ? " lead" : ""}`}>
      <div className={`tc-photo${m.photo ? " pic" : ""}`}>
        {m.photo ? <img src={m.photo.data} alt={m.name} loading="lazy" decoding="async" /> : <div className="tc-ph"><Avatar name={m.name} size={compact ? 96 : 120} /></div>}
        {m.dept && <span className="tc-dept">{m.dept}</span>}
      </div>
      <div className="tc-body">
        <h3>{m.name}</h3>
        <div className="tc-title">{m.title}</div>
        {memberCode(m) && <div className="tc-id">ID <span className="num">{memberCode(m)}</span></div>}
        {!compact && m.years !== "" && m.years != null && Number(m.years) > 0 && <div className="tc-years"><LuAward /> {m.years}+ years in overseas recruitment</div>}
        {!compact && m.bio && <p className="tc-bio muted small">{m.bio}</p>}
        {!compact && m.expertise?.length > 0 && <div className="row tight tc-exp">{m.expertise.slice(0, 4).map(x => <span key={x} className="chip">{x}</span>)}</div>}
        <div className="tc-contact">{contacts.map(c => <a key={c.label} className={`tc-ic${c.cls || ""}`} href={c.href} aria-label={c.label} title={c.label} {...(c.ext ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{c.icon}</a>)}
          <button type="button" className="tc-card" onClick={() => openModal("vcard", { teamId: m.id })} aria-label={`Visiting card of ${m.name}`}><LuIdCard /> <span>Visiting card</span></button></div>
      </div>
    </article>
  );
}

/* team members in a sliding row: arrows, dots, swipe, and it moves on by itself */
export function TeamCarousel({ list, compact }) {
  const ref = React.useRef(null);
  const [page, setPage] = React.useState(0); const [pages, setPages] = React.useState(1); const [paused, setPaused] = React.useState(false);
  const rtl = () => document.documentElement.dir === "rtl";
  const measure = () => {
    const el = ref.current; if (!el) return;
    const card = el.firstElementChild; const step = card ? card.getBoundingClientRect().width + 20 : el.clientWidth;
    const per = Math.max(1, Math.round((el.clientWidth + 20) / step));
    setPages(Math.max(1, Math.ceil(list.length / per)));
    const p = Math.round(Math.abs(el.scrollLeft) / Math.max(1, el.clientWidth + 20 - 1));
    setPage(Math.abs(el.scrollLeft) + el.clientWidth >= el.scrollWidth - 4 ? Math.max(1, Math.ceil(list.length / per)) - 1 : p);
  };
  const goPage = p => { const el = ref.current; if (!el) return; el.scrollTo({ left: (rtl() ? -1 : 1) * p * (el.clientWidth + 20), behavior: "smooth" }); };
  const step = d => {
    const el = ref.current; if (!el) return;
    const atEnd = Math.abs(el.scrollLeft) + el.clientWidth >= el.scrollWidth - 4, atStart = Math.abs(el.scrollLeft) < 4;
    if (d > 0 && atEnd) return el.scrollTo({ left: 0, behavior: "smooth" });
    if (d < 0 && atStart) return el.scrollTo({ left: (rtl() ? -1 : 1) * el.scrollWidth, behavior: "smooth" });
    const card = el.firstElementChild; const w = card ? card.getBoundingClientRect().width + 20 : el.clientWidth;
    el.scrollBy({ left: (rtl() ? -1 : 1) * d * w, behavior: "smooth" });
  };
  React.useEffect(() => { measure(); const r = () => measure(); addEventListener("resize", r); return () => removeEventListener("resize", r); }, [list.length]);
  React.useEffect(() => {
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (paused || reduce || pages < 2) return;
    const t = setInterval(() => { if (!document.hidden) step(1); }, 4500); return () => clearInterval(t);
  }, [paused, pages]);
  return (
    <div className={`teamcar${compact ? " compact" : ""}`} role="region" aria-roledescription="carousel" aria-label="Team members"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)} onTouchStart={() => setPaused(true)}>
      <div className="tcar-track" ref={ref} onScroll={measure}>{list.map(m => <TeamCard key={m.id} m={m} compact={compact} />)}</div>
      {pages > 1 && <div className="tcar-ctl">
        <button type="button" className="tcar-arrow" aria-label="Previous team members" onClick={() => step(-1)}><LuChevronLeft /></button>
        <div className="tcar-dots">{Array.from({ length: pages }, (_, k) => <button key={k} type="button" className={k === page ? "on" : ""} aria-label={`Page ${k + 1}`} aria-current={k === page} onClick={() => goPage(k)} />)}</div>
        <button type="button" className="tcar-arrow" aria-label="Next team members" onClick={() => step(1)}><LuChevronRight /></button>
      </div>}
    </div>
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
        <p className="lead">Recruitment officers, visa and BMET processing staff, accounts and agent support: the Mam &amp; Mam Overseas Ltd. team working under licence RL 1217.</p>
        {S.team.length > 0 && <div className="pagehead-stats"><span><b>{S.team.length}</b> team members</span><span><b>{depts.length}</b> departments</span>
          {S.team.some(m => Number(m.years) > 0) && <span><b>{S.team.reduce((s, m) => s + (Number(m.years) || 0), 0)}+</b> combined years of experience</span>}</div>}
      </div></section>
      <section className="sec"><div className="wrap stack">
        {depts.length > 1 && <div className="row">{[["", "All"], ...depts.map(d => [d, d])].map(([k, l]) => <button key={l} className={`btn sm${dept === k ? " pri" : ""}`} onClick={() => setDept(k)}>{l}</button>)}</div>}
        {L.length ? <TeamCarousel key={dept} list={L} />
          : <Empty>Team profiles are being added. {isStaff ? <>Add them in <a href="#dashboard">Admin › Website content</a>.</> : <>Meanwhile, <a href="#contact">contact the office</a>.</>}</Empty>}
        {S.team.length > 0 && <VerifyBox />}
        <div className="card row between cta soft">
          <div className="cta-text"><h2>Talk to our team</h2><p className="muted mt8">Visit the office or send a message. We reply within one working day.</p></div>
          <div className="row"><a className="btn pri" href="#contact">Contact us</a><a className="btn" href="#jobs">See open jobs</a></div>
        </div>
      </div></section>
    </>
  );
}

/* Home page slideshow: pictures fill the top section, crossfade every few seconds, and scale with the window */
function HeroSlides({ list, sec }) {
  const N = list.length; const SCENES = list;
  const [i, setI] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  const [seen, setSeen] = React.useState(() => new Set([0, 1]));
  const tx = React.useRef(null);
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const go = n => setI(((n % N) + N) % N);
  React.useEffect(() => { if (i >= N) { setI(0); return; } setSeen(s => (s.has(i) && s.has((i + 1) % N) ? s : new Set([...s, i, (i + 1) % N]))); }, [i]);
  React.useEffect(() => {
    if (paused || reduce) return;
    const t = setTimeout(() => { if (!document.hidden) go(i + 1); else setI(n => n); }, Math.max(3, Number(sec) || 6.5) * 1000);
    return () => clearTimeout(t);
  }, [i, paused, N, sec]);
  return (
    <div className="slides" role="region" aria-roledescription="carousel" aria-label="Scenes from Bangladesh"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onTouchStart={e => { tx.current = e.touches[0].clientX; }}
      onTouchEnd={e => { const d = e.changedTouches[0].clientX - (tx.current ?? 0); if (Math.abs(d) > 45) go(i + (d < 0 ? 1 : -1)); tx.current = null; }}>
      {SCENES.map((s, k) => (
        <div key={s.id} className={"slide" + (k === i ? " on" : "")} aria-hidden={k !== i}>
          {seen.has(k) && <img src={s.src} srcSet={s.srcSet || undefined}
            sizes="100vw" alt={s.alt} style={{ objectPosition: s.pos }} decoding="async" fetchpriority={k === 0 ? "high" : "auto"} draggable="false" />}
        </div>
      ))}
      <div className="slides-shade" />
      <div className="slides-ctl" onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
        <button type="button" className="sl-arrow" aria-label="Previous picture" onClick={() => go(i - 1)}><LuChevronLeft /></button>
        <div className="sl-dots">{SCENES.map((s, k) => <button key={s.id} type="button" className={k === i ? "on" : ""} aria-label={`Picture ${k + 1}`} aria-current={k === i} onClick={() => go(k)} />)}</div>
        <button type="button" className="sl-arrow" aria-label="Next picture" onClick={() => go(i + 1)}><LuChevronRight /></button>
      </div>
    </div>
  );
}
