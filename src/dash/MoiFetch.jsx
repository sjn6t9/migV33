// Qatar MOI visa details: the MOI verification picture is shown here, the office types it, and the portal
// asks MOI with the passport number already entered. Fills visa number, Arabic name and company.
import React from "react";
import { LuRefreshCw, LuSearch, LuX, LuDownload, LuClipboardPaste } from "react-icons/lu";
import { act, toast } from "../actions.js";
import { parseMoi } from "../contract.js";

export function MoiFetch({ passport, onFill }) {
  const [s, setS] = React.useState(null); // { sid, img }
  const [code, setCode] = React.useState(""), [busy, setBusy] = React.useState(false), [msg, setMsg] = React.useState(""), [pdf, setPdf] = React.useState(null);
  const [paste, setPaste] = React.useState(false), [txt, setTxt] = React.useState("");
  const pp = String(passport || "").replace(/\s+/g, "").toUpperCase();
  const start = async () => {
    if (pp.length < 4) return toast("Enter the passport number first.");
    setBusy(true); setMsg(""); setCode(""); setPdf(null);
    const r = await act("moi.start", {}, { quiet: true }); setBusy(false);
    if (r?.sid) setS(r); else setPaste(true);
  };
  const again = async () => { if (!s) return; setBusy(true); const r = await act("moi.captcha", { sid: s.sid }, { quiet: true }); setBusy(false); setCode("");
    if (r?.img) setS({ ...s, img: r.img }); else setS(null); };
  const fill = (m, from) => {
    if (!Object.keys(m).length) return toast("Nothing was found.");
    if (m.passport && pp && m.passport !== pp) toast(`Careful: MOI answered for passport ${m.passport}.`);
    onFill(m); toast(`${from}: ${[m.visaNo && "visa number", m.nameAr && "Arabic name", m.company && "company", m.companyAr && "company (Arabic)"].filter(Boolean).join(", ") || "nothing new"}.`);
  };
  const look = async e => {
    e?.preventDefault(); if (code.trim().length !== 5) return toast("Type the 5 characters from the picture.");
    setBusy(true); setMsg("");
    const r = await act("moi.lookup", { sid: s.sid, passport: pp, captcha: code.trim() }, { quiet: true }); setBusy(false);
    if (!r) { setS(null); return; }
    if (!r.ok) { setMsg(r.problem || "No answer."); setCode(""); if (r.img) setS({ ...s, img: r.img }); else setS(null); return; }
    const m = parseMoi(`${r.text}\n${r.pdfText || ""}`); if (!m.visaNo && r.visaNo) m.visaNo = r.visaNo;
    setS(null); setCode(""); setPdf(r.pdf || null); fill(m, "From Qatar MOI");
    if (!m.company && !m.companyAr) setMsg("MOI did not give the company name. Type it in the company field.");
  };
  const fromPaste = () => { const m = parseMoi(txt); if (!Object.keys(m).length) return toast("Nothing was found. Copy the whole Visa Number Information page and paste it here."); fill(m, "From the pasted text"); setPaste(false); setTxt(""); };

  return <div className="moi-box">
    {!s ? <div className="row6">
        <button type="button" className="btn sm" disabled={busy} onClick={start}>{busy ? <LuRefreshCw className="spin" /> : <LuSearch />} Get visa details from Qatar MOI</button>
        {pdf && <a className="btn sm link" href={pdf} download={`Visa_${pp}.pdf`}><LuDownload /> Visa PDF</a>}
        {!paste && <button type="button" className="btn sm link" onClick={() => setPaste(true)}><LuClipboardPaste /> Paste text</button>}
      </div>
      : <div className="moi-cap">
        <span className="muted small">{`Passport ${pp} · type the code from the picture`}</span>
        <div className="row6">
          <img src={s.img} alt="MOI verification code" />
          <button type="button" className="btn sm icon" title="New picture" aria-label="New picture" disabled={busy} onClick={again}><LuRefreshCw /></button>
          <input type="text" value={code} maxLength={5} autoFocus autoComplete="off" spellCheck={false} aria-label="Verification code" onChange={e => setCode(e.target.value.replace(/\s+/g, ""))} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); look(); } }} />
          <button type="button" className="btn sm pri" disabled={busy} onClick={look}>{busy ? <LuRefreshCw className="spin" /> : <LuSearch />} Get</button>
          <button type="button" className="btn sm" onClick={() => setS(null)}><LuX /></button>
        </div>
      </div>}
    {msg && <p className="small moi-msg">{msg}</p>}
    {paste && <div className="stack6 mt6">
      <span className="muted small">If MOI cannot be reached from here: copy the MOI Visa Number Information (or the printed visa text) and paste it.</span>
      <textarea rows={4} value={txt} onChange={e => setTxt(e.target.value)} placeholder="Visa Number (382026…) Information …" />
      <div className="row6"><button type="button" className="btn sm pri" onClick={fromPaste}>Fill</button><button type="button" className="btn sm" onClick={() => setPaste(false)}><LuX /> Cancel</button></div></div>}
  </div>;
}
