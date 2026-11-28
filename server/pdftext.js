// Text lines of a text PDF (such as the Qatar MOI printed visa): fonts with ToUnicode maps, Tj/TJ strings,
// grouped into lines by their place on the page (top to bottom, left to right). No OCR: scanned PDFs give nothing.
import zlib from "node:zlib";

function objects(buf) {
  const s = buf.toString("latin1"), out = new Map(), re = /(\d+)\s+0\s+obj\b/g; let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length, end = s.indexOf("endobj", start); if (end < 0) break;
    const body = s.slice(start, end), si = body.indexOf("stream");
    let dict = si >= 0 ? body.slice(0, si) : body, data = null;
    if (si >= 0) {
      let a = start + si + 6; if (s[a] === "\r") a++; if (s[a] === "\n") a++;
      const e = s.lastIndexOf("endstream", end); let raw = buf.subarray(a, e);
      if (/\/FlateDecode/.test(dict)) { try { raw = zlib.inflateSync(raw); } catch { try { raw = zlib.inflateSync(raw, { finishFlush: zlib.constants.Z_SYNC_FLUSH }); } catch { raw = null; } } }
      else if (/\/Filter/.test(dict)) raw = null; // images and other filters are not text
      data = raw;
    }
    out.set(+m[1], { dict, data });
    re.lastIndex = end;
  }
  return out;
}
const ref = (dict, key) => { const m = new RegExp(`/${key}\\s+(\\d+)\\s+0\\s+R`).exec(dict); return m ? +m[1] : null; };
function cmap(text) { // ToUnicode: bfchar and bfrange
  const map = new Map(), hex = h => parseInt(h, 16), uni = h => { let r = ""; for (let i = 0; i + 4 <= h.length; i += 4) r += String.fromCharCode(hex(h.slice(i, i + 4))); return r; };
  for (const blk of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const [, a, b] of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(hex(a), uni(b));
  for (const blk of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const [, a, b, rest] of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
      const lo = hex(a), hi = hex(b);
      if (rest[0] === "[") { const items = [...rest.matchAll(/<([0-9a-fA-F]*)>/g)].map(x => uni(x[1])); for (let c = lo; c <= hi; c++) map.set(c, items[c - lo] || ""); }
      else { const base = rest.slice(1, -1), b0 = hex(base); for (let c = lo; c <= hi && c - lo < 65536; c++) map.set(c, base.length > 4 ? uni(base.slice(0, -4)) + String.fromCharCode(hex(base.slice(-4)) + c - lo) : String.fromCharCode(b0 + c - lo)); }
    }
  }
  return map;
}
function tokens(s) {
  const out = []; let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "%") { while (i < s.length && s[i] !== "\n") i++; continue; }
    if (c === "(") { let d = 1, j = i + 1, v = ""; while (j < s.length && d) { const ch = s[j]; if (ch === "\\") { const n = s[j + 1]; const esc = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" }; if (/[0-7]/.test(n)) { const o = /^[0-7]{1,3}/.exec(s.slice(j + 1))[0]; v += String.fromCharCode(parseInt(o, 8)); j += 1 + o.length; continue; } v += esc[n] ?? n; j += 2; continue; } if (ch === "(") d++; else if (ch === ")") { d--; if (!d) break; } v += ch; j++; } out.push({ s: v }); i = j + 1; continue; }
    if (c === "<" && s[i + 1] !== "<") { const j = s.indexOf(">", i); const h = s.slice(i + 1, j).replace(/\s+/g, ""); let v = ""; for (let k = 0; k < h.length; k += 2) v += String.fromCharCode(parseInt(h.slice(k, k + 2).padEnd(2, "0"), 16)); out.push({ s: v }); i = j + 1; continue; }
    if (c === "[" || c === "]") { out.push({ op: c }); i++; continue; }
    if (c === "<" || c === ">") { out.push({ op: s.slice(i, i + 2) }); i += 2; continue; }
    if (c === "/") { let j = i + 1; while (j < s.length && !/[\s\/\[\]()<>{}%]/.test(s[j])) j++; out.push({ n: s.slice(i + 1, j) }); i = j; continue; }
    let j = i; while (j < s.length && !/[\s\/\[\]()<>{}%]/.test(s[j])) j++; if (j === i) j++;
    const w = s.slice(i, j); out.push(/^[-+.\d]+$/.test(w) ? { v: +w } : { op: w }); i = j;
  }
  return out;
}
export function pdfLines(buf) {
  const O = objects(buf), runs = [];
  const fontMaps = new Map(); // font object -> { map, two }
  const fontOf = num => { if (fontMaps.has(num)) return fontMaps.get(num); const f = O.get(num); let r = { map: null, two: false };
    if (f) { const tu = ref(f.dict, "ToUnicode"); r = { map: tu && O.get(tu)?.data ? cmap(O.get(tu).data.toString("latin1")) : null, two: /Identity-H|Identity-V|Type0/.test(f.dict) }; }
    fontMaps.set(num, r); return r; };
  const resFonts = dict => { const m = /\/Font\s*<<([\s\S]*?)>>/.exec(dict) || (ref(dict, "Font") && /<<([\s\S]*)>>/.exec(O.get(ref(dict, "Font"))?.dict || "")); const out = {}; if (m) for (const [, n, o] of m[1].matchAll(/\/([^\s\/]+)\s+(\d+)\s+0\s+R/g)) out[n] = +o; return out; };
  function run(content, fonts, ctm0) {
    const T = tokens(content), st = []; let ctm = ctm0.slice(), tm = [1, 0, 0, 1, 0, 0], tlm = tm.slice(), font = null, size = 10, lead = 0, args = [];
    const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
    const show = strs => { if (!font) return; let t = "";
      for (const x of strs) { if (typeof x === "number") { if (x < -200) t += " "; continue; }
        if (font.two) for (let i = 0; i + 1 < x.length; i += 2) { const c = (x.charCodeAt(i) << 8) | x.charCodeAt(i + 1); t += font.map?.get(c) ?? ""; }
        else for (const ch of x) t += font.map?.get(ch.charCodeAt(0)) ?? ch; }
      const m = mul(tm, ctm); if (t.trim()) runs.push({ x: m[4], y: m[5], t, h: size * Math.abs(m[3] || m[0] || 1) }); };
    for (const k of T) {
      if (k.op === undefined || k.op === "[" || k.op === "]") { if (k.op === "[") args.push("["); else if (k.op === "]") { const a = []; while (args.length && args[args.length - 1] !== "[") a.unshift(args.pop()); args.pop(); args.push(a); } else args.push(k.v ?? k.s ?? k.n); continue; }
      const op = k.op, A = args; args = [];
      if (op === "q") st.push(ctm.slice()); else if (op === "Q") ctm = st.pop() || ctm;
      else if (op === "cm" && A.length >= 6) ctm = mul(A.slice(-6), ctm);
      else if (op === "BT") { tm = [1, 0, 0, 1, 0, 0]; tlm = tm.slice(); }
      else if (op === "Tf") { font = fonts[A[0]] != null ? fontOf(fonts[A[0]]) : null; size = +A[1] || size; }
      else if (op === "TL") lead = +A[0];
      else if (op === "Tm" && A.length >= 6) { tm = A.slice(-6).map(Number); tlm = tm.slice(); }
      else if (op === "Td" || op === "TD") { if (op === "TD") lead = -A[1]; tlm = mul([1, 0, 0, 1, +A[0], +A[1]], tlm); tm = tlm.slice(); }
      else if (op === "T*") { tlm = mul([1, 0, 0, 1, 0, -lead], tlm); tm = tlm.slice(); }
      else if (op === "Tj" || op === "'" || op === "\"") { if (op !== "Tj") { tlm = mul([1, 0, 0, 1, 0, -lead], tlm); tm = tlm.slice(); } show([A[A.length - 1]]); }
      else if (op === "TJ") show(A[0] || []);
      else if (op === "Do") { const xo = O.get(fonts.__xo?.[A[0]]); if (xo?.data && /\/Form/.test(xo.dict)) run(xo.data.toString("latin1"), { ...fonts, ...resFonts(xo.dict) }, ctm); }
    }
  }
  for (const [, o] of O) {
    if (!/\/Type\s*\/Page\b/.test(o.dict)) continue;
    let resDict = o.dict; const rr = ref(o.dict, "Resources"); if (rr) resDict = O.get(rr)?.dict || "";
    const fonts = resFonts(resDict), xo = /\/XObject\s*<<([\s\S]*?)>>/.exec(resDict); fonts.__xo = {}; if (xo) for (const [, n, r] of xo[1].matchAll(/\/([^\s\/]+)\s+(\d+)\s+0\s+R/g)) fonts.__xo[n] = +r;
    const cs = /\/Contents\s*(\[[^\]]*\]|\d+\s+0\s+R)/.exec(o.dict); if (!cs) continue;
    const ids = [...cs[1].matchAll(/(\d+)\s+0\s+R/g)].map(m => +m[1]);
    run(ids.map(i => O.get(i)?.data?.toString("latin1") || "").join("\n"), fonts, [1, 0, 0, 1, 0, 0]);
  }
  // lines: runs at about the same height, left to right
  runs.sort((a, b) => b.y - a.y || a.x - b.x); const lines = [];
  for (const r of runs) { const l = lines.find(l => Math.abs(l.y - r.y) < Math.max(2.5, r.h * 0.35)); if (l) l.r.push(r); else lines.push({ y: r.y, r: [r] }); }
  // Arabic is drawn in visual order (glyphs right to left): put it back in reading order, then plain letters (NFKC)
  const fix = t => (AR.test(t) ? [...t].reverse().join("").replace(/[()[\]]/g, c => ({ "(": ")", ")": "(", "[": "]", "]": "[" })[c]) : t).normalize("NFKC").replace(/\s+/g, " ").trim();
  return lines.sort((a, b) => b.y - a.y).map(l => l.r.sort((a, b) => a.x - b.x).map(r => fix(r.t)).filter(Boolean));
}
const AR = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const isAr = t => AR.test(t) && !/[A-Za-z]/.test(t);
/* the Qatar MOI printed visa: each row is "English label · value(s) · Arabic value · Arabic label" */
export function qatarVisa(lines) {
  const out = {}, row = re => lines.find(l => re.test(l[0] || ""));
  const arVals = l => { const a = l.filter(isAr); a.pop(); return a.reverse().join(" ").trim(); }; // rightmost is the Arabic label; the rest read right to left
  const enVals = l => l.slice(1).filter(t => !isAr(t) && t !== "-").join(" ").replace(/\s*-\s*$/, "").trim();
  let r;
  if ((r = row(/^Visa\s*No/i))) out.visaNo = (/\d{8,15}/.exec(r.join(" ")) || [])[0];
  if ((r = row(/^Job\s*Title/i))) { out.jobTitle = enVals(r); out.jobAr = arVals(r); }
  if ((r = row(/^Sponsor/i))) { out.companyAr = arVals(r); const en = enVals(r); if (en) out.company = en; }
  if ((r = row(/^Passport\s*No/i))) out.passport = (/\b[A-Z]{1,2}\d{6,9}\b/.exec(r.join(" ")) || [])[0];
  const ni = lines.findIndex(l => /^Name$/i.test(l[0] || ""));
  if (ni >= 0) { out.name = lines[ni].slice(1).join(" "); const above = lines[ni - 1]; if (above && above.every(isAr)) out.nameAr = arVals(above); }
  if ((r = row(/^Valid\s*Until/i))) out.validUntil = (/\d{2}\/\d{2}\/\d{4}/.exec(r.join(" ")) || [])[0];
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v));
}
