"use strict";

const Config = require("../models/ChatbotContentConfig");

async function getRuntimeAutomationConfig() {
  try {
    const cfg = await Config.findOne({ tenant: "dcnet" }).lean();

    const automation = cfg?.automation || {};

    return {
      billingLive:
        typeof automation.billingLive === "boolean"
          ? automation.billingLive
          : String(process.env.BILLING_REMINDER_ENABLED || "false").toLowerCase() === "true",

      seasonalLive:
        typeof automation.seasonalLive === "boolean"
          ? automation.seasonalLive
          : String(process.env.SEASONAL_CAMPAIGN_ENABLED || "false").toLowerCase() === "true",

      campaignMax:
        Number(automation.campaignMax || process.env.SEASONAL_CAMPAIGN_MAX_SENDS || 10),

      billingMax:
        Number(automation.billingMax || process.env.BILLING_REMINDER_MAX_SENDS || 5),
    };
  } catch (e) {
    console.error("[runtime_automation_config] failed", e?.message || e);

    return {
      billingLive:
        String(process.env.BILLING_REMINDER_ENABLED || "false").toLowerCase() === "true",

      seasonalLive:
        String(process.env.SEASONAL_CAMPAIGN_ENABLED || "false").toLowerCase() === "true",

      campaignMax:
        Number(process.env.SEASONAL_CAMPAIGN_MAX_SENDS || 10),

      billingMax:
        Number(process.env.BILLING_REMINDER_MAX_SENDS || 5),
    };
  }
}

module.exports = {
  getRuntimeAutomationConfig,
};
