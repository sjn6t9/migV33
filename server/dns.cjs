// Tiny authoritative DNS server for the agency's own domain (Node built-ins only).
//
// It answers for the zones in DNS_ZONES (default mamandmam.bd):
//   <zone>  and  www.<zone>  ->  A  DNS_IP
//   NS  -> DNS_NS (default ns1.migv33.tech, ns2.migv33.tech)
//   SOA -> first name server
// Every other question gets REFUSED, so it is not an open resolver.
//
// Env: DNS_IP (required), DNS_ZONES, DNS_NS, DNS_BIND (default DNS_IP), DNS_PORT (default 53)
"use strict";
const dgram = require("dgram");
const net = require("net");

const IP = (process.env.DNS_IP || "").trim();
if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(IP)) { console.error("DNS_IP must be an IPv4 address"); process.exit(1); }
const ZONES = (process.env.DNS_ZONES || "mamandmam.bd").toLowerCase().split(/[,\s]+/).filter(Boolean);
const NS = (process.env.DNS_NS || "ns1.migv33.tech,ns2.migv33.tech").toLowerCase().split(/[,\s]+/).filter(Boolean);
const BIND = process.env.DNS_BIND || IP;
const PORT = Number(process.env.DNS_PORT || 53);
const TTL = 300;
const SERIAL = Number(new Date().toISOString().slice(0, 10).replace(/-/g, "") + "01");

const T = { A: 1, NS: 2, SOA: 6, ANY: 255 };

function encName(name) {
  const parts = name.replace(/\.$/, "").split(".").filter(Boolean);
  const bufs = parts.map((p) => { const b = Buffer.from(p, "ascii"); return Buffer.concat([Buffer.from([b.length]), b]); });
  return Buffer.concat([...bufs, Buffer.from([0])]);
}
function u16(n) { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; }

// a resource record whose owner name is a pointer (offset into the message)
function rr(ptr, type, rdata, ttl = TTL) {
  return Buffer.concat([u16(0xc000 | ptr), u16(type), u16(1), u32(ttl), u16(rdata.length), rdata]);
}
function soaData(zone) {
  return Buffer.concat([encName(NS[0]), encName("hostmaster." + zone), u32(SERIAL), u32(3600), u32(600), u32(1209600), u32(TTL)]);
}
function aData(ip) { return Buffer.from(ip.split(".").map(Number)); }

function parseQuestion(msg) {
  if (msg.length < 12) return null;
  if (msg.readUInt16BE(4) !== 1) return null; // exactly one question
  let off = 12; const labels = [];
  while (true) {
    if (off >= msg.length) return null;
    const len = msg[off];
    if (len === 0) { off++; break; }
    if (len > 63 || off + 1 + len > msg.length) return null;
    labels.push(msg.toString("ascii", off + 1, off + 1 + len)); off += 1 + len;
  }
  if (off + 4 > msg.length) return null;
  return { name: labels.join(".").toLowerCase(), qtype: msg.readUInt16BE(off), qclass: msg.readUInt16BE(off + 2), end: off + 4 };
}

function answer(msg) {
  if (msg.length < 12) return null;
  const id = msg.readUInt16BE(0), flags = msg.readUInt16BE(2);
  if (flags & 0x8000) return null; // a response, ignore
  const opcode = (flags >> 11) & 0xf, rd = flags & 0x0100;
  const q = parseQuestion(msg);
  const header = (rcode, aa, an, ns) => Buffer.concat([u16(id), u16(0x8000 | (opcode << 11) | (aa ? 0x0400 : 0) | rd | rcode), u16(q ? 1 : 0), u16(an), u16(ns), u16(0)]);
  if (!q || opcode !== 0) return Buffer.concat([u16(id), u16(0x8000 | (opcode << 11) | rd | 4), u16(0), u16(0), u16(0), u16(0)]); // NOTIMP
  const question = msg.subarray(12, q.end);
  const zone = ZONES.find((z) => q.name === z || q.name.endsWith("." + z));
  if (!zone || (q.qclass !== 1 && q.qclass !== 255)) return Buffer.concat([header(5, false, 0, 0), question]); // REFUSED

  const QP = 12; // the question name starts at byte 12
  const isApex = q.name === zone, isWww = q.name === "www." + zone;
  const ans = [];
  if (isApex || isWww) {
    if (q.qtype === T.A || q.qtype === T.ANY) ans.push(rr(QP, T.A, aData(IP)));
  }
  if (isApex) {
    if (q.qtype === T.NS || q.qtype === T.ANY) NS.forEach((n) => ans.push(rr(QP, T.NS, encName(n))));
    if (q.qtype === T.SOA || q.qtype === T.ANY) ans.push(rr(QP, T.SOA, soaData(zone)));
  }
  if (ans.length) return Buffer.concat([header(0, true, ans.length, 0), question, ...ans]);
  // name exists but has no record of this type (NODATA), or the name does not exist (NXDOMAIN)
  const rcode = isApex || isWww ? 0 : 3;
  const zoneName = encName(zone);
  const soa = Buffer.concat([zoneName, u16(T.SOA), u16(1), u32(TTL), u16(soaData(zone).length), soaData(zone)]);
  return Buffer.concat([header(rcode, true, 0, 1), question, soa]);
}

const udp = dgram.createSocket({ type: "udp4", reuseAddr: true });
udp.on("message", (msg, r) => { try { const out = answer(msg); if (out) udp.send(out, r.port, r.address); } catch (e) { console.error("udp", e.message); } });
udp.on("error", (e) => { console.error("udp error", e.message); process.exit(1); });
udp.bind(PORT, BIND, () => console.log(`DNS (udp) on ${BIND}:${PORT} for ${ZONES.join(", ")} -> ${IP}`));

const tcp = net.createServer((sock) => {
  let buf = Buffer.alloc(0);
  sock.setTimeout(10000, () => sock.destroy());
  sock.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    if (buf.length > 4096) return sock.destroy();
    while (buf.length >= 2 && buf.length >= 2 + buf.readUInt16BE(0)) {
      const len = buf.readUInt16BE(0), msg = buf.subarray(2, 2 + len); buf = buf.subarray(2 + len);
      try { const out = answer(msg); if (out) sock.write(Buffer.concat([u16(out.length), out])); } catch (e) { sock.destroy(); }
    }
  });
  sock.on("error", () => {});
});
tcp.on("error", (e) => { console.error("tcp error", e.message); process.exit(1); });
tcp.listen(PORT, BIND, () => console.log(`DNS (tcp) on ${BIND}:${PORT}`));

module.exports = { answer };
