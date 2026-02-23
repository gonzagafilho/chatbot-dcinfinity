const express = require("express");
const { replyFromRules } = require("../services/rules");
const WaMessage = require("../models/WaMessage");
const Lead = require("../models/Lead");

const router = express.Router();

/**
 * POST /api/chat
 * - responde rápido (não trava se Mongo cair)
 * - grava no Mongo em background (best effort)
 */
router.post("/chat", async (req, res) => {
  const tenant = (req.headers["x-tenant-id"] || "dcnet")
    .toString()
    .trim()
    .toLowerCase();

  const message = (req.body?.message || "").toString();
  const sessionId =
    (req.body?.sessionId || "").toString() || `web_${Date.now()}`;
  const origin = (req.body?.origin || "web").toString();
  const page = (req.body?.page || "site").toString();

  if (!message.trim()) {
    return res.status(400).json({ ok: false, error: "message_required" });
  }

  const leadKey = `web:${sessionId}`;

  // 1) calcula reply (não depende do Mongo)
  const result = replyFromRules({
    tenant,
    message,
    origin: "web",
    page,
    phone: leadKey,
  });

  const replyText =
    typeof result === "string"
      ? result
      : result?.reply || "Ok.";

  // 2) responde IMEDIATO (não trava)
  res.json({ ok: true, tenant, reply: replyText });

  // 3) grava no Mongo em background (best effort)
  Promise.resolve()
    .then(() =>
      WaMessage.create({
        tenant,
        channel: "web",
        origin,
        waMessageId: null,
        direction: "inbound",
        from: leadKey,
        to: "bot",
        text: message,
        raw: { body: req.body, headers: req.headers },
      })
    )
    .catch((e) =>
      console.error("❌ Erro ao salvar inbound web:", e?.message || e)
    );

  Promise.resolve()
    .then(() =>
      Lead.findOneAndUpdate(
        { phone: leadKey, tenant },
        {
          $set: {
            lastMessage: message,
            origin: "web",
            channel: "web",
            tenant,
          },
        },
        { upsert: true, new: true }
      )
    )
    .catch((e) =>
      console.error("❌ Erro ao atualizar lead web:", e?.message || e)
    );

  Promise.resolve()
    .then(() =>
      WaMessage.create({
        tenant,
        channel: "web",
        origin,
        waMessageId: null,
        direction: "outbound",
        from: "bot",
        to: leadKey,
        text: replyText,
        raw: { result },
      })
    )
    .catch((e) =>
      console.error("❌ Erro ao salvar outbound web:", e?.message || e)
    );

  Promise.resolve()
    .then(() =>
      Lead.findOneAndUpdate(
        { phone: leadKey, tenant },
        {
          $set: {
            lastIntent:
              typeof result === "object"
                ? result.intent || null
                : null,
            lastMessage: replyText,
            channel: "web",
            tenant,
          },
        },
        { upsert: true }
      )
    )
    .catch((e) =>
      console.error(
        "❌ Erro ao atualizar lead web (intent):",
        e?.message || e
      )
    );
});

module.exports = router;
