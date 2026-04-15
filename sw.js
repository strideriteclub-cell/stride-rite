const CACHE_NAME = 'stride-rite-v1';
const CACHE_URLS = [
    '/',
    '/index.html',
    '/dashboard.html',
    '/survey.html',
    '/styles.css',
    '/app.js',
    '/icon.svg',
    '/manifest.json'
];

// Install — cache key assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(CACHE_URLS)).then(() => self.skipWaiting())
    );
});

// Activate — clean up old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

// Fetch — network first, fall back to cache
self.addEventListener('fetch', event => {
    // Skip non-GET and Supabase/Telegram API calls
    if (event.request.method !== 'GET') return;
    if (event.request.url.includes('supabase.co') || event.request.url.includes('telegram.org') || event.request.url.includes('emailjs.com')) return;

    event.respondWith(
        fetch(event.request)
            .then(response => {
                const clone = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});
