import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { loadState, store } from "./store.js";
import "./styles.css";
import { initLang } from "./i18n.js";
import { applyTheme } from "./theme.js";

// shared job links look like /job/<id>; open them inside the app
const shared = location.pathname.match(/^\/job\/([a-z0-9]+)\/?$/i);
if (shared) history.replaceState(null, "", `/#job-${shared[1]}`);
// visiting-card QR codes point to /v/<member id>; show the verification page
const verify = location.pathname.match(/^\/v\/([a-z0-9]+)\/?$/i);
if (verify) history.replaceState(null, "", `/#verify-${verify[1]}`);
// money-receipt QR codes point to /r/<code>; show that receipt
const receipt = location.pathname.match(/^\/r\/([a-f0-9]{24})\/?$/i);
if (receipt) history.replaceState(null, "", `/#receipt-${receipt[1]}`);
const salary = location.pathname.match(/^\/s\/([a-f0-9]{24})\/?$/i); // salary receipt QR codes
if (salary) history.replaceState(null, "", `/#salary-${salary[1]}`);
const stmt = location.pathname.match(/^\/st\/([a-f0-9]{24})\/?$/i); // statement QR codes
if (stmt) history.replaceState(null, "", `/#statement-${stmt[1]}`);
applyTheme();
loadState();
initLang().finally(() => createRoot(document.getElementById("root")).render(<App />));
// keep the page up to date: refresh when the tab comes back and every minute while it is open (unless a form is busy)
document.addEventListener("visibilitychange", () => { if (!document.hidden && !store.ui.busy) loadState(); });
// live updates: each second ask the server whether anything changed (a tiny request); if it did, reload the data.
// While someone is typing in a form the reload waits until they leave the field, so nothing they type is disturbed.
let checking = false, waiting = false;
const typing = () => { const a = document.activeElement; return !!a && (a.tagName === "TEXTAREA" || a.tagName === "SELECT" || (a.tagName === "INPUT" && !["button", "submit", "checkbox", "radio"].includes(a.type))); };
setInterval(async () => {
  if (document.hidden || checking || store.ui.busy) return;
  checking = true;
  try {
    const r = await fetch("/api/rev", { credentials: "same-origin", cache: "no-store" }); const j = await r.json();
    const meNow = store.S.session || null;
    if (j.rev !== store.S.rev || (j.me || null) !== meNow) waiting = true;
    if (waiting && !typing()) { waiting = false; await loadState(); }
  } catch { /* offline: try again next second */ }
  checking = false;
}, 1000);
