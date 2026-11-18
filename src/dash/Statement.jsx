// Payment history table (Date · Details · Rate · Debit · Credit · Balance) with a date range and PDF / Excel downloads.
import React from "react";
import { LuFileText, LuFileSpreadsheet, LuX } from "react-icons/lu";
import { withBalance, statementPdf, statementXlsx, sdate, amt, balWord } from "../statement.js";
import { toast } from "../actions.js";
import { Empty } from "../ui.jsx";

export function Statement({ title, sub, kind = "PAYMENT HISTORY", rows, actions, empty = "No entries yet." }) {
  const [from, setFrom] = React.useState(""); const [to, setTo] = React.useState("");
  const calc = withBalance(rows, from, to); const st = { title, sub, kind, from, to, calc };
  const run = f => Promise.resolve(f(st)).catch(e => toast(e.message || "The file could not be made."));
  const b = calc.balance;
  return <div className="st">
    <div className="st-sum">
      <div><span>Total debit</span><b className="num">{amt(calc.debit)}</b></div>
      <div><span>Total credit</span><b className="num">{amt(calc.credit)}</b></div>
      <div className={b > 0 ? "due" : "ok"}><span>{balWord(b)}</span><b className="num">{amt(Math.abs(b))}</b></div>
    </div>
    <div className="st-tools">
      <label className="st-date">From <input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
      <label className="st-date">To <input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
      {(from || to) && <button className="btn sm link" onClick={() => { setFrom(""); setTo(""); }}><LuX /> All dates</button>}
      <span className="grow" />
      <button className="btn sm pri" disabled={!rows.length} onClick={() => run(statementPdf)}><LuFileText /> PDF</button>
      <button className="btn sm pri" disabled={!rows.length} onClick={() => run(statementXlsx)}><LuFileSpreadsheet /> Excel</button>
    </div>
    {calc.rows.length ? <div className="tbl st-tbl"><table><thead><tr><th>DATE</th><th>Details</th><th>RATE</th><th className="r">Debit</th><th className="r">Credit</th><th className="r">Balance</th>{actions && <th />}</tr></thead><tbody>
      {calc.rows.map(r => <tr key={r.id} className={r.pending ? "dim" : r.opening ? "st-open" : ""}>
        <td className="num nowrap">{sdate(r.date)}</td>
        <td className="b">{r.details}{r.pending && <span className="ec-badge mr-wait ms6">Pending</span>}{r.ref && <div className="muted small">{`Ref ${r.ref}`}</div>}</td>
        <td className="st-rate">{r.rate}</td>
        <td className="num r">{r.debit ? amt(r.debit) : ""}</td>
        <td className="num r">{r.credit ? amt(r.credit) : ""}</td>
        <td className={`num r b ${r.balance > 0 ? "st-due" : "st-ok"}`}>{r.balance == null ? "—" : amt(r.balance)}</td>
        {actions && <td>{!r.opening && actions(r)}</td>}
      </tr>)}
      <tr className="st-total"><td /><td>Total</td><td /><td className="num r">{amt(calc.debit)}</td><td className="num r">{amt(calc.credit)}</td><td className={`num r ${b > 0 ? "st-due" : "st-ok"}`}>{`${amt(Math.abs(b))} ${b > 0 ? "Due" : b < 0 ? "Adv." : ""}`}</td>{actions && <td />}</tr>
    </tbody></table></div> : <Empty>{from || to ? "No entries in these dates." : empty}</Empty>}
  </div>;
}
