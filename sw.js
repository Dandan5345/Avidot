const CACHE_NAME = "avidot-shell-v12";
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
    "./js/closedItems.js",
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

function isCacheableBasicResponse(response) {
    return response && response.status === 200 && response.type === "basic";
}

function shouldUseNetworkFirst(request, url) {
    if (request.mode === "navigate") return true;
    if (["document", "script", "style", "manifest"].includes(request.destination)) return true;
    return /\.(html|js|css|webmanifest)$/i.test(url.pathname);
}

async function networkFirst(request) {
    try {
        const networkResponse = await fetch(request, { cache: "reload" });
        if (isCacheableBasicResponse(networkResponse)) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    } catch (_) {
        const cachedResponse = await caches.match(request);
        if (cachedResponse) return cachedResponse;
        if (request.mode === "navigate") return caches.match("./index.html");
        throw _;
    }
}

async function cacheFirst(request) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) return cachedResponse;

    const networkResponse = await fetch(request);
    if (isCacheableBasicResponse(networkResponse)) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, networkResponse.clone());
    }
    return networkResponse;
}

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

    event.respondWith(shouldUseNetworkFirst(request, url) ? networkFirst(request) : cacheFirst(request));
});
