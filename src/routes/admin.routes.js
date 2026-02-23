"use strict";

const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const Admin = require("../models/Admin.js");
const Lead = require("../models/Lead.js");
const WaMessage = require("../models/WaMessage.js");

const router = express.Router();

function requireAdmin(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, error: "no token" });

  try {
    const payload = jwt.verify(token, process.env.ADMIN_JWT_SECRET);
    req.admin = payload;
    return next();
  } catch {
    return res.status(401).json({ ok: false, error: "invalid token" });
  }
}

router.post("/admin/login", async (req, res) => {
  console.log("✅ ADMIN_LOGIN HIT", { hasBody: !!req.body, email: req.body?.email });
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ ok: false, error: "email/senha obrigatórios" });
  }

  const admin = await Admin.findOne({ email, active: true }).lean();
  if (!admin) return res.status(401).json({ ok: false, error: "credenciais inválidas" });

  const ok = await bcrypt.compare(password, admin.passwordHash);
  if (!ok) return res.status(401).json({ ok: false, error: "credenciais inválidas" });

  const token = jwt.sign(
    { sub: String(admin._id), email: admin.email, role: admin.role || "ADMIN" },
    process.env.ADMIN_JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.json({ ok: true, token, admin: { email: admin.email, role: admin.role || "ADMIN" } });
});

router.get("/admin/leads", requireAdmin, async (req, res) => {
  const { tenant, status, q, limit = 50, skip = 0 } = req.query;

  const where = {};
  if (tenant) where.tenant = String(tenant);
  if (status) where.status = String(status);

  if (q) {
    const qq = String(q);
    where.$or = [
      { phone: qq },
      { name: new RegExp(qq, "i") },
      { lastMessage: new RegExp(qq, "i") },
    ];
  }

  const data = await Lead.find(where)
    .sort({ updatedAt: -1 })
    .skip(Number(skip))
    .limit(Math.min(Number(limit), 200))
    .lean();

  res.json({ ok: true, data });
});

router.get("/admin/conversations/:sessionId", requireAdmin, async (req, res) => {
  const { sessionId } = req.params;
  const { tenant } = req.query;

  const where = { "raw.sessionId": String(sessionId) };
  if (tenant) where.tenant = String(tenant);

  const msgs = await WaMessage.find(where).sort({ createdAt: 1 }).limit(500).lean();
  res.json({ ok: true, data: msgs });
});

module.exports = router;
