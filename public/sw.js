/* Service worker: call notifications (also when Migv33 is closed, via Web Push). No caching. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

const mainWin = l => l.find(x => !x.url.includes('?w=') && !x.url.includes('&w='));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch {}
  const kind = d.kind === 'video' ? 'video' : 'audio';
  if (d.t === 'call') {
    e.waitUntil(self.registration.showNotification((d.from || 'Someone') + ' is calling', {
      body: `Incoming ${kind} call on Migv33`, tag: 'migv33-call', renotify: true, requireInteraction: true,
      vibrate: [500, 250, 500, 250, 500, 250, 500], icon: '/Logo.PNG', badge: '/Logo.PNG',
      data: { id: d.id, key: d.key, kind, from: d.from },
      actions: [{ action: 'accept', title: '📞 Answer' }, { action: 'decline', title: '✖ Decline' }],
    }));
  } else if (d.t === 'call_end') {
    e.waitUntil((async () => {
      (await self.registration.getNotifications({ tag: 'migv33-call' })).forEach(n => n.close());
      if (d.answered) {   // answered in the app: just stop the ringing notification
        const l = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        if (l.some(c => c.visibilityState === 'visible')) return;
        await self.registration.showNotification('Call in progress', { body: `On a call with ${d.from || 'someone'}`, tag: 'migv33-missed', icon: '/Logo.PNG', silent: true });
        setTimeout(() => self.registration.getNotifications({ tag: 'migv33-missed' }).then(x => x.forEach(n => n.close())), 3000);
        return;
      }
      // a push must always show something; a missed call is worth showing anyway
      await self.registration.showNotification(d.missed ? `Missed ${kind} call` : 'Call ended', {
        body: d.missed ? `${d.from || 'Someone'} called you on Migv33` : `Call with ${d.from || 'someone'} ended`,
        tag: 'migv33-missed', icon: '/Logo.PNG', badge: '/Logo.PNG', data: { from: d.from },
      });
      if (!d.missed) setTimeout(() => self.registration.getNotifications({ tag: 'migv33-missed' }).then(l => l.forEach(n => n.close())), 4000);
    })());
  } else if (d.title) {
    e.waitUntil(self.registration.showNotification(d.title, { body: d.body || '', tag: d.tag || 'migv33', icon: '/Logo.PNG' }));
  }
});

self.addEventListener('notificationclick', e => {
  const n = e.notification, d = n.data || {};
  n.close();
  if (e.action === 'decline' && d.id) {
    e.waitUntil(d.key
      ? fetch('/api/call/decline', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: d.id, key: d.key }) }).catch(() => {})
      : self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(l => l.forEach(c => c.postMessage({ t: 'calldec', id: d.id }))));
    return;
  }
  const ans = d.id && e.action === 'accept' ? d.id : '';   // "Answer" opens the app and answers; tapping the notification opens the app on the ringing call
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(l => {
    const c = mainWin(l);
    if (c) { if (ans) c.postMessage({ t: 'callans', id: ans }); return c.focus(); }
    return self.clients.openWindow(ans ? '/?ans=' + encodeURIComponent(ans) : '/');
  }));
});
