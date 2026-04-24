"use strict";

/**
 * Configuração central BeesWeb (env).
 * Chaves esperadas (definir no .env quando a API estiver confirmada):
 * - BEESWEB_BASE_URL   (ex.: https://api.exemplo.com — sem barra final opcional)
 * - BEESWEB_TOKEN      (ou BEESWEB_API_TOKEN como alias)
 * - BEESWEB_TIMEOUT_MS (opcional, default 12000, clamp 1000–60000)
 * - BEESWEB_PATH_ADM_CONTRACTS (opcional; default adm/contracts — legado adm/contratos costuma 404)
 * - BEESWEB_PATH_ADM_TICKETS (opcional; default adm/calledies na API beesweb.com.br; adm/tickets costuma 404)
 *
 * Não logar valores de token aqui ou noutros módulos.
 */

function getBeeswebConfig() {
  const baseUrl = (process.env.BEESWEB_BASE_URL || "").trim().replace(/\/$/, "");
  const token = (process.env.BEESWEB_TOKEN || process.env.BEESWEB_API_TOKEN || "").trim();
  const rawTimeout = parseInt(process.env.BEESWEB_TIMEOUT_MS || "12000", 10);
  const timeoutMs = Number.isFinite(rawTimeout)
    ? Math.min(Math.max(rawTimeout, 1000), 60000)
    : 12000;

  const isComplete = Boolean(baseUrl && token);

  return { baseUrl, token, timeoutMs, isComplete };
}

function isBeeswebConfigured() {
  return getBeeswebConfig().isComplete;
}

/**
 * Nomes de query string (sobrescrever via .env se a API BeesWeb usar outros).
 * Documentação oficial dos parâmetros pode divergir — ajustar env em produção após teste.
 */
function getBeeswebQueryParamNames() {
  return {
    clientPhone: (process.env.BEESWEB_QUERY_CLIENT_PHONE || "telefone").trim(),
    clientDocument: (process.env.BEESWEB_QUERY_CLIENT_DOCUMENT || "documento").trim(),
    clientSearch: (process.env.BEESWEB_QUERY_CLIENT_SEARCH || "search").trim(),
    contractCustomerId: (process.env.BEESWEB_QUERY_CONTRACT_CUSTOMER_ID || "customer_id").trim(),
    contractSearch: (process.env.BEESWEB_QUERY_CONTRACT_SEARCH || "search").trim(),
    chargeCustomerId: (process.env.BEESWEB_QUERY_CHARGE_CUSTOMER_ID || "customer_id").trim(),
    chargeContractId: (process.env.BEESWEB_QUERY_CHARGE_CONTRACT_ID || "contract_id").trim(),
    chargeSituation: (process.env.BEESWEB_QUERY_CHARGE_SITUATION || "situation").trim(),
    ticketCustomerId: (process.env.BEESWEB_QUERY_TICKET_CUSTOMER_ID || "customer_id").trim(),
  };
}

/** Paths relativos à base BeesWeb (alinhados a adm/customers e adm/charges). */
function getBeeswebAdmResourcePaths() {
  const norm = (p) =>
    String(p || "")
      .trim()
      .replace(/^\/+/, "");
  return {
    contracts: norm(process.env.BEESWEB_PATH_ADM_CONTRACTS || "adm/contracts"),
    tickets: norm(process.env.BEESWEB_PATH_ADM_TICKETS || "adm/calledies"),
  };
}

module.exports = {
  getBeeswebConfig,
  isBeeswebConfigured,
  getBeeswebQueryParamNames,
  getBeeswebAdmResourcePaths,
};
