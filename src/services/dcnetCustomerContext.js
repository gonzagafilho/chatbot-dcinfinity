"use strict";

const { isBeeswebConfigured } = require("../config/beesweb");
const {
  findCustomerByPhone,
  pickCustomerId,
  pickCustomerName,
} = require("../integrations/beesweb/customers");
const { listContractsByCustomerId } = require("../integrations/beesweb/contracts");
const { listChargesByCustomerId } = require("../integrations/beesweb/charges");
const { listTicketsByCustomerId } = require("../integrations/beesweb/tickets");
const { isIntencaoOperacionalPorTextoAtual } = require("../constants/dcnetOperationalKeywords");
const {
  INTENT_BEESWEB_IDENTIFIED_SERVICE_MENU,
  INTENT_BEESWEB_PHONE_NOT_FOUND_MENU,
  INTENT_BEESWEB_CPF_NOT_FOUND_MENU,
} = require("./dcnetOperationalBeesweb");

const FINANCE_FLOW_INTENTS = new Set([
  "finance_payment_menu",
  "finance_pending_choice",
  "finance_payment_boleto",
  "finance_payment_pix",
  "finance_wait_receipt",
  "finance_boleto_requested",
  "finance_receipt_ack",
  "finance_human_queue",
]);

const { INTENT_HUMAN_GENERAL_QUEUE } = require("./dcnetOperationalBeesweb");

function isDcnetFinanceFlowIntent(lastIntent) {
  return FINANCE_FLOW_INTENTS.has((lastIntent || "").toString().trim().toLowerCase());
}

function isDcnetHumanGeneralHandoffIntent(lastIntent) {
  return (lastIntent || "").toString().trim().toLowerCase() === INTENT_HUMAN_GENERAL_QUEUE;
}

const BEESWEB_IDENTIFICATION_INTENTS = new Set(["aguardando_cpf", "cpf_invalido"]);

function isDcnetBeeswebIdentificationAwaitingCpf(lastIntent) {
  return BEESWEB_IDENTIFICATION_INTENTS.has((lastIntent || "").toString().trim().toLowerCase());
}

function isDcnetBeeswebIdentifiedServiceMenu(lastIntent) {
  return (lastIntent || "").toString().trim().toLowerCase() === INTENT_BEESWEB_IDENTIFIED_SERVICE_MENU;
}

function isDcnetBeeswebPhoneNotFoundMenu(lastIntent) {
  return (lastIntent || "").toString().trim().toLowerCase() === INTENT_BEESWEB_PHONE_NOT_FOUND_MENU;
}

function isDcnetBeeswebCpfNotFoundMenu(lastIntent) {
  const li = (lastIntent || "").toString().trim().toLowerCase();
  return li === INTENT_BEESWEB_CPF_NOT_FOUND_MENU || li === "cpf_nao_encontrado";
}

/**
 * Pré-carregar BeesWeb no webhook DC NET / WhatsApp quando há intenção operacional
 * ou continuidade do fluxo financeiro (respostas "1"/"2", comprovante, etc.).
 */
function shouldPrefetchBeeswebForDcnetWhatsapp({ tenant, origin, message, context }) {
  if ((tenant || "").toLowerCase() !== "dcnet" || (origin || "").toLowerCase() !== "whatsapp") {
    return false;
  }
  const lastIntent = (context?.lastIntent || "").toString().trim().toLowerCase();
  if (lastIntent === INTENT_HUMAN_GENERAL_QUEUE) {
    return false;
  }
  if (
    BEESWEB_IDENTIFICATION_INTENTS.has(lastIntent) ||
    lastIntent === "cpf_nao_encontrado" ||
    lastIntent === INTENT_BEESWEB_CPF_NOT_FOUND_MENU
  ) {
    return false;
  }
  if (lastIntent === INTENT_BEESWEB_PHONE_NOT_FOUND_MENU) {
    return false;
  }
  if (lastIntent === INTENT_BEESWEB_IDENTIFIED_SERVICE_MENU) {
    const t = (message || "").toString().trim();
    if (/^[1-4]$/.test(t)) return true;
    return isIntencaoOperacionalPorTextoAtual(message);
  }
  if (FINANCE_FLOW_INTENTS.has(lastIntent)) return true;
  if (isIntencaoOperacionalPorTextoAtual(message)) return true;

  const status = (context?.status || "").toString().trim().toLowerCase();
  if (status === "em_atendimento") return true;
  if (status === "handoff" && lastIntent !== "location_shared") return true;

  const markers = [
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
  if (markers.some((m) => lastIntent.includes(m))) return true;

  return false;
}

/**
 * Snapshot enxuto para o bot (sem trust_release; sem token em logs).
 * @param {string} phone
 * @param {{ includeRaw?: boolean }} [options]
 */
async function loadDcnetBeeswebSnapshotForPhone(phone, options = {}) {
  const includeRaw = Boolean(options.includeRaw);
  const emptyRaw = includeRaw ? null : undefined;

  if (!isBeeswebConfigured()) {
    return {
      ok: false,
      configured: false,
      skipped: true,
      customerFound: false,
      customerId: null,
      customerName: null,
      contractsSummary: { total: 0, activeCount: 0 },
      financialSummary: { openCount: 0, overdueCount: 0, observationCount: 0 },
      ticketsSummary: { total: 0, openCount: 0 },
      hasFinancialIssue: false,
      hasOpenTickets: false,
      error: "beesweb_not_configured",
      raw: emptyRaw,
    };
  }

  const safePhone = String(phone || "").trim();
  if (!safePhone) {
    return {
      ok: false,
      configured: true,
      skipped: false,
      customerFound: false,
      customerId: null,
      customerName: null,
      contractsSummary: { total: 0, activeCount: 0 },
      financialSummary: { openCount: 0, overdueCount: 0, observationCount: 0 },
      ticketsSummary: { total: 0, openCount: 0 },
      hasFinancialIssue: false,
      hasOpenTickets: false,
      error: "missing_phone",
      raw: emptyRaw,
    };
  }

  try {
    const cust = await findCustomerByPhone(safePhone);
    if (!cust.ok || !cust.found || !cust.firstCustomer) {
      return {
        ok: true,
        configured: true,
        skipped: false,
        customerFound: false,
        customerId: null,
        customerName: null,
        contractsSummary: { total: 0, activeCount: 0 },
        financialSummary: { openCount: 0, overdueCount: 0, observationCount: 0 },
        ticketsSummary: { total: 0, openCount: 0 },
        hasFinancialIssue: false,
        hasOpenTickets: false,
        error: null,
        raw: includeRaw ? { customerLookup: cust.raw } : undefined,
      };
    }

    const customerId = pickCustomerId(cust.firstCustomer);
    const customerName = pickCustomerName(cust.firstCustomer);
    if (!customerId) {
      return {
        ok: true,
        configured: true,
        skipped: false,
        customerFound: true,
        customerId: null,
        customerName,
        contractsSummary: { total: 0, activeCount: 0 },
        financialSummary: { openCount: 0, overdueCount: 0, observationCount: 0 },
        ticketsSummary: { total: 0, openCount: 0 },
        hasFinancialIssue: false,
        hasOpenTickets: false,
        error: "customer_id_missing",
        raw: includeRaw ? { customer: cust.firstCustomer } : undefined,
      };
    }

    const [contracts, charges, tickets] = await Promise.all([
      listContractsByCustomerId(customerId),
      listChargesByCustomerId(customerId),
      listTicketsByCustomerId(customerId),
    ]);

    const obsCount = charges.charges.filter((c) => c._situationNorm === "observation").length;

    const snap = {
      ok: true,
      configured: true,
      skipped: false,
      customerFound: true,
      customerId,
      customerName,
      contractsSummary: {
        total: contracts.contracts.length,
        activeCount: contracts.activeContracts.length,
      },
      financialSummary: {
        openCount: charges.openCharges.length,
        overdueCount: charges.overdueCharges.length,
        observationCount: obsCount,
      },
      ticketsSummary: {
        total: tickets.tickets.length,
        openCount: tickets.openTickets.length,
      },
      hasFinancialIssue: Boolean(charges.hasFinancialIssue),
      hasOpenTickets: Boolean(tickets.hasOpenTickets),
      error: null,
      raw: undefined,
    };

    if (includeRaw) {
      snap.raw = { customer: cust.raw, contracts: contracts.raw, charges: charges.raw, tickets: tickets.raw };
    }

    return snap;
  } catch {
    return {
      ok: false,
      configured: true,
      skipped: false,
      customerFound: false,
      customerId: null,
      customerName: null,
      contractsSummary: { total: 0, activeCount: 0 },
      financialSummary: { openCount: 0, overdueCount: 0, observationCount: 0 },
      ticketsSummary: { total: 0, openCount: 0 },
      hasFinancialIssue: false,
      hasOpenTickets: false,
      error: "beesweb_load_failed",
      raw: emptyRaw,
    };
  }
}

module.exports = {
  loadDcnetBeeswebSnapshotForPhone,
  shouldPrefetchBeeswebForDcnetWhatsapp,
  FINANCE_FLOW_INTENTS,
  isDcnetFinanceFlowIntent,
  isDcnetHumanGeneralHandoffIntent,
  isDcnetBeeswebIdentificationAwaitingCpf,
  isDcnetBeeswebIdentifiedServiceMenu,
  isDcnetBeeswebPhoneNotFoundMenu,
  isDcnetBeeswebCpfNotFoundMenu,
  BEESWEB_IDENTIFICATION_INTENTS,
};
