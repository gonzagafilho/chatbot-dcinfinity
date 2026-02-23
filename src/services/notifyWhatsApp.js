"use strict";

const axios = require("axios");

async function notifyWhatsApp({ to, text }) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    console.log("⚠️ notifyWhatsApp SKIP (sem credenciais)");
    return { ok: false, skipped: true };
  }

  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  };

  const r = await axios.post(url, payload, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 10000,
  });

  return { ok: true, data: r.data };
}

module.exports = { notifyWhatsApp };