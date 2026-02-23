const express = require("express");
const { replyFromRules } = require("../services/rules");

// USAR UM SÓ: se você já tem whatsappSend funcionando, pode trocar pra ele.
// const { sendWhatsAppText } = require("../services/whatsappSend");
const { sendWhatsAppText } = require("../services/whatsappSend");

const WaMessage = require("../models/WaMessage");
const Lead = require("../models/Lead");
const {
  resolveTenantFromPhoneNumberId,
  resolveTenantFromText,
} = require("../services/tenantResolverWhatsApp");

const router = express.Router();

/**
 * DEDUPE em memória (evita responder duplicado em caso de retry da Meta)
 */
const seen = new Map();
const TTL_MS = 10 * 60 * 1000; // 10 min

function wasSeen(id) {
  if (!id) return false;
  const now = Date.now();

  for (const [k, t] of seen) {
    if (now - t > TTL_MS) seen.delete(k);
  }

  if (seen.has(id)) return true;
  seen.set(id, now);
  return false;
}

// Verificação da Meta (GET)
router.get("/webhook/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Recebimento de mensagens (POST)
router.post("/webhook/whatsapp", async (req, res) => {
  // responde 200 rápido pra Meta não reenviar
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    const msg = value?.messages?.[0];
    if (!msg) return;

    const waMessageId = msg.id;
    const from = msg.from;
    const text = msg.text?.body || "";
    const toPhoneId = value?.metadata?.phone_number_id || "";

    // resolve tenant (A: por PHONE_NUMBER_ID; B: fallback por texto)
    let tenant = resolveTenantFromPhoneNumberId(toPhoneId);
    if (!tenant) tenant = resolveTenantFromText(text);
    if (!tenant) tenant = "dcnet";

    console.log("📩 WhatsApp inbound:", { tenant, waMessageId, from, text });

    if (wasSeen(waMessageId)) {
      console.log("🔁 DEDUPE: evento repetido ignorado:", waMessageId);
      return;
    }

    // salva inbound
    try {
      await WaMessage.create({
        tenant,
        channel: "whatsapp",
        origin: null,

        waMessageId,
        direction: "inbound",
        from,
        to: toPhoneId,
        text,
        raw: req.body,
      });
    } catch (e) {
      if (String(e?.code) !== "11000") {
        console.error("❌ Erro ao salvar inbound:", e?.message || e);
      }
    }

    // atualiza/cria lead
    try {
      await Lead.findOneAndUpdate(
        { phone: from, tenant },
        { $set: { lastMessage: text, origin: "whatsapp", channel: "whatsapp", tenant } },
        { upsert: true, new: true }
      );
    } catch (e) {
      console.error("❌ Erro ao atualizar lead:", e?.message || e);
    }

    // regras
    const result = replyFromRules({
      tenant,
      message: text,
      origin: "whatsapp",
      page: "whatsapp",
      phone: from,
    });

    const replyText =
      typeof result === "string" ? result : (result?.reply || "Ok.");

    console.log("🤖 Reply rules:", replyText);

    // envia mensagem (padrão do whatsappService: sendWhatsAppText({to,text}))
    const sent = await sendWhatsAppText(from, replyText);

    // salva outbound
    try {
      await WaMessage.create({
        tenant,
        channel: "whatsapp",
        origin: null,

        wamid: sent?.messages?.[0]?.id,
        direction: "outbound",
        from: toPhoneId,
        to: from,
        text: replyText,
        raw: sent,
      });
    } catch (e) {
      console.error("❌ Erro ao salvar outbound:", e?.message || e);
    }

    // atualiza lead (intent)
    try {
      await Lead.findOneAndUpdate(
        { phone: from, tenant },
        {
          $set: {
            lastIntent: typeof result === "object" ? (result.intent || null) : null,
            lastMessage: replyText,
            channel: "whatsapp",
            tenant,
          },
        },
        { upsert: true }
      );
    } catch (e) {
      console.error("❌ Erro ao atualizar lead (intent):", e?.message || e);
    }
  } catch (err) {
    console.error("❌ Webhook error:", err?.response?.data || err?.message || err);
  }
});

module.exports = router;
