"use strict";

const { createBeeswebClient } = require("./beeswebClient");
const { extractArray } = require("./beeswebNormalize");
const { buildPhoneSearchTerms } = require("./customers");

function digitsOnly(s) {
  return String(s || "").replace(/\D/g, "");
}

function documentDigitsFromCustomer(c) {
  if (!c || typeof c !== "object") return "";
  const raw = c.cpf_cnpj;
  return raw != null ? digitsOnly(String(raw)) : "";
}

/**
 * CPF com 11 dígitos (somente números) ou null se inválido.
 * @param {string} input
 * @returns {string|null}
 */
function normalizeCpf11(input) {
  const d = digitsOnly(input);
  if (d.length !== 11) return null;
  return d;
}

function isCustomerBlocked(customer) {
  if (!customer || typeof customer !== "object") return false;
  return customer.status === 0 || Boolean(customer.disabled_at);
}

/**
 * GET /adm/customers?search=… — busca server-side (não baixa lista completa).
 * Confirma `phone.number_only` contra variações do WhatsApp (com/sem 55).
 */
async function findCustomerByPhoneNumber(phone) {
  const client = createBeeswebClient();

  if (!client.isConfigured) {
    return { ok: false, reason: "not_configured" };
  }

  const terms = buildPhoneSearchTerms(phone);
  const candidates = new Set(terms.map((t) => digitsOnly(t)).filter(Boolean));

  let lastErrorReason = null;
  for (const term of terms) {
    try {
      const raw = await client.request("GET", "adm/customers", {
        query: { search: term },
      });
      const list = extractArray(raw, ["data", "customers", "clientes", "items", "results"]);
      const found = list.find((c) => {
        if (!c || typeof c !== "object") return false;
        const only = c.phone != null ? c.phone.number_only : null;
        if (only == null) return false;
        return candidates.has(digitsOnly(String(only)));
      });
      if (found) {
        return {
          ok: true,
          customer: found,
          isBlocked: isCustomerBlocked(found),
        };
      }
    } catch (err) {
      lastErrorReason = err.code || "error";
    }
  }

  if (lastErrorReason) {
    return { ok: false, reason: lastErrorReason };
  }
  return { ok: false, reason: "not_found" };
}

/**
 * GET /adm/customers?search=<cpf11> — reforço por documento (CPF 11 dígitos).
 * Confere `cpf_cnpj` na resposta (evita falso positivo).
 * @param {string} cpf11 onze dígitos
 */
async function findCustomerByCpfDigits(cpf11) {
  const client = createBeeswebClient();
  const normalized = normalizeCpf11(cpf11);
  if (!normalized) {
    return { ok: false, reason: "invalid_cpf" };
  }
  if (!client.isConfigured) {
    return { ok: false, reason: "not_configured" };
  }

  try {
    const raw = await client.request("GET", "adm/customers", {
      query: { search: normalized },
    });
    const list = extractArray(raw, ["data", "customers", "clientes", "items", "results"]);
    const found = list.find((c) => documentDigitsFromCustomer(c) === normalized);
    if (!found) {
      return { ok: false, reason: "not_found" };
    }
    return {
      ok: true,
      customer: found,
      isBlocked: isCustomerBlocked(found),
    };
  } catch (err) {
    return { ok: false, reason: err.code || "error" };
  }
}

module.exports = {
  findCustomerByPhoneNumber,
  findCustomerByCpfDigits,
  normalizeCpf11,
};
