// Service Worker — Flota CMD
// Cache del shell de la app para instalación PWA + offline básico
const CACHE = 'flota-cmd-v5';
const ASSETS = [
  '/manifest.json',
  '/cmd-logo.png',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/favicon-32.png',
  '/favicon-16.png',
];

// Install: precachear assets estáticos
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

// Activate: limpiar caches viejas
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first para API, cache-first para assets estáticos
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // API: siempre network (datos dinámicos)
  if (url.pathname.startsWith('/api/')) {
    return; // no interceptar
  }

  // Assets estáticos: cache-first
  if (ASSETS.includes(url.pathname) || url.pathname.match(/\.(png|ico|css|js|woff2?)$/)) {
    e.respondWith(
      caches.match(e.request).then((cached) => {
        return cached || fetch(e.request).then((resp) => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE).then((cache) => cache.put(e.request, clone));
          }
          return resp;
        }).catch(() => cached);
      })
    );
    return;
  }

  // Navegación: SIEMPRE network-first (para que los cambios lleguen siempre)
  // Solo usa cache como fallback offline
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then((resp) => {
        // No cachear el HTML principal — siempre traer la versión más reciente
        return resp;
      }).catch(() => {
        // Offline: servir el index.html del cache como último recurso
        return caches.match('/').then((cached) => cached || caches.match('/index.html'));
      })
    );
  }
});
