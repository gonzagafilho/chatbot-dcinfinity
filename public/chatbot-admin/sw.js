/* PWA: cache mínimo versionado; /api e não-GET passam direto */
"use strict";

const CACHE = "dcnet-chatbot-admin-v210-20260707-v210-pwa-otimizado";
const VERSION = "20260707-v210-pwa-otimizado";
const PRECACHE = [
  "/chatbot-admin/",
  "/chatbot-admin/index.html",
  "/chatbot-admin/manifest.webmanifest?v=20260707-v210-pwa-otimizado",
  "/chatbot-admin/icons/favicon.png?v=20260707-v210-pwa-otimizado",
  "/chatbot-admin/icons/icon-192.png?v=20260707-v210-pwa-otimizado",
  "/chatbot-admin/icons/icon-512.png?v=20260707-v210-pwa-otimizado",
  "/chatbot-admin/icons/apple-touch-icon.png?v=20260707-v210-pwa-otimizado"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return Promise.all(
        PRECACHE.map(function (path) {
          return cache.add(new Request(path, { cache: "reload" })).catch(function (err) {
            console.warn("[chatbot-admin/sw] precache", path, err);
          });
        })
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (names) {
        return Promise.all(names.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

function sameOrigin(href) {
  try { return new URL(href, self.location.href).origin === self.location.origin; }
  catch (e) { return false; }
}

function putInCache(req, res) {
  if (!res || res.status !== 200 || res.type === "opaque") return res;
  var copy = res.clone();
  caches.open(CACHE).then(function (cache) { return cache.put(req, copy); }).catch(function () {});
  return res;
}

function networkFirst(req, fallbackKey) {
  return fetch(req, { cache: "no-store" })
    .then(function (res) { return putInCache(req, res); })
    .catch(function () { return caches.match(req, { ignoreSearch: false }).then(function (cached) { return cached || caches.match(fallbackKey || req, { ignoreSearch: true }); }); });
}

function cacheFirst(req) {
  return caches.match(req, { ignoreSearch: false }).then(function (cached) {
    return cached || fetch(req).then(function (res) { return putInCache(req, res); });
  });
}

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET" || !sameOrigin(req.url)) return;
  var url = new URL(req.url);
  var p = url.pathname;

  if (p.indexOf("/api/") === 0) {
    event.respondWith(fetch(req));
    return;
  }
  if (p !== "/chatbot-admin" && p.indexOf("/chatbot-admin/") !== 0) return;

  var isIndex = p === "/chatbot-admin" || p === "/chatbot-admin/" || p === "/chatbot-admin/index.html";
  var isCssOrJs = p === "/chatbot-admin/styles.css" || p === "/chatbot-admin/panel.js";
  var isManifest = p === "/chatbot-admin/manifest.webmanifest";
  var isIcon = p.indexOf("/chatbot-admin/icons/") === 0;

  if (isIndex) {
    event.respondWith(networkFirst(req, "/chatbot-admin/index.html"));
    return;
  }
  if (isCssOrJs || isManifest) {
    event.respondWith(networkFirst(req));
    return;
  }
  if (isIcon) {
    event.respondWith(cacheFirst(req));
  }
});
