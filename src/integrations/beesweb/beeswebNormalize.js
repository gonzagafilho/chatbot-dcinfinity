"use strict";

/**
 * Extrai lista de objetos da resposta JSON da BeesWeb (formato variável).
 * @param {unknown} raw
 * @param {string[]} keysOrdem chaves prováveis por recurso
 * @returns {unknown[]}
 */
function extractArray(raw, keysOrdem) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];
  const keys = keysOrdem || [
    "data",
    "clientes",
    "contratos",
    "contracts",
    "charges",
    "cobrancas",
    "calledies",
    "chamados",
    "tickets",
    "results",
    "items",
    "rows",
  ];
  for (const k of keys) {
    if (Array.isArray(raw[k])) return raw[k];
  }
  return [];
}

function extractTotal(raw, listLen) {
  if (raw && typeof raw === "object") {
    if (typeof raw.total === "number") return raw.total;
    if (raw.meta && typeof raw.meta.total === "number") return raw.meta.total;
  }
  return listLen;
}

module.exports = { extractArray, extractTotal };
