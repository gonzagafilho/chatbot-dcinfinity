const CoverageZip = require("../models/CoverageZip");
const CoverageInterest = require("../models/CoverageInterest");

function normalizeCep(input) {
  return String(input || "").replace(/\D/g, "").slice(0, 8);
}

function extractCep(text) {
  const raw = String(text || "");
  const match = raw.match(/\b\d{2}\.?\d{3}-?\d{3}\b|\b\d{8}\b/);
  return match ? normalizeCep(match[0]) : "";
}

function isValidCep(cep) {
  return /^\d{8}$/.test(String(cep || ""));
}

async function checkCoverageByCep({ tenant = "dcnet", cep }) {
  const normalizedCep = normalizeCep(cep);

  if (!isValidCep(normalizedCep)) {
    return {
      ok: false,
      covered: false,
      reason: "invalid_cep",
      cep: normalizedCep,
      area: null,
    };
  }

  const area = await CoverageZip.findOne({
    tenant,
    cep: normalizedCep,
    active: true,
  }).lean();

  if (!area) {
    return {
      ok: true,
      covered: false,
      reason: "not_found",
      cep: normalizedCep,
      area: null,
    };
  }

  return {
    ok: true,
    covered: area.status === "covered" || area.status === "partial",
    partial: area.status === "partial",
    reason: area.status,
    cep: normalizedCep,
    area,
  };
}

async function saveCoverageInterest({
  tenant = "dcnet",
  phone,
  name = "",
  cep,
  source = "whatsapp",
  lastMessage = "",
}) {
  const normalizedCep = normalizeCep(cep);

  if (!phone || !isValidCep(normalizedCep)) return null;

  return CoverageInterest.findOneAndUpdate(
    { tenant, phone, cep: normalizedCep },
    {
      $set: {
        name,
        source,
        status: "waiting_coverage",
        lastMessage,
      },
      $setOnInsert: {
        tenant,
        phone,
        cep: normalizedCep,
      },
    },
    { upsert: true, new: true }
  );
}

module.exports = {
  normalizeCep,
  extractCep,
  isValidCep,
  checkCoverageByCep,
  saveCoverageInterest,
};
