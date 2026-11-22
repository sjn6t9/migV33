// Payment history (statement of account): Date · Details · Rate · Debit · Credit · Balance, with a running balance.
// Used for agents (their agent account) and for payers in Money receipts. Saved as PDF (A4) or Excel.
import { drawQR } from "./qr.js";
import { TAGLINE, OFFICE, xlsx, pdfFromCanvases, saveBlob, loadImg, rr, fitFont, clip, fontsReady, FONT as F, GREEN, DEEP, RED, INK, MUTED, LINE, TINT } from "./receipt.js";

const localDay = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
export const sdate = d => { if (!d) return ""; const [y, m, dd] = d.slice(0, 10).split("-"); return `${dd}-${m}-${y.slice(2)}`; };
export const amt = n => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
const LEAD = { md: "MD", director: "DIRECTOR", chairman: "CHAIRMAN" };
const payWay = (method, channel) => {
  const P = /^Person · ([a-z]+)(?: \| (.+))?$/.exec(String(method || "")); if (P) return `${LEAD[P[1]] || P[1].toUpperCase()}${P[2] ? ` · ${payWay(P[2])}` : ""}`; // given to the MD / a Director / the Chairman
  const c = String(channel || "").replace(/\s*\(.*\)\s*$/, ""), m = String(method || "");
  if (c) return c.toUpperCase();
  if (/^Mobile banking ·|^Bank transfer ·|^Cheque ·/.test(m)) return m.split("·").pop().trim().replace(/\s*\(.*\)\s*$/, "").toUpperCase();
  return (m || "Cash").toUpperCase();
};

/** agent account → statement rows (pending payments are listed but do not count) */
export function agentRows(ledger, agentId) {
  return ledger.filter(l => l.agentId === agentId && l.status !== "rejected").map(l => ({
    id: l.id, date: l.date, details: l.desc, ref: l.ref, pending: l.status !== "confirmed", src: l,
    rate: l.type === "charge" ? `${amt(l.rate || l.amount)}X${l.qty || 1}` : l.opening ? "ADVANCE" : payWay(l.method), rq: l.type === "charge" && !l.mr ? { rate: l.rate || l.amount, qty: l.qty || 1 } : null,
    debit: l.type === "charge" ? Number(l.amount) : 0, credit: l.type === "payment" ? Number(l.amount) : 0
  }));
}
/** payer account in Money receipts → rows: total price (if set), charges, approved receipts */
export function accountRows(acc, charges, receipts) {
  const rows = [];
  if (acc.price > 0) rows.push({ id: "price", date: (acc.created || "").slice(0, 10), details: "Total price", rate: `${amt(acc.price)}X1`, debit: acc.price, credit: 0 });
  for (const c of charges.filter(c => c.accountId === acc.id)) rows.push({ id: c.id, date: c.date, details: c.desc, rate: `${amt(c.rate)}X${c.qty}`, rq: { rate: c.rate, qty: c.qty }, debit: c.amount, credit: 0, src: c, charge: true });
  for (const r of receipts.filter(r => r.accountId === acc.id && r.status === "approved" && !r.void))
    rows.push({ id: r.id, date: r.date, details: `Money Received${r.purpose ? ` · ${r.purpose}` : ""} (${r.no})`, ref: r.ref, rate: payWay(r.method, r.channel), debit: 0, credit: r.amount, receipt: r });
  return rows;
}

/** sort, apply a date range (earlier rows become one opening balance row) and add the running balance */
export const stime = iso => { try { return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dhaka" }); } catch { return ""; } };
export function withBalance(rows, from = "", to = "") {
  // oldest first, so the latest transaction is at the bottom: by date, then by the time it was entered
  const all = [...rows].sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.at && b.at ? a.at.localeCompare(b.at) : 0) || (a.debit ? -1 : 1) - (b.debit ? -1 : 1));
  let bal = 0; const out = [];
  const before = from ? all.filter(r => r.date < from && !r.pending) : [];
  if (before.length) { bal = before.reduce((s, r) => s + r.debit - r.credit, 0); out.push({ id: "open", date: from, details: "Opening balance", rate: "", debit: bal > 0 ? bal : 0, credit: bal < 0 ? -bal : 0, balance: bal, opening: true }); }
  for (const r of all) {
    if (from && r.date < from) continue; if (to && r.date > to) continue;
    if (!r.pending) bal += r.debit - r.credit;
    out.push({ ...r, balance: r.pending ? null : bal });
  }
  const live = out.filter(r => !r.pending && !r.opening);
  return { rows: out, debit: live.reduce((s, r) => s + r.debit, 0), credit: live.reduce((s, r) => s + r.credit, 0), balance: bal };
}
export const balWord = (b, cash) => (cash ? (b >= 0 ? "Balance" : "Overdrawn") : b > 0 ? "Due" : b < 0 ? "Advance" : "Settled");
const isBad = (b, cash) => (cash ? b < 0 : b > 0); // red: money owed to the office, or an office account below zero

/* ---------------- PDF (A4 portrait, 1240 × 1754 px per page) ---------------- */
const PW = 1240, PH = 1754, M = 40;
const COLS = [["Date", 112, "l"], ["Details", 452, "l"], ["Rate", 142, "l"], ["Debit", 148, "r"], ["Credit", 148, "r"], ["Balance", 158, "r"]];
export async function statementCanvases(st) {
  await fontsReady(); const logo = await loadImg("/brand/logo-w320.webp?v=2");
  const { rows, debit, credit, balance } = st.calc;
  const first = 32, rest = 42, RH = 36; // rows per page
  const pages = []; let i = 0; do { pages.push(rows.slice(i, i + (pages.length ? rest : first))); i += pages.length === 1 ? first : rest; } while (i < rows.length);
  const canvases = pages.map((chunk, pi) => {
    const c = document.createElement("canvas"); c.width = PW; c.height = PH; const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, PW, PH);
    let y;
    if (pi === 0) {
      const hb = g.createLinearGradient(0, 0, PW, 180); hb.addColorStop(0, GREEN); hb.addColorStop(1, DEEP); g.fillStyle = hb; g.fillRect(0, 0, PW, 180); g.fillStyle = RED; g.fillRect(0, 180, PW, 6);
      rr(g, M, 28, 190, 124, 18); g.fillStyle = "#fff"; g.fill(); if (logo) { const lh = 112, lw = Math.min(178, lh * logo.width / logo.height); g.drawImage(logo, M + (190 - lw) / 2, 34, lw, lh); }
      g.fillStyle = "#fff"; g.textAlign = "left"; fitFont(g, OFFICE.name, 640, 40, 800); g.fillText(OFFICE.name, 262, 78);
      fitFont(g, TAGLINE, 660, 19, 500); g.globalAlpha = .93; g.fillText(TAGLINE, 262, 112); g.font = `500 17px ${F}`; g.globalAlpha = .85; g.fillText(`${OFFICE.site}  ·  ${OFFICE.email}`, 262, 144); g.globalAlpha = 1;
      rr(g, PW - M - 230, 62, 230, 56, 28); g.fillStyle = "#fff"; g.fill(); g.fillStyle = RED; g.textAlign = "center"; g.font = `800 21px ${F}`; g.fillText(st.kind || "PAYMENT HISTORY", PW - M - 115, 98);
      g.textAlign = "left"; g.fillStyle = MUTED; g.font = `600 18px ${F}`; g.fillText(st.label || "Statement of", M, 232);
      const tw = st.qrUrl ? 600 : 700;
      g.fillStyle = INK; fitFont(g, st.title, tw, 34, 800); g.fillText(clip(g, st.title, tw), M, 274);
      g.fillStyle = MUTED; g.font = `500 18px ${F}`; if (st.sub) g.fillText(clip(g, st.sub, tw), M, 304);
      const qx = st.qrUrl ? PW - M - 112 : PW - M; // QR code: opens the issued statement on the website
      if (st.qrUrl) { drawQR(g, st.qrUrl, qx + 6, 198, 106, INK); g.textAlign = "center"; g.fillStyle = MUTED; g.font = `600 12px ${F}`; g.fillText("Scan to verify", qx + 59, 318); }
      g.textAlign = "right"; g.fillStyle = MUTED; g.font = `500 18px ${F}`;
      if (st.no) { g.fillStyle = INK; g.font = `800 20px ${F}`; g.fillText(`Statement No. ${st.no}`, qx - 18, 236); g.fillStyle = MUTED; g.font = `500 18px ${F}`; }
      g.fillText(`Period: ${st.from ? sdate(st.from) : "Start"} – ${st.to ? sdate(st.to) : sdate(st.at || localDay())}`, qx - 18, 274);
      g.fillText(`${st.no ? "Issued" : "Printed"}: ${new Date(st.at || Date.now()).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`, qx - 18, 304);
      // totals
      const bad = isBad(balance, st.cash);
      const bx = [[st.cash ? "Money in" : "Total debit", amt(debit), INK], [st.cash ? "Money out" : "Total credit", amt(credit), INK], [balWord(balance, st.cash), amt(Math.abs(balance)), bad ? RED : GREEN]];
      bx.forEach(([l, v, col], k) => { const w = (PW - 2 * M - 40) / 3, x = M + k * (w + 20); rr(g, x, 330, w, 84, 12); g.fillStyle = k === 2 ? (bad ? "#fdecee" : "#e6f6ea") : TINT; g.fill();
        g.textAlign = "left"; g.fillStyle = MUTED; g.font = `600 17px ${F}`; g.fillText(l + " (BDT)", x + 18, 362); g.fillStyle = col; g.font = `800 28px ${F}`; g.fillText(v, x + 18, 400); });
      y = 446;
    } else {
      g.fillStyle = GREEN; g.fillRect(0, 0, PW, 8); g.textAlign = "left"; g.fillStyle = INK; g.font = `700 20px ${F}`; g.fillText(clip(g, `${OFFICE.name} · ${st.title}`, PW - 2 * M - 200), M, 56);
      g.textAlign = "right"; g.fillStyle = MUTED; g.font = `500 17px ${F}`; g.fillText(`Page ${pi + 1} of ${pages.length}`, PW - M, 56); y = 84;
    }
    // table header
    g.fillStyle = "#c9e3b2"; g.fillRect(M, y, PW - 2 * M, RH + 4); g.strokeStyle = "#8aa57a"; g.lineWidth = 1.5; g.strokeRect(M, y, PW - 2 * M, RH + 4);
    let x = M; g.fillStyle = INK; g.font = `800 18px ${F}`;
    for (const [h0, w, al] of COLS) { const h = h0 === "Debit" && st.heads ? st.heads[0] : h0 === "Credit" && st.heads ? st.heads[1] : h0; g.textAlign = al === "r" ? "right" : "left"; g.fillText(h, al === "r" ? x + w - 10 : x + 10, y + 26); x += w; }
    y += RH + 4;
    chunk.forEach((r, k) => {
      g.fillStyle = r.opening ? "#eef3ea" : k % 2 ? "#f6f8f7" : "#fff"; g.fillRect(M, y, PW - 2 * M, RH);
      g.fillStyle = "#fff6c7"; g.fillRect(M + COLS[0][1] + COLS[1][1], y, COLS[2][1], RH); // rate column, as in the office sheet
      g.strokeStyle = LINE; g.lineWidth = 1; g.strokeRect(M, y, PW - 2 * M, RH);
      const tm = st.times && r.at && !r.opening ? stime(r.at) : "";
      const cells = [sdate(r.date), r.details + (r.pending ? " (pending)" : ""), r.rate, r.debit ? amt(r.debit) : "", r.credit ? amt(r.credit) : "", r.balance == null ? "—" : amt(r.balance)];
      let cx = M;
      cells.forEach((v, ci) => {
        const [, w, al] = COLS[ci]; g.textAlign = al === "r" ? "right" : "left";
        g.fillStyle = ci === 5 && r.balance != null ? (isBad(r.balance, st.cash) ? RED : GREEN) : r.pending ? MUTED : INK;
        g.font = `${ci === 1 || ci === 5 || r.opening ? 700 : 500} 17px ${F}`;
        if (ci === 0 && tm) { g.fillText(String(v), cx + 10, y + 17); g.font = `500 12px ${F}`; g.fillStyle = MUTED; g.fillText(tm, cx + 10, y + 32); cx += w; return; }
        g.fillText(clip(g, String(v ?? ""), w - 20), al === "r" ? cx + w - 10 : cx + 10, y + 24); cx += w;
      });
      let lx = M; for (const [, w] of COLS.slice(0, -1)) { lx += w; g.beginPath(); g.moveTo(lx, y); g.lineTo(lx, y + RH); g.stroke(); }
      y += RH;
    });
    if (pi === pages.length - 1) { // totals row
      g.fillStyle = "#e3efdc"; g.fillRect(M, y, PW - 2 * M, RH + 4); g.strokeStyle = "#8aa57a"; g.strokeRect(M, y, PW - 2 * M, RH + 4);
      g.fillStyle = INK; g.font = `800 18px ${F}`; g.textAlign = "left"; g.fillText("Total", M + COLS[0][1] + 10, y + 26);
      g.textAlign = "right"; const x3 = M + COLS[0][1] + COLS[1][1] + COLS[2][1];
      g.fillText(amt(debit), x3 + COLS[3][1] - 10, y + 26); g.fillText(amt(credit), x3 + COLS[3][1] + COLS[4][1] - 10, y + 26);
      g.fillStyle = isBad(balance, st.cash) ? RED : GREEN; g.fillText(st.cash ? amt(balance) : `${amt(Math.abs(balance))} ${balance > 0 ? "Due" : balance < 0 ? "Adv." : ""}`.trim(), PW - M - 10, y + 26);
    }
    g.fillStyle = GREEN; g.fillRect(0, PH - 40, PW, 40); g.fillStyle = "#fff"; g.textAlign = "center"; g.font = `500 16px ${F}`;
    g.fillText(`Computer generated statement · ${OFFICE.name} · ${OFFICE.site} · Page ${pi + 1} of ${pages.length}`, PW / 2, PH - 14);
    return c;
  });
  return canvases;
}
export async function statementPdfBlob(st) { return pdfFromCanvases(await statementCanvases(st), 595.28, 841.89, `${st.no ? st.no + " " : ""}${st.kind || "Payment history"} ${st.title}`); }
export async function statementPdf(st) { saveBlob(await statementPdfBlob(st), `${st.no || fileName(st)}.pdf`); }
export async function statementPrint(st) {
  const w = window.open("", "_blank"); if (!w) throw new Error("Allow pop-ups to print.");
  w.document.write("<title>Printing…</title><p style='font-family:sans-serif'>Making the statement…</p>");
  const urls = (await statementCanvases(st)).map(c => c.toDataURL("image/jpeg", .92));
  w.document.open(); w.document.write(`<title>${st.no || "Statement"}</title><style>@page{size:A4;margin:0}body{margin:0}img{width:100%;display:block;page-break-after:always}</style>${urls.map((u, i) => `<img src="${u}"${i === urls.length - 1 ? ' onload="setTimeout(()=>print(),250)"' : ""}>`).join("")}`); w.document.close();
}
const fileName = st => `payment-history-${String(st.title).replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "account"}`;

export function statementXlsx(st) {
  const { rows, debit, credit, balance } = st.calc;
  xlsx("Payment history", [
    [{ v: OFFICE.name, s: 3 }], [TAGLINE], [], [{ v: `${st.kind || "Payment history"}: ${st.title}`, s: 1 }], st.sub ? [st.sub] : [],
    [`Period: ${st.from ? sdate(st.from) : "start"} to ${sdate(st.to || localDay())}`], [],
    ["DATE", "Details", "RATE", "Debit", "Credit", "Balance"].map(v => ({ v, s: 1 })),
    ...rows.map(r => [sdate(r.date) + (st.times && r.at && !r.opening ? " " + stime(r.at) : ""), r.details + (r.pending ? " (pending)" : ""), r.rate, r.debit ? { v: r.debit, s: 2 } : "", r.credit ? { v: r.credit, s: 2 } : "", r.balance == null ? "" : { v: r.balance, s: 2 }]),
    [], ["", { v: "Total", s: 1 }, "", { v: debit, s: 4 }, { v: credit, s: 4 }, { v: balance, s: 4 }], ["", { v: balWord(balance, st.cash), s: 1 }, "", "", "", { v: st.cash ? balance : Math.abs(balance), s: 4 }]
  ], [11, 46, 14, 14, 14, 14], `${fileName(st)}.xlsx`);
}
