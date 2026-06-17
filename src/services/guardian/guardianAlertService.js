"use strict";

const {
  sendWhatsAppTemplate,
} = require("../whatsappSend");

const ALERT_PHONE =
  process.env.GUARDIAN_ALERT_PHONE ||
  "5561996088711";

const TEMPLATE_NAME =
  process.env.GUARDIAN_ALERT_TEMPLATE ||
  "dcnet_guardian_alert";

const LANGUAGE_CODE =
  process.env.WA_TEMPLATE_LANGUAGE_CODE ||
  "pt_BR";

function nowBr() {
  return new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
}

async function sendGuardianAlert(message) {
  const eventText = String(message || "Evento Guardian").slice(0, 900);
  const host = process.env.HOSTNAME || "servidor-dcnet";
  const when = nowBr();

  const components = [
    {
      type: "body",
      parameters: [
        { type: "text", text: eventText },
        { type: "text", text: host },
        { type: "text", text: when },
      ],
    },
  ];

  try {
    console.log("[guardian_alert_template] sending", {
      to: ALERT_PHONE,
      templateName: TEMPLATE_NAME,
    });

    await sendWhatsAppTemplate(
      ALERT_PHONE,
      TEMPLATE_NAME,
      LANGUAGE_CODE,
      components
    );

    console.log("[guardian_alert_template] sent");
  } catch (e) {
    console.error(
      "[guardian_alert_template] error",
      e?.response?.data ||
      e?.message ||
      e
    );
  }
}

module.exports = {
  sendGuardianAlert,
};
