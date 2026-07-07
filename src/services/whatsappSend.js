const WaMessage = require("../models/WaMessage");
function getWhatsAppConfig() {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_TOKEN;

  if (!phoneNumberId || !token) {
    throw new Error("Missing WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_TOKEN");
  }

  return { phoneNumberId, token };
}

async function fetchWithRetry(url, options, retries = 3, timeoutMs = 10000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);

      const resp = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(id);

      return resp;
    } catch (err) {
      console.warn(`⚠️ fetch tentativa ${attempt} falhou:`, err.message);

      if (attempt === retries) {
        throw err;
      }

      await new Promise(r => setTimeout(r, 500 * attempt));
    }
  }
}



function extractMetaErrorCode(meta) {
  const err = meta && (meta.error || meta.metaError || meta);
  return Number(err && (err.code || err.error_code || err.errorCode) || 0) || null;
}

function translateMetaError(meta) {
  const err = meta && (meta.error || meta.metaError || meta);
  const code = extractMetaErrorCode(meta);
  const title = String(err && (err.error_user_title || err.title || err.type || err.message) || "").trim();
  const details = String(err && (err.error_user_msg || err.message || err.error_data && err.error_data.details || "") || "").trim();
  const map = {
    131000: { reason: "Erro temporário Meta.", action: "Tente enviar novamente em alguns minutos." },
    131009: { reason: "Template inexistente ou inválido.", action: "Sincronize os templates Meta e escolha um template aprovado." },
    131026: { reason: "Número inválido.", action: "Confira o telefone do cliente antes de reenviar." },
    131047: { reason: "Fora da janela de 24 horas.", title: "Janela de atendimento encerrada.", action: "Este cliente precisa receber um Template aprovado da Meta.", needsTemplate: true },
    131051: { reason: "Cliente bloqueou a empresa.", action: "Aguarde o cliente desbloquear o contato para novas mensagens." },
  };
  const base = map[code] || { reason: title || details || "Mensagem recusada pela Meta.", action: "Verifique os detalhes técnicos no Histórico." };
  return {
    code,
    title: base.title || "Mensagem não entregue.",
    reason: base.reason,
    action: base.action || "Verifique os detalhes técnicos no Histórico.",
    needsTemplate: !!base.needsTemplate,
    rawTitle: title,
    rawDetails: details,
  };
}

function inferOriginFromPayload(payload, options = {}) {
  if (options && options.origin) return String(options.origin);

  const type = String(payload?.type || "").toLowerCase();

  if (type === "template") {
    const name = String(payload?.template?.name || "").toLowerCase();

    if (name.includes("overdue") || name.includes("d2")) return "billing_d2";
    if (name.includes("d3") || name.includes("reminder")) return "billing_d3";
    if (name.includes("reactiv")) return "billing_reactivation";
    if (name.includes("birthday")) return "birthday";
    if (name.includes("promocao") || name.includes("promo")) return "campaign";
    if (name.includes("parceria")) return "partner_campaign";

    return "template";
  }

  if (type === "image") {
    const caption = String(payload?.image?.caption || "").toLowerCase();

    if (caption.includes("feliz aniversário") || caption.includes("anivers")) return "birthday";
    if (caption.includes("parceria")) return "partner_campaign";
    if (caption.includes("promo")) return "campaign";

    return "campaign_image";
  }

  if (type === "text") {
    const body = String(payload?.text?.body || "").toLowerCase();

    if (body.includes("feliz aniversário") || body.includes("anivers")) return "birthday";
    if (body.includes("d+2")) return "billing_d2";
    if (body.includes("d-3")) return "billing_d3";
    if (body.includes("reativa")) return "billing_reactivation";
    if (body.includes("promo")) return "campaign";
    if (body.includes("parceria")) return "partner_campaign";

    return "whatsapp_text";
  }

  if (type === "interactive") return "interactive";

  return "whatsapp";
}

function buildHistoryTextFromPayload(payload) {
  const type = String(payload?.type || "").toLowerCase();

  if (type === "text") return String(payload?.text?.body || "");
  if (type === "image") return String(payload?.image?.caption || payload?.image?.link || "");
  if (type === "document") return String(payload?.document?.caption || payload?.document?.filename || payload?.document?.link || "[document]");
  if (type === "audio") return String(payload?.audio?.link || "[audio]");
  if (type === "video") return String(payload?.video?.caption || payload?.video?.link || "[video]");
  if (type === "template") return "[template] " + String(payload?.template?.name || "");
  if (type === "interactive") {
    return "[interactive:" + String(payload?.interactive?.type || "unknown") + "] " +
      String(payload?.interactive?.body?.text || "");
  }

  return "[" + type + "]";
}

async function saveOutboundHistory(payload, sent, options = {}) {
  try {
    const wamid = sent?.messages?.[0]?.id || "";
    if (!wamid) return;

    await WaMessage.create({
      tenant: options.tenant || "dcnet",
      channel: "whatsapp",
      origin: inferOriginFromPayload(payload, options),
      direction: "outbound",
      wamid,
      from: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
      to: String(payload?.to || ""),
      text: buildHistoryTextFromPayload(payload),
      messageType: String(payload?.type || ""),
      mediaUrl: String(payload?.image?.link || payload?.document?.link || payload?.audio?.link || payload?.video?.link || ""),
      raw: sent,
      deliveryStatus: "sent",
      metaStatus: "sent",
      metaStatusAt: new Date(),
      templateName: options.templateName || (payload?.type === "template" ? String(payload?.template?.name || "") : ""),
      languageCode: options.languageCode || (payload?.type === "template" ? String(payload?.template?.language?.code || "") : ""),
      templateVariables: options.templateVariables || null,
      templateComponents: options.templateComponents || (payload?.type === "template" ? payload?.template?.components || null : null),
      fallbackToTemplate: Boolean(options.fallbackToTemplate),
      operatorId: options.operatorId || "",
      operatorName: options.operatorName || "",
      operatorEmail: options.operatorEmail || "",
      responseKind: options.responseKind || (options.operatorEmail || options.operatorName ? "manual" : (payload?.type === "template" ? "template" : "bot")),
      auditAction: options.auditAction || "",
      auditBy: options.auditBy || options.operatorEmail || options.operatorName || "",
      auditAt: options.auditAction ? new Date() : null,
      replyToMessageId: options.replyToMessageId || "",
      replyToText: options.replyToText || "",
      replyToWamid: options.replyToWamid || "",
    });
  } catch (e) {
    if (String(e?.code) !== "11000") {
      console.error("❌ saveOutboundHistory:", e?.message || e);
    }
  }
}


async function sendWhatsAppPayload(payload, options = {}) {
  const { phoneNumberId, token } = getWhatsAppConfig();
  const url = `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`;

  console.log("[whatsapp payload safe]", JSON.stringify(payload, null, 2));

  const resp = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await resp.json().catch(() => ({}));

  console.log("[whatsapp response status]", resp.status);
  console.log("[whatsapp response data]", JSON.stringify(data, null, 2));

  if (!resp.ok) {
    console.error("❌ WhatsApp send error:", data);
    const err = new Error(`WhatsApp send failed: ${resp.status}`);
    err.status = resp.status;
    err.meta = data;
    err.metaError = data?.error || null;
    err.metaErrorCode = data?.error?.code || null;
    err.metaErrorSubcode = data?.error?.error_subcode || null;
    throw err;
  }

  await saveOutboundHistory(payload, data, options);

  return data;
}

/**
 * @param {string} to
 * @param {string} message
 * @param {{ previewUrl?: boolean }} [options] Cloud API: text.preview_url para link preview no balão
 */
async function sendWhatsAppText(to, message, options) {
  const text = { body: message };
  if (options && options.previewUrl === true) {
    text.preview_url = true;
  }
  return sendWhatsAppPayload({
    messaging_product: "whatsapp",
    to,
    type: "text",
    text,
  }, options || {});
}

/**
 * Envia imagem por URL com legenda (Cloud API oficial).
 * @param {string} to
 * @param {string} imageUrl
 * @param {string} caption
 */
async function sendWhatsAppImage(to, imageUrl, caption, options = {}) {
  return sendWhatsAppPayload({
    messaging_product: "whatsapp",
    to,
    type: "image",
    image: {
      link: imageUrl,
      caption,
    },
  }, options || {});
}

async function sendWhatsAppMedia(to, mediaType, mediaUrl, caption, filename, options = {}) {
  const type = String(mediaType || "image").toLowerCase();
  const link = String(mediaUrl || "").trim();
  if (!link) throw new Error("sendWhatsAppMedia: mediaUrl vazio");
  const cap = String(caption || "").trim();
  const fn = String(filename || "").trim();
  const payload = { messaging_product: "whatsapp", to, type };

  if (type === "image") {
    payload.image = { link };
    if (cap) payload.image.caption = cap;
  } else if (type === "video") {
    payload.video = { link };
    if (cap) payload.video.caption = cap;
  } else if (type === "audio") {
    payload.audio = { link };
  } else {
    payload.type = "document";
    payload.document = { link };
    if (fn) payload.document.filename = fn;
    if (cap) payload.document.caption = cap;
  }

  return sendWhatsAppPayload(payload, options || {});
}

/**
 * Envia template aprovado na Meta (Cloud API template message).
 * @param {string} to
 * @param {string} templateName
 * @param {string} languageCode
 * @param {Array<object>} [components]
 */
async function sendWhatsAppTemplate(to, templateName, languageCode, components, options = {}) {
  const name = String(templateName || "").trim();
  const lang = String(languageCode || "pt_BR").trim() || "pt_BR";
  if (!name) throw new Error("sendWhatsAppTemplate: templateName vazio");

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name,
      language: {
        code: lang,
      },
    },
  };

  if (Array.isArray(components) && components.length > 0) {
    payload.template.components = components;
  }

  try {
    const sent = await sendWhatsAppPayload(payload, options || {});
    console.log("[whatsapp_template] sent", { to, templateName: name, languageCode: lang });
    return sent;
  } catch (e) {
    console.error("[whatsapp_template] send_failed", {
      to,
      templateName: name,
      languageCode: lang,
      error: e?.message || e,
    });
    throw e;
  }
}

async function sendLocationRequest(to, bodyText) {
  return sendWhatsAppPayload({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "location_request_message",
      body: { text: bodyText },
      action: { name: "send_location" },
    },
  });
}

/**
 * Botão CTA que abre URL (interactive cta_url — Cloud API).
 * @param {string} to
 * @param {string} bodyText
 * @param {string} buttonText rótulo do botão (display_text)
 * @param {string} url HTTPS
 */
async function sendWhatsAppCtaUrlButton(to, bodyText, buttonText, url) {
  const body = String(bodyText || "").trim();
  const display = String(buttonText || "").trim();
  const u = String(url || "").trim();
  if (!body) throw new Error("sendWhatsAppCtaUrlButton: bodyText vazio");
  if (!display) throw new Error("sendWhatsAppCtaUrlButton: buttonText vazio");
  if (!u) throw new Error("sendWhatsAppCtaUrlButton: url vazio");

  return sendWhatsAppPayload({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "cta_url",
      body: { text: body },
      action: {
        name: "cta_url",
        parameters: {
          display_text: display,
          url: u,
        },
      },
    },
  });
}

/** CTA URL padrão DC NET (atendimento humano) — Cloud API cta_url; corpo sem link bruto. */
const DCNET_FALAR_ATENDIMENTO_CTA = Object.freeze({
  label: "Falar com atendente",
  url: "https://wa.me/5561991374910",
});

/**
 * @param {string} to
 * @param {string} bodyText
 */
async function sendDcnetFalarComAtendenteCta(to, bodyText) {
  return sendWhatsAppCtaUrlButton(
    to,
    bodyText,
    DCNET_FALAR_ATENDIMENTO_CTA.label,
    DCNET_FALAR_ATENDIMENTO_CTA.url
  );
}

/**
 * Sufixo padrão para `WaMessage` após CTA (auditoria; o payload real é interativo).
 * @param {string} bodyText
 */
function dcnetFalarAtendenteOutboundLogText(bodyText) {
  return `${String(bodyText || "")}\n[interactive:cta_url ${DCNET_FALAR_ATENDIMENTO_CTA.label}]`;
}

/**
 * Imagem por URL pública (Cloud API).
 * Requer URL HTTPS acessível pela Meta; opcional via env DCNET_WHATSAPP_COMMERCIAL_IMAGE_URL.
 */
async function sendWhatsAppImageByLink(to, imageUrl, caption) {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "image",
    image: { link: imageUrl },
  };
  if (caption && String(caption).trim()) {
    payload.image.caption = String(caption).trim();
  }
  return sendWhatsAppPayload(payload);
}

/**
 * URL temporária para download da mídia recebida (Cloud API).
 * @param {string} mediaId
 * @returns {Promise<string>}
 */
async function getWhatsAppMediaUrl(mediaId) {
  const id = String(mediaId || "").trim();
  if (!id) throw new Error("getWhatsAppMediaUrl: mediaId vazio");

  const { token } = getWhatsAppConfig();
  const url = `https://graph.facebook.com/v25.0/${encodeURIComponent(id)}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error("❌ WhatsApp get media metadata error:", data);
    throw new Error(`getWhatsAppMediaUrl failed: ${resp.status}`);
  }
  const downloadUrl = data.url;
  if (!downloadUrl || typeof downloadUrl !== "string") {
    throw new Error("getWhatsAppMediaUrl: resposta sem url");
  }
  return downloadUrl;
}

/**
 * Baixa o binário da URL retornada pela API (requer Bearer).
 * @param {string} mediaUrl
 * @returns {Promise<{ buffer: Buffer, contentType: string }>}
 */
async function downloadWhatsAppMediaBuffer(mediaUrl) {
  const { token } = getWhatsAppConfig();
  const resp = await fetchWithRetry(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    console.error("❌ WhatsApp media download error:", resp.status, errBody.slice(0, 500));
    throw new Error(`downloadWhatsAppMediaBuffer failed: ${resp.status}`);
  }
  const contentType = resp.headers.get("content-type") || "application/octet-stream";
  const arrayBuf = await resp.arrayBuffer();
  return { buffer: Buffer.from(arrayBuf), contentType };
}

/**
 * Upload de mídia para o número da WABA (reutilizável em mensagens outbound).
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @param {string} [filename]
 * @returns {Promise<string>} media id retornado pela Meta
 */
async function uploadWhatsAppOutboundMedia(buffer, mimeType, filename) {
  const { phoneNumberId, token } = getWhatsAppConfig();
  const mime = String(mimeType || "application/octet-stream").trim() || "application/octet-stream";
  const name = String(filename || "file").trim() || "file";

  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mime);
  form.append("file", new Blob([buffer], { type: mime }), name);

  const url = `https://graph.facebook.com/v25.0/${phoneNumberId}/media`;
  const resp = await fetchWithRetry(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error("❌ WhatsApp media upload error:", data);
    throw new Error(`uploadWhatsAppOutboundMedia failed: ${resp.status}`);
  }
  const id = data.id;
  if (!id || typeof id !== "string") {
    throw new Error("uploadWhatsAppOutboundMedia: resposta sem id");
  }
  return id;
}

/**
 * Envia imagem usando id de mídia já enviada à WABA (upload).
 * @param {string} to
 * @param {string} mediaId
 * @param {string} [caption]
 */
async function sendWhatsAppImageByUploadedId(to, mediaId, caption) {
  const image = { id: String(mediaId).trim() };
  if (caption && String(caption).trim()) {
    image.caption = String(caption).trim();
  }
  return sendWhatsAppPayload({
    messaging_product: "whatsapp",
    to,
    type: "image",
    image,
  });
}

/**
 * Envia documento usando id de mídia já enviada à WABA (upload).
 * @param {string} to
 * @param {string} mediaId
 * @param {string} [filename]
 * @param {string} [caption]
 */
async function sendWhatsAppDocumentByUploadedId(to, mediaId, filename, caption) {
  const document = { id: String(mediaId).trim() };
  const fn = filename && String(filename).trim();
  if (fn) document.filename = fn;
  if (caption && String(caption).trim()) {
    document.caption = String(caption).trim();
  }
  return sendWhatsAppPayload({
    messaging_product: "whatsapp",
    to,
    type: "document",
    document,
  });
}

module.exports = {
  sendWhatsAppText,
  sendWhatsAppImage,
  sendWhatsAppMedia,
  sendWhatsAppTemplate,
  translateMetaError,
  sendLocationRequest,
  sendWhatsAppCtaUrlButton,
  sendDcnetFalarComAtendenteCta,
  dcnetFalarAtendenteOutboundLogText,
  DCNET_FALAR_ATENDIMENTO_CTA,
  sendWhatsAppImageByLink,
  getWhatsAppMediaUrl,
  downloadWhatsAppMediaBuffer,
  uploadWhatsAppOutboundMedia,
  sendWhatsAppImageByUploadedId,
  sendWhatsAppDocumentByUploadedId,
};
