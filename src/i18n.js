// Site-wide language support: English (default), Bangla, Arabic (right-to-left), Hindi and Fijian.
// The interface is written in English. When another language is chosen, its dictionary
// (dist/i18n/<code>.json, built from i18n/<code>.tsv) is loaded and every English text on the page
// (text, placeholders, tooltips, labels) is shown in that language, including text React adds later.
// Content typed in by people (job titles, descriptions, names) stays as written.

export const LANGS = [
  { code: "en", name: "English", short: "EN" },
  { code: "bn", name: "বাংলা", short: "বাং" },
  { code: "ar", name: "العربية", short: "ع", rtl: true },
  { code: "hi", name: "हिन्दी", short: "हि" },
  { code: "fj", name: "Vosa Vakaviti", short: "FJ" },
];
const KEY = "mam_lang";
const ATTRS = ["placeholder", "title", "aria-label"];
const SKIP = "script,style,textarea,code,pre,[data-notr],[contenteditable]";

let lang = "en";
let dict = null; // { "English text": "translation" }
let pats = []; // [[RegExp, template]]
const textOrig = new WeakMap(); // text node -> { o: original English, t: shown text }
const attrOrig = new WeakMap(); // element -> { attr: { o, t } }
let observer = null;
const listeners = new Set();

export const getLang = () => lang;
export const isRtl = () => !!LANGS.find(l => l.code === lang)?.rtl;
export const onLang = f => { listeners.add(f); return () => listeners.delete(f); };

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function lookup(s) {
  if (!dict) return null;
  const k = s.replace(/\s+/g, " ").trim();
  if (!k || !/[A-Za-z]/.test(k)) return null;
  let r = dict[k];
  if (r == null) {
    for (const [re, tpl] of pats) {
      const m = k.match(re);
      if (m) { r = tpl.replace(/\{(\d)\}/g, (_, i) => { const v = m[+i + 1] ?? ""; return dict[v.trim()] ?? v; }); break; }
    }
  }
  if (r == null) return null;
  return s.match(/^\s*/)[0] + r + s.match(/\s*$/)[0];
}

/** Translate a string for places outside the page (document title, canvas). */
export function t(s) { return (lang !== "en" && lookup(String(s))) || s; }

function doText(n) {
  const p = n.parentElement; if (!p || p.closest(SKIP)) return;
  const rec = textOrig.get(n);
  const o = rec && n.nodeValue === rec.t ? rec.o : n.nodeValue;
  const tr = lang === "en" ? o : (lookup(o) ?? o);
  if (tr !== n.nodeValue) n.nodeValue = tr;
  if (tr !== o) textOrig.set(n, { o, t: tr }); else textOrig.delete(n);
}
function doAttr(el, a) {
  if (!el.hasAttribute(a) || el.closest("[data-notr]")) return;
  const all = attrOrig.get(el) || {}; const rec = all[a]; const cur = el.getAttribute(a);
  const o = rec && cur === rec.t ? rec.o : cur;
  const tr = lang === "en" ? o : (lookup(o) ?? o);
  if (tr !== cur) el.setAttribute(a, tr);
  if (tr !== o) { all[a] = { o, t: tr }; attrOrig.set(el, all); } else if (rec) delete all[a];
}
function walk(root) {
  if (root.nodeType === 3) return doText(root);
  if (root.nodeType !== 1) return;
  if (root.closest && root.closest(SKIP)) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) doText(n);
  for (const a of ATTRS) { if (root.hasAttribute?.(a)) doAttr(root, a); root.querySelectorAll(`[${a}]`).forEach(el => doAttr(el, a)); }
}

function startObserver() {
  if (observer) return;
  observer = new MutationObserver(recs => {
    for (const r of recs) {
      if (r.type === "characterData") doText(r.target);
      else if (r.type === "attributes") doAttr(r.target, r.attributeName);
      else r.addedNodes.forEach(walk);
    }
    observer.takeRecords(); // ignore the changes made just now
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

async function loadDict(code) {
  const res = await fetch(`/i18n/${code}.json?v=${typeof __I18N_V__ !== "undefined" ? __I18N_V__ : "1"}`, { cache: "force-cache" });
  if (!res.ok) throw new Error("dictionary " + res.status);
  const d = await res.json();
  return { k: d.k || {}, p: (d.p || []).map(([src, tpl]) => [new RegExp("^" + escRe(src).replace(/\\\{\d\\\}/g, "([\\s\\S]*?)") + "$"), tpl]) };
}

function applyDocAttrs() {
  const l = LANGS.find(x => x.code === lang) || LANGS[0];
  document.documentElement.lang = lang === "fj" ? "fj" : lang;
  document.documentElement.dir = l.rtl ? "rtl" : "ltr";
}

/** Switch the whole site to another language and remember the choice. */
export async function setLang(code) {
  if (!LANGS.some(l => l.code === code)) code = "en";
  try {
    if (code !== "en") { const d = await loadDict(code); dict = d.k; pats = d.p; }
    lang = code;
  } catch (e) { console.warn("Language could not be loaded:", e); return false; }
  try { localStorage.setItem(KEY, code); } catch (e) {}
  applyDocAttrs();
  walk(document.body);
  if (code === "en") { dict = null; pats = []; }
  startObserver();
  listeners.forEach(f => f(code));
  return true;
}

/** Called once before the first render: restores the last language (or the browser's, if it is one of ours). */
export async function initLang() {
  let code = "en";
  try { code = localStorage.getItem(KEY) || ""; } catch (e) {}
  if (!code) { const nav = (navigator.language || "en").slice(0, 2).toLowerCase(); code = LANGS.some(l => l.code === nav) ? nav : "en"; }
  if (code === "en") { startObserver(); return; }
  await Promise.race([setLang(code), new Promise(r => setTimeout(r, 2500))]);
}
