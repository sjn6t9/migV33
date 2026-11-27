import React, { useState, useEffect } from "react";
import { LuTrophy, LuClock, LuActivity } from "react-icons/lu";
import { store } from "../store.js";
import { Avatar } from "../ui.jsx";
import { t } from "../i18n.js";

/* Overview: how the staff rank by work done and by who reaches the office first — today, this week, this month */
const PERIODS = [["day", "Today"], ["week", "This week"], ["month", "This month"]];
const hm = m => { const h = Math.floor(m / 60), mm = String(m % 60).padStart(2, "0"); return `${((h + 11) % 12) + 1}:${mm} ${h < 12 ? "AM" : "PM"}`; };
const Place = ({ n }) => <span className={`sr-place${n <= 3 ? ` p${n}` : ""}`}>{n}</span>;

export function StaffRank() {
  const [period, setPeriod] = useState("day"); const [d, setD] = useState(null); const [err, setErr] = useState("");
  useEffect(() => {
    let live = true; setErr("");
    fetch("/api/act", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "staff.rank", payload: { period } }) })
      .then(r => r.json()).then(j => { if (!live) return; if (j.error) setErr(j.error); else setD(j); }).catch(() => live && setErr("Could not load the ranking."));
    return () => { live = false; };
  }, [period]);
  const team = store.S.team || [], me = store.S.me?.id;
  const photo = r => team.find(m => m.id === r.memberId)?.photo?.data;
  const rows = d?.period === period ? d.rows : null;
  const work = rows ? [...rows].sort((a, b) => b.work - a.work || a.name.localeCompare(b.name)) : [];
  const top = Math.max(1, ...work.map(r => r.work));
  const arrive = rows ? [...rows].filter(r => r.avg != null).sort((a, b) => a.avg - b.avg || b.days - a.days) : [];
  const away = rows ? rows.filter(r => r.avg == null) : [];
  const Who = ({ r }) => <div className="sr-who"><Avatar name={r.name} src={photo(r)} size={36} /><div className="sr-nm"><b data-notr>{r.name}</b>{r.id === me ? <span className="sr-you">{t("You")}</span> : null}{r.title ? <span className="muted small">{t(r.title)}</span> : null}</div></div>;
  return (
    <section className="card sr mt16 mb16" aria-labelledby="sr-h">
      <div className="sr-head">
        <h3 id="sr-h"><LuTrophy /> Staff ranking</h3>
        <div className="sr-seg" role="tablist" aria-label="Period">{PERIODS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={period === k} className={period === k ? "on" : ""} onClick={() => setPeriod(k)}>{l}</button>)}</div>
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
            {r.areas.length > 0 && <div className="sr-areas muted small">{r.areas.map(([a, n]) => `${t(a)} ${n}`).join(" · ")}</div>}
          </li>)}</ol>
        </div>
        <div className="sr-col">
          <h4><LuClock /> First to the office</h4>
          <p className="muted small">{period === "day" ? "Time each staff member reached the office today." : "Average arrival time on the days they came to the office."}</p>
          {arrive.length ? <ol className="sr-list">{arrive.map((r, i) => <li key={r.id} className={r.id === me ? "me" : ""}>
            <Place n={i + 1} /><Who r={r} />
            <div className="sr-val"><b className="num">{hm(r.avg)}</b><span className="muted small">{period === "day" ? t("arrived") : `${t("average")} · ${r.days} ${r.days === 1 ? t("day") : t("days")}`}</span></div>
            {period !== "day" && <div className="sr-areas muted small">{t("Earliest")} {hm(r.first)}</div>}
          </li>)}</ol> : <p className="muted mt8">{period === "day" ? "Nobody has reached the office yet today." : "No office arrivals in this period."}</p>}
          {away.length > 0 && <p className="muted small mt8">{t("Not at the office")}{period === "day" ? ` ${t("today")}` : ""}: <span data-notr>{away.map(r => r.name).join(", ")}</span></p>}
        </div>
      </div>}
    </section>
  );
}
