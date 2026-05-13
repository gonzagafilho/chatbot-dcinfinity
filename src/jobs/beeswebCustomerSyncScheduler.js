"use strict";

const cron = require("node-cron");
const { main: runBeeswebCustomerSync } = require("../scripts/syncBeeswebCustomersToLeads");

const BEESWEB_SYNC_CRON = process.env.BEESWEB_SYNC_CRON || "0 2 * * *";

let running = false;

async function runSyncScheduler() {
  if (running) {
    console.log("[beesweb_sync] already_running_skip");
    return;
  }

  running = true;
  const startedAt = new Date();

  console.log("[beesweb_sync] run_start", {
    cron: BEESWEB_SYNC_CRON,
    startedAt: startedAt.toISOString(),
  });

  try {
    await runBeeswebCustomerSync();
    console.log("[beesweb_sync] run_done", {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[beesweb_sync] run_failed", err?.message || err);
  } finally {
    running = false;
  }
}

cron.schedule(BEESWEB_SYNC_CRON, runSyncScheduler);
console.log(`[beesweb_sync] scheduler_started cron="${BEESWEB_SYNC_CRON}"`);

module.exports = {
  BEESWEB_SYNC_CRON,
  runSyncScheduler,
};
