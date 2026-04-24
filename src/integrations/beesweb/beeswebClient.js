"use strict";

const { getBeeswebConfig } = require("../../config/beesweb");

function joinBasePath(baseUrl, path) {
  const b = String(baseUrl || "").replace(/\/$/, "");
  const p = String(path || "").replace(/^\//, "");
  return p ? `${b}/${p}` : b;
}

function buildUrlWithQuery(baseUrl, path, query) {
  const base = joinBasePath(baseUrl, path);
  if (!query || typeof query !== "object") return base;
  const u = new URL(base);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

function createBeeswebClient() {
  const cfg = getBeeswebConfig();

  if (!cfg.isComplete) {
    return {
      isConfigured: false,
      async request() {
        const err = new Error("beesweb_not_configured");
        err.code = "BEESWEB_NOT_CONFIGURED";
        throw err;
      },
    };
  }

  return {
    isConfigured: true,
    /**
     * @param {string} method
     * @param {string} path relativo à base (ex.: adm/customers)
     * @param {{ body?: unknown, headers?: Record<string, string>, query?: Record<string, string|number> }} [options]
     */
    async request(method, path, options = {}) {
      const url = buildUrlWithQuery(cfg.baseUrl, path, options.query || null);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
      const m = String(method || "GET").toUpperCase();
      const hasBody = options.body !== undefined && options.body !== null;

      const headers = {
        Accept: "application/json",
        Authorization: `Bearer ${cfg.token}`,
        ...(options.headers && typeof options.headers === "object" ? options.headers : {}),
      };
      if (hasBody) {
        headers["Content-Type"] = "application/json";
      }

      try {
        const res = await fetch(url, {
          method: m,
          signal: controller.signal,
          headers,
          body: hasBody ? JSON.stringify(options.body) : undefined,
        });

        const text = await res.text();
        let data = null;
        if (text) {
          try {
            data = JSON.parse(text);
          } catch {
            data = text;
          }
        }

        if (!res.ok) {
          const err = new Error(`beesweb_http_${res.status}`);
          err.code = "BEESWEB_HTTP_ERROR";
          err.status = res.status;
          throw err;
        }

        return data;
      } catch (e) {
        if (e && e.name === "AbortError") {
          const err = new Error("beesweb_timeout");
          err.code = "BEESWEB_TIMEOUT";
          throw err;
        }
        console.error("[beesweb] request_failed", {
          method: m,
          path: String(path || ""),
          code: e.code || e.message,
          status: e.status,
        });
        throw e;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

module.exports = { createBeeswebClient, joinBasePath, buildUrlWithQuery };
