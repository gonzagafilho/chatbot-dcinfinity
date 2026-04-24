"use strict";

const { isBeeswebConfigured } = require("../../config/beesweb");
const { createBeeswebClient } = require("./beeswebClient");
const { extractArray, extractTotal } = require("./beeswebNormalize");
const { listContractsByCustomerId } = require("./contracts");
const { pickCustomerId, pickCustomerName } = require("./customers");

function digitsOnly(s) {
  return String(s || "").replace(/\D/g, "");
}

function pickPhoneDigitsFromCustomer(c) {
  if (!c || typeof c !== "object") return null;
  if (c.phone && c.phone.number_only != null) {
    const d = digitsOnly(String(c.phone.number_only));
    if (d.length >= 10) return d;
  }
  const fallbacks = [c.whatsapp, c.celular, c.telefone, c.phone, c.cel, c.msisdn];
  for (const f of fallbacks) {
    if (f == null) continue;
    if (typeof f === "string") {
      const d = digitsOnly(f);
      if (d.length >= 10) return d;
    } else if (typeof f === "object" && f.number_only != null) {
      const d = digitsOnly(String(f.number_only));
      if (d.length >= 10) return d;
    }
  }
  return null;
}

function isLikelyActiveCustomer(c) {
  if (c.ativo === false) return false;
  if (c.cancelado === true || c.cancelled === true) return false;
  const s = String(c.situacao ?? c.status ?? c.situation ?? "")
    .trim()
    .toLowerCase();
  if (!s) return true;
  if (["inativo", "inativa", "cancelado", "cancelada", "bloqueado", "bloqueada", "0"].includes(s)) {
    return false;
  }
  if (s === "ativo" || s === "ativa" || s === "1" || s === "liberado") return true;
  return true;
}

function phoneDedupKey(d) {
  if (!d || d.length < 10) return d;
  if (d.length >= 12 && d.startsWith("55") && d.length > 12) {
    return d.slice(-11);
  }
  return d;
}

async function fetchCustomersPage(client, page, perPage, path) {
  const pageParam = (process.env.BEESWEB_BROADCAST_PAGE_PARAM || "page").trim() || "page";
  const perParam = (process.env.BEESWEB_BROADCAST_PER_PAGE_PARAM || "per_page").trim() || "per_page";
  const q = { [pageParam]: page, [perParam]: perPage };
  const p = (path || "adm/customers").replace(/^\/+/, "");
  const raw = await client.request("GET", p, { query: q });
  const list = extractArray(raw, [
    "data",
    "clientes",
    "customers",
    "items",
    "results",
  ]);
  const total = extractTotal(raw, list.length);
  return { list, total, raw };
}

async function fetchCustomersSingleNoPagination(client) {
  const p = (process.env.BEESWEB_BROADCAST_CUSTOMERS_PATH || "adm/customers")
    .replace(/^\/+/, "");
  const raw = await client.request("GET", p, { query: {} });
  return extractArray(raw, [
    "data",
    "clientes",
    "customers",
    "items",
    "results",
  ]);
}

async function collectAllCustomers() {
  if (!isBeeswebConfigured()) {
    const err = new Error("beesweb_not_configured");
    err.code = "BEESWEB_NOT_CONFIGURED";
    throw err;
  }
  const client = createBeeswebClient();
  if (!client.isConfigured) {
    const err = new Error("beesweb_not_configured");
    err.code = "BEESWEB_NOT_CONFIGURED";
    throw err;
  }

  const perPage = Math.max(
    1,
    Math.min(500, parseInt(process.env.BEESWEB_BROADCAST_PER_PAGE || "200", 10) || 200)
  );
  const maxPages = Math.max(1, parseInt(process.env.BEESWEB_BROADCAST_MAX_PAGES || "500", 10) || 500);
  const listPath = (process.env.BEESWEB_BROADCAST_CUSTOMERS_PATH || "adm/customers")
    .trim()
    .replace(/^\/+/, "");
  const seen = new Set();
  const all = [];
  const pushItem = (c) => {
    if (!c || typeof c !== "object") return;
    const id = pickCustomerId(c);
    const k = id || pickPhoneDigitsFromCustomer(c) || JSON.stringify(c);
    if (seen.has(k)) return;
    seen.add(k);
    all.push(c);
  };

  let paged = false;
  for (let page = 1; page <= maxPages; page++) {
    try {
      const { list } = await fetchCustomersPage(client, page, perPage, listPath);
      paged = true;
      if (!list.length) break;
      for (const c of list) pushItem(c);
      if (list.length < perPage) break;
    } catch (e) {
      paged = true;
      if (page === 1) {
        const list = await fetchCustomersSingleNoPagination(client);
        for (const c of list) pushItem(c);
      } else {
        const err = e && (e.status || e.code) ? e : e;
        console.error("[broadcastCustomerList] page_fetch_failed", err?.message || err);
      }
      break;
    }
  }

  if (!paged && all.length === 0) {
    const list = await fetchCustomersSingleNoPagination(client);
    for (const c of list) pushItem(c);
  } else if (all.length === 0) {
    try {
      const list = await fetchCustomersSingleNoPagination(client);
      for (const c of list) pushItem(c);
    } catch (e) {
      console.error("[broadcastCustomerList] single_fetch_failed", e?.message || e);
    }
  }

  return all;
}

function filterByActive(customers) {
  return customers.filter((c) => isLikelyActiveCustomer(c) && pickPhoneDigitsFromCustomer(c));
}

async function filterByActiveContract(allCustomers) {
  const withPhone = allCustomers.filter((c) => pickPhoneDigitsFromCustomer(c) && isLikelyActiveCustomer(c));
  const concurrency = Math.max(
    1,
    Math.min(8, parseInt(process.env.BEESWEB_BROADCAST_CONTRACT_CONCURRENCY || "4", 10) || 4)
  );
  const out = [];
  for (let i = 0; i < withPhone.length; i += concurrency) {
    const batch = withPhone.slice(i, i + concurrency);
    const done = await Promise.all(
      batch.map(async (c) => {
        const id = pickCustomerId(c);
        if (!id) return null;
        try {
          const r = await listContractsByCustomerId(id);
          if (r.ok && r.activeContracts && r.activeContracts.length > 0) return c;
        } catch {
          return null;
        }
        return null;
      })
    );
    for (const c of done) {
      if (c) out.push(c);
    }
  }
  return out;
}

function buildPhoneList(customers) {
  const byKey = new Map();
  for (const c of customers) {
    let d = pickPhoneDigitsFromCustomer(c);
    if (!d) continue;
    d = d.replace(/\D/g, "");
    if (d.length < 10) continue;
    if (d.length > 15) d = d.slice(0, 15);
    const k = phoneDedupKey(d);
    if (byKey.has(k)) continue;
    byKey.set(k, d);
  }
  return Array.from(byKey.values());
}

function filterCustomersByAudienceList(customers, audience) {
  if (audience === "all") {
    return customers.filter((c) => pickPhoneDigitsFromCustomer(c));
  }
  if (audience === "active") {
    return filterByActive(customers);
  }
  if (audience === "contract") {
    return customers;
  }
  return customers;
}

function maskFromDigits(phone) {
  const s = String(phone || "");
  if (s.length < 4) return "****";
  if (s.length <= 6) return s[0] + "****" + s.slice(-1);
  return s.slice(0, 4) + "****" + s.slice(-2);
}

module.exports = {
  pickPhoneDigitsFromCustomer,
  collectAllCustomers,
  filterCustomersByAudienceList,
  filterByActiveContract,
  buildPhoneList,
  maskFromDigits,
  isLikelyActiveCustomer,
  pickCustomerName,
};
