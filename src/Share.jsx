import React, { useEffect, useState } from "react";
import { LuShare2, LuDownload, LuLink, LuLoaderCircle } from "react-icons/lu";
import { FaWhatsapp, FaFacebookF } from "react-icons/fa6";
import { store, me, job, company } from "./store.js";
import { act, toast, readAsDataUrl, openModal } from "./actions.js";
import { renderJobCard } from "./jobcard.js";

export const shareLink = j => `${location.origin}/job/${j.id}`;
const safeName = j => `${j.title}-${j.city}`.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase();

/* who may save the card on the server (used for Facebook/WhatsApp link previews) */
function canStoreCard(j) {
  const u = me(); if (!u) return false;
  if (u.role === "admin") return true;
  if (u.role === "staff") return !!u.perms?.includes("jobs");
  return u.role === "employer" && j.employerId === u.id;
}
// cards made before the agency logo was added (CARD_DESIGN) are redrawn once
const CARD_DESIGN = "2026-11-17T13:23:00Z";
const cardOutdated = j => !j.card || !j.cardAt || j.cardAt < CARD_DESIGN || (j.updatedAt && j.updatedAt > j.cardAt);

export async function makeCard(j) {
  return renderJobCard(j, { company: company(j), settings: store.S.settings, link: shareLink(j) });
}
/* Make the card and save it on the server; used after a job is approved and when its owner opens Share */
export async function storeCard(j) {
  try { const blob = await makeCard(j); await act("job.card", { id: j.id, file: { name: `${safeName(j)}.png`, data: await readAsDataUrl(blob) } }, { quiet: true }); }
  catch { /* the card is optional; sharing still works with the plain link */ }
}

export function ShareJob({ jobId }) {
  const j = job(jobId);
  const [img, setImg] = useState(null); const [blob, setBlob] = useState(null); const [err, setErr] = useState("");
  useEffect(() => {
    let url = null, alive = true;
    if (!j) return;
    makeCard(j).then(async b => {
      if (!alive) return; url = URL.createObjectURL(b); setBlob(b); setImg(url);
      if (canStoreCard(j) && cardOutdated(j)) act("job.card", { id: j.id, file: { name: `${safeName(j)}.png`, data: await readAsDataUrl(b) } }, { quiet: true });
    }).catch(() => alive && setErr("The photocard could not be made in this browser. You can still share the link."));
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [jobId]);
  if (!j) return <p>This job is no longer available.</p>;
  const link = shareLink(j); const text = `${j.title} – ${j.city}, ${j.country}. Apply: ${link}`;
  const file = blob ? new File([blob], `${safeName(j)}.png`, { type: "image/png" }) : null;
  const canShareFile = !!(file && navigator.canShare && navigator.canShare({ files: [file] }));
  const shareImage = async () => { try { await navigator.share({ files: [file], title: j.title, text }); } catch (e) { if (e?.name !== "AbortError") toast("Sharing was not completed."); } };
  const download = () => { const a = document.createElement("a"); a.href = img; a.download = `${safeName(j)}.png`; document.body.appendChild(a); a.click(); a.remove(); };
  const copy = async () => { try { await navigator.clipboard.writeText(link); toast("Link copied."); } catch { toast(link); } };
  return (
    <>
      <h3><LuShare2 /> Share this job</h3>
      <p className="muted small mt8">The photocard is a PNG image. Share it directly from your phone, or download it and post it on Facebook, WhatsApp or anywhere else.</p>
      <div className="sharebox mt14">
        <div className="share-prev">{img ? <img src={img} alt={`Photocard: ${j.title}`} /> : err ? <p className="muted small">{err}</p> : <span className="muted small row tight"><LuLoaderCircle className="spin" /> Making the photocard…</span>}</div>
        <div className="stack8 share-actions">
          {canShareFile && <button className="btn pri" onClick={shareImage}><LuShare2 /> Share photocard</button>}
          <button className="btn" onClick={download} disabled={!img}><LuDownload /> Download PNG</button>
          <a className="btn fb" href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`} target="_blank" rel="noopener noreferrer"><FaFacebookF /> Share on Facebook</a>
          <a className="btn wa" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer"><FaWhatsapp /> Send on WhatsApp</a>
          <button className="btn" onClick={copy}><LuLink /> Copy link</button>
          <p className="muted small">Facebook and WhatsApp show the photocard as the link preview.</p>
        </div>
      </div>
    </>
  );
}

export function ShareButton({ j, small, label = "Share" }) {
  return <button className={`btn${small ? " sm" : ""}`} onClick={() => openModal("share", { jobId: j.id })} aria-label={`Share ${j.title}`}><LuShare2 />{label && ` ${label}`}</button>;
}
