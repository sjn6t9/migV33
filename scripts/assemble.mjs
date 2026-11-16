// Inlines the esbuild output (build/main.js + build/main.css) into one dist/index.html.
import fs from "node:fs";
const css = fs.readFileSync("build/main.css", "utf8");
const js = fs.readFileSync("build/main.js", "utf8").replace(/<\/script/g, "<\\/script");
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MAM &amp; MAM Overseas Ltd.</title>
<meta name="description" content="MAM & MAM Overseas Ltd. — licensed recruiting agency (RL 1217). Overseas jobs in Saudi Arabia, Malaysia and Fiji.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800&family=Hind+Siliguri:wght@400;500;600;700&display=swap" rel="stylesheet">
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
