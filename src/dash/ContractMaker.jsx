// Generate Employment Contract: the country's form filled with the worker's and company's details,
// Arabic words the office can correct, new barcodes, and (if ticked) the worker's signature cut from the
// passport copy and a company signature. Download as PDF, or keep it with the passport entry.
import React from "react";
import { LuDownload, LuSave, LuSignature, LuRefreshCw, LuUpload, LuX, LuTriangleAlert } from "react-icons/lu";
import { store } from "../store.js";
import { act, toast, closeModal, readAsDataUrl } from "../actions.js";
import { Field } from "./shared.jsx";
import { drawContract, canvasPdf, inkFrom, nameAr, jobAr, companyAr, addrAr, newBarcodes, contractFor, pdfPicture } from "../contract.js";
import { isImgCopy } from "./Passports.jsx";

const saveBlob = (blob, name) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };

/* drag on the passport copy to mark where the signature is */
function SigCrop({ src, crop, setCrop }) {
  const box = React.useRef(null), start = React.useRef(null);
  const at = e => { const r = box.current.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; };
  const down = e => { e.preventDefault(); box.current.setPointerCapture(e.pointerId); start.current = at(e); };
  const move = e => { if (!start.current) return; const [x0, y0] = start.current, [x1, y1] = at(e); setCrop([Math.min(x0, x1), Math.min(y0, y1), Math.max(0.01, Math.abs(x1 - x0)), Math.max(0.01, Math.abs(y1 - y0))], false); };
  const up = () => { if (start.current) { start.current = null; setCrop(null, true); } };
  return <div className="sigcrop" ref={box} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
    <img src={src} alt="Passport copy" draggable={false} />
    <span className="sigcrop-r" style={{ left: `${crop[0] * 100}%`, top: `${crop[1] * 100}%`, width: `${crop[2] * 100}%`, height: `${crop[3] * 100}%` }} />
  </div>;
}

export function ContractMaker({ v, sig: sig0 }) {
  const J = v.job || {}, T = contractFor(v.country);
  const [d, setD] = React.useState(() => ({ ...newBarcodes(), ...J, name: J.nameEn || v.name || "", nameAr: J.nameAr || nameAr(J.nameEn || v.name), sigSalt: String(J.sigSalt || ""), jobAr: J.jobAr || jobAr(J.jobTitle), companyAr: J.companyAr || companyAr(J.company),
    visaNo: J.visaNo || "", address: v.bmet?.address || "", addressAr: addrAr(v.bmet?.address || ""), jobTitle: J.jobTitle || "", company: J.company || "", ...(J.attNo ? { attNo: J.attNo } : {}), ...(J.contractNo ? { contractNo: J.contractNo } : {}) }));
  const [sig, setSig] = React.useState(!!sig0), [crop, setCropS] = React.useState([0.05, 0.62, 0.42, 0.14]), [cropDone, setCropDone] = React.useState(0);
  const [coSig, setCoSig] = React.useState(null), [url, setUrl] = React.useState(""), [busy, setBusy] = React.useState(false), canvas = React.useRef(null);
  const copy = v.ppCopy?.data ? v.ppCopy : v.ppCopyRef || null;
  // a PDF passport copy: the scanned picture inside it is used
  const [copyImg, setCopyImg] = React.useState(isImgCopy(copy) ? copy.data : ""), [pdfNote, setPdfNote] = React.useState("");
  React.useEffect(() => { if (!copy || isImgCopy(copy)) return; let live = true;
    pdfPicture(copy.data).then(u => { if (!live) return; if (u) setCopyImg(u); else setPdfNote("This PDF has no scanned picture inside, so the signature cannot be taken from it. Upload the passport copy as a photo (JPG/PNG)."); })
      .catch(() => live && setPdfNote("The passport copy PDF could not be read. Upload it as a photo (JPG/PNG).")); return () => { live = false; }; }, []);
  const [sigPrev, setSigPrev] = React.useState(null);
  const set = x => setD(o => ({ ...o, ...x }));
  const setCrop = (c, done) => { if (c) setCropS(c); if (done) setCropDone(n => n + 1); };
  // the preview is drawn again shortly after any change
  React.useEffect(() => { let live = true; const t = setTimeout(async () => {
    try {
      const workerSig = sig && copyImg ? await inkFrom(copyImg, crop) : null; if (live) setSigPrev(workerSig ? { url: workerSig.toDataURL("image/png"), ink: workerSig.inkShare } : null);
      const companySig = sig && coSig ? await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = coSig; }) : null;
      const c = await drawContract(v.country, { ...d, signatures: sig, workerSig, companySig }); if (!live) return;
      canvas.current = c; setUrl(c.toDataURL("image/jpeg", 0.7));
    } catch (e) { if (live) toast(e.message || "Could not draw the contract."); }
  }, 350); return () => { live = false; clearTimeout(t); }; }, [JSON.stringify(d), sig, cropDone, coSig, copyImg]);
  const file = `Employment contract ${v.passport || v.name}.pdf`;
  const download = async () => { if (!canvas.current) return; saveBlob(await canvasPdf(canvas.current), file); };
  const keep = async () => { if (!canvas.current) return; if (!v.id) return toast("Save the passport first, then save the contract with it.");
    setBusy(true); const blob = await canvasPdf(canvas.current); const data = await readAsDataUrl(blob);
    const r = await act("admin.passport", { op: "contract", id: v.id, file: { name: file, data }, job: { ...J, ...d } }); setBusy(false); if (r) closeModal(); };
  const pickCo = async e => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; if (!/^image\//.test(f.type)) return toast("Choose a picture (PNG or JPG) of the signature.");
    // white paper around the signature becomes see-through
    const raw = await readAsDataUrl(f); const ink = await inkFrom(raw, [0, 0, 1, 1]); setCoSig(ink.toDataURL("image/png")); };
  const saved = (store.S.passports || []).find(p => p.id === v.id)?.contract;
  if (!T) return <div><h3>Employment contract</h3><p className="muted">There is no contract form for {v.country || "this country"} yet.</p></div>;
  return <div className="ctm">
    <div className="ctm-head"><h3><LuSignature /> {`Employment contract · ${v.country}`}</h3><span className="muted small" data-notr>{`${v.name} · ${v.passport || ""}`}</span></div>
    <div className="ctm-grid">
      <div className="ctm-form">
        <p className="muted small">Check the Arabic words — they are written from the English and can be corrected here.</p>
        {/* Qatar MOI: visa number, the Arabic name and the company, copied from the MOI visa page or the printed visa */}
        <div className="fgrid">
          <Field label="Name (English)"><input type="text" value={d.name} onChange={e => set({ name: e.target.value })} /></Field>
          <Field label="Name (Arabic)"><input type="text" dir="rtl" value={d.nameAr} onChange={e => set({ nameAr: e.target.value })} /></Field>
          <Field label="Job title (English)"><input type="text" value={d.jobTitle} onChange={e => set({ jobTitle: e.target.value, ...(jobAr(e.target.value) ? { jobAr: jobAr(e.target.value) } : {}) })} /></Field>
          <Field label="Job title (Arabic)"><input type="text" dir="rtl" value={d.jobAr} onChange={e => set({ jobAr: e.target.value })} /></Field>
          <Field label="Company (English)"><input type="text" value={d.company} onChange={e => set({ company: e.target.value, companyAr: companyAr(e.target.value) })} /></Field>
          <Field label="Company (Arabic)"><input type="text" dir="rtl" value={d.companyAr} onChange={e => set({ companyAr: e.target.value })} placeholder="اسم الشركة" /></Field>
          <Field label="Visa / ID number"><input type="text" value={d.visaNo} onChange={e => set({ visaNo: e.target.value.replace(/\s+/g, "") })} /></Field>
          <Field label="Worker's address" hint="From RAIMS Pre EC Check (the passport entry)"><input type="text" value={d.address} onChange={e => set({ address: e.target.value, addressAr: addrAr(e.target.value) })} /></Field>
          <Field label="Worker's address (Arabic)"><input type="text" dir="rtl" value={d.addressAr} onChange={e => set({ addressAr: e.target.value })} /></Field>
          <Field label="Barcode (left) — attestation no."><div className="row6"><input type="text" inputMode="numeric" value={d.attNo} onChange={e => set({ attNo: e.target.value.replace(/\D/g, "").slice(0, 20) })} /></div></Field>
          <Field label="Barcode (right) — contract no."><div className="row6"><input type="text" inputMode="numeric" value={d.contractNo} onChange={e => set({ contractNo: e.target.value.replace(/\D/g, "").slice(0, 20) })} />
            <button type="button" className="btn sm" title="New numbers" onClick={() => set(newBarcodes())}><LuRefreshCw /></button></div></Field>
        </div>
        <label className="chk mt12"><input type="checkbox" checked={sig} onChange={e => setSig(e.target.checked)} /> Worker and company signatures</label>
        {sig && <div className="ctm-sig">
          <b>Worker's signature</b>
          {copyImg ? <><p className={cropDone ? "muted small" : "small ctm-warn"}>{cropDone ? "Drag again to change it." : "Drag on the passport copy around the worker's signature (the red box shows what is taken)."}</p>
              <SigCrop src={copyImg} crop={crop} setCrop={setCrop} />
              <div className="ctm-sigprev"><span className="muted small">On the contract:</span>{sigPrev?.url && <img src={sigPrev.url} alt="Worker's signature" />}
                {sigPrev && sigPrev.ink < 0.004 && <span className="ctm-warn small"><LuTriangleAlert /> No signature found in the box — drag around the signature.</span>}</div></>
            : <p className="muted small">{pdfNote || (copy ? "Reading the passport copy…" : "No passport copy in this entry, so the worker's signature space stays empty. Add the passport copy in the passport entry.")}</p>}
          <b className="mt12">Company signature</b>
          <p className="muted small">{coSig ? "Your signature picture is used." : "A pen signature is drawn for the company. Or upload a picture of the real one:"}</p>
          <div className="row6">{!coSig && <button type="button" className="btn sm" onClick={() => set({ sigSalt: String(((Math.random() * 4294967296) >>> 0) || 1) })}><LuRefreshCw /> Another pen signature</button>}<label className="btn sm"><LuUpload /> Signature picture<input type="file" accept="image/*" hidden onChange={pickCo} /></label>{coSig && <button type="button" className="btn sm" onClick={() => setCoSig(null)}><LuX /> Remove</button>}</div>
          <p className="muted small">Under it: {[d.company, d.companyReg && `Reg. ${d.companyReg}`, d.companyMobile].filter(Boolean).join(" · ") || "add the company details in the passport entry"}</p>
        </div>}
      </div>
      <div className="ctm-prev">{url ? <img src={url} alt="Employment contract preview" /> : <div className="muted center">Drawing the contract…</div>}</div>
    </div>
    <div className="row between mt14">
      <span className="muted small">{saved ? `Saved with the passport on ${new Date(saved.at).toLocaleDateString("en-GB")}` : ""}</span>
      <div className="row6"><button type="button" className="btn" disabled={!url} onClick={download}><LuDownload /> Download PDF</button>
        <button type="button" className="btn pri" disabled={!url || busy} onClick={keep} title={v.id ? "Keep this contract with the passport entry" : "Save the passport first"}><LuSave /> Save with passport</button></div>
    </div>
  </div>;
}
