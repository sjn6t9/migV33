// Visiting card window: preview both sides, pick one of the five languages, print at real size, download PNG.
import React from "react";
import { LuPhone, LuMail, LuGlobe, LuMapPin, LuPrinter, LuDownload, LuLanguages, LuLoaderCircle } from "react-icons/lu";
import { FaWhatsapp } from "react-icons/fa6";
import { store } from "./store.js";
import { toast } from "./actions.js";
import { LANGS, getLang } from "./i18n.js";
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
        const opts = { lang, settings: store.S.settings, site: location.host, icons };
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
