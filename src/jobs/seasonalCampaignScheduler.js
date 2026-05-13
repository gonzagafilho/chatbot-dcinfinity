"use strict";

const cron = require("node-cron");
const Lead = require("../models/Lead");
const CampaignExecutionLog = require("../models/CampaignExecutionLog");
const { sendWhatsAppText, sendWhatsAppImage } = require("../services/whatsappSend");
const { getRuntimeAutomationConfig } = require("../config/runtimeAutomationConfig");

const SEASONAL_CAMPAIGN_CRON = process.env.SEASONAL_CAMPAIGN_CRON || "0 8 * * *";

const IGNORED_CAMPAIGN_PHONES = new Set([
  "5561996406911",
  "5561991374910",
  "5561999999999",
]);

function pad2(n) {
  return String(n).padStart(2, "0");
}

function todayMmDd() {
  const now = new Date();
  return `${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function sameUtcDay(a, b) {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

async function getConfig() {
  const runtime = await getRuntimeAutomationConfig();

  return {
    enabled: !!runtime.seasonalLive,
    mode: runtime.seasonalLive ? "live" : "disabled",
    key: String(process.env.SEASONAL_CAMPAIGN_KEY || "seasonal").trim(),
    date: String(process.env.SEASONAL_CAMPAIGN_DATE || "").trim(), // MM-DD
    ignoreDate: String(process.env.SEASONAL_CAMPAIGN_IGNORE_DATE || "false").toLowerCase() === "true",
    audience: String(process.env.SEASONAL_CAMPAIGN_AUDIENCE || "active").trim(),
    imageUrl: String(process.env.SEASONAL_CAMPAIGN_IMAGE_URL || "").trim(),
    message: String(process.env.SEASONAL_CAMPAIGN_MESSAGE || "").trim(),
    maxSends: Math.min(Math.max(parseInt(runtime.campaignMax || "10", 10) || 10, 1), 100),
  };
}

function buildDefaultMessage(key) {
  if (key === "mothers_day") {
    return "🌷 Feliz Dia das Mães!\n\nA família DC NET deseja um dia cheio de amor, paz e bênçãos para todas as mães. 💙";
  }

  if (key === "fathers_day") {
    return "💙 Feliz Dia dos Pais!\n\nA família DC NET deseja um dia cheio de alegria e bênçãos para todos os pais.";
  }

  if (key === "christmas") {
    return "🎄 Feliz Natal!\n\nA DC NET deseja paz, saúde e muitas bênçãos para você e sua família. 💙";
  }

  return "💙 A DC NET tem uma mensagem especial para você.";
}

function buildLeadQuery(audience) {
  const base = {
    tenant: "dcnet",
    campaignOptIn: { $ne: false },
    phone: { $exists: true, $ne: null },
    status: { $ne: "inactive" },
  };

  if (audience === "mothers") base.isMother = true;
  if (audience === "fathers") base.isFather = true;

  return base;
}

async function runSeasonalCampaigns() {
  const startedAt = new Date();
  const cfg = await getConfig();

  console.log("[seasonal_campaign] run_start", {
    enabled: cfg.enabled,
    mode: cfg.mode,
    key: cfg.key,
    date: cfg.date,
    today: todayMmDd(),
    audience: cfg.audience,
    maxSends: cfg.maxSends,
  });

  if (!cfg.enabled) {
    console.log("[seasonal_campaign] disabled_skip");
    return;
  }

  if (!cfg.ignoreDate && cfg.date && cfg.date !== todayMmDd()) {
    console.log("[seasonal_campaign] date_skip", { expected: cfg.date, today: todayMmDd() });
    return;
  }

  const leads = await Lead.find(
    buildLeadQuery(cfg.audience),
    { _id: 1, phone: 1, name: 1, campaignLogs: 1 }
  ).lean();

  let processed = 0;
  let sent = 0;
  let skipped = 0;

  const message = cfg.message || buildDefaultMessage(cfg.key);

  for (const lead of leads) {
    if (sent >= cfg.maxSends) {
      console.log("[seasonal_campaign] max_sends_reached", { maxSends: cfg.maxSends, sent });
      break;
    }

    processed++;

    const phone = String(lead.phone || "").trim();

    if (!phone || phone.length > 15 || phone.length < 12) {
      console.log("[seasonal_campaign] invalid_phone_skip", {
        phone,
        leadId: String(lead._id),
      });
      skipped++;
      continue;
    }

    if (IGNORED_CAMPAIGN_PHONES.has(phone)) {
      console.log("[seasonal_campaign] ignored_phone_skip", {
        phone,
        leadId: String(lead._id),
      });
      skipped++;
      continue;
    }

    const lastSentRaw = lead?.campaignLogs?.[cfg.key]?.lastSentAt;
    const lastSent = lastSentRaw ? new Date(lastSentRaw) : null;

    if (lastSent && !Number.isNaN(lastSent.getTime()) && sameUtcDay(lastSent, startedAt)) {
      skipped++;
      continue;
    }

    if (cfg.mode === "test") {
      console.log("[seasonal_campaign][test] would_send", {
        phone,
        leadId: String(lead._id),
        key: cfg.key,
      });
      sent++;
      continue;
    }

    try {
      if (cfg.imageUrl) {
        await sendWhatsAppImage(phone, cfg.imageUrl, message);
      } else {
        await sendWhatsAppText(phone, message);
      }

      await Lead.updateOne(
        { _id: lead._id },
        {
          $set: {
            [`campaignLogs.${cfg.key}.lastSentAt`]: startedAt,
            [`campaignLogs.${cfg.key}.lastStatus`]: "sent",
          },
        }
      );

      sent++;
      console.log("[seasonal_campaign] sent", { phone, key: cfg.key });
    } catch (err) {
      skipped++;
      console.error("[seasonal_campaign] send_failed", {
        phone,
        key: cfg.key,
        error: err?.message || err,
      });
    }
  }

  console.log("[seasonal_campaign] run_done", {
    mode: cfg.mode,
    key: cfg.key,
    processed,
    sent,
    skipped,
    finishedAt: new Date().toISOString(),
  });
}

if (require.main === module) {
  require("dotenv").config();
  const mongoose = require("mongoose");

  (async () => {
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    await runSeasonalCampaigns();
    await mongoose.disconnect();
    process.exit(0);
  })().catch((err) => {
    console.error("[seasonal_campaign] manual_failed", err?.message || err);
    process.exit(1);
  });
} else {
  cron.schedule(SEASONAL_CAMPAIGN_CRON, runSeasonalCampaigns);
  console.log(`[seasonal_campaign] scheduler_started cron="${SEASONAL_CAMPAIGN_CRON}"`);
}

module.exports = {
  SEASONAL_CAMPAIGN_CRON,
  runSeasonalCampaigns,
};
