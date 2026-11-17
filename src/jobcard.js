// Draws a 1080×1350 PNG "photocard" for a job post (Facebook / Instagram portrait size), in the site's colours.
import { COUNTRIES } from "./constants.js";

const W = 1080, H = 1350;
const GREEN = "#006a4e", GREEN_DEEP = "#004d38", RED = "#d01c32", INK = "#0f241d", MUTED = "#55695f", SOFT = "#e2f0ea", LINE = "#d5e3dc";
const DISPLAY = "Archivo, 'Anek Bangla', Arial, sans-serif", BODY = "Hind, 'Noto Sans Bengali', Archivo, Arial, sans-serif";

const fmt = n => Number(n || 0).toLocaleString("en-US");
const fdate = iso => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "Open");

function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function lines(g, text, maxW, maxLines) {
  const words = String(text).split(/\s+/); const out = []; let cur = "";
  for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (g.measureText(t).width <= maxW) cur = t; else { if (cur) out.push(cur); cur = w; } }
  if (cur) out.push(cur);
  if (out.length > maxLines) { out.length = maxLines; let l = out[maxLines - 1]; while (g.measureText(`${l}…`).width > maxW && l.length) l = l.slice(0, -1); out[maxLines - 1] = `${l}…`; }
  return out;
}
/* largest font size (down to min) at which text fits in maxLines */
function fitText(g, text, weight, family, size, min, maxW, maxLines) {
  for (let s = size; s >= min; s -= 4) { g.font = `${weight} ${s}px ${family}`; const L = lines(g, text, maxW, 99); if (L.length <= maxLines) return { size: s, lines: L }; }
  g.font = `${weight} ${min}px ${family}`; return { size: min, lines: lines(g, text, maxW, maxLines) };
}

async function fontsReady() {
  try {
    await Promise.all(["800 80px Archivo", "700 40px Archivo", "600 30px Hind", "400 30px Hind", "700 30px Hind", "500 28px Hind"].map(f => document.fonts.load(f)).concat(["400 26px 'Noto Sans Bengali'", "600 26px 'Noto Sans Bengali'"].map(f => document.fonts.load(f, "এখনই আবেদন করুন"))));
    await document.fonts.ready;
  } catch { /* fall back to system fonts */ }
}

/**
 * @param job      job record
 * @param opts     { company, settings, link } — link is the public share URL shown on the card
 * @returns Promise<Blob> PNG
 */
export async function renderJobCard(job, { company = "", settings = {}, link = "" } = {}) {
  await fontsReady();
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const logo = await loadImage("/brand/logo-320.webp");
  const g = c.getContext("2d"); g.textBaseline = "alphabetic";

  /* background */
  g.fillStyle = "#f3f7f5"; g.fillRect(0, 0, W, H);

  /* header band */
  const hg = g.createLinearGradient(0, 0, W, 330); hg.addColorStop(0, "#00785a"); hg.addColorStop(0.5, GREEN); hg.addColorStop(1, GREEN_DEEP);
  g.fillStyle = hg; g.fillRect(0, 0, W, 330);
  // logo
  roundRect(g, 64, 50, 120, 120, 24); g.fillStyle = "#ffffff"; g.fill();
  if (logo) g.drawImage(logo, 70, 56, 108, 108);
  else { g.fillStyle = GREEN; g.font = `800 34px ${DISPLAY}`; g.textAlign = "center"; g.fillText("M&M", 124, 118); }
  g.textAlign = "left"; g.fillStyle = "#ffffff"; g.font = `800 40px ${DISPLAY}`; g.fillText("MAM & MAM OVERSEAS LTD.", 208, 102);
  g.font = `500 28px ${BODY}`; g.fillStyle = "rgba(255,255,255,.88)"; g.fillText("Government licensed recruiting agency · RL 1217", 208, 146);
  // hiring pill
  g.font = `800 34px ${DISPLAY}`; const hire = "WE ARE HIRING"; const hw = g.measureText(hire).width + 64;
  roundRect(g, 64, 210, hw, 70, 35); g.fillStyle = RED; g.fill();
  g.fillStyle = "#ffffff"; g.fillText(hire, 96, 257);
  g.font = `600 30px ${BODY}`; g.fillStyle = "rgba(255,255,255,.92)"; g.fillText(`${fmt(job.vacancies)} vacancies`, 64 + hw + 28, 256);

  /* main card */
  const X = 48, Y = 300, CW = W - 96; let y = Y + 70;
  roundRect(g, X, Y, CW, 830, 28); g.fillStyle = "#ffffff"; g.fill(); g.strokeStyle = LINE; g.lineWidth = 2; g.stroke();
  const inX = X + 48, inW = CW - 96;
  // country + city
  g.fillStyle = RED; g.font = `700 30px ${BODY}`; g.fillText(`${(job.country || "").toUpperCase()}  ·  ${job.city || ""}`, inX, y); y += 26;
  // title
  const t = fitText(g, job.title, 800, DISPLAY, 84, 52, inW, 2);
  g.fillStyle = INK; t.lines.forEach(l => { y += t.size * 1.08; g.fillText(l, inX, y); });
  if (company) { y += 46; g.font = `500 30px ${BODY}`; g.fillStyle = MUTED; g.fillText(lines(g, company, inW, 1)[0], inX, y); }
  // salary
  y += 40; roundRect(g, inX, y, inW, 150, 20); g.fillStyle = SOFT; g.fill();
  g.fillStyle = MUTED; g.font = `600 26px ${BODY}`; g.fillText(job.period === "hour" ? "HOURLY WAGE" : "MONTHLY SALARY", inX + 34, y + 46);
  const cur = job.currency || COUNTRIES[job.country] || "";
  g.fillStyle = GREEN; g.font = `800 56px ${DISPLAY}`; const sal = `${cur} ${fmt(job.salaryMin)} – ${fmt(job.salaryMax)}${job.period === "hour" ? " /hr" : ""}`; g.fillText(sal, inX + 34, y + 112);
  const rate = Number(settings.rates?.[cur] || 0);
  if (rate) { g.font = `600 28px ${BODY}`; g.fillStyle = MUTED; const bdt = `≈ BDT ${fmt(Math.round(job.salaryMin * rate))}+${job.period === "hour" ? " /hr" : ""}`; const sw = g.measureText(bdt).width; g.fillText(bdt, inX + inW - 34 - sw, y + 110); }
  y += 150;
  // facts grid (3 × 2)
  const facts = [["Job type", job.type || "—"], ["Contract", job.contract ? `${job.contract} year${job.contract > 1 ? "s" : ""}` : "—"], ["Experience", job.experience ? `${job.experience}+ years` : "Not required"],
    ["Age", job.age || "—"], ["Category", job.category || "—"], ["Apply by", fdate(job.deadline)]];
  const colW = inW / 3; y += 34;
  facts.forEach(([k, v], i) => {
    const cx = inX + (i % 3) * colW, cy = y + Math.floor(i / 3) * 104;
    g.font = `600 24px ${BODY}`; g.fillStyle = MUTED; g.fillText(k.toUpperCase(), cx, cy + 26);
    g.font = `700 32px ${DISPLAY}`; g.fillStyle = INK; g.fillText(lines(g, v, colW - 20, 1)[0], cx, cy + 68);
  });
  y += 236;
  // benefits chips
  const ben = (job.benefits || []).slice(0, 6);
  if (ben.length) {
    g.font = `600 24px ${BODY}`; g.fillStyle = MUTED; g.fillText("BENEFITS", inX, y + 4); y += 22;
    let bx = inX, by = y; g.font = `600 28px ${BODY}`;
    for (const b of ben) {
      const bw = g.measureText(b).width + 44;
      if (bx + bw > inX + inW) { bx = inX; by += 62; }
      if (by > Y + 830 - 66) break;
      roundRect(g, bx, by, bw, 50, 25); g.fillStyle = "#ffffff"; g.fill(); g.strokeStyle = GREEN; g.lineWidth = 2; g.stroke();
      g.fillStyle = GREEN; g.fillText(b, bx + 22, by + 35); bx += bw + 14;
    }
  }

  /* footer band */
  const fy = 1160; g.fillStyle = GREEN_DEEP; g.fillRect(0, fy, W, H - fy); g.fillStyle = RED; g.fillRect(0, fy, W, 6);
  g.fillStyle = "#ffffff"; g.font = `800 38px ${DISPLAY}`; g.fillText("Apply online", 64, fy + 74);
  g.font = `600 30px ${BODY}`; g.fillStyle = "rgba(255,255,255,.92)";
  g.fillText(lines(g, link.replace(/^https?:\/\//, ""), W - 128, 1)[0], 64, fy + 120);
  const contact = [settings.phone && `Call ${settings.phone}`, settings.whatsapp && `WhatsApp +${settings.whatsapp}`].filter(Boolean).join("   ·   ");
  g.font = `500 26px ${BODY}`; g.fillStyle = "rgba(255,255,255,.8)";
  g.fillText(contact || "এখনই আবেদন করুন · Never pay anyone outside our office", 64, fy + 166);

  return await new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error("Could not create the image."))), "image/png"));
}

/* the agency logo, drawn on the card (same site, so the canvas can still be saved as PNG) */
function loadImage(src) {
  return new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; setTimeout(() => res(i.complete && i.naturalWidth ? i : null), 4000); });
}
