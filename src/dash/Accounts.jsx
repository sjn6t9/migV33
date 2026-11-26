// Payments & receipts › Main account (office cash book) and Salary accounts (pay admin / staff, receipt with QR code).
import React from "react";
import { LuPencil, LuSearch, LuPlus, LuX, LuTrash2, LuEye, LuImage, LuFileText, LuMail, LuBan, LuBanknote, LuHistory, LuCheck, LuQrCode, LuExternalLink, LuPrinter, LuCalendarDays, LuChevronLeft, LuChevronRight, LuRotateCcw, LuSheet } from "react-icons/lu";
import { store, user, clPerson } from "../store.js";
import { act, openModal, closeModal, toast, confirmBox } from "../actions.js";
import { Field } from "./shared.jsx";
import { Empty, RoleBadges } from "../ui.jsx";
import { Statement } from "./Statement.jsx";
import { PassportPick, ppLine } from "./Passports.jsx";
import { METHODS, MFS, BANKS, channelsFor } from "../banks.js";
import { xlsx, drawSalary, salaryPng, salaryPdf, salaryPdfBlob, salaryUrl, monthName, tk, rDate, takaWords } from "../receipt.js";

const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const key = () => Math.random().toString(36).slice(2);
const way = (m, c) => { const x = String(c || "").replace(/\s*\(.*\)\s*$/, "") || String(m || "").split("·").pop().trim().replace(/\s*\(.*\)\s*$/, ""); return (x || "Cash").toUpperCase(); };
const fdt = iso => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/* method select used by both forms: Cash, mobile banking services, banks, cheque, and (main account only) the MD / Directors / Chairman */
const LEAD0 = [{ k: "md", name: "Sujon Islam", title: "Managing Director" }, { k: "director", name: "Masud Rana", title: "Director" }, { k: "chairman", name: "Md. Al Mamun Khan", title: "Chairman" }];
const leadersList = () => store.S.office?.leaders || (store.S.myMoney?.me ? [store.S.myMoney.me] : LEAD0);
function Ways() { return <><option>Cash</option>
  <optgroup label="Mobile banking">{MFS.map(x => <option key={x} value={`Mobile banking · ${x}`}>{x}</option>)}</optgroup>
  <optgroup label="Bank">{BANKS.map(x => <option key={x} value={`Bank transfer · ${x}`}>{x}</option>)}</optgroup><option value="Cheque">Cheque</option></>; }
/* "Person · md | Bank transfer · Sonali Bank PLC" ⇄ { k, via } */
const splitP = v => { const m = /^Person · ([a-z]+)(?: \| (.+))?$/.exec(String(v || "")); return m ? { k: m[1], via: m[2] || "Cash" } : null; };
/* method select used by both forms: Cash, mobile banking services, banks, cheque, and (main account only) the MD / Director / Chairman with the bank the money went to */
function PaidBy({ value, onChange, people }) {
  const L = people ? leadersList() : [], P = splitP(value);
  const main = <select value={P ? `Person · ${P.k}` : value} onChange={e => { const v = e.target.value; onChange(v.startsWith("Person · ") ? `${v} | ${P?.via && P.via !== "Cash" ? P.via : "Bank transfer · " + BANKS[0]}` : v); }}>
    {L.length > 0 && <optgroup label="Managing Director / Director / Chairman">{L.map(x => <option key={x.k} value={`Person · ${x.k}`}>{`${x.name} · ${x.title}`}</option>)}</optgroup>}
    <Ways /></select>;
  if (!P) return main;
  return <div className="stack6">{main}
    <label className="pb-via"><span className="muted small">{`Which account of ${(L.find(x => x.k === P.k) || {}).name || "theirs"}?`}</span>
      <select value={P.via} onChange={e => onChange(`Person · ${P.k} | ${e.target.value}`)} aria-label="Their bank or wallet"><option value="Cash">Cash in hand</option>
        <optgroup label="Bank">{BANKS.map(x => <option key={x} value={`Bank transfer · ${x}`}>{x}</option>)}</optgroup>
        <optgroup label="Mobile banking">{MFS.map(x => <option key={x} value={`Mobile banking · ${x}`}>{x}</option>)}</optgroup><option value="Cheque">Cheque</option></select></label></div>;
}

/* where a sum of money is held: office cash, a bank, a mobile wallet or a person (MD / Director / Chairman, and which of their accounts) */
export function holderOf(method) {
  const m = String(method || "Cash").trim(), P = splitP(m);
  if (P) { const via = holderOf(P.via); return { key: `p:${P.k}`, kind: "person", k: P.k, via: via.kind === "cash" ? "Cash in hand" : via.name }; }
  const name = m.split("·").slice(1).join("·").replace(/\s*\(.*\)\s*$/, "").trim();
  if (m.startsWith("Mobile banking")) return { key: `w:${name || "Mobile banking"}`, kind: "wallet", name: name || "Mobile banking" };
  if (m.startsWith("Bank transfer")) return { key: `b:${name || "Bank"}`, kind: "bank", name: name || "Bank (not named)" };
  if (m.startsWith("Cheque")) return { key: "b:Cheque", kind: "bank", name: "Cheques (not yet deposited)" };
  return { key: "cash", kind: "cash", name: "Cash in office" };
}
const personName = k => { const l = leadersList().find(x => x.k === k) || LEAD0.find(x => x.k === k); return l ? `${l.name} · ${l.title}` : "Director"; };
/* a boss's account (MD / Director / Chairman) is one running balance with the office:
   below 0 = the boss gave the office more than the office money they hold (the office owes them — an advance);
   above 0 = they hold office money (e.g. agents paid them). Agent money paid to a boss first pays back the office's debt to them. */
export const bossWord = (b, you) => (b < -0.004 ? (you ? "The office owes you (your advance)" : "Advance to the office · office owes") : b > 0.004 ? (you ? "Office money with you" : "Office money with them") : "Settled");
const bossCls = b => (b < -0.004 ? "adv" : b > 0.004 ? "with" : ""); // green: the office owes them; red: they hold office money
const holderName = h => (h.kind === "person" ? personName(h.k) : h.name);
const methodText = m => { const P = splitP(m); return P ? `${personName(P.k)} (${holderOf(m).via})` : m || "Cash"; };
const okEntry = e => (e.status || "accepted") === "accepted";
/* the money movements each entry makes (+ in, − out) */
const moves = e => e.type === "transfer" ? [{ h: holderOf(e.from), amount: -e.amount }, { h: holderOf(e.to), amount: e.amount }] : [{ h: holderOf(e.method), amount: e.type === "out" ? -e.amount : e.amount }];
function holdings(list) {
  const map = new Map();
  for (const e of list) for (const m of moves(e)) {
    const x = map.get(m.h.key) || { ...m.h, in: 0, out: 0, n: 0, vias: {} }; delete x.via;
    if (m.amount > 0) x.in += m.amount; else x.out -= m.amount; x.n++;
    if (m.h.via) { const v = x.vias[m.h.via] || (x.vias[m.h.via] = { in: 0, out: 0 }); if (m.amount > 0) v.in += m.amount; else v.out -= m.amount; }
    map.set(m.h.key, x);
  }
  return [...map.values()].map(x => ({ ...x, bal: x.in - x.out }));
}
/* statement rows as seen from one holder (or the whole office when key is empty) */
function officeRows(list, key, pendingToo) {
  const out = [];
  for (const e of list) {
    const pend = e.status === "pending", sub = e.auto ? `Added automatically · ${AUTO[e.auto]}` : [e.by && `Entered by ${e.by}`, pend && "Waiting for confirmation", e.status === "rejected" && `Not confirmed by ${e.rejected?.by || "director"}${e.rejected?.text ? `: ${e.rejected.text}` : ""}`].filter(Boolean).join(" · ");
    if (e.status === "rejected" && !pendingToo) continue;
    if (e.type === "transfer") {
      if (!key) { // the office's own book: only money that moves between the office and the MD / Directors / Chairman
        const f = holderOf(e.from), t = holderOf(e.to); if ((f.kind === "person") === (t.kind === "person")) continue;
        const inn = f.kind === "person", h = inn ? t : f;
        out.push({ id: e.id, date: e.date, details: `${e.desc} — ${inn ? "received from" : "given to"} ${personName((inn ? f : t).k)}`, ref: e.ref, at: e.at, rate: way(inn ? e.to : e.from), debit: inn ? e.amount : 0, credit: inn ? 0 : e.amount, manual: !e.auto, pending: pend || e.status === "rejected", sub, e });
        continue;
      }
      const m = moves(e).find(x => x.h.key === key); if (!m) continue;
      out.push({ id: e.id, date: e.date, details: `${e.desc} — moved ${m.amount > 0 ? `from ${methodText(e.from)}` : `to ${methodText(e.to)}`}`, ref: e.ref, at: e.at, rate: m.h.via ? m.h.via.toUpperCase() : "TRANSFER", debit: m.amount > 0 ? e.amount : 0, credit: m.amount < 0 ? e.amount : 0, manual: !e.auto, pending: pend || e.status === "rejected", sub, e });
      continue;
    }
    const h = holderOf(e.method); if (key ? h.key !== key : h.kind === "person") continue; // money with the MD / Directors / Chairman is theirs until they give it to the office
    out.push({ id: e.id, date: e.date, at: e.at, details: e.desc, ref: e.ref, rate: h.kind === "person" ? h.via.toUpperCase() : way(e.method), debit: e.type === "in" ? e.amount : 0, credit: e.type === "out" ? e.amount : 0, manual: !e.auto, auto: e.auto, pending: pend || e.status === "rejected",
      sub: [h.kind === "person" && !key && `With ${personName(h.k)}`, sub].filter(Boolean).join(" · "), e });
  }
  return out;
}

/* ---------------- Main account ---------------- */
const AUTO = { receipt: "Money receipt", agent: "Agent payment", salary: "Salary" };
export function OfficeAccount() {
  const O = store.S.office || { entries: [], auto: [] };
  const [key, setKey] = React.useState("");
  const all = [...O.entries, ...O.auto], ok = all.filter(okEntry), H = holdings(ok);
  const waiting = O.entries.filter(e => e.status === "pending");
  const sel = key && (H.find(h => h.key === key) || { key, ...(key.startsWith("p:") ? { kind: "person", k: key.slice(2) } : { name: key.slice(2) }) });
  const rows = officeRows(key ? all : all.filter(e => okEntry(e) || e.status === "pending"), key, false);
  // daily view: today first; Previous day / Next day up to 30 days back; Statement shows every date
  const today = dhakaToday(), first = addDays(today, -30), [day, setDay] = React.useState(today), [full, setFull] = React.useState(false);
  const isAdmin = user(store.S.session)?.role === "admin";
  return <>
    <div className="ec-head"><div><h2>Main account</h2><p className="muted small">The office cash book, run by the Account Manager. Approved money receipts, agent payments to the office and salaries are added automatically. Money an agent pays to the Managing Director, a Director or the Chairman goes to their own account (below) and comes into the main account only when they give it to the office. Money they take from the office goes out of the main account.</p></div></div>
    <Holdings H={H} waiting={waiting} sel={key} onPick={k => setKey(k === key ? "" : k)} />
    <div className="card">
      {sel && <div className="row6 mb8"><span className="ec-badge">{`Showing: ${holderName(sel)}`}</span><button className="btn sm link" onClick={() => setKey("")}><LuX /> Show the whole main account</button></div>}
      <div className="day-bar">
        {full ? <><b>Statement · all dates</b><span className="grow" /><button className="btn sm" onClick={() => setFull(false)}><LuCalendarDays /> Daily view</button></>
          : <><button className="btn sm" disabled={day <= first} onClick={() => setDay(addDays(day, -1))}><LuChevronLeft /> Previous day</button>
            <span className="day-now"><b>{dayLabel(day)}</b>{day === today && <span className="ec-badge">Today</span>}</span>
            <button className="btn sm" disabled={day >= today} onClick={() => setDay(addDays(day, 1))}>Next day <LuChevronRight /></button>
            <span className="grow" />{day !== today && <button className="btn sm link" onClick={() => setDay(today)}>Today</button>}
            <button className="btn sm pri" onClick={() => setFull(true)}><LuFileText /> Statement</button></>}
      </div>
      <Statement key={full ? "all" : day} day={full ? "" : day} title={`Mam & Mam Overseas Ltd. · ${sel ? `Main account · ${holderName(sel)}` : "Main account"}`} kind="MAIN ACCOUNT" cash times heads={["Money in", "Money out"]} rows={rows} balText={sel?.kind === "person" ? b => bossWord(b) : undefined}
        empty={sel ? "No entries for this one yet." : "No entries yet. Add money in or money out below."}
        actions={r => r.manual ? <button className="btn sm link danger" aria-label="Delete entry" onClick={() => confirmBox("Delete this entry from the main account?", () => act("admin.office", { op: "delete", id: r.id }), "Delete")}><LuTrash2 /></button> : null} />
      <OfficeForm />
    </div>
    {isAdmin && <div className="card reset-box"><h4>Start the accounts again</h4>
      <p className="muted small">{`Removes every money receipt and every main account entry, and the main account starts from today. Money receipt numbers start again from 0001. Agents' own accounts (due, payments) are not changed. A copy of what is removed is kept on the server.${O.from ? ` Last started again on ${dayLabel(O.from)}.` : ""}`}</p>
      <button className="btn danger sm" onClick={resetBooks}><LuRotateCcw /> Reset money receipts &amp; main account</button></div>}
  </>;
}
const dhakaToday = () => new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const dayLabel = d => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
function resetBooks() {
  const v = window.prompt("This removes every money receipt and every main account entry. It cannot be undone here.\n\nType RESET to confirm.");
  if (v == null) return; if (v.trim().toUpperCase() !== "RESET") return toast("Not reset: type RESET to confirm.");
  act("admin.office", { op: "reset", confirm: "RESET" });
}
/* summary under the main account: cash in office, each bank by name, each wallet, and money with the MD / Directors / Chairman */
function Holdings({ H, waiting, sel, onPick }) {
  const L = leadersList(), cash = H.find(h => h.kind === "cash") || { key: "cash", kind: "cash", name: "Cash in office", in: 0, out: 0, bal: 0 };
  const banks = H.filter(h => h.kind === "bank").sort((a, b) => b.bal - a.bal), wallets = H.filter(h => h.kind === "wallet").sort((a, b) => b.bal - a.bal);
  const people = [...L.map(l => H.find(h => h.key === `p:${l.k}`) || { key: `p:${l.k}`, kind: "person", k: l.k, in: 0, out: 0, bal: 0, vias: {} }), ...H.filter(h => h.kind === "person" && !L.some(l => `p:${l.k}` === h.key))];
  const wait = k => waiting.filter(e => e.people?.includes(k) && !e.accepted?.includes(k));
  const total = H.filter(h => h.kind !== "person").reduce((t, h) => t + h.bal, 0), sum = l => l.reduce((t, h) => t + h.bal, 0); // the MD / Directors / Chairman keep their own accounts
  const Row = ({ h, extra }) => <><tr className={`hold-row${sel === h.key ? " on" : ""}`} onClick={() => onPick(h.key)} title="Show these entries"><td className="b">{holderName(h)}{extra}</td><td className="num">{tk(h.in)}</td><td className="num">{tk(h.out)}</td><td className={`num b${h.bal < 0 && h.kind !== "person" ? " neg" : ""}${h.kind === "person" ? ` boss-amt ${bossCls(h.bal)}` : ""}`}>{h.kind === "person" ? <>{tk(Math.abs(h.bal))}<span className={`hold-word ${h.bal < -0.004 ? "adv" : h.bal > 0.004 ? "with" : ""}`}>{bossWord(h.bal)}</span></> : tk(h.bal)}</td></tr>
    {Object.entries(h.vias || {}).sort((a, b) => (b[1].in - b[1].out) - (a[1].in - a[1].out)).map(([n, v]) => <tr key={n} className="hold-sub"><td>{`↳ ${n}`}</td><td className="num">{tk(v.in)}</td><td className="num">{tk(v.out)}</td><td className="num">{tk(v.in - v.out)}</td></tr>)}</>;
  const Group = ({ title, list, none }) => <div className="hold-group"><h4>{title}<span className="muted small ms6">{`${tk(sum(list))} BDT`}</span></h4>
    {list.length ? <div className="tbl hold-tbl"><table><thead><tr><th>Name</th><th className="r">Money in</th><th className="r">Money out</th><th className="r">Balance</th></tr></thead><tbody>{list.map(h => <Row key={h.key} h={h} extra={h.kind === "person" && <>{wait(h.k).length > 0 && <span className="ec-badge mr-wait ms6">{`${wait(h.k).length} waiting`}</span>}{L.find(l => l.k === h.k && !l.uid) && <span className="muted small ms6">No admin ID chosen</span>}</>} />)}</tbody></table></div> : <p className="muted small">{none}</p>}</div>;
  return <div className="card hold">
    <div className="hold-top">
      <button type="button" className={`hold-tile${sel === "cash" ? " on" : ""}`} onClick={() => onPick("cash")}><span className="muted small">Cash in office (with me)</span><b>{`${tk(cash.bal)} BDT`}</b></button>
      <div className="hold-tile"><span className="muted small">In banks</span><b>{`${tk(sum(banks))} BDT`}</b></div>
      <div className="hold-tile"><span className="muted small">In mobile wallets</span><b>{`${tk(sum(wallets))} BDT`}</b></div>
      <div className="hold-tile tot"><span className="muted small">Main account total</span><b>{`${tk(total)} BDT`}</b></div>
      <div className="hold-tile sep"><span className="muted small">MD / Directors / Chairman (separate)</span><b className={`boss-amt ${bossCls(sum(people))}`}>{`${tk(Math.abs(sum(people)))} BDT`}</b><span className={`hold-word ${sum(people) < -0.004 ? "adv" : sum(people) > 0.004 ? "with" : ""}`}>{bossWord(sum(people))}</span></div>
    </div>
    <Group title="Banks" list={banks} none="No money in any bank yet." />
    <Group title="Mobile wallets" list={wallets} none="No money in any mobile wallet yet." />
    <Group title="Managing Director, Directors and Chairman (their own accounts, not in the main account)" list={people} none="" />
    <p className="muted small">Each of them has one running account with the office. Money they give the office while they hold no office money is an advance: the office owes it to them. Agent money paid to them then lowers what the office owes; once the office owes nothing, agent money paid to them is office money with them and adds to their account.</p>
    <LeaderIds L={L} />
    {waiting.length > 0 && <p className="muted small mt8">{`${waiting.length} ${waiting.length > 1 ? "entries are" : "entry is"} waiting for confirmation. They are shown dimmed and are not counted until confirmed.`}</p>}
    <p className="muted small mt8">Click a row to see only its entries.</p>
  </div>;
}
/* which admin ID gets the confirmation requests of each leader (admins only) */
function LeaderIds({ L }) {
  const me = user(store.S.session); if (me?.role !== "admin") return L.some(l => !l.uid) ? <p className="muted small">{`An admin must choose the admin ID of ${L.filter(l => !l.uid).map(l => l.name).join(", ")} before they can confirm.`}</p> : null;
  return <div className="hold-ids"><h4>Confirmation requests go to</h4>
    {L.map(l => <label key={l.k} className="hold-id"><span><b>{l.name}</b><span className="muted small">{` · ${l.title}`}</span></span>
      <select value={l.uid || ""} onChange={e => act("admin.office", { op: "leaderId", k: l.k, uid: e.target.value })} aria-label={`Admin ID of ${l.name}`}>
        <option value="">Choose the admin ID…</option>{team().map(u => <option key={u.id} value={u.id}>{`${u.name} · ${u.email}`}</option>)}</select></label>)}
    <p className="muted small">They confirm from their own admin ID, in Money with me. No separate account is needed.</p></div>;
}
/* in the ID of the MD / a Director / the Chairman: money the office says is with them */
/* Payments & receipts › Transaction history: every movement of money, day by day — what agents gave to the office
   (cash, bank, wallet) or to the MD / Director / Chairman, main account money in and out, transfers. Print / Excel. */
export function TransactionHistory() {
  const O = store.S.office || { entries: [], auto: [] };
  const today = dhakaToday(), [day, setDay] = React.useState(today), [full, setFull] = React.useState(false);
  const lab = m => { const h = holderOf(m); return h.kind === "person" ? `${personName(h.k)} · ${h.via}` : h.kind === "cash" ? "Office cash" : h.name; };
  const all = [...O.entries.filter(e => e.status !== "rejected"), ...O.auto];
  const boss = holdings([...O.entries, ...O.auto].filter(okEntry).filter(e => full || String(e.date) <= day)); // each boss's account up to the day shown
  const rows = all.map(e => {
    const wait = e.status === "pending" ? " (waiting for confirmation)" : "";
    if (e.type === "transfer") return { id: e.id, date: e.date, at: e.at, details: `${e.desc || "Transfer"} — ${tk(e.amount)} BDT: ${lab(e.from)} → ${lab(e.to)}${wait}`, rate: "TRANSFER", debit: 0, credit: 0, e };
    return { id: e.id, date: e.date, at: e.at, details: `${e.desc}${wait}`, rate: lab(e.method).toUpperCase(), debit: e.type === "in" ? e.amount : 0, credit: e.type === "out" ? e.amount : 0, e };
  }).sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.at || "").localeCompare(String(b.at || "")));
  // the day's (or every day's) money in, by who holds it, and money out
  const inView = rows.filter(r => full || r.date === day), sum = {}; let out = 0, agents = 0;
  for (const r of inView) { if (r.e.type === "out") { out += r.credit; continue; } if (r.e.type !== "in") continue;
    const h = holderOf(r.e.method), k = h.kind === "person" ? (leadersList().find(x => x.k === h.k) || LEAD0.find(x => x.k === h.k) || { title: "Director" }).title : "Office (cash, bank, wallet)";
    sum[k] = (sum[k] || 0) + r.debit; if (r.e.auto === "agent") agents += r.debit; }
  const label = new Date(day + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return <>
    <h2>Transaction history</h2>
    <p className="muted small">Every transaction in one place, day by day: money agents gave to the office or to the Managing Director, Director or Chairman, the main account's money in and out, and transfers. Print it or save it to Excel from the statement below.</p>
    <div className="day-bar">
      {full ? <><b>All dates</b><span className="grow" /><button className="btn sm" onClick={() => setFull(false)}><LuCalendarDays /> Day by day</button></>
        : <><button className="btn sm" onClick={() => setDay(addDays(day, -1))}><LuChevronLeft /> Previous day</button>
          <span className="day-now"><b>{label}</b>{day === today && <span className="ec-badge">Today</span>}</span>
          <button className="btn sm" disabled={day >= today} onClick={() => setDay(addDays(day, 1))}>Next day <LuChevronRight /></button>
          <input type="date" value={day} max={today} onChange={e => e.target.value && setDay(e.target.value)} aria-label="Day" style={{ width: "auto" }} />
          <span className="grow" /><button className="btn sm pri" onClick={() => setFull(true)}><LuFileText /> All dates</button></>}
    </div>
    <div className="hold-top">
      {Object.entries(sum).map(([k, v]) => <div key={k} className="hold-tile"><span className="muted small">{"Received · "}{k}</span><b>{`${tk(v)} BDT`}</b></div>)}
      <div className="hold-tile"><span className="muted small">Of that, from agents</span><b>{`${tk(agents)} BDT`}</b></div>
      <div className="hold-tile"><span className="muted small">Money out (main account)</span><b>{`${tk(out)} BDT`}</b></div>
    </div>
    <div className="hold-top mt8">{leadersList().map(l => { const h = boss.find(x => x.key === `p:${l.k}`), b = h ? h.bal : 0;
      return <div key={l.k} className="hold-tile"><span className="muted small">{`${l.name} · ${l.title}`}</span><b className={`boss-amt ${bossCls(b)}`}>{`${tk(Math.abs(b))} BDT`}</b><span className={`hold-word ${b < -0.004 ? "adv" : b > 0.004 ? "with" : ""}`}>{bossWord(b)}</span></div>; })}</div>
    <div className="card"><Statement key={full ? "all" : day} day={full ? "" : day} title="Mam & Mam Overseas Ltd. · Transaction history" kind="TRANSACTION HISTORY" rateHead="Received by" cash times noOpen heads={["Money in", "Money out"]} rows={rows} empty="No transactions." /></div>
  </>;
}
/* Payments & receipts › Passport Delivery List: the files whose clearance card was sent, by day or by month,
   with Name, Passport Number, Country, IC Number, Agent Name and Card fee, and the total at the bottom. Print / Excel. */
const dhakaDay = iso => new Date(Date.parse(iso) + 6 * 3600e3).toISOString().slice(0, 10);
export function PassportDelivery() {
  const today = dhakaToday(), [mode, setMode] = React.useState("day"), [day, setDay] = React.useState(today), [month, setMonth] = React.useState(today.slice(0, 7));
  const all = (store.S.clearances || []).filter(c => c.card?.sentAt).map(c => { const p = clPerson(c);
    return { id: c.id, at: c.card.sentAt, d: dhakaDay(c.card.sentAt), name: p.name || "", passport: String(p.passport || "").toUpperCase(), country: c.country || "", ic: c.icNo || c.ref || "", agent: p.via || "", fee: Number(c.card.fee || 0) }; })
    .sort((a, b) => a.at.localeCompare(b.at));
  const rows = all.filter(r => mode === "day" ? r.d === day : r.d.slice(0, 7) === month), total = rows.reduce((t, r) => t + r.fee, 0);
  // per country: how many cards and their card fee, most cards first
  const byCountry = Object.entries(rows.reduce((m, r) => { const k = r.country || "—"; m[k] = m[k] || { n: 0, fee: 0 }; m[k].n++; m[k].fee += r.fee; return m; }, {})).sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]));
  const label = mode === "day" ? dayLabel(day) : monthName(month), addMonth = n => { const [y, m] = month.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
  const head = ["SL", "Date", "Name", "Passport Number", "Country", "IC Number", "Agent Name", "Card fee (BDT)"];
  const excel = () => xlsx("Passport delivery", [[{ v: "Mam & Mam Overseas Ltd. · Passport Delivery List", s: 3 }], [label], [],
    [{ v: "Cards sent by country", s: 1 }], ...byCountry.map(([k, v]) => [k, v.n, { v: v.fee, s: 2 }]), [{ v: "Total", s: 1 }, { v: rows.length, s: 1 }, { v: total, s: 4 }], [], head.map(v => ({ v, s: 1 })),
    ...rows.map((r, i) => [i + 1, r.d, r.name, r.passport, r.country, r.ic, r.agent, { v: r.fee, s: 2 }]), ["", "", "", "", "", "", { v: "Total Amount", s: 1 }, { v: total, s: 4 }]],
    [6, 12, 28, 16, 14, 26, 26, 16], `passport-delivery-${mode === "day" ? day : month}.xlsx`);
  const print = () => {
    const e = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Passport Delivery List · ${e(label)}</title><style>body{font:13px/1.4 Arial,sans-serif;margin:24px;color:#111}h1{font-size:20px;margin:0 0 2px;color:#006a4e}h2{font-size:14px;margin:0 0 14px;font-weight:600}table{width:100%;border-collapse:collapse}th,td{border:1px solid #9aa;padding:6px 8px;text-align:left}th{background:#e3efdc}td.n,th.n{text-align:right}tfoot td{font-weight:700;background:#e3efdc}@page{size:A4 landscape;margin:12mm}</style></head><body>
      <h1>Mam &amp; Mam Overseas Ltd. · Passport Delivery List</h1><h2>${e(label)} · ${rows.length} file(s)</h2>
      <table style="width:auto;min-width:360px;margin-bottom:16px"><thead><tr><th>Country</th><th class="n">Cards sent</th><th class="n">Card fee (BDT)</th></tr></thead><tbody>${byCountry.map(([k, v]) => `<tr><td>${e(k)}</td><td class="n">${v.n}</td><td class="n">${tk(v.fee)}</td></tr>`).join("")}</tbody><tfoot><tr><td class="n">Total</td><td class="n">${rows.length}</td><td class="n">${tk(total)}</td></tr></tfoot></table>
      <table><thead><tr>${head.map((h, i) => `<th${i === 7 ? ' class="n"' : ""}>${e(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${e(r.d.split("-").reverse().join("-"))}</td><td>${e(r.name)}</td><td>${e(r.passport)}</td><td>${e(r.country)}</td><td>${e(r.ic)}</td><td>${e(r.agent)}</td><td class="n">${tk(r.fee)}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td colspan="7" class="n">Total Amount</td><td class="n">${tk(total)}</td></tr></tfoot></table>`;
    // no script tag inside the page text (the site's own code is inlined in a script tag); print once the window has loaded
    const w = window.open(URL.createObjectURL(new Blob([html], { type: "text/html" })), "_blank"); if (!w) return toast("Allow pop-ups for this site to print.");
    w.addEventListener("load", () => setTimeout(() => w.print(), 200));
  };
  return <>
    <h2>Passport Delivery List</h2>
    <p className="muted small">The files whose clearance card was sent, by the day it was sent. See one day or a whole month, print it or save it to Excel.</p>
    <div className="pay-tabs mt8" role="tablist">{[["day", "Day"], ["month", "Month"]].map(([k, l]) => <button key={k} role="tab" aria-selected={mode === k} className={mode === k ? "on" : ""} onClick={() => setMode(k)}>{l}</button>)}</div>
    <div className="day-bar mt8">
      {mode === "day" ? <><button className="btn sm" onClick={() => setDay(addDays(day, -1))}><LuChevronLeft /> Previous day</button>
        <span className="day-now"><b>{dayLabel(day)}</b>{day === today && <span className="ec-badge">Today</span>}</span>
        <button className="btn sm" disabled={day >= today} onClick={() => setDay(addDays(day, 1))}>Next day <LuChevronRight /></button>
        <input type="date" value={day} max={today} onChange={e => e.target.value && setDay(e.target.value)} aria-label="Day" style={{ width: "auto" }} /></>
        : <><button className="btn sm" onClick={() => setMonth(addMonth(-1))}><LuChevronLeft /> Previous month</button>
        <span className="day-now"><b>{monthName(month)}</b></span>
        <button className="btn sm" disabled={month >= today.slice(0, 7)} onClick={() => setMonth(addMonth(1))}>Next month <LuChevronRight /></button>
        <input type="month" value={month} max={today.slice(0, 7)} onChange={e => e.target.value && setMonth(e.target.value)} aria-label="Month" style={{ width: "auto" }} /></>}
      <span className="grow" />
      <button className="btn sm" disabled={!rows.length} onClick={print}><LuPrinter /> Print</button>
      <button className="btn sm" disabled={!rows.length} onClick={excel}><LuSheet /> Excel</button>
    </div>
    {rows.length > 0 && <div className="card mt8"><h3 className="mb6">Cards sent by country</h3><div className="tbl"><table><thead><tr><th>Country</th><th style={{ textAlign: "right" }}>Cards sent</th><th style={{ textAlign: "right" }}>Card fee (BDT)</th></tr></thead><tbody>
      {byCountry.map(([k, v]) => <tr key={k}><td className="b">{k}</td><td className="num" style={{ textAlign: "right" }}>{v.n}</td><td className="num" style={{ textAlign: "right" }}>{tk(v.fee)}</td></tr>)}
    </tbody><tfoot><tr className="st-total"><td className="b" style={{ textAlign: "right" }}>Total</td><td className="num b" style={{ textAlign: "right" }}>{rows.length}</td><td className="num b" style={{ textAlign: "right" }}>{tk(total)}</td></tr></tfoot></table></div></div>}
    <div className="card mt8"><div className="tbl"><table><thead><tr>{head.map((h, i) => <th key={h} style={i === 7 ? { textAlign: "right" } : undefined}>{h}</th>)}</tr></thead><tbody>
      {rows.length ? rows.map((r, i) => <tr key={r.id}><td>{i + 1}</td><td className="nowrap">{r.d.split("-").reverse().join("-")}</td><td className="b" data-notr>{r.name}</td><td className="num" data-notr>{r.passport}</td><td>{r.country}</td><td className="num nowrap" data-notr>{r.ic}</td><td data-notr>{r.agent}</td><td className="num" style={{ textAlign: "right" }}>{tk(r.fee)}</td></tr>)
        : <tr><td colSpan={8}><Empty>{mode === "day" ? "No clearance card was sent on this day." : "No clearance card was sent in this month."}</Empty></td></tr>}
    </tbody>{rows.length > 0 && <tfoot><tr className="st-total"><td colSpan={7} className="b" style={{ textAlign: "right" }}>Total Amount</td><td className="num b" style={{ textAlign: "right" }}>{tk(total)}</td></tr></tfoot>}</table></div></div>
  </>;
}
export function MoneyWithMe() {
  const [tab, setTab] = React.useState(store.ui.mwmTab || "mine"), go = k => { store.ui.mwmTab = k; setTab(k); };
  const nav = <nav className="pay-tabs" aria-label="Money with me">{[["mine", "My account with the office"], ["other", "My other accounts"]].map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} aria-current={tab === k ? "page" : undefined} onClick={() => go(k)}>{l}</button>)}</nav>;
  if (tab === "other") return <>{nav}<OtherAccounts own /></>;
  return <>{nav}<MoneyMine /></>;
}
function MoneyMine() {
  const M = store.S.myMoney || { entries: [] }, me = user(store.S.session) || {}, mk = M.me?.k, key = `p:${mk}`;
  const pend = M.entries.filter(e => e.status === "pending" && !e.accepted?.includes(mk));
  const mine = holdings(M.entries.filter(okEntry)).find(h => h.key === key);
  const ok = M.entries.filter(okEntry), bal = ok.reduce((t, e) => t + moves(e).filter(m => m.h.key === key).reduce((s, m) => s + m.amount, 0), 0);
  return <>
    <div className="ec-head"><div><h2>Money with me</h2><p className="muted small">Your own account: money agents paid to you, and money the office gave you or you gave the office. The Account Manager's entries about you count after you confirm them. Use Give money to the office to put money into the main account.</p></div></div>
    <div className="card hold"><div className="hold-top"><div className="hold-tile tot"><span className="muted small">{`${M.me?.name || me.name}${M.me?.title ? ` · ${M.me.title}` : ""} · ${bossWord(bal, true)}`}</span><b className={`boss-amt ${bossCls(bal)}`}>{`${tk(Math.abs(bal))} BDT`}</b></div><div className="hold-tile"><span className="muted small">Waiting for you</span><b>{pend.length}</b></div></div>
      {mine && Object.keys(mine.vias).length > 0 && <div className="tbl hold-tbl"><table><thead><tr><th>Account</th><th className="r">Money in</th><th className="r">Money out</th><th className="r">Balance</th></tr></thead><tbody>
        {Object.entries(mine.vias).map(([n, v]) => <tr key={n}><td className="b">{n}</td><td className="num">{tk(v.in)}</td><td className="num">{tk(v.out)}</td><td className="num b">{tk(v.in - v.out)}</td></tr>)}</tbody></table></div>}</div>
    <GiveToOffice />
    {pend.length > 0 && <div className="card"><h3>Please confirm</h3>
      {pend.map(e => <MoneyReq key={e.id} e={e} mk={mk} />)}</div>}
    <div className="card"><Statement title={`Mam & Mam Overseas Ltd. · Money with ${M.me?.name || me.name}`} kind="MONEY WITH ME" cash times heads={["Money in", "Money out"]} balText={b => bossWord(b, true)} rows={officeRows(M.entries, key, true)} empty="Nothing yet." /></div>
  </>;
}
/* the MD / a Director / the Chairman gives money to the office: a transfer from their account into the main account */
function GiveToOffice() {
  const [open, setOpen] = React.useState(false), [busy, setBusy] = React.useState(false);
  const [f, setF] = React.useState({ amount: "", via: "Cash", to: "Cash", date: today(), ref: "", desc: "" }), set = v => setF(x => ({ ...x, ...v }));
  if (!open) return <div className="card row between"><div><b>Give money to the office</b><div className="muted small">It goes into the main account.</div></div><button className="btn pri" onClick={() => setOpen(true)}><LuBanknote /> Give money to the office</button></div>;
  const send = async e => { e.preventDefault(); if (!(Number(f.amount) > 0)) return toast("Enter the amount."); setBusy(true); const r = await act("office.give", f); setBusy(false); if (r) { setOpen(false); set({ amount: "", ref: "", desc: "" }); } };
  return <form className="card fgrid" onSubmit={send} noValidate><h3 className="full">Give money to the office</h3>
    <Field label="Amount (BDT)"><input type="number" min="1" value={f.amount} onChange={e => set({ amount: e.target.value })} /></Field>
    <Field label="Date"><input type="date" value={f.date} onChange={e => set({ date: e.target.value })} /></Field>
    <Field label="From my"><select value={f.via} onChange={e => set({ via: e.target.value })}><option value="Cash">Cash in hand</option><optgroup label="Bank">{BANKS.map(x => <option key={x} value={`Bank transfer · ${x}`}>{x}</option>)}</optgroup><optgroup label="Mobile banking">{MFS.map(x => <option key={x} value={`Mobile banking · ${x}`}>{x}</option>)}</optgroup></select></Field>
    <Field label="Office receives it in"><select value={f.to} onChange={e => set({ to: e.target.value })}><Ways /></select></Field>
    <Field label="Reference (optional)"><input type="text" value={f.ref} onChange={e => set({ ref: e.target.value })} placeholder="e.g. TrxID" /></Field>
    <Field label="Details (optional)"><input type="text" value={f.desc} onChange={e => set({ desc: e.target.value })} placeholder="e.g. Agent payments collected this week" /></Field>
    <div className="row full"><button className="btn pri" disabled={busy}><LuBanknote /> Give to the office</button><button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button></div></form>;
}
function MoneyReq({ e, mk }) {
  const [no, setNo] = React.useState(false), [txt, setTxt] = React.useState(""), m = moves(e).find(x => x.h.key === `p:${mk}`);
  return <div className="sal-req">
    <div><b>{`${tk(e.amount)} BDT`}</b><span className="ec-badge ms6">{e.type === "transfer" ? (m?.amount > 0 ? "Given to you" : "Paid by you") : e.type === "in" ? "Received by you" : "Paid out by you"}</span>
      <div>{e.desc}</div><div className="muted small">{[rDate(e.date), m?.h.via && `Into: ${m.h.via}`, e.ref && `Ref ${e.ref}`, e.type === "transfer" && `${methodText(e.from)} → ${methodText(e.to)}`, `Entered by ${e.by}`].filter(Boolean).join(" · ")}</div></div>
    {no ? <div className="row6"><input type="text" value={txt} onChange={x => setTxt(x.target.value)} maxLength={200} placeholder="What is wrong? e.g. amount is less" aria-label="What is wrong" />
      <button className="btn sm danger" onClick={() => act("office.accept", { id: e.id, ok: false, text: txt })}>Send</button><button className="btn sm" onClick={() => setNo(false)}>Back</button></div>
      : <div className="row6"><button className="btn sm pri" onClick={() => act("office.accept", { id: e.id, ok: true })}><LuCheck /> Yes, confirm</button><button className="btn sm" onClick={() => setNo(true)}><LuX /> Not received</button></div>}
  </div>;
}
function OfficeForm() {
  const blank = (type = "in", date = today()) => ({ k: key(), type, date, amount: "", method: "Cash", from: "Cash", to: "Bank transfer · " + BANKS[0], ref: "", desc: "" });
  const [rows, setRows] = React.useState(() => [blank()]); const [busy, setBusy] = React.useState(false);
  const set = (i, v) => setRows(rows.map((r, j) => (j === i ? { ...r, ...v } : r)));
  const sum = rows.reduce((t, r) => t + (r.type === "in" ? 1 : r.type === "out" ? -1 : 0) * (Number(r.amount) || 0), 0);
  const hasPerson = rows.some(r => (r.type === "transfer" ? [r.from, r.to] : [r.method]).some(m => m.startsWith("Person · ")));
  const add = async e => {
    e.preventDefault();
    for (const [i, r] of rows.entries()) {
      const at = rows.length > 1 ? ` (row ${i + 1})` : "";
      if (!(Number(r.amount) > 0) || !r.desc.trim()) { toast(`Enter the amount and details${at}.`); return; }
      if (r.type === "transfer" && r.from === r.to) { toast(`From and To must be different${at}.`); return; }
    }
    setBusy(true); const res = await act("admin.office", { op: "add", rows: rows.map(({ k, ...r }) => r.type === "transfer" ? { ...r, method: "" } : { ...r, from: "", to: "" }) }); setBusy(false);
    if (res) { const l = rows[rows.length - 1]; setRows([blank(l.type, l.date)]); }
  };
  return <form className="divider ledger-add" onSubmit={add} noValidate>
    <h4>Add to main account</h4>
    {rows.map((r, i) => <div key={r.k} className={`fgrid${rows.length > 1 ? " mr-line" : ""}`}>
      {rows.length > 1 && <div className="mr-line-head full"><b>{`Entry ${i + 1}`}</b><button type="button" className="btn sm link danger" onClick={() => setRows(rows.filter((_, j) => j !== i))}><LuX /> Remove</button></div>}
      <Field label="Type"><select value={r.type} onChange={e => set(i, { type: e.target.value })}><option value="in">Money in (income)</option><option value="out">Money out (expense)</option><option value="transfer">Move money (e.g. cash to bank)</option></select></Field>
      <Field label="Date"><input type="date" value={r.date} onChange={e => set(i, { date: e.target.value })} /></Field>
      <Field label="Amount (BDT)"><input type="number" min="1" step="0.01" value={r.amount} onChange={e => set(i, { amount: e.target.value })} /></Field>
      {r.type === "transfer" ? <>
        <Field label="From"><PaidBy people value={r.from} onChange={v => set(i, { from: v })} /></Field>
        <Field label="To"><PaidBy people value={r.to} onChange={v => set(i, { to: v })} /></Field>
      </> : <Field label={r.type === "in" ? "Received by / into" : "Paid by / from"}><PaidBy people value={r.method} onChange={v => set(i, { method: v })} /></Field>}
      <Field label="Reference no."><input type="text" value={r.ref} onChange={e => set(i, { ref: e.target.value })} maxLength={80} placeholder="Optional" /></Field>
      <Field label={<span className="field-head">Details<PassportPick onPick={pp => set(i, { desc: ppLine(pp) })} /></span>} full><input type="text" value={r.desc} onChange={e => set(i, { desc: e.target.value })} maxLength={200} placeholder={r.type === "in" ? "e.g. Service charge, Fiji visa (5 workers)" : r.type === "out" ? "e.g. Office rent, November" : "e.g. Cash deposited to the bank"} /></Field>
    </div>)}
    <div className="row6 mt8"><button type="button" className="btn sm" onClick={() => { const l = rows[rows.length - 1]; setRows([...rows, blank(l.type, l.date)]); }}><LuPlus /> Add another entry</button>
      {rows.length > 1 && <span className="muted small">{`${rows.length} entries · balance change ${sum >= 0 ? "+" : "−"}${tk(Math.abs(sum))} BDT`}</span>}</div>
    {hasPerson && <p className="muted small mt8">Money with the Managing Director, a Director or the Chairman goes to them as a request. It is added to the main account when they confirm it.</p>}
    <div className="mt14"><button className="btn pri" type="submit" disabled={busy}>{hasPerson ? "Send request" : rows.length > 1 ? `Add ${rows.length} entries` : "Add"}</button></div>
  </form>;
}

/* ---------------- Salary accounts ---------------- */
const SAL = () => store.S.salary || { profiles: {}, pays: [] };
const allPays = () => { const a = store.S.salary?.pays || [], b = store.S.mySalary?.pays || []; return [...a, ...b.filter(x => !a.some(y => y.id === x.id))]; };
const done = p => !p.void && p.status === "received";
export function SalaryStatus({ p }) {
  return p.void ? <span className="ec-badge s-rejected">Cancelled</span> : p.status === "received" ? <span className="ec-badge s-approved"><LuCheck /> Received</span>
    : p.status === "problem" ? <span className="ec-badge s-rejected">Not received</span> : <span className="ec-badge mr-wait">Waiting for confirmation</span>;
}
const team = () => store.S.users.filter(u => (u.role === "admin" || u.role === "staff") && u.status !== "deleted");
const titleOf = u => { const m = u.memberId && (store.S.team || []).find(t => t.id === u.memberId); return m?.title || (u.role === "admin" ? "Admin" : "Staff"); };
const live = l => l.filter(done);
export function SalaryAdmin() {
  const ui = store.ui; const [sel, setSel] = React.useState(ui.salaryUid || null);
  const pick = id => { ui.salaryUid = id; setSel(id); setTimeout(() => document.getElementById("salary-person")?.scrollIntoView({ behavior: "smooth" }), 60); };
  const people = team(); const me = user(store.S.session);
  const month = today().slice(0, 7);
  const x = sel && people.find(p => p.id === sel);
  return <>
    <div className="ec-head"><div><h2>Salary accounts</h2><p className="muted small">Choose a person to pay a salary. The salary receipt has a QR code and is emailed to the person.</p></div></div>
    {people.length ? <div className="tbl ec-tbl grid"><table><thead><tr><th>Name</th><th>Designation</th><th className="r">Monthly salary</th><th>{`Paid for ${monthName(month)}`}</th><th className="r">Total paid</th><th>Actions</th></tr></thead><tbody>
      {people.map(p => { const pays = live(SAL().pays.filter(y => y.uid === p.id)), cur = pays.filter(y => y.month === month).reduce((t, y) => t + y.paid, 0), prof = SAL().profiles[p.id];
        const wait = SAL().pays.filter(y => y.uid === p.id && !y.void && y.status !== "received");
        return <tr key={p.id} className={sel === p.id ? "sel" : ""}>
          <td><b data-notr>{p.name}</b><RoleBadges role={p.role} size={14} /><div className="muted small" data-notr>{p.email}</div></td>
          <td data-notr>{titleOf(p)}</td>
          <td className="num r"><MonthlyCell uid={p.id} value={prof?.monthly} /></td>
          <td>{cur ? <span className="mr-ok"><LuCheck /> {tk(cur)}</span> : <span className="muted">Not paid</span>}
            {wait.map(y => <div key={y.id}><button className="btn sm link" onClick={() => openModal("salaryView", { id: y.id })}><SalaryStatus p={y} /> <span className="small">{`${y.no} · ${tk(y.paid)}`}</span></button></div>)}</td>
          <td className="num r b">{tk(pays.reduce((t, y) => t + y.paid, 0))}</td>
          <td><div className="row6 nowrap">{(p.id !== me?.id || me?.role === "admin") && <button className="btn sm pri" onClick={() => { pick(p.id); openModal("salaryPay", { uid: p.id }); }}><LuBanknote /> Pay salary</button>}
            <button className="btn sm" onClick={() => pick(p.id)}><LuHistory /> History</button></div></td>
        </tr>; })}
    </tbody></table></div> : <Empty>No admin or staff IDs yet.</Empty>}
    {x && <div className="card stack mt14" id="salary-person">
      <div className="row between"><h3>{`Salary history: ${x.name}`}<RoleBadges role={x.role} size={15} /></h3><button className="btn sm" onClick={() => pick(null)}><LuX /> Close</button></div>
      <Statement key={x.id} title={x.name} sub={[titleOf(x), x.email].filter(Boolean).join(" · ")} kind="SALARY ACCOUNT" heads={["Salary (net)", "Paid"]} balText={b => (b > 0 ? "Still to pay" : b < 0 ? "Paid in advance" : "All paid")}
        rows={SAL().pays.filter(p => p.uid === x.id && !p.void).map(p => ({ id: p.id, date: p.date, details: `Salary ${monthName(p.month)} (${p.no})`, ref: p.ref, rate: way(p.method, p.channel), debit: p.net, credit: p.paid, pay: p, pending: p.status !== "received", sub: p.status === "problem" ? `Not received: ${p.problem?.text || ""}` : p.status !== "received" ? "Waiting for the person to confirm" : p.recv ? `Received ${rDate(p.recv.at.slice(0, 10))}` : "Received" }))}
        empty="No salary paid yet."
        actions={r => <button className="ec-ico view" aria-label="View salary receipt" title="View salary receipt" onClick={() => openModal("salaryView", { id: r.id })}><LuEye /></button>} />
      {SAL().pays.some(p => p.uid === x.id && p.void) && <p className="muted small">{`Cancelled receipts are not in the history: ${SAL().pays.filter(p => p.uid === x.id && p.void).map(p => p.no).join(", ")}.`}</p>}
    </div>}
  </>;
}
function MonthlyCell({ uid, value }) {
  const [ed, setEd] = React.useState(null);
  if (ed === null) return <button className="st-rate-btn" title="Set monthly salary" onClick={() => setEd(value != null ? String(value) : "")}>{value != null ? tk(value) : <span className="muted">Set</span>}</button>;
  const save = async e => { e.preventDefault(); if (await act("admin.salary", { op: "monthly", uid, monthly: ed })) setEd(null); };
  return <form className="st-rq" onSubmit={save}><input type="number" min="0" value={ed} onChange={e => setEd(e.target.value)} autoFocus aria-label="Monthly salary" />
    <button className="btn sm pri" aria-label="Save"><LuCheck /></button><button type="button" className="btn sm" aria-label="Cancel" onClick={() => setEd(null)}><LuX /></button></form>;
}

/* pay a salary: month, salary, bonus, deduction, paid now, method */
/* Money receipts › Pay back an advance: the earlier receipt number shows what was received and what is left; paid from office
   cash / bank / wallet = the main account, paid by the MD / a Director / the Chairman = their account (after they confirm) */
export function MrRefund({ no: no0 }) {
  const [no, setNo] = React.useState(no0 || ""), [r, setR] = React.useState(null), [busy, setBusy] = React.useState(false);
  const [f, setF] = React.useState({ amount: "", date: today(), method: "Cash", ref: "", note: "" }); const set = v => setF(o => ({ ...o, ...v }));
  const find = async e => { e?.preventDefault(); if (!no.trim()) return toast("Enter the money receipt number."); setBusy(true); const x = await act("admin.mr", { op: "refundFind", no }, { quiet: false }); setBusy(false); if (x?.receipt) { setR(x.receipt); set({ amount: String(x.receipt.left) }); } };
  const save = async e => { e.preventDefault(); if (!(Number(f.amount) > 0)) return toast("Enter the amount paid back."); setBusy(true); const x = await act("admin.mr", { op: "refund", id: r.id, ...f, amount: Number(f.amount) }); setBusy(false); if (x) closeModal(); };
  const boss = splitP(f.method);
  return <div className="stack">
    <h2 className="row6"><LuRotateCcw /> Pay back an advance</h2>
    <p className="muted small">Someone paid the office an advance. Give that money receipt's number to pay it back, all or part.</p>
    <form className="row6" onSubmit={find}><input type="text" value={no} onChange={e => { setNo(e.target.value.toUpperCase()); setR(null); }} placeholder="Money receipt No., e.g. MR-2026-0012" aria-label="Money receipt number" style={{ maxWidth: 260 }} />
      <button className="btn" type="submit" disabled={busy}>Find</button></form>
    {r && <form className="stack" onSubmit={save}>
      <div className="hold-top">
        <div className="hold-tile"><span className="muted small" data-notr>{`${r.no} · ${r.payer.name || r.payer.passport || r.payer.mobile || ""}`}</span><b>{`${tk(r.amount)} BDT`}</b><span className="muted small">{rDate(r.date)}{r.purpose ? ` · ${r.purpose}` : ""}</span></div>
        <div className="hold-tile"><span className="muted small">Paid back before</span><b>{`${tk(r.paid)} BDT`}</b></div>
        <div className="hold-tile"><span className="muted small">Left to pay back</span><b>{`${tk(r.left)} BDT`}</b></div>
      </div>
      {r.left <= 0 ? <p className="notice">This advance is fully paid back.</p> : <>
        <div className="fgrid">
          <Field label="Amount paid back (BDT)"><input type="number" min="1" step="0.01" max={r.left} value={f.amount} onChange={e => set({ amount: e.target.value })} inputMode="decimal" /></Field>
          <Field label="Date"><input type="date" value={f.date} onChange={e => set({ date: e.target.value })} /></Field>
          <Field label="Paid from" hint={boss ? "From their own account. It counts after they confirm it in their ID." : "From the office: it goes out of the main account."}><PaidBy value={f.method} onChange={v => set({ method: v })} people /></Field>
          <Field label="Transaction / Ref No."><input type="text" value={f.ref} onChange={e => set({ ref: e.target.value })} maxLength={80} placeholder="Optional" /></Field>
          <Field label="Note" full><input type="text" value={f.note} onChange={e => set({ note: e.target.value })} maxLength={120} placeholder="Optional" /></Field>
        </div>
        <p className="small">{`This payment is written as paid back against ${r.no}.`}</p>
        <div className="row6"><button className="btn pri" type="submit" disabled={busy}><LuCheck /> Save</button><button className="btn" type="button" onClick={closeModal}>Cancel</button></div></>}
    </form>}
  </div>;
}

/* Payments & receipts › Other accounts: accounts by name, only for the record (not in the main account or the bosses' accounts) */
export function OtherAccounts({ own, title }) {
  const K = (own ? store.S.myKhata : store.S.khata) || [], ui = store.ui, O = own ? { own: true } : {};
  const [q, setQ] = React.useState(""), [sel, setSel] = React.useState(ui.khataSel || null), [nf, setNf] = React.useState(null), [ef, setEf] = React.useState(null), [busy, setBusy] = React.useState(false);
  const acc = sel && K.find(x => x.id === sel), pick = id => { ui.khataSel = id; setSel(id); setEf(null); };
  const bal = a => a.entries.reduce((t, e) => t + (e.type === "gave" ? e.amount : -e.amount), 0);
  const list = K.filter(a => !q.trim() || [a.name, a.mobile, a.note].some(v => (v || "").toLowerCase().includes(q.trim().toLowerCase())));
  const saveAcc = async e => { e.preventDefault(); setBusy(true); const r = await act("admin.khata", { op: nf.id ? "edit" : "add", ...O, ...nf }); setBusy(false); if (r) { if (r.id) pick(r.id); setNf(null); } };
  const saveEntry = async e => { e.preventDefault(); if (!(Number(ef.amount) > 0)) return toast("Enter the amount."); setBusy(true); const r = await act("admin.khata", { op: "entry", ...O, id: acc.id, ...ef, amount: Number(ef.amount) }); setBusy(false); if (r) setEf(null); };
  const blankE = type => ({ type, date: today(), amount: "", desc: "", method: "Cash", ref: "" });
  const accForm = nf && <form className="card mt14" onSubmit={saveAcc}><h3>{nf.id ? "Edit account" : "New account"}</h3><div className="fgrid">
    <Field label="Name"><input type="text" value={nf.name} onChange={e => setNf({ ...nf, name: e.target.value })} maxLength={120} autoFocus /></Field>
    <Field label="Mobile (optional)"><input type="tel" value={nf.mobile} onChange={e => setNf({ ...nf, mobile: e.target.value })} maxLength={30} /></Field>
    <Field label="Note (optional)" full><input type="text" value={nf.note} onChange={e => setNf({ ...nf, note: e.target.value })} maxLength={300} /></Field></div>
    <div className="row6 mt8"><button className="btn pri" type="submit" disabled={busy}><LuCheck /> Save</button><button className="btn" type="button" onClick={() => setNf(null)}>Cancel</button></div></form>;
  if (acc) {
        const rows = [...acc.entries].sort((x, y) => String(x.date).localeCompare(String(y.date)) || String(x.at).localeCompare(String(y.at)))
      .map(e => ({ id: e.id, date: e.date, at: e.at, details: e.desc || (e.type === "gave" ? "Given" : "Received"), ref: e.ref, rate: way(e.method), debit: e.type === "gave" ? e.amount : 0, credit: e.type === "got" ? e.amount : 0, e }));
    return <>
      <div className="ec-head"><div><button className="btn sm link" onClick={() => pick(null)}><LuChevronLeft /> {title || (own ? "My other accounts" : "Other accounts")}</button>
        <h2 data-notr>{acc.name}</h2><p className="muted small" data-notr>{[acc.mobile, acc.note].filter(Boolean).join(" · ") || "Only for the record: not in the main account or the bosses' accounts."}</p></div>
        <div className="row6"><button className="btn" onClick={() => setNf({ id: acc.id, name: acc.name, mobile: acc.mobile || "", note: acc.note || "" })}><LuPencil /> Edit</button>
          <button className="btn link danger" onClick={() => confirmBox(`Remove the account ${acc.name}${acc.entries.length ? ` and its ${acc.entries.length} entries` : ""}?`, async () => { if (await act("admin.khata", { op: "remove", ...O, id: acc.id })) pick(null); }, "Remove")}><LuTrash2 /></button></div></div>
      {accForm}
      <div className="row6 mt14"><button className="btn pri" onClick={() => setEf(blankE("gave"))}><LuPlus /> Money given</button><button className="btn pri" onClick={() => setEf(blankE("got"))}><LuPlus /> Money received</button></div>
      {ef && <form className="card mt14" onSubmit={saveEntry}><h3>{ef.eid ? "Edit entry" : ef.type === "gave" ? "Money given" : "Money received"}</h3><div className="fgrid">
        <Field label="Type"><select value={ef.type} onChange={e => setEf({ ...ef, type: e.target.value })}><option value="gave">Money given (office → them)</option><option value="got">Money received (them → office)</option></select></Field>
        <Field label="Amount (BDT)"><input type="number" min="1" step="0.01" value={ef.amount} onChange={e => setEf({ ...ef, amount: e.target.value })} inputMode="decimal" autoFocus /></Field>
        <Field label="Date"><input type="date" value={ef.date} onChange={e => setEf({ ...ef, date: e.target.value })} /></Field>
        <Field label="Payment method"><select value={ef.method} onChange={e => setEf({ ...ef, method: e.target.value })}><Ways /></select></Field>
        <Field label="Transaction / Ref No."><input type="text" value={ef.ref} onChange={e => setEf({ ...ef, ref: e.target.value })} maxLength={80} placeholder="Optional" /></Field>
        <Field label="Details" full><input type="text" value={ef.desc} onChange={e => setEf({ ...ef, desc: e.target.value })} maxLength={200} placeholder="What it was for" /></Field></div>
        <div className="row6 mt8"><button className="btn pri" type="submit" disabled={busy}><LuCheck /> Save</button><button className="btn" type="button" onClick={() => setEf(null)}>Cancel</button></div></form>}
      <div className="card mt14"><Statement key={acc.id + acc.entries.length} title={`Mam & Mam Overseas Ltd. · ${acc.name}`} kind="ACCOUNT STATEMENT" heads={["Given", "Received"]} rows={rows} times plain actions={r => <span className="row6 nowrap"><button className="ec-ico view" title="Edit" aria-label="Edit entry" onClick={() => setEf({ eid: r.e.id, type: r.e.type, date: r.e.date, amount: String(r.e.amount), desc: r.e.desc || "", method: r.e.method || "Cash", ref: r.e.ref || "" })}><LuPencil /></button>
          <button className="ec-ico del" title="Delete" aria-label="Delete entry" onClick={() => confirmBox(`Delete this entry of BDT ${tk(r.e.amount)}?`, () => act("admin.khata", { op: "entryDelete", ...O, id: acc.id, eid: r.e.id }), "Delete")}><LuTrash2 /></button></span>}
        empty="No entries yet. Add money given or received above." /></div>
    </>;
  }
  return <>
    <div className="ec-head"><div><h2>{title || (own ? "My other accounts" : "Other accounts")}</h2><p className="muted small">{own ? (title ? "Your personal accounts by name, only for the record. Only you see them; they are not added to any office account." : "Your own accounts by name, only for the record. Only you see them; they are not added to the main account or to your account with the office.") : "Keep an account by name, only for the record. It is not added to the main account or the bosses' accounts."}</p></div>
      <button className="btn pri" onClick={() => setNf({ name: q.trim(), mobile: "", note: "" })}><LuPlus /> New account</button></div>
    {accForm}
    <div className="card mt14">
      <label className="ec-search mr-search"><input type="text" value={q} onChange={e => setQ(e.target.value)} placeholder="Search a name" aria-label="Search accounts" /><LuSearch /></label>
      {list.length ? <div className="tbl mt8"><table><thead><tr><th>Name</th><th>Mobile</th><th className="r">Given</th><th className="r">Received</th><th className="r">Balance</th><th>Last entry</th></tr></thead><tbody>
        {list.map(a => { const b = bal(a), last = [...a.entries].sort((x, y) => String(y.date).localeCompare(String(x.date)))[0]; return <tr key={a.id} className="click" onClick={() => pick(a.id)} tabIndex={0} onKeyDown={e => e.key === "Enter" && pick(a.id)}>
          <td className="b" data-notr>{a.name}</td><td data-notr>{a.mobile || "—"}</td>
          <td className="num r">{tk(a.entries.filter(e => e.type === "gave").reduce((t, e) => t + e.amount, 0))}</td><td className="num r">{tk(a.entries.filter(e => e.type === "got").reduce((t, e) => t + e.amount, 0))}</td>
          <td className="num r b">{tk(b)}</td>
          <td className="nowrap">{last ? rDate(last.date) : "—"}</td></tr>; })}
      </tbody></table></div> : <Empty>{q.trim() ? "No account with this name. Use New account to make it." : "No accounts yet. Use New account to make the first one."}</Empty>}
    </div>
  </>;
}

export function SalaryPay({ uid }) {
  const x = team().find(p => p.id === uid); const prof = SAL().profiles[uid];
  const [f, setF] = React.useState({ period: prof?.period || "monthly", month: today().slice(0, 7), basic: prof?.monthly != null ? String(prof.monthly) : "", bonus: "", deduct: "", paid: "", date: today(), method: "Cash", channel: "", chOther: false, ref: "", note: "" });
  const [busy, setBusy] = React.useState(false);
  if (!x) return <p>Person not found.</p>;
  const set = v => setF({ ...f, ...v });
  const net = (Number(f.basic) || 0) + (Number(f.bonus) || 0) - (Number(f.deduct) || 0), paid = f.paid === "" ? net : Number(f.paid) || 0;
  const already = live(SAL().pays.filter(p => p.uid === uid && p.month === f.month));
  const ch = channelsFor(f.method);
  const submit = async e => {
    e.preventDefault();
    if (!(net > 0)) { toast("The net salary must be more than 0."); return; }
    if (ch && f.method !== "Cheque" && !f.channel.trim()) { toast(f.method === "Mobile banking" ? "Choose the mobile banking service." : "Choose the bank."); return; }
    setBusy(true);
    const r = await act("admin.salary", { op: "pay", uid, period: f.period, month: f.month, basic: f.basic, bonus: f.bonus, deduct: f.deduct, paid: f.paid, date: f.date, method: f.method, channel: ch ? f.channel : "", ref: f.ref, note: f.note });
    setBusy(false);
    if (r?.payId) openModal("salaryView", { id: r.payId, fresh: true });
  };
  return <form onSubmit={submit} noValidate>
    <h2 className="row6"><LuBanknote /> Pay salary</h2>
    <div className="mr-acc"><span><b data-notr>{x.name}</b><RoleBadges role={x.role} size={14} /> · <span data-notr>{titleOf(x)}</span>{x.email ? <span className="muted">{` · receipt goes to ${x.email}`}</span> : <span className="muted"> · no email: download the receipt</span>}</span></div>
    {already.length > 0 && <p className="notice small">{`Already paid for ${monthName(f.month)}: ${already.map(p => `${p.no} (${tk(p.paid)})`).join(", ")}.`}</p>}
    <div className="card mr-box"><div className="fgrid">
      <Field label="Salary type"><div className="seg3" role="radiogroup" aria-label="Salary type">{[["weekly", "Weekly salary"], ["monthly", "Monthly salary"]].map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={f.period === k} className={f.period === k ? "on" : ""} onClick={() => set({ period: k })}>{l}</button>)}</div></Field>
      <Field label="Salary month"><input type="month" value={f.month} onChange={e => set({ month: e.target.value })} required /></Field>
      <Field label="Payment date"><input type="date" value={f.date} onChange={e => set({ date: e.target.value })} /></Field>
      <Field label="Salary (BDT)" hint={prof?.monthly != null ? `Monthly salary: ${tk(prof.monthly)}` : "Tip: set the monthly salary in the list"}><input type="number" min="0" step="0.01" value={f.basic} onChange={e => set({ basic: e.target.value })} /></Field>
      <Field label="Bonus / allowance (BDT)"><input type="number" min="0" step="0.01" value={f.bonus} onChange={e => set({ bonus: e.target.value })} placeholder="0" /></Field>
      <Field label="Deduction (BDT)" hint="Advance taken, leave without pay…"><input type="number" min="0" step="0.01" value={f.deduct} onChange={e => set({ deduct: e.target.value })} placeholder="0" /></Field>
      <Field label="Paid now (BDT)" hint={`Net salary: ${tk(net)}${f.paid !== "" && paid !== net ? ` · ${paid < net ? "still to pay" : "advance"} ${tk(Math.abs(net - paid))}` : ""}`}><input type="number" min="0" step="0.01" value={f.paid} onChange={e => set({ paid: e.target.value })} placeholder={tk(net)} /></Field>
      <Field label="Payment method"><select value={f.method} onChange={e => set({ method: e.target.value, channel: "", chOther: false })}>{METHODS.map(m => <option key={m}>{m}</option>)}</select></Field>
      {ch && <Field label={f.method === "Mobile banking" ? "Mobile banking service" : "Bank"}><select value={f.chOther ? "__other" : f.channel} onChange={e => set(e.target.value === "__other" ? { chOther: true, channel: "" } : { chOther: false, channel: e.target.value })}>
        <option value="">{f.method === "Mobile banking" ? "— Choose the service —" : "— Choose the bank —"}</option>{ch.map(c => <option key={c} value={c} data-notr>{c}</option>)}<option value="__other">Other (type the name)</option></select></Field>}
      {ch && f.chOther && <Field label={f.method === "Mobile banking" ? "Service name" : "Bank name"}><input type="text" value={f.channel} onChange={e => set({ channel: e.target.value })} maxLength={80} /></Field>}
      <Field label={f.method === "Mobile banking" ? "Transaction ID" : f.method === "Cheque" ? "Cheque No." : "Transaction / Ref No."}><input type="text" value={f.ref} onChange={e => set({ ref: e.target.value })} maxLength={80} placeholder="Optional" /></Field>
      <Field label="Note" full><input type="text" value={f.note} onChange={e => set({ note: e.target.value })} maxLength={300} placeholder="Optional" /></Field>
    </div></div>
    <div className="row between mt14"><button type="button" className="btn" onClick={closeModal}>Cancel</button><button className="btn pri" disabled={busy}><LuBanknote /> {`Pay ${tk(paid)} BDT & make receipt`}</button></div>
  </form>;
}

/** the payer's browser makes the PDF; the server emails it */
export async function mailSalary(id, own) {
  const p = allPays().find(x => x.id === id); if (!p) return;
  try {
    const blob = await salaryPdfBlob(p, store.S.settings);
    const pdf = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
    await act(own ? "staff.salary" : "admin.salary", { op: "mail", id, pdf });
  } catch { toast("The salary receipt PDF could not be made for the email. Try Send by email again."); }
}
export function SalaryView({ id, fresh }) {
  const p = allPays().find(x => x.id === id); const [src, setSrc] = React.useState(null); const S = store.S.settings; const me = user(store.S.session);
  const mine = p?.uid === me?.id, office = !!store.S.salary;
  React.useEffect(() => { let on = true; if (p) drawSalary(p, S).then(c => on && setSrc(c.toDataURL("image/png"))); return () => { on = false; }; }, [p?.id, p?.void, p?.status]);
  if (!p) return <p>Salary receipt not found.</p>;
  const run = f => Promise.resolve(f(p, S)).catch(e => toast(e.message));
  const print = () => { const w = window.open("", "_blank"); if (!w) { toast("Allow pop-ups to print."); return; } w.document.write(`<title>${p.no}</title><style>@page{size:A5 landscape;margin:0}body{margin:0}img{width:100%;display:block}</style><img src="${src}" onload="setTimeout(()=>print(),200)">`); w.document.close(); };
  return <>
    <div className="row between"><h2 className="row6"><LuBanknote /> <span data-notr>{p.no}</span></h2><SalaryStatus p={p} /></div>
    {fresh && <p className="ok-note small">{`Salary saved. ${p.name} gets a request to confirm receiving it. After that it is added to the salary statement${p.email ? " and the receipt is emailed" : ""}.`}</p>}
    {p.status === "problem" && <p className="notice small">{`${p.name} says it was not received: ${p.problem?.text || ""}`}</p>}
    {mine && p.status !== "received" && !p.void && <ReceiveBox p={p} />}
    <div className="mr-preview">{src ? <img src={src} alt={`Salary receipt ${p.no}`} /> : <div className="mr-ph">Making the receipt…</div>}</div>
    <p className="muted small mt8">{`${p.name} · ${monthName(p.month)} · paid ${tk(p.paid)} BDT · ${takaWords(p.paid)}`}</p>
    {p.email && <p className={`small mt8 ${p.mailed?.ok ? "mr-ok" : "muted"}`}>{p.mailed ? (p.mailed.ok ? `Emailed to ${p.mailed.to} · ${fdt(p.mailed.at)}` : `Not emailed to ${p.mailed.to} (${fdt(p.mailed.at)})`) : `Not emailed yet to ${p.email}`}</p>}
    <div className="mr-actions">
      <button className="btn pri" onClick={() => run(salaryPng)}><LuImage /> PNG</button>
      <button className="btn pri" onClick={() => run(salaryPdf)}><LuFileText /> PDF</button>
      <button className="btn" disabled={!src} onClick={print}><LuPrinter /> Print</button>
      {done(p) && p.email && <button className="btn" onClick={() => mailSalary(p.id, mine && !office)}><LuMail /> Send by email</button>}
      <a className="btn" href={salaryUrl(p)} target="_blank" rel="noopener"><LuQrCode /> Verify page</a>
      <span className="grow" />
      {me?.role === "admin" && office && !p.void && <button className="btn danger" onClick={() => confirmBox(`Cancel salary receipt ${p.no}? It is taken out of the salary history and the main account.`, () => act("admin.salary", { op: "void", id: p.id }), "Cancel receipt")}><LuBan /> Cancel receipt</button>}
    </div>
  </>;
}

/* public page: the QR code on a salary receipt opens /s/<code> */
export function VerifySalary({ token }) {
  const [st, setSt] = React.useState({ loading: true }); const [src, setSrc] = React.useState(null);
  React.useEffect(() => {
    let on = true;
    fetch(`/api/salary/${encodeURIComponent(token)}`).then(x => (x.ok ? x.json() : null)).then(async j => {
      if (!on) return; setSt({ p: j?.pay || null });
      if (j?.pay) { const c = await drawSalary(j.pay, store.S.settings || {}); if (on) setSrc(c.toDataURL("image/png")); }
    }).catch(() => on && setSt({ error: true }));
    return () => { on = false; };
  }, [token]);
  const p = st.p;
  return <div className="verify-page mr-vpage">
    <div className="verify-top"><a className="verify-brand" href="/#home"><img src="/brand/logo-w160.webp?v=2" width="64" height="40" alt="" /> <span className="vb-name">MAM &amp; MAM OVERSEAS LTD.</span></a></div>
    <div className="card mr-vcard">
      {st.loading ? <p className="muted">Checking the receipt…</p> : st.error ? <p>No connection to the server. Check your internet and try again.</p>
        : !p ? <><div className="verify-bad"><LuBan /> <span>Receipt not found</span></div><p className="verify-note">{`This QR code does not match a salary receipt of Mam & Mam Overseas Ltd.`}</p></>
        : <>
          {p.void ? <div className="verify-bad"><LuBan /> <span>{`Salary receipt ${p.no} was cancelled`}</span></div>
            : p.status !== "received" ? <div className="verify-bad sal-wait"><LuBanknote /> <span>{`Salary receipt ${p.no}: ${p.status === "problem" ? "the staff member says it was not received" : "waiting for the staff member to confirm"}`}</span></div>
            : <div className="mr-valid"><LuCheck /> <span>{`Valid salary receipt ${p.no}`}</span></div>}
          <dl className="mr-vlist">
            <dt>Paid to</dt><dd data-notr>{p.name}{p.title ? `, ${p.title}` : ""}</dd>
            <dt>Salary month</dt><dd>{monthName(p.month)}</dd>
            <dt>Amount paid</dt><dd><b>{`BDT ${tk(p.paid)}`}</b></dd>
            <dt>Paid on</dt><dd>{rDate(p.date)}</dd>
            <dt>Paid by</dt><dd data-notr>{p.by?.name}{p.by?.title ? `, ${p.by.title}` : ""}</dd>
            {p.recv && <><dt>Received</dt><dd>{rDate(p.recv.at.slice(0, 10))}</dd></>}
          </dl>
          <div className="mr-preview">{src ? <img src={src} alt={`Salary receipt ${p.no}`} /> : <div className="mr-ph">Making the receipt…</div>}</div>
          <div className="mr-actions"><span className="grow" /><a className="btn" href="/#home"><LuExternalLink /> Visit Website</a></div>
        </>}
    </div>
    <p className="verify-foot">Recruiting Licence RL 1217 · {location.host}</p>
  </div>;
}

/* the person's own side: confirm a salary, see their salary statement and receipts */
function ReceiveBox({ p }) {
  const [txt, setTxt] = React.useState(""); const [no, setNo] = React.useState(false);
  const receive = async () => { const r = await act("staff.salary", { op: "receive", id: p.id }); if (r?.email) mailSalary(p.id, true); };
  return <div className="sal-req">
    <b>{`Did you receive BDT ${tk(p.paid)} for ${monthName(p.month)}?`}</b>
    <span className="muted small">{`Paid on ${rDate(p.date)} by ${p.by?.name || "the office"} · ${[p.method, p.channel].filter(Boolean).join(" · ")}${p.ref ? " · " + p.ref : ""}`}</span>
    {no ? <div className="row6"><input type="text" value={txt} onChange={e => setTxt(e.target.value)} maxLength={300} placeholder="What is wrong? e.g. not received yet, amount is less" aria-label="What is wrong" />
      <button className="btn sm danger" onClick={() => act("staff.salary", { op: "problem", id: p.id, text: txt })}>Send</button><button className="btn sm" onClick={() => setNo(false)}>Back</button></div>
      : <div className="row6"><button className="btn pri" onClick={receive}><LuCheck /> Yes, I received it</button><button className="btn" onClick={() => setNo(true)}><LuX /> Not received</button></div>}
  </div>;
}
export function MySalary() {
  const me = user(store.S.session); const M = store.S.mySalary || { pays: [], monthly: null };
  const open = M.pays.filter(p => !p.void && p.status !== "received");
  return <>
    <div className="ec-head"><div><h2>My salary</h2><p className="muted small">{M.monthly != null ? `Monthly salary: ${tk(M.monthly)} BDT. ` : ""}When the office pays your salary, confirm here that you received it. Then it is added to your salary statement and the receipt is emailed to you.</p></div></div>
    {open.length > 0 && <div className="stack mb14">{open.map(p => <div key={p.id} className="card sal-card"><div className="row between"><b>{`Salary ${monthName(p.month)} · ${p.no}`}</b><SalaryStatus p={p} /></div>
      {p.status === "problem" ? <p className="small">{`You said: ${p.problem?.text || "Not received"}. The office will contact you.`}</p> : null}<ReceiveBox p={p} />
      <button className="btn sm link" onClick={() => openModal("salaryView", { id: p.id })}><LuEye /> See the receipt</button></div>)}</div>}
    <div className="card"><Statement title={me?.name || "My salary"} sub={me?.email} kind="SALARY ACCOUNT" heads={["Salary (net)", "Paid"]} balText={b => (b > 0 ? "Still to receive" : b < 0 ? "Received in advance" : "All received")}
      rows={M.pays.filter(done).map(p => ({ id: p.id, date: p.date, details: `Salary ${monthName(p.month)} (${p.no})`, ref: p.ref, rate: way(p.method, p.channel), debit: p.net, credit: p.paid }))}
      empty="No salary received yet."
      actions={r => <button className="ec-ico view" aria-label="View salary receipt" title="View salary receipt" onClick={() => openModal("salaryView", { id: r.id })}><LuEye /></button>} /></div>
  </>;
}
