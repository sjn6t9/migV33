import React, { useState, useEffect } from "react";
import { LuTrophy, LuClock, LuActivity, LuChevronLeft, LuChevronRight, LuPlus, LuTrash2, LuX, LuHand } from "react-icons/lu";
import { store, me as meUser } from "../store.js";
import { Avatar } from "../ui.jsx";
import { act, confirmBox, formData } from "../actions.js";
import { t } from "../i18n.js";

/* Overview: how the staff rank by work done and by who reaches the office first — today, this week, this month */
const PERIODS = [["day", "Daily"], ["week", "Weekly"], ["month", "Monthly"]];
const hm = m => { const h = Math.floor(m / 60), mm = String(m % 60).padStart(2, "0"); return `${((h + 11) % 12) + 1}:${mm} ${h < 12 ? "AM" : "PM"}`; };
const Place = ({ n }) => <span className={`sr-place${n <= 3 ? ` p${n}` : ""}`}>{n}</span>;

export function StaffRank() {
  const [period, setPeriod] = useState("day"), [back, setBack] = useState(0), [reload, setReload] = useState(0), [adding, setAdding] = useState(false); const [d, setD] = useState(null); const [err, setErr] = useState("");
  useEffect(() => {
    let live = true; setErr("");
    fetch("/api/act", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "staff.rank", payload: { period, back } }) })
      .then(r => r.json()).then(j => { if (!live) return; if (j.error) setErr(j.error); else setD(j); }).catch(() => live && setErr("Could not load the ranking."));
    return () => { live = false; };
  }, [period, back, reload]);
  const team = store.S.team || [], me = meUser()?.id, admin = meUser()?.role === "admin";
  const addManual = async e => { const [dd] = formData(e); const r = await act("admin.manualWork", dd); if (r) { e.target.reset(); setAdding(false); setReload(x => x + 1); } };
  const delManual = x => confirmBox(`Remove the manual work "${x.note}" (${x.count}) of ${x.name}?`, async () => { if (await act("admin.manualWork", { op: "del", id: x.id })) setReload(n => n + 1); }, "Remove");
  const photo = r => team.find(m => m.id === r.memberId)?.photo?.data;
  const rows = d?.period === period && d?.back === back ? d.rows : null;
  const isToday = period === "day" && back === 0;
  const fmt = (x, o) => new Date(x + "T00:00:00Z").toLocaleDateString("en-GB", { timeZone: "UTC", ...o });
  const label = !d || d.period !== period || d.back !== back ? "…" : period === "day" ? `${back === 0 ? `${t("Today")} · ` : back === 1 ? `${t("Yesterday")} · ` : ""}${fmt(d.from, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}`
    : period === "week" ? `${fmt(d.from, { day: "numeric", month: "short" })} – ${fmt(d.to, { day: "numeric", month: "short", year: "numeric" })}` : fmt(d.from, { month: "long", year: "numeric" });
  const PREV = { day: "Previous day", week: "Previous week", month: "Previous month" }[period], NEXT = { day: "Next day", week: "Next week", month: "Next month" }[period];
  const work = rows ? [...rows].sort((a, b) => b.work - a.work || a.name.localeCompare(b.name)) : [];
  const top = Math.max(1, ...work.map(r => r.work));
  const arrive = rows ? [...rows].filter(r => r.avg != null).sort((a, b) => a.avg - b.avg || b.days - a.days) : [];
  const away = rows ? rows.filter(r => r.avg == null) : [];
  const Who = ({ r }) => <div className="sr-who"><Avatar name={r.name} src={photo(r)} size={36} /><div className="sr-nm"><b data-notr>{r.name}</b>{r.id === me ? <span className="sr-you">{t("You")}</span> : null}{r.title ? <span className="muted small">{t(r.title)}</span> : null}</div></div>;
  return (
    <section className="card sr mt16 mb16" aria-labelledby="sr-h">
      <div className="sr-head">
        <h3 id="sr-h"><LuTrophy /> Staff ranking</h3>
        <div className="sr-seg" role="tablist" aria-label="Period">{PERIODS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={period === k} className={period === k ? "on" : ""} onClick={() => { setPeriod(k); setBack(0); }}>{l}</button>)}</div>
      </div>
      <div className="sr-nav">
        <button type="button" className="btn sm" onClick={() => setBack(b => b + 1)}><LuChevronLeft /> {PREV}</button>
        <b className="sr-when">{label}</b>
        <button type="button" className="btn sm" disabled={back === 0} onClick={() => setBack(b => Math.max(0, b - 1))}>{NEXT} <LuChevronRight /></button>
      </div>
      {err ? <div className="notice mt12">{err}</div> : !rows ? <p className="muted mt12">Loading…</p> : !rows.length ? <p className="muted mt12">No staff IDs yet.</p> :
      <div className="sr-grid">
        <div className="sr-col">
          <h4><LuActivity /> Work done</h4>
          <p className="muted small">Changes each staff ID made in the panel (files, payments, entries…). Sign-ins are not counted.</p>
          <ol className="sr-list">{work.map((r, i) => <li key={r.id} className={r.id === me ? "me" : ""}>
            <Place n={i + 1} /><Who r={r} />
            <div className="sr-val"><b className="num">{r.work}</b><span className="muted small">{r.work === 1 ? t("task") : t("tasks")}</span></div>
            <div className="sr-bar"><i style={{ width: `${(r.work / top) * 100}%` }} /></div>
            {r.areas.length > 0 && <div className="sr-areas muted small">{r.areas.map(([a, n]) => `${t(a)} ${n}`).join(" · ")}{r.manual > 0 ? ` · ${t("incl.")} ${r.manual} ${t("manual")}` : ""}</div>}
          </li>)}</ol>
        </div>
        <div className="sr-col">
          <h4><LuClock /> First to the office</h4>
          <p className="muted small">{period === "day" ? (isToday ? "Time each staff member reached the office today." : "Time each staff member reached the office that day.") : "Average arrival time on the days they came to the office."}</p>
          {arrive.length ? <ol className="sr-list">{arrive.map((r, i) => <li key={r.id} className={r.id === me ? "me" : ""}>
            <Place n={i + 1} /><Who r={r} />
            <div className="sr-val"><b className="num">{hm(r.avg)}</b><span className="muted small">{period === "day" ? t("arrived") : `${t("average")} · ${r.days} ${r.days === 1 ? t("day") : t("days")}`}</span></div>
            {period !== "day" && <div className="sr-areas muted small">{t("Earliest")} {hm(r.first)}</div>}
          </li>)}</ol> : <p className="muted mt8">{isToday ? "Nobody has reached the office yet today." : "No office arrivals in this period."}</p>}
          {away.length > 0 && <p className="muted small mt8">{t("Not at the office")}{isToday ? ` ${t("today")}` : ""}: <span data-notr>{away.map(r => r.name).join(", ")}</span></p>}
        </div>
      </div>}
      {rows && (admin || d.manual?.length > 0) && <div className="sr-manual">
        <div className="row between"><h4><LuHand /> Manual work</h4>{admin && !adding && <button type="button" className="btn sm" onClick={() => setAdding(true)}><LuPlus /> Add manual work</button>}</div>
        <p className="muted small">Work done by hand, outside the panel (e.g. bank or embassy visits, phone follow-ups). An admin adds it here and it counts in Work done.</p>
        {admin && adding && <form className="sr-form" onSubmit={addManual}>
          <label className="f">Staff<select name="uid" required defaultValue=""><option value="" disabled>Choose…</option>{rows.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
          <label className="f">Date<input type="date" name="date" required defaultValue={d.to} /></label>
          <label className="f">Work type<select name="area" defaultValue="Other">{(d.areas || ["Other"]).map(a => <option key={a} value={a}>{a}</option>)}</select></label>
          <label className="f">How many<input type="number" name="count" min={1} max={500} defaultValue={1} required inputMode="numeric" /></label>
          <label className="f sr-note">What was done<input type="text" name="note" required minLength={2} maxLength={200} placeholder="e.g. Submitted 5 files at the BMET office" /></label>
          <div className="row sr-btns"><button className="btn pri" type="submit" disabled={store.ui.busy}><LuPlus /> Add</button><button type="button" className="btn" onClick={() => setAdding(false)}><LuX /> Cancel</button></div>
        </form>}
        {d.manual?.length > 0 ? <ul className="sr-mlist">{d.manual.map(x => <li key={x.id}>
          <span className="sr-mdate num">{new Date(x.date + "T00:00:00Z").toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short" })}</span>
          <span className="sr-mtext"><b data-notr>{x.name}</b> · <span data-notr>{x.note}</span><span className="muted small"> · {t(x.area)}{x.byName ? ` · ${t("added by")} ${x.byName}` : ""}</span></span>
          <b className="num sr-mcount">+{x.count}</b>
          {admin && <button type="button" className="btn sm link danger" onClick={() => delManual(x)} aria-label="Remove"><LuTrash2 /></button>}
        </li>)}</ul> : <p className="muted small">No manual work in this period.</p>}
      </div>}
    </section>
  );
}
