// Admin / staff: own Settings (signature, Day/Night/System, password, language, log out), Office attendance, and the admin's attendance settings.
import React from "react";
import { LuPenLine, LuSunMoon, LuSun, LuMoon, LuMonitor, LuKeyRound, LuLanguages, LuLogOut, LuChevronLeft, LuChevronRight, LuCheck, LuWifi, LuTrash2, LuPlus } from "react-icons/lu";
import { store, user } from "../store.js";
import { act, toast, formData, signOut, confirmBox } from "../actions.js";
import { Field } from "./shared.jsx";
import { RoleBadges } from "../ui.jsx";
import { SignatureBox } from "./Receipts.jsx";
import { savedTheme, setTheme } from "../theme.js";
import { LANGS, getLang, setLang } from "../i18n.js";

const me = () => user(store.S.session);
const staffList = () => store.S.users.filter(u => (u.role === "admin" || u.role === "staff") && u.status !== "deleted").sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === "admin" ? -1 : 1));

export function MySettings() {
  const u = me(), [, setN] = React.useState(0), theme = savedTheme();
  if (!u) return null;
  const pw = async e => { const [d] = formData(e); const form = e.currentTarget; const r = await act("auth.changePassword", d); if (r) form.reset(); };
  return <>
    <div className="ec-head"><div><h2>Settings</h2><p className="muted small">{u.name} · {u.email}</p></div></div>
    <div className="card set-sec"><h3><LuPenLine /> My signature</h3>
      <SignatureBox u={u} title={<>{`My signature (${u.name})`}<RoleBadges role={u.role} size={14} /></>} note={u.signature ? "Shown on receipts as Received by (payments you enter) or Authorized signature (payments you approve)." : "Upload it before you approve payments. It is shown on receipts and salary slips you sign."} /></div>
    <div className="card set-sec"><h3><LuSunMoon /> Day / Night</h3>
      <div className="seg3" role="radiogroup" aria-label="Day or night mode">{[["light", "Day", LuSun], ["dark", "Night", LuMoon], ["", "System", LuMonitor]].map(([k, l, I]) =>
        <button key={l} type="button" role="radio" aria-checked={theme === k} className={theme === k ? "on" : ""} onClick={() => { setTheme(k); setN(n => n + 1); }}><I /> {l}</button>)}</div>
      <p className="small muted mt8">System follows the setting of this phone or computer.</p></div>
    <div className="card set-sec"><h3><LuKeyRound /> Change password</h3>
      <form className="stack12" onSubmit={pw}>
        <Field label="Current password"><input type="password" name="old" required autoComplete="current-password" /></Field>
        <div className="fgrid"><Field label="New password" hint="At least 8 characters"><input type="password" name="pass" minLength={8} required autoComplete="new-password" /></Field>
          <Field label="Confirm new password"><input type="password" name="pass2" minLength={8} required autoComplete="new-password" /></Field></div>
        <div><button className="btn pri" type="submit">Change password</button></div>
      </form></div>
    <div className="card set-sec"><h3><LuLanguages /> Language</h3>
      <select value={getLang()} aria-label="Language" data-notr onChange={async e => { const ok = await setLang(e.target.value); if (!ok) toast("The language could not be loaded. Check your connection and try again."); setN(n => n + 1); }}>
        {LANGS.map(x => <option key={x.code} value={x.code}>{x.name}</option>)}</select></div>
    <div className="card set-sec"><h3><LuLogOut /> Log out</h3><p className="small muted">Sign out of this admin panel on this device.</p><button className="btn danger" onClick={signOut}><LuLogOut /> Log out</button></div>
  </>;
}

/* ---------- Office attendance ---------- */
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const monthDays = ym => { const [y, m] = ym.split("-").map(Number), n = new Date(Date.UTC(y, m, 0)).getUTCDate(); return Array.from({ length: n }, (_, i) => `${ym}-${String(i + 1).padStart(2, "0")}`); };
const dow = d => new Date(d + "T00:00:00Z").getUTCDay();
const monthTitle = ym => new Date(ym + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const timeOf = iso => { try { return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dhaka" }); } catch { return ""; } };
const shift = (ym, k) => { const [y, m] = ym.split("-").map(Number), d = new Date(Date.UTC(y, m - 1 + k, 1)); return d.toISOString().slice(0, 7); };

export function Attendance() {
  const A = store.S.attendance || { today: "", marks: {}, holidays: [] }, u = me(), admin = u?.role === "admin";
  const [ym, setYm] = React.useState((A.today || new Date().toISOString()).slice(0, 7)), [who, setWho] = React.useState(u?.id), [view, setView] = React.useState("me");
  const hol = d => (dow(d) === 5 ? "Weekly holiday" : (A.holidays.find(h => h.date === d) || {}).name || "");
  const since = A.since || "", days = monthDays(ym), work = days.filter(d => !hol(d) && d <= A.today && d >= since);
  const person = user(who) || u, marks = A.marks[person.id] || {};
  const present = work.filter(d => marks[d]).length;
  const tick = (d, off) => act("attendance.tick", { date: d, uid: person.id, off });
  return <>
    <div className="ec-head"><div><h2>Office attendance</h2><p className="muted small">Signing in from the office network ticks the day by itself. You can also tick today yourself; a past day cannot be changed. Friday and government holidays are off.</p></div></div>
    {admin && <nav className="pay-tabs" aria-label="Attendance view"><button className={view === "me" ? "on" : ""} onClick={() => setView("me")}>By person</button><button className={view === "all" ? "on" : ""} onClick={() => setView("all")}>Everyone</button></nav>}
    <div className="card">
      <div className="att-top">
        <button className="btn sm" onClick={() => setYm(shift(ym, -1))} aria-label="Previous month"><LuChevronLeft /></button>
        <h3>{monthTitle(ym)}</h3>
        <button className="btn sm" onClick={() => setYm(shift(ym, 1))} disabled={ym >= (A.today || "").slice(0, 7)} aria-label="Next month"><LuChevronRight /></button>
        <span className="grow" />
        {admin && view === "me" && <select value={person.id} onChange={e => setWho(e.target.value)} aria-label="Person">{staffList().map(x => <option key={x.id} value={x.id}>{`${x.name} (${x.role})`}</option>)}</select>}
        {view === "me" && <span className="vf-pill ok">{`Present ${present} / ${work.length} working days`}</span>}
      </div>
      {view === "all" && admin ? <AllGrid A={A} days={days} hol={hol} /> :
        <ul className="att-list">{days.map(d => {
          const h = hol(d), m = marks[d], today = d === A.today, past = d < A.today, future = d > A.today;
          const canTick = !h && !m && ((today && person.id === u.id) || (admin && !future));
          const before = d < since;
          return <li key={d} className={`att-row${h ? " off" : ""}${today ? " today" : ""}`}>
            <span className="att-day"><b>{DAYS[dow(d)]}</b><span className="muted small">{new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" })}</span></span>
            {h ? <span className="muted small">{h}</span> : <>
              {before && !m ? <span className="muted small">Before attendance started</span> : <><button type="button" className={`att-box${m ? " on" : ""}`} disabled={!canTick} aria-pressed={!!m} aria-label={`${DAYS[dow(d)]} ${d}: ${m ? "present" : "not ticked"}`} onClick={() => canTick && tick(d)}>{m && <LuCheck />}</button>
              <span className="small muted att-note">{m ? `${timeOf(m.at)} · ${m.by === "auto" ? "office network" : m.by === "self" ? (m.office ? "ticked at the office" : "ticked outside the office") : `by ${m.by.replace(/^admin:/, "")}`}` : past && d >= since ? <span className="att-abs">Absent</span> : today ? "Tick to mark present" : ""}</span>
              </>}
              {admin && m && <button type="button" className="btn sm link danger" onClick={() => confirmBox(`Remove the tick of ${person.name} for ${d}?`, () => tick(d, true), "Remove")} aria-label="Remove tick"><LuTrash2 /></button>}
            </>}
          </li>; })}</ul>}
    </div>
  </>;
}
function AllGrid({ A, days, hol }) {
  const people = staffList(), since = A.since || "";
  return <div className="tbl att-grid"><table><thead><tr><th>Name</th>{days.map(d => <th key={d} className={hol(d) ? "off" : ""} title={hol(d) || DAYS[dow(d)]}>{DAYS[dow(d)].slice(0, 2)}<br />{d.slice(8)}</th>)}<th>Present</th></tr></thead><tbody>
    {people.map(p => { const m = A.marks[p.id] || {}; const work = days.filter(d => !hol(d) && d <= A.today && d >= since);
      return <tr key={p.id}><td className="b nowrap">{p.name}</td>{days.map(d => <td key={d} className={hol(d) ? "off" : ""}>{hol(d) ? "" : m[d] ? <LuCheck className="att-ok" aria-label="present" /> : d < A.today && d >= since ? <span className="att-x" aria-label="absent">✕</span> : ""}</td>)}<td className="num b">{`${work.filter(d => m[d]).length}/${work.length}`}</td></tr>; })}
  </tbody></table></div>;
}

/* Admin › Site settings: office IP and government holidays */
export function AttendanceSettings() {
  const [d, setD] = React.useState(""), [n, setN] = React.useState(""), [mip, setMip] = React.useState(""), [blk, setBlk] = React.useState(true);
  const A = store.S.attendance; if (!A?.office) return null;
  const isOff = ip => (A.officeNets || []).includes(ip) || ip === A.officeIp;
  const blockOf = ip => /^\d+\.\d+\.\d+\.\d+$/.test(ip) ? ip.replace(/\.\d+$/, ".x") : "";
  const name = id => user(id)?.name || "?";
  const days = Object.entries(A.ipLog || {});
  return <div className="card mt14">
    <h3><LuWifi /> Office attendance</h3>
    <p className="small"><b>Office IP:</b> <span className="num">{A.officeIp || "not known yet"}</span> · {A.office.mode === "manual" ? `chosen by ${A.office.setBy || "admin"}` : "found automatically; when two or more admin/staff use a new network, you are asked to confirm it"}</p>
    {A.office.candidate && <div className="notice warn mt8"><b>{`New network: ${A.office.candidate.ip}`}</b> · two or more admin/staff are using it ({A.office.candidate.day}). If the office internet changed, confirm it.
      <div className="row6 mt8"><button className="btn sm pri" onClick={() => act("admin.attendance", { op: "officeIp", ip: A.office.candidate.ip })}><LuCheck /> Confirm as the new office IP</button><button className="btn sm" onClick={() => act("admin.attendance", { op: "dismiss" })}>Keep {A.officeIp}</button></div></div>}
    <div className="att-manual mt8">
      <b className="small">Set the office IP by hand</b>
      <div className="row6 mt6"><input type="text" value={mip} onChange={e => setMip(e.target.value.trim())} placeholder="e.g. 165.101.133.33" aria-label="Office IP" className="num" />
        <button className="btn sm pri" onClick={async () => { if (await act("admin.attendance", { op: "officeIp", ip: mip, block: blk, manual: true })) setMip(""); }}><LuCheck /> Set office IP</button></div>
      <label className="check small mt6"><input type="checkbox" checked={blk} onChange={e => setBlk(e.target.checked)} /> {`Also the IPs that go with it${blockOf(mip) ? ` (${blockOf(mip)})` : ""}: the office internet can use several addresses of one block`}</label>
      <p className="muted small">Find the office IP: on the office computer open whatismyip.com (IPv4). IDs signed in from these IPs today are marked present at once.</p>
    </div>
    {A.office.mode === "manual" && <button className="btn sm" onClick={() => act("admin.attendance", { op: "officeIp", mode: "auto" })}>Find it automatically again</button>}
    <h4 className="mt14">Networks admin/staff used</h4>
    {days.length ? days.map(([day, ips]) => <div key={day} className="mt8"><b className="small">{day}</b>
      <div className="tbl"><table><thead><tr><th>IP / network</th><th>People</th><th></th></tr></thead><tbody>
        {Object.entries(ips).sort((a, b) => b[1].length - a[1].length).map(([ip, uids]) => <tr key={ip}><td className="num nowrap">{ip}{isOff(ip) && <span className="vf-pill ok ms6">Office</span>}</td><td>{uids.map(name).join(", ")}</td>
          <td className="nowrap">{!isOff(ip) && <button className="btn sm" onClick={() => act("admin.attendance", { op: "officeIp", ip })}>Use as office IP</button>}</td></tr>)}
      </tbody></table></div></div>) : <p className="muted small">No sign-ins recorded yet. They are recorded from now on.</p>}
    <h4 className="mt14">Government holidays</h4>
    <p className="small muted">Friday is always a weekly holiday. Add the government holidays here.</p>
    <ul className="att-hol">{A.holidays.map(h => <li key={h.date}><span className="num">{h.date}</span> {h.name}<button className="btn sm link danger" onClick={() => act("admin.attendance", { op: "holidayDelete", date: h.date })} aria-label={`Remove ${h.name}`}><LuTrash2 /></button></li>)}</ul>
    <div className="row6 mt8 att-add"><input type="date" value={d} onChange={e => setD(e.target.value)} aria-label="Holiday date" /><input type="text" value={n} onChange={e => setN(e.target.value)} placeholder="e.g. Victory Day" maxLength={80} aria-label="Holiday name" />
      <button className="btn sm" disabled={!d || !n.trim()} onClick={async () => { if (await act("admin.attendance", { op: "holidayAdd", date: d, name: n })) { setD(""); setN(""); } }}><LuPlus /> Add holiday</button></div>
  </div>;
}
