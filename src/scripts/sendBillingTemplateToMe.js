"use strict";

/**
 * Envio direto (WhatsApp Cloud API) do template de cobrança para o número fixo no script.
 * Não roda o job D-3 nem lê BeesWeb; não obedece BILLING_REMINDER_ENABLED / MODE.
 * Para homologar o fluxo completo (Mongo + BeesWeb + logs), use: node src/scripts/runBillingOnce.js
 */

require("dotenv").config();

const { connectDB } = require("../config/db");
const { sendWhatsAppTemplate } = require("../services/whatsappSend");

(async () => {
  try {
    console.log("🚀 TESTE REAL CONTROLADO");

    await connectDB();
    console.log("✅ Mongo conectado");

    const phone = "5561996088711"; // SEU NÚMERO

    const components = [
  {
    type: "body",
    parameters: [
      { type: "text", text: "Luiz" },
      { type: "text", text: "119,99" },
      { type: "text", text: "25/04/2026" },
      { type: "text", text: "https://exemplo.com/boleto.pdf" },
    ],
  },
];

    console.log("📤 Enviando template...");

    await sendWhatsAppTemplate(
      phone,
      process.env.WA_TEMPLATE_BILLING_REMINDER,
      process.env.WA_TEMPLATE_LANGUAGE_CODE,
      components
    );

    console.log("✅ TEMPLATE ENVIADO (APENAS PARA VOCÊ)");

    process.exit(0);
  } catch (e) {
    console.error("❌ Erro:", e?.message || e);
    process.exit(1);
  }
})();
