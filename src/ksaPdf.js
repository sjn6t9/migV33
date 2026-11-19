// KSA visa › HR files: the 4-page Saudi Embassy application file (visa form, forwarding letter, employment agreement, step table).
// Drawn on canvases (A4) and packed into a PDF like the receipts. Visa number and passport number get Code 128 barcodes.
import { pdfFromCanvases, saveBlob, fontsReady, OFFICE } from "./receipt.js";

const PW = 595.28, PH = 841.89, K = 2.4; // points → canvas pixels
const EN = "Inter, Roboto, Arial, sans-serif", AR = "'Noto Naskh Arabic', 'Noto Kufi Arabic', 'Segoe UI', Tahoma, Arial, sans-serif";
const INK = "#111", MUTED = "#444";

/* ---------- Code 128 (set B) ---------- */
const C128 = "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112".split(" ");
/** bar/space module widths for text, Code 128 B with checksum */
export function code128(text) {
  const vals = [104, ...[...String(text)].map(ch => Math.max(0, Math.min(94, ch.charCodeAt(0) - 32)))];
  const sum = vals.reduce((t, v, i) => t + v * (i || 1), 0) % 103;
  return [...vals, sum, 106].map(v => C128[v]).join("").split("").map(Number);
}
function barcode(g, text, cx, y, w, h, label = true) {
  const mods = code128(text), total = mods.reduce((a, b) => a + b, 0), m = w / total; let x = cx - w / 2;
  g.fillStyle = "#000"; mods.forEach((n, i) => { if (i % 2 === 0) g.fillRect(x, y, n * m, h); x += n * m; });
  if (label) { g.font = `700 ${8.5}px ${EN}`; g.textAlign = "center"; g.direction = "ltr"; g.fillText(text, cx, y + h + 9); }
}

/* ---------- drawing helpers (all in points) ---------- */
function page() {
  const c = document.createElement("canvas"); c.width = Math.round(PW * K); c.height = Math.round(PH * K);
  const g = c.getContext("2d"); g.scale(K, K); g.fillStyle = "#fff"; g.fillRect(0, 0, PW, PH); g.textBaseline = "middle"; g.lineWidth = .6; g.strokeStyle = "#222";
  return { c, g };
}
const isAr = s => /[؀-ۿ]/.test(s);
function t(g, s, x, y, { size = 8, bold = false, align = "left", max = 0, color = INK, ar = isAr(String(s ?? "")) } = {}) {
  s = String(s ?? ""); if (!s) return;
  let sz = size; g.font = `${bold ? 700 : 400} ${sz}px ${ar ? AR : EN}`;
  if (max) while (sz > 5 && g.measureText(s).width > max) { sz -= .25; g.font = `${bold ? 700 : 400} ${sz}px ${ar ? AR : EN}`; }
  g.direction = ar ? "rtl" : "ltr"; g.textAlign = align; g.fillStyle = color; g.fillText(s, x, y); g.direction = "ltr";
}
const box = (g, x, y, w, h) => g.strokeRect(x, y, w, h);
const hl = (g, x1, x2, y) => { g.beginPath(); g.moveTo(x1, y); g.lineTo(x2, y); g.stroke(); };
const vl = (g, x, y1, y2) => { g.beginPath(); g.moveTo(x, y1); g.lineTo(x, y2); g.stroke(); };
const dmy = d => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ""); return m ? `${m[3]}-${m[2]}-${m[1]}` : d || ""; };
const dMonY = d => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ""); return m ? `${m[3]}-${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+m[2] - 1]}-${m[1]}` : d || ""; };
export function ageText(dob, on = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob || ""); if (!m) return "";
  let y = on.getFullYear() - +m[1], mo = on.getMonth() + 1 - +m[2], d = on.getDate() - +m[3];
  if (d < 0) { mo--; d += new Date(on.getFullYear(), on.getMonth(), 0).getDate(); } if (mo < 0) { y--; mo += 12; }
  return `${y} years ${mo} months ${d} days`;
}
const up = s => String(s || "").toUpperCase();
const PURPOSES = [["Work", "الشغل"], ["Transit", "عبور"], ["Visit", "يزور"], ["Umrah", "العمرة"], ["Residence", "إقامة"], ["Hajj", "الحج"], ["Diplomacy", "الدبلوماسية"]];

/* ---------- page 1: visa application form ---------- */
function page1(f, s) {
  const { c, g } = page(), L = 29, R = 566, W = R - L;
  box(g, 36, 36, 98, 114); t(g, "Photo", 85, 93, { size: 8.5, align: "center", color: MUTED });
  if (f.visaNo) barcode(g, f.visaNo, 297, 42, 120, 28);
  t(g, up(f.mofaId), R - 6, 48, { size: 18, bold: true, align: "right" });
  t(g, "EMBASSY OF SAUDI ARABIA", R - 6, 86, { size: 10.5, bold: true, align: "right" });
  t(g, "CONSULAR SECTION", R - 6, 103, { size: 10.5, bold: true, align: "right" });
  t(g, "New Application", 297, 118, { size: 9, bold: true, align: "center" });
  const name = up(f.name) + (f.fatherName ? ` ${f.sex === "Female" ? "D/O" : "S/O"}. ${up(f.fatherName)}` : "");
  const C = [L, 118, 208, 298, 388, 477, R]; // label | value | ar | label | value | ar
  let y = 158; const RH = 15;
  const wide = (en, val, ar) => { box(g, L, y, W, RH); vl(g, 118, y, y + RH); vl(g, 477, y, y + RH); t(g, en, L + 6, y + RH / 2, { size: 7.5 }); t(g, val, 297, y + RH / 2, { size: 8.5, bold: true, align: "center", max: 350 }); t(g, ar, R - 6, y + RH / 2, { size: 7.5, align: "right" }); y += RH; };
  const pair = (en1, v1, ar1, en2, v2, ar2) => { box(g, L, y, W, RH); C.slice(1, -1).forEach(x => vl(g, x, y, y + RH)); t(g, en1, L + 6, y + RH / 2, { size: 7.5, max: 85 }); t(g, v1, 163, y + RH / 2, { size: 8.5, bold: true, align: "center", max: 86 }); t(g, ar1, 292, y + RH / 2, { size: 7.5, align: "right" }); t(g, en2, 304, y + RH / 2, { size: 7.5, max: 82 }); t(g, v2, 432, y + RH / 2, { size: 8.5, bold: true, align: "center", max: 86 }); t(g, ar2, R - 6, y + RH / 2, { size: 7.5, align: "right" }); y += RH; };
  wide("Full Name:", name, ": اسم الكامل");
  wide("Mother's Name:", up(f.motherName), ": اسم الام");
  pair("Date of Birth:", dmy(f.dob), ": تاريخ الولادة", "Place of Birth:", up(f.birthPlace), ": محل الولادة");
  pair("Previous Nationality:", up(f.prevNationality), ": الجنسية السابقة", "Present Nationality:", up(f.nationality), ": الجنسية الحالية");
  pair("Sex:", f.sex, ": الجنس", "Marital Status:", f.marital, ": الحالة الاجتماعية");
  pair("Sect:", f.sect, ": المذهب", "Religion:", f.religion, ": الديانة");
  // place of issue / qualification / profession, Arabic row then English row
  box(g, L, y, W, RH * 2);
  t(g, ": مصدره", 150, y + RH / 2, { size: 7.5, align: "right" }); t(g, f.issuePlaceAr, 70, y + RH / 2, { size: 8.5, bold: true, align: "center", max: 70 });
  t(g, ": المؤهل العلمي", 307, y + RH / 2, { size: 7.5, align: "right" }); t(g, f.qualificationAr, 252, y + RH / 2, { size: 8.5, bold: true, align: "center", max: 80 });
  t(g, f.professionAr, 451, y + RH / 2, { size: 9.5, bold: true, align: "center", max: 150 }); t(g, ": المهنة", R - 6, y + RH / 2, { size: 7.5, align: "right" });
  t(g, "Place of Issue:", L + 6, y + RH * 1.5, { size: 7.5 }); t(g, up(f.issuePlaceEn), 125, y + RH * 1.5, { size: 8.5, bold: true, max: 45 });
  t(g, "Qualification:", 174, y + RH * 1.5, { size: 7.5 }); t(g, f.qualificationEn, 230, y + RH * 1.5, { size: 8.5, bold: true, max: 55 });
  t(g, "Profession:", 290, y + RH * 1.5, { size: 7.5 }); t(g, f.professionEn, 451, y + RH * 1.5, { size: 9, bold: true, align: "center", max: 160 });
  y += RH * 2; g.lineWidth = 1.2; hl(g, L, R, y); g.lineWidth = .6;
  const addr = (en, val, ar, line2) => { box(g, L, y, W, RH); vl(g, 162, y, y + RH); t(g, en, L + 6, y + RH / 2, { size: 7.5 }); t(g, val, 340, y + RH / 2, { size: 8.5, bold: true, align: "center", max: 230 }); t(g, ar, R - 6, y + RH / 2, { size: 7.5, align: "right" }); y += RH; if (line2 !== undefined) { box(g, L, y, W, RH); t(g, line2, 297, y + RH / 2, { size: 8.5, bold: true, align: "center", max: 520 }); y += RH; } };
  addr("Home address & phone No.:", up(f.address), ": عنوان المنزل ورقم التلفون");
  addr("Business address & phone No.:", `${OFFICE.name}   RL: ${(OFFICE.licence || "").replace(/\D/g, "")}`, ": عنوان الشركة (المؤسسة) رقم التلفون", up([s.address, s.phone].filter(Boolean).join(", ")));
  // purpose of travel
  box(g, L, y, W, 26); t(g, "Purpose of Travel:", L + 6, y + 8, { size: 7.5 }); t(g, ": الغاية من السفر", R - 6, y + 8, { size: 7.5, align: "right" });
  PURPOSES.forEach(([en, ar], i) => { const x = 167 + i * 37.5, on = f.travelPurpose === en || (en === "Visit" && f.travelPurpose === "Family visit"); g.fillStyle = on ? "#333" : "#fff"; g.fillRect(x, y + 2, 35, 22); g.strokeRect(x, y + 2, 35, 22);
    t(g, ar, x + 17.5, y + 8, { size: 5.5, align: "center", color: on ? "#fff" : INK }); t(g, en, x + 17.5, y + 18, { size: 6, align: "center", color: on ? "#fff" : INK }); });
  y += 26;
  // passport
  const q = W / 4; box(g, L, y, W, RH * 2); [1, 2, 3].forEach(i => vl(g, L + q * i, y, y + RH * 2)); hl(g, L, R, y + RH);
  [["Place of issue:", "محل الاصدار", up(f.issuePlace)], ["Date of issue:", "تاريخ الاصدار", dmy(f.issueDate)], ["Date of expiry:", "تاريخ انتهاء الصلاحية", dmy(f.expiryDate)], ["Passport No.:", "رقم الجواز", f.passport]].forEach(([en, ar, v], i) => {
    const x = L + q * i; t(g, en, x + 6, y + RH / 2, { size: 7.5 }); t(g, ar, x + q - 5, y + RH / 2, { size: 6.5, align: "right" }); t(g, v, x + q / 2, y + RH * 1.5, { size: 9, bold: true, align: "center" }); });
  y += RH * 2;
  // stay / arrival / departure
  box(g, L, y, W, 26);
  t(g, ": مدة الاقامة بالمملكة", 185, y + 7, { size: 7, align: "right" }); t(g, ": تاريخ الوصول", 372, y + 7, { size: 7, align: "right" }); t(g, ": تاريخ المغادرة", R - 6, y + 7, { size: 7, align: "right" });
  t(g, "Duration of stay in the kingdom:", L + 6, y + 19, { size: 7.5 }); t(g, f.stayEn || f.stayAr, 250, y + 19, { size: 8.5, bold: true, align: "center", max: 70 });
  t(g, "Date of arrival:", 304, y + 19, { size: 7.5 }); t(g, f.arrivalEn || f.arrivalAr, 400, y + 19, { size: 8, bold: true, max: 50 });
  t(g, "Date fo departure:", 440, y + 19, { size: 7.5 }); t(g, f.departureEn || f.departureAr, R - 6, y + 19, { size: 8, bold: true, align: "right", max: 30 });
  y += 26;
  // payment
  box(g, L, y, W, 26);
  t(g, ": طريقة الدفع : ( ) مجانا ( ) نقدا ( ) بشيك رقم", R - 6, y + 7, { size: 7, align: "right" }); t(g, ": تاريخ", 240, y + 7, { size: 7, align: "right" }); t(g, ": ايصال رقم ( )", 160, y + 7, { size: 7, align: "right" }); t(g, ": تاريخ", 60, y + 7, { size: 7, align: "right" });
  t(g, "Mode of payment:", L + 6, y + 19, { size: 7.5 }); t(g, "Free", 122, y + 19, { size: 7.5 }); t(g, "Cash", 152, y + 19, { size: 7.5 }); t(g, "Cheque No.", 187, y + 19, { size: 7.5 }); t(g, "Date", 305, y + 19, { size: 7.5 }); t(g, "No.", 395, y + 19, { size: 7.5 }); t(g, "Date", 490, y + 19, { size: 7.5 });
  y += 26;
  box(g, L, y, W, 26); t(g, ": صلته", 175, y + 7, { size: 7, align: "right" }); t(g, ": اسم المحرم", R - 6, y + 7, { size: 7, align: "right" });
  t(g, "Relationship:", L + 6, y + 19, { size: 7.5 }); t(g, "EMPLOYER AND EMPLOYEE", 170, y + 19, { size: 8.5, bold: true });
  y += 26;
  box(g, L, y, W, RH); vl(g, 298, y, y + RH); t(g, "Destination:", L + 6, y + RH / 2, { size: 7.5 }); t(g, ": جهة الوصول", 292, y + RH / 2, { size: 7, align: "right" }); t(g, "Carrier's:", 304, y + RH / 2, { size: 7.5 }); t(g, ": اسم الشركة الناقلة", R - 6, y + RH / 2, { size: 7, align: "right" });
  y += RH;
  box(g, L, y, W, RH); t(g, "Dependents traveling in the same passport", 292, y + RH / 2, { size: 7.5, align: "right" }); t(g, ": ايضاحات تخص افراد العائلة (المضافين) علي نفس جواز السفر", 304 + 250, y + RH / 2, { size: 7, align: "right" });
  y += RH;
  // dependents table: header + 4 rows; the sponsor's city and phone go in the middle column
  box(g, L, y, W, 28 + RH * 4); [1, 2, 3].forEach(i => vl(g, L + q * i, y, y + 28 + RH * 4)); hl(g, L, R, y + 28); [1, 2, 3].forEach(i => hl(g, L, R, y + 28 + RH * i));
  [["Relatonship", "نوع الصلة"], ["Date of Birth", "تاريخ الميلاد"], ["Sex", "الجنس"], ["Full Name", "الاسم بالكامل"]].forEach(([en, ar], i) => { const x = L + q * i + q / 2; t(g, ar, x, y + 8, { size: 7, align: "center" }); t(g, en, x, y + 20, { size: 7.5, bold: true, align: "center" }); });
  t(g, `CITY: ${up(f.issuePlaceEn) || "………"}, K.S.A`, L + q * 1.5, y + 28 + RH / 2, { size: 8, bold: true, align: "center", max: q - 8 });
  t(g, "TEL:", L + q * 1.5, y + 28 + RH * 1.5, { size: 8, bold: true, align: "center" });
  y += 28 + RH * 4;
  box(g, L, y, W, RH); t(g, "Name and address of company or individual in the kingdom", 300, y + RH / 2, { size: 7.5, align: "right", max: 255 }); t(g, ": اسم و عنوان الشركة أو اسم الشخص و عنوانه بالمملكة", R - 6, y + RH / 2, { size: 7, align: "right", max: 250 });
  y += RH; box(g, L, y, W, RH); t(g, f.sponsorName, 297, y + RH / 2, { size: 8.5, bold: true, align: "center", max: 520 }); y += RH;
  box(g, L, y, W, 28);
  t(g, "I the undersigned hereby that all the information I have provided are correct. I will", 380, y + 8, { size: 7.5, align: "right" }); t(g, "abide by laws of the kingdom during the period of my residence in it.", 380, y + 20, { size: 7.5, align: "right" });
  t(g, "أنا الموقع أدناه أقر بأن كل المعلومات التي دونتها صحيحة و", R - 6, y + 8, { size: 7, align: "right" }); t(g, "سأكون ملتزما بقوانين المملكة اثناء فترة وجودي بها", R - 6, y + 20, { size: 7, align: "right" });
  y += 28;
  t(g, "Date:", L + 6, y + 9, { size: 7.5 }); t(g, ": التاريخ", 140, y + 9, { size: 7, align: "right" }); t(g, "Signature:", 150, y + 9, { size: 7.5 }); t(g, ": التوقيع", 290, y + 9, { size: 7, align: "right" });
  t(g, "Name:", 300, y + 9, { size: 7.5 }); t(g, up(f.name), 420, y + 9, { size: 8.5, bold: true, align: "center", max: 120 }); t(g, ": الاسم", R - 6, y + 9, { size: 7, align: "right" });
  y += 20; g.setLineDash([3, 2]); hl(g, L, R, y); g.setLineDash([]); y += 8;
  t(g, "For official use only", L + 6, y + 5, { size: 7.5 }); hl(g, L + 6, L + 82, y + 10); t(g, "للاستعمال الرسمي فقط", R - 6, y + 5, { size: 7, align: "right" }); hl(g, R - 90, R - 6, y + 10); y += 13;
  const off = cells => { hl(g, L, R, y + RH); cells.forEach(([s0, x, o]) => t(g, s0, x, y + RH / 2, o)); y += RH; };
  off([["Date:", L + 6, { size: 7.5 }], [f.visaDate, 115, { size: 8.5, bold: true, align: "center" }], [": التاريخ", 205, { size: 7, align: "right" }], ["Visa No:", 214, { size: 7.5 }], [f.visaNo, 330, { size: 9, bold: true, align: "center" }], [": رقم الامر المعتمد عليه في أعطاء التاشيرة", R - 6, { size: 7, align: "right" }]]);
  off([["Visit/Work for:", L + 6, { size: 7.5 }], [f.sponsorName, 300, { size: 8.5, bold: true, align: "center", max: 250 }], [": لزيارة", R - 6, { size: 7, align: "right" }]]);
  off([["Date:", L + 6, { size: 7.5 }], [": التاريخ", 292, { size: 7, align: "right" }], ["Authorization:", 304, { size: 7.5 }], [f.sponsorId, 435, { size: 9, bold: true, align: "center" }], [": أشر برقم", R - 6, { size: 7, align: "right" }]]);
  off([["Fee Collected:", L + 6, { size: 7.5 }], [": المبلغ المحصل", 245, { size: 7, align: "right" }], ["Type:", 255, { size: 7.5 }], [": نوعها", 385, { size: 7, align: "right" }], ["Duration:", 395, { size: 7.5 }], [": مدتها", R - 6, { size: 7, align: "right" }]]);
  y += 12;
  hl(g, L + 6, L + 70, y); t(g, "رئيس القسم القنصلي", L + 6, y - 6, { size: 7, align: "left" }); t(g, "Head of consular section", L + 6, y + 10, { size: 7.5 });
  hl(g, R - 90, R - 6, y); t(g, "مدقق البيانات رقم صاحب العمل", R - 6, y - 6, { size: 7, align: "right" }); t(g, "Checked by", R - 6, y + 10, { size: 7.5, align: "right" });
  if (f.passport) barcode(g, f.passport, 297, y - 6, 120, 26);
  return c;
}

/* ---------- page 2: forwarding letter ---------- */
const kv = (g, rows, x1, x2, y, R, rh = 23) => { rows.forEach(([k, v]) => { t(g, k, x1 + 4, y + rh / 2, { size: 8 }); if (Array.isArray(v)) { t(g, v[0], x2, y + rh / 2, { size: 8.5, bold: true }); g.font = `700 8.5px ${EN}`; t(g, v[1], x2 + g.measureText(v[0]).width + 14, y + rh / 2, { size: 8.5, bold: true }); } else t(g, v, isAr(String(v || "")) ? x2 + 160 : x2, y + rh / 2, { size: 8.5, bold: true, align: isAr(String(v || "")) ? "right" : "left", max: R - x2 - 4 }); g.strokeStyle = "#ddd"; hl(g, x1, R, y + rh); g.strokeStyle = "#222"; y += rh; }); return y; };
function page2(f) {
  const { c, g } = page(), L = 69, R = 559;
  let y = 213; ["To,", "The Chief Of Consular Section,", "The Royal Embassy Kingdom Of Saudi Arabia,", "Gulshan, Dhaka, Bangladesh."].forEach(s => { t(g, s, L, y, { size: 10.5 }); y += 17; });
  y += 22; t(g, "Excellency,", L, y, { size: 10.5 }); y += 17;
  ["With Due Respect we are Submitting One Passport for work Visa with all Necessary Documents", "and Particulars mentioned as below, knowing all instruction and regulation of the consulate", "section."].forEach(s => { t(g, s, L, y, { size: 10.5 }); y += 17; });
  y += 20;
  y = kv(g, [["NAME OF COMPANY:", f.sponsorName], ["VISA NUMBER & DATE:", [f.visaNo, f.visaDate ? `Date: ${f.visaDate}` : ""]], ["FULL NAME OF THE EMPLOYEE:", up(f.name)], ["PASSPORT NO. WITH ISSUE DATE:", [f.passport, f.issueDate ? `Date: ${dmy(f.issueDate)}` : ""]], ["PROFESSION:", f.professionEn], ["RELIGION:", f.religion]], L, 312, y, R);
  y += 28;
  ["I do hereby confirm and declare that the region stated in the Visa form and forwarding letter is", "fully correct. I also undertake with my own responsibility to cancel the Visa and to stop", "functioning with my office, If the statement is found incorrect."].forEach(s => { t(g, s, L, y, { size: 10.5 }); y += 17; });
  y += 16; ["We therefore, Request your Excellency to kindly issue work Visa out of - 01 - Visas and oblige", "thereby."].forEach(s => { t(g, s, L, y, { size: 10.5 }); y += 17; });
  y += 75; hl(g, L, L + 111, y); t(g, "Your Faithfully", L + 55, y + 9, { size: 8, align: "center" });
  return c;
}

/* ---------- page 3: employment agreement ---------- */
function page3(f) {
  const { c, g } = page(), L = 35, R = 559;
  t(g, "EMPLOYMENT AGREEMENT", 297, 107, { size: 14.5, bold: true, align: "center" }); g.font = `700 14.5px ${EN}`; const w = g.measureText("EMPLOYMENT AGREEMENT").width; hl(g, 297 - w / 2, 297 + w / 2, 116);
  let y = kv(g, [["NAME OF COMPANY:", f.sponsorName], ["HEREBY APPOINTED:", up(f.name)], ["PASSPORT NO WITH ISSUE DATE:", [f.passport, f.issueDate ? `Date: ${dmy(f.issueDate)}` : ""]], ["PASSPORT HOLDER:", f.nationality ? f.nationality[0] + f.nationality.slice(1).toLowerCase() : "Bangladesh"], ["PROFESSION:", f.professionEn]], L, 292, 143, R);
  y += 40; t(g, "UNDER THE FOLLOWING TERMS AND CONDITIONS:", 297, y, { size: 13, bold: true, align: "center" }); g.font = `700 13px ${EN}`; const w2 = g.measureText("UNDER THE FOLLOWING TERMS AND CONDITIONS:").width; hl(g, 297 - w2 / 2, 297 + w2 / 2, y + 8);
  y += 14; const sr = v => (v ? `${String(v).replace(/[^\d.]/g, "") || v}/= SR` : "");
  [["MONTHLY SALARY:", sr(f.salary)], ["FOOD AND ACCOMMODATION:", sr(f.food)], ["AIR PASSAGE:", "BORNE BY THE EMPLOYER"], ["DUTY HOUR:", "8 HOURS DAILY"], ["HOLIDAY:", "AS PER SAUDI LABOUR LAWS"], ["LEAVE:", "AS PER SAUDI LABOUR LAWS"], ["OVERTIME & OTHER BENEFIT:", "AS PER SAUDI LABOUR LAWS"], ["MEDICAL FACILITIES:", "FREE"], ["PERIOD OF CONTRACT:", "TWO/ONE YEARS"],
   ["REPATRIATION ARRANGEMENT INCLUDING RETURN OF DEAD BODY &|SERVICE BENEFIT TO THE LEGAL HEIR OF THE EMPLOYEE:", "AS PER SAUDI LABOUR LAWS"]].forEach(([k, v], i) => {
    const two = k.includes("|"), rh = two ? 34 : 23; t(g, String(i + 1), L + 4, y + (two ? 9 : rh / 2), { size: 8 });
    k.split("|").forEach((p, j) => t(g, p, L + 31, y + (two ? 9 + j * 12 : rh / 2), { size: 8 })); t(g, v, 381, y + (two ? 9 : rh / 2), { size: 8 });
    g.strokeStyle = "#ddd"; hl(g, L, R, y + rh); g.strokeStyle = "#222"; y += rh; });
  hl(g, L, L + 117, 757); t(g, "SIGNATURE OF FIRST PARTY", L, 765, { size: 8 });
  hl(g, R - 128, R, 757); t(g, "SIGNATURE OF SECOND PARTY", R, 765, { size: 8, align: "right" });
  return c;
}

/* ---------- page 4: step table attached to every file ---------- */
function page4(f) {
  const { c, g } = page(), L = 35, R = 559, X = [L, 123, 218, 374, R];
  t(g, "إرفاق الجدول التالي في كل معاملة", 297, 107, { size: 13, bold: true, align: "center", ar: true }); g.font = `700 13px ${AR}`; const w = g.measureText("إرفاق الجدول التالي في كل معاملة").width; hl(g, 297 - w / 2, 297 + w / 2, 116);
  let y = 144; const head = 38; box(g, L, y, R - L, head); X.slice(1, -1).forEach(x => vl(g, x, y, y + head));
  [["Notes", "الملاحظات"], ["Port", "المنفذ"], ["Agency", "المكتب"], ["Step", "الاجراء"]].forEach(([en, ar], i) => { const cx = (X[i] + X[i + 1]) / 2; t(g, ar, cx, y + 11, { size: 7.5, align: "center" }); t(g, en, cx, y + 26, { size: 8.5, bold: true, align: "center" }); });
  y += head;
  const na = v => (v && String(v).trim() ? v : "N/A");
  const rows = [["Application Number", "رقم إنجاز", up(f.mofaId)], ["Visa No.", "رقم المستند", f.visaNo], ["Passport Holder Name", "الاسم في الجواز", up(f.name)], ["Passport Number", "رقم الجواز", f.passport], ["Passport Validity", "صلاحية الجواز", dMonY(f.expiryDate)],
    ["Age", "العمر", [dmy(f.dob), ageText(f.dob)]], ["Sex", "الجنس", f.sex], ["Musaned", "مساند", na(f.musaned)], ["Alwakala", "الوكالة", na(f.wakala)], ["Medical Report", "فحص طبي", na(f.medicalResult)], ["Police Clearance", "ورقة الشرطة", na(f.pcRef)],
    ["License", "الرخصة", na(f.licenseNo)], ["Profession", "المهنة", f.professionAr || f.professionEn], ["Experience Certificate", "المؤهل وشهادة الخبرة", f.experience === "Yes" ? "Yes" : "N/A"], ["Fingerprint", "البصمة", na(f.finger)]];
  rows.forEach(([en, ar, v]) => {
    const two = Array.isArray(v), rh = two ? 38 : 24; box(g, L, y, R - L, rh); X.slice(1, -1).forEach(x => vl(g, x, y, y + rh));
    g.font = `400 7.5px ${AR}`; const aw = g.measureText(ar).width; t(g, ar, R - 6, y + rh / 2, { size: 7.5, align: "right", ar: true }); t(g, `${en} /`, R - 10 - aw, y + rh / 2, { size: 8, bold: true, align: "right", ar: false });
    const cx = (X[2] + X[3]) / 2; if (two) { t(g, v[0], cx, y + 12, { size: 8.5, align: "center" }); t(g, v[1], cx, y + 26, { size: 8.5, align: "center" }); } else t(g, v, cx, y + rh / 2, { size: 8.5, align: "center", max: X[3] - X[2] - 8 });
    y += rh; });
  y += 44; g.font = `700 10.5px ${AR}`; const a1 = g.measureText("إسم المكتب").width;
  t(g, "إسم المكتب", R, y, { size: 10.5, bold: true, align: "right", ar: true }); t(g, `${OFFICE.name} - `, R - a1 - 2, y, { size: 10.5, bold: true, align: "right", ar: false });
  y += 18; const a2 = (g.font = `700 10.5px ${AR}`, g.measureText("رقم الرخصة").width); t(g, "رقم الرخصة", R, y, { size: 10.5, bold: true, align: "right", ar: true }); t(g, `${(OFFICE.licence || "").replace(/\D/g, "")} - `, R - a2 - 2, y, { size: 10.5, bold: true, align: "right", ar: false });
  y += 56; t(g, "- التوقيع", R, y, { size: 10.5, bold: true, align: "right", ar: true });
  y += 74; t(g, "- الختم", R, y, { size: 10.5, bold: true, align: "right", ar: true });
  return c;
}

export async function ksaCanvases(f, settings = {}) { await fontsReady(); return [page1(f, settings), page2(f), page3(f), page4(f)]; }
export async function ksaPdfBlob(f, settings) { return pdfFromCanvases(await ksaCanvases(f, settings), PW, PH, `KSA Embassy Application File ${f.passport || ""}`); }
export async function ksaPdf(f, settings) { saveBlob(await ksaPdfBlob(f, settings), `KSA-Embassy-File-${f.passport || f.name || "client"}.pdf`); }
