// Agent panel › Job applications: the photocards (PNG) of the jobs the agency posted, as a slideshow.
// A card opens the job: its details, and the agent applies their workers from there.
import React from "react";
import { LuChevronLeft, LuChevronRight, LuSend, LuMapPin, LuLoaderCircle } from "react-icons/lu";
import { store, live, money, num } from "../store.js";
import { act, toast } from "../actions.js";
import { ModalFrame } from "../ui.jsx";
import { makeCard } from "../Share.jsx";

const made = new Map(); // job id + update time → object URL of a card drawn in this browser
function useCard(j) {
  const stored = j.card?.id ? `/api/files/${j.card.id}` : "";
  const key = `${j.id}:${j.updatedAt || j.createdAt || ""}`;
  const [src, setSrc] = React.useState(stored || made.get(key) || "");
  React.useEffect(() => {
    if (stored || made.get(key)) return; let alive = true;
    makeCard(j).then(b => { const u = URL.createObjectURL(b); made.set(key, u); if (alive) setSrc(u); }).catch(() => {});
    return () => { alive = false; };
  }, [key, stored]);
  return src;
}
function Card({ j, onOpen }) {
  const src = useCard(j);
  return <button type="button" className="js-card" onClick={() => onOpen(j.id)} aria-label={`Open ${j.title}`}>
    {src ? <img src={src} alt={`${j.title} · ${j.city}, ${j.country}`} loading="lazy" /> : <span className="js-wait"><LuLoaderCircle className="spin" /></span>}
  </button>;
}

export function JobSlides({ workers, apps, active }) {
  const L = live().filter(j => j.postedBy || !j.employerId); // jobs the agency posted itself (Admin / Staff panel)
  const [i, setI] = React.useState(0), [open, setOpen] = React.useState(""), [pause, setPause] = React.useState(false);
  const n = L.length, cur = n ? ((i % n) + n) % n : 0;
  React.useEffect(() => { if (n < 2 || pause || open) return; const t = setInterval(() => setI(x => x + 1), 4500); return () => clearInterval(t); }, [n, pause, open]);
  const touch = React.useRef(null);
  if (!n) return null;
  // two cards side by side on wide screens; the visible pair moves one card at a time
  const shown = n === 1 ? [L[0]] : [L[cur], L[(cur + 1) % n]];
  return <div className="card js-wrap">
    <div className="row between"><h3 className="mb6">Job circulars</h3><span className="muted small">Tap a card to see the job and apply</span></div>
    <div className="js-stage" onMouseEnter={() => setPause(true)} onMouseLeave={() => setPause(false)}
      onTouchStart={e => { touch.current = e.touches[0].clientX; setPause(true); }}
      onTouchEnd={e => { const d = e.changedTouches[0].clientX - (touch.current ?? 0); if (Math.abs(d) > 40) setI(x => x + (d < 0 ? 1 : -1)); setPause(false); }}>
      {n > 1 && <button type="button" className="js-nav prev" onClick={() => setI(x => x - 1)} aria-label="Previous job"><LuChevronLeft /></button>}
      <div className={`js-track${shown.length > 1 ? " two" : ""}`}>{shown.map((j, k) => <div key={j.id} className={k ? "js-second" : ""}><Card j={j} onOpen={setOpen} /></div>)}</div>
      {n > 1 && <button type="button" className="js-nav next" onClick={() => setI(x => x + 1)} aria-label="Next job"><LuChevronRight /></button>}
    </div>
    {n > 1 && <div className="js-dots" role="tablist" aria-label="Job circulars">{L.map((j, k) => <button key={j.id} type="button" className={k === cur ? "on" : ""} aria-label={j.title} aria-selected={k === cur} onClick={() => setI(k)} />)}</div>}
    {open && <JobView id={open} workers={workers} apps={apps} active={active} onClose={() => setOpen("")} />}
  </div>;
}

function JobView({ id, workers, apps, active, onClose }) {
  const j = live().find(x => x.id === id); const src = useCard(j || { id });
  const [busy, setBusy] = React.useState(false);
  if (!j) return null;
  const already = new Set(apps.filter(a => a.jobId === j.id).map(a => a.workerId));
  const hourly = j.period === "hour";
  const facts = [["Location", `${j.city}, ${j.country}`], ["Salary", `${money(j.salaryMin, j.currency)} – ${num(j.salaryMax)}${hourly ? " /hour" : " /month"}`], ["Industry", j.category], ["Job type", j.type], ["Contract", j.contract ? `${j.contract} year(s)` : ""], ["Experience", j.experience ? `${j.experience}+ years` : "Not required"], ["Age", j.age], ["Vacancies", j.vacancies], ["Apply by", j.deadline ? new Date(j.deadline).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""]].filter(([, v]) => v);
  const submit = async e => {
    e.preventDefault(); const ids = new FormData(e.currentTarget).getAll("workers");
    if (!active) return toast("Your account must be approved first.");
    if (!ids.length) return toast("Select at least one worker.");
    setBusy(true); const r = await act("agent.applyJob", { jobId: j.id, workerIds: ids }); setBusy(false); if (r) onClose();
  };
  return <ModalFrame onClose={onClose} wide className="js-modal">
    <div className="js-view">
      <div className="js-img">{src ? <img src={src} alt={j.title} /> : <span className="js-wait"><LuLoaderCircle className="spin" /></span>}</div>
      <div className="js-info">
        <h3>{j.title}</h3><p className="muted small"><LuMapPin /> {`${j.city}, ${j.country}`}</p>
        <table className="mt8"><tbody>{facts.map(([k, v]) => <tr key={k}><th>{k}</th><td data-notr={k === "Salary" || k === "Location" ? true : undefined}>{v}</td></tr>)}</tbody></table>
        {j.description && <><h4 className="sub">Job description</h4><p className="lines small">{j.description}</p></>}
        {j.requirements && <><h4 className="sub">Requirements</h4><p className="lines small">{j.requirements}</p></>}
        {j.benefits?.length > 0 && <><h4 className="sub">Benefits</h4><div className="row tight">{j.benefits.map(b => <span key={b} className="chip">{b}</span>)}</div></>}
        <form className="mt14 js-apply" onSubmit={submit}>
          <h4>Apply with my workers</h4>
          {workers.length ? <div className="grid checkgrid">{workers.map(w => <label key={w.id} className={`check${already.has(w.id) ? " dim" : ""}`}><input type="checkbox" name="workers" value={w.id} disabled={already.has(w.id)} /> {w.name} <span className="muted small">{w.trade}{already.has(w.id) ? " · already applied" : ""}</span></label>)}</div>
            : <p className="muted small">Add workers first (My workers), then apply them here.</p>}
          {workers.length > 0 && <button className="btn pri mt8" disabled={busy || !active}><LuSend /> {busy ? "Submitting…" : "Apply"}</button>}
        </form>
      </div>
    </div>
  </ModalFrame>;
}
