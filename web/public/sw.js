// Lets imgshrink work offline after the first visit. Network first, so updates arrive as soon
// as you're online; the cache is only a fallback. Nothing here sees your images: they never
// leave the page as requests.
const CACHE = "imgshrink-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// The page sends the addresses of the files it loaded (the page, its scripts, the worker, and
// the WebAssembly module), so they're cached even though they loaded before this ran.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "cache" || !Array.isArray(event.data.urls)) return;
  const urls = [...new Set(event.data.urls)].filter((url) => {
    if (typeof url !== "string") return false;
    const parsed = new URL(url);
    // Only real files from this site: in-memory blob: URLs (image previews) can't be fetched.
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.origin === self.location.origin;
  });
  // One at a time, so a single failure doesn't stop the rest from being cached.
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.allSettled(urls.map((url) => cache.add(url)))));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      } catch (error) {
        const cached = await cache.match(request, { ignoreSearch: true });
        if (cached) return cached;
        throw error;
      }
    })(),
  );
});
