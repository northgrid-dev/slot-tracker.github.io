/* Manifest version: G0Hyfe4N */
self.importScripts('./service-worker-assets.js');

const cacheNamePrefix = 'slottracker-cache-';
const cacheName = `${cacheNamePrefix}${self.assetsManifest.version}`;
const offlineAssetsInclude = [/\.dll$/, /\.pdb$/, /\.wasm$/, /\.html$/, /\.js$/, /\.json$/, /\.css$/, /\.png$/, /\.ico$/, /\.dat$/, /\.blat$/];
const offlineAssetsExclude = [/^service-worker\.js$/];

self.addEventListener('install', event => event.waitUntil(onInstall()));
self.addEventListener('activate', event => event.waitUntil(onActivate()));
self.addEventListener('fetch', event => event.respondWith(onFetch(event)));

async function onInstall() {
    const assetsRequests = self.assetsManifest.assets
        .filter(asset => offlineAssetsInclude.some(pattern => pattern.test(asset.url)))
        .filter(asset => !offlineAssetsExclude.some(pattern => pattern.test(asset.url)))
        .map(asset => new Request(asset.url, { integrity: asset.hash, cache: 'no-cache' }));
    const cache = await caches.open(cacheName);
    await cache.addAll(assetsRequests);
}

async function onActivate() {
    const cacheKeys = await caches.keys();
    await Promise.all(cacheKeys.filter(key => key.startsWith(cacheNamePrefix) && key !== cacheName).map(key => caches.delete(key)));
    await self.clients.claim();
}

async function onFetch(event) {
    if (event.request.method !== 'GET') return fetch(event.request);
    const isNavigation = event.request.mode === 'navigate';
    const request = isNavigation ? 'index.html' : event.request;
    const cache = await caches.open(cacheName);
    const cachedResponse = await cache.match(request);
    return cachedResponse || fetch(event.request);
}
