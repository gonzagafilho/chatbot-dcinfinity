"use strict";

const { isBeeswebConfigured, getBeeswebQueryParamNames } = require("../../config/beesweb");
const { createBeeswebClient } = require("./beeswebClient");
const { extractArray, extractTotal } = require("./beeswebNormalize");

/**
 * situation (charges) — alinhado ao frontend/documentação:
 * 1 em aberto, 2 em atraso, 3 efetuado, 4 em observação.
 */
function mapChargeSituation(raw) {
  const n = Number(raw);
  if (n === 1) return "open";
  if (n === 2) return "overdue";
  if (n === 3) return "paid";
  if (n === 4) return "observation";
  if (raw === "" || raw == null || Number.isNaN(n)) return "unknown";
  return `unknown_${String(raw)}`;
}

function normalizeChargeRow(row) {
  const situationRaw = row.situation ?? row.situacao ?? row.status ?? row.situacao_cobranca;
  const situation = mapChargeSituation(situationRaw);
  return { ...row, _situationNorm: situation, _situationRaw: situationRaw };
}

function normalizeChargesPayload(raw) {
  const list = extractArray(raw, ["data", "charges", "cobrancas", "items", "results"]).map((r) =>
    normalizeChargeRow(r && typeof r === "object" ? r : {})
  );
  const total = extractTotal(raw, list.length);
  return { charges: list, total };
}

function filterBySituation(charges, want) {
  return charges.filter((c) => c._situationNorm === want);
}

function buildChargesResult(ok, raw, charges, extra = {}) {
  const openCharges = filterBySituation(charges, "open");
  const overdueCharges = filterBySituation(charges, "overdue");
  const paidCharges = filterBySituation(charges, "paid");
  const obs = filterBySituation(charges, "observation");
  const hasFinancialIssue = openCharges.length > 0 || overdueCharges.length > 0;
  return {
    ok,
    found: charges.length > 0,
    total: charges.length,
    charges,
    openCharges,
    overdueCharges,
    paidCharges,
    observationCharges: obs,
    hasFinancialIssue,
    raw,
    ...extra,
  };
}

async function listChargesWithQuery(query) {
  if (!isBeeswebConfigured()) {
    return buildChargesResult(false, null, [], {});
  }
  const client = createBeeswebClient();
  if (!client.isConfigured) {
    return buildChargesResult(false, null, [], {});
  }
  try {
    const raw = await client.request("GET", "adm/charges", { query });
    const { charges, total } = normalizeChargesPayload(raw);
    return buildChargesResult(true, raw, charges, { apiTotal: total });
  } catch {
    return buildChargesResult(false, null, [], {});
  }
}

/**
 * GET /adm/charges — customer_id (nome do parâmetro configurável).
 */
async function listChargesByCustomerId(customerId, extraQuery = {}) {
  const id = String(customerId ?? "").trim();
  if (!id) return buildChargesResult(false, null, [], {});
  const qp = getBeeswebQueryParamNames();
  return listChargesWithQuery({ [qp.chargeCustomerId]: id, ...extraQuery });
}

/**
 * Cobranças com situation "open" (1) — busca por customer_id e filtra no cliente.
 */
async function listOpenChargesByCustomerId(customerId) {
  const all = await listChargesByCustomerId(customerId);
  const openOnly = all.charges.filter((c) => c._situationNorm === "open");
  return buildChargesResult(all.ok, all.raw, openOnly, { apiTotal: all.apiTotal });
}

/**
 * GET /adm/charges — contract_id
 */
async function listChargesByContractId(contractId, extraQuery = {}) {
  const id = String(contractId ?? "").trim();
  if (!id) return buildChargesResult(false, null, [], {});
  const qp = getBeeswebQueryParamNames();
  return listChargesWithQuery({ [qp.chargeContractId]: id, ...extraQuery });
}

/** Compat com stub anterior: sem customerId não consulta. */
async function listOpenCharges() {
  return buildChargesResult(false, null, [], { reason: "customer_id_required" });
}

function firstNonEmptyString(...vals) {
  for (const v of vals) {
    const s = v != null ? String(v).trim() : "";
    if (s) return s;
  }
  return "";
}

/**
 * Campos comuns em APIs de cobrança (BeesWeb / variantes). Só lê o que existir no objeto real.
 * @param {object} row
 * @returns {{ linhaDigitavel: string, boletoUrl: string, pixCopiaECola: string, pixQrUrl: string }}
 */
function extractChargePaymentChannels(row) {
  if (!row || typeof row !== "object") {
    return { linhaDigitavel: "", boletoUrl: "", pixCopiaECola: "", pixQrUrl: "" };
  }
  const linhaDigitavel = firstNonEmptyString(
    row.linha_digitavel,
    row.linhaDigitavel,
    row.digitable_line,
    row.codigo_barras,
    row.barcode,
    row.bank_slip_line,
    row.linha_digitavel_boleto
  );
  const boletoUrl = firstNonEmptyString(
    row.link,
    row.link_boleto,
    row.boleto_link,
    row.url_boleto,
    row.billet_url,
    row.pdf_url,
    row.bank_slip_url,
    row.url_pdf,
    row.boleto_url
  );
  const pixCopiaECola = firstNonEmptyString(
    row.pix_copia_cola,
    row.pix_copy_paste,
    row.pix_emv,
    row.emv,
    row.qrcode_text,
    row.qr_code_text,
    row.pix_payload,
    row.pix_copia_e_cola,
    row.br_code,
    row.payload_pix
  );
  const pixQrUrl = firstNonEmptyString(
    row.pix_qrcode_url,
    row.qr_code_url,
    row.pix_image_url,
    row.qrcode_url,
    row.pix_qr_code_url
  );
  return { linhaDigitavel, boletoUrl, pixCopiaECola, pixQrUrl };
}

function parseChargeDueTs(row) {
  const raw = firstNonEmptyString(
    row.due_at,
    row.data_vencimento,
    row.vencimento,
    row.due_date,
    row.expiration_date,
    row.expires_at,
    row.dataVencimento
  );
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

/**
 * Prioridade: em atraso (overdue) antes de em aberto (open); depois vencimento mais antigo;
 * empate: id numérico maior (mais recente na API).
 * @param {Array<{ _situationNorm: string }>} chargesList linhas já normalizadas
 */
function selectPrimaryFinanceCharge(chargesList) {
  const pend = (chargesList || []).filter(
    (c) => c && (c._situationNorm === "open" || c._situationNorm === "overdue")
  );
  if (!pend.length) return null;
  pend.sort((a, b) => {
    const oa = a._situationNorm === "overdue" ? 0 : 1;
    const ob = b._situationNorm === "overdue" ? 0 : 1;
    if (oa !== ob) return oa - ob;
    const ta = parseChargeDueTs(a) ?? 9e15;
    const tb = parseChargeDueTs(b) ?? 9e15;
    if (ta !== tb) return ta - tb;
    const ida = Number(a.id ?? a.charge_id ?? a.cobranca_id ?? 0) || 0;
    const idb = Number(b.id ?? b.charge_id ?? b.cobranca_id ?? 0) || 0;
    return idb - ida;
  });
  return pend[0];
}

/** Cobrança em aberto na API real: value_paid === null (não paga). */
function isChargeUnsettledByValuePaid(row) {
  if (!row || typeof row !== "object") return false;
  return row.value_paid === null || row.value_paid === undefined;
}

/**
 * Primeira cobrança não paga (value_paid ausente/null), vencimento mais antigo primeiro.
 * @param {object[]} chargesList
 */
function selectPrimaryPendingChargeByValuePaid(chargesList) {
  const pend = (chargesList || []).filter(isChargeUnsettledByValuePaid);
  if (!pend.length) return null;
  pend.sort((a, b) => {
    const ta = parseChargeDueTs(a);
    const tb = parseChargeDueTs(b);
    const va = ta == null ? Number.MAX_SAFE_INTEGER : ta;
    const vb = tb == null ? Number.MAX_SAFE_INTEGER : tb;
    if (va !== vb) return va - vb;
    return 0;
  });
  return pend[0];
}

/**
 * Cobrança pendente mais relevante para exibir boleto/Pix (GET /adm/charges?customer_id=…).
 * @param {string|number} customerId
 * @returns {Promise<{ ok: boolean, charge: object|null, extracted: object, reason?: string|null }>}
 */
async function getPrimaryPendingChargeForCustomer(customerId) {
  const id = String(customerId ?? "").trim();
  if (!id) {
    return { ok: false, charge: null, extracted: extractChargePaymentChannels(null), reason: "missing_customer_id" };
  }
  const all = await listChargesByCustomerId(id);
  if (!all.ok) {
    return { ok: false, charge: null, extracted: extractChargePaymentChannels(null), reason: "api_error" };
  }
  const primary = selectPrimaryPendingChargeByValuePaid(all.charges);
  if (!primary) {
    return { ok: true, charge: null, extracted: extractChargePaymentChannels(null), reason: "no_pending_charge" };
  }
  return { ok: true, charge: primary, extracted: extractChargePaymentChannels(primary), reason: null };
}

module.exports = {
  listChargesByCustomerId,
  listOpenChargesByCustomerId,
  listChargesByContractId,
  listOpenCharges,
  mapChargeSituation,
  extractChargePaymentChannels,
  selectPrimaryFinanceCharge,
  selectPrimaryPendingChargeByValuePaid,
  getPrimaryPendingChargeForCustomer,
};
