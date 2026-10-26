const BUILD_VERSION = "__BUILD_VERSION__";
const CACHE_NAME = `notas-drive-${BUILD_VERSION}`;
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./config.js",
  "./manifest.webmanifest",
  "./src/app.js",
  "./src/auth.js",
  "./src/db.js",
  "./src/drive-api.js",
  "./src/editor-format.js",
  "./src/favorites.js",
  "./src/markdown.js",
  "./src/ninjutsu-adjustments.js",
  "./src/ninjutsu-attendance.js",
  "./src/ninjutsu-roster-import.js",
  "./src/ninjutsu-roster-seed.js",
  "./src/ninjutsu.js",
  "./src/ninjutsu-planner.js",
  "./src/ninjutsu-program.js",
  "./src/path-utils.js",
  "./src/publisher.js",
  "./src/recipes.js",
  "./src/search.js",
  "./src/sync-engine.js",
  "./src/utils.js",
  "./buscyl/index.html",
  "./buscyl/css/styles.css",
  "./buscyl/js/app.js",
  "./buscyl/js/bulk-export.js",
  "./buscyl/js/data-loader.js",
  "./buscyl/data/concesiones.json.gz",
  "./buscyl/data/expediciones.manifest.json",
  "./buscyl/data/expediciones-20260918T112027056Z-00001.json.gz",
  "./buscyl/data/expediciones-20260918T112027056Z-00002.json.gz",
  "./buscyl/data/expediciones-20260918T112027056Z-00003.json.gz",
  "./buscyl/data/expediciones-20260918T112027056Z-00004.json.gz",
  "./buscyl/data/expediciones-20260918T112027056Z-00005.json.gz",
  "./buscyl/data/expediciones-20260918T112027056Z-00006.json.gz",
  "./buscyl/data/expediciones-20260918T112027056Z-00007.json.gz",
  "./buscyl/data/expediciones-20260918T112027056Z-00008.json.gz",
  "./buscyl/data/expediciones-20260918T112027056Z-00009.json.gz",
  "./buscyl/data/expediciones-20260918T112027056Z-00010.json.gz",
  "./buscyl/data/expediciones-20260918T112027056Z-00011.json.gz",
  "./buscyl/data/expediciones-20260918T112027056Z-00012.json.gz",
  "./buscyl/data/expediciones-20260918T112027056Z-00013.json.gz",
  "./buscyl/data/expediciones-20260918T112027056Z-00014.json.gz",
  "./buscyl/data/expediciones-20260918T112027056Z-00015.json.gz",
  "./buscyl/data/expediciones-20260918T112027056Z-00016.json.gz",
  "./buscyl/data/expediciones-20260918T112027056Z-00017.json.gz",
  "./buscyl/data/expediciones-20260918T112027056Z-00018.json.gz",
  "./buscyl/data/expediciones-20260918T112027056Z-00019.json.gz",
  "./buscyl/data/frontend-config.json.gz",
  "./buscyl/data/lineas.json.gz",
  "./buscyl/data/meta.json.gz",
  "./buscyl/data/municipios.json.gz",
  "./buscyl/data/paradas.json.gz",
  "./buscyl/data/rutas.json.gz",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // Sin pasar por la caché HTTP (max-age=600 en Pages) para no precachear la versión anterior.
      .then(cache => cache.addAll(APP_SHELL.map(url => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith("notas-drive-") && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(async () => (await caches.match(request)) || caches.match("./index.html"))
    );
    return;
  }

  const matchOptions = url.pathname.includes("/buscyl/data/") ? { ignoreSearch: true } : undefined;
  event.respondWith(
    caches.match(request, matchOptions).then(cached => {
      const network = fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

self.addEventListener("message", event => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
