self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));

// Tangkap sinyal reset jam 00:00 WIB dari aplikasi
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'NOTIF_RESET') {
    self.registration.showNotification('Tiket Harian Siap! 🎟️', {
      body: 'Sudah jam 00:00 WIB! 10 tiket baru sudah masuk, yuk gacha kartu SSR hari ini!',
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
