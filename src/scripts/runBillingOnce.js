"use strict";

require("dotenv").config();

const { connectDB } = require("../config/db");
const { runBillingReminderScheduler } = require("../jobs/billingReminderScheduler");

(async () => {
  try {
    console.log("🔧 Running billing reminder manually...");
    await connectDB();
    await runBillingReminderScheduler();
    console.log("✅ Done.");
    process.exit(0);
  } catch (e) {
    console.error("❌ Manual billing run failed:", e?.message || e);
    process.exit(1);
  }
})();
