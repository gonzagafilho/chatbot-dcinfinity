"use strict";

require("dotenv").config();

const app = require("./app");
const cron = require("node-cron");
const { connectDB } = require("./config/db");
const { startMaintenanceBroadcastWorker } = require("./jobs/maintenanceBroadcastWorker");
require("./jobs/campaignScheduler");
require("./jobs/beeswebCustomerSyncScheduler");
require("./jobs/seasonalCampaignScheduler");
const { runBillingReminderScheduler, BILLING_REMINDER_CRON } = require("./jobs/billingReminderScheduler");
cron.schedule(BILLING_REMINDER_CRON, runBillingReminderScheduler);
console.log(`[billing_reminder] scheduler_started cron="${BILLING_REMINDER_CRON}"`);

const PORT = process.env.PORT || 4010;

(async () => {
  try {
    await connectDB();
    startMaintenanceBroadcastWorker();
  } catch (e) {
    console.error("❌ Falha ao conectar no MongoDB:", e?.message || e);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ chatbot-dcinfinity ON: http://0.0.0.0:${PORT}`);
  });
})();
