// Payment history table (Date · Details · Rate · Debit · Credit · Balance) with a date range and PDF / Excel downloads.
import React from "react";
import { LuFileText, LuFileSpreadsheet, LuX, LuPencil, LuCheck } from "react-icons/lu";
import { withBalance, statementPdf, statementXlsx, sdate, amt, balWord } from "../statement.js";
import { toast } from "../actions.js";
import { Empty } from "../ui.jsx";

/* RATE cell: staff can change rate × quantity of a charge (old entries were saved as amount × 1) */
function RateCell({ r, onSave }) {
  const [ed, setEd] = React.useState(null);
  if (!onSave || !r.rq) return <td className="st-rate">{r.rate}</td>;
  if (!ed) return <td className="st-rate"><button type="button" className="st-rate-btn" title="Change rate × quantity" onClick={() => setEd({ rate: String(r.rq.rate), qty: String(r.rq.qty) })}>{r.rate} <LuPencil /></button></td>;
  const total = (Number(ed.rate) || 0) * (Number(ed.qty) || 0);
  const save = async e => { e.preventDefault(); if (!(Number(ed.rate) > 0) || !(Number(ed.qty) >= 1)) { toast("Enter the rate and quantity."); return; } if (await onSave(r, { rate: Number(ed.rate), qty: Math.round(Number(ed.qty)) })) setEd(null); };
  return <td className="st-rate st-rate-ed"><form onSubmit={save} className="st-rq">
    <input type="number" min="1" value={ed.rate} onChange={e => setEd({ ...ed, rate: e.target.value })} aria-label="Rate" autoFocus />
    <span>X</span>
    <input type="number" min="1" step="1" value={ed.qty} onChange={e => setEd({ ...ed, qty: e.target.value })} aria-label="Quantity" className="q" />
    <button className="btn sm pri" aria-label="Save"><LuCheck /></button><button type="button" className="btn sm" aria-label="Cancel" onClick={() => setEd(null)}><LuX /></button>
    <small className="muted">{`= ${amt(total)}`}</small>
  </form></td>;
}

const stime = iso => { try { return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dhaka" }); } catch { return ""; } };
export function Statement({ title, sub, kind = "PAYMENT HISTORY", rows, actions, onRate, cash, heads, balText, tools, times, empty = "No entries yet." }) {
  const [from, setFrom] = React.useState(""); const [to, setTo] = React.useState("");
  const calc = withBalance(rows, from, to); const st = { title, sub, kind, from, to, calc, cash, times };
  const run = f => Promise.resolve(f(st)).catch(e => toast(e.message || "The file could not be made."));
  const b = calc.balance;
  const acts = actions ? calc.rows.map(r => (r.opening ? null : actions(r))) : [], hasActs = acts.some(Boolean); // no empty column when no row has a button
  return <div className="st">
    <div className="st-sum">
      <div><span>{heads?.[0] || (cash ? "Money in" : "Total debit")}</span><b className="num">{amt(calc.debit)}</b></div>
      <div><span>{heads?.[1] || (cash ? "Money out" : "Total credit")}</span><b className="num">{amt(calc.credit)}</b></div>
      <div className={(cash ? b < 0 : b > 0) ? "due" : "ok"}><span>{balText ? balText(b) : balWord(b, cash)}</span><b className="num">{amt(cash ? b : Math.abs(b))}</b></div>
    </div>
    <div className="st-tools">
      <label className="st-date">From <input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
      <label className="st-date">To <input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
      {(from || to) && <button className="btn sm link" onClick={() => { setFrom(""); setTo(""); }}><LuX /> All dates</button>}
      <span className="grow" />
      {tools ? tools(st) : <>
      <button className="btn sm pri" disabled={!rows.length} onClick={() => run(statementPdf)}><LuFileText /> PDF</button>
      <button className="btn sm pri" disabled={!rows.length} onClick={() => run(statementXlsx)}><LuFileSpreadsheet /> Excel</button></>}
    </div>
    {calc.rows.length ? <div className="tbl st-tbl"><table><thead><tr><th>DATE</th><th>Details</th><th>RATE</th><th className="r">{heads?.[0] || "Debit"}</th><th className="r">{heads?.[1] || "Credit"}</th><th className="r">Balance</th>{hasActs && <th className="st-act" />}</tr></thead><tbody>
      {calc.rows.map((r, i) => <tr key={r.id} className={r.pending ? "dim" : r.opening ? "st-open" : ""}>
        <td className="num nowrap">{sdate(r.date)}{times && r.at && !r.opening && <div className="muted small st-time">{stime(r.at)}</div>}</td>
        <td className="b">{r.details}{r.pending && <span className="ec-badge mr-wait ms6">Pending</span>}{r.ref && <div className="muted small">{`Ref ${r.ref}`}</div>}{r.sub && <div className="muted small">{r.sub}</div>}</td>
        <RateCell r={r} onSave={onRate} />
        <td className="num r">{r.debit ? amt(r.debit) : ""}</td>
        <td className="num r">{r.credit ? amt(r.credit) : ""}</td>
        <td className={`num r b ${(cash ? r.balance < 0 : r.balance > 0) ? "st-due" : "st-ok"}`}>{r.balance == null ? "—" : amt(r.balance)}</td>
        {hasActs && <td className="st-act">{acts[i]}</td>}
      </tr>)}
      <tr className="st-total"><td /><td>Total</td><td /><td className="num r">{amt(calc.debit)}</td><td className="num r">{amt(calc.credit)}</td><td className={`num r ${(cash ? b < 0 : b > 0) ? "st-due" : "st-ok"}`}>{cash ? amt(b) : `${amt(Math.abs(b))} ${b > 0 ? "Due" : b < 0 ? "Adv." : ""}`}</td>{hasActs && <td />}</tr>
    </tbody></table></div> : <Empty>{from || to ? "No entries in these dates." : empty}</Empty>}
  </div>;
}
