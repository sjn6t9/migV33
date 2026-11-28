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
// a signature cut from a photo: light paper becomes transparent, the ink stays dark blue
export async function inkFrom(src, crop) {
  const img = await loadImg(src), [cx, cy, cw, ch] = crop.map((v, i) => Math.round(v * (i % 2 ? img.height : img.width)));
  const c = document.createElement("canvas"); c.width = Math.max(1, cw); c.height = Math.max(1, ch); const g = c.getContext("2d");
  g.drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);
  const px = g.getImageData(0, 0, cw, ch), a = px.data;
  let lum = []; for (let i = 0; i < a.length; i += 4) lum.push(0.3 * a[i] + 0.59 * a[i + 1] + 0.11 * a[i + 2]);
  const sorted = [...lum].sort((p, q) => p - q), paper = sorted[Math.floor(sorted.length * 0.6)], cut = paper - 45;
  for (let i = 0, j = 0; i < a.length; i += 4, j++) { const l = lum[j]; const k = Math.max(0, Math.min(1, (cut - l) / 50)); a[i] = 15; a[i + 1] = 30; a[i + 2] = 90; a[i + 3] = Math.round(k * 255); }
  g.putImageData(px, 0, 0); return c;
}
// a company signature written by hand-style lettering when no picture is given
function scriptSig(g, text, x, y, w, h) {
  const t = String(text || "").trim().split(/\s+/).slice(0, 2).join(" ") || "Authorized";
  g.save(); g.fillStyle = "#132a7a"; g.textAlign = "center"; g.textBaseline = "middle";
  let s = 96; do { g.font = `italic ${s}px 'Brush Script MT','Segoe Script','Lucida Handwriting','Apple Chancery','Snell Roundhand',cursive`; s -= 4; } while (g.measureText(t).width > w && s > 30);
  g.translate(x + w / 2, y + h / 2); g.rotate(-0.06); g.fillText(t, 0, 0);
  g.lineWidth = 3; g.strokeStyle = "#132a7a"; g.beginPath(); const tw = Math.min(w, g.measureText(t).width); g.moveTo(-tw / 2, s * 0.55); g.quadraticCurveTo(0, s * 0.85, tw / 2 + 20, s * 0.35); g.stroke();
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
    if (d.companySig) fitIn(g, d.companySig, kx, ky, kw, kh); else scriptSig(g, d.company || d.companyAr, kx, ky, kw, kh);
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
