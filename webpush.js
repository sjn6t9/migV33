// Web Push (no extra packages): VAPID signing (RFC 8292) + aes128gcm payload encryption (RFC 8291).
// Lets the server ring a user's phone/computer for an incoming call even when Migv33 is closed.
// The VAPID key pair is created once and kept in the database, so nothing needs to be set in .env.
import crypto from 'crypto';
import https from 'https';

const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

export function createPush(db, { subject = 'mailto:support@migv33.com' } = {}) {
  db.exec(`create table if not exists push_keys(id integer primary key check(id=1), jwk text);
create table if not exists push_subs(endpoint text primary key, user text, p256dh text, auth text, ts int);
create index if not exists push_subs_user on push_subs(user)`);

  let row = db.prepare('select jwk from push_keys where id=1').get();
  if (!row) {
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    db.prepare('insert into push_keys(id,jwk) values(1,?)').run(JSON.stringify(privateKey.export({ format: 'jwk' })));
    row = db.prepare('select jwk from push_keys where id=1').get();
  }
  const jwk = JSON.parse(row.jwk);
  const priv = crypto.createPrivateKey({ key: jwk, format: 'jwk' });
  const publicKey = b64u(Buffer.concat([Buffer.from([4]), unb64u(jwk.x), unb64u(jwk.y)]));   // what browsers need as applicationServerKey

  const jwtCache = new Map();
  function vapid(endpoint) {
    const aud = new URL(endpoint).origin, now = Math.floor(Date.now() / 1000), c = jwtCache.get(aud);
    if (c && c.exp - now > 3600) return c.t;
    const exp = now + 12 * 3600;
    const data = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' })) + '.' + b64u(JSON.stringify({ aud, exp, sub: subject }));
    const sig = crypto.sign('sha256', Buffer.from(data), { key: priv, dsaEncoding: 'ieee-p1363' });
    const t = data + '.' + b64u(sig);
    jwtCache.set(aud, { t, exp });
    return t;
  }

  function encrypt(sub, payload) {
    const uaPub = unb64u(sub.p256dh), authSecret = unb64u(sub.auth);
    const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
    const asPub = ecdh.getPublicKey(), shared = ecdh.computeSecret(uaPub), salt = crypto.randomBytes(16);
    const prkKey = hmac(authSecret, shared);
    const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub, Buffer.from([1])])).subarray(0, 32);
    const prk = hmac(salt, ikm);
    const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
    const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
    const ci = crypto.createCipheriv('aes-128-gcm', cek, nonce);
    const ct = Buffer.concat([ci.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), ci.final(), ci.getAuthTag()]);
    const head = Buffer.alloc(21); salt.copy(head, 0); head.writeUInt32BE(4096, 16); head[20] = asPub.length;
    return Buffer.concat([head, asPub, ct]);
  }

  async function sendOne(sub, data, { ttl = 60, urgency = 'high', topic } = {}) {
    try {
      const headers = { 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'aes128gcm', TTL: String(ttl), Urgency: urgency,
        Authorization: `vapid t=${vapid(sub.endpoint)}, k=${publicKey}` };
      if (topic) headers.Topic = topic;
      const body = encrypt(sub, JSON.stringify(data));
      headers['Content-Length'] = String(body.length);
      // plain https (works on every Node version, no fetch needed)
      const r = await new Promise((res, rej) => {
        const rq = https.request(sub.endpoint, { method: 'POST', headers, timeout: 15000 }, rs => { let t = ''; rs.on('data', c => { if (t.length < 500) t += c; }); rs.on('end', () => res({ status: rs.statusCode, text: t })); });
        rq.on('timeout', () => rq.destroy(new Error('timeout'))); rq.on('error', rej); rq.end(body);
      });
      if (r.status === 404 || r.status === 410) db.prepare('delete from push_subs where endpoint=?').run(sub.endpoint);   // subscription expired
      if (r.status >= 300) console.log('[push]', r.status, r.text.slice(0, 200));
      return { ok: r.status < 300, status: r.status, err: r.status < 300 ? '' : r.text.slice(0, 120) };
    } catch (e) { console.log('[push]', e.message); return { ok: false, status: 0, err: e.message }; }
  }

  return {
    publicKey,
    save(user, s) {
      const ep = String(s?.endpoint || ''), p = String(s?.keys?.p256dh || ''), a = String(s?.keys?.auth || '');
      if (!/^https:\/\//.test(ep) || ep.length > 1000 || !p || !a || p.length > 200 || a.length > 100) return false;
      db.prepare('insert or replace into push_subs(endpoint,user,p256dh,auth,ts) values(?,?,?,?,?)').run(ep, user, p, a, Date.now());
      db.prepare('delete from push_subs where user=? and endpoint not in (select endpoint from push_subs where user=? order by ts desc limit 6)').run(user, user);
      return true;
    },
    drop(user, endpoint) { endpoint ? db.prepare('delete from push_subs where user=? and endpoint=?').run(user, String(endpoint)) : db.prepare('delete from push_subs where user=?').run(user); },
    has: user => !!db.prepare('select 1 from push_subs where user=?').get(user),
    send(user, data, opt) { return Promise.all(db.prepare('select * from push_subs where user=?').all(user).map(s => sendOne(s, data, opt))); },
  };
}
