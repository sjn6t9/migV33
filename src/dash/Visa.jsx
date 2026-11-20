// Visa applications › KSA visa › HR files: a dashboard of client files (MOFA, visa, sponsor, medical) and the Create Client File form.
import React from "react";
import { LuFilePlus2, LuSearch, LuPencil, LuTrash2, LuFileSpreadsheet, LuX, LuExternalLink, LuCheck, LuArrowLeft, LuDownload, LuFileText, LuRefreshCw, LuClipboardPaste, LuBookmark } from "react-icons/lu";
import { VISA_FIELDS, VISA_DATES, VISA_LINKS } from "../constants.js";
import { occEn, cityOf, mofaLabel, STAY_AR, parseWafid } from "../ksaDict.js";
import { store, commit } from "../store.js";
import { act, openModal, closeModal, confirmBox, toast } from "../actions.js";
import { Field } from "./shared.jsx";
import { Empty } from "../ui.jsx";
import { PassportPick, passports } from "./Passports.jsx";
import { xlsx } from "../receipt.js";

export const MOFA_ST = ["Not applied", "Applied", "Issued", "Rejected", "Cancelled"];
export const VISA_ST = ["Pending", "Applied", "Issued", "Stamped", "Rejected", "Cancelled"];
const files = () => store.S.visa?.files || [];
const agentsList = () => store.S.users.filter(u => u.role === "agent").map(u => ({ id: u.id, name: u.agent?.business || u.name })).sort((a, b) => a.name.localeCompare(b.name));
const day = v => (v ? new Date(v.length === 10 ? v + "T00:00:00" : v).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const norm = v => String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
/** "Match" when the client's profession is the visa profession, "Not match" when both are known and differ */
export const profMatch = f => { const a = f.mofaProfession || f.profession, b = f.enjazProfessionEn || f.visaProfession; return !a || !b ? null : norm(a) === norm(b); };
const tone = s => (/issued|stamped/i.test(s) ? "ok" : /rejected|cancelled/i.test(s) ? "bad" : /applied/i.test(s) ? "info" : "wait");
const Pill = ({ s }) => <span className={`vf-pill ${tone(s)}`}>{s}</span>;

export function VisaAdmin() {
  const ui = store.ui, sub = ui.visaSub || "ksa", go = k => { ui.visaSub = k; commit(); };
  return <>
    <nav className="pay-tabs" aria-label="Visa applications">
      <button className={sub === "ksa" ? "on" : ""} aria-current={sub === "ksa" ? "page" : undefined} onClick={() => go("ksa")}>KSA Visa</button>
      <button className={sub === "pp" ? "on" : ""} aria-current={sub === "pp" ? "page" : undefined} onClick={() => go("pp")}>Passport Entry<span className="count soft">{passports().filter(p => p.info).length}</span></button>
    </nav>
    {sub === "pp" ? <VisaPassportEntry /> : <>
      <nav className="pay-tabs vf-sub" aria-label="KSA Visa"><button className="on" aria-current="page">HR Files<span className="count soft">{files().length}</span></button></nav>
      <HrFiles /></>}
  </>;
}

/* Visa applications › Passport Entry: the Personal and Passport Information of the client file, entered once; Fetch in Quick Import fills them in */
const PP_BLANK = { name: "", passport: "", gender: "", agentId: "", info: { prevNationality: "BANGLADESH", nationality: "BANGLADESH", religion: "Muslim", issuePlace: "DHAKA" } };
function VisaPassportEntry() {
  const [f, setF] = React.useState(PP_BLANK), [edit, setEdit] = React.useState(null), [busy, setBusy] = React.useState(false), [q, setQ] = React.useState("");
  const set = v => setF(o => ({ ...o, ...v })), setI = v => setF(o => ({ ...o, info: { ...o.info, ...v } }));
  const I = (k, p = {}) => <input type={VISA_DATES.includes(k) ? "date" : "text"} value={f.info[k] || ""} onChange={e => setI({ [k]: e.target.value })} maxLength={160} {...p} />;
  const SI = (k, opts) => <select value={f.info[k] || ""} onChange={e => setI({ [k]: e.target.value })}><option value="">Select</option>{opts.map(x => <option key={x}>{x}</option>)}</select>;
  const save = async e => {
    e.preventDefault(); setBusy(true);
    const row = { name: f.name, passport: f.passport, gender: f.gender, agentId: f.agentId, country: f.country || "Saudi Arabia", info: f.info };
    const r = await act("admin.passport", edit ? { op: "update", id: edit, ...row } : { op: "add", rows: [row] }); setBusy(false);
    if (r) { setF(PP_BLANK); setEdit(null); }
  };
  const start = p => { setEdit(p.id); setF({ name: p.name, passport: p.passport, gender: p.gender, agentId: p.agentId || "", country: p.country, info: { ...(p.info || {}) } }); window.scrollTo?.({ top: 0, behavior: "smooth" }); };
  const s0 = q.trim().toLowerCase(), list = passports().filter(p => !s0 || [p.name, p.passport, p.info?.fatherName, p.ref, p.info?.mofaId].some(v => (v || "").toLowerCase().includes(s0)));
  return <>
    <div className="ec-head"><div><h2>Passport Entry</h2><p className="muted small">Enter the passport once. In Create Client File, Fetch with the passport number fills in the Personal and Passport Information.</p></div></div>
    <form className="vf-form" onSubmit={save} noValidate>
      {edit && <p className="small"><span className="ec-badge">{`Editing ${f.passport}`}</span><button type="button" className="btn sm link" onClick={() => { setEdit(null); setF(PP_BLANK); }}><LuX /> Cancel</button></p>}
      <Sec n="1" title="Personal Information" sub="Basic identity of the applicant">
        <div className="fgrid">
          <Field label={<span>Full name<span className="req"> *</span></span>}><input type="text" value={f.name} onChange={e => set({ name: e.target.value })} maxLength={120} /></Field>
          <Field label="Father's name">{I("fatherName")}</Field>
          <Field label="Mother's name">{I("motherName")}</Field>
          <Field label="Date of birth">{I("dob")}</Field>
          <Field label="Birth place">{I("birthPlace")}</Field>
          <Field label="Previous nationality">{I("prevNationality")}</Field>
          <Field label="Present nationality">{I("nationality")}</Field>
          <Field label={<span>Sex<span className="req"> *</span></span>}><select value={f.gender} onChange={e => set({ gender: e.target.value })}><option value="">Select</option><option>Male</option><option>Female</option></select></Field>
          <Field label="Marital status">{SI("marital", MARITAL)}</Field>
          <Field label="Sect">{I("sect")}</Field>
          <Field label="Religion">{SI("religion", RELIGION)}</Field>
          <Field label="Home address" full>{I("address", { maxLength: 1000 })}</Field>
          <Field label="MOFA application ID">{I("mofaId", { placeholder: "New MOFA" })}</Field>
          <Field label="Old MOFA application ID">{I("oldMofaId", { placeholder: "Old MOFA" })}</Field>
          <Field label="Agent"><select value={f.agentId || ""} onChange={e => set({ agentId: e.target.value })}><option value="">No agent (office client)</option>{agentsList().map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        </div>
      </Sec>
      <Sec n="2" title="Passport Information" sub="Travel document details">
        <div className="fgrid">
          <Field label={<span>Passport no.<span className="req"> *</span></span>}><input type="text" value={f.passport} onChange={e => set({ passport: e.target.value })} maxLength={20} autoComplete="off" /></Field>
          <Field label="Issue place">{I("issuePlace")}</Field>
          <Field label="Issue date"><input type="date" value={f.info.issueDate || ""} onChange={e => setI({ issueDate: e.target.value, ...(f.info.validity && e.target.value ? { expiryDate: addYears(e.target.value, parseInt(f.info.validity, 10)) } : {}) })} /></Field>
          <Field label="Expiry date">{I("expiryDate")}</Field>
          <Field label="Passport validity (years)"><select value={f.info.validity || ""} onChange={e => setI({ validity: e.target.value, ...(e.target.value && f.info.issueDate ? { expiryDate: addYears(f.info.issueDate, parseInt(e.target.value, 10)) } : {}) })}><option value="">Select</option>{VALIDITY.map(x => <option key={x}>{x}</option>)}</select></Field>
        </div>
      </Sec>
      <div className="row6 mt14"><button className="btn pri" type="submit" disabled={busy}><LuCheck /> {edit ? "Save changes" : "Save passport"}</button></div>
    </form>
    <div className="card mt14">
      <div className="vf-tools"><label className="ec-search mr-search"><input type="text" value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, passport, father's name, MOFA ID" aria-label="Search passports" /><LuSearch /></label></div>
      {list.length ? <div className="tbl vf-tbl"><table><thead><tr><th>SL</th><th>Name</th><th>Passport</th><th>Father's name</th><th>Date of birth</th><th>Sex</th><th>Expiry date</th><th>MOFA ID</th><th>Agent</th><th>Actions</th></tr></thead><tbody>
        {list.map((p, i) => <tr key={p.id}><td className="num">{list.length - i}</td><td className="b">{p.name}</td><td className="num">{p.passport}</td><td>{p.info?.fatherName || "—"}</td><td className="nowrap">{day(p.info?.dob)}</td><td>{p.gender}</td><td className="nowrap">{day(p.info?.expiryDate)}</td><td className="num">{p.info?.mofaId || "—"}</td><td>{p.ref || <span className="muted">Office</span>}</td>
          <td className="nowrap"><button className="btn sm" onClick={() => start(p)}><LuPencil /> Edit</button><button className="btn sm link danger" aria-label={`Delete ${p.passport}`} onClick={() => confirmBox(`Delete passport ${p.passport}?`, () => act("admin.passport", { op: "delete", id: p.id }), "Delete")}><LuTrash2 /></button></td></tr>)}
      </tbody></table></div> : <Empty>{q ? "No passports match." : "No passports yet."}</Empty>}
    </div>
  </>;
}

function HrFiles() {
  const [q, setQ] = React.useState(""), [mofa, setMofa] = React.useState(""), [visa, setVisa] = React.useState(""), [ag, setAg] = React.useState(""), [n, setN] = React.useState(50);
  const all = [...files()].sort((a, b) => a.sl - b.sl);
  const s = q.trim().toLowerCase(), sn = s.replace(/\s+/g, "");
  const list = all.filter(f => (!mofa || f.mofaStatus === mofa) && (!visa || f.visaStatus === visa) && (!ag || f.agentId === ag || (ag === "-" && !f.agentId))
    && (!s || [f.name, f.agent, f.sponsorName, f.mofaProfession, f.enjazProfessionEn, f.professionEn, f.fatherName].some(v => (v || "").toLowerCase().includes(s)) || [f.passport, f.mofaId, f.oldMofaId, f.visaNo, f.sponsorId, f.pcRef].some(v => (v || "").toLowerCase().includes(sn))));
  const c = p => all.filter(p).length;
  const tiles = [[all.length, "Total files", ""], [c(f => f.mofaStatus === "Issued"), "MOFA issued", "ok"], [c(f => ["Issued", "Stamped"].includes(f.visaStatus)), "Visa issued / stamped", "ok"],
    [c(f => ["Pending", "Applied"].includes(f.visaStatus)), "Visa in process", "wait"], [c(f => f.medicalSlipDate), "Medical slip taken", ""], [c(f => profMatch(f) === false), "Profession not matching", "bad"]];
  const HEAD = ["SL", "Agent", "Name", "Mofa ID", "Passport", "Visa Number", "Sponsor ID", "Mofa Status", "Visa Status", "Actions", "Created Date", "Medical Slip Date", "Sponsor Name", "Profession Match"];
  const excel = () => xlsx("HR Files", [HEAD.filter(h => h !== "Actions").map(v => ({ v, s: 1 })), ...list.map(f => [f.sl, f.agent, f.name, f.mofaId, f.passport, f.visaNo, f.sponsorId, f.mofaStatus, f.visaStatus, f.created.slice(0, 10), f.medicalSlipDate, f.sponsorName, profMatch(f) == null ? "" : profMatch(f) ? "Match" : "Not match"])],
    [6, 24, 26, 14, 13, 14, 14, 12, 12, 12, 14, 28, 14], `ksa-hr-files-${new Date().toISOString().slice(0, 10)}.xlsx`);
  const filtered = q || mofa || visa || ag;
  return <>
    <div className="ec-head"><div><h2>KSA Visa · HR Files</h2><p className="muted small">Client files for Saudi visas: MOFA, visa, sponsor and medical, with the agent who sent each client.</p></div>
      <button className="btn pri" onClick={() => openModal("visaFile", {})}><LuFilePlus2 /> Create Client File</button></div>
    <VisaLinks />
    <div className="vf-bmrow"><button className="btn sm" onClick={() => openModal("wafidHelp", {})}><LuBookmark /> Medical Check bookmark</button><span className="muted small">One click on the Wafid result page saves FIT/UNFIT, medical center and date.</span></div>
    <div className="vf-tiles">{tiles.map(([v, l, t]) => <div key={l} className={`vf-tile ${t}`}><b>{v}</b><span>{l}</span></div>)}</div>
    <div className="card">
      <div className="vf-tools">
        <label className="ec-search mr-search"><input type="text" value={q} onChange={e => { setQ(e.target.value); setN(50); }} placeholder="Search name, passport, MOFA ID, visa no., sponsor" aria-label="Search client files" /><LuSearch /></label>
        <select value={mofa} onChange={e => setMofa(e.target.value)} aria-label="Mofa status"><option value="">All MOFA status</option>{MOFA_ST.map(x => <option key={x}>{x}</option>)}</select>
        <select value={visa} onChange={e => setVisa(e.target.value)} aria-label="Visa status"><option value="">All visa status</option>{VISA_ST.map(x => <option key={x}>{x}</option>)}</select>
        <select value={ag} onChange={e => setAg(e.target.value)} aria-label="Agent"><option value="">All agents</option><option value="-">No agent (office)</option>{agentsList().map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        {filtered && <button className="btn sm link" onClick={() => { setQ(""); setMofa(""); setVisa(""); setAg(""); }}><LuX /> Clear</button>}
        <span className="grow" /><button className="btn" disabled={!list.length} onClick={excel}><LuFileSpreadsheet /> Excel</button>
      </div>
      {list.length ? <div className="tbl vf-tbl"><table><thead><tr>{HEAD.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>
        {list.slice(0, n).map(f => { const pm = profMatch(f); return <tr key={f.id}>
          <td className="num">{f.sl}</td><td>{f.agent || <span className="muted">Office</span>}</td><td className="b">{f.name}</td><td className="num">{f.mofaId || "—"}</td><td className="num">{f.passport}</td>
          <td className="num">{f.visaNo || "—"}</td><td className="num">{f.sponsorId || "—"}</td><td><Pill s={f.mofaStatus} /></td><td><Pill s={f.visaStatus} /></td>
          <td className="nowrap"><button className="btn sm" onClick={() => openModal("visaFile", { id: f.id })}><LuPencil /> Edit</button>
            <button className="btn sm" title="KSA Embassy application file" onClick={() => embassyPdf(f)}><LuFileText /> PDF</button>
            <button className="btn sm link danger" aria-label={`Delete ${f.name}`} onClick={() => confirmBox(`Delete the client file of ${f.name}?`, () => act("admin.visa", { op: "delete", id: f.id }), "Delete")}><LuTrash2 /></button></td>
          <td className="nowrap">{day(f.created)}</td><td className="nowrap">{day(f.medicalSlipDate)}</td><td>{f.sponsorName || "—"}</td>
          <td>{pm == null ? <span className="muted">—</span> : <span className={`vf-pill ${pm ? "ok" : "bad"}`} title={`${f.mofaProfession || f.profession || ""} / ${f.enjazProfessionEn || f.visaProfession || ""}`}>{pm ? "Match" : "Not match"}</span>}</td>
        </tr>; })}</tbody></table></div> : <Empty>{filtered ? "No client files match." : "No client files yet. Use Create Client File to add the first one."}</Empty>}
      {list.length > n && <div className="mt8"><button className="btn sm" onClick={() => setN(n + 100)}>{`Show more (${list.length - n})`}</button></div>}
    </div>
  </>;
}

/* the check websites, as buttons that open in a new tab */
export function VisaLinks() {
  return <div className="vf-links" role="group" aria-label="Check websites">{VISA_LINKS.map(([l, u]) => <a key={l} className="btn sm" href={u} target="_blank" rel="noopener noreferrer"><LuExternalLink /> {l}</a>)}</div>;
}
const RELIGION = ["Muslim", "Hindu", "Christian", "Buddhist", "Other"], MARITAL = ["Unmarried", "Married", "Divorced", "Widowed"], VALIDITY = ["5 Years", "10 Years"];
const PURPOSE = ["Work", "Transit", "Visit", "Umrah", "Residence", "Hajj", "Diplomacy"], LICENSE = ["Professional Light", "Professional Medium", "Professional Heavy", "Non-professional Light", "Motorcycle", "No licence"];
const REQUIRED = { name: "Full name", dob: "Date of birth", sex: "Sex", mofaId: "MOFA application ID", passport: "Passport no.", issueDate: "Issue date", expiryDate: "Expiry date", visaNo: "Visa no.", visaDate: "Visa date", sponsorName: "Sponsor name", sponsorId: "Sponsor ID", issuePlaceEn: "Place of issue (English)", issuePlaceAr: "Place of issue (Arabic)", professionEn: "Profession (English)", professionAr: "Profession (Arabic)", travelPurpose: "Travel purpose", wakala: "Wakala", pcRef: "PC ref no." };
/** the reference number inside a police clearance QR link */
export function pcRefFrom(url) {
  const t = String(url || "").trim(); if (!t) return "";
  try {
    const u = new URL(t);
    for (const k of ["ref", "refno", "ref_no", "reference", "referenceno", "pcc", "pccno", "certificate", "certno", "no", "id"]) for (const [q, v] of u.searchParams) if (q.toLowerCase() === k && v) return v.trim();
    const seg = u.pathname.split("/").filter(Boolean).reverse().find(x => /\d{4,}/.test(x)); if (seg) return decodeURIComponent(seg);
    const any = [...u.searchParams.values()].reverse().find(v => /\d{4,}/.test(v)); if (any) return any.split(/[:,]/).filter(x => /\d{4,}/.test(x)).pop();
  } catch { /* not a link: maybe the number itself */ }
  const m = t.match(/[A-Z0-9-]*\d{5,}[A-Z0-9-]*/i); return m ? m[0] : "";
}
const addYears = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCFullYear(x.getUTCFullYear() + n); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };

/* after Save Client File: the embassy file is ready to download */
function Saved({ id, onEdit }) {
  const f = files().find(x => x.id === id) || {}; const [busy, setBusy] = React.useState(false);
  return <div className="vf-saved"><div className="vf-saved-i"><LuCheck /></div><h2>Client file saved</h2><p className="muted">{`${f.name || ""} · ${f.passport || ""}`}</p>
    <p className="small muted">The KSA Embassy application file (4 pages) is ready.</p>
    <div className="row6 mt14 center"><button className="btn pri" disabled={busy} onClick={() => embassyPdf(f, setBusy)}><LuDownload /> Download PDF</button><button className="btn" onClick={onEdit}><LuPencil /> Edit again</button><button className="btn" onClick={closeModal}>Close</button></div></div>;
}
export async function embassyPdf(f, setBusy = () => {}) {
  setBusy(true); try { const { ksaPdf } = await import("../ksaPdf.js"); await ksaPdf(f, store.S.settings || {}); } catch (e) { toast(e.message || "The PDF could not be made."); } finally { setBusy(false); }
}
/* ---------- Wafid bookmark: the office checks the passport on wafid.com, then one click brings the result here ---------- */
const WAFID_ORIGIN = /^https:\/\/(www\.)?wafid\.com$/;
export function wafidBookmarklet() {
  const a = window.__SITE__ && window.__SITE__.admin, target = typeof a === "string" && /^https?:\/\//.test(a) ? new URL(a).origin : location.origin;
  return `javascript:(function(){var t=document.body.innerText.slice(0,20000),o=${JSON.stringify(target)},w=window.open(o+'/#wafid-import','mamwafid');if(!w){alert('Allow pop-ups for wafid.com');return}var n=0,i=setInterval(function(){try{w.postMessage({mamWafid:1,text:t},o)}catch(e){}if(++n>240)clearInterval(i)},500);window.addEventListener('message',function(e){if(e.origin===o&&e.data&&e.data.mamWafidOk)clearInterval(i)})})();`;
}
/* the page the bookmark opens (#wafid-import): shows what came from Wafid and saves it after the office checks it */
export function WafidImport() {
  const [got, setGot] = React.useState(null), [busy, setBusy] = React.useState(false), [done, setDone] = React.useState("");
  React.useEffect(() => {
    const on = e => {
      if (!WAFID_ORIGIN.test(e.origin) || !e.data || !e.data.mamWafid) return;
      try { e.source && e.source.postMessage({ mamWafidOk: 1 }, e.origin); } catch {}
      setGot(g => g || { ...parseWafid(String(e.data.text || "")), name: (/Name\s*:?\s*\n?\s*([^\n]+)/i.exec(String(e.data.text || "")) || [])[1] || "" });
    };
    window.addEventListener("message", on); return () => window.removeEventListener("message", on);
  }, []);
  const hits = got?.passport ? files().filter(f => f.passport === got.passport) : [];
  const save = async () => { setBusy(true); const r = await act("admin.visa", { op: "medical", ...got }); setBusy(false); if (r) setDone(r.msg); };
  return <section className="sec"><div className="wrap vf-wimp">
    <h2>Medical result from Wafid</h2>
    {!got ? <p className="muted">Waiting for the result… Keep the Wafid tab open. If nothing comes, press the MAM Wafid bookmark again on the Wafid result page.</p>
      : !(got.medicalResult || got.medicalCenter) || !got.passport ? <p className="vf-err">This does not look like a Wafid result page. Search the passport on Wafid first, then press the bookmark on the result page.</p>
      : <div className="card">
        <dl className="vf-dl">{[["Passport", got.passport], ["Name", got.name], ["Medical report", got.medicalResult], ["Medical center", got.medicalCenter], ["Examination date", day(got.medicalSlipDate)]].filter(([, v]) => v).map(([k, v]) => <div key={k} className="vf-dl-row"><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        <p className="small mt14">{hits.length ? `It will be saved on ${hits.map(f => `${f.name} (SL ${f.sl})`).join(", ")}.` : "There is no client file for this passport yet. It is kept, and Fetch will fill it in when the file is made."}</p>
        {done ? <><p className="vf-ok mt8"><LuCheck /> {done}</p><div className="row6 mt8"><button className="btn" onClick={() => window.close()}>Close this window</button><a className="btn" href="#dashboard" onClick={() => { store.ui.visaSub = "ksa"; }}>Open HR Files</a></div></>
          : <div className="row6 mt14"><button className="btn pri" disabled={busy} onClick={save}><LuCheck /> Save medical result</button></div>}
      </div>}
  </div></section>;
}
/* how to add the bookmark */
export function WafidBookmarkHelp() {
  const ref = React.useRef(null), code = wafidBookmarklet();
  React.useEffect(() => { if (ref.current) ref.current.setAttribute("href", code); }, [code]); // React does not allow javascript: links, so it is set directly
  const copy = async () => { try { await navigator.clipboard.writeText(code); toast("Copied."); } catch { toast("Could not copy. Select the code and copy it."); } };
  return <div>
    <h2>Medical Check bookmark</h2>
    <p className="muted small">After you check a passport on Wafid, one click sends the result (FIT/UNFIT, medical center, date) to the client file.</p>
    <h4 className="mt14">On a computer (Chrome, Edge)</h4>
    <ol className="small vf-steps"><li>Show the bookmarks bar: press Ctrl+Shift+B.</li><li>Drag this button to the bookmarks bar: <a ref={ref} className="btn sm pri vf-bm" onClick={e => { e.preventDefault(); toast("Drag it to the bookmarks bar."); }}>MAM Wafid</a></li><li>On wafid.com, search the passport. When the result shows, click MAM Wafid in the bookmarks bar.</li><li>A window of this site opens with the result. Check it and press Save medical result.</li></ol>
    <h4 className="mt14">On a phone</h4>
    <ol className="small vf-steps"><li>Copy the code: <button type="button" className="btn sm" onClick={copy}><LuClipboardPaste /> Copy code</button></li><li>Bookmark any page, then edit the bookmark: name it MAM Wafid and paste the code as its address (URL).</li><li>On the Wafid result page, type MAM Wafid in the address bar and tap the bookmark.</li></ol>
    <p className="small muted mt14">You must be signed in to this admin panel in the same browser. Allow pop-ups for wafid.com if the browser asks.</p>
    <div className="row6 mt14"><button className="btn" onClick={closeModal}>Close</button></div>
  </div>;
}
/* Medical Check (Wafid) cannot be asked from the server: the office copies the result page and pastes it here */
function WafidPaste({ passport, onFill }) {
  const [open, setOpen] = React.useState(false), [txt, setTxt] = React.useState(""), [res, setRes] = React.useState(null);
  const read = () => {
    const r = parseWafid(txt); const pp = String(passport || "").replace(/\s+/g, "").toUpperCase();
    if (!r.medicalResult && !r.medicalCenter) { setRes({ error: "This does not look like the Wafid result page. Copy the whole page and paste it again." }); return; }
    if (r.passport && pp && r.passport !== pp) { setRes({ error: `This result is for passport ${r.passport}, not ${pp}.` }); return; }
    onFill(Object.fromEntries(["medicalResult", "medicalCenter", "medicalSlipDate", "gccSlipNo"].filter(k => r[k]).map(k => [k, r[k]])));
    setRes(r); setTxt(""); setOpen(false); toast("Medical details filled in.");
  };
  return <div className="vf-med">
    <div className="row6"><a className="btn sm" href="https://wafid.com/en/medical-status-search/" target="_blank" rel="noopener noreferrer"><LuExternalLink /> Medical Check</a>
      <button type="button" className="btn sm" onClick={() => { setOpen(!open); setRes(null); }}><LuClipboardPaste /> Paste the result</button>
      <button type="button" className="btn sm link" onClick={() => openModal("wafidHelp", {})}><LuBookmark /> Bookmark</button></div>
    {open && <div className="vf-mofa mt8"><p className="small">In Medical Check, search the passport, select the whole result page (Select All), copy it, and paste it here.</p>
      <textarea rows={4} value={txt} onChange={e => setTxt(e.target.value)} placeholder="Paste the Medical Check result here" aria-label="Medical Check result" />
      <div className="row6 mt8"><button type="button" className="btn pri sm" disabled={!txt.trim()} onClick={read}>Fill in</button><button type="button" className="btn sm link" onClick={() => setOpen(false)}><LuX /> Close</button></div></div>}
    {res?.error && <p className="small vf-err">{res.error}</p>}
    {res && !res.error && <p className="small muted mt8">{[res.medicalResult, res.medicalCenter, res.medicalSlipDate && day(res.medicalSlipDate)].filter(Boolean).join(" · ")}</p>}
  </div>;
}
/* the plain work visa, not the seasonal Hajj/Umrah work visa */
const workType = list => { const ok = o => /عمل|work/i.test(o.text) && !/مؤقت|موسم|حج|عمر|temporary|seasonal|hajj|umrah/i.test(o.text);
  return ((list.find(o => /^(تأشيرة |تاشيرة )?(عمل|work)$/i.test(o.text.trim())) || list.find(ok) || list.find(o => /عمل|work/i.test(o.text)) || list[0] || {}).value) || ""; };
const Sec = ({ n, title, sub, children }) => <section className="vf-sec"><div className="vf-sec-h"><span className="vf-num">{n}</span><div><h4>{title}</h4>{sub && <p className="muted small">{sub}</p>}</div></div>{children}</section>;
/* Create / edit a client file: the same sections as the office's MOFA client file */
export function VisaFileForm({ id }) {
  const old = id && files().find(f => f.id === id);
  const [f, setF] = React.useState(() => ({ mofaStatus: "Not applied", visaStatus: "Pending", prevNationality: "BANGLADESH", nationality: "BANGLADESH", religion: "Muslim", issuePlace: "DHAKA", stayEn: "02 Years", finger: "Yes", salary: "800", food: "200", experience: "No",
    ...(old ? { ...old, mofaProfession: old.mofaProfession || old.profession, enjazProfessionEn: old.enjazProfessionEn || old.visaProfession } : {}) }));
  const [busy, setBusy] = React.useState(""), [qp, setQp] = React.useState(old?.passport || ""), [qv, setQv] = React.useState({ visaNo: old?.visaNo || "", sponsorId: old?.sponsorId || "" });
  const set = v => setF(o => ({ ...o, ...v }));
  const T = (k, p = {}) => <input type={VISA_DATES.includes(k) ? "date" : "text"} value={f[k] || ""} onChange={e => set({ [k]: e.target.value })} maxLength={160} {...p} />;
  const AR = k => T(k, { dir: "rtl", lang: "ar", className: "vf-ar" });
  const S = (k, opts, ph = "Select") => <select value={f[k] || ""} onChange={e => set({ [k]: e.target.value })}><option value="">{ph}</option>{opts.map(x => <option key={x}>{x}</option>)}</select>;
  const L = (k, label) => <span>{label}{REQUIRED[k] && <span className="req"> *</span>}</span>;
  const pm = profMatch(f), missing = Object.entries(REQUIRED).filter(([k]) => !String(f[k] || "").trim()).map(([, l]) => l);
  const [mc, setMc] = React.useState(null); // MOFA application check: { sid, img, code, visaTypes, visaType, nationality, natOpts, error, result }
  const fetchPp = async () => {
    setBusy("pp"); const pp = qp.replace(/\s+/g, "").toUpperCase();
    const r = await act("admin.visa", { op: "fetch", passport: qp, id }, { quiet: false });
    if (r?.found) set({ ...Object.fromEntries(Object.entries(r.found).filter(([k]) => VISA_FIELDS.includes(k) || k === "name")), passport: pp }); else set({ passport: pp });
    const m = await act("admin.visa", { op: "mofaStart" }, { quiet: true }); setBusy("");
    if (m?.sid) setMc({ sid: m.sid, img: m.img, code: "", visaTypes: m.visaTypes || [], visaType: workType(m.visaTypes || []), nationality: m.nationality || "", natOpts: m.natOpts || [] });
  };
  const mcNew = async () => { const r = await act("admin.visa", { op: "enjazCaptcha", sid: mc.sid }, { quiet: true }); if (r?.img) setMc({ ...mc, img: r.img, code: "", error: "" }); };
  const mcGo = async () => {
    setBusy("mc"); const r = await act("admin.visa", { op: "mofaSubmit", sid: mc.sid, code: mc.code, passport: qp, visaType: mc.visaType, nationality: mc.nationality }, { quiet: true }); setBusy("");
    if (!r) return;
    if (!r.ok) { setMc({ ...mc, code: "", error: r.problem || "Nothing found.", img: r.img || mc.img, lines: r.lines }); return; }
    const x = r.found || {}, keep = k => (x[k] && !f[k] ? { [k]: x[k] } : {});
    set({ ...(x.mofaStatus ? { mofaStatus: x.mofaStatus } : {}), ...(x.visaStatus ? { visaStatus: x.visaStatus } : {}), ...(x.mofaId ? { mofaId: x.mofaId } : {}), ...keep("visaNo"), ...keep("mofaProfession"), ...keep("dob"), ...keep("expiryDate"), ...keep("birthPlace") });
    if (x.visaNo && !qv.visaNo) setQv(v => ({ ...v, visaNo: x.visaNo }));
    setMc({ result: r }); toast("MOFA and visa status filled in.");
  };
  /* Search: copy what an earlier file with this visa has, then ask MOFA (the office types the image code) for the visa date, sponsor and occupation */
  const [mofa, setMofa] = React.useState(null); // { sid, img, code, error, result }
  const searchVisa = async () => {
    setBusy("visa"); set({ ...(qv.visaNo ? { visaNo: qv.visaNo.trim() } : {}), ...(qv.sponsorId ? { sponsorId: qv.sponsorId.trim() } : {}) });
    const r = await act("admin.visa", { op: "visaSearch", ...qv, id, soft: true }, { quiet: true }); if (r?.found && Object.keys(r.found).length) set(r.found);
    if (qv.visaNo.trim() && qv.sponsorId.trim()) { const s0 = await act("admin.visa", { op: "enjazStart" }, { quiet: true }); if (s0?.sid) setMofa({ sid: s0.sid, img: s0.img, code: "" }); }
    else toast("Enter both the visa number and the sponsor ID to get the details from MOFA.");
    setBusy("");
  };
  const mofaNewImg = async () => { const r = await act("admin.visa", { op: "enjazCaptcha", sid: mofa.sid }, { quiet: true }); if (r?.img) setMofa({ ...mofa, img: r.img, code: "", error: "" }); };
  const mofaGo = async () => {
    setBusy("mofa"); const r = await act("admin.visa", { op: "enjazSubmit", sid: mofa.sid, code: mofa.code, ...qv }, { quiet: true }); setBusy("");
    if (!r) return;
    if (!r.ok) { setMofa({ ...mofa, code: "", error: r.problem || "Nothing found.", img: r.img || mofa.img }); return; }
    const x = r.found || {};
    // MOFA answers in Arabic: Arabic goes to the Arabic fields, the English fields get the English (occupation and city from a word list)
    const oc = (x.occupation || "").split(" / ")[0], ocEn = occEn(oc), city = cityOf(x.sponsorAddress);
    set({ ...(x.visaDate ? { visaDate: x.visaDate } : {}), ...(x.sponsorName ? { sponsorName: x.sponsorName } : {}),
      ...(oc ? { professionAr: oc, enjazProfessionAr: oc } : {}), ...(ocEn ? { professionEn: ocEn, enjazProfessionEn: ocEn } : {}),
      ...(city.ar ? { issuePlaceAr: city.ar } : {}), ...(city.en ? { issuePlaceEn: city.en } : {}),
      ...(!f.stayAr && STAY_AR[String(f.stayEn || "").toLowerCase()] ? { stayAr: STAY_AR[String(f.stayEn).toLowerCase()] } : {}) });
    setMofa({ result: r }); toast("Visa details filled in from MOFA.");
  };
  const pcUrl = v => { const ref = pcRefFrom(v); set({ pcUrl: v, ...(ref ? { pcRef: ref } : {}) }); };
  const validity = v => set({ validity: v, ...(v && f.issueDate ? { expiryDate: addYears(f.issueDate, parseInt(v, 10)) } : {}) });
  const [done, setDone] = React.useState(null);
  const save = async e => { e.preventDefault(); setBusy("save"); const r = await act("admin.visa", { op: "save", id: id || done, file: f }); setBusy(""); if (r?.id) setDone(r.id); };
  if (done) return <Saved id={done} onEdit={() => setDone(null)} />;
  return <form onSubmit={save} noValidate className="vf-form">
    <h2>{old ? `Client file · SL ${old.sl}` : "Create Client File"}</h2><p className="muted small">KSA Visa · HR Files · Add a new client file to the system.</p>
    <VisaLinks />
    <Sec n={<LuSearch />} title="Quick Import" sub="Enter a passport number to fill in what the office already has">
      <div className="vf-quick"><Field label="Passport number"><input type="text" value={qp} onChange={e => setQp(e.target.value)} placeholder="Enter passport number" maxLength={20} autoComplete="off" onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); fetchPp(); } }} /></Field>
        <button type="button" className="btn pri" disabled={busy === "pp" || qp.trim().length < 6} onClick={fetchPp}><LuSearch /> Fetch</button><PassportPick onPick={p => { setQp(p.passport); set({ name: p.name, passport: p.passport, sex: p.gender || f.sex, agentId: p.agentId || f.agentId }); }} /></div>
      {mc && !mc.result && <div className="vf-mofa">
        <p className="small"><b>MOFA application check</b> · Type the image code to get the MOFA status and visa status.</p>
        <div className="vf-cap">
          {mc.visaTypes.length > 0 && <select value={mc.visaType} onChange={e => setMc({ ...mc, visaType: e.target.value })} aria-label="Visa type">{mc.visaTypes.map(o => <option key={o.value} value={o.value}>{o.text}</option>)}</select>}
          {!mc.nationality && mc.natOpts?.length > 0 && <select value={mc.nationality} onChange={e => setMc({ ...mc, nationality: e.target.value })} aria-label="Nationality"><option value="">Nationality</option>{mc.natOpts.map(o => <option key={o.value} value={o.value}>{o.text}</option>)}</select>}
        </div>
        <div className="vf-cap mt8">{mc.img ? <img src={mc.img} alt="Image code from MOFA" /> : <span className="muted small">No image</span>}
          <button type="button" className="btn sm" onClick={mcNew} aria-label="New image code"><LuRefreshCw /></button>
          <input type="text" inputMode="numeric" maxLength={6} value={mc.code} onChange={e => setMc({ ...mc, code: e.target.value })} placeholder="Image code" aria-label="Image code" autoComplete="off" onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); mcGo(); } }} />
          <button type="button" className="btn pri" disabled={busy === "mc" || !mc.code.trim()} onClick={mcGo}>{busy === "mc" ? "Searching…" : "Get status"}</button>
          <button type="button" className="btn sm link" onClick={() => setMc(null)} aria-label="Close"><LuX /></button></div>
        {mc.error && <p className="small vf-err">{mc.error}</p>}
        {mc.lines?.length > 0 && <details className="vf-det small"><summary>What MOFA answered</summary><p className="muted">{mc.lines.join(" · ")}</p></details>}
      </div>}
      {mc?.result && <div className="vf-mofa ok"><p className="small"><b>From MOFA (application)</b><button type="button" className="btn sm link ms6" onClick={() => setMc(null)} aria-label="Close"><LuX /></button></p>
        <dl className="vf-dl">{(mc.result.pairs || []).filter(([k]) => !/^عرض|display/i.test(k)).map(([k, v]) => <div key={k} className="vf-dl-row"><dt>{mofaLabel(k)}</dt><dd dir="auto">{v}</dd></div>)}</dl></div>}
      <WafidPaste passport={f.passport || qp} onFill={v => set(v)} />
      <div className="fgrid">
        <Field label="Agent"><select value={f.agentId || ""} onChange={e => set({ agentId: e.target.value })}><option value="">No agent (office client)</option>{agentsList().map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        <Field label="Remark">{T("remark", { placeholder: "Remark" })}</Field>
        <Field label="Mofa status">{S("mofaStatus", MOFA_ST, "Not applied")}</Field>
        <Field label="Visa status">{S("visaStatus", VISA_ST, "Pending")}</Field>
        <Field label="Profession match"><div className={`vf-box ${pm == null ? "" : pm ? "ok" : "bad"}`}>{pm == null ? "Not checked" : pm ? "Match" : "Not match"}</div></Field>
        <Field label="Medical report">{S("medicalResult", ["FIT", "UNFIT", "Pending"])}</Field>
        <Field label="GCC slip info"><div className="vf-two">{T("gccSlipNo", { placeholder: "Slip no.", "aria-label": "Slip no." })}{T("medicalCenter", { placeholder: "Medical center", "aria-label": "Medical center" })}</div></Field>
        <Field label="Medical slip date">{T("medicalSlipDate")}</Field>
      </div>
    </Sec>
    <Sec n="1" title="Personal Information" sub="Basic identity of the applicant">
      <div className="fgrid">
        <Field label={L("name", "Full name")}>{T("name", { maxLength: 120 })}</Field>
        <Field label="Father's name">{T("fatherName")}</Field>
        <Field label="Mother's name">{T("motherName")}</Field>
        <Field label={L("dob", "Date of birth")}>{T("dob")}</Field>
        <Field label="Birth place">{T("birthPlace")}</Field>
        <Field label="Previous nationality">{T("prevNationality")}</Field>
        <Field label="Present nationality">{T("nationality")}</Field>
        <Field label={L("sex", "Sex")}>{S("sex", ["Male", "Female"])}</Field>
        <Field label="Marital status">{S("marital", MARITAL)}</Field>
        <Field label="Sect">{T("sect")}</Field>
        <Field label="Religion">{S("religion", RELIGION)}</Field>
        <Field label="Home address" full>{T("address", { maxLength: 1000 })}</Field>
        <Field label={L("mofaId", "MOFA application ID")}>{T("mofaId", { placeholder: "New MOFA" })}</Field>
        <Field label="Old MOFA application ID">{T("oldMofaId", { placeholder: "Old MOFA" })}</Field>
      </div>
    </Sec>
    <Sec n="2" title="Passport Information" sub="Travel document details">
      <div className="fgrid">
        <Field label={L("passport", "Passport no.")}>{T("passport", { maxLength: 20 })}</Field>
        <Field label="Issue place">{T("issuePlace")}</Field>
        <Field label={L("issueDate", "Issue date")}><input type="date" value={f.issueDate || ""} onChange={e => set({ issueDate: e.target.value, ...(f.validity && e.target.value ? { expiryDate: addYears(e.target.value, parseInt(f.validity, 10)) } : {}) })} /></Field>
        <Field label={L("expiryDate", "Expiry date")}>{T("expiryDate")}</Field>
        <Field label="Passport validity (years)"><select value={f.validity || ""} onChange={e => validity(e.target.value)}><option value="">Select</option>{VALIDITY.map(x => <option key={x}>{x}</option>)}</select></Field>
      </div>
    </Sec>
    <Sec n="3" title="Visa Information" sub="Visa, sponsor and profession details">
      <div className="vf-quick vf-visa-q">
        <Field label="Visa number"><input type="text" value={qv.visaNo} onChange={e => setQv({ ...qv, visaNo: e.target.value })} placeholder="Enter visa number" maxLength={40} /></Field>
        <Field label="Sponsor ID (search)"><input type="text" value={qv.sponsorId} onChange={e => setQv({ ...qv, sponsorId: e.target.value })} placeholder="Enter sponsor ID" maxLength={40} /></Field>
        <button type="button" className="btn pri" disabled={busy === "visa" || !(qv.visaNo.trim() || qv.sponsorId.trim())} onClick={searchVisa}><LuSearch /> Search</button>
      </div>
      {mofa && !mofa.result && <div className="vf-mofa">
        <p className="small"><b>MOFA visa information</b> · Type the image code to get the visa date and sponsor name.</p>
        <div className="vf-cap">{mofa.img ? <img src={mofa.img} alt="Image code from MOFA" /> : <span className="muted small">No image</span>}
          <button type="button" className="btn sm" onClick={mofaNewImg} aria-label="New image code"><LuRefreshCw /></button>
          <input type="text" inputMode="numeric" maxLength={6} value={mofa.code} onChange={e => setMofa({ ...mofa, code: e.target.value })} placeholder="Image code" aria-label="Image code" autoComplete="off" onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); mofaGo(); } }} />
          <button type="button" className="btn pri" disabled={busy === "mofa" || !mofa.code.trim()} onClick={mofaGo}>{busy === "mofa" ? "Searching…" : "Get details"}</button>
          <button type="button" className="btn sm link" onClick={() => setMofa(null)}><LuX /></button></div>
        {mofa.error && <p className="small vf-err">{mofa.error}</p>}
      </div>}
      {mofa?.result && <div className="vf-mofa ok"><p className="small"><b>From MOFA</b><button type="button" className="btn sm link ms6" onClick={() => setMofa(null)}><LuX /></button></p>
        <dl className="vf-dl">{[...(mofa.result.pairs || []).filter(([k]) => !/^عرض|display visas/i.test(k)).map(([k, v]) => [mofaLabel(k), v]),
          ...(mofa.result.found?.occupation ? [["Occupation", mofa.result.found.occupation.split(" / ").map(o => occEn(o) ? `${o} (${occEn(o)})` : o).join(" / ")]] : []),
          ...(cityOf(mofa.result.found?.sponsorAddress).en ? [["City", `${cityOf(mofa.result.found.sponsorAddress).ar} (${cityOf(mofa.result.found.sponsorAddress).en})`]] : [])].map(([k, v]) => <div key={k} className="vf-dl-row"><dt>{k}</dt><dd dir="auto">{v}</dd></div>)}</dl>
        {mofa.result.found?.occupation && !occEn((mofa.result.found.occupation || "").split(" / ")[0]) && <p className="small muted mt8">The English for this occupation is not in the list yet. Type it in Profession (English).</p>}</div>}
      <div className="fgrid">
        <Field label={L("visaNo", "Visa no.")}>{T("visaNo", { maxLength: 40 })}</Field>
        <Field label={L("visaDate", "Visa date")}>{T("visaDate", { placeholder: "e.g. 1446/06/30", maxLength: 20 })}</Field>
        <Field label={L("sponsorName", "Sponsor name")}>{T("sponsorName")}</Field>
        <Field label={L("sponsorId", "Sponsor ID")}>{T("sponsorId", { maxLength: 40 })}</Field>
        <Field label={L("issuePlaceEn", "Place of issue (English)")}>{T("issuePlaceEn")}</Field>
        <Field label={L("issuePlaceAr", "Place of issue (Arabic)")}>{AR("issuePlaceAr")}</Field>
        <Field label="Qualification (English)">{T("qualificationEn")}</Field>
        <Field label="Qualification (Arabic)">{AR("qualificationAr")}</Field>
        <Field label={L("professionEn", "Profession (English)")}>{T("professionEn")}</Field>
        <Field label={L("professionAr", "Profession (Arabic)")}>{AR("professionAr")}</Field>
        <Field label={L("travelPurpose", "Travel purpose")}>{S("travelPurpose", PURPOSE)}</Field>
        <Field label="Musaned">{T("musaned")}</Field>
        <Field label={L("wakala", "Wakala")}>{T("wakala")}</Field>
      </div>
      <div className={`vf-cmp ${pm == null ? "" : pm ? "ok" : "bad"}`}><h5>Profession Comparison{pm != null && <span className={`vf-pill ${pm ? "ok" : "bad"} ms6`}>{pm ? "Match" : "Not match"}</span>}</h5>
        <div className="fgrid">
          <Field label="MOFA profession">{T("mofaProfession")}</Field>
          <Field label="Enjaz Arabic profession">{AR("enjazProfessionAr")}</Field>
          <Field label="Enjaz English profession">{T("enjazProfessionEn")}</Field>
        </div></div>
    </Sec>
    <Sec n="4" title="Police Clearance & Driving License" sub="Clearance certificate and license details">
      <div className="fgrid">
        <Field label="P.C QR code URL" full hint="Paste the link from the police clearance QR code. The PC ref no. is read from it.">{T("pcUrl", { maxLength: 1000, placeholder: "Paste QR URL here", onChange: e => pcUrl(e.target.value) })}</Field>
        <Field label={L("pcRef", "PC ref no.")}>{T("pcRef")}</Field>
        <Field label="License no.">{T("licenseNo")}</Field>
        <Field label="License type">{S("licenseType", LICENSE)}</Field>
      </div>
      <details className="vf-det"><summary>Certificate details</summary><div className="fgrid mt8">
        <Field label="PC issue date">{T("pcIssueDate")}</Field>
        <Field label="Issued by (police office)">{T("pcOffice")}</Field>
      </div></details>
    </Sec>
    <Sec n="5" title="Other Information" sub="Additional stay and travel details">
      <div className="fgrid">
        <Field label="Stay duration (English)">{T("stayEn")}</Field>
        <Field label="Stay duration (Arabic)">{AR("stayAr")}</Field>
        <Field label="Arrival date (English)">{T("arrivalEn")}</Field>
        <Field label="Arrival date (Arabic)">{AR("arrivalAr")}</Field>
        <Field label="Departure date (English)">{T("departureEn")}</Field>
        <Field label="Departure date (Arabic)">{AR("departureAr")}</Field>
        <Field label="Finger">{S("finger", ["Yes", "No"])}</Field>
        <Field label="Salary">{T("salary", { inputMode: "decimal" })}</Field>
        <Field label="Food & accommodation">{T("food", { inputMode: "decimal" })}</Field>
        <Field label="Experience certificate">{S("experience", ["Yes", "No"])}</Field>
        <Field label="Note" full><textarea rows={2} value={f.note || ""} maxLength={1000} onChange={e => set({ note: e.target.value })} /></Field>
      </div>
    </Sec>
    {missing.length > 0 && <p className="muted small mt8">{`Still needed for MOFA (${missing.length}): ${missing.join(", ")}. You can save now and complete the file later.`}</p>}
    <div className="row6 mt14 vf-actions"><button className="btn pri" type="submit" disabled={busy === "save"}><LuCheck /> {old ? "Save Client File" : "Save Client File"}</button><button className="btn" type="button" onClick={closeModal}><LuArrowLeft /> Back</button></div>
  </form>;
}
