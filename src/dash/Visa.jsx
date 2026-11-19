// Visa applications › KSA visa › HR files: a dashboard of client files (MOFA, visa, sponsor, medical) and the Create Client File form.
import React from "react";
import { LuFilePlus2, LuSearch, LuPencil, LuTrash2, LuFileSpreadsheet, LuX, LuExternalLink, LuCheck, LuArrowLeft, LuDownload, LuFileText } from "react-icons/lu";
import { VISA_FIELDS, VISA_DATES, VISA_LINKS } from "../constants.js";
import { store, commit } from "../store.js";
import { act, openModal, closeModal, confirmBox, toast } from "../actions.js";
import { Field } from "./shared.jsx";
import { Empty } from "../ui.jsx";
import { PassportPick } from "./Passports.jsx";
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
  const ui = store.ui, sub = ui.visaSub || "ksa";
  return <>
    <nav className="pay-tabs" aria-label="Visa applications"><button className={sub === "ksa" ? "on" : ""} aria-current={sub === "ksa" ? "page" : undefined} onClick={() => { ui.visaSub = "ksa"; commit(); }}>KSA Visa</button></nav>
    <nav className="pay-tabs vf-sub" aria-label="KSA Visa"><button className="on" aria-current="page">HR Files<span className="count soft">{files().length}</span></button></nav>
    <HrFiles />
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
  const fetchPp = async () => { setBusy("pp"); const r = await act("admin.visa", { op: "fetch", passport: qp, id }); setBusy(""); if (r?.found) set({ ...Object.fromEntries(Object.entries(r.found).filter(([k]) => VISA_FIELDS.includes(k) || k === "name")), passport: qp.replace(/\s+/g, "").toUpperCase() }); else set({ passport: qp.replace(/\s+/g, "").toUpperCase() }); };
  const searchVisa = async () => { setBusy("visa"); const r = await act("admin.visa", { op: "visaSearch", ...qv, id }); setBusy(""); set({ ...(qv.visaNo ? { visaNo: qv.visaNo } : {}), ...(qv.sponsorId ? { sponsorId: qv.sponsorId } : {}), ...(r?.found || {}) }); };
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
      <div className="fgrid">
        <Field label="Agent"><select value={f.agentId || ""} onChange={e => set({ agentId: e.target.value })}><option value="">No agent (office client)</option>{agentsList().map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        <Field label="Remark">{T("remark", { placeholder: "Remark" })}</Field>
        <Field label="Mofa status">{S("mofaStatus", MOFA_ST, "Not applied")}</Field>
        <Field label="Visa status">{S("visaStatus", VISA_ST, "Pending")}</Field>
        <Field label="Profession match"><div className={`vf-box ${pm == null ? "" : pm ? "ok" : "bad"}`}>{pm == null ? "Not checked" : pm ? "Match" : "Not match"}</div></Field>
        <Field label="Medical report">{S("medicalResult", ["FIT", "UNFIT", "Pending"])}</Field>
        <Field label="GCC slip info"><div className="vf-two">{T("gccSlipNo", { placeholder: "Slip no." })}{T("medicalSlipDate", { "aria-label": "Medical slip date" })}</div></Field>
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
