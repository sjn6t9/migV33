// Day / Night mode. With no saved choice the site follows the phone or computer setting.
const KEY = "mam_theme";
const mq = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;

export function savedTheme() { try { return localStorage.getItem(KEY) || ""; } catch (e) { return ""; } }
export function currentTheme() { return savedTheme() || (mq && mq.matches ? "dark" : "light"); }

export function applyTheme() {
  const s = savedTheme(); const el = document.documentElement;
  // switch with animations off and make the browser work out every colour again at once, so no part keeps its old Day/Night colours
  el.classList.add("theme-switching");
  if (s) el.dataset.theme = s; else delete el.dataset.theme;
  void el.offsetHeight;
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove("theme-switching")));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", currentTheme() === "dark" ? "#0f1f19" : "#006a4e");
}

export function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  try { localStorage.setItem(KEY, next); } catch (e) {}
  applyTheme();
  return next;
}

if (mq && mq.addEventListener) mq.addEventListener("change", applyTheme);

/** "light", "dark" or "" (follow the phone or computer) */
export function setTheme(mode) {
  try { if (mode) localStorage.setItem(KEY, mode); else localStorage.removeItem(KEY); } catch (e) {}
  applyTheme();
}
