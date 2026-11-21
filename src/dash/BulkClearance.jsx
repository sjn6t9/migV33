import React from "react";
import { LuPlus, LuTrash2, LuSend, LuX, LuUsers, LuGlobe } from "react-icons/lu";
import { store, balanceOf, bdtFmt, COUNTRIES } from "../store.js";
import { toast, act } from "../actions.js";
import { Field, Options } from "./shared.jsx";

/* Admin/staff: many BMET clearance files at once. Destination and employer are the same for every row;
   each row is one candidate with their own agent (registered or a typed name), processing fee and previous due. */
let seq = 1;
const blank = () => ({ k: seq++, passport: "", name: "", icNo: "", phone: "", agent: "", fee: "", due: "" });
const filled = r => [r.passport, r.name, r.icNo, r.phone, r.agent, r.fee, r.due].some(v => String(v).trim());

export function BulkEcForm({ onDone }) {
  const S = store.S; const defFee = Number(S.settings.clearanceFee || 0);
  const agents = (S.users || []).filter(x => x.role === "agent");
  const agName = a => a.agent?.business || a.name;
  const findAg = t => agents.find(a => agName(a).trim().toLowerCase() === String(t).trim().toLowerCase());
  const pps = S.passports || [];
  const [rows, setRows] = React.useState(() => Array.from({ length: 5 }, blank));
  const [common, setCommon] = React.useState({ country: "Saudi Arabia", employer: "", visaType: "Work visa", flightDate: "", notes: "" });
  const [busy, setBusy] = React.useState(false);
  const set = (k, patch) => setRows(L => L.map(r => r.k === k ? { ...r, ...patch } : r));
  const pickPassport = (r, v) => {
    const p = v.replace(/\s+/g, "").toUpperCase(); const pp = pps.find(x => x.passport === p);
    set(r.k, { passport: v, ...(pp ? { name: r.name.trim() ? r.name : pp.name, agent: r.agent.trim() ? r.agent : pp.ref || "" } : {}) });
  };
  const used = rows.filter(filled);
  const submit = async () => {
    if (!used.length) return toast("Fill in at least one row.");
    for (const [i, r] of rows.entries()) {
      if (!filled(r)) continue;
      if (!r.passport.trim() || r.name.trim().length < 2) return toast(`Row ${i + 1}: enter the passport number and candidate name.`);
      if (!r.agent.trim()) return toast(`Row ${i + 1}: select the agent or write a name.`);
    }
    setBusy(true);
    const payload = { ...common, rows: used.map(r => { const a = findAg(r.agent); return { passport: r.passport.trim(), name: r.name.trim(), icNo: r.icNo.trim(), phone: r.phone.trim(), ...(a ? { agentId: a.id } : { agentName: r.agent.trim() }), fee: r.fee, due: r.due }; }) };
    const res = await act("admin.clearanceBulk", payload);
    setBusy(false);
    if (res) { setRows(Array.from({ length: 5 }, blank)); onDone && onDone(); }
  };
  return (
    <div className="bulk-ec">
      <div className="card">
        <h3 className="bulk-h"><LuGlobe /> Same for all rows</h3>
        <div className="fgrid">
          <Field label="Destination country *"><select value={common.country} onChange={e => setCommon({ ...common, country: e.target.value })}><Options list={Object.keys(COUNTRIES)} /></select></Field>
          <Field label="Employer / sponsor name (optional)"><input type="text" value={common.employer} maxLength={150} onChange={e => setCommon({ ...common, employer: e.target.value })} /></Field>
          <Field label="Visa type"><select value={common.visaType} onChange={e => setCommon({ ...common, visaType: e.target.value })}><Options list={["Work visa", "Free visa", "Group visa", "Other"]} /></select></Field>
          <Field label="Planned flight date (optional)"><input type="date" value={common.flightDate} onChange={e => setCommon({ ...common, flightDate: e.target.value })} /></Field>
        </div>
      </div>
      <div className="card">
        <h3 className="bulk-h"><LuUsers /> Candidate rows <span className="bulk-count">{used.length}</span></h3>
        <div className="tbl bulk-tbl"><table><thead><tr><th>#</th><th>Passport No. *</th><th>Candidate name *</th><th>IC No.</th><th>Mobile</th><th>Agent *</th><th>Processing fee</th><th>Due amount</th><th /></tr></thead><tbody>
          {rows.map((r, i) => { const a = r.agent.trim() && findAg(r.agent); const bal = a ? balanceOf(a.id) : 0; return (
            <tr key={r.k}>
              <td><span className="bulk-no">{i + 1}</span></td>
              <td><input type="text" value={r.passport} list="bulk-pp-list" maxLength={30} placeholder="Passport No." style={{ textTransform: "uppercase" }} onChange={e => pickPassport(r, e.target.value)} aria-label="Passport No." /></td>
              <td><input type="text" value={r.name} maxLength={120} placeholder="Full name" onChange={e => set(r.k, { name: e.target.value })} aria-label="Candidate name" /></td>
              <td><input type="text" value={r.icNo} maxLength={40} placeholder="Optional" onChange={e => set(r.k, { icNo: e.target.value })} aria-label="IC No." /></td>
              <td><input type="tel" value={r.phone} maxLength={30} placeholder="Optional" onChange={e => set(r.k, { phone: e.target.value })} aria-label="Mobile" /></td>
              <td><input type="text" value={r.agent} list="bulk-agent-list" maxLength={120} placeholder="Select or type" onChange={e => set(r.k, { agent: e.target.value })} aria-label="Agent" />
                {r.agent.trim() && <div className={`bulk-hint ${a ? (bal > 0 ? "bad" : "muted") : "muted"}`}>{a ? (bal > 0 ? `Due now: ${bdtFmt(bal)}` : "No due") : "Custom name"}</div>}</td>
              <td><input type="number" min="0" step="any" value={r.fee} placeholder={defFee ? String(defFee) : "0"} onChange={e => set(r.k, { fee: e.target.value })} aria-label="Processing fee" /></td>
              <td><input type="number" min="0" step="any" value={r.due} placeholder="0" onChange={e => set(r.k, { due: e.target.value })} aria-label="Due amount" /></td>
              <td><button type="button" className="ec-ico del" title="Remove row" aria-label="Remove row" onClick={() => setRows(L => L.length > 1 ? L.filter(x => x.k !== r.k) : [blank()])}><LuX /></button></td>
            </tr>); })}
        </tbody></table></div>
        <datalist id="bulk-pp-list">{pps.map(x => <option key={x.id} value={x.passport}>{`${x.name} · ${x.country}`}</option>)}</datalist>
        <datalist id="bulk-agent-list">{agents.map(a => <option key={a.id} value={agName(a)} />)}</datalist>
        <p className="muted small mt8">{`Empty rows are skipped. Processing fee: leave it blank to use the default${defFee ? ` (${bdtFmt(defFee)})` : ""}. Due amount: an older amount the agent still owes. For a registered agent, the fee and the due are added to the agent's account. Passport, visa and contract copies can be added later from Details.`}</p>
        <div className="bulk-foot">
          <div className="bulk-btns">
            <button type="button" className="btn sm" onClick={() => setRows(L => [...L, blank()])}><LuPlus /> Add row</button>
            <button type="button" className="btn sm" onClick={() => setRows(L => [...L, ...Array.from({ length: 5 }, blank)])}><LuPlus /><LuPlus /> Add 5 rows</button>
            <button type="button" className="btn sm danger" onClick={() => setRows(Array.from({ length: 5 }, blank))}><LuTrash2 /> Clear all</button>
          </div>
          <button type="button" className="btn pri" disabled={busy || !used.length} onClick={submit}><LuSend /> {busy ? "Saving…" : `Submit all (${used.length})`}</button>
        </div>
      </div>
    </div>
  );
}
