const CACHE_NAME = 'finmate-pastel-v8';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './css/styles.css',
  './js/data.js',
  './js/app.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch(() => {});
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // Jangan cache endpoint API sinkronisasi data bersama
  if (event.request.url.includes('/api/')) return;

  event.respondWith(
    fetch(event.request, { cache: 'no-cache' })
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});

// ================= NOTIFIKASI POP-UP SISTEM & BACKGROUND REMINDER =================

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = (event.notification.data && event.notification.data.url) ? event.notification.data.url : './';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url && client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SHOW_NOTIFICATION') {
    const title = event.data.title || 'FinMate — Tracker Keuangan Bersama';
    const options = event.data.options || {};
    self.registration.showNotification(title, options);
  }
});

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'daily-financial-reminder') {
    event.waitUntil(
      self.registration.showNotification('FinMate Reminder', {
        body: 'Jangan lupa periksa kas dan catat pengeluaran bersama hari ini!',
        icon: './icon-192.png',
        badge: './icon-192.png',
        tag: 'finmate-daily-reminder',
        renotify: true,
        vibrate: [200, 100, 200],
        data: { url: './' }
      })
    );
  }
});
