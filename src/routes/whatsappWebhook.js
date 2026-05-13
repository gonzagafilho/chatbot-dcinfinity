const express = require("express");
const {
  replyFromRules,
  mensagemPosEnvioLocalizacaoComercialDcnet,
} = require("../services/rules");

// USAR UM SÓ: se você já tem whatsappSend funcionando, pode trocar pra ele.
// const { sendWhatsAppText } = require("../services/whatsappSend");
const {
  sendWhatsAppText,
  sendLocationRequest,
  sendWhatsAppCtaUrlButton,
  sendDcnetFalarComAtendenteCta,
  dcnetFalarAtendenteOutboundLogText,
} = require("../services/whatsappSend");

const WaMessage = require("../models/WaMessage");
const Lead = require("../models/Lead");
const { notifyAdmin } = require("../services/notifyAdmin");
const {
  resolveTenantFromPhoneNumberId,
  resolveTenantFromText,
} = require("../services/tenantResolverWhatsApp");
const { resolveConversationContext } = require("../services/contextResolver");
const {
  loadDcnetBeeswebSnapshotForPhone,
  shouldPrefetchBeeswebForDcnetWhatsapp,
  isDcnetFinanceFlowIntent,
  isDcnetHumanGeneralHandoffIntent,
  isDcnetBeeswebIdentificationAwaitingCpf,
  isDcnetBeeswebIdentifiedServiceMenu,
  isDcnetBeeswebPhoneNotFoundMenu,
  isDcnetBeeswebCpfNotFoundMenu,
} = require("../services/dcnetCustomerContext");
const {
  findCustomerByPhoneNumber,
  findCustomerByCpfDigits,
  normalizeCpf11,
} = require("../integrations/beesweb/customerLookup");
const { pickCustomerId, buildPhoneSearchTerms } = require("../integrations/beesweb/customers");
const { checkCoverageByGps } = require("../services/coverageService");

const COVERAGE_PANFLETO_HUMAN_WA = process.env.COVERAGE_PANFLETO_HUMAN_WA || "5561991374910";

function dcnetBeeswebDebug(payload) {
  if (process.env.DCNET_BEESWEB_DEBUG !== "1") return;
  console.log("[DCNET_BEESWEB_DEBUG]", JSON.stringify(payload));
}
const {
  MENSAGEM_PENDENCIA,
  pendenciaLeadPatch,
  MENSAGEM_CPF_INVALIDO,
  MENSAGEM_BEESWEB_CPF_CONSULTA_FALHOU,
  MENSAGEM_ESCALA_FINANCEIRO,
  MAX_BEESWEB_CPF_INVALID_ATTEMPTS,
  MENSAGEM_MENU_IDENTIFICADO_TELEFONE,
  INTENT_BEESWEB_IDENTIFIED_SERVICE_MENU,
  INTENT_BEESWEB_PHONE_NOT_FOUND_MENU,
  INTENT_BEESWEB_CPF_NOT_FOUND_MENU,
  MENSAGEM_PEDIDO_CPF,
  MENSAGEM_MENU_TELEFONE_NAO_LOCALIZADO,
  MENSAGEM_MENU_CPF_NAO_ENCONTRADO,
  MENSAGEM_MENU_FINANCEIRO_DOIS,
  INTENT_FINANCE_PAYMENT_MENU,
} = require("../services/dcnetOperationalBeesweb");

const router = express.Router();

/** Operador autorizado a enviar comando LIBERAR (somente dígitos, sem +) */
const MANUAL_RELEASE_AUTH_DIGITS = "5561996406911";
const OFFICIAL_HUMAN_WA_DIGITS = "5561996406911";
const MANUAL_RELEASE_FORMAT_ERROR = "Formato inválido. Use: LIBERAR 556196088711";
const MANUAL_RELEASE_NOT_FOUND = "Não encontrei lead para o telefone informado.";
const MANUAL_RELEASE_CLIENT_MSG =
  "✅ Pagamento confirmado com sucesso.\n\n" +
  "Seu atendimento foi regularizado e seu caso já foi encaminhado para continuidade normal.\n\n" +
  "Obrigado por enviar o comprovante.";

function digitsOnlyPhone(s) {
  return String(s || "").replace(/\D/g, "");
}

function isFinanceManualReleaseOperator(from) {
  return digitsOnlyPhone(from) === MANUAL_RELEASE_AUTH_DIGITS;
}

function buildPhoneLookupCandidates(commandDigits) {
  const d = digitsOnlyPhone(commandDigits);
  const list = [];
  const add = (x) => {
    if (x && !list.includes(x)) list.push(x);
  };
  if (!d) return list;
  add(d);
  if (!d.startsWith("55") && d.length >= 10) add("55" + d);
  if (d.startsWith("55") && d.length > 2) add(d.slice(2));
  return list;
}

/**
 * @param {string} rawText
 * @returns {{ error: "format" } | { candidates: string[] }}
 */
function parseLiberarCommand(rawText) {
  const normalized = String(rawText || "").trim().replace(/\s+/g, " ");
  const m = normalized.match(/^LIBERAR\s+(.+)$/i);
  if (!m) return { error: "format" };
  const digits = digitsOnlyPhone(m[1]);
  if (!digits || digits.length < 10) return { error: "format" };
  return { candidates: buildPhoneLookupCandidates(digits) };
}

/**
 * Liberação manual DC NET: só operador autorizado, comando LIBERAR &lt;telefone&gt;.
 * @returns {Promise<boolean>} true se tratou (sucesso ou erro ao humano); false para fluxo normal
 */
async function tryDcnetManualFinanceRelease({
  tenant,
  from,
  text,
  messageType,
  toPhoneId,
  waMessageId,
  inboundSummaryText,
  rawBody,
}) {
  if ((tenant || "").toLowerCase() !== "dcnet" || messageType !== "text") return false;
  if (!isFinanceManualReleaseOperator(from)) return false;
  const raw = String(text || "").trim();
  if (!/^LIBERAR\b/i.test(raw.replace(/\s+/g, " "))) return false;

  try {
    await WaMessage.create({
      tenant,
      channel: "whatsapp",
      origin: null,
      waMessageId,
      direction: "inbound",
      from,
      to: toPhoneId,
      text: inboundSummaryText,
      raw: rawBody != null ? rawBody : null,
    });
  } catch (e) {
    if (String(e?.code) !== "11000") {
      console.error("❌ manual release: inbound WaMessage:", e?.message || e);
    }
  }

  const parsed = parseLiberarCommand(raw);
  if (parsed.error) {
    try {
      const sent = await sendWhatsAppText(from, MANUAL_RELEASE_FORMAT_ERROR);
      await WaMessage.create({
        tenant,
        channel: "whatsapp",
        origin: null,
        wamid: sent?.messages?.[0]?.id,
        direction: "outbound",
        from: toPhoneId,
        to: from,
        text: MANUAL_RELEASE_FORMAT_ERROR,
        raw: sent,
      });
    } catch (e2) {
      console.error("❌ manual release: formato inválido resposta:", e2?.message || e2);
    }
    return true;
  }

  try {
    let targetLead = null;
    for (const phone of parsed.candidates) {
      const found = await Lead.findOne({ tenant: "dcnet", phone });
      if (found) {
        targetLead = found;
        break;
      }
    }

    if (!targetLead) {
      const sent = await sendWhatsAppText(from, MANUAL_RELEASE_NOT_FOUND);
      try {
        await WaMessage.create({
          tenant,
          channel: "whatsapp",
          origin: null,
          wamid: sent?.messages?.[0]?.id,
          direction: "outbound",
          from: toPhoneId,
          to: from,
          text: MANUAL_RELEASE_NOT_FOUND,
          raw: sent,
        });
      } catch (e3) {
        console.error("❌ manual release: not found outbound log:", e3?.message || e3);
      }
      return true;
    }

    const clientPhone = String(targetLead.phone || "").trim();
    if (!clientPhone) {
      const errMsg = "Lead encontrado sem telefone válido.";
      console.error("❌ manual release:", errMsg, { leadId: String(targetLead._id) });
      const sent = await sendWhatsAppText(from, errMsg);
      try {
        await WaMessage.create({
          tenant,
          channel: "whatsapp",
          origin: null,
          wamid: sent?.messages?.[0]?.id,
          direction: "outbound",
          from: toPhoneId,
          to: from,
          text: errMsg,
          raw: sent,
        });
      } catch (_) {}
      return true;
    }

    await Lead.updateOne(
      { _id: targetLead._id },
      {
        $set: {
          lastIntent: "finance_manual_release_done",
          requiresHumanFinancialReview: false,
          financialRetryCount: 0,
          lastFinancialIntentAt: new Date(),
          pixManualReleasedAt: new Date(),
          pixManualReleasedBy: MANUAL_RELEASE_AUTH_DIGITS,
          status: "resolvido",
          lastMessage: "[liberacao_manual_financeira]",
          origin: "whatsapp",
          channel: "whatsapp",
          tenant: "dcnet",
        },
      }
    );

    try {
      const sentClient = await sendWhatsAppText(clientPhone, MANUAL_RELEASE_CLIENT_MSG);
      await WaMessage.create({
        tenant,
        channel: "whatsapp",
        origin: null,
        wamid: sentClient?.messages?.[0]?.id,
        direction: "outbound",
        from: toPhoneId,
        to: clientPhone,
        text: MANUAL_RELEASE_CLIENT_MSG,
        raw: sentClient,
      });
    } catch (eClient) {
      console.error("❌ manual release: envio ao cliente falhou:", eClient?.message || eClient, {
        clientPhone,
      });
    }

    const okHuman = `✅ Cliente ${clientPhone} liberado com sucesso.`;
    const sentHuman = await sendWhatsAppText(from, okHuman);
    try {
      await WaMessage.create({
        tenant,
        channel: "whatsapp",
        origin: null,
        wamid: sentHuman?.messages?.[0]?.id,
        direction: "outbound",
        from: toPhoneId,
        to: from,
        text: okHuman,
        raw: sentHuman,
      });
    } catch (e4) {
      console.error("❌ manual release: outbound humano log:", e4?.message || e4);
    }

    return true;
  } catch (e) {
    console.error("❌ manual release: falha inesperada:", e?.message || e, { from, text });
    try {
      const sent = await sendWhatsAppText(
        from,
        "Não foi possível concluir a liberação. Verifique os dados e tente novamente."
      );
      const errHuman =
        "Não foi possível concluir a liberação. Verifique os dados e tente novamente.";
      await WaMessage.create({
        tenant,
        channel: "whatsapp",
        origin: null,
        wamid: sent?.messages?.[0]?.id,
        direction: "outbound",
        from: toPhoneId,
        to: from,
        text: errHuman,
        raw: sent,
      });
    } catch (e5) {
      console.error("❌ manual release: erro ao notificar humano:", e5?.message || e5);
    }
    return true;
  }
}

/**
 * DEDUPE em memória (evita responder duplicado em caso de retry da Meta)
 */
const seen = new Map();
const TTL_MS = 10 * 60 * 1000; // 10 min
const DCNET_SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 min

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

function isDcnetGreetingMessage(text) {
  const normalized = String(text || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[!?.;,]+/g, "")
    .replace(/\s+/g, " ");
  if (!normalized) return false;
  return (
    normalized === "oi" ||
    normalized === "ola" ||
    normalized === "bom dia" ||
    normalized === "boa tarde" ||
    normalized === "boa noite"
  );
}

function detectarPlanoPanfleto(msg) {
  if (!msg) return null;

  const m = msg.toLowerCase();

  if (m.includes("350")) return "350 Mega";
  if (m.includes("400")) return "400 Mega";
  if (m.includes("500")) return "500 Mega";
  if (m.includes("600")) return "600 Mega";

  return null;
}

function buildDcnetContextResetPatch() {
  return {
    lastIntent: null,
    status: null,
    requiresHumanFinancialReview: false,
    financialRetryCount: 0,
    lastFinancialIntentAt: null,
    beeswebCustomerId: null,
    beeswebIdentificationSkip: false,
    beeswebCpfInvalidAttempts: 0,
    beeswebCpfFromUnregisteredPhone: false,
    financeMenuTwoOptionsOnly: false,
  };
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
    const isImage = msg.type === "image";
    const isDocument = msg.type === "document";
    const messageType = msg.type || "text";
    const mediaId = (isImage && msg.image?.id) || (isDocument && msg.document?.id) || "";
    const mediaMimeType = (isImage && msg.image?.mime_type) || (isDocument && msg.document?.mime_type) || "";
    const mediaFilename = isDocument ? msg.document?.filename || "" : "";
    const mediaCaption = (isImage && msg.image?.caption) || (isDocument && msg.document?.caption) || "";

    const text = msg.text?.body || "";
    const location = msg.location || null;
    const isLocation = msg.type === "location" && Boolean(location);
    const toPhoneId = value?.metadata?.phone_number_id || "";

    const inboundSummaryText = isLocation
      ? `LOCATION:${location?.latitude},${location?.longitude}`
      : isImage || isDocument
        ? `[whatsapp:${messageType}:${mediaId || "unknown"}]` +
          (String(mediaCaption || "").trim() ? ` ${String(mediaCaption).trim().slice(0, 200)}` : "")
        : text;

    // resolve tenant (A: por PHONE_NUMBER_ID; B: fallback por texto)
    let tenant = resolveTenantFromPhoneNumberId(toPhoneId);
    if (!tenant) tenant = resolveTenantFromText(text);
    if (!tenant) tenant = "dcnet";

    console.log("📩 WhatsApp inbound:", {
      tenant,
      waMessageId,
      from,
      text,
      messageType,
      mediaId: mediaId || undefined,
    });

    if (wasSeen(waMessageId)) {
      console.log("🔁 DEDUPE: evento repetido ignorado:", waMessageId);
      return;
    }

    const manualReleaseHandled = await tryDcnetManualFinanceRelease({
      tenant,
      from,
      text,
      messageType,
      toPhoneId,
      waMessageId,
      inboundSummaryText,
      rawBody: req.body,
    });
    if (manualReleaseHandled) return;

    if (tenant === "dcnet" && messageType === "text") {
      const texto = text || "";
      const plano = detectarPlanoPanfleto(texto);
      if (plano) {
        const panfletoReply =
          "Perfeito! 🚀\n" +
          "Você escolheu o plano de " +
          plano +
          ".\n\n" +
          "Agora preciso verificar a cobertura na sua região.\n\n" +
          "📍 Por favor, envie sua localização para continuar.";
        try {
          await WaMessage.create({
            tenant,
            channel: "whatsapp",
            origin: null,

            waMessageId,
            direction: "inbound",
            from,
            to: toPhoneId,
            text: inboundSummaryText,
            raw: req.body,
          });
        } catch (e) {
          if (String(e?.code) !== "11000") {
            console.error("❌ Erro ao salvar inbound (panfleto):", e?.message || e);
          }
        }
        try {
          const sentPan = await sendLocationRequest(from, panfletoReply);
          try {
            await WaMessage.create({
              tenant,
              channel: "whatsapp",
              origin: null,
              wamid: sentPan?.messages?.[0]?.id,
              direction: "outbound",
              from: toPhoneId,
              to: from,
              text: panfletoReply,
              raw: sentPan,
            });
          } catch (e2) {
            console.error("❌ Erro ao salvar outbound (panfleto):", e2?.message || e2);
          }
        } catch (e) {
          console.error("❌ Erro ao enviar resposta (panfleto):", e?.message || e);
        }
        try {
          await Lead.findOneAndUpdate(
            { phone: from, tenant },
            {
              $set: {
                lastMessage: inboundSummaryText,
                lastIntent: "commercial_wait_location",
                status: "commercial_flow",
                origin: "whatsapp",
                channel: "whatsapp",
                tenant,
              },
            },
            { upsert: true }
          );
        } catch (e) {
          console.error("❌ Erro ao atualizar lead (panfleto):", e?.message || e);
        }
        return;
      }
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
        text: inboundSummaryText,
        raw: req.body,
      });
    } catch (e) {
      if (String(e?.code) !== "11000") {
        console.error("❌ Erro ao salvar inbound:", e?.message || e);
      }
    }

    let previousLeadBeforeInbound = null;
    if (tenant === "dcnet") {
      try {
        previousLeadBeforeInbound = await Lead.findOne({ phone: from, tenant }).lean();
      } catch (e) {
        console.error("⚠️ Erro ao carregar lead pré-update:", e?.message || e);
      }
    }

    const wasCommercialLocationRequest =
      tenant === "dcnet" &&
      isLocation &&
      String(previousLeadBeforeInbound?.lastIntent || "")
        .trim()
        .toLowerCase() === "commercial_wait_location";

    const shouldResetDcnetContextByGreeting =
      tenant === "dcnet" &&
      messageType === "text" &&
      !isLocation &&
      isDcnetGreetingMessage(text);
    const previousInteractionAt = previousLeadBeforeInbound?.updatedAt
      ? new Date(previousLeadBeforeInbound.updatedAt)
      : null;
    const idleMs =
      previousInteractionAt && Number.isFinite(previousInteractionAt.getTime())
        ? Date.now() - previousInteractionAt.getTime()
        : null;
    const shouldResetDcnetContextByTimeout =
      tenant === "dcnet" &&
      previousLeadBeforeInbound &&
      idleMs != null &&
      idleMs > DCNET_SESSION_TIMEOUT_MS;

    // atualiza/cria lead
    try {
      const leadSet = {
        lastMessage: isLocation ? "location_shared" : inboundSummaryText,
        origin: "whatsapp",
        channel: "whatsapp",
        tenant,
      };
      if (isLocation) leadSet.lastIntent = "location_shared";
      if (isLocation && tenant === "dcnet") leadSet.status = "handoff";

      await Lead.findOneAndUpdate(
        { phone: from, tenant },
        { $set: leadSet },
        { upsert: true, returnDocument: "after" }
      );

      if (shouldResetDcnetContextByGreeting || shouldResetDcnetContextByTimeout) {
        if (shouldResetDcnetContextByGreeting) {
          dcnetBeeswebDebug({
            step: "greeting_context_reset",
            from,
            text: String(text || "").trim().slice(0, 120),
          });
        }
        if (shouldResetDcnetContextByTimeout) {
          const idleMinutes = Number((idleMs / 60000).toFixed(1));
          dcnetBeeswebDebug({
            step: "session_timeout_context_reset",
            from,
            idleMinutes,
          });
        }
        await Lead.findOneAndUpdate(
          { phone: from, tenant },
          {
            $set: buildDcnetContextResetPatch(),
          },
          { upsert: true }
        );
      }
    } catch (e) {
      console.error("❌ Erro ao atualizar lead:", e?.message || e);
    }

    let convCtx = null;
    if (tenant === "dcnet") {
      try {
        convCtx = await resolveConversationContext({
          tenant,
          phone: from,
          origin: "whatsapp",
        });
        const lastIntent = (convCtx?.context?.lastIntent || "").toString().trim().toLowerCase();
        const inFinanceFlow = isDcnetFinanceFlowIntent(convCtx?.context?.lastIntent);
        const inHumanGeneralQueue = isDcnetHumanGeneralHandoffIntent(convCtx?.context?.lastIntent);
        const idSkip = Boolean(convCtx?.context?.beeswebIdentificationSkip);
        const inCommercialFlow =
          (convCtx?.context?.status || "").toString().trim().toLowerCase() === "commercial_flow" ||
          ["commercial_choose_plan", "commercial_wait_location"].includes(lastIntent);
        const awaitingCpf = isDcnetBeeswebIdentificationAwaitingCpf(convCtx?.context?.lastIntent);
        const skipIdentMenu = isDcnetBeeswebIdentifiedServiceMenu(convCtx?.context?.lastIntent);
        const skipPhoneNfMenu = isDcnetBeeswebPhoneNotFoundMenu(convCtx?.context?.lastIntent);
        const skipCpfNfMenu = isDcnetBeeswebCpfNotFoundMenu(convCtx?.context?.lastIntent);

        dcnetBeeswebDebug({
          step: "dcnet_gate_enter",
          tenant,
          from_raw: from,
          from_digits: String(from || "").replace(/\D/g, ""),
          build_phone_terms: buildPhoneSearchTerms(from),
          awaitingCpf,
          isLocation,
          lastIntent,
          inFinanceFlow,
          in_human_general_queue: inHumanGeneralQueue,
          idSkip,
          in_commercial_flow: inCommercialFlow,
          skip_identified_menu: skipIdentMenu,
          skip_phone_not_found_menu: skipPhoneNfMenu,
          skip_cpf_not_found_menu: skipCpfNfMenu,
        });

        if (!inFinanceFlow && !inHumanGeneralQueue && !inCommercialFlow) {
          if (
            idSkip ||
            lastIntent === "cpf_nao_encontrado" ||
            lastIntent === INTENT_BEESWEB_CPF_NOT_FOUND_MENU
          ) {
            // identificação já esgotada ou menu pós-CPF não encontrado: segue fluxo normal (sem novo pedido de CPF aqui)
          } else if (awaitingCpf && !isLocation && !isImage && !isDocument) {
            try {
              const prevInvalid = Number(convCtx?.context?.beeswebCpfInvalidAttempts || 0);
              const cpf11 = normalizeCpf11(text);
              if (!cpf11) {
                const nextInvalid = prevInvalid + 1;
                if (nextInvalid >= MAX_BEESWEB_CPF_INVALID_ATTEMPTS) {
                  const sentEsc = await sendDcnetFalarComAtendenteCta(from, MENSAGEM_ESCALA_FINANCEIRO);
                  try {
                    await Lead.findOneAndUpdate(
                      { phone: from, tenant },
                      {
                        $set: {
                          lastIntent: "finance_human_queue",
                          requiresHumanFinancialReview: true,
                          beeswebCpfInvalidAttempts: nextInvalid,
                          lastFinancialIntentAt: new Date(),
                          origin: "whatsapp",
                          channel: "whatsapp",
                          tenant,
                        },
                      },
                      { upsert: true }
                    );
                  } catch (e2) {
                    console.error("❌ Erro ao atualizar lead (CPF → humano):", e2?.message || e2);
                  }
                  try {
                    await notifyAdmin({
                      tenant: "dcnet",
                      from,
                      origin: "whatsapp",
                      message:
                        "DC NET WhatsApp: limite de tentativas de CPF inválido; encaminhado para atendimento humano.",
                    });
                  } catch (e3) {
                    console.error("⚠️ notifyAdmin CPF inválido:", e3?.message || e3);
                  }
                  try {
                    await WaMessage.create({
                      tenant,
                      channel: "whatsapp",
                      origin: null,
                      wamid: sentEsc?.messages?.[0]?.id,
                      direction: "outbound",
                      from: toPhoneId,
                      to: from,
                      text: dcnetFalarAtendenteOutboundLogText(MENSAGEM_ESCALA_FINANCEIRO),
                      raw: sentEsc,
                    });
                  } catch (e) {
                    console.error("❌ Erro ao salvar outbound escala CPF:", e?.message || e);
                  }
                  return;
                }
                const sentInv = await sendWhatsAppText(from, MENSAGEM_CPF_INVALIDO);
                try {
                  await Lead.findOneAndUpdate(
                    { phone: from, tenant },
                    {
                      $set: {
                        lastIntent: "cpf_invalido",
                        beeswebCpfInvalidAttempts: nextInvalid,
                        origin: "whatsapp",
                        channel: "whatsapp",
                        tenant,
                      },
                    },
                    { upsert: true }
                  );
                } catch (e2) {
                  console.error("❌ Erro ao atualizar lead (CPF inválido):", e2?.message || e2);
                }
                try {
                  await WaMessage.create({
                    tenant,
                    channel: "whatsapp",
                    origin: null,
                    wamid: sentInv?.messages?.[0]?.id,
                    direction: "outbound",
                    from: toPhoneId,
                    to: from,
                    text: MENSAGEM_CPF_INVALIDO,
                    raw: sentInv,
                  });
                } catch (e) {
                  console.error("❌ Erro ao salvar outbound CPF inválido:", e?.message || e);
                }
                return;
              }

              const cpfLookup = await findCustomerByCpfDigits(cpf11);
              if (cpfLookup.ok && cpfLookup.customer) {
                const cpfCustomerId = pickCustomerId(cpfLookup.customer);
                if (cpfLookup.isBlocked) {
                  const sentBlock = await sendWhatsAppText(from, MENSAGEM_PENDENCIA);
                  try {
                    await Lead.findOneAndUpdate(
                      { phone: from, tenant },
                      {
                        $set: {
                          ...pendenciaLeadPatch(),
                          beeswebCpfInvalidAttempts: 0,
                          beeswebIdentificationSkip: false,
                          origin: "whatsapp",
                          channel: "whatsapp",
                          tenant,
                          ...(cpfCustomerId ? { beeswebCustomerId: String(cpfCustomerId) } : {}),
                        },
                      },
                      { upsert: true }
                    );
                  } catch (e2) {
                    console.error("❌ Erro ao atualizar lead (bloqueio por CPF):", e2?.message || e2);
                  }
                  try {
                    await WaMessage.create({
                      tenant,
                      channel: "whatsapp",
                      origin: null,
                      wamid: sentBlock?.messages?.[0]?.id,
                      direction: "outbound",
                      from: toPhoneId,
                      to: from,
                      text: MENSAGEM_PENDENCIA,
                      raw: sentBlock,
                    });
                  } catch (e) {
                    console.error("❌ Erro ao salvar outbound bloqueio por CPF:", e?.message || e);
                  }
                  dcnetBeeswebDebug({ step: "branch_cpf_blocked_finance", from });
                  return;
                }

                const cid = pickCustomerId(cpfLookup.customer);
                const fromUnregPhone = Boolean(convCtx?.context?.beeswebCpfFromUnregisteredPhone);
                const bodyPosCpf = fromUnregPhone ? MENSAGEM_MENU_FINANCEIRO_DOIS : MENSAGEM_MENU_IDENTIFICADO_TELEFONE;
                const sentMenuCpf = await sendWhatsAppText(from, bodyPosCpf);
                try {
                  await Lead.findOneAndUpdate(
                    { phone: from, tenant },
                    {
                      $set: {
                        lastIntent: fromUnregPhone
                          ? INTENT_FINANCE_PAYMENT_MENU
                          : INTENT_BEESWEB_IDENTIFIED_SERVICE_MENU,
                        beeswebCpfInvalidAttempts: 0,
                        beeswebIdentificationSkip: false,
                        beeswebCpfFromUnregisteredPhone: false,
                        financeMenuTwoOptionsOnly: fromUnregPhone,
                        origin: "whatsapp",
                        channel: "whatsapp",
                        tenant,
                        ...(cid ? { beeswebCustomerId: String(cid) } : {}),
                      },
                    },
                    { upsert: true }
                  );
                } catch (e2) {
                  console.error("❌ Erro ao atualizar lead (CPF ativo → menu identificado):", e2?.message || e2);
                }
                try {
                  await WaMessage.create({
                    tenant,
                    channel: "whatsapp",
                    origin: null,
                    wamid: sentMenuCpf?.messages?.[0]?.id,
                    direction: "outbound",
                    from: toPhoneId,
                    to: from,
                    text: bodyPosCpf,
                    raw: sentMenuCpf,
                  });
                } catch (e) {
                  console.error("❌ Erro ao salvar outbound menu pós-CPF:", e?.message || e);
                }
                dcnetBeeswebDebug({
                  step: "branch_cpf_active_identified_menu",
                  from,
                  from_unregistered_phone_flow: fromUnregPhone,
                });
                return;
              } else if (cpfLookup.reason === "not_found") {
                const sentNf = await sendDcnetFalarComAtendenteCta(from, MENSAGEM_MENU_CPF_NAO_ENCONTRADO);
                try {
                  await Lead.findOneAndUpdate(
                    { phone: from, tenant },
                    {
                      $set: {
                        lastIntent: INTENT_BEESWEB_CPF_NOT_FOUND_MENU,
                        beeswebIdentificationSkip: true,
                        beeswebCpfInvalidAttempts: 0,
                        requiresHumanFinancialReview: false,
                        financialRetryCount: 0,
                        origin: "whatsapp",
                        channel: "whatsapp",
                        tenant,
                      },
                    },
                    { upsert: true }
                  );
                } catch (e2) {
                  console.error("❌ Erro ao atualizar lead (CPF não encontrado):", e2?.message || e2);
                }
                try {
                  await notifyAdmin({
                    tenant: "dcnet",
                    from,
                    origin: "whatsapp",
                    message:
                      "DC NET WhatsApp: CPF informado não localizado na BeesWeb (search). Menu de opções enviado ao cliente.",
                  });
                } catch (e3) {
                  console.error("⚠️ notifyAdmin CPF não encontrado:", e3?.message || e3);
                }
                try {
                  await WaMessage.create({
                    tenant,
                    channel: "whatsapp",
                    origin: null,
                    wamid: sentNf?.messages?.[0]?.id,
                    direction: "outbound",
                    from: toPhoneId,
                    to: from,
                    text: dcnetFalarAtendenteOutboundLogText(MENSAGEM_MENU_CPF_NAO_ENCONTRADO),
                    raw: sentNf,
                  });
                } catch (e) {
                  console.error("❌ Erro ao salvar outbound CPF não encontrado:", e?.message || e);
                }
                dcnetBeeswebDebug({ step: "branch_cpf_not_found", from });
                return;
              }

              const sentCpfErr = await sendWhatsAppText(from, MENSAGEM_BEESWEB_CPF_CONSULTA_FALHOU);
              try {
                await Lead.findOneAndUpdate(
                  { phone: from, tenant },
                  {
                    $set: {
                      lastIntent: "aguardando_cpf",
                      beeswebCpfInvalidAttempts: 0,
                      origin: "whatsapp",
                      channel: "whatsapp",
                      tenant,
                    },
                  },
                  { upsert: true }
                );
              } catch (e2) {
                console.error("❌ Erro ao atualizar lead (falha consulta CPF):", e2?.message || e2);
              }
              try {
                await notifyAdmin({
                  tenant: "dcnet",
                  from,
                  origin: "whatsapp",
                  message: `DC NET WhatsApp: falha na consulta CPF na BeesWeb (reason=${String(
                    cpfLookup?.reason || ""
                  )}). Cliente permanece em aguardando_cpf.`,
                });
              } catch (e3) {
                console.error("⚠️ notifyAdmin falha consulta CPF:", e3?.message || e3);
              }
              try {
                await WaMessage.create({
                  tenant,
                  channel: "whatsapp",
                  origin: null,
                  wamid: sentCpfErr?.messages?.[0]?.id,
                  direction: "outbound",
                  from: toPhoneId,
                  to: from,
                  text: MENSAGEM_BEESWEB_CPF_CONSULTA_FALHOU,
                  raw: sentCpfErr,
                });
              } catch (e) {
                console.error("❌ Erro ao salvar outbound falha consulta CPF:", e?.message || e);
              }
              dcnetBeeswebDebug({
                step: "branch_cpf_lookup_api_error",
                reason: cpfLookup?.reason || null,
              });
              return;
            } catch (e) {
              console.error("⚠️ Fluxo CPF DC NET:", e?.message || e);
              try {
                const sentEx = await sendWhatsAppText(from, MENSAGEM_BEESWEB_CPF_CONSULTA_FALHOU);
                try {
                  await Lead.findOneAndUpdate(
                    { phone: from, tenant },
                    {
                      $set: {
                        lastIntent: "aguardando_cpf",
                        origin: "whatsapp",
                        channel: "whatsapp",
                        tenant,
                      },
                    },
                    { upsert: true }
                  );
                } catch (e2) {
                  console.error("❌ Erro ao atualizar lead (exceção CPF):", e2?.message || e2);
                }
                try {
                  await WaMessage.create({
                    tenant,
                    channel: "whatsapp",
                    origin: null,
                    wamid: sentEx?.messages?.[0]?.id,
                    direction: "outbound",
                    from: toPhoneId,
                    to: from,
                    text: MENSAGEM_BEESWEB_CPF_CONSULTA_FALHOU,
                    raw: sentEx,
                  });
                } catch (e4) {
                  console.error("❌ Erro ao salvar outbound exceção CPF:", e4?.message || e4);
                }
              } catch (e5) {
                console.error("⚠️ Falha ao enviar mensagem pós-exceção CPF:", e5?.message || e5);
              }
              dcnetBeeswebDebug({ step: "branch_cpf_lookup_exception", message: String(e?.message || e) });
              return;
            }
          } else if (!awaitingCpf && !isLocation) {
            if (skipIdentMenu || skipPhoneNfMenu || skipCpfNfMenu) {
              dcnetBeeswebDebug({
                step: "branch_skip_menus_no_lookup",
                skip_identified_menu: skipIdentMenu,
                skip_phone_not_found_menu: skipPhoneNfMenu,
                skip_cpf_not_found_menu: skipCpfNfMenu,
              });
              // já exibiu menu pós-telefone ou pós-CPF; não reconsulta a BeesWeb aqui
            } else {
            try {
              const fromDigits = digitsOnlyPhone(from);
              if (fromDigits === OFFICIAL_HUMAN_WA_DIGITS) {
                dcnetBeeswebDebug({
                  step: "lookup_skipped_official_human_number",
                  from,
                  from_digits: fromDigits,
                });
                return;
              }
              const beeswebLookup = await findCustomerByPhoneNumber(from);
              dcnetBeeswebDebug({
                step: "lookup_result",
                ok: beeswebLookup.ok,
                reason: beeswebLookup.reason,
                isBlocked: beeswebLookup.isBlocked,
                customer_id: beeswebLookup.customer?.id,
                customer_phone_number_only: beeswebLookup.customer?.phone?.number_only,
              });
              if (beeswebLookup.ok && beeswebLookup.isBlocked) {
                dcnetBeeswebDebug({ step: "branch_blocked_finance", from });
                const sentBlock = await sendWhatsAppText(from, MENSAGEM_PENDENCIA);
                try {
                  await Lead.findOneAndUpdate(
                    { phone: from, tenant },
                    {
                      $set: {
                        ...pendenciaLeadPatch(),
                        origin: "whatsapp",
                        channel: "whatsapp",
                        tenant,
                      },
                    },
                    { upsert: true }
                  );
                } catch (e2) {
                  console.error("❌ Erro ao atualizar lead (bloqueio financeiro):", e2?.message || e2);
                }
                try {
                  await WaMessage.create({
                    tenant,
                    channel: "whatsapp",
                    origin: null,
                    wamid: sentBlock?.messages?.[0]?.id,
                    direction: "outbound",
                    from: toPhoneId,
                    to: from,
                    text: MENSAGEM_PENDENCIA,
                    raw: sentBlock,
                  });
                } catch (e) {
                  console.error("❌ Erro ao salvar outbound bloqueio financeiro:", e?.message || e);
                }
                return;
              }
              if (beeswebLookup.ok && beeswebLookup.customer && !beeswebLookup.isBlocked) {
                dcnetBeeswebDebug({ step: "branch_active_identified_menu", from });
                const phoneCustomerId = pickCustomerId(beeswebLookup.customer);
                const sentMenu = await sendWhatsAppText(from, MENSAGEM_MENU_IDENTIFICADO_TELEFONE);
                try {
                  await Lead.findOneAndUpdate(
                    { phone: from, tenant },
                    {
                      $set: {
                        beeswebCpfInvalidAttempts: 0,
                        beeswebIdentificationSkip: false,
                        origin: "whatsapp",
                        channel: "whatsapp",
                        tenant,
                        lastIntent: INTENT_BEESWEB_IDENTIFIED_SERVICE_MENU,
                        ...(phoneCustomerId ? { beeswebCustomerId: String(phoneCustomerId) } : {}),
                      },
                    },
                    { upsert: true }
                  );
                } catch (e2) {
                  console.error("❌ Erro ao atualizar lead (menu pós-telefone ativo):", e2?.message || e2);
                }
                try {
                  await WaMessage.create({
                    tenant,
                    channel: "whatsapp",
                    origin: null,
                    wamid: sentMenu?.messages?.[0]?.id,
                    direction: "outbound",
                    from: toPhoneId,
                    to: from,
                    text: MENSAGEM_MENU_IDENTIFICADO_TELEFONE,
                    raw: sentMenu,
                  });
                } catch (e) {
                  console.error("❌ Erro ao salvar outbound menu pós-telefone:", e?.message || e);
                }
                return;
              }
              if (!beeswebLookup.ok) {
                const isNotFound = beeswebLookup.reason === "not_found";
                dcnetBeeswebDebug({
                  step: isNotFound ? "branch_phone_not_found_menu" : "branch_phone_lookup_unavailable",
                  from,
                  reason: beeswebLookup.reason,
                });
                if (!isNotFound) {
                  try {
                    await notifyAdmin({
                      tenant: "dcnet",
                      from,
                      origin: "whatsapp",
                      message: `DC NET WhatsApp: busca por telefone indisponível (reason=${String(
                        beeswebLookup.reason || ""
                      )}). Exibido menu Já sou cliente / Ainda não sou cliente (evita menu geral 1-4).`,
                    });
                  } catch (e3) {
                    console.error("⚠️ notifyAdmin lookup telefone indisponível:", e3?.message || e3);
                  }
                }
                const sentMenuNf = await sendDcnetFalarComAtendenteCta(from, MENSAGEM_MENU_TELEFONE_NAO_LOCALIZADO);
                try {
                  await Lead.findOneAndUpdate(
                    { phone: from, tenant },
                    {
                      $set: {
                        lastIntent: INTENT_BEESWEB_PHONE_NOT_FOUND_MENU,
                        beeswebCpfInvalidAttempts: 0,
                        beeswebIdentificationSkip: false,
                        requiresHumanFinancialReview: false,
                        financialRetryCount: 0,
                        origin: "whatsapp",
                        channel: "whatsapp",
                        tenant,
                      },
                    },
                    { upsert: true }
                  );
                } catch (e2) {
                  console.error("❌ Erro ao atualizar lead (menu telefone não localizado):", e2?.message || e2);
                }
                try {
                  await WaMessage.create({
                    tenant,
                    channel: "whatsapp",
                    origin: null,
                    wamid: sentMenuNf?.messages?.[0]?.id,
                    direction: "outbound",
                    from: toPhoneId,
                    to: from,
                    text: dcnetFalarAtendenteOutboundLogText(MENSAGEM_MENU_TELEFONE_NAO_LOCALIZADO),
                    raw: sentMenuNf,
                  });
                } catch (e) {
                  console.error("❌ Erro ao salvar outbound menu telefone não localizado:", e?.message || e);
                }
                return;
              }
              dcnetBeeswebDebug({
                step: "branch_lookup_no_early_return",
                ok: beeswebLookup.ok,
                reason: beeswebLookup.reason,
                hint: "fallback seguro para menu 1/2 (evita menu geral)",
              });
              const sentMenuNfFallback = await sendDcnetFalarComAtendenteCta(from, MENSAGEM_MENU_TELEFONE_NAO_LOCALIZADO);
              try {
                await Lead.findOneAndUpdate(
                  { phone: from, tenant },
                  {
                    $set: {
                      lastIntent: INTENT_BEESWEB_PHONE_NOT_FOUND_MENU,
                      beeswebCpfInvalidAttempts: 0,
                      beeswebIdentificationSkip: false,
                      requiresHumanFinancialReview: false,
                      financialRetryCount: 0,
                      origin: "whatsapp",
                      channel: "whatsapp",
                      tenant,
                    },
                  },
                  { upsert: true }
                );
              } catch (e2) {
                console.error("❌ Erro ao atualizar lead (fallback menu telefone não localizado):", e2?.message || e2);
              }
              try {
                await WaMessage.create({
                  tenant,
                  channel: "whatsapp",
                  origin: null,
                  wamid: sentMenuNfFallback?.messages?.[0]?.id,
                  direction: "outbound",
                  from: toPhoneId,
                  to: from,
                  text: dcnetFalarAtendenteOutboundLogText(MENSAGEM_MENU_TELEFONE_NAO_LOCALIZADO),
                  raw: sentMenuNfFallback,
                });
              } catch (e) {
                console.error("❌ Erro ao salvar outbound fallback menu telefone não localizado:", e?.message || e);
              }
              return;
            } catch (e) {
              console.error("⚠️ BeesWeb lookup (bloqueio cadastro):", e?.message || e);
              dcnetBeeswebDebug({ step: "lookup_exception", message: String(e?.message || e) });
              const sentMenuNfException = await sendDcnetFalarComAtendenteCta(from, MENSAGEM_MENU_TELEFONE_NAO_LOCALIZADO);
              try {
                await Lead.findOneAndUpdate(
                  { phone: from, tenant },
                  {
                    $set: {
                      lastIntent: INTENT_BEESWEB_PHONE_NOT_FOUND_MENU,
                      beeswebCpfInvalidAttempts: 0,
                      beeswebIdentificationSkip: false,
                      requiresHumanFinancialReview: false,
                      financialRetryCount: 0,
                      origin: "whatsapp",
                      channel: "whatsapp",
                      tenant,
                    },
                  },
                  { upsert: true }
                );
              } catch (e2) {
                console.error("❌ Erro ao atualizar lead (exceção menu telefone não localizado):", e2?.message || e2);
              }
              try {
                await WaMessage.create({
                  tenant,
                  channel: "whatsapp",
                  origin: null,
                  wamid: sentMenuNfException?.messages?.[0]?.id,
                  direction: "outbound",
                  from: toPhoneId,
                  to: from,
                  text: dcnetFalarAtendenteOutboundLogText(MENSAGEM_MENU_TELEFONE_NAO_LOCALIZADO),
                  raw: sentMenuNfException,
                });
              } catch (e4) {
                console.error("❌ Erro ao salvar outbound exceção menu telefone não localizado:", e4?.message || e4);
              }
              return;
            }
            }
          }
        } else {
          dcnetBeeswebDebug({
            step: "dcnet_gate_skipped_finance_or_human_queue",
            inFinanceFlow,
            in_human_general_queue: inHumanGeneralQueue,
            lastIntent,
          });
        }
      } catch (e) {
        console.error("⚠️ Contexto pré-regras DC NET:", e?.message || e);
      }
    }

    if (isLocation) {
      if (tenant === "dcnet" && wasCommercialLocationRequest && location) {
        let cov;
        try {
          cov = await checkCoverageByGps({
            tenant: "dcnet",
            lat: location.latitude,
            lng: location.longitude,
          });
        } catch (e) {
          console.error("❌ checkCoverageByGps:", e?.message || e);
          cov = { ok: true, covered: false, area: null, distanceMeters: null, reason: "invalid_location" };
        }

        const areaName = cov.covered && cov.area ? String(cov.area.name || "").trim() : "";

        try {
          await Lead.findOneAndUpdate(
            { phone: from, tenant: "dcnet" },
            {
              $set: {
                lastMessage: inboundSummaryText,
                lastIntent: "location_shared",
                status: "handoff",
                coverageStatus: cov.covered
                  ? "covered"
                  : cov.reason === "invalid_location"
                    ? "invalid"
                    : "outside",
                coverageAreaName: cov.covered ? (areaName || null) : null,
                coverageLat: location.latitude,
                coverageLng: location.longitude,
                origin: "whatsapp",
                channel: "whatsapp",
                tenant: "dcnet",
              },
            },
            { upsert: true }
          );
        } catch (e) {
          console.error("❌ lead atualização cobertura:", e?.message || e);
        }

        let outBody;
        if (cov.reason === "invalid_location") {
          outBody =
            "Não conseguimos processar a localização enviada. Por favor, toque no clip 📎 e envie a localização novamente.";
        } else if (cov.covered) {
          outBody =
            "Excelente! Sua região possui cobertura DC NET.\n\n" +
            "Para o *pré-cadastro*, responda em uma única mensagem com:\n" +
            "• Nome completo\n" +
            "• CPF\n" +
            "• Melhor horário para contato\n\n" +
            "Obrigado!";
        } else {
          outBody =
            "Recebemos sua localização. Neste ponto ainda *estamos analisando* a viabilidade; nossa equipe comercial retornará o mais breve possível.\n\n" +
            "Obrigado por entrar em contato!";
        }

        try {
          const sentCov = await sendWhatsAppText(from, outBody);
          await WaMessage.create({
            tenant: "dcnet",
            channel: "whatsapp",
            origin: null,
            wamid: sentCov?.messages?.[0]?.id,
            direction: "outbound",
            from: toPhoneId,
            to: from,
            text: outBody,
            raw: sentCov,
          });
        } catch (e) {
          console.error("❌ outbound cobertura (cliente):", e?.message || e);
        }

        if (!cov.covered && cov.reason !== "invalid_location") {
          try {
            const humanText =
              "📍 Lead Panfleto / cobertura (fora ou pendente)\n" +
              "Cliente: " +
              from +
              "\n" +
              "Geo: " +
              location.latitude +
              ", " +
              location.longitude +
              "\n" +
              "Verificação: " +
              cov.reason +
              (cov.distanceMeters != null ? " (≈" + cov.distanceMeters + "m do círculo)" : "");
            await sendWhatsAppText(COVERAGE_PANFLETO_HUMAN_WA, humanText);
          } catch (e) {
            console.error("❌ notificar humano panfleto (cobertura):", e?.message || e);
          }
          try {
            await notifyAdmin({
              tenant: "dcnet",
              from,
              origin: "whatsapp",
              message:
                "Cobertura GPS: fora/sem área ativa — " +
                from +
                " (" +
                String(cov.reason) +
                ")",
            });
          } catch (e) {
            console.error("⚠️ notifyAdmin cobertura:", e?.message || e);
          }
        }

        return;
      }

      const confirmText =
        tenant === "dcnet"
          ? mensagemPosEnvioLocalizacaoComercialDcnet()
          : "Recebi sua localização com sucesso 👍 Agora vou seguir com seu atendimento.";
      const sentConfirm =
        tenant === "dcnet"
          ? await sendDcnetFalarComAtendenteCta(from, confirmText)
          : await sendWhatsAppText(from, confirmText);

      try {
        await WaMessage.create({
          tenant,
          channel: "whatsapp",
          origin: null,
          wamid: sentConfirm?.messages?.[0]?.id,
          direction: "outbound",
          from: toPhoneId,
          to: from,
          text: tenant === "dcnet" ? dcnetFalarAtendenteOutboundLogText(confirmText) : confirmText,
          raw: sentConfirm,
        });
      } catch (e) {
        console.error("❌ Erro ao salvar outbound confirmação localização:", e?.message || e);
      }

      if (tenant === "dcnet") {
        try {
          await notifyAdmin({
            tenant: "dcnet",
            from,
            origin: "whatsapp",
            message:
              "Handoff comercial: cliente enviou localização (DC NET WhatsApp). Lead marcado como handoff.",
          });
        } catch (e) {
          console.error("⚠️ notifyAdmin pós-localização DC NET:", e?.message || e);
        }
      }

      return;
    }

    // regras
    if (!convCtx) {
      convCtx = await resolveConversationContext({
        tenant,
        phone: from,
        origin: "whatsapp",
      });
    }

    if (tenant === "dcnet") {
      dcnetBeeswebDebug({
        step: "fallthrough_to_rules",
        from,
        lastIntent_before_rules: convCtx?.context?.lastIntent || null,
      });
    }

    let beesweb = null;
    if (
      shouldPrefetchBeeswebForDcnetWhatsapp({
        tenant,
        origin: "whatsapp",
        message: text,
        context: convCtx.context,
      })
    ) {
      try {
        beesweb = await loadDcnetBeeswebSnapshotForPhone(from, { includeRaw: false });
      } catch (e) {
        console.error("⚠️ BeesWeb snapshot DC NET:", e?.message || e);
        beesweb = { ok: false, configured: true, skipped: false, error: "beesweb_snapshot_exception" };
      }
    }

    const result = await replyFromRules({
      tenant,
      message: text,
      messageType: messageType || "text",
      mediaId,
      mediaMimeType,
      mediaFilename,
      mediaCaption,
      origin: "whatsapp",
      page: "whatsapp",
      phone: from,
      customer: convCtx.customer,
      history: convCtx.history,
      context: convCtx.context,
      maintenance: convCtx.maintenance,
      beesweb,
    });

    const replyText =
      typeof result === "string" ? result : (result?.reply || "Ok.");

    const dcnetUsaCtaAtendimento =
      tenant === "dcnet" &&
      result &&
      typeof result === "object" &&
      result.falarComAtendenteCta === true;

    const outboundLogText = dcnetUsaCtaAtendimento
      ? dcnetFalarAtendenteOutboundLogText(replyText)
      : replyText;

    console.log("🤖 Reply rules:", replyText);

    if (result && typeof result === "object" && result.adminNotify?.message) {
      try {
        await notifyAdmin({
          tenant,
          from,
          origin: "whatsapp",
          message: result.adminNotify.message,
        });
      } catch (e) {
        console.error("⚠️ notifyAdmin (BeesWeb operacional):", e?.message || e);
      }
    }

    const boletoIx =
      tenant === "dcnet" &&
      result &&
      typeof result === "object" &&
      result.boletoInteractive &&
      typeof result.boletoInteractive === "object"
        ? result.boletoInteractive
        : null;
    const boletoUrl = boletoIx ? String(boletoIx.link || "").trim() : "";

    let sent = null;
    if (boletoUrl) {
      try {
        sent = await sendWhatsAppText(from, replyText, { previewUrl: true });
      } catch (e) {
        console.error("❌ outbound boleto premium (preview_url):", e?.message || e);
        try {
          sent = await sendWhatsAppText(from, replyText);
        } catch (e2) {
          console.error("❌ outbound boleto texto (fallback sem preview):", e2?.message || e2);
        }
      }
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
        console.error("❌ Erro ao salvar outbound (boleto premium texto):", e?.message || e);
      }
      try {
        const ctaBody =
          (typeof boletoIx.ctaBody === "string" && boletoIx.ctaBody.trim()) ||
          "Toque no botão abaixo para abrir seu boleto.";
        const btnText =
          (typeof boletoIx.buttonText === "string" && boletoIx.buttonText.trim()) || "Abrir boleto";
        const sentCta = await sendWhatsAppCtaUrlButton(from, ctaBody, btnText, boletoUrl);
        try {
          await WaMessage.create({
            tenant,
            channel: "whatsapp",
            origin: null,
            wamid: sentCta?.messages?.[0]?.id,
            direction: "outbound",
            from: toPhoneId,
            to: from,
            text: "[interactive:cta_url]",
            raw: sentCta,
          });
        } catch (e) {
          console.error("❌ Erro ao salvar outbound CTA URL:", e?.message || e);
        }
      } catch (e) {
        console.error("❌ outbound boleto CTA URL:", e?.message || e);
      }
    } else if (dcnetUsaCtaAtendimento) {
      try {
        sent = await sendDcnetFalarComAtendenteCta(from, replyText);
      } catch (e) {
        console.error("❌ outbound DC NET CTA (Falar com atendente):", e?.message || e);
        sent = await sendWhatsAppText(from, replyText);
      }
    } else {
      sent = await sendWhatsAppText(from, replyText);
    }

    if (result && typeof result === "object" && result.requestLocation) {
      const locationPrompt =
        (typeof result.locationPrompt === "string" && result.locationPrompt.trim()) ||
        "Perfeito 👍 Para agilizar sua consulta de cobertura e instalação, toque no botão abaixo e me envie sua localização.";
      const sentLocationRequest = await sendLocationRequest(from, locationPrompt);

      try {
        await WaMessage.create({
          tenant,
          channel: "whatsapp",
          origin: null,
          wamid: sentLocationRequest?.messages?.[0]?.id,
          direction: "outbound",
          from: toPhoneId,
          to: from,
          text: "[location_request_sent]",
          raw: sentLocationRequest,
        });
      } catch (e) {
        console.error("❌ Erro ao salvar outbound location request:", e?.message || e);
      }
    }

    // salva outbound (fluxo padrão; boleto premium grava texto + CTA no bloco acima)
    if (!boletoUrl) {
      try {
        await WaMessage.create({
          tenant,
          channel: "whatsapp",
          origin: null,

          wamid: sent?.messages?.[0]?.id,
          direction: "outbound",
          from: toPhoneId,
          to: from,
          text: outboundLogText,
          raw: sent,
        });
      } catch (e) {
        console.error("❌ Erro ao salvar outbound:", e?.message || e);
      }
    }

    // atualiza lead (intent)
    try {
      const leadPatch =
        result && typeof result === "object" && result.leadPatch && typeof result.leadPatch === "object"
          ? result.leadPatch
          : {};
      const intentFromPatch = leadPatch.lastIntent != null ? leadPatch.lastIntent : null;
      const intentFromResult =
        typeof result === "object" && result.intent != null ? result.intent : null;

      await Lead.findOneAndUpdate(
        { phone: from, tenant },
        {
          $set: {
            lastIntent: intentFromPatch || intentFromResult,
            lastMessage: replyText,
            channel: "whatsapp",
            tenant,
            ...(beesweb && beesweb.customerId ? { beeswebCustomerId: String(beesweb.customerId) } : {}),
            ...leadPatch,
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
