// Visiting cards for team members: front (person) and back (agency), drawn on a canvas at
// print size 3.5 × 2 inches, 300 dpi (1050 × 600 px). Text is in the chosen language;
// names, numbers and addresses stay as written.
import { translatorFor, LANGS } from "./i18n.js";

const W = 1050, H = 600;
const GREEN = "#006a4e", DEEP = "#004d38", RED = "#d01c32", INK = "#14231d", MUTED = "#5b6b64";
const DISPLAY = "Inter, 'Anek Bangla', 'Noto Kufi Arabic', Hind, Arial, sans-serif";
const BODY = "Inter, 'Noto Sans Bengali', 'Noto Kufi Arabic', Hind, Arial, sans-serif";

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
export async function drawVisitingCard(m, { lang = "en", side = "front", settings = {}, site = location.host, icons = {} } = {}) {
  const t = await translatorFor(lang); const rtl = !!LANGS.find(l => l.code === lang)?.rtl;
  await fontsReady();
  const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
  g.direction = rtl ? "rtl" : "ltr";
  // text in Latin letters only (names, numbers, the company name) is laid out left-to-right even on an Arabic card
  const _fill = g.fillText.bind(g);
  g.fillText = (str, x, y) => { if (rtl && /^[\x20-\x7E…]+$/.test(String(str))) { const d = g.direction; g.direction = "ltr"; _fill(str, x, y); g.direction = d; } else _fill(str, x, y); };
  const X = (x, w = 0) => (rtl ? W - x - w : x); // mirror for right-to-left
  const logo = await loadImg("/brand/logo-320.webp");

  if (side === "back") {
    const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, GREEN); bg.addColorStop(1, DEEP); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.globalAlpha = .07; g.fillStyle = "#fff"; g.beginPath(); g.arc(W - 90, 60, 230, 0, Math.PI * 2); g.fill(); g.beginPath(); g.arc(80, H - 40, 170, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
    rr(g, W / 2 - 100, 58, 200, 200, 34); g.fillStyle = "#fff"; g.fill(); if (logo) g.drawImage(logo, W / 2 - 88, 70, 176, 176);
    g.textAlign = "center"; g.fillStyle = "#fff";
    fit(g, "MAM & MAM OVERSEAS LTD.", W - 120, 50, 800, DISPLAY); g.fillText("MAM & MAM OVERSEAS LTD.", W / 2, 322);
    fit(g, t("Government licensed recruiting agency"), W - 160, 28, 500, BODY); g.globalAlpha = .92; g.fillText(t("Government licensed recruiting agency"), W / 2, 368); g.globalAlpha = 1;
    rr(g, W / 2 - 150, 392, 300, 50, 25); g.fillStyle = RED; g.fill();
    g.fillStyle = "#fff"; fit(g, t("Recruiting Licence RL 1217"), 280, 24, 700, BODY); g.fillText(t("Recruiting Licence RL 1217"), W / 2, 425);
    g.font = `600 26px ${BODY}`; g.fillText(site, W / 2, 498);
    if (settings.address) { g.font = `500 21px ${BODY}`; g.globalAlpha = .85; g.fillText(clip(g, settings.address, W - 160), W / 2, 538); g.globalAlpha = 1; }
    g.fillStyle = RED; g.fillRect(0, H - 12, W, 12);
    return c;
  }

  // front: agency band on one side, the person on the other
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
  const BW = 330; const bx = X(0, BW);
  const bg = g.createLinearGradient(bx, 0, bx + BW, H); bg.addColorStop(0, GREEN); bg.addColorStop(1, DEEP); g.fillStyle = bg; g.fillRect(bx, 0, BW, H);
  g.fillStyle = RED; g.fillRect(rtl ? bx : BW - 8, 0, 8, H);
  const cx = bx + BW / 2;
  rr(g, cx - 92, 70, 184, 184, 30); g.fillStyle = "#fff"; g.fill(); if (logo) g.drawImage(logo, cx - 82, 80, 164, 164);
  g.textAlign = "center"; g.fillStyle = "#fff";
  fit(g, "MAM & MAM", BW - 50, 40, 800, DISPLAY); g.fillText("MAM & MAM", cx, 312);
  fit(g, "OVERSEAS LTD.", BW - 50, 30, 700, DISPLAY); g.fillText("OVERSEAS LTD.", cx, 350);
  g.globalAlpha = .9; fit(g, t("Government licensed recruiting agency"), BW - 50, 19, 500, BODY);
  const tag = t("Government licensed recruiting agency"); g.fillText(clip(g, tag, BW - 40), cx, 400); g.globalAlpha = 1;
  g.font = `700 22px ${BODY}`; g.fillText("RL 1217", cx, 438);
  g.font = `500 19px ${BODY}`; g.globalAlpha = .85; g.fillText(clip(g, site, BW - 40), cx, 540); g.globalAlpha = 1;

  // person
  const L = BW + 52, R = W - 48, areaW = R - L;
  const photo = m.photo?.data ? await loadImg(m.photo.data) : null;
  const PH = 132; let textW = areaW;
  if (photo) {
    const px = X(R - PH, PH), py = 48; textW = areaW - PH - 24;
    g.save(); g.beginPath(); g.arc(px + PH / 2, py + PH / 2, PH / 2, 0, Math.PI * 2); g.clip();
    const s = Math.max(PH / photo.width, PH / photo.height), dw = photo.width * s, dh = photo.height * s;
    g.drawImage(photo, px + (PH - dw) / 2, py + (PH - dh) * 0.15, dw, dh); g.restore();
    g.lineWidth = 5; g.strokeStyle = GREEN; g.beginPath(); g.arc(px + PH / 2, py + PH / 2, PH / 2 - 2, 0, Math.PI * 2); g.stroke();
  }
  g.textAlign = rtl ? "right" : "left"; const tx = rtl ? W - L : L;
  g.fillStyle = INK; fit(g, m.name || "", textW, 46, 800, DISPLAY); g.fillText(clip(g, m.name || "", textW), tx, 108);
  g.fillStyle = GREEN; fit(g, t(m.title || ""), textW, 28, 700, BODY); g.fillText(clip(g, t(m.title || ""), textW), tx, 150);
  if (m.dept) { g.fillStyle = MUTED; fit(g, t(m.dept), textW, 21, 500, BODY); g.fillText(clip(g, t(m.dept), textW), tx, 184); }
  g.fillStyle = RED; g.fillRect(X(L, 70), 206, 70, 6);

  const wa = String(m.whatsapp || "").replace(/\D/g, ""), ph = String(m.phone || "").replace(/\D/g, "");
  const rows = [
    m.phone && ["phone", t("Mobile"), m.phone],
    wa && wa.slice(-10) !== ph.slice(-10) && ["whatsapp", "WhatsApp", "+" + wa],
    m.email && ["mail", t("Email"), m.email],
    ["globe", t("Website"), (m.website || site).replace(/^https?:\/\//, "").replace(/\/$/, "")],
    settings.address && ["pin", t("Office"), settings.address],
  ].filter(Boolean).slice(0, 5);
  const iconImgs = {}; for (const k of ["phone", "whatsapp", "mail", "globe", "pin"]) iconImgs[k] = await svgImg(icons[k], "#ffffff");
  let y = 252; const step = rows.length > 4 ? 64 : 72;
  for (const [k, label, value] of rows) {
    const ix = X(L, 44);
    g.fillStyle = k === "whatsapp" ? "#1a9e52" : GREEN; g.beginPath(); g.arc(ix + 22, y + 22, 22, 0, Math.PI * 2); g.fill();
    if (iconImgs[k]) g.drawImage(iconImgs[k], ix + 11, y + 11, 22, 22);
    const vx = rtl ? W - L - 60 : L + 60, vw = areaW - 60;
    g.fillStyle = MUTED; g.font = `600 17px ${BODY}`; g.fillText(label, vx, y + 15);
    g.fillStyle = INK; fit(g, value, vw, 25, 600, k === "phone" || k === "whatsapp" ? "Inter, Arial, sans-serif" : BODY);
    g.fillText(clip(g, value, vw), vx, y + 44);
    y += step;
  }
  g.fillStyle = GREEN; g.fillRect(rtl ? 0 : BW, H - 10, W - BW, 10);
  return c;
}

export const canvasBlob = c => new Promise(r => c.toBlob(b => r(b), "image/png"));
