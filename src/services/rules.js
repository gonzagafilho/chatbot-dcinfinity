const { ruleDcnet } = require("../rules/tenants/dcnet");
const { ruleSite2 } = require("../rules/tenants/site2");
const { ruleDcsolar } = require("../rules/tenants/dcsolar");
const {
  isIntencaoOperacionalPorTextoAtual,
  isFinanceOperationalMessage,
  isSupportOperationalMessage,
  isCommercialIntentMessage,
  isGenericNonFinanceWhatsAppMessage,
} = require("../constants/dcnetOperationalKeywords");
const {
  tryResolveDcnetBeeswebOperationalReply,
  buildDcnetFinanceSoftLockReleaseLeadPatch,
  pendenciaLeadPatch,
  INTENT_BEESWEB_IDENTIFIED_SERVICE_MENU,
  INTENT_BEESWEB_PHONE_NOT_FOUND_MENU,
  INTENT_BEESWEB_CPF_NOT_FOUND_MENU,
  INTENT_FINANCE_PAYMENT_MENU,
  INTENT_HUMAN_GENERAL_QUEUE,
  MENSAGEM_MENU_IDENTIFICADO_OPCAO_INVALIDA,
  MENSAGEM_MENU_TELEFONE_NAO_LOCALIZADO_OPCAO_INVALIDA,
  MENSAGEM_MENU_CPF_NAO_ENCONTRADO_OPCAO_INVALIDA,
  MENSAGEM_MENU_FINANCEIRO_DOIS,
  MENSAGEM_PEDIDO_CPF,
  MENSAGEM_ESCALA_ATENDIMENTO_GERAL,
  MENSAGEM_ESCALA_FINANCEIRO,
  MENSAGEM_COMERCIAL_NOVO_CLIENTE,
  logDcnetRoute,
} = require("./dcnetOperationalBeesweb");
const { isDcnetFinanceFlowIntent } = require("./dcnetCustomerContext");

/** Abertura comercial DC NET (web e WhatsApp). */
const mensagemComercialPadrao =
  "Olá 👋\n" +
  "Seja bem-vindo à *DC NET*.\n\n" +
  "💙 Aqui você encontra internet fibra com velocidade, estabilidade e atendimento de verdade.\n\n" +
  "Vou te enviar o panfleto comercial com os planos disponíveis.\n\n" +
  "Depois, escolha o plano desejado ou envie seu CEP/localização para verificarmos cobertura.";

/**
 * Etapa futura: verificação de cobertura por coordenadas (sem integração ativa).
 * @param {number} lat
 * @param {number} lng
 * @returns {null}
 */
function verificarCobertura(lat, lng) {
  void lat;
  void lng;
  return null;
}

function detectarPlanoEscolhido(message) {
  const text = (message || "").toString().trim().toLowerCase();

  if (text.includes("350") || text === "1") return "350 Mega";
  if (text.includes("400") || text === "2") return "400 Mega";
  if (text.includes("500") || text === "3") return "500 Mega";
  if (text.includes("600") || text === "4") return "600 Mega";

  return null;
}

function isNovoCliente(ctx) {
  return !ctx?.customer && !ctx?.history;
}

function isCanalComercial(ctx) {
  const origin = (ctx?.origin || "").toString().toLowerCase();
  return origin === "web" || origin === "whatsapp";
}

function hasContextoRelevante(ctx) {
  return Boolean(ctx?.context?.lastIntent || ctx?.context?.status);
}

function hasContextoOperacionalRelevante(ctx) {
  const status = (ctx?.context?.status || "").toString().toLowerCase();
  const lastIntent = (ctx?.context?.lastIntent || "").toString().toLowerCase();

  const statusOperacional = new Set(["em_atendimento", "handoff", "resolvido"]);
  if (statusOperacional.has(status)) return true;

  const marcadoresOperacionais = [
    "suporte",
    "cobranca",
    "cobrança",
    "fatura",
    "financeiro",
    "atendente",
    "humano",
    "ticket",
    "chamado",
  ];

  return marcadoresOperacionais.some((m) => lastIntent.includes(m));
}

function respostaFinanceiroDcnetCurta() {
  return {
    reply:
      "💳 *Cobrança / financeiro DC NET*\n" +
      "Para *segunda via*, *fatura* ou *dúvidas de cobrança*, envie seu *CPF/CNPJ* ou *número do contrato* e aguarde que seguimos com você 👍",
    falarComAtendenteCta: true,
  };
}

/** Já está em conversa comercial (evita voltar ao menu genérico). */
function temEngajamentoComercialSemReset(ctx) {
  const msg = (ctx?.message || "").toString().trim().toLowerCase();
  if (!msg) return false;
  const lastIntent = (ctx?.context?.lastIntent || "").toString().toLowerCase();
  if (lastIntent === "location_shared") return true;

  const sinais = [
    "bairro",
    "casa",
    "empresa",
    "contrat",
    "plano",
    "orçamento",
    "orcamento",
    "350",
    "400",
    "500",
    "600",
    "mega",
    "mbps",
    "responsável",
    "responsavel",
    "cpf",
    "cnpj",
  ];
  return sinais.some((k) => msg.includes(k));
}

function isNovoLeadComercialWhatsAppDcnet(ctx) {
  const tenant = (ctx?.tenant || "").toString().toLowerCase();
  const origin = (ctx?.origin || "").toString().toLowerCase();

  return (
    tenant === "dcnet" &&
    origin === "whatsapp" &&
    !ctx?.customer
  );
}

function isClienteExistenteSemContextoOperacional(ctx) {
  const tenant = (ctx?.tenant || "").toString().toLowerCase();
  const origin = (ctx?.origin || "").toString().toLowerCase();

  return (
    tenant === "dcnet" &&
    (origin === "whatsapp" || origin === "web") &&
    !!ctx?.customer &&
    !hasContextoOperacionalRelevante(ctx)
  );
}

function isMensagemAberturaComercial(msgRaw) {
  const msg = (msgRaw || "").toString().trim().toLowerCase();
  if (!msg) return true;
  const aberturas = new Set([
    "oi",
    "oie",
    "ola",
    "olá",
    "hey",
    "eae",
    "bom dia",
    "boa tarde",
    "boa noite",
    "hello",
    "hi",
    "inicio",
    "início",
    "menu",
    "ajuda",
    "help",
  ]);
  if (aberturas.has(msg)) return true;
  if (msg.length <= 2 && /[a-záàâãéèêíìîóòôõúùûç]/i.test(msg)) return true;
  return false;
}

/**
 * Proposta comercial inicial única (mesmo texto para novo / existente sem lock operacional).
 * Cliente já em conversa (ex.: digitou plano) segue para ruleDcnet / localização, sem repetir o panfleto.
 */
function deveReceberPropostaComercialInicialDcnet(ctx) {
  const msg = (ctx?.message || "").toString();

  if (isNovoLeadComercialWhatsAppDcnet(ctx)) return true;
  if (isCanalComercial(ctx) && isNovoCliente(ctx) && !hasContextoRelevante(ctx)) return true;
  if (isClienteExistenteSemContextoOperacional(ctx) && isMensagemAberturaComercial(msg)) {
    return true;
  }
  return false;
}

function mensagemFallbackNatural() {
  return "Olá, vi que você entrou em contato sobre internet. Vou continuar seu atendimento por aqui.";
}

/**
 * Interesse comercial sem plano escolhido ainda (WhatsApp).
 * Localização oficial só depois da escolha do plano — aqui só conduz à vitrine de planos.
 */
function interesseComercialSemPlanoEscolhido(ctx) {
  const tenant = (ctx?.tenant || "").toString().toLowerCase();
  const origin = (ctx?.origin || "").toString().toLowerCase();
  const msg = (ctx?.message || "").toString().trim().toLowerCase();

  if (tenant !== "dcnet" || origin !== "whatsapp") return false;

  if (detectarPlanoEscolhido(ctx?.message)) return false;

  // Primeira impressão: vitrine completa; depois disso conduz à escolha do plano (histórico ≥2 = já houve troca)
  const jaConversou = (ctx?.history?.count || 0) >= 2;
  if (!hasContextoRelevante(ctx) && !jaConversou) return false;

  const gatilhos = [
    "contratar",
    "quero contratar",
    "quero ",
    "instala",
    "assinar",
    "cobertura",
    "plano",
    "orçamento",
    "orcamento",
    "mega",
    "mbps",
    "bairro",
    "casa",
    "empresa",
    "responsável",
    "responsavel",
  ];
  return gatilhos.some((g) => msg.includes(g));
}

/** Conduz à escolha do plano (sem pedir localização antes). Rodapé humano só após envio de localização. */
function textoPecaEscolherPlano() {
  return {
    reply:
      "Vou te enviar o panfleto comercial com os planos disponíveis.\n\n" +
      "Escolha o plano desejado ou envie seu CEP/localização para verificarmos cobertura.",
    falarComAtendenteCta: true,
    commercialPlanFlyer: true,
    leadPatch: {
      lastIntent: "commercial_wait_cep",
      status: "commercial_flow",
      beeswebIdentificationSkip: true,
    },
  };
}

/** Endereço / bairro após interesse comercial — sem reabrir menu genérico. */
function pareceBairroOuEndereco(ctx) {
  const msg = (ctx?.message || "").toString().trim().toLowerCase();
  if (!msg || msg.length < 4) return false;
  if (detectarPlanoEscolhido(msg)) return false;
  const hints = ["bairro", "rua", "cep", "cidade", "quadra", "conjunto", "setor", "chácara", "chacara"];
  return hints.some((h) => msg.includes(h));
}

/**
 * Corpo pós-localização (sem link; CTA de atendimento no webhook).
 */
function mensagemPosEnvioLocalizacaoComercialDcnet() {
  return (
    "Perfeito! Recebemos sua localização. 📍\n\n" +
    "Agora vou te encaminhar para um de nossos atendentes para finalizar seu atendimento.\n\n" +
    "💙 Obrigado por escolher a DC NET.\n" +
    "Será um prazer conectar você com a gente!\n\n" +
    "🙏 Que Deus te abençoe!"
  );
}

/**
 * Após escolha no menu pós-identificação telefone BeesWeb: limpa a intent do menu,
 * salvo quando o fluxo interno já fixou lastIntent (ex.: financeiro).
 * @param {string | { reply?: string, intent?: unknown, leadPatch?: object }} inner
 */
function mergeServiceMenuExit(inner) {
  if (inner == null) return null;
  if (typeof inner === "string") {
    return { reply: inner, intent: null, leadPatch: { lastIntent: null } };
  }
  const lp = inner.leadPatch && typeof inner.leadPatch === "object" ? { ...inner.leadPatch } : {};
  if (Object.prototype.hasOwnProperty.call(lp, "lastIntent") && lp.lastIntent != null) {
    return inner;
  }
  return { ...inner, leadPatch: { ...lp, lastIntent: null } };
}

const FINANCE_RECEIPT_ACK_STALE_MS = 72 * 60 * 60 * 1000;

function isDcnetFinancePendingMenuIntent(lastIntent) {
  const li = (lastIntent || "").toString().trim().toLowerCase();
  return li === INTENT_FINANCE_PAYMENT_MENU || li === "finance_pending_choice";
}

function isLikelyFinancePendingMenuSelection(message) {
  const t = (message || "").toString().trim();
  const lower = t.toLowerCase();
  if (/^[123]$/u.test(t)) return true;
  return new Set(["um", "dois", "três", "tres"]).has(lower);
}

function financeReceiptAckAgeMs(ctx) {
  const at = ctx?.context?.lastFinancialIntentAt;
  if (!at) return null;
  const ms = new Date(at).getTime();
  if (Number.isNaN(ms)) return null;
  return Date.now() - ms;
}

/**
 * Encerra continuidade forçada do fluxo financeiro quando a mensagem atual não é continuação
 * (ex.: saudação, suporte, comercial) ou quando finance_receipt_ack está obsoleto.
 */
function shouldReleaseDcnetFinanceSoftContinuation(ctx) {
  const msgRaw = (ctx?.message || "").toString().trim();
  const msgLower = msgRaw.toLowerCase();
  if (isFinanceOperationalMessage(msgRaw)) return false;

  const mt = (ctx?.messageType || "text").toString().trim().toLowerCase();
  const mediaId = String(ctx?.mediaId || "").trim();
  const li = (ctx?.context?.lastIntent || "").toString().trim().toLowerCase();

  if (li === "finance_wait_receipt" && (mt === "image" || mt === "document") && mediaId) {
    return false;
  }

  if (isDcnetFinancePendingMenuIntent(li) && isLikelyFinancePendingMenuSelection(msgRaw)) {
    return false;
  }

  const age = financeReceiptAckAgeMs(ctx);
  if (li === "finance_receipt_ack" && age != null && age > FINANCE_RECEIPT_ACK_STALE_MS) {
    return true;
  }

  if (/\b(comercial|vendas|venda)\b/.test(msgLower)) return true;
  if (isSupportOperationalMessage(msgRaw)) return true;
  if (isCommercialIntentMessage(msgRaw)) return true;
  if (isGenericNonFinanceWhatsAppMessage(msgRaw)) return true;

  return false;
}

function applyDcnetFinanceSoftContinuationReleaseToContext(ctx) {
  const patch = buildDcnetFinanceSoftLockReleaseLeadPatch();
  ctx.context = { ...(ctx.context || {}), ...patch };
}

async function resolveFluxoDcnet(ctx) {
  // manutenção sempre tem prioridade quando ativa
  if (ctx?.maintenance?.active && ctx?.maintenance?.message) {
    return ctx.maintenance.message;
  }

  if (
    (ctx?.tenant || "").toString().trim().toLowerCase() === "dcnet" &&
    (ctx?.origin || "").toString().trim().toLowerCase() === "whatsapp"
  ) {
    const liShield = (ctx?.context?.lastIntent || "").toString().trim().toLowerCase();
    if (liShield === INTENT_HUMAN_GENERAL_QUEUE) {
      const beesShield = await tryResolveDcnetBeeswebOperationalReply(ctx);
      if (beesShield) return beesShield;
    }
  }

  const lastIntentFinance = (ctx?.context?.lastIntent || "").toString().trim().toLowerCase();
  const financeMenuBranchIntents = new Set([
    INTENT_FINANCE_PAYMENT_MENU,
    "finance_pending_choice",
    "finance_payment_boleto",
  ]);
  if (
    (ctx?.tenant || "").toString().trim().toLowerCase() === "dcnet" &&
    (ctx?.origin || "").toString().trim().toLowerCase() === "whatsapp" &&
    financeMenuBranchIntents.has(lastIntentFinance)
  ) {
    const msg = (ctx?.message || "").toString().trim();
    const twoOnlyFin = Boolean(ctx?.context?.financeMenuTwoOptionsOnly);

    if (msg === "1") {
      const beesBoleto = await tryResolveDcnetBeeswebOperationalReply(ctx);
      if (beesBoleto) return beesBoleto;
      return {
        reply: "🔄 Buscando seu boleto...",
        intent: "finance_payment_boleto",
        leadPatch: { lastIntent: "finance_payment_boleto" },
      };
    }

    if (msg === "2") {
      const beesPix = await tryResolveDcnetBeeswebOperationalReply(ctx);
      if (beesPix) return beesPix;
      return {
        reply: "🔄 Gerando seu Pix...",
        intent: "finance_payment_pix",
        leadPatch: { lastIntent: "finance_payment_pix" },
      };
    }

    if (msg === "3" && !twoOnlyFin) {
      return {
        reply: MENSAGEM_ESCALA_FINANCEIRO,
        intent: "finance_human_queue",
        leadPatch: { lastIntent: "finance_human_queue" },
        falarComAtendenteCta: true,
      };
    }

    const beesFinanceMenu = await tryResolveDcnetBeeswebOperationalReply(ctx);
    if (beesFinanceMenu) return beesFinanceMenu;

    return {
      reply: twoOnlyFin
        ? "⚠️ Opção inválida.\n\n" + MENSAGEM_MENU_FINANCEIRO_DOIS
        : "⚠️ Opção inválida.\n\n" +
          "Escolha uma opção:\n\n" +
          "1️⃣ Receber boleto\n" +
          "2️⃣ Receber Pix\n" +
          "3️⃣ Falar com atendimento",
      intent: INTENT_FINANCE_PAYMENT_MENU,
      leadPatch: { lastIntent: INTENT_FINANCE_PAYMENT_MENU, financeMenuTwoOptionsOnly: twoOnlyFin },
      falarComAtendenteCta: !twoOnlyFin,
    };
  }

  const lastIntentMenu = (ctx?.context?.lastIntent || "").toString().trim().toLowerCase();
  if (
    (ctx?.tenant || "").toString().trim().toLowerCase() === "dcnet" &&
    (ctx?.origin || "").toString().trim().toLowerCase() === "whatsapp" &&
    lastIntentMenu === INTENT_BEESWEB_IDENTIFIED_SERVICE_MENU
  ) {
    const msgTrim = (ctx?.message || "").toString().trim();
    const msgLower = msgTrim.toLowerCase();
    const ctxClear = {
      ...ctx,
      context: { ...ctx.context, lastIntent: null },
    };

    if (msgTrim === "1" || msgLower === "um") {
      return {
        reply: MENSAGEM_ESCALA_ATENDIMENTO_GERAL,
        intent: INTENT_HUMAN_GENERAL_QUEUE,
        leadPatch: {
          lastIntent: INTENT_HUMAN_GENERAL_QUEUE,
        },
        adminNotify: {
          message: "DC NET WhatsApp: menu identificado opção 1 (planos) encaminhada para atendimento humano.",
        },
        falarComAtendenteCta: true,
      };
    }
    if (msgTrim === "2" || msgLower === "dois") {
      return {
        reply: MENSAGEM_ESCALA_ATENDIMENTO_GERAL,
        intent: INTENT_HUMAN_GENERAL_QUEUE,
        leadPatch: {
          lastIntent: INTENT_HUMAN_GENERAL_QUEUE,
        },
        adminNotify: {
          message: "DC NET WhatsApp: menu identificado opção 2 (suporte) encaminhada para atendimento humano.",
        },
        falarComAtendenteCta: true,
      };
    }
    if (msgTrim === "3" || msgLower === "tres" || msgLower === "três") {
      return {
        reply: MENSAGEM_MENU_FINANCEIRO_DOIS,
        intent: INTENT_FINANCE_PAYMENT_MENU,
        leadPatch: {
          ...pendenciaLeadPatch(),
          financeMenuTwoOptionsOnly: true,
        },
        falarComAtendenteCta: false,
      };
    }
    if (msgTrim === "4" || msgLower === "quatro") {
      return {
        reply: MENSAGEM_ESCALA_ATENDIMENTO_GERAL,
        intent: INTENT_HUMAN_GENERAL_QUEUE,
        leadPatch: {
          lastIntent: INTENT_HUMAN_GENERAL_QUEUE,
        },
        adminNotify: {
          message:
            "DC NET WhatsApp: opção 4 (atendimento humano geral) no menu pós-identificação por telefone (BeesWeb).",
        },
        falarComAtendenteCta: true,
      };
    }

    return {
      reply: MENSAGEM_MENU_IDENTIFICADO_OPCAO_INVALIDA,
      intent: INTENT_BEESWEB_IDENTIFIED_SERVICE_MENU,
      leadPatch: { lastIntent: INTENT_BEESWEB_IDENTIFIED_SERVICE_MENU },
    };
  }

  const lastIntentPhoneNf = (ctx?.context?.lastIntent || "").toString().trim().toLowerCase();
  if (
    (ctx?.tenant || "").toString().trim().toLowerCase() === "dcnet" &&
    (ctx?.origin || "").toString().trim().toLowerCase() === "whatsapp" &&
    lastIntentPhoneNf === INTENT_BEESWEB_PHONE_NOT_FOUND_MENU
  ) {
    if (isIntencaoOperacionalPorTextoAtual(ctx?.message)) {
      ctx.context = {
        ...(ctx.context || {}),
        lastIntent: null,
        beeswebIdentificationSkip: false,
      };
    } else {
    const msgTrimNf = (ctx?.message || "").toString().trim();
    const msgLowerNf = msgTrimNf.toLowerCase();

    const isJaCliente =
      msgTrimNf === "1" ||
      msgLowerNf === "um" ||
      msgLowerNf.includes("já sou") ||
      msgLowerNf.includes("ja sou");
    const isAindaNaoCliente =
      msgTrimNf === "2" ||
      msgLowerNf === "dois" ||
      msgLowerNf.includes("ainda nao sou") ||
      msgLowerNf.includes("ainda não sou") ||
      msgLowerNf.includes("nao sou cliente") ||
      msgLowerNf.includes("não sou cliente") ||
      msgLowerNf.includes("quero contratar") ||
      msgLowerNf.includes("contratar internet") ||
      msgLowerNf.includes("oferta") ||
      msgLowerNf.includes("conhecer");

    if (isJaCliente) {
      return {
        reply: MENSAGEM_PEDIDO_CPF,
        intent: "aguardando_cpf",
        leadPatch: {
          lastIntent: "aguardando_cpf",
          beeswebCpfInvalidAttempts: 0,
          beeswebIdentificationSkip: false,
          beeswebCpfFromUnregisteredPhone: true,
        },
        falarComAtendenteCta: true,
      };
    }
    if (isAindaNaoCliente) {
      return {
        reply: MENSAGEM_COMERCIAL_NOVO_CLIENTE,
        intent: "commercial_choose_plan",
        commercialPlanFlyer: true,
        leadPatch: {
          lastIntent: "commercial_wait_cep",
          status: "commercial_flow",
          beeswebIdentificationSkip: true,
          beeswebCpfFromUnregisteredPhone: false,
        },
        falarComAtendenteCta: false,
      };
    }

    return {
      reply: MENSAGEM_MENU_TELEFONE_NAO_LOCALIZADO_OPCAO_INVALIDA,
      intent: INTENT_BEESWEB_PHONE_NOT_FOUND_MENU,
      leadPatch: { lastIntent: INTENT_BEESWEB_PHONE_NOT_FOUND_MENU },
      falarComAtendenteCta: true,
    };
    }
  }

  const lastIntentCpfNf = (ctx?.context?.lastIntent || "").toString().trim().toLowerCase();
  if (
    (ctx?.tenant || "").toString().trim().toLowerCase() === "dcnet" &&
    (ctx?.origin || "").toString().trim().toLowerCase() === "whatsapp" &&
    (lastIntentCpfNf === INTENT_BEESWEB_CPF_NOT_FOUND_MENU || lastIntentCpfNf === "cpf_nao_encontrado")
  ) {
    if (isIntencaoOperacionalPorTextoAtual(ctx?.message)) {
      ctx.context = {
        ...(ctx.context || {}),
        lastIntent: null,
        beeswebIdentificationSkip: false,
      };
    } else {
    const msgCpf = (ctx?.message || "").toString().trim();
    const lowCpf = msgCpf.toLowerCase();

    const isRetryCpf =
      msgCpf === "1" ||
      lowCpf === "um" ||
      lowCpf.includes("tentar novamente") ||
      lowCpf.includes("tentar outro") ||
      lowCpf.includes("outro cpf");
    const isContratarInternet =
      msgCpf === "2" ||
      lowCpf === "dois" ||
      lowCpf.includes("quero contratar") ||
      lowCpf.includes("contratar internet");
    if (isRetryCpf) {
      return {
        reply: MENSAGEM_PEDIDO_CPF,
        intent: "aguardando_cpf",
        leadPatch: {
          lastIntent: "aguardando_cpf",
          beeswebIdentificationSkip: false,
          beeswebCpfInvalidAttempts: 0,
        },
        falarComAtendenteCta: true,
      };
    }
    if (isContratarInternet) {
      return {
        reply: MENSAGEM_COMERCIAL_NOVO_CLIENTE,
        intent: "commercial_wait_cep",
        commercialPlanFlyer: true,
        leadPatch: {
          lastIntent: "commercial_wait_cep",
          status: "commercial_flow",
          beeswebIdentificationSkip: true,
        },
        falarComAtendenteCta: false,
      };
    }

    return {
      reply: MENSAGEM_MENU_CPF_NAO_ENCONTRADO_OPCAO_INVALIDA,
      intent: INTENT_BEESWEB_CPF_NOT_FOUND_MENU,
      leadPatch: {
        lastIntent: INTENT_BEESWEB_CPF_NOT_FOUND_MENU,
        beeswebIdentificationSkip: true,
      },
      falarComAtendenteCta: true,
    };
    }
  }

  // Intenção operacional explícita na mensagem atual (suporte/cobrança/chamado) — sem proposta comercial
  if (isCanalComercial(ctx) && isIntencaoOperacionalPorTextoAtual(ctx?.message)) {
    const dcnetDetected = isFinanceOperationalMessage(ctx?.message)
      ? "financeiro"
      : isSupportOperationalMessage(ctx?.message)
        ? "suporte"
        : "operacional";
    const bees = await tryResolveDcnetBeeswebOperationalReply(ctx);
    if (bees) {
      let nextStep = dcnetDetected;
      if (bees.intent === "aguardando_cpf") nextStep = "pedir_cpf";
      else if (bees.intent === "finance_human_queue") nextStep = "humano";
      else if (bees.intent === INTENT_FINANCE_PAYMENT_MENU || bees.leadPatch?.lastIntent === INTENT_FINANCE_PAYMENT_MENU) {
        nextStep = "financeiro";
      }
      if (bees.intent !== "aguardando_cpf") {
        logDcnetRoute(ctx, dcnetDetected, nextStep, { phase: "operational_intent_block" });
      }
      return bees;
    }

    const msg = (ctx?.message || "").toString().trim().toLowerCase();
    const financeiro = ["cobrança", "cobranca", "boleto", "fatura", "financeiro", "vencimento", "segunda via", "2a via", "2ª via"];
    if (financeiro.some((k) => msg.includes(k))) {
      logDcnetRoute(ctx, "financeiro", "financeiro", { phase: "resposta_financeira_curta_fallback" });
      return respostaFinanceiroDcnetCurta();
    }
    logDcnetRoute(ctx, dcnetDetected, "suporte", { phase: "ruleDcnet_suporte_fallback" });
    return ruleDcnet({ ...ctx, message: "suporte" });
  }

  // Continuidade após localização (antes do lock operacional, para não reabrir menu se status=handoff)
  const lastIntent = (ctx?.context?.lastIntent || "").toString().toLowerCase();
  if (lastIntent === "location_shared") {
    const origin = (ctx?.origin || "").toString().toLowerCase();
    if (origin === "whatsapp") {
      return (
        "Obrigado! Seu atendimento comercial segue com nosso time com a localização que você enviou 👍"
      );
    }
    return "Recebemos sua localização. Nosso time dará sequência ao seu atendimento 👍";
  }

  const lastIntentFinanceFlow = (ctx?.context?.lastIntent || "").toString().trim().toLowerCase();
  const dcnetWhatsappFinanceContinuation =
    (ctx?.tenant || "").toString().trim().toLowerCase() === "dcnet" &&
    (ctx?.origin || "").toString().trim().toLowerCase() === "whatsapp" &&
    (isDcnetFinanceFlowIntent(ctx?.context?.lastIntent) || lastIntentFinanceFlow === "finance_boleto_sent");

  if (dcnetWhatsappFinanceContinuation) {
    if (shouldReleaseDcnetFinanceSoftContinuation(ctx)) {
      applyDcnetFinanceSoftContinuationReleaseToContext(ctx);
      logDcnetRoute(ctx, "financeiro", "reset", { phase: "finance_soft_continuation_release" });
    } else {
      const beesFinance = await tryResolveDcnetBeeswebOperationalReply(ctx);
      if (beesFinance) return beesFinance;
    }
  }

  // Contexto operacional: fluxo normal (suporte/cobrança/handoff etc.), sem proposta comercial inicial
  if (hasContextoOperacionalRelevante(ctx)) {
    const bees = await tryResolveDcnetBeeswebOperationalReply(ctx);
    if (bees) return bees;
    return ruleDcnet(ctx);
  }

  if (isCanalComercial(ctx)) {
    const origin = (ctx?.origin || "").toString().toLowerCase();
    if (
      origin === "whatsapp" &&
      (ctx?.tenant || "").toString().trim().toLowerCase() === "dcnet" &&
      isCommercialIntentMessage(ctx?.message) &&
      !isIntencaoOperacionalPorTextoAtual(ctx?.message)
    ) {
      logDcnetRoute(ctx, "comercial", "comercial", { phase: "commercial_keywords_whatsapp" });
    }
    const plano = detectarPlanoEscolhido(ctx?.message);
    if (plano && origin === "whatsapp") {
      const replyPlano =
        `Perfeito. Você escolheu o plano de *${plano}*.\n\n` +
        `Vou te enviar o panfleto comercial e, em seguida, você pode enviar seu CEP ou localização para verificarmos cobertura.`;
      return {
        reply: replyPlano,
        intent: "commercial_wait_cep",
        commercialPlanFlyer: true,
        leadPatch: {
          lastIntent: "commercial_wait_cep",
          status: "commercial_flow",
          beeswebIdentificationSkip: true,
          selectedCommercialPlan: plano,
        },
      };
    }
    if (plano && origin === "web") {
      return (
        `Perfeito 👍 Você escolheu o plano de *${plano}*.\n\n` +
        `Informe seu *bairro* e *cidade* para seguirmos com a contratação.`
      );
    }

    if (origin === "whatsapp" && pareceBairroOuEndereco(ctx)) {
      const replyBairro =
        "Obrigado pelas informações. Vou te enviar o panfleto comercial com os planos disponíveis.\n\n" +
        "Escolha o plano desejado ou envie seu CEP/localização para verificarmos cobertura.";
      return {
        reply: replyBairro,
        falarComAtendenteCta: true,
        commercialPlanFlyer: true,
        leadPatch: {
          lastIntent: "commercial_wait_cep",
          status: "commercial_flow",
          beeswebIdentificationSkip: true,
        },
      };
    }

    if (deveReceberPropostaComercialInicialDcnet(ctx)) {
      return {
        reply: mensagemComercialPadrao,
        falarComAtendenteCta: true,
        commercialPlanFlyer: true,
        leadPatch: {
          lastIntent: "commercial_wait_cep",
          status: "commercial_flow",
          beeswebIdentificationSkip: true,
        },
      };
    }

    if (interesseComercialSemPlanoEscolhido(ctx)) {
      return textoPecaEscolherPlano();
    }
  }

  // Evita menu genérico quando já há engajamento comercial (plano, bairro, contratação, etc.)
  let result;
  if (temEngajamentoComercialSemReset(ctx) && !isMensagemAberturaComercial(ctx?.message)) {
    result = mensagemFallbackNatural();
  } else {
    result = ruleDcnet(ctx);
  }

  if (interesseComercialSemPlanoEscolhido(ctx)) {
    return textoPecaEscolherPlano();
  }

  // fallback profissional: evita menu genérico quando já há engajamento comercial ou contexto “meio caminho”
  if (
    typeof result === "string" &&
    result.includes("Me diga o que você precisa") &&
    ((!isNovoCliente(ctx) && !hasContextoRelevante(ctx)) || temEngajamentoComercialSemReset(ctx))
  ) {
    return mensagemFallbackNatural();
  }

  return result;
}

async function replyFromRules(ctx) {
  const tenant = (ctx?.tenant || "dcnet").toString().trim().toLowerCase();

  console.log("🧠 rules.js ACTIVE", {
    tenant,
    message: ctx?.message,
    origin: ctx?.origin,
    page: ctx?.page,
  });

  if (tenant === "dcsolar") return ruleDcsolar(ctx);
  if (tenant === "site2") return ruleSite2(ctx);
  return await resolveFluxoDcnet(ctx);
}

module.exports = {
  replyFromRules,
  verificarCobertura,
  mensagemPosEnvioLocalizacaoComercialDcnet,
};
