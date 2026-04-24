"use strict";

/**
 * Ponto único de entrada da integração BeesWeb (leitura + trust_release técnico).
 * Vocabulário alinhado ao frontend: customers, contracts, charges, calledies (chamados em `tickets.js`), trust_release.
 */
const { getBeeswebConfig, isBeeswebConfigured, getBeeswebQueryParamNames } = require("../../config/beesweb");
const { createBeeswebClient, joinBasePath } = require("./beeswebClient");
const {
  findCustomerByPhone,
  findCustomerByCpfCnpj,
  searchCustomers,
  releaseTrust,
} = require("./customers");
const { findCustomerByPhoneNumber, findCustomerByCpfDigits, normalizeCpf11 } = require("./customerLookup");
const {
  listChargesByCustomerId,
  listOpenChargesByCustomerId,
  listChargesByContractId,
  listOpenCharges,
  mapChargeSituation,
  extractChargePaymentChannels,
  selectPrimaryFinanceCharge,
  getPrimaryPendingChargeForCustomer,
} = require("./charges");
const {
  listTicketsByCustomerId,
  listOpenTicketsByCustomerId,
  listOpenTickets,
  listCallediesByCustomerId,
  listOpenCallediesByCustomerId,
  mapCalledStatus,
} = require("./tickets");
const {
  listContractsByCustomerId,
  searchContracts,
  findContractById,
  mapMessagePayment,
} = require("./contracts");

module.exports = {
  getBeeswebConfig,
  isBeeswebConfigured,
  getBeeswebQueryParamNames,
  createBeeswebClient,
  joinBasePath,
  findCustomerByPhone,
  findCustomerByCpfCnpj,
  searchCustomers,
  releaseTrust,
  findCustomerByPhoneNumber,
  findCustomerByCpfDigits,
  normalizeCpf11,
  listChargesByCustomerId,
  listOpenChargesByCustomerId,
  listChargesByContractId,
  listOpenCharges,
  extractChargePaymentChannels,
  selectPrimaryFinanceCharge,
  getPrimaryPendingChargeForCustomer,
  listTicketsByCustomerId,
  listOpenTicketsByCustomerId,
  listOpenTickets,
  listCallediesByCustomerId,
  listOpenCallediesByCustomerId,
  mapCalledStatus,
  listContractsByCustomerId,
  searchContracts,
  findContractById,
  mapMessagePayment,
  mapChargeSituation,
};
