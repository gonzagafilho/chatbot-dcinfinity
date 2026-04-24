"use strict";

const express = require("express");
const requireAdminAuth = require("../middlewares/requireAdmin");
const {
  getConfigForTenant,
  patchConfigForTenant,
  MERGE_KEYS,
} = require("../services/chatbotContentConfigService");

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

/* --- Manutenção em massa (BeesWeb) — apenas preview / teste; sem envio real (fase 1) --- */

const AUDIENCE_LABELS = {
  all: "Todos os clientes",
  active: "Somente clientes ativos",
  contract: "Somente clientes com contrato ativo",
};

function normalizeBroadcastBody(body) {
  if (!body || typeof body !== "object") {
    return { error: "invalid_body" };
  }
  const title = String(body.title != null ? body.title : "").trim();
  const message = String(body.message != null ? body.message : "").trim();
  const expectedReturn = String(body.expectedReturn != null ? body.expectedReturn : "").trim();
  const rawAudience = String(body.audience || "all")
    .trim()
    .toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(AUDIENCE_LABELS, rawAudience)) {
    return { error: "invalid_audience" };
  }
  return {
    title,
    message,
    expectedReturn,
    audience: rawAudience,
  };
}

function buildComposedMessage({ title, message, expectedReturn }) {
  const parts = [];
  if (title) parts.push(title);
  if (message) parts.push(message);
  if (expectedReturn) parts.push("Retorno previsto: " + expectedReturn);
  return parts.length ? parts.join("\n\n") : "(mensagem vazia)";
}

/**
 * POST /api/chatbot-admin/maintenance-broadcast/preview
 * Monta prévia, audiência e aviso. Não envia mensagem; contagem de clientes ainda é placeholder (TODO).
 */
router.post(
  "/chatbot-admin/maintenance-broadcast/preview",
  requireAdminAuth,
  (req, res) => {
    const n = normalizeBroadcastBody(req.body);
    if (n.error) {
      return res.status(400).json({ ok: false, error: n.error });
    }
    if (!n.title && !n.message) {
      return res
        .status(400)
        .json({ ok: false, error: "title_or_message_required" });
    }
    const email = (req.admin && req.admin.email) || "";
    console.log("[chatbot-admin/maintenance-broadcast/preview]", {
      at: new Date().toISOString(),
      admin: email,
      audience: n.audience,
    });
    res.json({
      ok: true,
      estimatedCount: null,
      estimatedCountNote:
        "Estimativa de clientes ainda não integrada à BeesWeb (fase de preparação; TODO seguro).",
      composedMessage: buildComposedMessage(n),
      audience: n.audience,
      audienceLabel: AUDIENCE_LABELS[n.audience],
      warning: "envio real ainda não habilitado",
    });
  }
);

/**
 * POST /api/chatbot-admin/maintenance-broadcast/test
 * Valida intenção de teste. Não envia WhatsApp nem liga à BeesWeb nesta fase.
 * body: + testMode (bool), testPhone (string) quando testMode
 */
router.post(
  "/chatbot-admin/maintenance-broadcast/test",
  requireAdminAuth,
  (req, res) => {
    const n = normalizeBroadcastBody(req.body);
    if (n.error) {
      return res.status(400).json({ ok: false, error: n.error });
    }
    if (!n.title && !n.message) {
      return res
        .status(400)
        .json({ ok: false, error: "title_or_message_required" });
    }
    const testMode = req.body && req.body.testMode === true;
    const testPhone = String(
      (req.body && req.body.testPhone) != null ? req.body.testPhone : ""
    ).trim();
    if (testMode) {
      const digits = testPhone.replace(/\D/g, "");
      if (digits.length < 10) {
        return res.status(400).json({
          ok: false,
          error: "test_phone_invalid",
        });
      }
    }
    const email = (req.admin && req.admin.email) || "";
    console.log("[chatbot-admin/maintenance-broadcast/test]", {
      at: new Date().toISOString(),
      admin: email,
      audience: n.audience,
      testMode,
      dryRun: true,
    });
    res.json({
      ok: true,
      dryRun: true,
      simulated: true,
      message:
        "Nenhum WhatsApp foi enviado. O disparo de teste ainda não está conectado ao provedor; esta resposta confirma apenas a validação da requisição.",
      wouldSendTo: testMode && testPhone ? testPhone : null,
      composedMessage: buildComposedMessage(n),
      audience: n.audience,
      audienceLabel: AUDIENCE_LABELS[n.audience],
      warning: "envio real ainda não habilitado",
    });
  }
);

module.exports = router;
