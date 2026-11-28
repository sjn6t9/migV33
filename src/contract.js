// Employment contract: the country's contract form (a clean scan of the real form) with the worker's and the
// company's details written in the right places — English/Latin on the left, Arabic on the right —
// new barcodes with their numbers, and (if wanted) the worker's signature from the passport copy and a company signature.
import { arPart } from "./vcardLocale.js";

/* ---------- Arabic for names and jobs ---------- */
const EXTRA = { asif: "آصف", shahidullah: "شهيد الله", abdullah: "عبد الله", ullah: "الله", shahid: "شهيد", rakib: "راكب", sabbir: "صابر", sumon: "سومون",
  razaul: "رضاء الحق", haque: "حق", hoque: "حق", haq: "حق", kader: "قادر", nishan: "نيشان", rifat: "رفعت", malitha: "ماليثا", rayhan: "ريحان", rayhan2: "ريحان",
  prodhan: "برادهان", naeem: "نعيم", munna: "منا", humayun: "همايون", saikot: "سايكوت", das: "داس", sujon: "سوجون", jony: "جوني", babu: "بابو", mia: "ميا", miah: "ميا" };
// letter by letter, for names not in the list (a good start that the office can correct)
const PH = [["sh", "ش"], ["kh", "خ"], ["gh", "غ"], ["th", "ث"], ["ch", "تش"], ["dh", "ذ"], ["ph", "ف"], ["oo", "و"], ["ee", "ي"], ["ai", "اي"], ["ay", "اي"], ["ou", "و"],
  ["a", "ا"], ["b", "ب"], ["c", "ك"], ["d", "د"], ["e", "ي"], ["f", "ف"], ["g", "ج"], ["h", "ه"], ["i", "ي"], ["j", "ج"], ["k", "ك"], ["l", "ل"], ["m", "م"], ["n", "ن"],
  ["o", "و"], ["p", "ب"], ["q", "ق"], ["r", "ر"], ["s", "س"], ["t", "ت"], ["u", "و"], ["v", "ف"], ["w", "و"], ["x", "كس"], ["y", "ي"], ["z", "ز"]];
function phon(w) {
  let s = w.toLowerCase().replace(/[^a-z]/g, ""), out = "";
  for (let i = 0; i < s.length;) { const hit = PH.find(([k]) => s.startsWith(k, i)); if (!hit) { i++; continue; }
    // short vowels inside a word are usually not written in Arabic
    if (out && i + hit[0].length < s.length && ["a", "e", "i", "o", "u"].includes(hit[0]) && !["aa", "ee", "oo"].includes(s.substr(i, 2))) { i++; continue; }
    out += hit[1]; i += hit[0].length; }
  return out;
}
export const nameAr = name => String(name || "").trim().split(/\s+/).filter(Boolean).map(w => arPart(w.replace(/\.$/, "")) || EXTRA[w.toLowerCase().replace(/\.$/, "")] || phon(w)).join(" ");
const JOBS = { driver: "سائق", "light driver": "سائق خفيف", "heavy driver": "سائق ثقيل", "house driver": "سائق خاص", "private driver": "سائق خاص", "bus driver": "سائق حافلة",
  labour: "عامل", labor: "عامل", labourer: "عامل", laborer: "عامل", worker: "عامل", "general labour": "عامل عادي", "general worker": "عامل عادي", helper: "مساعد",
  cleaner: "عامل نظافة", "cleaning worker": "عامل نظافة", electrician: "كهربائي", plumber: "سباك", carpenter: "نجار", mason: "بناء", "steel fixer": "حداد مسلح",
  welder: "لحام", painter: "دهان", cook: "طباخ", waiter: "نادل", "security guard": "حارس أمن", guard: "حارس", salesman: "بائع", "sales man": "بائع", mechanic: "ميكانيكي",
  technician: "فني", "ac technician": "فني تكييف", housemaid: "عاملة منزلية", "house maid": "عاملة منزلية", farmer: "مزارع", "agricultural worker": "عامل زراعي",
  shepherd: "راعي غنم", tailor: "خياط", barber: "حلاق", gardener: "عامل حدائق", storekeeper: "أمين مخزن", "store keeper": "أمين مخزن", accountant: "محاسب",
  engineer: "مهندس", nurse: "ممرض", supervisor: "مشرف", foreman: "رئيس عمال", scaffolder: "عامل سقالات", "pipe fitter": "فني تمديدات", cashier: "أمين صندوق",
  baker: "خباز", butcher: "جزار", "office boy": "مراسل", receptionist: "موظف استقبال", "delivery man": "عامل توصيل", rider: "سائق دراجة", "camel herder": "راعي إبل" };
export const jobAr = j => JOBS[String(j || "").trim().toLowerCase()] || "";

// a company name in Arabic from the English one: common words translated, other words written in Arabic letters
const CO_WORDS = { trading: "للتجارة", trade: "للتجارة", contracting: "والمقاولات", contractors: "للمقاولات", contract: "للمقاولات", company: "شركة", co: "شركة", services: "للخدمات", service: "للخدمات",
  group: "مجموعة", construction: "للإنشاءات", cleaning: "للتنظيف", transport: "للنقل", transportation: "للنقل", engineering: "للهندسة", general: "العامة", maintenance: "للصيانة",
  restaurant: "مطعم", hotel: "فندق", cafe: "مقهى", international: "الدولية", holding: "القابضة", industries: "للصناعات", industrial: "الصناعية", electrical: "الكهربائية",
  security: "للأمن", manpower: "للقوى العاملة", recruitment: "للتوظيف", farm: "مزرعة", real: "", estate: "العقارية", "&": "و", and: "و", llc: "ذ.م.م", wll: "ذ.م.م", "w.l.l": "ذ.م.م", "w.l.l.": "ذ.م.م", qatar: "قطر", doha: "الدوحة" };
export const companyAr = n => String(n || "").trim().split(/\s+/).filter(Boolean).map(w => { const k = w.toLowerCase().replace(/[(),]/g, ""); return k in CO_WORDS ? CO_WORDS[k] : phon(w); }).filter(Boolean).join(" ").replace(/(^| )و (?=و)/g, "$1");
const arSize = (g, alif) => { g.font = `100px ${ARAB}`; const m = g.measureText("ا"); const r = (m.actualBoundingBoxAscent || 70) / 100; return Math.max(24, Math.min(70, Math.round(alif / r))); };

/* ---------- barcode (Code 128) ---------- */
const C128 = "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112".split(" ");
function code128(text) {
  const s = String(text); let codes;
  if (/^\d+$/.test(s) && s.length % 2 === 0) codes = [105, ...s.match(/\d\d/g).map(Number)]; // set C: two digits per symbol
  else codes = [104, ...[...s].map(ch => Math.max(0, Math.min(94, ch.charCodeAt(0) - 32)))]; // set B
  const check = codes.reduce((t, c, i) => t + c * (i || 1), 0) % 103;
  return [...codes, check, 106].map(c => C128[c]).join("");
}
function drawBarcode(g, text, x, y, w, h, numY, font) {
  const pat = code128(text), units = [...pat].reduce((t, d) => t + +d, 0), u = w / units; let cx = x;
  g.fillStyle = "#000"; [...pat].forEach((d, i) => { const bw = +d * u; if (i % 2 === 0) g.fillRect(Math.round(cx), y, Math.max(1, Math.round(bw)), h); cx += bw; });
  g.font = font; g.textAlign = "center"; g.textBaseline = "alphabetic"; g.fillText(text, x + w / 2, numY);
}

/* ---------- forms per country ---------- */
const LATIN = "Arial, Helvetica, sans-serif", SERIF = "'Times New Roman', Times, serif", ARAB = "'Times New Roman', 'Traditional Arabic', 'Geeza Pro', 'Noto Naskh Arabic', serif";
// the company address as Qatar writes it: zone, street, building
const qaAddr = a => { const n = String(a || "").match(/\d+/g) || []; return { zone: n[0] || "", street: n[1] || "", bldg: n[2] || "" }; };
export const CONTRACTS = {
  Qatar: {
    img: "/contracts_qatar.jpg?v=1", w: 2480, h: 3508,
    draw(g, d, fit) {
      g.fillStyle = "#111";
      drawBarcode(g, d.attNo, 81, 208, 300, 99, 341, `32px ${SERIF}`);
      drawBarcode(g, d.contractNo, 2061, 208, 337, 99, 341, `32px ${SERIF}`);
      const A = qaAddr(d.companyAddress);
      // left (Bangla form, Latin values)
      g.textAlign = "left"; fit(A.zone, 330, 611, 46, 36, LATIN); fit(A.street, 491, 611, 80, 36, LATIN); fit(A.bldg, 691, 611, 60, 36, LATIN);
      fit(d.name.toUpperCase(), 340, 720, 870, 39, LATIN); fit(d.visaNo, 526, 882, 680, 38, LATIN);
      g.textAlign = "center"; fit(d.jobTitle.toUpperCase(), 690, 1044, 146, 40, LATIN);
      // right (Arabic)
      // Arabic sized from the height of an alif in the form (about 24 px), whatever Arabic font the browser has
      const az = arSize(g, 24);
      g.direction = "rtl"; g.textAlign = "right";
      fit(`${(d.companyAr || "").trim()} بصفته صاحب العمل .`, 2347, 554, 860, az, ARAB);
      fit(d.nameAr, 2196, 721, 690, az, ARAB); fit(d.jobAr, 1654, 1050, 210, az, ARAB);
      g.direction = "ltr"; g.textAlign = "right"; fit(d.visaNo, 2007, 890, 400, 37, SERIF);
      g.textAlign = "center"; fit(A.zone, 2098, 615, 60, 37, SERIF); fit(A.street, 1930, 615, 110, 37, SERIF); fit(A.bldg, 1774, 615, 60, 37, SERIF);
      g.textAlign = "left";
    },
    sig: { worker: [230, 2830, 520, 190], company: [1700, 2820, 620, 170], companyText: [2010, 3045] }
  }
};
export const contractFor = country => CONTRACTS[country] || null;

const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = rej; i.src = src; });
// a scanned passport PDF is usually one picture inside: take the largest JPEG out of the file, so its signature can be used
export async function pdfPicture(src) {
  const buf = new Uint8Array(await (await fetch(src)).arrayBuffer()); let best = null;
  for (let i = 0; i < buf.length - 3; i++) {
    if (buf[i] !== 0xFF || buf[i + 1] !== 0xD8 || buf[i + 2] !== 0xFF) continue;
    // the picture ends at the last FFD9 before the stream ends
    let end = -1; const lim = Math.min(buf.length - 1, i + 40e6);
    for (let j = i + 4; j < lim; j++) { if (buf[j] === 0x65 && buf[j + 1] === 0x6E && buf[j + 2] === 0x64 && buf[j + 3] === 0x73 && buf[j + 4] === 0x74) break; if (buf[j] === 0xFF && buf[j + 1] === 0xD9) end = j + 2; }
    if (end > 0 && (!best || end - i > best[1] - best[0])) best = [i, end]; if (end > 0) i = end;
  }
  if (!best) return "";
  return URL.createObjectURL(new Blob([buf.slice(best[0], best[1])], { type: "image/jpeg" }));
}
// a signature cut from a photo: the paper and the passport's printed pattern go, the pen ink stays (dark blue)
export async function inkFrom(src, crop) {
  const img = await loadImg(src), [cx, cy, cw, ch] = crop.map((v, i) => Math.round(v * (i % 2 ? img.height : img.width)));
  const c = document.createElement("canvas"); c.width = Math.max(1, cw); c.height = Math.max(1, ch); const g = c.getContext("2d");
  g.drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);
  const px = g.getImageData(0, 0, cw, ch), a = px.data, n = a.length / 4;
  const lum = new Float32Array(n); for (let i = 0; i < n; i++) lum[i] = 0.3 * a[i * 4] + 0.59 * a[i * 4 + 1] + 0.11 * a[i * 4 + 2];
  const sorted = Float32Array.from(lum).sort(), paper = sorted[Math.floor(n * 0.6)], dark = sorted[Math.floor(n * 0.01)];
  // ink: clearly darker than the paper, and in the darker part of what is there (light security print is left out)
  const cut = Math.min(paper - 55, dark + (paper - dark) * 0.45);
  let ink = 0;
  for (let i = 0; i < n; i++) { const k = Math.max(0, Math.min(1, (cut - lum[i]) / 35)); a[i * 4] = 15; a[i * 4 + 1] = 30; a[i * 4 + 2] = 90; a[i * 4 + 3] = Math.round(k * 255); if (k > 0.5) ink++; }
  g.putImageData(px, 0, 0); c.inkShare = ink / n; return c;
}
// a company signature drawn as with a pen when no picture is given: one of several hands (loops and humps, a round
// initial with a zigzag, an oval with a tail, slanted letters, initials and a name), its slant, size and ink drawn from
// the company name and a fresh number each time, so it differs from company to company and from time to time
function penSig(g, text, x, y, w, h, salt = 0) {
  let seed = ([...String(text || "Company")].reduce((t, ch) => (t * 31 + ch.charCodeAt(0)) >>> 0, 7) ^ (salt >>> 0)) >>> 0 || 1;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296), R = (a, b) => a + rnd() * (b - a);
  for (let i = 0; i < 5; i++) rnd();
  const mid = y + h * R(0.45, 0.62), strokes = [];
  const style = Math.floor(rnd() * 5);
  if (style === 0) { // tall first letter, joined humps and loops, a flourish under it
    const P = [], x0 = x + w * R(0.03, 0.1); P.push([x0 - 10, mid + h * 0.1], [x0 + w * 0.05, y + h * R(0.05, 0.25)], [x0 + w * 0.09, mid - h * 0.1], [x0 + w * 0.02, mid + h * 0.15], [x0 + w * 0.08, mid + h * 0.05]);
    let cx = x0 + w * 0.1; const n = 5 + Math.floor(rnd() * 5), step = (w * R(0.5, 0.66)) / n;
    for (let i = 0; i < n; i++) { const up = h * R(0.15, 0.5); if (rnd() < 0.3) P.push([cx + step * 0.3, mid - up], [cx + step * 0.15, mid - up * 0.3], [cx + step * 0.5, mid + h * 0.06]); else P.push([cx + step * 0.35, mid - up], [cx + step * 0.7, mid + h * 0.08]); cx += step; }
    P.push([cx + w * 0.04, mid - h * 0.12], [cx - w * 0.1, mid + h * 0.3], [x + w * R(0.15, 0.3), mid + h * 0.36], [x + w * 0.55, mid + h * R(0.2, 0.32)], [x + w * R(0.85, 0.98), mid - h * R(0, 0.15)]);
    strokes.push(P);
  } else if (style === 1) { // big round initial, a fast zigzag, a line struck through
    const P = [], cx = x + w * R(0.12, 0.2), r = h * R(0.28, 0.4);
    for (let t = 0; t <= 1.15; t += 0.08) { const a = Math.PI * 0.9 - t * Math.PI * 2; P.push([cx + Math.cos(a) * r * 1.2, mid - h * 0.05 + Math.sin(a) * r]); }
    let zx = cx + r; const n = 7 + Math.floor(rnd() * 6), st = (w * R(0.5, 0.62)) / n;
    for (let i = 0; i < n; i++) { P.push([zx + st * 0.5, mid - h * R(0.1, 0.32)], [zx + st, mid + h * R(0.02, 0.12)]); zx += st; }
    strokes.push(P);
    strokes.push([[x + w * R(0.05, 0.15), mid + h * R(-0.05, 0.08)], [x + w * 0.5, mid - h * R(0, 0.1)], [x + w * R(0.85, 0.97), mid - h * R(0.1, 0.25)]]);
  } else if (style === 2) { // a long oval loop with a tail and a dot
    const P = [], cx = x + w * R(0.3, 0.42), rx = w * R(0.18, 0.28), ry = h * R(0.25, 0.38);
    P.push([x + w * 0.04, mid + h * 0.2]);
    for (let t = 0; t <= 1.6; t += 0.07) { const a = Math.PI - t * Math.PI * 2; P.push([cx + Math.cos(a) * rx * (1 - t * 0.15), mid + Math.sin(a) * ry]); }
    P.push([cx + rx * 1.3, mid + h * 0.15], [x + w * R(0.75, 0.85), mid - h * R(0.05, 0.2)], [x + w * R(0.9, 0.97), mid + h * R(0.05, 0.2)]);
    strokes.push(P); const dx = x + w * R(0.85, 0.95), dy = mid - h * R(0.2, 0.35); strokes.push([[dx, dy], [dx + 3, dy + 2], [dx + 5, dy]]);
  } else if (style === 3) { // slanted tall strokes like several letters, two underlines
    const P = [], n = 4 + Math.floor(rnd() * 4), st = (w * R(0.55, 0.7)) / n; let cx = x + w * R(0.06, 0.12);
    P.push([cx, mid + h * 0.12]);
    for (let i = 0; i < n; i++) { const tall = rnd() < 0.5; P.push([cx + st * 0.25, mid - h * (tall ? R(0.35, 0.5) : R(0.1, 0.22))], [cx + st * 0.4, mid + h * 0.1], [cx + st * 0.75, mid - h * R(0.02, 0.12)], [cx + st, mid + h * 0.08]); cx += st; }
    strokes.push(P);
    const u = mid + h * R(0.22, 0.3); strokes.push([[x + w * 0.08, u], [x + w * 0.5, u + R(-4, 4)], [cx + w * 0.05, u - h * 0.04]]); strokes.push([[x + w * 0.2, u + h * 0.1], [cx - w * 0.05, u + h * 0.08]]);
  } else { // two separate words: initials and a short scribbled name
    const P1 = [], i0 = x + w * R(0.04, 0.1); P1.push([i0, mid + h * 0.2], [i0 + w * 0.06, y + h * R(0.08, 0.2)], [i0 + w * 0.1, mid + h * 0.2], [i0 + w * 0.04, mid], [i0 + w * 0.16, mid - h * 0.05]);
    strokes.push(P1);
    const P2 = []; let cx = x + w * R(0.3, 0.38); const n = 4 + Math.floor(rnd() * 4), st = (w * R(0.38, 0.5)) / n;
    P2.push([cx, mid]); for (let i = 0; i < n; i++) { P2.push([cx + st * 0.4, mid - h * R(0.08, 0.38)], [cx + st * 0.8, mid + h * R(0.02, 0.15)]); cx += st; }
    P2.push([cx + w * 0.05, mid + h * 0.25], [x + w * R(0.3, 0.45), mid + h * R(0.3, 0.4)]); strokes.push(P2);
  }
  // a little slant and a size of its own, like a real hand
  const slant = R(-0.25, 0.1), sc = R(0.88, 1);
  const tf = ([px, py]) => [x + (px - x) * sc + (mid - py) * slant, mid + (py - mid) * sc];
  const ink = ["#13247a", "#0d1f6b", "#1b2f8f", "#111a4d", "#1a1a1a"][Math.floor(rnd() * 5)], wid = R(4.5, 7.5);
  g.save(); g.strokeStyle = ink; g.lineCap = "round"; g.lineJoin = "round";
  for (const P0 of strokes) {
    const P = P0.map(tf), S = [];
    for (let i = 0; i < P.length - 1; i++) { const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || p2;
      for (let t = 0; t < 1; t += 0.05) { const t2 = t * t, t3 = t2 * t;
        S.push([0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
                0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)]); } }
    S.push(P[P.length - 1]);
    for (let i = 1; i < S.length; i++) { const [ax, ay] = S[i - 1], [bx, by] = S[i], f = i / S.length;
      // the pen presses harder on down-strokes and lifts at the start and end
      const down = by > ay ? 1.25 : 0.8, taper = Math.min(1, f * 12, (1 - f) * 8);
      g.lineWidth = Math.max(1.2, wid * down * taper); g.globalAlpha = 0.88 + 0.12 * taper; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke(); }
  }
  g.restore();
}
const fitIn = (g, el, x, y, w, h) => { const s = Math.min(w / el.width, h / el.height); g.drawImage(el, x + (w - el.width * s) / 2, y + (h - el.height * s) / 2, el.width * s, el.height * s); };

/* the finished page as a canvas */
export async function drawContract(country, d) {
  const T = contractFor(country); if (!T) throw new Error("No contract form for this country yet.");
  const bg = await loadImg(T.img); const c = document.createElement("canvas"); c.width = T.w; c.height = T.h; const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, T.w, T.h); g.drawImage(bg, 0, 0, T.w, T.h);
  // text fitted into its space: smaller (never below 60%) and then narrower if it is long
  const fit = (text, x, y, maxW, size, family, weight = "") => { const s = String(text || ""); if (!s) return; let z = size; g.font = `${weight} ${z}px ${family}`;
    while (g.measureText(s).width > maxW && z > size * 0.6) { z -= 1; g.font = `${weight} ${z}px ${family}`; }
    const w = g.measureText(s).width; if (w > maxW) { g.save(); g.translate(x, y); g.scale(maxW / w, 1); g.fillText(s, 0, 0); g.restore(); } else g.fillText(s, x, y); };
  T.draw(g, d, fit);
  if (d.signatures) {
    const [wx, wy, ww, wh] = T.sig.worker, [kx, ky, kw, kh] = T.sig.company;
    if (d.workerSig) fitIn(g, d.workerSig, wx, wy, ww, wh);
    if (d.companySig) fitIn(g, d.companySig, kx, ky, kw, kh); else penSig(g, d.company || d.companyAr, kx, ky, kw, kh, d.sigSalt || 0);
    const [tx, ty] = T.sig.companyText; g.fillStyle = "#111"; g.textAlign = "center"; g.direction = "ltr";
    [[d.company, 36, "bold"], [d.companyReg && `Registration No: ${d.companyReg}`, 32, ""], [d.companyMobile && `Mobile: ${d.companyMobile}`, 32, ""]].filter(([t]) => t)
      .forEach(([t, z, wt], i) => fit(t, tx, ty + i * 46, 760, z, LATIN, wt));
  }
  return c;
}

/* ---------- a one-page PDF from the canvas (the page as a JPEG, A4) ---------- */
export async function canvasPdf(c) {
  const jpg = await new Promise(r => c.toBlob(r, "image/jpeg", 0.88)); const img = new Uint8Array(await jpg.arrayBuffer());
  const W = 595.28, H = 841.89, enc = new TextEncoder(), parts = [], offs = []; let len = 0;
  const push = x => { const b = typeof x === "string" ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const obj = (n, body) => { offs[n] = len; push(`${n} 0 obj\n`); body(); push("\nendobj\n"); };
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  obj(1, () => push("<< /Type /Catalog /Pages 2 0 R >>"));
  obj(2, () => push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"));
  obj(3, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`));
  obj(4, () => { push(`<< /Type /XObject /Subtype /Image /Width ${c.width} /Height ${c.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.length} >>\nstream\n`); push(img); push("\nendstream"); });
  const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
  obj(5, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
  const xref = len; push(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map(n => `${String(offs[n]).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts, { type: "application/pdf" });
}
// numbers for the two barcodes when none are given: attestation (10 digits) and contract (12 digits), like the form's own
export const newBarcodes = () => { const y = new Date().getFullYear(), r = n => String(Math.floor(Math.random() * 10 ** n)).padStart(n, "0"); return { attNo: `${y}${r(6)}`, contractNo: `1${y}${r(7)}` }; };

/* English company name from the Arabic one (as on the Qatar visa "Sponsor Name"): known words are translated,
   the proper name is written out in Latin letters */
const CO_EN = { "تجارة": "Trading", "التجارة": "Trading", "خدمات": "Services", "الخدمات": "Services", "مقاولات": "Contracting", "المقاولات": "Contracting", "شركة": "Company", "مجموعة": "Group",
  "انشاءات": "Construction", "الانشاءات": "Construction", "إنشاءات": "Construction", "الإنشاءات": "Construction", "تنظيف": "Cleaning", "التنظيف": "Cleaning", "نقل": "Transport", "النقل": "Transport",
  "هندسة": "Engineering", "الهندسة": "Engineering", "العامة": "General", "عامة": "General", "صيانة": "Maintenance", "الصيانة": "Maintenance", "مطعم": "Restaurant", "فندق": "Hotel", "مقهى": "Cafe",
  "الدولية": "International", "دولية": "International", "القابضة": "Holding", "صناعات": "Industries", "الصناعات": "Industries", "الصناعية": "Industrial", "الكهربائية": "Electrical", "كهرباء": "Electrical",
  "أمن": "Security", "الأمن": "Security", "الامن": "Security", "توظيف": "Recruitment", "التوظيف": "Recruitment", "مزرعة": "Farm", "العقارية": "Real Estate", "عقارات": "Real Estate", "قطر": "Qatar", "الدوحة": "Doha",
  "استيراد": "Import", "الاستيراد": "Import", "تصدير": "Export", "التصدير": "Export", "التسويق": "Marketing", "تسويق": "Marketing", "الاستشارات": "Consulting", "استشارات": "Consulting", "مؤسسة": "Establishment",
  "ذ.م.م": "W.L.L", "ذمم": "W.L.L", "الضيافة": "Hospitality", "ضيافة": "Hospitality", "الأغذية": "Foodstuff", "المواد": "Materials", "مواد": "Materials", "البناء": "Building", "بناء": "Building", "الحديثة": "Modern",
  "التكنولوجيا": "Technology", "تكنولوجيا": "Technology", "الزراعة": "Agriculture", "زراعة": "Agriculture", "السيارات": "Cars", "تأجير": "Rental", "لتأجير": "Rental", "الليموزين": "Limousine", "ليموزين": "Limousine",
  "التوريدات": "Supplies", "توريدات": "Supplies", "الالكترونيات": "Electronics", "المحدودة": "Limited", "الخليج": "Gulf", "العربية": "Arabia", "الشرق": "East", "الأوسط": "Middle", "وشركاه": "& Partners", "وشركاؤه": "& Partners" };
const AR_LAT = { "ا": "a", "أ": "a", "إ": "i", "آ": "a", "ب": "b", "ت": "t", "ث": "th", "ج": "j", "ح": "h", "خ": "kh", "د": "d", "ذ": "dh", "ر": "r", "ز": "z", "س": "s", "ش": "sh", "ص": "s", "ض": "d", "ط": "t", "ظ": "z",
  "ع": "a", "غ": "gh", "ف": "f", "ق": "q", "ك": "k", "ل": "l", "م": "m", "ن": "n", "ه": "h", "ة": "a", "و": "o", "ي": "i", "ى": "a", "ئ": "e", "ؤ": "o", "ء": "" };
function latin(w) {
  let s = ""; const vow = (w.slice(1).match(/[اويى]/g) || []).length, lastW = w.lastIndexOf("و");
  for (let i = 0; i < w.length; i++) { const c = w[i], n = w[i + 1];
    if (c === "ي" && i === 0) { s += "y"; continue; }
    if (c === "و" && i === 0) { s += "w"; continue; }
    if (c === "ي" && i === 1 && n === "و") { s += "e"; continue; } // جيو… is "Geo…"
    if (c === "ي" && n && /[اوي]/.test(n)) { s += "y"; continue; }
    if (c === "ج" && n === "ي" && w[i + 2] === "و") { s += "g"; continue; }
    if (c === "و") { s += vow === 1 ? "oo" : i === lastW && vow > 1 ? "u" : "o"; continue; }
    s += AR_LAT[c] ?? ""; }
  s = s.replace(/aa+/g, "a").replace(/ii+/g, "ee").replace(/([bcdfghjklmnpqrstvwxz])\1+/g, "$1");
  if (/^[^aeiou]{2}/.test(s) && !/^(th|sh|kh|gh|dh)/.test(s)) s = s[0] + "a" + s.slice(1);
  else if (/^[^aeiou]+$/.test(s)) s = s.replace(/^(.)/, "$1a");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
export function companyEn(ar) {
  const words = String(ar || "").replace(/[ً-ٟـ]/g, "").trim().split(/\s+/).filter(Boolean); if (!words.length) return "";
  const out = [];
  for (let w of words) {
    let and = false;
    if (CO_EN[w]) { out.push(CO_EN[w]); continue; }
    if (/^و/.test(w) && w.length > 3 && (CO_EN[w.slice(1)] || CO_EN[w.slice(1).replace(/^ل/, "ال")])) { and = true; w = w.slice(1); }
    let base = CO_EN[w] || CO_EN[w.replace(/^لل/, "ال")] || CO_EN[w.replace(/^ل/, "")] || CO_EN[w.replace(/^ال/, "")];
    if (base) { out.push((and ? "& " : "") + base); continue; }
    out.push(/^ال../.test(w) ? "Al " + latin(w.slice(2)) : latin(w));
  }
  // "شركة النور للمقاولات" reads "Al Noor Contracting Company" in English
  while (out.length > 1 && /^(Company|Group|Establishment)$/.test(out[0])) { const t = out.shift(); out.splice(out[out.length - 1] === "W.L.L" ? out.length - 1 : out.length, 0, t); }
  return out.join(" ").replace(/\s+/g, " ").trim();
}
