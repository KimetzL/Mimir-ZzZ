const CACHE_NAME = 'mimir-cache-v1';

// Recursos estáticos básicos que siempre deben estar disponibles offline
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/css/styles.css',
    '/js/app.js',
    '/js/audio-engine.js',
    '/js/noise-generator.js',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600&display=swap'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Cache opened');
                return cache.addAll(STATIC_ASSETS);
            })
    );
    self.skipWaiting(); // Activar el worker inmediatamente
});

self.addEventListener('activate', event => {
    // Limpiar caches antiguos si cambiamos la versión
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    return self.clients.claim();
});

// Estrategia Stale-While-Revalidate para archivos estáticos
self.addEventListener('fetch', event => {
    // Solo manejamos peticiones GET
    if (event.request.method !== 'GET') return;

    // Archivos de audio (futuro soporte) necesitan manejar Range Requests para Safari/iOS
    if (event.request.headers.has('range') || event.request.url.endsWith('.mp3')) {
        // Para simplificar la implementación actual sin librerías externas (Workbox),
        // dejamos que la red maneje los Range requests para evitar fallos de audio en iOS.
        // Cuando se añadan los MP3 reales, se recomienda usar Workbox RangeRequestsPlugin.
        return; 
    }

    event.respondWith(
        caches.match(event.request)
            .then(cachedResponse => {
                const fetchPromise = fetch(event.request).then(networkResponse => {
                    // Actualizar el cache de forma asíncrona
                    if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                        const responseToCache = networkResponse.clone();
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(event.request, responseToCache);
                        });
                    }
                    return networkResponse;
                }).catch(() => {
                    // Offline fallback (ya manejado por el cachedResponse si existe)
                });

                // Devolver del cache si existe, o esperar a la red
                return cachedResponse || fetchPromise;
            })
    );
});
