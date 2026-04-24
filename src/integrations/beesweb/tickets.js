"use strict";

/**
 * Chamados / tickets (vocabulário BeesWeb: calledies / called.status).
 * Path HTTP: default adm/calledies na API pública BeesWeb; override BEESWEB_PATH_ADM_TICKETS se necessário.
 */

const { isBeeswebConfigured, getBeeswebQueryParamNames, getBeeswebAdmResourcePaths } = require("../../config/beesweb");
const { createBeeswebClient } = require("./beeswebClient");
const { extractArray, extractTotal } = require("./beeswebNormalize");

/** called.status: 1 Novo, 2 Aguardando Cliente, 3 Aguardando Empresa, 4 Finalizado */
function mapCalledStatus(raw) {
  const n = Number(raw);
  if (n === 1) return "new";
  if (n === 2) return "waiting_customer";
  if (n === 3) return "waiting_company";
  if (n === 4) return "finished";
  if (raw === "" || raw == null || Number.isNaN(n)) return "unknown";
  return `unknown_${String(raw)}`;
}

function pickCalledStatusRaw(row) {
  if (!row || typeof row !== "object") return null;
  const called = row.called;
  if (called && typeof called === "object" && called.status != null) return called.status;
  return row.called_status ?? row.status ?? row.situacao ?? row.estado ?? row.state ?? null;
}

function normalizeCalledieRow(t) {
  const row = t && typeof t === "object" ? t : {};
  const statusRaw = pickCalledStatusRaw(row);
  const _calledStatusNorm = mapCalledStatus(statusRaw);
  return { ...row, _calledStatusNorm, _calledStatusRaw: statusRaw };
}

/** Não finalizado: new | waiting_customer | waiting_company (e unknown conserva aberto). */
function isCalledieOpenRow(row) {
  if (!row || typeof row !== "object") return false;
  if (row._calledStatusNorm === "finished") return false;
  if (row._calledStatusNorm === "unknown") {
    const s = pickCalledStatusRaw(row);
    if (s === 4 || s === "4") return false;
    const sl = String(s || "").toLowerCase();
    if (sl.includes("fech") || sl.includes("encerr") || sl.includes("conclu")) return false;
    return true;
  }
  return true;
}

function normalizeTicketsPayload(raw) {
  const tickets = extractArray(raw, [
    "calledies",
    "data",
    "chamados",
    "tickets",
    "items",
    "results",
  ]).map((r) => normalizeCalledieRow(r && typeof r === "object" ? r : {}));
  const total = extractTotal(raw, tickets.length);
  const openTickets = tickets.filter(isCalledieOpenRow);
  return { tickets, total, openTickets, hasOpenTickets: openTickets.length > 0 };
}

async function listTicketsWithQuery(query) {
  if (!isBeeswebConfigured()) {
    return { ok: false, found: false, total: 0, tickets: [], openTickets: [], hasOpenTickets: false, raw: null };
  }
  const client = createBeeswebClient();
  if (!client.isConfigured) {
    return { ok: false, found: false, total: 0, tickets: [], openTickets: [], hasOpenTickets: false, raw: null };
  }
  const { tickets: ticketsPath } = getBeeswebAdmResourcePaths();
  try {
    const raw = await client.request("GET", ticketsPath, { query });
    const { tickets, total, openTickets, hasOpenTickets } = normalizeTicketsPayload(raw);
    return {
      ok: true,
      found: tickets.length > 0,
      total,
      tickets,
      openTickets,
      hasOpenTickets,
      raw,
    };
  } catch {
    return { ok: false, found: false, total: 0, tickets: [], openTickets: [], hasOpenTickets: false, raw: null };
  }
}

async function listTicketsByCustomerId(customerId) {
  const id = String(customerId ?? "").trim();
  if (!id) {
    return { ok: false, found: false, total: 0, tickets: [], openTickets: [], hasOpenTickets: false, raw: null };
  }
  const qp = getBeeswebQueryParamNames();
  return listTicketsWithQuery({ [qp.ticketCustomerId]: id });
}

/** Mesmo payload de {@link listTicketsByCustomerId}; use o campo `openTickets` para filtrar. */
async function listOpenTicketsByCustomerId(customerId) {
  return listTicketsByCustomerId(customerId);
}

/** Compat: lista abertos sem customer (não aplicável à API; retorno vazio). */
async function listOpenTickets() {
  return { ok: false, found: false, total: 0, tickets: [], openTickets: [], hasOpenTickets: false, raw: null };
}

module.exports = {
  listTicketsByCustomerId,
  listOpenTicketsByCustomerId,
  listOpenTickets,
  /** Alias de vocabulário (calledies) — mesmo comportamento de listTicketsByCustomerId */
  listCallediesByCustomerId: listTicketsByCustomerId,
  listOpenCallediesByCustomerId: listOpenTicketsByCustomerId,
  mapCalledStatus,
};
