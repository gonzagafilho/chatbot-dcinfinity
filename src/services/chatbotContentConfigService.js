"use strict";

const ChatbotContentConfig = require("../models/ChatbotContentConfig");

const DEFAULT_SHAPE = {
  campaigns: {
    aniversarioImage: "",
    pascoaImage: "",
    diaDasMaesImage: "",
    diaDosPaisImage: "",
    natalImage: "",
    anoNovoImage: "",
  },
  campaignTexts: {
    aniversarioText: "",
    pascoaText: "",
    diaDasMaesText: "",
    diaDosPaisText: "",
    natalText: "",
    anoNovoText: "",
  },
  campaignActive: {
    aniversario: true,
    pascoa: true,
    diaDasMaes: true,
    diaDosPais: true,
    natal: true,
    anoNovo: true,
  },
  operationalMessages: {
    maintenanceMessage: "",
    instabilityMessage: "",
    expectedReturnMessage: "",
    shortAlertMessage: "",
  },
  maintenance: {
    active: false,
    title: "",
    body: "",
    eta: null,
  },

  automation: {
    billingLive: true,
    seasonalLive: true,
    campaignMax: 10,
    billingMax: 5,
  },
};

const MERGE_KEYS = ["campaigns", "campaignTexts", "campaignActive", "operationalMessages", "maintenance", "automation"];

function deepMergeSection(base, patch) {
  if (!patch || typeof patch !== "object") return base || {};
  const b = base && typeof base === "object" ? { ...base } : {};
  for (const k of Object.keys(patch)) {
    if (patch[k] === undefined) continue;
    b[k] = patch[k];
  }
  return b;
}

function normalizeTenant(tenant) {
  return String(tenant || "dcnet")
    .trim()
    .toLowerCase();
}

/**
 * Documento mesclado com defaults (não persiste).
 * @param {string} tenant
 */
async function getConfigForTenant(tenant) {
  const t = normalizeTenant(tenant);
  const doc = await ChatbotContentConfig.findOne({ tenant: t }).lean();
  const base = {
    tenant: t,
    ...JSON.parse(JSON.stringify(DEFAULT_SHAPE)),
  };
  if (!doc) return base;
  for (const key of MERGE_KEYS) {
    if (doc[key] && typeof doc[key] === "object") {
      base[key] = deepMergeSection(DEFAULT_SHAPE[key], doc[key]);
    }
  }
  base.updatedAt = doc.updatedAt || null;
  return base;
}

/**
 * Retorno no mesmo formato de resolveActiveMaintenance quando a manutenção central estiver ativa.
 * @param {string} tenant
 * @returns {Promise<null | { active: true, title: string, message: string, eta: Date|null, area: string }>}
 */
async function getMaintenanceOverrideFromConfig(tenant) {
  const t = normalizeTenant(tenant);
  const doc = await ChatbotContentConfig.findOne({ tenant: t }).lean();
  if (!doc?.maintenance?.active) return null;
  const message = String(doc.maintenance.body || "").trim();
  if (!message) return null;
  return {
    active: true,
    title: String(doc.maintenance.title || "").trim(),
    message,
    eta: doc.maintenance.eta || null,
    area: "geral",
  };
}

/**
 * URL da imagem de aniversário: Mongo → env CAMPAIGN_IMAGE_NEW_YEAR (comportamento atual).
 * @param {string} tenant
 */
async function getBirthdayCampaignImageUrl(tenant) {
  const cfg = await getConfigForTenant(tenant);
  const url = String(cfg.campaigns?.aniversarioImage || "").trim();
  if (url) return url;
  return String(process.env.CAMPAIGN_IMAGE_NEW_YEAR || "").trim() || null;
}

/**
 * Legenda aniversário: texto do painel → vazio usa fluxo atual (mensagem gerada no job).
 */
async function getBirthdayCampaignCaptionTemplate(tenant) {
  const cfg = await getConfigForTenant(tenant);
  if (cfg.campaignActive?.aniversario === false) return { disabled: true, text: "" };
  return { disabled: false, text: String(cfg.campaignTexts?.aniversarioText || "").trim() };
}

/**
 * Textos operacionais (para uso futuro ou integrações); hoje não substituem MaintenanceNotice sozinhos.
 */
async function getOperationalMessagesForTenant(tenant) {
  const cfg = await getConfigForTenant(tenant);
  return { ...cfg.operationalMessages };
}

/**
 * @param {string} tenant
 * @param {object} patch — apenas chaves permitidas em MERGE_KEYS
 */
async function patchConfigForTenant(tenant, patch) {
  const t = normalizeTenant(tenant);
  if (!t) {
    const err = new Error("tenant_required");
    err.code = "tenant_required";
    throw err;
  }

  const existing = await ChatbotContentConfig.findOne({ tenant: t }).lean();
  const merged = {
    tenant: t,
    campaigns: deepMergeSection(
      deepMergeSection(DEFAULT_SHAPE.campaigns, existing?.campaigns),
      patch.campaigns
    ),
    campaignTexts: deepMergeSection(
      deepMergeSection(DEFAULT_SHAPE.campaignTexts, existing?.campaignTexts),
      patch.campaignTexts
    ),
    campaignActive: deepMergeSection(
      deepMergeSection(DEFAULT_SHAPE.campaignActive, existing?.campaignActive),
      patch.campaignActive
    ),
    operationalMessages: deepMergeSection(
      deepMergeSection(DEFAULT_SHAPE.operationalMessages, existing?.operationalMessages),
      patch.operationalMessages
    ),
    maintenance: deepMergeSection(
      deepMergeSection(DEFAULT_SHAPE.maintenance, existing?.maintenance),
      patch.maintenance
    ),

    automation: deepMergeSection(
      deepMergeSection(DEFAULT_SHAPE.automation, existing?.automation),
      patch.automation
    ),
  };

  const saved = await ChatbotContentConfig.findOneAndUpdate(
    { tenant: t },
    { $set: merged },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  ).lean();

  return getConfigForTenant(saved.tenant);
}

module.exports = {
  MERGE_KEYS,
  getConfigForTenant,
  patchConfigForTenant,
  getMaintenanceOverrideFromConfig,
  getBirthdayCampaignImageUrl,
  getBirthdayCampaignCaptionTemplate,
  getOperationalMessagesForTenant,
  DEFAULT_SHAPE,
};
