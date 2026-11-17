// QR codes for visiting cards (QR code generator by Kazuhiko Arase, MIT licence, in src/vendor/qrcode)
import QRCode from "./vendor/qrcode/index.js";
import QRErrorCorrectLevel from "./vendor/qrcode/QRErrorCorrectLevel.js";

/** Draw a QR code for `text` into a size×size square at (x, y), white background and quiet zone included. */
export function drawQR(g, text, x, y, size, color = "#000") {
  const q = new QRCode(-1, QRErrorCorrectLevel.M); q.addData(text); q.make();
  const n = q.getModuleCount(), quiet = 3, cell = size / (n + quiet * 2);
  g.fillStyle = "#fff"; g.fillRect(x, y, size, size); g.fillStyle = color;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) {
    const px = x + (c + quiet) * cell, py = y + (r + quiet) * cell;
    g.fillRect(Math.floor(px), Math.floor(py), Math.ceil(cell + (px - Math.floor(px))), Math.ceil(cell + (py - Math.floor(py))));
  }
}
