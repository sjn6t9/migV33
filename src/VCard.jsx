// Visiting card window: preview both sides, pick one of the five languages, print at real size, download PNG.
import React from "react";
import { LuPhone, LuMail, LuGlobe, LuMapPin, LuPrinter, LuDownload, LuLanguages, LuLoaderCircle, LuBadgeCheck, LuCircleAlert, LuX, LuExternalLink, LuSearch } from "react-icons/lu";
import { FaWhatsapp } from "react-icons/fa6";
import { store, touch, memberCode, findMember } from "./store.js";
import { toast, openModal } from "./actions.js";
import { LANGS, getLang, setLang } from "./i18n.js";
import { Avatar } from "./ui.jsx";
import { drawVisitingCard, canvasBlob } from "./vcard.js";

const slug = s => String(s || "card").normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 40) || "card";

export function VisitingCard({ teamId }) {
  const m = store.S.team.find(x => x.id === teamId);
  const [lang, setLang] = React.useState(getLang());
  const [urls, setUrls] = React.useState(null);
  const [busy, setBusy] = React.useState(true);
  const iconsRef = React.useRef(null);
  const blobs = React.useRef({});

  React.useEffect(() => {
    if (!m) return;
    let alive = true; setBusy(true);
    (async () => {
      try {
        const box = iconsRef.current; const icons = {};
        box?.querySelectorAll("[data-ic]").forEach(el => { icons[el.dataset.ic] = el.innerHTML; });
        const opts = { lang, settings: store.S.settings, site: location.host, icons, verifyUrl: `${location.origin}/v/${m.id}` };
        const [f, b] = await Promise.all([drawVisitingCard(m, { ...opts, side: "front" }), drawVisitingCard(m, { ...opts, side: "back" })]);
        const [fb, bb] = await Promise.all([canvasBlob(f), canvasBlob(b)]);
        if (!alive) return;
        Object.values(blobs.current).forEach(u => URL.revokeObjectURL(u));
        blobs.current = { front: URL.createObjectURL(fb), back: URL.createObjectURL(bb) };
        setUrls({ ...blobs.current });
      } catch (e) { console.error(e); toast("The card could not be made in this browser."); }
      finally { if (alive) setBusy(false); }
    })();
    return () => { alive = false; };
  }, [teamId, lang]);
  React.useEffect(() => () => Object.values(blobs.current).forEach(u => URL.revokeObjectURL(u)), []);

  if (!m) return <p>Team member not found.</p>;
  const file = side => `MAM-visiting-card-${slug(m.name)}-${lang}-${side}.png`;
  const download = side => { if (!urls) return; const a = document.createElement("a"); a.href = urls[side]; a.download = file(side); document.body.appendChild(a); a.click(); a.remove(); };
  const print = () => {
    if (!urls) return;
    const box = document.createElement("div"); box.id = "vcard-print";
    box.innerHTML = `<img src="${urls.front}" alt=""><img src="${urls.back}" alt="">`;
    document.body.appendChild(box); document.body.classList.add("printing-card");
    const done = () => { document.body.classList.remove("printing-card"); box.remove(); removeEventListener("afterprint", done); };
    addEventListener("afterprint", done);
    Promise.all([...box.querySelectorAll("img")].map(i => i.decode().catch(() => null))).then(() => { window.print(); setTimeout(() => { if (document.getElementById("vcard-print")) done(); }, 60000); });
  };

  return (
    <div className="vcard">
      <h3>Visiting card</h3>
      <p className="muted small">{m.name}{m.title ? ` · ${m.title}` : ""}</p>
      <div className="vc-langs" role="radiogroup" aria-label="Card language">
        <LuLanguages aria-hidden="true" />
        {LANGS.map(l => <button key={l.code} type="button" role="radio" aria-checked={lang === l.code} className={`chipbtn${lang === l.code ? " on" : ""}`} onClick={() => setLang(l.code)} data-notr>{l.name}</button>)}
      </div>
      <div className={`vc-sides${busy ? " busy" : ""}`}>
        {["front", "back"].map(side => (
          <figure key={side}>
            {urls ? <img src={urls[side]} alt={side === "front" ? "Front" : "Back"} /> : <div className="vc-ph"><LuLoaderCircle className="spin" /></div>}
            <figcaption className="small muted">{side === "front" ? "Front" : "Back"}</figcaption>
          </figure>
        ))}
      </div>
      <div className="row wrap">
        <button className="btn pri" onClick={print} disabled={!urls || busy}><LuPrinter /> Print</button>
        <button className="btn" onClick={() => download("front")} disabled={!urls || busy}><LuDownload /> Download front (PNG)</button>
        <button className="btn" onClick={() => download("back")} disabled={!urls || busy}><LuDownload /> Download back (PNG)</button>
      </div>
      <p className="small muted mt8">Printed at the real card size (3.5 × 2 in, 300 dpi). Cut along the thin lines.</p>
      <div ref={iconsRef} hidden aria-hidden="true">
        <span data-ic="phone"><LuPhone /></span><span data-ic="whatsapp"><FaWhatsapp /></span><span data-ic="mail"><LuMail /></span>
        <span data-ic="globe"><LuGlobe /></span><span data-ic="pin"><LuMapPin /></span>
      </div>
    </div>
  );
}

/* What the QR code / ID check shows: the member's details, or a warning if the card is not valid */
export function VerifyBody({ m, onClose }) {
  const S = store.S;
  const wa = m?.whatsapp ? String(m.whatsapp).replace(/\D/g, "") : "";
  const code = memberCode(m);
  const site = () => { location.href = location.origin + "/#home"; };
  return (
    <div className="verify-card">
      {m ? <>
        <div className="verify-ok"><LuBadgeCheck /> <span>Verified team member</span></div>
        <div className="verify-photo">{m.photo ? <img src={m.photo.data} alt={m.name} /> : <Avatar name={m.name} size={120} />}</div>
        <h1>{m.name}</h1>
        <div className="verify-title">{m.title}</div>
        {m.dept && <div className="muted">{m.dept}</div>}
        {code && <div className="verify-id"><span>ID</span> <b className="num">{code}</b></div>}
        <p className="verify-note">This person works for Mam &amp; Mam Overseas Ltd., government licensed recruiting agency (RL 1217).</p>
        <ul className="verify-list">
          {m.phone && <li><LuPhone /> <a href={`tel:${m.phone.replace(/[^\d+]/g, "")}`}><span className="num">{m.phone}</span></a></li>}
          {wa && <li><FaWhatsapp /> <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer"><span className="num">+{wa}</span></a></li>}
          {m.email && <li><LuMail /> <a href={`mailto:${m.email}`}>{m.email}</a></li>}
          {m.website && <li><LuGlobe /> <a href={m.website} target="_blank" rel="noopener noreferrer">{m.website.replace(/^https?:\/\//, "")}</a></li>}
          {S.settings.address && <li><LuMapPin /> <span>{S.settings.address}</span></li>}
        </ul>
      </> : <>
        <div className="verify-bad"><LuCircleAlert /> <span>This card is not valid</span></div>
        <p className="verify-note">We could not find this person in our team. Do not pay or hand over documents. Contact our office to check.</p>
      </>}
      <div className="verify-btns">
        <button className="btn pri" onClick={site}><LuExternalLink /> Visit Website</button>
        <button className="btn" onClick={onClose}><LuX /> Close</button>
      </div>
    </div>
  );
}

/* Page opened by the QR code on a visiting card (/v/<member>) or by an ID link */
export function VerifyMember({ id }) {
  const loaded = store.loaded; const m = loaded ? findMember(id) : null;
  const close = () => {
    window.close();
    setTimeout(() => { if (history.length > 1) history.back(); else location.hash = "home"; }, 250);
  };
  return (
    <div className="verify-page">
      <div className="verify-top">
        <span className="verify-brand"><img src="/brand/logo-w160.webp?v=2" width="64" height="40" alt="" /> <span className="vb-name">MAM &amp; MAM OVERSEAS LTD.</span></span>
        <select aria-label="Language" value={getLang()} onChange={async e => { await setLang(e.target.value); touch(); }} data-notr>
          {LANGS.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
        </select>
      </div>
      {loaded ? <VerifyBody m={m} onClose={close} /> : <div className="verify-card"><div className="verify-load"><LuLoaderCircle className="spin" /></div></div>}
      <p className="verify-foot">Recruiting Licence RL 1217 · {location.host}</p>
    </div>
  );
}

/* "Verify a team member" box on the Expert Team page: type the ID from the card */
export function VerifyBox() {
  const [v, setV] = React.useState("");
  const submit = e => {
    e.preventDefault(); const k = v.replace(/[\s-]/g, "");
    if (!/^\d{9,12}$/.test(k)) return toast("Enter the ID number printed under the QR code, e.g. 121720261.");
    openModal("memberCheck", { key: k });
  };
  return (
    <form className="card verify-box" onSubmit={submit}>
      <div className="vb-text"><h2><LuBadgeCheck /> Verify a team member</h2>
        <p className="muted">Enter the ID number printed under the QR code on the visiting card. You see the same details as when you scan the code.</p></div>
      <div className="vb-form">
        <input type="text" inputMode="numeric" autoComplete="off" value={v} onChange={e => setV(e.target.value)} placeholder="e.g. 121720261" aria-label="Member ID" maxLength={14} />
        <button className="btn pri" type="submit"><LuSearch /> Verify</button>
      </div>
    </form>
  );
}
