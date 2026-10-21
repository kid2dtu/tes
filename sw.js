self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));

// Penanganan Cache Offline PWA
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => response || fetch(event.request))
  );
});

// Pemicu Notifikasi Global
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'NOTIF_RESET') {
    const title = event.data.title || 'Tiket Harian Siap! 🎟️';
    const body = event.data.body || '10 Tiket gacha kamu sudah berhasil diisi ulang! Yuk gacha sekarang!';
    
    self.registration.showNotification(title, {
      body: body,
      icon: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png',
      badge: 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png',
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
