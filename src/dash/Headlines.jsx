// Admin › Headlines: the news line under the header of mamandmam.bd
import React from "react";
import { LuPlus, LuEye, LuEyeOff, LuArrowUp, LuArrowDown, LuPencil, LuTrash2, LuX } from "react-icons/lu";
import { store } from "../store.js";
import { act, confirmBox } from "../actions.js";
import { Field } from "./shared.jsx";
import { Empty } from "../ui.jsx";
import { Headlines } from "../Headlines.jsx";

const blank = { text: "", link: "", until: "", hot: false };
export function HeadlinesAdmin() {
  const L = store.S.headlinesAll || [], [f, setF] = React.useState(blank), [edit, setEdit] = React.useState(null), [busy, setBusy] = React.useState(false);
  const today = new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10);
  const shown = L.filter(h => h.active && (!h.until || h.until >= today));
  const save = async e => { e.preventDefault(); setBusy(true); const r = await act("admin.headlines", { op: "save", id: edit, ...f }); setBusy(false); if (r) { setF(blank); setEdit(null); } };
  return <>
    <div className="ec-head"><div><h2>Headlines</h2><p className="muted small">News shown in the HEADLINES line under the header of mamandmam.bd. It scrolls; visitors can click a headline that has a link.</p></div></div>
    <div className="card"><h3 className="mb8">Preview</h3>{shown.length ? <div className="hl-preview"><Headlines items={shown} /></div> : <p className="muted small">No headline is shown on the website now.</p>}</div>
    <form className="card mt14" onSubmit={save} noValidate>
      <h3>{edit ? "Edit headline" : "New headline"}</h3>
      <div className="fgrid">
        <Field label="Headline" full><input type="text" value={f.text} onChange={e => setF({ ...f, text: e.target.value })} maxLength={300} placeholder="e.g. Saudi Arabia: 50 drivers needed, interview on Sunday" /></Field>
        <Field label="Link (optional)" hint="A page on the site (#jobs) or a full address (https://…)"><input type="text" value={f.link} onChange={e => setF({ ...f, link: e.target.value })} maxLength={300} placeholder="#jobs" /></Field>
        <Field label="Show until (optional)" hint="Hidden by itself after this day"><input type="date" value={f.until} onChange={e => setF({ ...f, until: e.target.value })} /></Field>
        <label className="check full"><input type="checkbox" checked={f.hot} onChange={e => setF({ ...f, hot: e.target.checked })} /> Mark as NEW</label>
      </div>
      <div className="row6 mt14"><button className="btn pri" type="submit" disabled={busy || f.text.trim().length < 3}><LuPlus /> {edit ? "Save headline" : "Add headline"}</button>
        {edit && <button type="button" className="btn" onClick={() => { setEdit(null); setF(blank); }}><LuX /> Cancel</button>}</div>
    </form>
    <div className="card mt14"><h3 className="mb8">{`All headlines (${L.length})`}</h3>
      {L.length ? <ul className="hl-list">{L.map((h, i) => { const live = h.active && (!h.until || h.until >= today);
        return <li key={h.id} className={live ? "" : "off"}>
          <div className="hl-l"><b>{h.hot && <span className="hl-new">NEW</span>}{h.text}</b>
            <span className="muted small">{[live ? "Shown on the website" : h.active ? `Ended on ${h.until}` : "Hidden", h.link && `Link: ${h.link}`, h.until && h.active && live && `until ${h.until}`, `by ${h.updatedBy || h.by}`].filter(Boolean).join(" · ")}</span></div>
          <div className="row6 hl-act">
            <button className="btn sm" aria-label="Move up" disabled={!i} onClick={() => act("admin.headlines", { op: "move", id: h.id, dir: -1 }, { quiet: true })}><LuArrowUp /></button>
            <button className="btn sm" aria-label="Move down" disabled={i === L.length - 1} onClick={() => act("admin.headlines", { op: "move", id: h.id, dir: 1 }, { quiet: true })}><LuArrowDown /></button>
            <button className="btn sm" onClick={() => act("admin.headlines", { op: "toggle", id: h.id })}>{h.active ? <><LuEyeOff /> Hide</> : <><LuEye /> Show</>}</button>
            <button className="btn sm" onClick={() => { setEdit(h.id); setF({ text: h.text, link: h.link || "", until: h.until || "", hot: !!h.hot }); window.scrollTo?.({ top: 0, behavior: "smooth" }); }}><LuPencil /> Edit</button>
            <button className="btn sm link danger" aria-label="Delete headline" onClick={() => confirmBox("Delete this headline?", () => act("admin.headlines", { op: "delete", id: h.id }), "Delete")}><LuTrash2 /></button>
          </div></li>; })}</ul> : <Empty>No headlines yet. Add the first one above.</Empty>}
    </div>
  </>;
}
