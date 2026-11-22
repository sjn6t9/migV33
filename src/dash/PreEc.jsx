// Pre EC Check: the agency's RAIMS account checks a passport (BMET registration, finger, availability, alerts).
// Admin/staff with the BMET clearance permission, and agents, can use it.
import React from "react";
import { LuSearch, LuTriangleAlert, LuShieldCheck, LuX, LuCircleCheck, LuCircleX } from "react-icons/lu";
import { store } from "../store.js";
import { act, toast } from "../actions.js";
import { Field } from "./shared.jsx";

const good = v => /^(success|available|yes|valid|verified|active|eligible|ok|passed)$/i.test(String(v).trim());
const bad = v => /^(fail(ed)?|not available|unavailable|no|invalid|expired|blocked|ineligible|not found|pending)$/i.test(String(v).trim());

export function PreEcCheck({ onClose }) {
  const [f, setF] = React.useState({ returnee: "no", other: "", passport: "" });
  const [busy, setBusy] = React.useState(false), [res, setRes] = React.useState(null);
  const ready = store.S.raimsReady ?? !!store.S.raims?.saved;
  const go = async e => {
    e?.preventDefault(); const pp = f.passport.replace(/\s+/g, "").toUpperCase();
    if (pp.length < 6) return toast("Enter the passport number.");
    if (f.returnee === "other" && f.other.replace(/\s+/g, "").length < 6) return toast("Enter the returnee's other passport number.");
    setBusy(true); setRes(null); const r = await act("raims.preEc", { passport: pp, returnee: f.returnee, otherPassport: f.other.replace(/\s+/g, "").toUpperCase() }, { quiet: true }); setBusy(false);
    if (r) setRes(r);
  };
  return <div className="card preec">
    <div className="row between"><h3 className="bulk-h"><LuShieldCheck /> Pre EC Check</h3>{onClose && <button type="button" className="btn sm link" onClick={onClose} aria-label="Close"><LuX /></button>}</div>
    {!ready ? <p className="muted small">The admin has not signed in to RAIMS yet (BMET clearance › RAIMS).</p> : <form className="fgrid" onSubmit={go} noValidate>
      <Field label="Has returnee? *" full><select value={f.returnee} onChange={e => setF({ ...f, returnee: e.target.value })}><option value="no">No</option><option value="same">Returnee with same passport</option><option value="other">Returnee with other passport</option></select></Field>
      {f.returnee === "other" && <Field label="Returnee other passport no. *" full><input type="text" value={f.other} maxLength={15} autoCapitalize="characters" autoCorrect="off" spellCheck={false} onChange={e => setF({ ...f, other: e.target.value.toUpperCase() })} placeholder="Passport no" /></Field>}
      <Field label="Passport number *" full><div className="preec-pp"><input type="text" value={f.passport} maxLength={15} autoCapitalize="characters" autoCorrect="off" spellCheck={false} onChange={e => setF({ ...f, passport: e.target.value.toUpperCase() })} placeholder="A12345678" />
        <button className="btn pri" disabled={busy}><LuSearch /> {busy ? "Checking…" : "Search"}</button></div></Field>
    </form>}
    {res && (res.ok ? <div className="preec-res">
      <h4 className="mt14 mb6">Employee information</h4>
      {res.alerts.map((a, i) => <div key={i} className="preec-alert"><LuTriangleAlert /> <span data-notr>{a}</span></div>)}
      <div className="preec-grid">{res.fields.map(([k, v], i) => <div key={i} className={`preec-f${good(v) ? " ok" : bad(v) ? " bad" : ""}`}><span>{k}</span><b data-notr dir="auto">{good(v) ? <LuCircleCheck /> : bad(v) ? <LuCircleX /> : null}{v}</b></div>)}</div>
    </div> : <div className="mt10"><p className="vf-err small">{res.problem}</p>
      {res.page && <details className="vf-det small"><summary>What RAIMS showed</summary><p className="muted" data-notr>{`${(res.tried || []).join(" · ")} — ${res.page}`}</p></details>}</div>)}
  </div>;
}
