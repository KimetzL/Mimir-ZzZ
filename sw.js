const CACHE_NAME = 'mimir-cache-v4';

// Recursos estáticos básicos que siempre deben estar disponibles offline
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/css/styles.css',
    '/js/app.js',
    '/js/audio-engine.js',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/audio/White-noise.mp3',
    '/audio/Marron.mp3',
    '/audio/Green-noise.mp3',
    '/audio/Lluvia.mp3',
    '/audio/Pink-noise.mp3',
    '/audio/Waves.mp3',
    '/audio/Fire-crackling.mp3',
    '/audio/Lofi.mp3',
    '/audio/Coffee-shop.mp3',
    '/audio/Fan.mp3',
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

    // Solo evitamos el cache si la petición tiene cabecera 'range' (usada por <audio> en iOS/Safari).
    // Como usamos standard fetch y Web Audio API, no requerimos Range.
    if (event.request.headers.has('range')) {
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
