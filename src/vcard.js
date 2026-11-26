// Visiting cards for team members: front (person) and back (agency), drawn on a canvas at
// print size 3.5 × 2 inches, 300 dpi (1050 × 600 px). Text is in the chosen language;
// names, numbers and addresses stay as written.
import { translatorFor, LANGS } from "./i18n.js";
import { drawQR } from "./qr.js";
import { memberCode } from "./store.js";
import { COMPANY, num, rl, word, nameIn } from "./vcardLocale.js";

const W = 1050, H = 600;
// the website's look: white and light grey, near-black text, the logo's green and red
const GREEN = "#05613e", RED = "#fd0404", INK = "#1d1d1f", MUTED = "#6e6e73", SOFT = "#f5f5f7";
const DISPLAY = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', Inter, 'Anek Bangla', 'Noto Kufi Arabic', Hind, Arial, sans-serif";
const BODY = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', Inter, 'Noto Sans Bengali', 'Noto Kufi Arabic', Hind, Arial, sans-serif";
const LATIN = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', Inter, Arial, sans-serif";

function loadImg(src) {
  return new Promise(res => { if (!src) return res(null); const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
}
/* react-icons render as SVG in the page; turn one into an image in the given colour */
function svgImg(svg, color) {
  if (!svg) return Promise.resolve(null);
  let s = svg.replace(/currentColor/g, color);
  if (!/xmlns=/.test(s)) s = s.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  s = s.replace(/<svg([^>]*?)\swidth="[^"]*"/, "<svg$1").replace(/<svg([^>]*?)\sheight="[^"]*"/, "<svg$1").replace("<svg", '<svg width="64" height="64"');
  return loadImg("data:image/svg+xml;charset=utf-8," + encodeURIComponent(s));
}
async function fontsReady() {
  if (!document.fonts?.load) return;
  const tries = [["800 40px Inter", "MAM"], ["700 30px Inter", "Mobile"], ["600 30px Inter", "Mobile"], ["500 30px Inter", "Mobile"], ["600 30px Hind", "हिन्दी"], ["700 30px Hind", "हिन्दी"], ["600 30px 'Noto Sans Bengali'", "বাংলা"],
    ["700 30px 'Anek Bangla'", "বাংলা"], ["600 30px 'Noto Kufi Arabic'", "العربية"]];
  await Promise.race([Promise.all(tries.map(([f, t]) => document.fonts.load(f, t).catch(() => null))), new Promise(r => setTimeout(r, 2500))]);
}
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function fit(g, text, max, size, weight, family) {
  let s = size; g.font = `${weight} ${s}px ${family}`;
  while (g.measureText(text).width > max && s > 14) { s -= 1; g.font = `${weight} ${s}px ${family}`; }
  return s;
}
function clip(g, text, max) { if (g.measureText(text).width <= max) return text; let t = text; while (t.length > 1 && g.measureText(t + "…").width > max) t = t.slice(0, -1); return t + "…"; }

/** Draw one side. `icons` are SVG strings for phone, whatsapp, mail, globe, pin. Returns a canvas. */
export const OFFICE_SITE = "www.mamandmam.bd", OFFICE_EMAIL = "info@mamandmam.bd";

export async function drawVisitingCard(m, { lang = "en", side = "front", settings = {}, site = location.host, icons = {}, verifyUrl = "" } = {}) {
  const t0 = await translatorFor(lang); const rtl = !!LANGS.find(l => l.code === lang)?.rtl;
  // every word in the card's language, numbers in its own digits; only the website and email stay as they are
  const t = s => rl(t0(s), lang), N = s => num(s, lang), CO = COMPANY[lang] || COMPANY.en;
  const address = (lang !== "en" && lang !== "fj" && settings.addresses?.[lang]) || settings.address || "";
  await fontsReady();
  const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
  g.direction = rtl ? "rtl" : "ltr";
  // text in Latin letters only (the website, the email) is laid out left-to-right even on an Arabic card
  const _fill = g.fillText.bind(g);
  g.fillText = (str, x, y) => { if (rtl && /^[\x20-\x7E…]+$/.test(String(str))) { const d = g.direction; g.direction = "ltr"; _fill(str, x, y); g.direction = d; } else _fill(str, x, y); };
  const X = (x, w = 0) => (rtl ? W - x - w : x); // mirror for right-to-left
  const logo = await loadImg("/brand/logo-w320.webp?v=2");
  // the logo's two colours, side by side, as a thin line along the bottom edge
  const flagLine = (y, h) => { g.fillStyle = GREEN; g.fillRect(0, y, W * .72, h); g.fillStyle = RED; g.fillRect(W * .72, y, W * .28, h); };

  if (side === "back") {
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, W, H);
    rr(g, 34, 30, W - 68, H - 78, 34); g.fillStyle = SOFT; g.fill();
    if (logo) { const lw = 300, lh = lw * logo.height / logo.width; g.drawImage(logo, W / 2 - lw / 2, 62, lw, lh); }
    g.textAlign = "center"; g.fillStyle = INK;
    fit(g, CO[2], W - 140, 46, 700, DISPLAY); g.fillText(CO[2], W / 2, 318);
    g.fillStyle = MUTED; fit(g, t("Government licensed recruiting agency"), W - 180, 25, 400, BODY); g.fillText(t("Government licensed recruiting agency"), W / 2, 358);
    const lic = t("Recruiting Licence RL 1217"); g.font = `600 22px ${BODY}`; const lw2 = Math.min(W - 200, g.measureText(lic).width + 56);
    rr(g, W / 2 - lw2 / 2, 380, lw2, 46, 23); g.fillStyle = GREEN; g.fill(); g.fillStyle = "#fff"; fit(g, lic, lw2 - 40, 22, 600, BODY); g.fillText(lic, W / 2, 411);
    g.fillStyle = INK; g.font = `600 24px ${LATIN}`; g.fillText(OFFICE_SITE, W / 2, 470);
    g.fillStyle = MUTED; g.font = `400 20px ${LATIN}`; g.fillText(OFFICE_EMAIL, W / 2, 500);
    if (address) { g.fillStyle = MUTED; g.font = `400 18px ${BODY}`; g.fillText(clip(g, N(address), W - 180), W / 2, 528); }
    flagLine(H - 12, 12);
    return c;
  }

  // front: the agency on a light grey panel on one side, the person on white on the other
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, W, H);
  const BW = 330; const bx = X(0, BW);
  g.fillStyle = SOFT; g.fillRect(bx, 0, BW, H);
  // a thin green line where the grey panel meets the white side
  g.fillStyle = GREEN; g.fillRect(rtl ? W - BW - 4 : BW, 0, 4, H);
  const cx = bx + BW / 2;
  if (logo) { const lw = 188, lh = lw * logo.height / logo.width; g.drawImage(logo, cx - lw / 2, 30, lw, lh); }
  g.textAlign = "center"; g.fillStyle = INK;
  fit(g, CO[0], BW - 44, 30, 700, DISPLAY); g.fillText(CO[0], cx, 186);
  fit(g, CO[1], BW - 44, 22, 600, DISPLAY); g.fillText(CO[1], cx, 216);
  g.fillStyle = MUTED; fit(g, t("Government licensed recruiting agency"), BW - 44, 15, 400, BODY);
  g.fillText(clip(g, t("Government licensed recruiting agency"), BW - 36), cx, 242);
  const rlx = rl("RL 1217", lang); g.font = `600 16px ${BODY}`; const rw = g.measureText(rlx).width + 30;
  rr(g, cx - rw / 2, 254, rw, 30, 15); g.fillStyle = GREEN; g.fill(); g.fillStyle = "#fff"; g.fillText(rlx, cx, 275);
  // QR code (opens this member's verification page)
  const code = memberCode(m);
  if (verifyUrl) {
    const QS = 140, qx = cx - QS / 2, qy = 304;
    rr(g, qx - 10, qy - 10, QS + 20, QS + 20, 18); g.fillStyle = "#fff"; g.fill();
    drawQR(g, verifyUrl, qx, qy, QS, INK);
    g.fillStyle = MUTED; fit(g, t("Scan to verify"), BW - 60, 14, 500, BODY); g.fillText(t("Scan to verify"), cx, qy + QS + 32);
    if (code) { g.fillStyle = INK; g.font = `600 13px ${BODY}`; g.fillText(`${word("ID", lang)} ${N(code)}`, cx, qy + QS + 51); }
  }
  g.fillStyle = INK; g.font = `600 16px ${LATIN}`; g.fillText(OFFICE_SITE, cx, 548);
  g.fillStyle = MUTED; g.font = `400 14px ${LATIN}`; g.fillText(OFFICE_EMAIL, cx, 570);

  // person
  const L = BW + 52, R = W - 48, areaW = R - L;
  const photo = m.photo?.data ? await loadImg(m.photo.data) : null;
  const PH = 128; let textW = areaW;
  if (photo) {
    const px = X(R - PH, PH), py = 44; textW = areaW - PH - 24;
    g.save(); g.beginPath(); g.arc(px + PH / 2, py + PH / 2, PH / 2, 0, Math.PI * 2); g.clip();
    const s = Math.max(PH / photo.width, PH / photo.height), dw = photo.width * s, dh = photo.height * s;
    g.drawImage(photo, px + (PH - dw) / 2, py + (PH - dh) * 0.15, dw, dh); g.restore();
    g.lineWidth = 3; g.strokeStyle = "#e5e5ea"; g.beginPath(); g.arc(px + PH / 2, py + PH / 2, PH / 2 - 1, 0, Math.PI * 2); g.stroke();
  }
  g.textAlign = rtl ? "right" : "left"; const tx = rtl ? W - L : L;
  const nm = nameIn(m, lang);
  g.fillStyle = INK; fit(g, nm, textW, 44, 700, DISPLAY); g.fillText(clip(g, nm, textW), tx, 104);
  g.fillStyle = GREEN; fit(g, t(m.title || ""), textW, 26, 600, BODY); g.fillText(clip(g, t(m.title || ""), textW), tx, 144);
  if (m.dept) { g.fillStyle = MUTED; fit(g, t(m.dept), textW, 20, 400, BODY); g.fillText(clip(g, t(m.dept), textW), tx, 176); }
  g.fillStyle = RED; rr(g, X(L, 56), 198, 56, 5, 2.5); g.fill();

  const wa = String(m.whatsapp || "").replace(/\D/g, ""), ph = String(m.phone || "").replace(/\D/g, "");
  const rows = [
    m.phone && ["phone", t("Mobile"), N(m.phone), false],
    wa && wa.slice(-10) !== ph.slice(-10) && ["whatsapp", word("WhatsApp", lang), N("+" + wa), false],
    m.email && ["mail", t("Email"), m.email, true],
    ["globe", t("Website"), (m.website || OFFICE_SITE).replace(/^https?:\/\//, "").replace(/\/$/, ""), true],
    address && ["pin", t("Office"), N(address), false],
  ].filter(Boolean).slice(0, 5);
  const iconImgs = {}; for (const k of ["phone", "whatsapp", "mail", "globe", "pin"]) iconImgs[k] = await svgImg(icons[k], "#ffffff");
  let y = 236; const step = rows.length > 4 ? 64 : 72;
  for (const [k, label, value, latin] of rows) {
    const ix = X(L, 44);
    g.fillStyle = GREEN; g.beginPath(); g.arc(ix + 22, y + 22, 22, 0, Math.PI * 2); g.fill();
    if (iconImgs[k]) g.drawImage(iconImgs[k], ix + 11, y + 11, 22, 22);
    const vx = rtl ? W - L - 60 : L + 60, vw = areaW - 60;
    g.fillStyle = MUTED; g.font = `500 16px ${BODY}`; g.fillText(label, vx, y + 15);
    g.fillStyle = INK; fit(g, value, vw, 24, 600, latin ? LATIN : BODY);
    // phone numbers keep their left-to-right order on an Arabic card
    if (rtl && (k === "phone" || k === "whatsapp")) { g.direction = "ltr"; g.textAlign = "right"; g.fillText(clip(g, value, vw).replace(/[^\d\u0660-\u0669]/g, c => "\u200E" + c + "\u200E"), vx, y + 44); g.direction = "rtl"; }
    else g.fillText(clip(g, value, vw), vx, y + 44);
    y += step;
  }
  flagLine(H - 10, 10);
  return c;
}

export const canvasBlob = c => new Promise(r => c.toBlob(b => r(b), "image/png"));
