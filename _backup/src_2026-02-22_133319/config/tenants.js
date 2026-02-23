// src/config/tenants.js
const TENANTS = {
  dcnet: {
    key: "dcnet",
    name: "DC NET",
    domains: ["dcinfinity.net.br", "www.dcinfinity.net.br"],
    defaultIntent: "greeting",
  },
  dcsolar: {
    key: "dcsolar",
    name: "DC Infinity Solar",
    domains: ["dcinfinitysolar.com.br", "www.dcinfinitysolar.com.br"],
    defaultIntent: "greeting",
  },
  rural: {
    key: "rural",
    name: "Internet Rural / Starlink",
    domains: ["rural.dcinfinity.net.br"],
    defaultIntent: "rural",
  },
};

function normalizeHost(host = "") {
  return host
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
}

function resolveTenantFromRequest(req) {
  // 1) Forçado pelo cliente (melhor forma)
  const forced =
    req.headers["x-tenant-id"] ||
    req.body?.tenant ||
    req.query?.tenant;

  if (forced && TENANTS[String(forced).toLowerCase()]) {
    return TENANTS[String(forced).toLowerCase()].key;
  }

  // 2) Por domínio/origin (web)
  const origin = req.headers.origin || req.headers.referer || "";
  const host = normalizeHost(origin);
  if (host) {
    for (const t of Object.values(TENANTS)) {
      if (t.domains?.some((d) => normalizeHost(d) === host)) return t.key;
    }
  }

  // 3) fallback
  return "dcnet";
}

module.exports = { TENANTS, resolveTenantFromRequest };
