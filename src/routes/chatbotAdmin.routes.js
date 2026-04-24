"use strict";

const express = require("express");
const mongoose = require("mongoose");
const requireAdminAuth = require("../middlewares/requireAdmin");
const {
  getConfigForTenant,
  patchConfigForTenant,
  MERGE_KEYS,
} = require("../services/chatbotContentConfigService");
const {
  previewBroadcast,
  sendTestBroadcast,
  createBroadcastJob,
  getJobById,
  setJobStatus,
} = require("../services/maintenanceBroadcastService");

const router = express.Router();

function normalizeTenantParam(v) {
  return String(v || "dcnet")
    .trim()
    .toLowerCase();
}

function pickAllowedPatch(body) {
  const out = {};
  if (!body || typeof body !== "object") return out;
  for (const k of MERGE_KEYS) {
    if (body[k] != null && typeof body[k] === "object" && !Array.isArray(body[k])) {
      out[k] = body[k];
    }
  }
  return out;
}

/**
 * GET /api/chatbot-admin/me
 * Mesmo JWT do admin de atendimento; rota separada do /api/admin/me.
 */
router.get("/chatbot-admin/me", requireAdminAuth, (req, res) => {
  const a = req.admin || {};
  res.json({
    ok: true,
    admin: {
      id: String(a._id || ""),
      email: a.email || "",
      role: a.role || "ADMIN",
    },
  });
});

/**
 * GET /api/chatbot-admin/config?tenant=dcnet
 */
router.get("/chatbot-admin/config", requireAdminAuth, async (req, res) => {
  try {
    const tenant = normalizeTenantParam(req.query.tenant);
    const config = await getConfigForTenant(tenant);
    res.json({ ok: true, config });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * PATCH /api/chatbot-admin/config
 * body: { tenant, campaigns?, campaignTexts?, campaignActive?, operationalMessages?, maintenance? }
 */
router.patch("/chatbot-admin/config", requireAdminAuth, async (req, res) => {
  try {
    const tenant = normalizeTenantParam(req.body?.tenant || req.query?.tenant);
    if (!tenant) {
      return res.status(400).json({ ok: false, error: "tenant_required" });
    }
    const patch = pickAllowedPatch(req.body);
    if (!Object.keys(patch).length) {
      return res.status(400).json({ ok: false, error: "empty_patch" });
    }
    const config = await patchConfigForTenant(tenant, patch);
    res.json({ ok: true, config });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/* --- Manutenção em massa BeesWeb (fila + worker) --- */

/**
 * POST /api/chatbot-admin/maintenance-broadcast/preview
 */
router.post("/chatbot-admin/maintenance-broadcast/preview", requireAdminAuth, async (req, res) => {
  try {
    const email = (req.admin && req.admin.email) || "";
    console.log("[chatbot-admin/maintenance-broadcast/preview]", {
      at: new Date().toISOString(),
      admin: email,
    });
    const r = await previewBroadcast(req.body);
    if (r.ok === false) {
      const code = r.error === "beesweb_not_configured" ? 503 : 400;
      return res.status(code).json({ ok: false, error: r.error });
    }
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * POST /api/chatbot-admin/maintenance-broadcast/test
 * Envia uma única mensagem real para testPhone (não cria lote).
 */
router.post("/chatbot-admin/maintenance-broadcast/test", requireAdminAuth, async (req, res) => {
  try {
    const r = await sendTestBroadcast(req.body, (req.admin && req.admin.email) || "");
    if (r.err) {
      return res.status(r.err).json(r.body);
    }
    res.json(r.out);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * POST /api/chatbot-admin/maintenance-broadcast/create
 * Cria lote enfileirado (envio fora do request).
 */
router.post("/chatbot-admin/maintenance-broadcast/create", requireAdminAuth, async (req, res) => {
  try {
    const r = await createBroadcastJob(req.body, req.admin);
    if (r.err) {
      return res.status(r.err).json(r.body);
    }
    res.json(r.out);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * GET /api/chatbot-admin/maintenance-broadcast/jobs/:id
 */
router.get("/chatbot-admin/maintenance-broadcast/jobs/:id", requireAdminAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ ok: false, error: "invalid_id" });
    }
    const r = await getJobById(req.params.id);
    if (r.err) {
      return res.status(r.err).json(r.body);
    }
    res.json({ ok: true, job: r.job });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.post(
  "/chatbot-admin/maintenance-broadcast/jobs/:id/pause",
  requireAdminAuth,
  async (req, res) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(400).json({ ok: false, error: "invalid_id" });
      }
      const r = await setJobStatus(req.params.id, "paused");
      if (r.err) {
        return res.status(r.err).json(r.body);
      }
      res.json(r.out);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }
);

router.post(
  "/chatbot-admin/maintenance-broadcast/jobs/:id/cancel",
  requireAdminAuth,
  async (req, res) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(400).json({ ok: false, error: "invalid_id" });
      }
      const r = await setJobStatus(req.params.id, "canceled");
      if (r.err) {
        return res.status(r.err).json(r.body);
      }
      res.json(r.out);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }
);

router.post(
  "/chatbot-admin/maintenance-broadcast/jobs/:id/resume",
  requireAdminAuth,
  async (req, res) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(400).json({ ok: false, error: "invalid_id" });
      }
      const r = await setJobStatus(req.params.id, "resumed");
      if (r.err) {
        return res.status(r.err).json(r.body);
      }
      res.json(r.out);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }
);

module.exports = router;
