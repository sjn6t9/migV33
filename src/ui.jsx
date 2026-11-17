import React from "react";
import {
  LuBookmark, LuBookmarkCheck, LuMapPin, LuClock, LuBriefcase, LuX, LuHardHat, LuHotel, LuTruck, LuFactory,
  LuHeartPulse, LuShield, LuSparkles, LuWheat, LuShoppingBag, LuMonitor, LuStar, LuDownload, LuBadgeCheck
} from "react-icons/lu";
import { store, touch, me, company, money, num, bdtMin, isHourly, fdate, bdtFmt, LABEL, STAGES, CL_STAGES } from "./store.js";
import { toggleSave, downloadFile, cardFileName } from "./actions.js";
import { ShareButton } from "./Share.jsx";

/* All icons are inline SVG React components (react-icons / Lucide). No PNG images are used anywhere. */
export const CAT_ICON = {
  "Construction": LuHardHat, "Hospitality": LuHotel, "Driving & Transport": LuTruck, "Manufacturing": LuFactory, "Healthcare": LuHeartPulse,
  "Security": LuShield, "Cleaning & Facility": LuSparkles, "Agriculture": LuWheat, "Retail & Sales": LuShoppingBag, "IT & Office": LuMonitor
};

/* The agency's own logo (globe, plane and M&M), served from /brand/ */
export function Logo({ size = 48, className = "" }) {
  const src = size > 64 ? "/brand/logo-192.webp" : "/brand/logo-96.webp";
  const src2 = size > 64 ? "/brand/logo-320.webp" : "/brand/logo-192.webp";
  return <img className={`logo-mark ${className}`} src={src} srcSet={`${src} 1x, ${src2} 2x`} width={size} height={size} alt="" decoding="async" />;
}

export const Pill = ({ s }) => <span className={`pill p-${s}`}>{LABEL[s] || s}</span>;
export const Empty = ({ children, style }) => <div className="empty" style={style}>{children}</div>;
/* empty office details: a hint for admin/staff, a plain dash for visitors */
export const Unset = () => (["admin", "staff"].includes(me()?.role) ? <span className="unset">Not set yet (Admin › Settings)</span> : <span className="muted">—</span>);
export const Val = ({ v }) => (v ? v : <Unset />);
export const Count = ({ n }) => (n ? <span className="count">{n}</span> : null);

function Stepper({ stages, status, history }) {
  const rej = status === "rejected";
  const last = rej ? Math.max(0, ...history.map(h => stages.indexOf(h.s))) : stages.indexOf(status);
  const final = stages[stages.length - 1];
  return (
    <div className={`pipe${rej ? " rej" : ""}`}>
      {stages.map((s, i) => (
        <span key={s} className={i < last || (!rej && i === last && s === final) ? "done" : i === last && !rej ? "cur" : ""}>{LABEL[s]}</span>
      ))}
    </div>
  );
}
export const Pipe = ({ a }) => <Stepper stages={STAGES} status={a.status} history={a.history} />;
export const ClPipe = ({ c }) => <Stepper stages={CL_STAGES} status={c.status} history={c.history} />;

export function SaveButton({ j, full }) {
  const u = me(); const saved = u?.role === "candidate" && u.saved.includes(j.id);
  if (full) return <button className="btn" onClick={() => toggleSave(j.id)}>{saved ? <LuBookmarkCheck /> : <LuBookmark />}{saved ? "Saved" : "Save job"}</button>;
  return (
    <button className={`save${saved ? " on" : ""}`} onClick={() => toggleSave(j.id)} aria-label={saved ? "Remove from saved jobs" : "Save job"} title={saved ? "Saved" : "Save job"}>
      {saved ? <LuBookmarkCheck /> : <LuBookmark />}
    </button>
  );
}

export function JobCard({ j }) {
  return (
    <article className="card job">
      <div className="t">
        <div>
          {j.featured && <div className="badge-feat">Featured</div>}
          <h3><a href={`#job-${j.id}`}>{j.title}</a></h3>
          <div className="muted small">{company(j)}</div>
        </div>
        <SaveButton j={j} />
      </div>
      <div className="sal num">
        {money(j.salaryMin, j.currency)}–{num(j.salaryMax)}
        <span className="muted small sal-sub"> {isHourly(j) ? "/hour · ≈ BDT" : "/month · ≈ BDT"} {num(bdtMin(j))}+</span>
      </div>
      <div className="meta">
        <span><LuMapPin /> {j.city}, {j.country}</span>
        <span><LuBriefcase /> {j.type} · {j.contract} yr</span>
        <span><LuClock /> {j.experience ? `${j.experience}+ yr exp.` : "No experience needed"}</span>
      </div>
      <div className="row tight">{j.benefits.slice(0, 4).map(b => <span key={b} className="chip">{b}</span>)}</div>
      <div className="foot">
        <span className="muted small">{j.vacancies} vacancies · Deadline {fdate(j.deadline)}</span>
        <div className="row tight"><ShareButton j={j} small label="" /><a className="btn sm pri" href={`#job-${j.id}`}>View &amp; apply</a></div>
      </div>
    </article>
  );
}

export function Toast() {
  const t = store.ui.toast;
  return <div id="toast" className={t ? "show" : ""} role="status" aria-live="polite">{t}</div>;
}

export function ModalFrame({ onClose, children, wide }) {
  React.useEffect(() => {
    const k = e => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-bg open" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true">
        <button className="btn sm x" onClick={onClose} aria-label="Close"><LuX /></button>
        {children}
      </div>
    </div>
  );
}

export function Tiles({ items }) {
  return <div className="tiles">{items.map(([v, l, alert], i) => <div key={i} className={`tile${alert ? " alert" : ""}`}><b>{v}</b><span>{l}</span></div>)}</div>;
}

export function Bars({ rows }) {
  const m = Math.max(1, ...rows.map(r => r[1]));
  return (
    <div className="bars">
      {rows.map(([k, v]) => (
        <div className="bar" key={k}><span className="small">{k}</span><div className="tr"><div className="fl" style={{ width: `${(v / m) * 100}%` }} /></div><span className="n">{v}</span></div>
      ))}
    </div>
  );
}

/* Dashboard tab rail with icons */
export function Rail({ role, items }) {
  const cur = store.ui.tab[role];
  return (
    <nav className="rail" aria-label="Dashboard sections">
      {items.map(([k, label, Icon, c]) => (
        <button key={k} className={cur === k ? "on" : ""} onClick={() => { store.ui.tab[role] = k; if (k !== "post") store.ui.editJob = null; touch(); }}>
          <span className="rail-l">{Icon && <Icon />}{label}</span><Count n={c} />
        </button>
      ))}
    </nav>
  );
}

/* Simple text renderer for blog posts: "### " lines become sub-headings */
export function Md({ body }) {
  return body.split("\n").filter(Boolean).map((l, i) => (l.startsWith("### ") ? <h3 key={i}>{l.slice(4)}</h3> : <p key={i}>{l}</p>));
}

export function Stars({ n }) {
  return <span className="stars" aria-label={`${n} out of 5`}>{[1, 2, 3, 4, 5].map(i => <LuStar key={i} className={i <= n ? "on" : ""} />)}</span>;
}
/* Initials avatar drawn with CSS; no photo or icon file needed */
export function Avatar({ name, size = 56, src }) {
  if (src) return <img className="avatar photo" src={src} alt="" width={size} height={size} style={{ width: size, height: size }} />;
  const ini = String(name || "?").replace(/\(.*?\)/g, "").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
  return <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.36 }} aria-hidden="true">{ini}</span>;
}

/* Shown to the agent / job seeker once the agency has sent the clearance card */
export function CardDownload({ c }) {
  if (!c.card) return null;
  const fee = Number(c.card.fee || 0);
  return (
    <div className="notice ok cardbox">
      <span><LuBadgeCheck /> <b>Clearance card ready</b> · sent {fdate(c.card.sentAt)}
        {fee > 0 && <> · Card fee <b>{bdtFmt(fee)}</b>{c.card.feeNote ? ` (${c.card.feeNote})` : ""}</>}</span>
      <button className="btn sm pri" onClick={() => downloadFile(c.card.data, cardFileName(c))}><LuDownload /> Download Clearance Card</button>
    </div>
  );
}
