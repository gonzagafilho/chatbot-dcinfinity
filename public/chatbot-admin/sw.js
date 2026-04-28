/* PWA: cache mínimo do painel; /api e não-GET passam direto */
"use strict";

const CACHE = "dcnet-chatbot-admin-v4";
const PRECACHE = [
  "/chatbot-admin/",
  "/chatbot-admin/index.html",
  "/chatbot-admin/styles.css",
  "/chatbot-admin/panel.js",
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
    caches
      .keys()
      .then(function (names) {
        return Promise.all(
          names
            .filter(function (k) {
              return k !== CACHE;
            })
            .map(function (k) {
              return caches.delete(k);
            })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

function sameOrigin(href) {
  try {
    return new URL(href, self.location.href).origin === self.location.origin;
  } catch (e) {
    return false;
  }
}

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") {
    return;
  }
  if (!sameOrigin(req.url)) {
    return;
  }
  var url = new URL(req.url);
  var p = url.pathname;

  if (p.indexOf("/api/") === 0) {
    event.respondWith(fetch(req));
    return;
  }
  if (p !== "/chatbot-admin" && p.indexOf("/chatbot-admin/") !== 0) {
    return;
  }
  var isCssOrJs = p === "/chatbot-admin/styles.css" || p === "/chatbot-admin/panel.js";
  var isPanelIndex =
    p === "/chatbot-admin" || p === "/chatbot-admin/" || p === "/chatbot-admin/index.html";

  if (isPanelIndex) {
    event.respondWith(
      fetch(req)
        .then(function (res) {
          if (res && res.status === 200) {
            var c = res.clone();
            caches.open(CACHE).then(function (cache) {
              return cache.put("/chatbot-admin/index.html", c);
            });
          }
          return res;
        })
        .catch(function () {
          return caches.match("/chatbot-admin/index.html");
        })
    );
    return;
  }

  if (isCssOrJs) {
    event.respondWith(
      caches.match(req, { ignoreSearch: false }).then(function (cached) {
        if (cached) {
          fetch(req)
            .then(function (r) {
              if (r && r.status === 200) {
                return caches.open(CACHE).then(function (cache) {
                  return cache.put(req, r);
                });
              }
            })
            .catch(function () {});
          return cached;
        }
        return fetch(req).then(function (r) {
          if (r && r.status === 200) {
            var copy = r.clone();
            caches.open(CACHE).then(function (cache) {
              return cache.put(req, copy);
            });
          }
          return r;
        });
      })
    );
    return;
  }
});
