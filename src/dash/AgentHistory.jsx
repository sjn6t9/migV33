// Agent history (admin/staff): what an agent did on the site, with the IP address, the place it belongs to and the device.
import React from "react";
import { LuHistory, LuRefreshCw, LuSearch } from "react-icons/lu";
import { act } from "../actions.js";
import { Empty } from "../ui.jsx";

const when = s => { try { return new Date(s).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return s; } };
const KINDS = [["", "All"], ["pay", "Payments"], ["preec", "Pre EC Check"], ["auth", "Sign-ins"], ["work", "Files & workers"]];
const kindOf = t => /payment|clPayment/i.test(t) ? "pay" : t === "raims.preEc" ? "preec" : t.startsWith("auth.") ? "auth" : "work";

function useLog(payload) {
  const [log, setLog] = React.useState(null), [busy, setBusy] = React.useState(false);
  const load = React.useCallback(async () => { setBusy(true); const r = await act("admin.agentLog", payload, { quiet: true }); setBusy(false); setLog(r ? r.log || [] : []); }, [JSON.stringify(payload)]);
  React.useEffect(() => { load(); }, [load]);
  return [log, busy, load];
}
const Where = ({ x }) => <td className="small" data-notr>{x.ip ? <><b className="num">{x.ip}</b>{x.loc && <div className="muted">{x.loc}</div>}</> : <span className="muted">—</span>}{x.device && <div className="muted">{x.device}</div>}</td>;

/* one agent's history, newest first: payments, Pre EC checks, sign-ins, files */
export function AgentHistory({ agentId }) {
  const [log, busy, load] = useLog({ agentId });
  const [k, setK] = React.useState(""), [q, setQ] = React.useState("");
  const s = q.trim().toLowerCase();
  const rows = (log || []).filter(x => (!k || kindOf(x.type) === k) && (!s || [x.what, x.detail, x.passport, x.ip, x.loc].join(" ").toLowerCase().includes(s)));
  return <div className="card mt14">
    <div className="row between"><h3 className="bulk-h"><LuHistory /> History <span className="bulk-count">{log ? log.length : "…"}</span></h3>
      <button className="btn sm soft" disabled={busy} onClick={load}><LuRefreshCw /> Refresh</button></div>
    <p className="muted small">Payments, Pre EC checks, sign-ins and files, with the IP address, its place and the device.</p>
    <div className="pay-tabs mt8">{KINDS.map(([v, l]) => <button key={v} className={`btn sm ${k === v ? "dark" : "soft"}`} onClick={() => setK(v)}>{l}</button>)}</div>
    <label className="ec-search mr-search mt8"><input type="text" value={q} placeholder="Search passport, IP or place" onChange={e => setQ(e.target.value)} /><LuSearch /></label>
    {!log ? <p className="muted small mt8">Loading…</p> : rows.length ? <div className="tbl vf-tbl mt8"><table><thead><tr><th>SL</th><th>Date &amp; time</th><th>Activity</th><th>Details</th><th>IP / place / device</th></tr></thead><tbody>
      {rows.map((x, i) => <tr key={x.id}><td className="num">{i + 1}</td><td className="nowrap small">{when(x.at)}</td><td className="b">{x.what}</td>
        <td className="small" data-notr>{x.passport && <b className="num">{x.passport} </b>}{x.detail}</td><Where x={x} /></tr>)}
    </tbody></table></div> : <Empty>No history yet.</Empty>}
  </div>;
}

/* for the admin in Pre EC Check: which passports the agents checked */
export function AgentPreEcLog() {
  const [log, busy, load] = useLog({ preEc: true });
  const [q, setQ] = React.useState(""); const s = q.trim().toLowerCase();
  const rows = (log || []).filter(x => !s || [x.agent, x.passport, x.detail, x.ip, x.loc].join(" ").toLowerCase().includes(s));
  return <details className="vf-det mt14 preec-log">
    <summary><LuHistory /> Agents' Pre EC checks {log && <span className="bulk-count">{log.length}</span>}</summary>
    <div className="row between mt8"><label className="ec-search mr-search"><input type="text" value={q} placeholder="Agent, passport, IP" onChange={e => setQ(e.target.value)} /><LuSearch /></label>
      <button className="btn sm soft" disabled={busy} onClick={load}><LuRefreshCw /> Refresh</button></div>
    {!log ? <p className="muted small">Loading…</p> : rows.length ? <div className="tbl vf-tbl mt8"><table><thead><tr><th>SL</th><th>Date &amp; time</th><th>Agent</th><th>Passport</th><th>Result</th><th>IP / place / device</th></tr></thead><tbody>
      {rows.map((x, i) => <tr key={x.id}><td className="num">{i + 1}</td><td className="nowrap small">{when(x.at)}</td><td className="b" data-notr>{x.agent}</td><td className="num" data-notr>{x.passport}</td><td className="small" data-notr>{x.detail}</td><Where x={x} /></tr>)}
    </tbody></table></div> : <Empty>No agent has used Pre EC Check yet.</Empty>}
  </details>;
}
