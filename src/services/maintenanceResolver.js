"use strict";

const MaintenanceNotice = require("../models/MaintenanceNotice");
const { getMaintenanceOverrideFromConfig } = require("./chatbotContentConfigService");

async function resolveActiveMaintenance(tenant) {
  try {
    const fromCentral = await getMaintenanceOverrideFromConfig(tenant);
    if (fromCentral) return fromCentral;

    const now = new Date();
    const item = await MaintenanceNotice.findOne({
      tenant,
      active: true,
      $or: [{ startsAt: null }, { startsAt: { $lte: now } }],
    })
      .sort({ updatedAt: -1 })
      .lean();

    if (!item) return null;

    return {
      active: true,
      title: item.title || "",
      message: item.message || "",
      eta: item.eta || null,
      area: item.area || "geral",
    };
  } catch {
    // falha silenciosa para não afetar operação
    return null;
  }
}

module.exports = { resolveActiveMaintenance };
