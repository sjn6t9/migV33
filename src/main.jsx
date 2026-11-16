import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { loadState, store } from "./store.js";
import "./styles.css";

createRoot(document.getElementById("root")).render(<App />);
loadState();
// keep the page up to date: refresh when the tab comes back and every minute while it is open (unless a form is busy)
document.addEventListener("visibilitychange", () => { if (!document.hidden && !store.ui.busy) loadState(); });
setInterval(() => { if (!document.hidden && !store.ui.busy && !store.ui.modal) loadState(); }, 60000);
