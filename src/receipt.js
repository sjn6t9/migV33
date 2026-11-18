// Money receipts: drawn on a canvas (A5 landscape, 1600 × 1131 px) and saved as PNG, PDF or Excel (.xlsx).
// PDF and Excel files are written here directly, with no extra libraries.
import { drawQR } from "./qr.js";

const W = 1600, H = 1131;
const GREEN = "#006a4e", DEEP = "#004d38", RED = "#d01c32", INK = "#14231d", MUTED = "#5b6b64", LINE = "#cfdad5", TINT = "#eef6f2";
const F = "Inter, 'Noto Sans Bengali', 'Noto Kufi Arabic', Hind, Arial, sans-serif";
export const TAGLINE = "Government Licensed Recruiting Agency • Recruiting Licence Number: RL1217";
export const OFFICE = { name: "MAM & MAM OVERSEAS LTD.", site: "www.mamandmam.bd", email: "info@mamandmam.bd", licence: "RL 1217" };

/* ---------- amount in words (Bangladeshi system: crore, lakh, thousand) ---------- */
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const two = n => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : ""));
const three = n => [n >= 100 ? ONES[Math.floor(n / 100)] + " Hundred" : "", two(n % 100)].filter(Boolean).join(" ");
function intWords(n) {
  if (n === 0) return "Zero";
  const parts = []; const crore = Math.floor(n / 1e7); n %= 1e7;
  if (crore) parts.push(intWords(crore) + " Crore");
  const lakh = Math.floor(n / 1e5); n %= 1e5; if (lakh) parts.push(two(lakh) + " Lakh");
  const th = Math.floor(n / 1000); n %= 1000; if (th) parts.push(two(th) + " Thousand");
  if (n) parts.push(three(n));
  return parts.join(" ");
}
export function takaWords(amount) {
  const a = Math.round(Number(amount || 0) * 100); const tk = Math.floor(a / 100), ps = a % 100;
  return `Taka ${intWords(tk)}${ps ? ` and ${two(ps)} Paisa` : ""} Only`;
}
export const tk = n => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const rDate = d => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "");

/* ---------- drawing ---------- */
function loadImg(src) { return new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; }); }
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function fitFont(g, text, max, size, weight) { let s = size; g.font = `${weight} ${s}px ${F}`; while (g.measureText(text).width > max && s > 14) { s--; g.font = `${weight} ${s}px ${F}`; } }
function clip(g, text, max) { if (g.measureText(text).width <= max) return text; let t = text; while (t.length > 1 && g.measureText(t + "…").width > max) t = t.slice(0, -1); return t + "…"; }
function wrap(g, text, max) { const out = []; let line = ""; for (const w of String(text).split(/\s+/)) { const t = line ? line + " " + w : w; if (g.measureText(t).width > max && line) { out.push(line); line = w; } else line = t; } if (line) out.push(line); return out; }

async function fontsReady() {
  if (!document.fonts?.load) return;
  await Promise.race([Promise.all(["800 40px Inter", "700 30px Inter", "500 30px Inter", "600 30px 'Noto Sans Bengali'"].map(f => document.fonts.load(f, "MAM বাংলা").catch(() => null))), new Promise(r => setTimeout(r, 2000))]);
}

export const receiptUrl = r => r.token ? `${(window.__SITE__?.main || location.origin).replace(/\/$/, "")}/r/${r.token}` : "";
/** Draw receipt `r` (from the server) with the office details in `settings`. Returns a canvas. */
export async function drawReceipt(r, settings = {}) {
  await fontsReady();
  const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
  const [logo, sigR, sigA] = await Promise.all([loadImg("/brand/logo-w320.webp?v=2"), r.received?.sigUrl ? loadImg(r.received.sigUrl) : null, r.approved?.sigUrl ? loadImg(r.approved.sigUrl) : null]);
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);

  // faint logo behind the details
  if (logo) { g.globalAlpha = .05; const lw = 640, lh = lw * logo.height / logo.width; g.drawImage(logo, (W - lw) / 2, 330 + (560 - lh) / 2, lw, lh); g.globalAlpha = 1; }

  // header band
  const hb = g.createLinearGradient(0, 0, W, 230); hb.addColorStop(0, GREEN); hb.addColorStop(1, DEEP); g.fillStyle = hb; g.fillRect(0, 0, W, 230);
  g.globalAlpha = .07; g.fillStyle = "#fff"; g.beginPath(); g.arc(W - 120, 20, 220, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
  g.fillStyle = RED; g.fillRect(0, 230, W, 8);
  rr(g, 56, 40, 236, 150, 22); g.fillStyle = "#fff"; g.fill();
  if (logo) { const lh = 136, lw = Math.min(222, lh * logo.width / logo.height); g.drawImage(logo, 56 + (236 - lw) / 2, 47, lw, lh); }
  g.fillStyle = "#fff"; g.textAlign = "left";
  fitFont(g, OFFICE.name, 820, 52, 800); g.fillText(OFFICE.name, 326, 98);
  fitFont(g, TAGLINE, 870, 25, 500); g.globalAlpha = .93; g.fillText(TAGLINE, 326, 138); g.globalAlpha = 1;
  g.font = `500 21px ${F}`; g.globalAlpha = .85;
  const contact = [settings.address, settings.phone].filter(Boolean).join("  ·  ");
  if (contact) g.fillText(clip(g, contact, 880), 326, 174);
  g.fillText(`${OFFICE.site}  ·  ${settings.email || OFFICE.email}`, 326, 204); g.globalAlpha = 1;
  // title pill
  rr(g, W - 376, 78, 320, 74, 37); g.fillStyle = "#fff"; g.fill();
  g.fillStyle = RED; g.textAlign = "center"; g.font = `800 32px ${F}`; g.fillText("MONEY RECEIPT", W - 216, 127);

  // receipt no. and date
  g.textAlign = "left"; g.fillStyle = MUTED; g.font = `600 22px ${F}`; g.fillText("Receipt No.", 70, 300);
  g.fillStyle = INK; g.font = `800 34px ${F}`; g.fillText(r.no, 70, 342);
  g.textAlign = "right"; g.fillStyle = MUTED; g.font = `600 22px ${F}`; g.fillText("Date", W - 70, 300);
  g.fillStyle = INK; g.font = `800 34px ${F}`; g.fillText(rDate(r.date), W - 70, 342);
  g.fillStyle = LINE; g.fillRect(70, 368, W - 140, 2);

  // details
  const p = r.payer || {};
  const field = (label, value, x, y, w) => {
    g.textAlign = "left"; g.fillStyle = MUTED; g.font = `600 21px ${F}`; g.fillText(label, x, y);
    g.fillStyle = INK; fitFont(g, value || "—", w, 30, 600); g.fillText(clip(g, value || "—", w), x, y + 40);
    g.strokeStyle = LINE; g.setLineDash([3, 5]); g.lineWidth = 2; g.beginPath(); g.moveTo(x, y + 56); g.lineTo(x + w, y + 56); g.stroke(); g.setLineDash([]);
  };
  const L = 70, CW = (W - 140 - 50) / 2, R2 = L + CW + 50;
  field("Received with thanks from", p.name, L, 420, W - 140);
  field("Passport No.", p.passport, L, 520, CW); field("Mobile", p.mobile, R2, 520, CW);
  field("Email", p.email, L, 620, CW); field("Agent", p.agent, R2, 620, CW);
  field("Purpose of payment", r.purpose, L, 720, CW); field("Payment method" + (r.ref ? " · Transaction / Ref No." : ""), r.ref ? `${r.method} · ${r.ref}` : r.method, R2, 720, CW);

  // amount in words + amount box
  rr(g, L, 812, 960, 96, 14); g.fillStyle = TINT; g.fill();
  g.fillStyle = MUTED; g.font = `600 20px ${F}`; g.fillText("Amount in words", L + 24, 846);
  g.fillStyle = GREEN; g.font = `700 26px ${F}`; let wl = wrap(g, takaWords(r.amount), 910);
  if (wl.length > 1) { g.font = `700 20px ${F}`; wl = wrap(g, takaWords(r.amount), 910).slice(0, 2); }
  wl.forEach((t, i) => g.fillText(t, L + 24, (wl.length > 1 ? 872 : 884) + i * 24));
  const bx = 1070, bw = W - 70 - bx;
  rr(g, bx, 812, bw, 96, 14); g.fillStyle = GREEN; g.fill();
  g.fillStyle = "#fff"; g.textAlign = "left"; g.font = `600 20px ${F}`; g.globalAlpha = .9; g.fillText("Amount (BDT)", bx + 24, 846); g.globalAlpha = 1;
  g.textAlign = "right"; fitFont(g, tk(r.amount), bw - 48, 40, 800); g.fillText(tk(r.amount), bx + bw - 24, 892);

  // note
  g.textAlign = "left";
  if (r.note) { g.fillStyle = MUTED; g.font = `500 20px ${F}`; g.fillText(clip(g, "Note: " + r.note, 960), L, 944); }

  // QR code: opens this receipt on the website, so anyone can check it
  const url = receiptUrl(r);
  if (url) { drawQR(g, url, W / 2 - 62, 924, 124, INK); g.textAlign = "center"; g.fillStyle = MUTED; g.font = `600 15px ${F}`; g.fillText("Scan to verify", W / 2, 1066); }
  const sig = (x, label, s, img) => {
    if (img) { const mh = 84, mw = 300, k = Math.min(mw / img.width, mh / img.height); const w = img.width * k, h = img.height * k; g.drawImage(img, x + 190 - w / 2, 1018 - h, w, h); }
    g.fillStyle = INK; g.fillRect(x, 1022, 380, 2); g.textAlign = "center";
    if (s?.name) { g.font = `700 21px ${F}`; g.fillText(clip(g, s.name + (s.title ? ", " + s.title : ""), 380), x + 190, 1047); }
    g.fillStyle = MUTED; g.font = `600 17px ${F}`; g.fillText(label, x + 190, 1071);
  };
  sig(L, "Received by", r.received, sigR); sig(W - 70 - 380, "Authorized signature", r.approved, sigA);

  // footer
  g.fillStyle = GREEN; g.fillRect(0, H - 44, W, 44);
  g.fillStyle = "#fff"; g.textAlign = "center"; g.font = `500 19px ${F}`;
  g.fillText(`Computer generated receipt · ${OFFICE.name} · ${OFFICE.site}`, W / 2, H - 15);

  const stamp = r.void ? ["CANCELLED", RED] : r.status !== "approved" ? ["NOT APPROVED YET", "#c98e1e"] : null;
  if (stamp) {
    g.save(); g.translate(W / 2, 640); g.rotate(-0.22); g.globalAlpha = .85; g.strokeStyle = stamp[1]; g.lineWidth = 10; g.font = `800 ${r.void ? 96 : 76}px ${F}`;
    const tw = g.measureText(stamp[0]).width + 120; rr(g, -tw / 2, -80, tw, 160, 24); g.stroke(); g.fillStyle = stamp[1]; g.textAlign = "center"; g.fillText(stamp[0], 0, r.void ? 34 : 27); g.restore();
  }
  return c;
}

/* ---------- saving ---------- */
function save(blob, name) { const u = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); }
const enc = new TextEncoder();

export async function receiptPng(r, settings) { const c = await drawReceipt(r, settings); save(await new Promise(res => c.toBlob(res, "image/png")), `${r.no}.png`); }

/** One-page PDF (A5 landscape) holding the receipt as a JPEG image. */
export async function receiptPdf(r, settings) {
  const c = await drawReceipt(r, settings);
  const jpg = new Uint8Array(await (await new Promise(res => c.toBlob(res, "image/jpeg", .94))).arrayBuffer());
  const pw = 595.28, ph = 419.53, parts = [], offs = []; let len = 0;
  const push = x => { const b = typeof x === "string" ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const obj = (n, body) => { offs[n] = len; push(`${n} 0 obj\n`); body(); push("\nendobj\n"); };
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  obj(1, () => push("<< /Type /Catalog /Pages 2 0 R >>"));
  obj(2, () => push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"));
  obj(3, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`));
  const cs = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
  obj(4, () => { push(`<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`); });
  obj(5, () => { push(`<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`); push(jpg); push("\nendstream"); });
  obj(6, () => push(`<< /Title (Money receipt ${r.no}) /Producer (${OFFICE.site}) >>`));
  const xref = len;
  push(`xref\n0 7\n0000000000 65535 f \n${[1, 2, 3, 4, 5, 6].map(n => String(offs[n]).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF`);
  save(new Blob(parts, { type: "application/pdf" }), `${r.no}.pdf`);
}

/* ---- Excel: a minimal .xlsx (zip, stored) with inline strings ---- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files) {
  const parts = [], central = []; let off = 0;
  const u16 = n => [n & 255, (n >> 8) & 255], u32 = n => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  for (const [name, text] of files) {
    const nb = enc.encode(name), data = enc.encode(text), crc = crc32(data);
    const head = [...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0)];
    parts.push(new Uint8Array([0x50, 0x4b, 3, 4, ...head]), nb, data);
    central.push(new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...head, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), nb);
    off += 30 + nb.length + data.length;
  }
  const csize = central.reduce((s, b) => s + b.length, 0);
  return new Blob([...parts, ...central, new Uint8Array([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(files.length), ...u16(files.length), ...u32(csize), ...u32(off), 0, 0])], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
const x = s => String(s ?? "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const col = i => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
/** rows: arrays of cells; a cell is a string, a number, or { v, s } with style 1 = bold, 2 = money, 3 = bold title, 4 = bold money */
export function xlsx(sheetName, rows, widths = [], filename = "export.xlsx") {
  const body = rows.map((row, ri) => `<row r="${ri + 1}">${row.map((cell, ci) => {
    if (cell === null || cell === undefined || cell === "") return "";
    const c = typeof cell === "object" ? cell : { v: cell }, ref = col(ci) + (ri + 1), st = c.s ? ` s="${c.s}"` : "";
    return typeof c.v === "number" ? `<c r="${ref}"${st}><v>${c.v}</v></c>` : `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${x(c.v)}</t></is></c>`;
  }).join("")}</row>`).join("");
  const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
  save(zip([
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${x(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="15"/><color rgb="FF006A4E"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
    ["xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${body}</sheetData></worksheet>`]
  ]), filename);
}

const signer = s => s ? s.name + (s.title ? `, ${s.title}` : "") : "";
export function receiptXlsx(r, settings = {}) {
  const p = r.payer || {};
  xlsx(r.no, [
    [{ v: OFFICE.name, s: 3 }], [TAGLINE], [[settings.address, settings.phone, OFFICE.site].filter(Boolean).join(" · ")], [],
    [{ v: "MONEY RECEIPT", s: 3 }], [{ v: "Receipt No.", s: 1 }, r.no], [{ v: "Date", s: 1 }, rDate(r.date)], [],
    [{ v: "Received with thanks from", s: 1 }, p.name], [{ v: "Passport No.", s: 1 }, p.passport], [{ v: "Mobile", s: 1 }, p.mobile], [{ v: "Email", s: 1 }, p.email], [{ v: "Agent", s: 1 }, p.agent], [],
    [{ v: "Purpose of payment", s: 1 }, r.purpose], [{ v: "Payment method", s: 1 }, r.method], [{ v: "Transaction / Ref No.", s: 1 }, r.ref],
    [{ v: "Amount (BDT)", s: 1 }, { v: r.amount, s: 4 }], [{ v: "Amount in words", s: 1 }, takaWords(r.amount)], [{ v: "Note", s: 1 }, r.note],
    [{ v: "Received by", s: 1 }, signer(r.received)], [{ v: "Authorized signature", s: 1 }, signer(r.approved)], [{ v: "Verify online", s: 1 }, receiptUrl(r)],
    ...(r.void ? [[], [{ v: "Status", s: 1 }, `CANCELLED${r.void.reason ? " · " + r.void.reason : ""}`]] : [])
  ], [28, 60], `${r.no}.xlsx`);
}

/** A list of receipts (e.g. the current search) as one Excel sheet. */
export function receiptsXlsx(list, title = "Money receipts") {
  const head = ["Receipt No.", "Date", "Name", "Passport No.", "Mobile", "Email", "Agent", "Purpose", "Method", "Ref No.", "Amount (BDT)", "Received by", "Approved by", "Status"].map(v => ({ v, s: 1 }));
  const live = list.filter(r => !r.void && r.status === "approved");
  xlsx("Receipts", [[{ v: `${OFFICE.name} · ${title}`, s: 3 }], [], head,
    ...list.map(r => [r.no, r.date, r.payer?.name, r.payer?.passport, r.payer?.mobile, r.payer?.email, r.payer?.agent, r.purpose, r.method, r.ref, { v: r.amount, s: 2 }, signer(r.received), signer(r.approved), r.void ? "Cancelled" : r.status === "approved" ? "Approved" : "Waiting for approval"]),
    [], ["", "", "", "", "", "", "", "", "", { v: "Total approved", s: 1 }, { v: live.reduce((s, r) => s + r.amount, 0), s: 4 }]
  ], [15, 12, 24, 15, 15, 24, 20, 24, 14, 16, 15, 22, 22, 18], `money-receipts-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
