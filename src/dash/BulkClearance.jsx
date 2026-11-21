import React from "react";
import { LuPlus, LuTrash2, LuSend, LuX, LuUsers, LuGlobe, LuSearch } from "react-icons/lu";
import { CL_REGIONS } from "../constants.js";
import { store, balanceOf, bdtFmt, COUNTRIES } from "../store.js";
import { toast, act } from "../actions.js";
import { Field, Options, ClCountryOptions } from "./shared.jsx";
import { AgentDatalist, bookAgents, bookByName, bookAccount } from "./AgentBook.jsx";

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
  const digits = v => String(v || "").replace(/\D/g, "").slice(-10);
  // an agent's mobile number: registered agents and the agent list
  const agentByPhone = v => { const d = digits(v); if (d.length < 10) return null; const a = agents.find(x => [x.agent?.phone, x.phone, x.profile?.phone].some(y => digits(y) === d)); if (a) return a;
    const b = bookAgents().find(x => digits(x.mobile) === d); return b ? { book: true, name: b.name } : null; };
  // fill a field typed by the person only when it is empty; a field filled automatically is replaced by the new match
  const fill = (r, vals) => { const auto = { ...(r.auto || {}) }, patch = {};
    for (const [k, v] of Object.entries(vals)) if (!String(r[k]).trim() || auto[k]) { patch[k] = v || ""; auto[k] = !!v; }
    return { ...patch, auto }; };
  /* a passport entered before (office passport list, a saved worker, an older clearance file) fills the rest of the row */
  const pickPassport = (r, v) => {
    const p = v.replace(/\s+/g, "").toUpperCase(); const norm = x => String(x || "").replace(/\s+/g, "").toUpperCase();
    const pp = p.length >= 6 ? pps.find(x => norm(x.passport) === p) : null;
    const w = p.length >= 6 ? (S.workers || []).find(x => norm(x.passport) === p) : null;
    const old = w ? [...(S.clearances || [])].reverse().find(c => c.workerId === w.id) : null;
    const wAg = w && (w.agentId ? agents.find(a => a.id === w.agentId) : null), ppAg = pp && pp.agentId ? agents.find(a => a.id === pp.agentId) : null;
    const agent = wAg ? agName(wAg) : w?.agentName || (ppAg ? agName(ppAg) : pp?.ref || "");
    set(r.k, { passport: v, ...(pp || w ? fill(r, { name: w?.name || pp?.name, phone: w?.phone || "", icNo: old?.icNo || "", agent }) : fill(r, { name: "", phone: "", icNo: "", agent: "" })) });
  };
  /* mobile number: an agent's number puts that agent in the row; any other number means the candidate came direct (Self) */
  const pickPhone = (r, v) => {
    const a = agentByPhone(v), d = digits(v), auto = { ...(r.auto || {}) }, empty = !r.agent.trim(), fromPhone = auto.agent === "phone";
    let agent = r.agent;
    if (a && (empty || auto.agent)) { agent = a.book ? a.name : agName(a); auto.agent = "phone"; }
    else if (!a && d.length >= 10 && (empty || fromPhone)) { agent = "Self"; auto.agent = "phone"; }
    else if (d.length < 10 && fromPhone) { agent = ""; auto.agent = false; }
    set(r.k, { phone: v, agent, auto });
  };
  /* RAIMS search: an IC number or application ID → one row for each worker under it */
  const [ric, setRic] = React.useState(""), [rbusy, setRbusy] = React.useState(false);
  const allCountries = [...Object.keys(COUNTRIES), ...CL_REGIONS.flatMap(([, L]) => L)];
  const findCountry = v => { const k = String(v || "").trim().toLowerCase(); return allCountries.find(c => c.toLowerCase() === k) || allCountries.find(c => k && (k.includes(c.toLowerCase()) || c.toLowerCase().includes(k))) || ""; };
  const raimsSearch = async () => {
    if (ric.trim().length < 3) return toast("Enter the IC number or application ID.");
    setRbusy(true); const r = await act("admin.raims", { op: "lookup", q: ric.trim() }); setRbusy(false);
    if (!r?.people?.length) return;
    const have = new Set(rows.map(x => x.passport.replace(/\s+/g, "").toUpperCase()).filter(Boolean));
    const fresh = r.people.filter(x => !have.has(String(x.passport || "").toUpperCase()));
    const made = fresh.map(x => { const b = blank(); const pp = pps.find(y => y.passport === x.passport), w = (S.workers || []).find(y => String(y.passport).toUpperCase() === x.passport);
      const wAg = w?.agentId ? agents.find(a => a.id === w.agentId) : null;
      return { ...b, passport: x.passport || "", name: x.name || pp?.name || w?.name || "", icNo: x.ic || "", phone: w?.phone || "", agent: wAg ? agName(wAg) : w?.agentName || pp?.ref || "", auto: { name: !x.name, agent: true, phone: true } }; });
    setRows(L => { const keep = L.filter(filled); const out = [...keep, ...made]; while (out.length < 5) out.push(blank()); return out; });
    const c = [...new Set(r.people.map(x => findCountry(x.country)).filter(Boolean))];
    if (c.length === 1) setCommon(v => ({ ...v, country: c[0] }));
    toast(`${made.length} row${made.length === 1 ? "" : "s"} added from RAIMS${fresh.length < r.people.length ? ` (${r.people.length - fresh.length} already in the list)` : ""}.${c.length > 1 ? " The workers go to different countries: check the destination." : ""}`);
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
    const payload = { ...common, rows: used.map(r => { const a = findAg(r.agent); return { passport: r.passport.trim(), name: r.name.trim(), icNo: r.icNo.trim(), phone: agentByPhone(r.phone) ? "" : r.phone.trim(), ...(a ? { agentId: a.id } : { agentName: r.agent.trim() }), fee: r.fee, due: r.due }; }) };
    const res = await act("admin.clearanceBulk", payload);
    setBusy(false);
    if (res) { setRows(Array.from({ length: 5 }, blank)); onDone && onDone(); }
  };
  return (
    <div className="bulk-ec">
      <div className="card">
        <h3 className="bulk-h"><LuSearch /> Search RAIMS</h3>
        <div className="bulk-raims"><input type="text" value={ric} onChange={e => setRic(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); raimsSearch(); } }} placeholder="IC number or application ID" aria-label="IC number or application ID" style={{ textTransform: "uppercase" }} maxLength={60} />
          <button type="button" className="btn pri" disabled={rbusy} onClick={raimsSearch}><LuSearch /> {rbusy ? "Searching RAIMS…" : "Search"}</button></div>
        <p className="muted small mt8">{store.S.raims?.saved ? "Every worker under this number is added as a row with the name, passport number and IC number, and the country is set." : "Set the RAIMS sign-in first (RAIMS button above)."}</p>
      </div>
      <div className="card">
        <h3 className="bulk-h"><LuGlobe /> Same for all rows</h3>
        <div className="fgrid">
          <Field label="Destination country *"><select value={common.country} onChange={e => setCommon({ ...common, country: e.target.value })}><ClCountryOptions /></select></Field>
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
              <td><input type="text" value={r.name} maxLength={120} placeholder="Full name" onChange={e => set(r.k, { name: e.target.value, auto: { ...(r.auto || {}), name: false } })} aria-label="Candidate name" /></td>
              <td><input type="text" value={r.icNo} maxLength={40} placeholder="Optional" onChange={e => set(r.k, { icNo: e.target.value, auto: { ...(r.auto || {}), icNo: false } })} aria-label="IC No." /></td>
              <td><input type="tel" value={r.phone} maxLength={30} placeholder="Candidate or agent" onChange={e => pickPhone(r, e.target.value)} aria-label="Mobile" /></td>
              <td><input type="text" value={r.agent} list="bulk-agent-list" maxLength={120} placeholder="Select or type" onChange={e => set(r.k, { agent: e.target.value, auto: { ...(r.auto || {}), agent: false } })} aria-label="Agent" />
                {r.agent.trim() && (() => { const bk = !a && bookByName(r.agent), bd = bk ? bookAccount(bk).due : 0;
                  return <div className={`bulk-hint ${(a ? bal : bd) > 0 ? "bad" : "muted"}`}>{a ? (bal > 0 ? `Due now: ${bdtFmt(bal)}` : "No due") : r.agent.trim().toLowerCase() === "self" ? "Self (no agent)" : bk ? (bd > 0 ? `Agent list · due ${bdtFmt(bd)}` : "Agent list") : "New name: added to the agent list"}</div>; })()}</td>
              <td><input type="number" min="0" step="any" value={r.fee} placeholder={defFee ? String(defFee) : "0"} onChange={e => set(r.k, { fee: e.target.value })} aria-label="Processing fee" /></td>
              <td><input type="number" min="0" step="any" value={r.due} placeholder="0" onChange={e => set(r.k, { due: e.target.value })} aria-label="Due amount" /></td>
              <td><button type="button" className="ec-ico del" title="Remove row" aria-label="Remove row" onClick={() => setRows(L => L.length > 1 ? L.filter(x => x.k !== r.k) : [blank()])}><LuX /></button></td>
            </tr>); })}
        </tbody></table></div>
        <datalist id="bulk-pp-list">{pps.map(x => <option key={x.id} value={x.passport}>{`${x.name} · ${x.country}`}</option>)}</datalist>
        <AgentDatalist id="bulk-agent-list" />
        <p className="muted small mt8">{`Empty rows are skipped. Processing fee: leave it blank to use the default${defFee ? ` (${bdtFmt(defFee)})` : ""}. Due amount: an older amount the agent still owes. For a registered agent, the fee and the due are added to the agent's account. Mobile: an agent's number fills in that agent; any other number fills in Self. A passport entered before fills in the rest of the row. Passport, visa and contract copies can be added later from Details.`}</p>
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
