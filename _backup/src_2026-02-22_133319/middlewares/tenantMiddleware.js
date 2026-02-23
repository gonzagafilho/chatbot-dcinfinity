// src/middlewares/tenantMiddleware.js
const { resolveTenantFromRequest } = require("../config/tenants");

module.exports = function tenantMiddleware(req, _res, next) {
  req.tenant = resolveTenantFromRequest(req);
  req.origin = req.headers.origin || req.headers.referer || null;
  next();
};
