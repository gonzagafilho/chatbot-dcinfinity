const express = require("express");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const TenantUser = require("../models/TenantUser.cjs");
const requireTenantUser = require("../middlewares/requireTenantUser.cjs");

const router = express.Router();

// Tudo aqui exige TENANT_ADMIN
router.use(requireTenantUser({ roles: ["TENANT_ADMIN"] }));

// GET /api/tenant/users
router.get("/", async (req, res) => {
  const tenant = req.tenantUser.tenant;

  const users = await TenantUser.find({ tenant })
    .select("_id tenant name email role active lastLoginAt createdAt updatedAt")
    .sort({ createdAt: -1 })
    .lean();

  return res.json({ ok: true, users });
});

// POST /api/tenant/users
router.post("/", async (req, res) => {
  try {
    const tenant = req.tenantUser.tenant;
    const { name, email, role, password } = req.body || {};

    if (!name || !email || !password) {
      return res.status(400).json({ ok: false, error: "missing_fields" });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const passwordHash = await bcrypt.hash(String(password), 10);

    const doc = await TenantUser.create({
      tenant,
      name: String(name).trim(),
      email: normalizedEmail,
      role: role === "TENANT_ADMIN" ? "TENANT_ADMIN" : "AGENT",
      passwordHash,
      active: true,
    });

    return res.json({
      ok: true,
      user: {
        id: String(doc._id),
        tenant: doc.tenant,
        name: doc.name,
        email: doc.email,
        role: doc.role,
        active: doc.active,
      },
    });
  } catch (e) {
    // erro de duplicidade tenant+email
    if (String(e && e.code) === "11000") {
      return res.status(409).json({ ok: false, error: "email_already_exists" });
    }
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// PATCH /api/tenant/users/:id
router.patch("/:id", async (req, res) => {
  try {
    const tenant = req.tenantUser.tenant;
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ ok: false, error: "invalid_id" });
    }

    const patch = {};
    if (typeof req.body.name === "string") patch.name = req.body.name.trim();
    if (typeof req.body.active === "boolean") patch.active = req.body.active;
    if (typeof req.body.role === "string") {
      patch.role = req.body.role === "TENANT_ADMIN" ? "TENANT_ADMIN" : "AGENT";
    }

    const updated = await TenantUser.findOneAndUpdate(
      { _id: id, tenant },
      { $set: patch },
      { new: true }
    ).select("_id tenant name email role active lastLoginAt createdAt updatedAt");

    if (!updated) return res.status(404).json({ ok: false, error: "not_found" });

    return res.json({
      ok: true,
      user: {
        id: String(updated._id),
        tenant: updated.tenant,
        name: updated.name,
        email: updated.email,
        role: updated.role,
        active: updated.active,
        lastLoginAt: updated.lastLoginAt,
      },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// POST /api/tenant/users/:id/reset-password
router.post("/:id/reset-password", async (req, res) => {
  try {
    const tenant = req.tenantUser.tenant;
    const { id } = req.params;
    const { password } = req.body || {};

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ ok: false, error: "invalid_id" });
    }
    if (!password) return res.status(400).json({ ok: false, error: "missing_password" });

    const passwordHash = await bcrypt.hash(String(password), 10);

    const updated = await TenantUser.findOneAndUpdate(
      { _id: id, tenant },
      { $set: { passwordHash } },
      { new: true }
    ).select("_id email");

    if (!updated) return res.status(404).json({ ok: false, error: "not_found" });

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

module.exports = router;