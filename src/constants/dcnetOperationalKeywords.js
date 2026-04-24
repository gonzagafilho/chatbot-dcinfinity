"use strict";

const FINANCE_KEYWORDS = [
  "cobrança",
  "cobranca",
  "boleto",
  "fatura",
  "financeiro",
  "vencimento",
  "segunda via",
  "2a via",
  "2ª via",
  "pagar",
  "pagamento",
];

/** Vendas / contratação (não exige BeesWeb). Avaliado após excluir financeiro e suporte. */
const COMMERCIAL_KEYWORDS = [
  "plano",
  "planos",
  "contratar",
  "contratação",
  "contratacao",
  "valor",
  "internet nova",
  "promoção",
  "promocao",
  "adesão",
  "adesao",
  "orçamento",
  "orcamento",
];

const SUPPORT_NETWORK_KEYWORDS = [
  "suporte",
  "visita",
  "internet caiu",
  "caiu a internet",
  "sem internet",
  "sem sinal",
  "sem conexão",
  "sem conexao",
  "sem rede",
  "lenta",
  "lento",
  "ping alto",
  "técnico",
  "tecnico",
  "instabilidade",
  "queda",
  "wifi",
  "wi-fi",
  "roteador",
  "onu",
];

const TICKET_KEYWORDS = ["chamado", "ticket", "protocolo", "reclamação", "reclamacao"];

function isIntencaoOperacionalPorTextoAtual(message) {
  const msg = (message || "").toString().trim().toLowerCase();
  if (!msg) return false;
  if (SUPPORT_NETWORK_KEYWORDS.some((k) => msg.includes(k))) return true;
  if (FINANCE_KEYWORDS.some((k) => msg.includes(k))) return true;
  if (TICKET_KEYWORDS.some((k) => msg.includes(k))) return true;
  return false;
}

function isFinanceOperationalMessage(message) {
  const msg = (message || "").toString().trim().toLowerCase();
  if (!msg) return false;
  return FINANCE_KEYWORDS.some((k) => msg.includes(k));
}

function isSupportOperationalMessage(message) {
  const msg = (message || "").toString().trim().toLowerCase();
  if (!msg) return false;
  if (isFinanceOperationalMessage(message)) return false;
  return SUPPORT_NETWORK_KEYWORDS.some((k) => msg.includes(k)) || TICKET_KEYWORDS.some((k) => msg.includes(k));
}

function isCommercialIntentMessage(message) {
  const msg = (message || "").toString().trim().toLowerCase();
  if (!msg) return false;
  if (isFinanceOperationalMessage(message)) return false;
  if (isSupportOperationalMessage(message)) return false;
  return COMMERCIAL_KEYWORDS.some((k) => msg.includes(k));
}

/**
 * Saudações / agradecimentos curtos típicos de WhatsApp (sem palavras de cobrança).
 * Usado para não manter o lead preso em continuidade financeira por lastIntent antigo.
 */
function isGenericNonFinanceWhatsAppMessage(message) {
  const raw = (message || "").toString().trim();
  if (!raw) return false;
  const msg = raw.toLowerCase();
  if (msg.length > 120) return false;
  if (/^\d+$/.test(msg)) return false;

  const openers = new Set([
    "oi",
    "oie",
    "ola",
    "olá",
    "hey",
    "eae",
    "hi",
    "hello",
    "bom dia",
    "boa tarde",
    "boa noite",
    "boa madrugada",
    "inicio",
    "início",
    "menu",
    "ajuda",
    "help",
  ]);
  const core = msg.replace(/[!?.,;:]+$/g, "").trim();
  if (openers.has(core)) return true;
  if (msg.length <= 2 && /[a-záàâãéèêíìîóòôõúùûç]/i.test(msg)) return true;

  const thanks = /^(obrigad[oa]|obg|vlw|valeu|brigad[oa]|agrade[cç]o)\b/.test(core);
  if (thanks) return true;

  const bye = /^(tchau|até logo|ate logo|até mais|ate mais|até\b|ate\b)\b/.test(core);
  if (bye) return true;

  if (/^(oi|olá|ola)\s*[,]?\s*(bom dia|boa tarde|boa noite|tudo bem|td bem)\b/.test(core)) return true;
  if (/^(bom dia|boa tarde|boa noite)\s*[,]?\s*(oi|olá|ola|tudo bem|td bem)?\b/.test(core)) return true;

  return false;
}

module.exports = {
  FINANCE_KEYWORDS,
  COMMERCIAL_KEYWORDS,
  SUPPORT_NETWORK_KEYWORDS,
  TICKET_KEYWORDS,
  isIntencaoOperacionalPorTextoAtual,
  isFinanceOperationalMessage,
  isSupportOperationalMessage,
  isCommercialIntentMessage,
  isGenericNonFinanceWhatsAppMessage,
};
