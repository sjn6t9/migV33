// Inlines the esbuild output (build/main.js + build/main.css) into one dist/index.html.
import fs from "node:fs";
import crypto from "node:crypto";
// language dictionaries: i18n/keys.json + i18n/pats.json (English) and i18n/<code>.tsv ("index<TAB>translation", "P<index>" for patterns)
const keys = JSON.parse(fs.readFileSync("i18n/keys.json", "utf8")), pats = JSON.parse(fs.readFileSync("i18n/pats.json", "utf8"));
fs.mkdirSync("dist/i18n", { recursive: true });
const dicts = {};
for (const f of fs.readdirSync("i18n").filter(f => /^[a-z]{2}\.tsv$/.test(f))) {
  const code = f.slice(0, -4); const k = {}, p = [];
  for (const line of fs.readFileSync("i18n/" + f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^(P?)(\d+)(?:\t|\s*\|\s?)(.+)$/); if (!m) continue;
    const tr = m[3].replace(/\\n/g, "\n").trim();
    if (m[1]) { if (pats[+m[2]] != null) p.push([pats[+m[2]].replace(/\\n|\n/g, " ").replace(/\s+/g, " ").trim(), tr.replace(/\s+/g, " ")]); } else if (keys[+m[2]] != null) k[keys[+m[2]]] = tr;
  }
  dicts[code] = JSON.stringify({ k, p });
}
const i18nV = crypto.createHash("sha1").update(Object.values(dicts).join("")).digest("hex").slice(0, 8);
for (const [code, json] of Object.entries(dicts)) { fs.writeFileSync(`dist/i18n/${code}.json`, json); console.log(`dist/i18n/${code}.json (${Math.round(json.length / 1024)} KB)`); }
const css = fs.readFileSync("build/main.css", "utf8");
const js = `var __I18N_V__=${JSON.stringify(i18nV)};` + fs.readFileSync("build/main.js", "utf8").replace(/<\/script/g, "<\\/script");
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#006a4e">
<meta name="color-scheme" content="light dark">
<script>try{var t=localStorage.getItem("mam_theme");if(t)document.documentElement.dataset.theme=t;var l=localStorage.getItem("mam_lang");if(l==="ar")document.documentElement.dir="rtl";}catch(e){}</script>
<title>MAM &amp; MAM Overseas Ltd.</title>
<meta name="description" content="MAM & MAM Overseas Ltd. — licensed recruiting agency (RL 1217). Overseas jobs in Saudi Arabia, Malaysia and Fiji.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800&family=Hind+Siliguri:wght@400;500;600;700&family=Hind:wght@400;500;600;700&family=Noto+Kufi+Arabic:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<script>${js}</script>
</body>
</html>`;
fs.mkdirSync("dist", { recursive: true });
fs.writeFileSync("dist/index.html", html);
console.log(`dist/index.html (${Math.round(html.length / 1024)} KB)`);
