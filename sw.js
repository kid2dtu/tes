self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));

// Event Fetch (Syarat wajib Chrome agar PWA bisa diinstall ke HP)
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => response || fetch(event.request))
  );
});

// Pemicu Notifikasi Reset Tiket
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'NOTIF_RESET') {
    self.registration.showNotification('Tiket Harian Siap! 🎟️', {
      body: '10 Tiket gacha kamu sudah siap! Yuk tarik kartu SSR sekarang!',
      icon: 'https://nekos.best/logo.png',
      badge: 'https://nekos.best/logo.png',
      vibrate: [200, 100, 200]
    });
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      if (clientList.length > 0) return clientList[0].focus();
      return clients.openWindow('/');
    })
  );
});
