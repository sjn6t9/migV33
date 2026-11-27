import React, { useState } from "react";
import { LuKeyRound, LuPlus, LuRefreshCw, LuTrash2, LuX, LuCircleCheck, LuCircleAlert, LuEye, LuEyeOff, LuPencil } from "react-icons/lu";
import { store } from "../store.js";
import { act, confirmBox, formData } from "../actions.js";

/* Website › RAIMS IDs: more RAIMS sign-ins besides the main one, so their EC application lists are read here too */
const when = x => (x ? new Date(x).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Dhaka" }) : "—");
function Last({ l }) {
  if (!l) return <span className="muted small">Not read yet</span>;
  return l.ok ? <span className="ri-st ok"><LuCircleCheck /> {`${l.rows} files read · ${l.updated} updated · ${when(l.at)}`}</span>
    : <span className="ri-st bad"><LuCircleAlert /> {l.error || "Could not read RAIMS"} · {when(l.at)}</span>;
}
export function RaimsIds() {
  const R = store.S.raimsIds || { main: null, list: [] }, busy = store.ui.busy;
  const [adding, setAdding] = useState(false), [edit, setEdit] = useState(null), [show, setShow] = useState(false), [syncing, setSyncing] = useState("");
  const add = async e => { const [d] = formData(e); const r = await act("admin.raimsIds", { op: "add", email: d.email, password: d.password, label: d.label, auto: !!d.auto }); if (r) { e.target.reset(); setAdding(false); } };
  const save = async (e, a) => { const [d] = formData(e); const r = await act("admin.raimsIds", { op: "edit", id: a.id, label: d.label, password: d.password || "", auto: !!d.auto }); if (r) setEdit(null); };
  const sync = async a => { setSyncing(a.id); await act("admin.raimsIds", { op: "sync", id: a.id }); setSyncing(""); };
  const del = a => confirmBox(`Log out of RAIMS and remove ${a.email}? Files already updated stay as they are.`, () => act("admin.raimsIds", { op: "del", id: a.id }), "Remove");
  const Pass = ({ req }) => <label className="f">RAIMS password<div className="ri-pass"><input type={show ? "text" : "password"} name="password" required={req} autoComplete="new-password" placeholder={req ? "" : "Leave empty to keep the saved one"} />
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
              <button className="btn sm" onClick={() => setEdit(a.id)} aria-label="Edit"><LuPencil /></button>
              <button className="btn sm danger" onClick={() => del(a)} aria-label={`Remove ${a.email}`}><LuTrash2 /></button>
            </div>
          </div>
          <div className="muted small">{`Signed in since ${when(a.since || a.added)} · ${a.auto ? "reads every 15 minutes" : "automatic reading off"}`}</div>
          <Last l={a.last} />
        </>}
      </div>)}
      {!R.list.length && !adding && <p className="muted">No other RAIMS IDs yet. Press “Add RAIMS ID”.</p>}
    </div>
  </>;
}
