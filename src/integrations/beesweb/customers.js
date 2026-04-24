"use strict";

const { isBeeswebConfigured } = require("../../config/beesweb");
const { createBeeswebClient } = require("./beeswebClient");
const { extractArray, extractTotal } = require("./beeswebNormalize");

/**
 * @param {string|number} customerId
 * @returns {string|null}
 */
function normalizeCustomerIdForPath(customerId) {
  const id = String(customerId ?? "").trim();
  if (!id) return null;
  if (id.includes("/") || id.includes("..") || id.includes("?") || id.includes("#")) return null;
  return id;
}

function digitsOnly(s) {
  return String(s || "").replace(/\D/g, "");
}

/**
 * Termos de busca por telefone (WhatsApp costuma vir com DDI 55).
 * Celular antigo (DDD + 8 dígitos) vs cadastro com 9 após o DDD: gera também DDD+9+8 e 55+essa forma.
 */
function buildPhoneSearchTerms(phone) {
  const d = digitsOnly(phone);
  const out = [];
  const seen = new Set();
  const push = (x) => {
    if (!x || seen.has(x)) return;
    seen.add(x);
    out.push(x);
  };
  push(d);
  if (d.length >= 12 && d.startsWith("55")) push(d.slice(2));
  if (d.length >= 10 && !d.startsWith("55")) push(`55${d}`);

  const pushNationalTenWithMobileNine = (nationalDigits) => {
    const n = digitsOnly(nationalDigits);
    if (n.length !== 10) return;
    const withNine = `${n.slice(0, 2)}9${n.slice(2)}`;
    if (withNine.length !== 11) return;
    push(withNine);
    push(`55${withNine}`);
  };

  if (d.length >= 12 && d.startsWith("55")) {
    pushNationalTenWithMobileNine(d.slice(2));
  }
  if (d.length === 10 && !d.startsWith("55")) {
    pushNationalTenWithMobileNine(d);
  }

  return out;
}

function pickCustomerId(c) {
  if (!c || typeof c !== "object") return null;
  const id =
    c.id ??
    c.customer_id ??
    c.customerId ??
    c.codigo_cliente ??
    c.codigoCliente ??
    c.cliente_id ??
    null;
  return id != null && String(id).trim() ? String(id).trim() : null;
}

function pickCustomerName(c) {
  if (!c || typeof c !== "object") return null;
  const n =
    c.nome ??
    c.name ??
    c.razao_social ??
    c.razaoSocial ??
    c.fantasia ??
    null;
  return n != null && String(n).trim() ? String(n).trim() : null;
}

function normalizeCustomerListPayload(raw, keysOrdem) {
  const customers = extractArray(raw, keysOrdem);
  const total = extractTotal(raw, customers.length);
  const firstCustomer = customers.length ? customers[0] : null;
  return { customers, total, firstCustomer };
}

function documentDigitsFromCustomer(c) {
  if (!c || typeof c !== "object") return "";
  const raw = c.cpf_cnpj;
  return raw != null ? digitsOnly(String(raw)) : "";
}

/**
 * Desbloqueio por confiança (BeesWeb).
 * POST /adm/customers/{customerId}/trust_release — recurso técnico; não usar no fluxo automático do bot.
 */
async function releaseTrust(customerId) {
  const id = normalizeCustomerIdForPath(customerId);
  if (!id) {
    return { ok: false, released: false, reason: "invalid_customer_id" };
  }

  if (!isBeeswebConfigured()) {
    return { ok: false, released: false, reason: "beesweb_not_configured" };
  }

  const client = createBeeswebClient();
  if (!client.isConfigured) {
    return { ok: false, released: false, reason: "beesweb_not_configured" };
  }

  const path = `adm/customers/${encodeURIComponent(id)}/trust_release`;

  try {
    const raw = await client.request("POST", path, { body: {} });
    let released = true;
    if (raw && typeof raw === "object" && "released" in raw && raw.released === false) {
      released = false;
    }
    return { ok: true, released, raw };
  } catch (e) {
    const code = e && e.code ? String(e.code) : "beesweb_request_failed";
    return {
      ok: false,
      released: false,
      reason: code,
      raw: e && e.status != null ? { status: e.status } : undefined,
    };
  }
}

/**
 * GET /adm/customers?search=… — mesmo critério de customerLookup (confere phone.number_only).
 */
async function findCustomerByPhone(phone) {
  if (!isBeeswebConfigured()) {
    return { ok: false, found: false, total: 0, customers: [], firstCustomer: null, raw: null };
  }
  const client = createBeeswebClient();
  if (!client.isConfigured) {
    return { ok: false, found: false, total: 0, customers: [], firstCustomer: null, raw: null };
  }
  const terms = buildPhoneSearchTerms(phone);
  const candidates = new Set(terms.map((t) => digitsOnly(t)).filter(Boolean));
  let lastRaw = null;

  try {
    for (const term of terms) {
      lastRaw = await client.request("GET", "adm/customers", {
        query: { search: term },
      });
      const list = extractArray(lastRaw, ["data", "clientes", "customers", "items", "results"]);
      const found = list.find((c) => {
        if (!c || typeof c !== "object") return false;
        const only = c.phone != null ? c.phone.number_only : null;
        if (only == null) return false;
        return candidates.has(digitsOnly(String(only)));
      });
      if (found) {
        return {
          ok: true,
          found: true,
          total: 1,
          customers: [found],
          firstCustomer: found,
          raw: lastRaw,
        };
      }
    }
    return {
      ok: true,
      found: false,
      total: 0,
      customers: [],
      firstCustomer: null,
      raw: lastRaw,
    };
  } catch (e) {
    return {
      ok: false,
      found: false,
      total: 0,
      customers: [],
      firstCustomer: null,
      raw: lastRaw,
    };
  }
}

/**
 * GET /adm/customers?search= — documento (confere cpf_cnpj na lista retornada).
 */
async function findCustomerByCpfCnpj(document) {
  const doc = digitsOnly(document);
  if (!doc) {
    return { ok: false, found: false, total: 0, customers: [], firstCustomer: null, raw: null };
  }
  if (!isBeeswebConfigured()) {
    return { ok: false, found: false, total: 0, customers: [], firstCustomer: null, raw: null };
  }
  const client = createBeeswebClient();
  if (!client.isConfigured) {
    return { ok: false, found: false, total: 0, customers: [], firstCustomer: null, raw: null };
  }
  try {
    const raw = await client.request("GET", "adm/customers", { query: { search: doc } });
    const { customers, total } = normalizeCustomerListPayload(raw, [
      "data",
      "clientes",
      "customers",
      "items",
      "results",
    ]);
    const verified = customers.filter((c) => documentDigitsFromCustomer(c) === doc);
    const firstCustomer = verified[0] || null;
    return {
      ok: true,
      found: verified.length > 0,
      total: total || verified.length,
      customers: verified,
      firstCustomer,
      raw,
    };
  } catch {
    return { ok: false, found: false, total: 0, customers: [], firstCustomer: null, raw: null };
  }
}

/**
 * GET /adm/customers?search= — termo livre (nome, telefone parcial, etc., conforme API).
 */
async function searchCustomers(term) {
  const t = String(term || "").trim();
  if (!t) {
    return { ok: false, found: false, total: 0, customers: [], firstCustomer: null, raw: null };
  }
  if (!isBeeswebConfigured()) {
    return { ok: false, found: false, total: 0, customers: [], firstCustomer: null, raw: null };
  }
  const client = createBeeswebClient();
  if (!client.isConfigured) {
    return { ok: false, found: false, total: 0, customers: [], firstCustomer: null, raw: null };
  }
  try {
    const raw = await client.request("GET", "adm/customers", { query: { search: t } });
    const { customers, total, firstCustomer } = normalizeCustomerListPayload(raw, [
      "data",
      "clientes",
      "customers",
      "items",
      "results",
    ]);
    return {
      ok: true,
      found: customers.length > 0,
      total: total || customers.length,
      customers,
      firstCustomer,
      raw,
    };
  } catch {
    return { ok: false, found: false, total: 0, customers: [], firstCustomer: null, raw: null };
  }
}

module.exports = {
  findCustomerByPhone,
  findCustomerByCpfCnpj,
  searchCustomers,
  releaseTrust,
  pickCustomerId,
  pickCustomerName,
  buildPhoneSearchTerms,
};
