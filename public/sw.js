/* Service worker: only used to show "incoming call" notifications with the device's notification sound. No caching. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(l => {
    const c = l.find(x => !x.url.includes('?w='));
    return c ? c.focus() : self.clients.openWindow('/');
  }));
});
