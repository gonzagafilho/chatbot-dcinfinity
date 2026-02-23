function tenantMiddleware(req, res, next) {
  // prioridade: header explícito
  let tenant = (req.headers["x-tenant-id"] || "").toString().trim().toLowerCase();

  // fallback: origin/host
  if (!tenant) {
    const origin = (req.headers.origin || "").toString().toLowerCase();
    const host = (req.headers.host || "").toString().toLowerCase();

    const hostFromOrigin = origin
      ? origin.replace(/^https?:\/\//, "").split("/")[0]
      : "";

    const mapHostToTenant = {
      "dcinfinity.net.br": "dcnet",
      "www.dcinfinity.net.br": "dcnet",

      "dcinfinitysolar.com.br": "dcsolar",
      "www.dcinfinitysolar.com.br": "dcsolar",

      "site2.com.br": "site2",
      "www.site2.com.br": "site2",
    };

    tenant =
      mapHostToTenant[hostFromOrigin] ||
      mapHostToTenant[(host || "").split(":")[0]] ||
      "dcnet";
  }

  // padroniza
  req.tenant = tenant;
  req.tenantId = tenant;

  next();
}

module.exports = tenantMiddleware;
