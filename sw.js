const CACHE_NAME = "avidot-shell-v1";
const APP_SHELL = [
    "./",
    "./index.html",
    "./manifest.webmanifest",
    "./css/styles.css",
    "./js/app.js",
    "./js/activityLog.js",
    "./js/activityLogsPage.js",
    "./js/auth.js",
    "./js/awaitingInfo.js",
    "./js/firebase.js",
    "./js/firestoreStore.js",
    "./js/home.js",
    "./js/imgbb.js",
    "./js/itemsCommon.js",
    "./js/lostItems.js",
    "./js/managerActions.js",
    "./js/pendingPickup.js",
    "./js/users.js",
    "./js/utils.js",
    "./icons/app-icon.svg"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
    );
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(
            keys
                .filter((key) => key !== CACHE_NAME)
                .map((key) => caches.delete(key))
        )).then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    const { request } = event;
    if (request.method !== "GET") return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    if (request.mode === "navigate") {
        event.respondWith(
            fetch(request).catch(() => caches.match("./index.html"))
        );
        return;
    }

    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            if (cachedResponse) return cachedResponse;

            return fetch(request).then((networkResponse) => {
                if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== "basic") {
                    return networkResponse;
                }

                const copy = networkResponse.clone();
                void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                return networkResponse;
            });
        })
    );
});