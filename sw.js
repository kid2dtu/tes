const CACHE_NAME = 'animegacha-v4';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/config.js',
  '/manifest.json',
  '/icon.png'
];

// 1. Install & Force Update
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
});

// 2. Bersihkan Cache Versi Lama Otomatis
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// 3. Strategi Network-First untuk File Web (Biar Update Selalu Masuk)
self.addEventListener('fetch', (e) => {
  const url = e.request.url;

  // Lewatkan request API eksternal
  if (url.includes('script.google.com') || url.includes('anilist.co') || url.includes('wsrv.nl')) {
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then((networkRes) => {
        // Jika online, simpan versi terbaru ke cache
        if (networkRes && networkRes.status === 200 && e.request.method === 'GET') {
          const resClone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, resClone));
        }
        return networkRes;
      })
      .catch(() => caches.match(e.request)) // Cadangan saat offline
  );
});

// 4. Delegasi Penampil Notifikasi di Level Service Worker
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'TRIGGER_NOTIFICATION') {
    const { title, options } = e.data;
    self.registration.showNotification(title, {
      ...options,
      icon: '/icon.png',
      badge: '/icon.png'
    });
  }
});

// 5. Dukungan Push Event (Web Push API saat aplikasi ditutup)
self.addEventListener('push', (e) => {
  let data = { title: 'AnimeGacha', message: 'Ada update terbaru untukmu! 🎟️' };
  try {
    if (e.data) {
      data = e.data.json();
    }
  } catch (err) {
    if (e.data) {
      data.message = e.data.text();
    }
  }

  const title = data.title || 'AnimeGacha';
  const options = {
    body: data.message || data.body || 'Buka aplikasi untuk melihat update.',
    icon: '/icon.png',
    badge: '/icon.png',
    vibrate: [200, 100, 200],
    data: data.url || '/'
  };

  e.waitUntil(self.registration.showNotification(title, options));
});

// 6. Dukungan Periodic Background Sync (Eksperimental di Chromium jika didukung OS)
self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'check-gacha-updates') {
    e.waitUntil(
      fetch('https://script.google.com/macros/s/AKfycbz3LraveIpKMeajlIpnf5KcG4vGffBtdkY9LtFucyhwbTUVEWPKWLW8vDlwdVbmJ0REMg/exec?action=check_notifications')
        .then((res) => res.json())
        .then((data) => {
          if (data && data.status === 'success' && data.announcement) {
            return self.registration.showNotification(data.announcement.title, {
              body: data.announcement.message,
              icon: '/icon.png',
              badge: '/icon.png'
            });
          }
        })
        .catch(() => {})
    );
  }
});

// 7. Klik Notifikasi Membuka Web PWA
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      if (clientList.length > 0) return clientList[0].focus();
      return clients.openWindow('/');
    })
  );
});
