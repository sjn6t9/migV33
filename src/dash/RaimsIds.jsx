import React, { useState } from "react";
import { LuKeyRound, LuPlus, LuRefreshCw, LuTrash2, LuX, LuCircleCheck, LuCircleAlert, LuEye, LuEyeOff, LuPencil, LuLockKeyhole } from "react-icons/lu";
import { store } from "../store.js";
import { act, confirmBox, formData } from "../actions.js";

/* Website › RAIMS IDs: more RAIMS sign-ins besides the main one, so their EC application lists are read here too */
const when = x => (x ? new Date(x).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Dhaka" }) : "—");
function Last({ l }) {
  if (!l) return <span className="muted small">Not read yet</span>;
  return l.ok ? <span className="ri-st ok"><LuCircleCheck /> {`${l.rows} files read · ${l.updated} updated · ${when(l.at)}`}</span>
    : <span className="ri-st bad"><LuCircleAlert /> {l.error || "Could not read RAIMS"} · {when(l.at)}</span>;
}
const pwIssue = l => l && !l.ok && /did not accept|password|sign-?in|signed in/i.test(l.error || "");
/* a new password for a RAIMS ID (RAIMS asks for a change every so often); RAIMS is asked first, and a wrong one keeps the old sign-in */
function NewPass({ onSave, onClose, email }) {
  const [show, setShow] = useState(false), busy = store.ui.busy;
  const submit = async e => { const [d] = formData(e); if (d.password !== d.password2) return; if (await onSave(d.password)) onClose(); };
  return <form className="ri-newpw" onSubmit={submit}>
    <b><LuLockKeyhole /> New password for <span data-notr>{email}</span></b>
    <p className="muted small">Type the password RAIMS uses now. It is checked with RAIMS before it is saved; if RAIMS does not accept it, the old one stays.</p>
    <div className="ri-pwrow">
      <div className="ri-pass"><input type={show ? "text" : "password"} name="password" required autoComplete="new-password" placeholder="New RAIMS password" autoFocus />
        <button type="button" className="btn sm link" onClick={() => setShow(x => !x)} aria-label={show ? "Hide password" : "Show password"}>{show ? <LuEyeOff /> : <LuEye />}</button></div>
      <input type={show ? "text" : "password"} name="password2" required autoComplete="new-password" placeholder="Type it again"
        onInput={e => e.target.setCustomValidity(e.target.value === e.target.form.password.value ? "" : "The two passwords are not the same.")} />
      <button className="btn pri" type="submit" disabled={busy}>Save password</button>
      <button type="button" className="btn" onClick={onClose}><LuX /> Cancel</button>
    </div>
  </form>;
}
export function RaimsIds() {
  const R = store.S.raimsIds || { main: null, list: [] }, busy = store.ui.busy;
  const [adding, setAdding] = useState(false), [edit, setEdit] = useState(null), [show, setShow] = useState(false), [syncing, setSyncing] = useState(""), [pw, setPw] = useState(null);
  const savePw = (a, password) => a === "main" ? act("admin.raims", { op: "save", email: R.main.email, password, auto: R.main.auto !== false }) : act("admin.raimsIds", { op: "edit", id: a.id, label: a.label, auto: a.auto, password });
  const add = async e => { const [d] = formData(e); const r = await act("admin.raimsIds", { op: "add", email: d.email, password: d.password, label: d.label, auto: !!d.auto }); if (r) { e.target.reset(); setAdding(false); } };
  const save = async (e, a) => { const [d] = formData(e); const r = await act("admin.raimsIds", { op: "edit", id: a.id, label: d.label, password: d.password || "", auto: !!d.auto }); if (r) setEdit(null); };
  const sync = async a => { setSyncing(a.id); await act("admin.raimsIds", { op: "sync", id: a.id }); setSyncing(""); };
  const del = a => confirmBox(`Log out of RAIMS and remove ${a.email}? Files already updated stay as they are.`, () => act("admin.raimsIds", { op: "del", id: a.id }), "Remove");
  const Pass = ({ req }) => <label className="f">RAIMS password<div className="ri-pass"><input type={show ? "text" : "password"} name="password" required={req} autoComplete="new-password" placeholder={req ? "" : "New password (leave empty to keep it)"} />
    <button type="button" className="btn sm link" onClick={() => setShow(x => !x)} aria-label={show ? "Hide password" : "Show password"}>{show ? <LuEyeOff /> : <LuEye />}</button></div></label>;
  return <>
    <div className="ec-head"><div><h2><LuKeyRound /> RAIMS IDs</h2>
      <p className="muted small">Add the other RAIMS (raims.oep.gov.bd) IDs your office uses. Each ID is signed in on this server and its EC application list is read like the main one — every 15 minutes and on Sync now in BMET clearance — so those files' RAIMS status shows here too.</p></div>
      {!adding && <button className="btn pri" onClick={() => setAdding(true)}><LuPlus /> Add RAIMS ID</button>}</div>

    {adding && <form className="card stack12 mb16" onSubmit={add}>
      <h3>Add a RAIMS ID</h3>
      <div className="grid g2">
        <label className="f">RAIMS email<input type="email" name="email" required autoComplete="off" placeholder="name@example.com" /></label>
        <Pass req />
        <label className="f">Name for this ID (optional)<input type="text" name="label" maxLength={80} placeholder="e.g. Al Haqq Overseas" /></label>
        <label className="chk mt20"><input type="checkbox" name="auto" defaultChecked /> Read it automatically every 15 minutes</label>
      </div>
      <p className="muted small">The password is kept encrypted on this server and is never shown again. Adding signs in to RAIMS once to check it.</p>
      <div className="row"><button className="btn pri" type="submit" disabled={busy}><LuKeyRound /> Sign in and add</button><button type="button" className="btn" onClick={() => setAdding(false)}><LuX /> Cancel</button></div>
    </form>}

    <div className="ri-list">
      <div className="card ri-card">
        <div className="ri-top"><div><b data-notr>{R.main?.email || "Not signed in"}</b><span className="vf-pill ok ms6">Main ID</span></div></div>
        <p className="muted small">The main RAIMS sign-in (also used for Pre EC Check and Clearance Check) is managed in BMET clearance › RAIMS status sync.</p>
        {R.main && <Last l={R.main.last} />}
        {R.main && (pw === "main" ? <NewPass email={R.main.email} onSave={p => savePw("main", p)} onClose={() => setPw(null)} />
          : <div className="row tight">{pwIssue(R.main.last) && <span className="ri-hint">The RAIMS password may have changed.</span>}<button className="btn sm" onClick={() => setPw("main")}><LuLockKeyhole /> New password</button></div>)}
      </div>
      {R.list.map(a => <div key={a.id} className="card ri-card">
        {edit === a.id ? <form className="stack12" onSubmit={e => save(e, a)}>
          <div className="grid g2">
            <label className="f">RAIMS email<input type="email" value={a.email} disabled /></label>
            <Pass />
            <label className="f">Name for this ID<input type="text" name="label" defaultValue={a.label} maxLength={80} /></label>
            <label className="chk mt20"><input type="checkbox" name="auto" defaultChecked={a.auto} /> Read it automatically every 15 minutes</label>
          </div>
          <div className="row"><button className="btn pri" type="submit" disabled={busy}>Save</button><button type="button" className="btn" onClick={() => setEdit(null)}><LuX /> Cancel</button></div>
        </form> : <>
          <div className="ri-top">
            <div className="ri-who">{a.label && <b data-notr>{a.label}</b>}<span className={a.label ? "muted small" : "b"} data-notr>{a.email}</span></div>
            <div className="row tight">
              <button className="btn sm" disabled={!!syncing} onClick={() => sync(a)}><LuRefreshCw className={syncing === a.id ? "spin" : ""} /> Sync now</button>
              <button className="btn sm" onClick={() => setPw(a.id)}><LuLockKeyhole /> New password</button>
              <button className="btn sm" onClick={() => setEdit(a.id)} aria-label="Edit"><LuPencil /></button>
              <button className="btn sm danger" onClick={() => del(a)} aria-label={`Remove ${a.email}`}><LuTrash2 /></button>
            </div>
          </div>
          <div className="muted small">{`Signed in since ${when(a.since || a.added)} · ${a.auto ? "reads every 15 minutes" : "automatic reading off"}`}</div>
          <Last l={a.last} />
          {pwIssue(a.last) && pw !== a.id && <div className="row tight"><span className="ri-hint">The RAIMS password may have changed.</span><button className="btn sm pri" onClick={() => setPw(a.id)}><LuLockKeyhole /> Enter the new password</button></div>}
          {pw === a.id && <NewPass email={a.email} onSave={p => savePw(a, p)} onClose={() => setPw(null)} />}
        </>}
      </div>)}
      {!R.list.length && !adding && <p className="muted">No other RAIMS IDs yet. Press “Add RAIMS ID”.</p>}
    </div>
  </>;
}
