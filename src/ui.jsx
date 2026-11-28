import React from "react";
import { createPortal } from "react-dom";
import { LuUpload, LuFileText, LuRefreshCw } from "react-icons/lu";
import {
  LuBookmark, LuBookmarkCheck, LuMapPin, LuClock, LuBriefcase, LuX, LuHardHat, LuHotel, LuTruck, LuFactory,
  LuHeartPulse, LuShield, LuSparkles, LuWheat, LuShoppingBag, LuMonitor, LuStar, LuDownload, LuBadgeCheck, LuMenu, LuChevronDown
} from "react-icons/lu";
import { store, touch, me, company, money, num, bdtMin, isHourly, fdate, bdtFmt, LABEL, STAGES, CL_STAGES } from "./store.js";
import { toggleSave, downloadFile, cardFileName, go } from "./actions.js";
import { ShareButton } from "./Share.jsx";
import { SITE } from "./site.js";

/* All icons are inline SVG React components (react-icons / Lucide). No PNG images are used anywhere. */
export const CAT_ICON = {
  "Construction": LuHardHat, "Hospitality": LuHotel, "Driving & Transport": LuTruck, "Manufacturing": LuFactory, "Healthcare": LuHeartPulse,
  "Security": LuShield, "Cleaning & Facility": LuSparkles, "Agriculture": LuWheat, "Retail & Sales": LuShoppingBag, "IT & Office": LuMonitor
};

/* The agency's own logo (M&M with the plane), served from /brand/ */
export function Logo({ size = 48, className = "", square = false }) {
  if (square) {
    const src = size > 64 ? "/brand/logo-192.webp?v=2" : "/brand/logo-96.webp?v=2";
    const src2 = size > 64 ? "/brand/logo-320.webp?v=2" : "/brand/logo-192.webp?v=2";
    return <img className={`logo-mark ${className}`} src={src} srcSet={`${src} 1x, ${src2} 2x`} width={size} height={size} alt="" decoding="async" />;
  }
  // the logo is wide (16:10): `size` is its height
  const w = Math.round(size * 1.6), src = w > 160 ? "/brand/logo-w320.webp?v=2" : "/brand/logo-w160.webp?v=2";
  return <img className={`logo-mark wide ${className}`} src={src} srcSet={`${src} 1x, ${w > 160 ? "/brand/logo-w640.webp?v=2" : "/brand/logo-w320.webp?v=2"} 2x`} width={w} height={size} alt="" decoding="async" />;
}

export const Pill = ({ s, label }) => <span className={`pill p-${s}`}>{label || LABEL[s] || s}</span>;
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
export const ClPipe = ({ c }) => <Stepper stages={CL_STAGES} status={c.status === "custom" ? c.baseStage || "pending" : c.status} history={c.history} />;

export function SaveButton({ j, full }) {
  const u = me(); const saved = u?.role === "candidate" && u.saved.includes(j.id);
  if (full) return <button className="btn" onClick={() => toggleSave(j.id)}>{saved ? <LuBookmarkCheck /> : <LuBookmark />}{saved ? "Saved" : "Save job"}</button>;
  return (
    <button className={`save${saved ? " on" : ""}`} onClick={() => toggleSave(j.id)} aria-label={saved ? "Remove from saved jobs" : "Save job"} title={saved ? "Saved" : "Save job"}>
      {saved ? <LuBookmarkCheck /> : <LuBookmark />}
    </button>
  );
}

const JOB_TAG = { urgent: "Urgent", new: "New", upcoming: "Upcoming" };
export function JobCard({ j }) {
  return (
    <article className={`card job${j.label ? ` job-${j.label}` : ""}`}>
      <div className="t">
        <div>
          {(j.featured || j.label) && <div className="row tight">{j.label && <span className={`job-tag ${j.label}`}>{JOB_TAG[j.label]}</span>}{j.featured && <div className="badge-feat">Featured</div>}</div>}
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
  return <><div id="toast" className={t ? "show" : ""} role="status" aria-live="polite">{t}</div>
    {store.newBuild && <div className="new-build" role="status">A new version of the site is ready. <button className="btn sm pri" onClick={() => location.reload()}>Reload</button></div>}</>;
}

export function ModalFrame({ onClose, children, wide, className = "" }) {
  React.useEffect(() => {
    const k = e => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k); return () => document.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-bg open" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? " wide" : ""}${className ? " " + className : ""}`} role="dialog" aria-modal="true">
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
/* Left side drawer for menus on small screens */
export function Drawer({ open, onClose, title, children, label = "Menu" }) {
  React.useEffect(() => {
    if (!open) return;
    const esc = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc); const o = document.body.style.overflow; document.body.style.overflow = "hidden"; document.body.classList.add("drawer-on");
    return () => { document.removeEventListener("keydown", esc); document.body.style.overflow = o; document.body.classList.remove("drawer-on"); };
  }, [open]);
  // drawn on the page body: inside the glass header (backdrop-filter) a fixed layer would only be as tall as the header
  return createPortal(<div className={`drawer-bg${open ? " open" : ""}`} onClick={e => { if (e.target === e.currentTarget) onClose(); }} aria-hidden={!open}>
    <aside className="drawer" role="dialog" aria-modal="true" aria-label={label}>
      <div className="drawer-head">{title}<button type="button" className="btn sm drawer-x" onClick={onClose} aria-label="Close menu"><LuX /></button></div>
      <div className="drawer-body">{open && children}</div>
    </aside>
  </div>, document.body);
}

export function Rail({ role, items, foot = [], head = null }) {
  const cur = store.ui.tab[role]; const [open0, setOpen0] = React.useState(false);
  const inPanel = !!(SITE.admin || SITE.agent); // the panels open this drawer from the ☰ button in their header
  const open = inPanel ? !!store.ui.railOpen : open0;
  const setOpen = v => { if (inPanel) { store.ui.railOpen = v; touch(); } else setOpen0(v); };
  const pick = k => { store.ui.tab[role] = k; if (k !== "post") store.ui.editJob = null; setOpen(false); go("dashboard"); touch(); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const now = [...items, ...foot].find(x => x[0] === cur) || items[0]; const total = items.reduce((s, x) => s + (Number(x[3]) || 0), 0);
  const btn = ([k, label, Icon, c, onClick], foot) => (
    <button key={k} className={`${cur === k && !onClick ? "on" : ""}${foot === true ? " rail-foot-item" : ""}`.trim() || undefined} aria-current={cur === k && !onClick ? "page" : undefined} onClick={() => (onClick ? (setOpen(false), onClick()) : pick(k))}>
      <span className="rail-l">{Icon && <Icon />}{label}</span><Count n={c} />
    </button>);
  // foot: Settings and Log out sit at the bottom of the menu
  const list = cls => <nav className={cls} aria-label="Dashboard sections">{head}{items.map(btn)}{foot.length > 0 && <><hr className="rail-sep rail-foot-item" />{foot.map(x => btn(x, true))}</>}</nav>;
  return <>
    {list(`rail rail-desk${inPanel ? " in-panel" : ""}`)}
    {!inPanel && <button type="button" className="rail-mob" onClick={() => setOpen(true)} aria-label="Open dashboard menu" aria-expanded={open}>
      <LuMenu className="rail-mob-ic" /><span className="rail-l">{now?.[2] && React.createElement(now[2])}{now?.[1]}</span>{total > 0 && <span className="count">{total}</span>}<LuChevronDown className="rail-mob-down" />
    </button>}
    <Drawer open={open} onClose={() => setOpen(false)} label="Dashboard sections" title={<b className="drawer-title">Dashboard</b>}>{list("rail rail-drawer")}</Drawer>
  </>;
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

/* account badges (the agency's own badge pictures): admin = A + verified, staff = S */
const BadgeImg = ({ src, size, title }) => <img className="badge-ic" src={src} width={size} height={size} alt={title} title={title} draggable={false} />;
export const VerifiedBadge = ({ size = 16, title = "Verified" }) => <BadgeImg src="/brand/badge-verified.webp?v=1" size={size} title={title} />;
export const AdminBadge = ({ size = 16 }) => <BadgeImg src="/brand/badge-admin.webp?v=1" size={size} title="Admin" />;
export const StaffBadge = ({ size = 16 }) => <BadgeImg src="/brand/badge-staff.webp?v=1" size={size} title="Staff" />;
/** badges after a name: admin → A + verified, staff → S */
export function RoleBadges({ role, size = 16 }) {
  if (role === "admin") return <span className="badges"><AdminBadge size={size} /><VerifiedBadge size={size} /></span>;
  if (role === "staff") return <span className="badges"><StaffBadge size={size} /></span>;
  return null;
}

/* File chooser: a clear button, and the chosen file shown small beside it (photo thumbnail, or a document icon with name and size).
   The real file input stays in the form, so forms read it as before. */
const kb = n => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
export function FilePick({ name, accept, multiple, required, label }) {
  const ref = React.useRef(null); const [files, setFiles] = React.useState([]);
  const urls = React.useMemo(() => files.map(f => (/^image\//.test(f.type) ? URL.createObjectURL(f) : "")), [files]);
  React.useEffect(() => () => urls.forEach(u => u && URL.revokeObjectURL(u)), [urls]);
  React.useEffect(() => { const form = ref.current?.form; if (!form) return; const r = () => setFiles([]); form.addEventListener("reset", r); return () => form.removeEventListener("reset", r); }, []);
  const clear = () => { if (ref.current) ref.current.value = ""; setFiles([]); };
  return <div className={`fpick${files.length ? " has" : ""}`}>
    <label className="fpick-btn">
      <input ref={ref} className="fpick-in" type="file" name={name} accept={accept} multiple={multiple} required={required} onChange={e => setFiles([...e.target.files])} />
      {files.length ? <LuRefreshCw /> : <LuUpload />}<span>{files.length ? (multiple ? "Change files" : "Change file") : (label || (multiple ? "Choose files" : "Choose file"))}</span>
    </label>
    {files.length > 0 && <div className="fpick-files">
      {files.slice(0, 4).map((f, i) => <div className="fpick-item" key={i} title={f.name}>
        {urls[i] ? <img src={urls[i]} alt="" /> : <span className="fpick-doc"><LuFileText /><em>{(f.name.split(".").pop() || "").slice(0, 4).toUpperCase()}</em></span>}
        <span className="fpick-meta"><b data-notr>{f.name}</b><span>{kb(f.size)}</span></span></div>)}
      {files.length > 4 && <span className="fpick-more muted small">+{files.length - 4}</span>}
      <button type="button" className="fpick-x" onClick={clear} aria-label="Remove file"><LuX /></button>
    </div>}
  </div>;
}

/* An admin / staff ID as it is shown: Name, badge, Level — then @username — then the job title.
   Admin: the blue Verified badge, name in the same blue. Staff: a badge in the colour of their level, name in that colour. */
export const levelTier = lv => (lv >= 11 ? "ruby" : lv >= 9 ? "violet" : lv >= 7 ? "emerald" : lv >= 5 ? "gold" : lv >= 3 ? "silver" : "bronze");
export function IdName({ name, idc, compact = false, title = true, as: Tag = "span" }) {
  if (!idc) return <Tag className="idn" data-notr>{name}</Tag>;
  // admin: the blue of the Verified badge; staff: the green of the S badge
  return <Tag className={`idn idn-${idc.kind === "admin" ? "admin" : "staff"}${compact ? " compact" : ""}`}>
    <span className="idn-top"><b className="idn-name" data-notr>{name}</b>
      <RoleBadges role={idc.kind} size={compact ? 15 : 17} />
      <span className="idn-lv" title={idc.kind === "staff" ? `${idc.xp} XP` : undefined}>Lv {idc.level}</span></span>
    {idc.username && <span className="idn-user" data-notr>@{idc.username}</span>}
    {title && idc.title && <span className="idn-title">{idc.title}</span>}
  </Tag>;
}
/* level progress for a staff ID: XP into this level, XP needed for the next */
export function XpBar({ idc }) {
  if (!idc || idc.kind !== "staff") return null;
  const pct = idc.need ? Math.min(100, Math.round((idc.into / idc.need) * 100)) : 100;
  return <div className="xpbar idn-staff" title={`${idc.xp} XP in all`}>
    <div className="xpbar-t"><span>Lv {idc.level}</span><span className="num">{idc.into} / {idc.need} XP</span><span>Lv {idc.level + 1}</span></div>
    <div className="xpbar-b"><i style={{ width: `${pct}%` }} /></div>
  </div>;
}

/* admin / staff: who is signed in, at the top of the side menu (name, badge, level, @username, title; XP for staff) */
export function MeCard() {
  const u = me(); if (!u?.idc) return null;
  const photo = u.idc.photo || (store.S.team || []).find(m => m.id === u.memberId)?.photo?.data;
  // a click on one's own name opens one's own Settings
  const open = () => { store.ui.tab[u.role] = "mysettings"; store.ui.railOpen = false; go("dashboard"); touch(); window.scrollTo({ top: 0, behavior: "smooth" }); };
  return <button type="button" className="me-card me-card-link" onClick={open} title="My settings" aria-label={`${u.name}: open my settings`}><Avatar name={u.name} src={photo} size={44} /><span className="me-card-x"><IdName name={u.name} idc={u.idc} /><XpBar idc={u.idc} /></span></button>;
}
