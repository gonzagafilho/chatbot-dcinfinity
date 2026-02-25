"use strict";

const express = require("express");
const crypto = require("crypto");
const Tenant = require("../models/Tenant");

// ⚠️ IMPORTANTE:
// aqui a gente reaproveita o MESMO middleware que protege o admin.routes.js
// No seu projeto ele pode ter nome diferente.
// Se no seu admin.routes.js você usa algo tipo `require("../middlewares/adminAuth")`,
// use o mesmo aqui.
const requireAdminAuth = require("../middlewares/requireAdmin");

const router = express.Router();

// util: normalizar slug
function normalizeSlug(slug) {
  return String(slug || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "")
    .slice(0, 50);
}

function genToken() {
  return crypto.randomBytes(24).toString("hex");
}

// LISTAR
router.get("/admin/tenants", requireAdminAuth, async (req, res) => {
  const items = await Tenant.find().sort({ createdAt: -1 }).lean();
  res.json({ ok: true, items });
});

// CRIAR
router.post("/admin/tenants", requireAdminAuth, async (req, res) => {
  const { name, slug, plan, maxUsers, expiresAt, active } = req.body || {};

  const slugNorm = normalizeSlug(slug);
  if (!name || !slugNorm) {
    return res.status(400).json({ ok: false, error: "missing_name_or_slug" });
  }

  const exists = await Tenant.findOne({ slug: slugNorm }).lean();
  if (exists) return res.status(409).json({ ok: false, error: "slug_already_exists" });

  let token = genToken();
  // garante token único
  while (await Tenant.findOne({ token }).lean()) token = genToken();

  const tenant = await Tenant.create({
    name: String(name).trim(),
    slug: slugNorm,
    token,
    plan: plan || "basic",
    maxUsers: Number.isFinite(+maxUsers) ? +maxUsers : 1,
    expiresAt: expiresAt ? new Date(expiresAt) : null,
    active: typeof active === "boolean" ? active : true,
  });

  res.json({ ok: true, tenant });
});

// EDITAR
router.put("/admin/tenants/:id", requireAdminAuth, async (req, res) => {
  const { id } = req.params;
  const { name, plan, maxUsers, expiresAt, active } = req.body || {};

  const tenant = await Tenant.findById(id);
  if (!tenant) return res.status(404).json({ ok: false, error: "tenant_not_found" });

  if (name != null) tenant.name = String(name).trim();
  if (plan != null) tenant.plan = String(plan);
  if (maxUsers != null) tenant.maxUsers = Number.isFinite(+maxUsers) ? +maxUsers : tenant.maxUsers;
  if (expiresAt !== undefined) tenant.expiresAt = expiresAt ? new Date(expiresAt) : null;
  if (active != null) tenant.active = !!active;

  await tenant.save();
  res.json({ ok: true, tenant });
});

// REGERAR TOKEN (útil pra trocar token do cliente)
router.post("/admin/tenants/:id/regen-token", requireAdminAuth, async (req, res) => {
  const { id } = req.params;

  const tenant = await Tenant.findById(id);
  if (!tenant) return res.status(404).json({ ok: false, error: "tenant_not_found" });

  let token = genToken();
  while (await Tenant.findOne({ token }).lean()) token = genToken();

  tenant.token = token;
  await tenant.save();

  res.json({ ok: true, token });
});

// EXCLUIR (use com cuidado)
router.delete("/admin/tenants/:id", requireAdminAuth, async (req, res) => {
  const { id } = req.params;
  const tenant = await Tenant.findByIdAndDelete(id);
  if (!tenant) return res.status(404).json({ ok: false, error: "tenant_not_found" });
  res.json({ ok: true });
});

module.exports = router;