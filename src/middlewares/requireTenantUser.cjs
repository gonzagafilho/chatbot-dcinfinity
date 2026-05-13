const jwt = require("jsonwebtoken");
const TenantUser = require("../models/TenantUser.cjs");

function getTokenFromHeader(req) {
  const h = req.headers.authorization || "";
  const parts = h.split(" ");
  if (parts.length === 2 && parts[0].toLowerCase() === "bearer") return parts[1];
  return null;
}

module.exports = function requireTenantUser(options = {}) {
  const { roles } = options; // ex: ["TENANT_ADMIN"]

  return async function (req, res, next) {
    try {
      const token = getTokenFromHeader(req);
      if (!token) return res.status(401).json({ ok: false, error: "no_token" });

      const secret = process.env.JWT_SECRET || "change_me";
      const payload = jwt.verify(token, secret);

      if (payload.type !== "tenant") {
        return res.status(401).json({ ok: false, error: "invalid_token_type" });
      }

      const user = await TenantUser.findById(payload.sub).lean();
      if (!user) return res.status(401).json({ ok: false, error: "user_not_found" });
      if (!user.active) return res.status(403).json({ ok: false, error: "user_inactive" });

      // trava por role se exigir
      if (Array.isArray(roles) && roles.length > 0) {
        if (!roles.includes(user.role)) {
          return res.status(403).json({ ok: false, error: "forbidden_role", role: user.role });
        }
      }

      req.tenantUser = {
        id: String(user._id),
        tenant: user.tenant,
        email: user.email,
        role: user.role,
        name: user.name,
      };

      next();
    } catch (err) {
      return res.status(401).json({ ok: false, error: "invalid_token" });
    }
  };
};