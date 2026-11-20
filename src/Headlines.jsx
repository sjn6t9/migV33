import React from "react";
import { LuMegaphone } from "react-icons/lu";
import { store } from "./store.js";

/* HEADLINES: a news line under the header of the website, set in Admin › Headlines */
export function Headlines({ items }) {
  const L = items || store.S.headlines || []; if (!L.length) return null;
  const one = (h, k) => <span key={`${k}-${h.id}`} className="hl-item">{h.hot && <span className="hl-new">NEW</span>}{h.link ? <a href={h.link} {...(/^https?:/.test(h.link) ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{h.text}</a> : h.text}<span className="hl-sep" aria-hidden="true">✦</span></span>;
  return <div className="headlines" role="region" aria-label="Headlines"><div className="wrap hl-in">
    <b className="hl-label"><LuMegaphone /> HEADLINES</b>
    <div className="hl-view"><div className="hl-track" style={{ animationDuration: `${Math.max(18, L.reduce((t, h) => t + h.text.length, 0) / 5)}s` }}>{L.map(h => one(h, "a"))}<span aria-hidden="true" className="hl-dup">{L.map(h => one(h, "b"))}</span></div></div>
  </div></div>;
}
