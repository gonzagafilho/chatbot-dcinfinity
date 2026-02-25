"use strict";

const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin");

module.exports = async function requireAdmin(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token) return res.status(401).json({ ok: false, error: "missing_token" });

    const secret = process.env.ADMIN_JWT_SECRET;
    if (!secret) return res.status(500).json({ ok: false, error: "missing_admin_jwt_secret" });

    const payload = jwt.verify(token, secret);

    const adminId = payload.id || payload._id || payload.adminId || payload.sub;
    if (!adminId) return res.status(401).json({ ok: false, error: "invalid_token_payload" });

    const admin = await Admin.findById(adminId).lean();
    if (!admin || admin.active === false) {
      return res.status(401).json({ ok: false, error: "admin_not_found_or_inactive" });
    }

    req.admin = admin;
    next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: "invalid_token" });
  }
};
