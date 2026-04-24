"use strict";

const {
  isFinanceOperationalMessage,
  isSupportOperationalMessage,
} = require("../constants/dcnetOperationalKeywords");
const { getPrimaryPendingChargeForCustomer } = require("../integrations/beesweb/charges");
const {
  sendWhatsAppText,
  getWhatsAppMediaUrl,
  downloadWhatsAppMediaBuffer,
  uploadWhatsAppOutboundMedia,
  sendWhatsAppImageByUploadedId,
  sendWhatsAppDocumentByUploadedId,
} = require("./whatsappSend");

const FINANCE_PIX_COMPROVANTE_FORWARD_TO = "5561996406911";

/** Menu de pendência (novo); leads antigos podem ainda estar em finance_pending_choice */
const INTENT_FINANCE_PAYMENT_MENU = "finance_payment_menu";

const MENSAGEM_PENDENCIA =
  "⚠️ Identificamos uma pendência financeira no seu cadastro.\n\n" +
  "Escolha uma opção:\n\n" +
  "1️⃣ Receber boleto\n" +
  "2️⃣ Receber Pix\n" +
  "3️⃣ Falar com atendimento\n\n" +
  "📄 Após o pagamento, o sistema identifica automaticamente.\n" +
  "Caso precise, envie o comprovante para agilizar.";

const MENSAGEM_PIX =
  "Perfeito 👍\n\n" +
  "Segue a chave Pix para pagamento:\n\n" +
  "💠 *Chave Pix (CNPJ):* 63.899.571/0001-20\n" +
  "🏢 *Nome:* DCNET Infinity\n\n" +
  "📋 *Copie a chave abaixo:*\n" +
  "`63.899.571/0001-20`\n\n" +
  "📄 Após o pagamento, envie o comprovante por aqui para conferência.";

const MENSAGEM_ESCALA_FINANCEIRO =
  "Seu caso foi encaminhado para nosso atendimento financeiro.\n\n" +
  "Um responsável continuará com você por aqui para dar sequência.";

/** Fila humana geral (ex.: opção 4 do menu identificado); não é fluxo financeiro */
const INTENT_HUMAN_GENERAL_QUEUE = "human_general_queue";

const MENSAGEM_ESCALA_ATENDIMENTO_GERAL =
  "Seu atendimento foi encaminhado para nosso suporte para continuidade.";

/** Texto enviado após "Já sou cliente" no menu de telefone não localizado */
const MENSAGEM_PEDIDO_CPF =
  "🔐 Para localizar seu cadastro com segurança, por favor informe seu CPF (somente números).\n\n" +
  "📱 Se o seu número foi alterado recentemente, solicite também a atualização cadastral com nossa operadora pelo *WhatsApp oficial* (toque no botão abaixo, se preferir).";

/** Pedido de CPF no fluxo operacional (telefone não casou na BeesWeb). */
const MENSAGEM_PEDIDO_CPF_SIMPLES = "Para te ajudar melhor, por favor informe seu CPF 🙏";

/** Pós-identificação por telefone na BeesWeb (cliente ativo); WhatsApp DC NET */
const INTENT_BEESWEB_IDENTIFIED_SERVICE_MENU = "beesweb_identified_service_menu";

/** Telefone não encontrado na BeesWeb: escolha antes do CPF */
const INTENT_BEESWEB_PHONE_NOT_FOUND_MENU = "beesweb_phone_not_found_menu";

/** CPF não localizado na BeesWeb: próximos passos sem assumir cliente */
const INTENT_BEESWEB_CPF_NOT_FOUND_MENU = "beesweb_cpf_not_found_menu";

const MENSAGEM_MENU_IDENTIFICADO_TELEFONE =
  "✅ Olá, localizamos seu cadastro na DC NET.\n\n" +
  "Escolha uma opção:\n\n" +
  "1️⃣ Planos\n2️⃣ Suporte\n3️⃣ Financeiro\n4️⃣ Falar com atendente";

const MENSAGEM_MENU_IDENTIFICADO_OPCAO_INVALIDA =
  "⚠️ Opção inválida.\n\n" +
  "Escolha uma das opções abaixo:\n\n" +
  "1️⃣ Planos\n2️⃣ Suporte\n3️⃣ Financeiro\n4️⃣ Falar com atendente";

const MENSAGEM_MENU_TELEFONE_NAO_LOCALIZADO =
  "⚠️ Não localizamos este telefone em nosso cadastro.\n\n" +
  "Para continuarmos seu atendimento, escolha uma opção:\n\n" +
  "1️⃣ Já sou cliente\n" +
  "2️⃣ Ainda não sou cliente";

const MENSAGEM_MENU_TELEFONE_NAO_LOCALIZADO_OPCAO_INVALIDA =
  "⚠️ Opção inválida.\n\n" +
  "Responda com *1* (Já sou cliente) ou *2* (Ainda não sou cliente).";

/** Pós-CPF quando o telefone não casou: só boleto e Pix (sem opção 3). */
const MENSAGEM_MENU_FINANCEIRO_DOIS =
  "Escolha uma opção:\n\n" + "1️⃣ Boleto\n" + "2️⃣ PIX";

const MENSAGEM_COMERCIAL_NOVO_CLIENTE =
  "Confira nossos planos:\n\n" +
  "🔹 350 Mega — R$78,99\n" +
  "🔹 400 Mega — R$88,99\n" +
  "🔹 500 Mega — R$98,99\n" +
  "🔹 600 Mega — R$119,99\n\n" +
  "👉 Responda com o plano desejado.";

const MENSAGEM_MENU_CPF_NAO_ENCONTRADO =
  "Não localizamos esse CPF em nosso cadastro.\n\n" +
  "Escolha uma opção:\n\n" +
  "1️⃣ Tentar novamente\n2️⃣ Quero contratar internet";

const MENSAGEM_MENU_CPF_NAO_ENCONTRADO_OPCAO_INVALIDA =
  "⚠️ Opção inválida.\n\n" +
  "Responda com:\n1️⃣ Tentar novamente\n2️⃣ Quero contratar internet";

const MENSAGEM_CPF_INVALIDO =
  "Esse CPF não parece válido. Envie *somente os 11 números* do CPF, sem pontos ou traços.";

/** @deprecated use MENSAGEM_MENU_CPF_NAO_ENCONTRADO — mantido para imports legados */
const MENSAGEM_CPF_NAO_ENCONTRADO = MENSAGEM_MENU_CPF_NAO_ENCONTRADO;

/** Falha técnica na consulta CPF (BeesWeb); mantém tentativa sem abrir comercial genérico */
const MENSAGEM_BEESWEB_CPF_CONSULTA_FALHOU =
  "Não conseguimos consultar seu cadastro no momento (falha temporária na verificação).\n\n" +
  "Por favor, tente enviar seu CPF novamente em alguns instantes.";

const MAX_BEESWEB_CPF_INVALID_ATTEMPTS = 3;

function hasDcnetBeeswebCustomerIdentification(ctx, snap) {
  const c = ctx?.context || {};
  if (String(c.beeswebCustomerId || "").trim()) return true;
  const b = snap || ctx?.beesweb;
  if (b && b.customerFound && String(b.customerId || "").trim()) return true;
  return false;
}

function logDcnetFlow(ctx, snap, extra = {}) {
  const phone = String(ctx?.phone || ctx?.from || "").trim();
  const c = ctx?.context || {};
  const b = snap || ctx?.beesweb;
  const customerFound = Boolean(b && b.customerFound);
  const cpfStep = String(c.beeswebCustomerId || "").trim() ? "identified" : "not_identified";
  console.log("[dcnet_flow]", { phone, customerFound, cpfStep, ...extra });
}

function logDcnetRoute(ctx, detectedIntent, nextStep, extra = {}) {
  const phone = String(ctx?.phone || ctx?.from || "").trim();
  const identifiedCustomer = hasDcnetBeeswebCustomerIdentification(ctx, ctx?.beesweb);
  console.log("[dcnet_route]", { phone, detectedIntent, identifiedCustomer, nextStep, ...extra });
}

function identificationRequiredReply(ctx, adminNotifyMessage, meta = {}) {
  const detectedIntent = meta.detectedIntent != null ? meta.detectedIntent : "operacional";
  logDcnetRoute(ctx, detectedIntent, "pedir_cpf", { branch: meta.branch || "identification_required" });
  const out = {
    reply: MENSAGEM_PEDIDO_CPF_SIMPLES,
    intent: "aguardando_cpf",
    leadPatch: {
      lastIntent: "aguardando_cpf",
      beeswebCpfInvalidAttempts: 0,
      requiresHumanFinancialReview: false,
      financeMenuTwoOptionsOnly: false,
    },
  };
  if (adminNotifyMessage) {
    out.adminNotify = { message: adminNotifyMessage };
  }
  return out;
}

function pendenciaLeadPatch() {
  return {
    lastIntent: INTENT_FINANCE_PAYMENT_MENU,
    lastFinancialIntentAt: new Date(),
    financialRetryCount: 0,
    financeMenuTwoOptionsOnly: false,
  };
}

function isFinancePaymentMenuIntent(lastIntent) {
  const li = (lastIntent || "").toString().trim().toLowerCase();
  return li === INTENT_FINANCE_PAYMENT_MENU || li === "finance_pending_choice";
}

function financeEscalationLeadPatch() {
  return {
    lastIntent: "finance_human_queue",
    requiresHumanFinancialReview: true,
    lastFinancialIntentAt: new Date(),
    financeMenuTwoOptionsOnly: false,
  };
}

/** Libera continuidade “morta” do fluxo financeiro (lastIntent + fila humana financeira) sem apagar identificação BeesWeb. */
function buildDcnetFinanceSoftLockReleaseLeadPatch() {
  return {
    lastIntent: null,
    requiresHumanFinancialReview: false,
    lastFinancialIntentAt: null,
    financialRetryCount: 0,
  };
}

/**
 * Texto premium do boleto (link no corpo para preview_url no envio WhatsApp).
 * @param {object|null|undefined} charge
 */
function buildChargeBackedBoletoPremiumText(charge) {
  const lines = [];
  lines.push("📄 *Seu boleto está pronto!*");
  lines.push("");
  if (charge?.description && String(charge.description).trim()) {
    lines.push(`🧾 ${String(charge.description).trim()}`);
  }
  if (charge?.value != null && String(charge.value).trim() !== "") {
    lines.push(`💰 Valor: R$ ${String(charge.value).trim()}`);
  }
  if (charge?.due_date && String(charge.due_date).trim()) {
    lines.push(`📅 Vencimento: ${String(charge.due_date).trim()}`);
  }
  lines.push("");
  const link = String(charge?.link || "").trim();
  if (link) {
    lines.push("🔗 Boleto:");
    lines.push(link);
  }
  lines.push("");
  lines.push("✅ Assim que o pagamento for identificado, seu acesso será liberado automaticamente.");
  lines.push("");
  lines.push("🙏 Obrigado por regularizar com a DCNET Infinity!");
  return lines.join("\n");
}

/**
 * Texto do boleto a partir da linha retornada por GET /adm/charges (campo `link` = PDF).
 * @param {object|null|undefined} charge
 */
function buildChargeBackedBoletoReply(charge) {
  return buildChargeBackedBoletoPremiumText(charge);
}

function buildChargeBackedPixReply(extracted) {
  const parts = ["💠 *Pix* (cobrança em aberto na BeesWeb):\n"];
  if (extracted.pixCopiaECola) {
    parts.push("\n*Pix copia e cola:*\n" + extracted.pixCopiaECola);
  } else if (extracted.pixQrUrl) {
    parts.push("\n🔗 *QR / link Pix:*\n" + extracted.pixQrUrl);
  } else {
    parts.push("\n⚠️ Cobrança encontrada, mas sem payload Pix nos dados retornados pela API.");
  }
  parts.push("\n\n📩 Após pagar, envie o *comprovante* por aqui.");
  return parts.join("");
}

/**
 * Fluxo controlado DC NET + BeesWeb (sem trust_release).
 * @param {object} ctx
 * @returns {Promise<null | { reply: string, intent?: string|null, leadPatch?: object, adminNotify?: { message: string } }>}
 */
async function tryResolveDcnetBeeswebOperationalReply(ctx) {
  const tenant = (ctx?.tenant || "").toString().toLowerCase();
  const origin = (ctx?.origin || "").toString().toLowerCase();
  if (tenant !== "dcnet" || origin !== "whatsapp") return null;

  const c = ctx.context || {};
  const lastIntent = (c.lastIntent || "").toString().trim().toLowerCase();

  if (lastIntent === INTENT_HUMAN_GENERAL_QUEUE) {
    return {
      reply: MENSAGEM_ESCALA_ATENDIMENTO_GERAL,
      intent: INTENT_HUMAN_GENERAL_QUEUE,
      leadPatch: { lastIntent: INTENT_HUMAN_GENERAL_QUEUE },
      falarComAtendenteCta: true,
    };
  }

  if (c.requiresHumanFinancialReview) {
    const snap = ctx.beesweb;
    if (!hasDcnetBeeswebCustomerIdentification(ctx, snap)) {
      logDcnetFlow(ctx, snap, { branch: "requires_human_financial_review_unidentified" });
      return identificationRequiredReply(
        ctx,
        "DC NET WhatsApp: requiresHumanFinancialReview sem cliente identificado; pedido de CPF em vez de escalação financeira.",
        { detectedIntent: "financeiro", branch: "requires_human_financial_review_unidentified" }
      );
    }
    logDcnetFlow(ctx, snap, { branch: "requires_human_financial_review" });
    logDcnetRoute(ctx, "financeiro", "humano", { branch: "requires_human_financial_review" });
    return { reply: MENSAGEM_ESCALA_FINANCEIRO, intent: "finance_human_queue", falarComAtendenteCta: true };
  }

  const msgTrim = (ctx?.message || "").toString().trim();
  const msgLower = msgTrim.toLowerCase();

  if (lastIntent === "finance_human_queue") {
    const snap = ctx.beesweb;
    if (!hasDcnetBeeswebCustomerIdentification(ctx, snap)) {
      logDcnetFlow(ctx, snap, { branch: "finance_human_queue_unidentified" });
      return identificationRequiredReply(ctx, "DC NET WhatsApp: estado finance_human_queue sem cliente identificado; pedido de CPF.", {
        detectedIntent: "financeiro",
        branch: "finance_human_queue_unidentified",
      });
    }
    logDcnetFlow(ctx, snap, { branch: "finance_human_queue" });
    logDcnetRoute(ctx, "financeiro", "humano", { branch: "finance_human_queue" });
    return { reply: MENSAGEM_ESCALA_FINANCEIRO, intent: "finance_human_queue", falarComAtendenteCta: true };
  }

  if (lastIntent === "finance_receipt_ack") {
    return {
      reply:
        "Seu envio segue com nosso *time financeiro* para conferência. Retornaremos por aqui assim que houver retorno 👍",
      intent: "finance_receipt_ack",
      leadPatch: {
        lastIntent: "finance_receipt_ack",
        lastFinancialIntentAt: new Date(),
      },
      falarComAtendenteCta: true,
    };
  }

  if (lastIntent === "finance_wait_receipt") {
    const clienteRef = String(ctx?.phone || ctx?.from || "desconhecido").trim() || "desconhecido";
    const messageType = String(ctx?.messageType || "text").trim().toLowerCase();
    const isImage = messageType === "image";
    const isDocument = messageType === "document";
    const mediaId = String(ctx?.mediaId || "").trim();

    const financeReceiptAckReturn = () => ({
      reply:
        "Obrigado! Recebemos seu envio. Nosso *time financeiro* vai conferir e retornar por aqui 👍",
      intent: "finance_receipt_ack",
      leadPatch: {
        lastIntent: "finance_receipt_ack",
        lastFinancialIntentAt: new Date(),
      },
      adminNotify: {
        message:
          "Cliente DC NET (WhatsApp) enviou comprovante Pix ou material para conferência financeira. Verificar cadastro/cobranças na BeesWeb.",
      },
      falarComAtendenteCta: true,
    });

    const humanContextFromMedia = (tipoLabel) => {
      const arquivo = String(ctx?.mediaFilename || "").trim() || "(sem nome)";
      const legenda = String(ctx?.mediaCaption || "").trim() || "(sem legenda)";
      return (
        `📥 *NOVO COMPROVANTE PIX*\n\n` +
        `📱 Cliente: ${clienteRef}\n\n` +
        `🧾 Tipo: ${tipoLabel}\n\n` +
        `📎 Arquivo: ${arquivo}\n\n` +
        `💬 Legenda: ${legenda}\n\n` +
        `⚠️ Verificar pagamento e liberar no sistema.`
      );
    };

    if ((isImage || isDocument) && mediaId) {
      const tipoLabel = isImage ? "imagem" : "documento";
      try {
        const metaUrl = await getWhatsAppMediaUrl(mediaId);
        const { buffer, contentType } = await downloadWhatsAppMediaBuffer(metaUrl);
        const mime =
          String(contentType || ctx?.mediaMimeType || "").split(";")[0].trim() ||
          (isImage ? "image/jpeg" : "application/pdf");
        const filename =
          String(ctx?.mediaFilename || "").trim() ||
          (isImage ? "comprovante.jpg" : "comprovante.pdf");
        const uploadedId = await uploadWhatsAppOutboundMedia(buffer, mime, filename);
        await sendWhatsAppText(FINANCE_PIX_COMPROVANTE_FORWARD_TO, humanContextFromMedia(tipoLabel));
        if (isImage) {
          await sendWhatsAppImageByUploadedId(FINANCE_PIX_COMPROVANTE_FORWARD_TO, uploadedId, "");
        } else {
          await sendWhatsAppDocumentByUploadedId(
            FINANCE_PIX_COMPROVANTE_FORWARD_TO,
            uploadedId,
            filename,
            ""
          );
        }
      } catch (e) {
        console.error(
          "Erro ao encaminhar mídia do comprovante Pix para humano (download/upload/envio):",
          e?.message || e,
          {
            mediaId,
            messageType,
            mediaMimeType: ctx?.mediaMimeType,
            mediaFilename: ctx?.mediaFilename,
          }
        );
        try {
          await sendWhatsAppText(
            FINANCE_PIX_COMPROVANTE_FORWARD_TO,
            `📥 *NOVO COMPROVANTE PIX (falha ao reenviar mídia)*\n\n` +
              `📱 Cliente: ${clienteRef}\n\n` +
              `🧾 Tipo: ${tipoLabel}\n\n` +
              `🆔 media_id: ${mediaId}\n\n` +
              `📎 Arquivo: ${String(ctx?.mediaFilename || "").trim() || "(sem nome)"}\n\n` +
              `💬 Legenda: ${String(ctx?.mediaCaption || "").trim() || "(sem legenda)"}\n\n` +
              `⚠️ Baixar manualmente na Meta / conferir inbox do cliente. Erro: ${String(e?.message || e)}`
          );
        } catch (e2) {
          console.error("Erro ao enviar alerta texto após falha de mídia:", e2?.message || e2);
        }
      }
      return financeReceiptAckReturn();
    }

    if (msgLower.length > 2) {
      try {
        await sendWhatsAppText(
          FINANCE_PIX_COMPROVANTE_FORWARD_TO,
          `📥 *NOVO COMPROVANTE PIX*\n\n📱 Cliente: ${clienteRef}\n\n💬 Mensagem:\n${ctx?.message || "(sem texto)"}\n\n⚠️ Verificar pagamento e liberar no sistema.`
        );
      } catch (e) {
        console.error("Erro ao encaminhar comprovante para humano:", e?.message || e);
      }
      return financeReceiptAckReturn();
    }

    return {
      reply:
        "Envie o *comprovante de pagamento* por aqui (foto ou PDF) para seguirmos com a conferência 👍",
      intent: "finance_wait_receipt",
      leadPatch: { lastIntent: "finance_wait_receipt", lastFinancialIntentAt: new Date() },
      falarComAtendenteCta: true,
    };
  }

  /** Legado: placeholder “Gerando seu Pix…” deixou lastIntent em finance_payment_pix; migrar para espera de comprovante sem reexibir a chave. */
  if (lastIntent === "finance_payment_pix") {
    return {
      reply:
        "Envie o *comprovante do Pix* por aqui (foto, PDF ou mensagem) para seguirmos com a conferência pelo time financeiro 👍",
      intent: "finance_wait_receipt",
      leadPatch: { lastIntent: "finance_wait_receipt", lastFinancialIntentAt: new Date() },
      falarComAtendenteCta: true,
    };
  }

  if (lastIntent === "finance_boleto_requested") {
    const customerId = String(c.beeswebCustomerId || ctx?.beesweb?.customerId || "").trim();
    if (!customerId) {
      logDcnetFlow(ctx, ctx.beesweb, { branch: "finance_boleto_requested_no_customer" });
      return identificationRequiredReply(ctx, "DC NET WhatsApp: lead em finance_boleto_requested sem customer_id; pedido de CPF.", {
        detectedIntent: "financeiro",
        branch: "finance_boleto_requested_no_customer",
      });
    }
    const pack = await getPrimaryPendingChargeForCustomer(customerId);
    if (!pack.ok || !pack.charge) {
      logDcnetRoute(ctx, "financeiro", "humano", { branch: "finance_boleto_requested_api_fail" });
      return {
        reply: MENSAGEM_ESCALA_FINANCEIRO,
        intent: "finance_human_queue",
        leadPatch: financeEscalationLeadPatch(),
        adminNotify: {
          message:
            "DC NET WhatsApp: retomada de boleto (legado) sem cobrança ou com falha de API; escalado para financeiro.",
        },
        falarComAtendenteCta: true,
      };
    }
    if (!String(pack.charge?.link || "").trim()) {
      logDcnetRoute(ctx, "financeiro", "humano", { branch: "finance_boleto_requested_no_link" });
      return {
        reply: MENSAGEM_ESCALA_FINANCEIRO,
        intent: "finance_human_queue",
        leadPatch: financeEscalationLeadPatch(),
        adminNotify: {
          message:
            "DC NET WhatsApp: cobrança em aberto sem campo link (boleto PDF) na API; escalado para financeiro.",
        },
        falarComAtendenteCta: true,
      };
    }
    logDcnetRoute(ctx, "financeiro", "financeiro", { branch: "finance_boleto_requested_sent" });
    return {
      reply: buildChargeBackedBoletoPremiumText(pack.charge),
      intent: "finance_boleto_sent",
      leadPatch: {
        lastIntent: "finance_boleto_sent",
        lastFinancialIntentAt: new Date(),
      },
      boletoInteractive: {
        link: String(pack.charge.link || "").trim(),
        ctaBody: "Toque no botão abaixo para abrir seu boleto.",
        buttonText: "Abrir boleto",
      },
    };
  }

  if (lastIntent === "finance_boleto_sent") {
    return {
      reply:
        "O boleto já foi enviado neste chat. A liberação do acesso é automática após o pagamento ser identificado.\n\n" +
        "Obrigado! 👍",
      intent: "finance_boleto_sent",
    };
  }

  if (isFinancePaymentMenuIntent(lastIntent)) {
    const customerId = String(c.beeswebCustomerId || ctx?.beesweb?.customerId || "").trim();
    const twoOnly = Boolean(c.financeMenuTwoOptionsOnly);

    const failHuman = (adminMsg) => {
      logDcnetRoute(ctx, "financeiro", "humano", { branch: "finance_menu_fail_human" });
      return {
        reply: MENSAGEM_ESCALA_FINANCEIRO,
        intent: "finance_human_queue",
        leadPatch: financeEscalationLeadPatch(),
        adminNotify: { message: adminMsg },
        falarComAtendenteCta: true,
      };
    };

    const noChargeHuman = () => {
      logDcnetRoute(ctx, "financeiro", "humano", { branch: "finance_menu_no_open_charge" });
      return {
        reply:
          "Não encontramos cobrança em aberto vinculada ao seu cadastro no momento.\n\n" + MENSAGEM_ESCALA_FINANCEIRO,
        intent: "finance_human_queue",
        leadPatch: financeEscalationLeadPatch(),
        adminNotify: {
          message:
            "DC NET WhatsApp: cliente pediu boleto/Pix no menu de pendência, mas não há cobrança open/overdue na BeesWeb.",
        },
        falarComAtendenteCta: true,
      };
    };

    const isOne = msgTrim === "1" || msgLower === "um" || msgLower.includes("boleto");
    const isTwo =
      msgTrim === "2" ||
      msgLower === "dois" ||
      (msgLower.includes("pix") && !msgLower.includes("comprovante"));
    const isThree =
      msgTrim === "3" ||
      msgLower === "três" ||
      msgLower === "tres" ||
      msgLower.includes("atendimento") ||
      msgLower.includes("falar com");

    if (isThree && !twoOnly) {
      if (!customerId) {
        logDcnetFlow(ctx, ctx.beesweb, { branch: "finance_menu_option3_unidentified" });
        return identificationRequiredReply(ctx, "DC NET WhatsApp: opção 3 (atendimento financeiro) sem customer_id; pedido de CPF.", {
          detectedIntent: "financeiro",
          branch: "finance_menu_option3_unidentified",
        });
      }
      logDcnetRoute(ctx, "financeiro", "humano", { branch: "finance_menu_option3" });
      return {
        reply: MENSAGEM_ESCALA_FINANCEIRO,
        intent: "finance_human_queue",
        leadPatch: financeEscalationLeadPatch(),
        adminNotify: {
          message: "DC NET WhatsApp: opção 3 — cliente pediu atendimento financeiro humano (menu pendência).",
        },
        falarComAtendenteCta: true,
      };
    }

    if (isOne) {
      if (!customerId) {
        logDcnetFlow(ctx, ctx.beesweb, { branch: "finance_menu_option1_boleto_unidentified" });
        return identificationRequiredReply(ctx, "DC NET WhatsApp: opção boleto sem beeswebCustomerId no contexto; pedido de CPF.", {
          detectedIntent: "financeiro",
          branch: "finance_menu_option1_boleto_unidentified",
        });
      }
      const pack = await getPrimaryPendingChargeForCustomer(customerId);
      if (!pack.ok) {
        logDcnetRoute(ctx, "financeiro", "humano", { branch: "finance_menu_boleto_api_fail" });
        return {
          reply:
            "Não consegui consultar seu boleto neste momento.\n\n" +
            "Se precisar de ajuda, vou encaminhar para nosso atendimento financeiro.",
          intent: "finance_human_queue",
          leadPatch: financeEscalationLeadPatch(),
          adminNotify: {
            message:
              "DC NET WhatsApp: falha na API GET /adm/charges ao buscar boleto; escalado para financeiro.",
          },
          falarComAtendenteCta: true,
        };
      }
      if (!pack.charge) {
        logDcnetRoute(ctx, "financeiro", "humano", { branch: "finance_menu_boleto_no_open_charge" });
        return {
          reply:
            "Não encontrei boleto em aberto no seu cadastro neste momento.\n\n" +
            "Se precisar de ajuda, vou encaminhar para nosso atendimento financeiro.",
          intent: "finance_human_queue",
          leadPatch: financeEscalationLeadPatch(),
          adminNotify: {
            message:
              "DC NET WhatsApp: cliente pediu boleto no menu financeiro, mas não há cobrança open/overdue na BeesWeb.",
          },
          falarComAtendenteCta: true,
        };
      }
      if (!String(pack.charge?.link || "").trim()) {
        logDcnetRoute(ctx, "financeiro", "humano", { branch: "finance_menu_boleto_no_link" });
        return {
          reply:
            "Não encontrei link de boleto disponível no seu cadastro neste momento.\n\n" +
            "Se precisar de ajuda, vou encaminhar para nosso atendimento financeiro.",
          intent: "finance_human_queue",
          leadPatch: financeEscalationLeadPatch(),
          adminNotify: {
            message:
              "DC NET WhatsApp: cobrança em aberto sem link de boleto (PDF) na API; escalado para financeiro.",
          },
          falarComAtendenteCta: true,
        };
      }
      logDcnetRoute(ctx, "financeiro", "financeiro", { branch: "finance_menu_boleto_sent" });
      return {
        reply:
          "Segue seu boleto.\n\n" +
          "🙏 Obrigado! Assim que o pagamento for realizado, a liberação ocorre automaticamente pelo sistema bancário.",
        intent: "finance_boleto_sent",
        leadPatch: {
          lastIntent: "finance_boleto_sent",
          lastFinancialIntentAt: new Date(),
          financeMenuTwoOptionsOnly: false,
        },
        boletoInteractive: {
          link: String(pack.charge.link || "").trim(),
          ctaBody: "Toque no botão abaixo para abrir seu boleto.",
          buttonText: "Abrir boleto",
        },
      };
    }

    if (isTwo) {
      if (!customerId) {
        logDcnetFlow(ctx, ctx.beesweb, { branch: "finance_menu_option2_pix_unidentified" });
        return identificationRequiredReply(ctx, "DC NET WhatsApp: opção Pix sem beeswebCustomerId no contexto; pedido de CPF.", {
          detectedIntent: "financeiro",
          branch: "finance_menu_option2_pix_unidentified",
        });
      }
      logDcnetRoute(ctx, "financeiro", "financeiro", { branch: "finance_menu_pix_wait_receipt" });
      return {
        reply: MENSAGEM_PIX,
        intent: "finance_wait_receipt",
        leadPatch: {
          lastIntent: "finance_wait_receipt",
          lastFinancialIntentAt: new Date(),
          financeMenuTwoOptionsOnly: false,
        },
      };
    }

    const prev = Number(c.financialRetryCount || 0);
    const retry = prev + 1;
    if (retry >= 2) {
      if (!customerId) {
        logDcnetFlow(ctx, ctx.beesweb, { branch: "finance_menu_retry_unidentified" });
        return identificationRequiredReply(
          ctx,
          "DC NET WhatsApp: tentativas repetidas no menu sem opção válida e sem customer_id; pedido de CPF.",
          { detectedIntent: "financeiro", branch: "finance_menu_retry_unidentified" }
        );
      }
      logDcnetRoute(ctx, "financeiro", "humano", { branch: "finance_menu_retry_escalation" });
      return {
        reply: MENSAGEM_ESCALA_FINANCEIRO,
        intent: "finance_human_queue",
        leadPatch: {
          lastIntent: "finance_human_queue",
          requiresHumanFinancialReview: true,
          financialRetryCount: retry,
          lastFinancialIntentAt: new Date(),
          financeMenuTwoOptionsOnly: false,
        },
        adminNotify: {
          message: twoOnly
            ? "Escalação DC NET: tentativas repetidas sem opção válida (1 — Boleto, 2 — Pix). Atendimento humano necessário."
            : "Escalação financeira DC NET: tentativas repetidas sem opção válida (1, 2 ou 3). Atendimento humano necessário.",
        },
        falarComAtendenteCta: true,
      };
    }
    return {
      reply: twoOnly
        ? "Para seguir, responda com *1* (Boleto) ou *2* (PIX) 👍"
        : "Para seguir, responda com *1* (boleto), *2* (Pix) ou *3* (atendimento), conforme a mensagem anterior 👍",
      intent: INTENT_FINANCE_PAYMENT_MENU,
      leadPatch: {
        lastIntent: INTENT_FINANCE_PAYMENT_MENU,
        financialRetryCount: retry,
        lastFinancialIntentAt: new Date(),
        financeMenuTwoOptionsOnly: twoOnly,
      },
    };
  }

  const b = ctx.beesweb;
  if (!b || b.skipped) return null;
  if (b.error && !b.customerFound) return null;

  const isFinance = isFinanceOperationalMessage(ctx?.message);
  const isSupport = isSupportOperationalMessage(ctx?.message);

  if (isFinance) {
    logDcnetFlow(ctx, b, { branch: "operational_keyword_finance" });
    if (!b.customerFound) {
      return identificationRequiredReply(ctx, "DC NET WhatsApp: intenção financeira com telefone não localizado na BeesWeb; pedido de CPF.", {
        detectedIntent: "financeiro",
        branch: "keyword_finance_no_phone_match",
      });
    }
    if (b.hasFinancialIssue) {
      logDcnetRoute(ctx, "financeiro", "financeiro", { branch: "menu_pendencia_from_finance_keyword" });
      return {
        reply: MENSAGEM_PENDENCIA,
        intent: INTENT_FINANCE_PAYMENT_MENU,
        leadPatch: pendenciaLeadPatch(),
      };
    }
    logDcnetRoute(ctx, "financeiro", "delegar", { branch: "finance_keyword_no_finance_issue_delegate" });
    return null;
  }

  if (isSupport) {
    logDcnetFlow(ctx, b, { branch: "operational_keyword_support" });
    if (!b.customerFound) {
      return identificationRequiredReply(ctx, "DC NET WhatsApp: intenção de suporte com telefone não localizado na BeesWeb; pedido de CPF.", {
        detectedIntent: "suporte",
        branch: "keyword_support_no_phone_match",
      });
    }
    if (b.hasFinancialIssue) {
      logDcnetRoute(ctx, "suporte", "financeiro", { branch: "menu_pendencia_from_support_keyword" });
      return {
        reply: MENSAGEM_PENDENCIA,
        intent: INTENT_FINANCE_PAYMENT_MENU,
        leadPatch: pendenciaLeadPatch(),
      };
    }
    logDcnetRoute(ctx, "suporte", "suporte", { branch: "support_keyword_delegate_rules" });
    return null;
  }

  return null;
}

module.exports = {
  tryResolveDcnetBeeswebOperationalReply,
  hasDcnetBeeswebCustomerIdentification,
  logDcnetRoute,
  buildDcnetFinanceSoftLockReleaseLeadPatch,
  pendenciaLeadPatch,
  MENSAGEM_PENDENCIA,
  MENSAGEM_PIX,
  MENSAGEM_ESCALA_FINANCEIRO,
  INTENT_FINANCE_PAYMENT_MENU,
  INTENT_HUMAN_GENERAL_QUEUE,
  MENSAGEM_ESCALA_ATENDIMENTO_GERAL,
  MENSAGEM_PEDIDO_CPF,
  MENSAGEM_PEDIDO_CPF_SIMPLES,
  INTENT_BEESWEB_IDENTIFIED_SERVICE_MENU,
  INTENT_BEESWEB_PHONE_NOT_FOUND_MENU,
  INTENT_BEESWEB_CPF_NOT_FOUND_MENU,
  MENSAGEM_MENU_IDENTIFICADO_TELEFONE,
  MENSAGEM_MENU_IDENTIFICADO_OPCAO_INVALIDA,
  MENSAGEM_MENU_TELEFONE_NAO_LOCALIZADO,
  MENSAGEM_MENU_TELEFONE_NAO_LOCALIZADO_OPCAO_INVALIDA,
  MENSAGEM_MENU_FINANCEIRO_DOIS,
  MENSAGEM_COMERCIAL_NOVO_CLIENTE,
  MENSAGEM_MENU_CPF_NAO_ENCONTRADO,
  MENSAGEM_MENU_CPF_NAO_ENCONTRADO_OPCAO_INVALIDA,
  MENSAGEM_CPF_INVALIDO,
  MENSAGEM_CPF_NAO_ENCONTRADO,
  MENSAGEM_BEESWEB_CPF_CONSULTA_FALHOU,
  MAX_BEESWEB_CPF_INVALID_ATTEMPTS,
};
