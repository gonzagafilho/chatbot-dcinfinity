"use strict";

const { isBeeswebConfigured, getBeeswebQueryParamNames, getBeeswebAdmResourcePaths } = require("../../config/beesweb");
const { createBeeswebClient } = require("./beeswebClient");
const { extractArray, extractTotal } = require("./beeswebNormalize");

function pickContractId(c) {
  if (!c || typeof c !== "object") return null;
  const id = c.id ?? c.contrato_id ?? c.contract_id ?? c.contractId ?? c.numero ?? null;
  return id != null && String(id).trim() ? String(id).trim() : null;
}

function pickCustomerIdFromContract(c) {
  if (!c || typeof c !== "object") return null;
  const id = c.customer_id ?? c.cliente_id ?? c.customerId ?? c.codigo_cliente ?? null;
  return id != null && String(id).trim() ? String(id).trim() : null;
}

/**
 * message_payment / msg: 1 liberado, 2 pendente, 3 bloqueado (documentação frontend).
 */
function mapMessagePayment(raw) {
  const n = Number(raw);
  if (n === 1) return "released";
  if (n === 2) return "pending";
  if (n === 3) return "blocked";
  if (raw === "" || raw == null || Number.isNaN(n)) return "unknown";
  return `unknown_${String(raw)}`;
}

function normalizeContractRow(c) {
  const row = c && typeof c === "object" ? c : {};
  const mpRaw = row.msg ?? row.message_payment ?? row.messagePayment ?? null;
  const _messagePaymentNorm = mapMessagePayment(mpRaw);
  return { ...row, _messagePaymentNorm, _messagePaymentRaw: mpRaw };
}

/** Não bloqueado: liberado, pendente ou valor desconhecido (API sem msg ainda conta como não bloqueado). */
function isContractActiveForSummary(row) {
  return row._messagePaymentNorm !== "blocked";
}

function normalizeContractsPayload(raw) {
  const contracts = extractArray(raw, ["data", "contratos", "contracts", "items", "results"]).map((r) =>
    normalizeContractRow(r && typeof r === "object" ? r : {})
  );
  const total = extractTotal(raw, contracts.length);
  const activeContracts = contracts.filter(isContractActiveForSummary);
  const blockedContracts = contracts.filter((c) => c._messagePaymentNorm === "blocked");
  return { contracts, total, activeContracts, blockedContracts };
}

/**
 * Lista contratos por cliente (path configurável; default adm/contracts).
 */
async function listContractsByCustomerId(customerId) {
  const id = String(customerId ?? "").trim();
  if (!id) {
    return { ok: false, found: false, total: 0, contracts: [], activeContracts: [], blockedContracts: [], raw: null };
  }
  if (!isBeeswebConfigured()) {
    return { ok: false, found: false, total: 0, contracts: [], activeContracts: [], blockedContracts: [], raw: null };
  }
  const client = createBeeswebClient();
  if (!client.isConfigured) {
    return { ok: false, found: false, total: 0, contracts: [], activeContracts: [], blockedContracts: [], raw: null };
  }
  const qp = getBeeswebQueryParamNames();
  const { contracts: contractsPath } = getBeeswebAdmResourcePaths();
  try {
    const raw = await client.request("GET", contractsPath, {
      query: { [qp.contractCustomerId]: id },
    });
    const { contracts, total, activeContracts, blockedContracts } = normalizeContractsPayload(raw);
    return {
      ok: true,
      found: contracts.length > 0,
      total,
      contracts,
      activeContracts,
      blockedContracts,
      raw,
    };
  } catch {
    return { ok: false, found: false, total: 0, contracts: [], activeContracts: [], blockedContracts: [], raw: null };
  }
}

/**
 * Busca contratos (path configurável; default adm/contracts).
 */
async function searchContracts(term) {
  const t = String(term || "").trim();
  if (!t) {
    return { ok: false, found: false, total: 0, contracts: [], activeContracts: [], blockedContracts: [], raw: null };
  }
  if (!isBeeswebConfigured()) {
    return { ok: false, found: false, total: 0, contracts: [], activeContracts: [], blockedContracts: [], raw: null };
  }
  const client = createBeeswebClient();
  if (!client.isConfigured) {
    return { ok: false, found: false, total: 0, contracts: [], activeContracts: [], blockedContracts: [], raw: null };
  }
  const qp = getBeeswebQueryParamNames();
  const { contracts: contractsPath } = getBeeswebAdmResourcePaths();
  try {
    const raw = await client.request("GET", contractsPath, { query: { [qp.contractSearch]: t } });
    const { contracts, total, activeContracts, blockedContracts } = normalizeContractsPayload(raw);
    return {
      ok: true,
      found: contracts.length > 0,
      total,
      contracts,
      activeContracts,
      blockedContracts,
      raw,
    };
  } catch {
    return { ok: false, found: false, total: 0, contracts: [], activeContracts: [], blockedContracts: [], raw: null };
  }
}

/**
 * Compat: busca por identificador (usa search).
 */
async function findContractById(contractId) {
  return searchContracts(String(contractId || "").trim());
}

module.exports = {
  listContractsByCustomerId,
  searchContracts,
  findContractById,
  pickContractId,
  pickCustomerIdFromContract,
  mapMessagePayment,
};
