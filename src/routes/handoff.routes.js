"use strict";

const express = require("express");
const router = express.Router();

const Lead = require("../models/Lead.js");
const WaMessage = require("../models/WaMessage.js");
const { notifyWhatsApp } = require("../services/notifyWhatsApp.js");

/**
 * POST /api/handoff
 * body: { sessionId, lastMessage, pageUrl }
 */
router.post("/handoff", async (req, res) => {
  const tenant = req.tenantId || req.headers["x-tenant-id"] || "dcnet";
  const { sessionId, lastMessage, pageUrl } = req.body || {};

  if (!sessionId) {
    return res.status(400).json({ ok: false, error: "sessionId obrigatório" });
  }

  // ✅ padrão único para web
  const phone = `web:${sessionId}`;

  // 1) Atualiza lead (não quebra se Mongo cair)
  try {
    await Lead.findOneAndUpdate(
      { tenant, phone },
      {
        $set: {
          tenant,
          phone,
          origin: "web",
          channel: "web",
          status: "handoff",
          lastMessage: lastMessage || "handoff",
          lastIntent: "handoff",
        },
      },
      { upsert: true, new: true }
    );
  } catch (e) {
    console.log("⚠️ handoff Lead update failed:", e?.message);
  }

  // 2) Salva evento no histórico (SEM direction=system)
  try {
    await WaMessage.create({
      tenant,
      channel: "web",
      origin: pageUrl ? String(pageUrl) : null,
      direction: "inbound",
      from: phone,
      to: "bot",
      text: "HANDOFF_REQUESTED",
      intent: "handoff",
      page: pageUrl ? String(pageUrl) : "",
      raw: { type: "handoff", pageUrl: pageUrl || null, lastMessage: lastMessage || null },
    });
  } catch (e) {
    console.log("⚠️ handoff WaMessage create failed:", e?.message);
  }

  // 3) Dispara alerta (se tiver ALERT_TO_WA no .env)
  const to = process.env.ALERT_TO_WA;
  const alertText =
    `🚨 HANDOFF solicitado\n` +
    `Tenant: ${tenant}\n` +
    `Session: ${sessionId}\n` +
    (pageUrl ? `Página: ${pageUrl}\n` : "") +
    (lastMessage ? `Última msg: ${lastMessage}\n` : "");

  try {
    if (to) await notifyWhatsApp({ to, text: alertText });
  } catch (e) {
    console.log("⚠️ notifyWhatsApp failed:", e?.message);
  }

  return res.json({ ok: true, tenant, sessionId });
});

module.exports = router;
