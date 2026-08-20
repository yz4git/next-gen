const CACHE = "worldseed-shell-v0.8.1";
const CACHE_PREFIXES = ["worldseed-shell-", "worldseed-sites-"];
const SHELL = ["./index.html", "./manifest.webmanifest", "./worldseed-mark.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key !== CACHE && CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)))
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  // Never persist latitude/longitude query strings as CacheStorage keys.
  const cacheKey = request.mode === "navigate"
    ? new Request(new URL("./index.html", self.location.href))
    : request;
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(cacheKey, copy));
        return response;
      })
      .catch(() => caches.match(cacheKey).then((cached) => cached ?? caches.match("./index.html"))),
  );
});
