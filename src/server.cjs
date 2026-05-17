"use strict";

require("dotenv").config();

const app = require("./app");
const cron = require("node-cron");
const { connectDB } = require("./config/db");
const { startMaintenanceBroadcastWorker } = require("./jobs/maintenanceBroadcastWorker");
const { startCampaignScheduler } = require("./jobs/campaignScheduler");
const { startBeeswebSyncScheduler } = require("./jobs/beeswebCustomerSyncScheduler");
const { startSeasonalCampaignScheduler } = require("./jobs/seasonalCampaignScheduler");
const { runBillingReminderScheduler, BILLING_REMINDER_CRON } = require("./jobs/billingReminderScheduler");
const { runBillingAdvancedScheduler, BILLING_ADVANCED_CRON } = require("./jobs/billingAdvancedScheduler");

const PORT = process.env.PORT || 4010;

function startBillingReminderScheduler() {
  cron.schedule(BILLING_REMINDER_CRON, runBillingReminderScheduler);
  console.log(`[billing_reminder] scheduler_started cron="${BILLING_REMINDER_CRON}"`);
}

function startBillingAdvancedScheduler() {
  cron.schedule(BILLING_ADVANCED_CRON, runBillingAdvancedScheduler);
  console.log(`[billing_advanced] scheduler_started cron="${BILLING_ADVANCED_CRON}"`);
}

(async () => {
  try {
    await connectDB();

    startCampaignScheduler();
    startSeasonalCampaignScheduler();
    startBeeswebSyncScheduler();
    startBillingReminderScheduler();
    startBillingAdvancedScheduler();

    startMaintenanceBroadcastWorker();
  } catch (e) {
    console.error("❌ Falha ao conectar no MongoDB:", e?.message || e);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ chatbot-dcinfinity ON: http://0.0.0.0:${PORT}`);
  });
})();
