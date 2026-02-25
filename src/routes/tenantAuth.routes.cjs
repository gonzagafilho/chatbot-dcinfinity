const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const TenantUser = require("../models/TenantUser.cjs");
const requireTenantUser = require("../middlewares/requireTenantUser.cjs");

const router = express.Router();

// POST /api/tenant/login
router.post("/login", async (req, res) => {
  try {
    const { tenant, email, password } = req.body || {};

    if (!tenant || !email || !password) {
      return res.status(400).json({ ok: false, error: "missing_fields" });
    }

    const user = await TenantUser.findOne({
      tenant: String(tenant).trim(),
      email: String(email).toLowerCase().trim(),
    });

    if (!user) return res.status(401).json({ ok: false, error: "invalid_credentials" });
    if (!user.active) return res.status(403).json({ ok: false, error: "user_inactive" });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ ok: false, error: "invalid_credentials" });

    user.lastLoginAt = new Date();
    await user.save();

    const secret = process.env.JWT_SECRET || "change_me";
    const token = jwt.sign(
      {
        type: "tenant",
        tenant: user.tenant,
        email: user.email,
        role: user.role,
      },
      secret,
      { subject: String(user._id), expiresIn: "7d" }
    );

    return res.json({
      ok: true,
      token,
      user: {
        id: String(user._id),
        tenant: user.tenant,
        email: user.email,
        role: user.role,
        name: user.name,
      },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// GET /api/tenant/me
router.get("/me", requireTenantUser(), async (req, res) => {
  return res.json({ ok: true, user: req.tenantUser });
});

module.exports = router;