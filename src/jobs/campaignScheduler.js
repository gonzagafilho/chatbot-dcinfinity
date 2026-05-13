"use strict";

const cron = require("node-cron");
const Lead = require("../models/Lead");
const CampaignExecutionLog = require("../models/CampaignExecutionLog");
const { sendWhatsAppImage } = require("../services/whatsappSend");
const {
  getBirthdayCampaignImageUrl,
  getBirthdayCampaignCaptionTemplate,
} = require("../services/chatbotContentConfigService");

const BIRTHDAY_CRON = "0 8 * * *";
const CAMPAIGN_KEY = "birthday";
const CAMPAIGN_IMAGE_NEW_YEAR = process.env.CAMPAIGN_IMAGE_NEW_YEAR;

function pad2(n) {
  return String(n).padStart(2, "0");
}

function getTodayParts() {
  const now = new Date();
  return { day: pad2(now.getDate()), month: pad2(now.getMonth() + 1) };
}

function parseBirthdayParts(birthdayValue) {
  if (!birthdayValue) return null;

  if (birthdayValue instanceof Date && !Number.isNaN(birthdayValue.getTime())) {
    return {
      day: pad2(birthdayValue.getDate()),
      month: pad2(birthdayValue.getMonth() + 1),
    };
  }

  const asString = String(birthdayValue).trim();
  if (!asString) return null;

  const dmy = asString.match(/^(\d{2})[\/-](\d{2})(?:[\/-]\d{2,4})?$/);
  if (dmy) return { day: dmy[1], month: dmy[2] };

  const ymd = asString.match(/^\d{4}-(\d{2})-(\d{2})/);
  if (ymd) return { day: ymd[2], month: ymd[1] };

  const parsed = new Date(asString);
  if (!Number.isNaN(parsed.getTime())) {
    return { day: pad2(parsed.getDate()), month: pad2(parsed.getMonth() + 1) };
  }

  return null;
}

function sameUtcDay(a, b) {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function buildBirthdayMessage(name) {
  const cleanName = String(name || "").trim();
  return (
    `🎉 Feliz aniversário${cleanName ? `, ${cleanName}` : ""}!\n\n` +
    "Nós da família DC NET desejamos que Deus abençoe grandemente sua vida 🙏\n\n" +
    "Que seu novo ciclo seja cheio de paz, saúde e prosperidade 💙"
  );
}

function shouldSendSegment(lead, segment, today) {
  if (segment === "birthday") {
    const birth = parseBirthdayParts(lead.birthday);
    return Boolean(birth && birth.day === today.day && birth.month === today.month);
  }
  if (segment === "mothers_day") return lead.isMother === true;
  if (segment === "fathers_day") return lead.isFather === true;
  return false;
}

async function runDailyCampaigns() {
  const startedAt = new Date();
  const today = getTodayParts();
  const segment = CAMPAIGN_KEY;
  const campaignTenant = "dcnet";

  try {
    const birthdayImageUrl = await getBirthdayCampaignImageUrl(campaignTenant);
    const birthdayCaptionTpl = await getBirthdayCampaignCaptionTemplate(campaignTenant);

    const leads = await Lead.find(
      {
        tenant: "dcnet",
        beeswebCustomerId: { $exists: true, $ne: null },
        campaignOptIn: { $ne: false },
        phone: { $exists: true, $ne: null },
      },
      {
        _id: 1,
        phone: 1,
        name: 1,
        birthday: 1,
        isMother: 1,
        isFather: 1,
        campaignLogs: 1,
      }
    ).lean();

    let processed = 0;
    let sent = 0;
    let skipped = 0;

    for (const lead of leads) {
      processed += 1;

      if (!shouldSendSegment(lead, segment, today)) {
        skipped += 1;
        continue;
      }

      if (segment === "birthday" && birthdayCaptionTpl.disabled) {
        skipped += 1;
        continue;
      }

      const lastSentRaw = lead?.campaignLogs?.[segment]?.lastSentAt;
      const lastSent = lastSentRaw ? new Date(lastSentRaw) : null;
      if (lastSent && !Number.isNaN(lastSent.getTime()) && sameUtcDay(lastSent, startedAt)) {
        skipped += 1;
        continue;
      }

      const phone = String(lead.phone || "").trim();
      if (!phone) {
        skipped += 1;
        continue;
      }

      try {
        const imageUrl = birthdayImageUrl || String(CAMPAIGN_IMAGE_NEW_YEAR || "").trim();
        if (!imageUrl) {
          throw new Error("birthday_campaign_image_missing");
        }
        const mensagem =
          segment === "birthday" && String(birthdayCaptionTpl.text || "").trim()
            ? String(birthdayCaptionTpl.text).trim()
            : buildBirthdayMessage(lead.name);
        await sendWhatsAppImage(phone, imageUrl, mensagem);

        await Lead.updateOne(
          { _id: lead._id },
          {
            $set: {
              [`campaignLogs.${segment}.lastSentAt`]: startedAt,
              [`campaignLogs.${segment}.lastStatus`]: "sent",
            },
          }
        );

        sent += 1;
        console.log(`[campaigns] ${segment}_sent phone=${phone}`);
      } catch (err) {
        await Lead.updateOne(
          { _id: lead._id },
          {
            $set: {
              [`campaignLogs.${segment}.lastErrorAt`]: new Date(),
              [`campaignLogs.${segment}.lastStatus`]: "error",
              [`campaignLogs.${segment}.lastErrorMessage`]: String(err?.message || err || "unknown_error").slice(0, 500),
            },
          }
        );
        console.error(`[campaigns] ${segment}_send_failed phone=${phone}`, err?.message || err);
      }
    }

    console.log(`[campaigns] daily_run_done segment=${segment} processed=${processed} sent=${sent} skipped=${skipped}`);
  } catch (err) {
    console.error("[campaigns] daily_run_failed", err?.message || err);
  }
}

cron.schedule(BIRTHDAY_CRON, runDailyCampaigns);
console.log(`[campaigns] scheduler_started cron="${BIRTHDAY_CRON}"`);

module.exports = {
  runDailyCampaigns,
};
