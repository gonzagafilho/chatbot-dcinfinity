"use strict";

const Lead = require("../models/Lead");
const { listChargesByCustomerId } = require("../integrations/beesweb/charges");
const { sendWhatsAppTemplate } = require("../services/whatsappSend");
const whatsappTemplates = require("../config/whatsappTemplates");
const { getRuntimeAutomationConfig } = require("../config/runtimeAutomationConfig");

const BILLING_ADVANCED_CRON = process.env.BILLING_ADVANCED_CRON || "15 9 * * *";
const OVERDUE_D2_KEY = "billingOverdueD2";
const REACTIVATION_KEY = "billingReactivation";

function enabled(name) {
  return String(process.env[name] || "false").toLowerCase() === "true";
}

function parseDueDate(raw) {
  const v = String(raw || "").trim();
  if (!v) return null;

  const dmy = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmy) {
    const dt = new Date(Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  const ymd = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) {
    const dt = new Date(Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  const dt = new Date(v);
  return Number.isNaN(dt.getTime())
    ? null
    : new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
}

function formatDueDatePtBr(raw) {
  const dt = parseDueDate(raw);
  if (!dt) return String(raw || "").trim();
  return dt.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function formatAmountBr(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return String(raw || "").trim() || "0,00";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getChargeId(charge) {
  const id = charge?.id ?? charge?.charge_id ?? charge?.cobranca_id ?? "";
  return String(id || "").trim();
}

function getCustomerIdFromCharge(charge) {
  const v =
    charge?.customer_id ??
    charge?.customerId ??
    charge?.contract?.customer_id ??
    charge?.contract?.customerId ??
    "";
  return String(v || "").trim();
}

function isUnpaidCharge(charge) {
  return charge?.value_paid === null || charge?.value_paid === undefined;
}

function hasValidPhone(lead) {
  return Boolean(String(lead?.phone || "").trim());
}

function sameUtcDay(a, b) {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function isDueDaysAgo(charge, nowUtc, daysAgo) {
  const rawDue = charge?.due_date || charge?.data_vencimento || charge?.vencimento || charge?.due_at;
  const due = parseDueDate(rawDue);
  if (!due) return false;

  const target = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate() - daysAgo));

  return (
    due.getUTCFullYear() === target.getUTCFullYear() &&
    due.getUTCMonth() === target.getUTCMonth() &&
    due.getUTCDate() === target.getUTCDate()
  );
}

function alreadyProcessedSameCharge(lead, key, chargeId, dueDateRaw) {
  const log = lead?.campaignLogs?.[key] || null;
  if (!log) return false;

  const lastChargeId = String(log.lastChargeId || "").trim();
  const lastDueDate = String(log.lastDueDate || "").trim();

  return (
    lastChargeId &&
    lastDueDate &&
    lastChargeId === chargeId &&
    lastDueDate === String(dueDateRaw || "").trim()
  );
}

function selectPrimaryD2OverdueCharge(charges, nowUtc) {
  const eligible = (charges || []).filter((charge) => {
    const link = String(charge?.link || "").trim();
    const customerId = getCustomerIdFromCharge(charge);

    return (
      Boolean(link) &&
      Boolean(customerId) &&
      isUnpaidCharge(charge) &&
      isDueDaysAgo(charge, nowUtc, 2)
    );
  });

  if (!eligible.length) return null;

  eligible.sort((a, b) => {
    const da = parseDueDate(a?.due_date || a?.data_vencimento || a?.vencimento || a?.due_at)?.getTime() || 0;
    const db = parseDueDate(b?.due_date || b?.data_vencimento || b?.vencimento || b?.due_at)?.getTime() || 0;
    if (da !== db) return da - db;
    return Number(getChargeId(b)) - Number(getChargeId(a));
  });

  return eligible[0];
}

async function getMode() {
  const runtime = await getRuntimeAutomationConfig();
  if (!runtime.billingLive) return "disabled";
  return "live";
}

async function getMaxSends() {
  const runtime = await getRuntimeAutomationConfig();
  const raw = parseInt(runtime.billingMax || "5", 10);
  if (!Number.isFinite(raw) || raw < 1) return 5;
  return Math.min(raw, 50);
}

async function sendOverdueD2(lead, charge, mode, templateName, languageCode, now) {
  const phone = String(lead.phone || "").trim();
  const customerName = String(lead.name || "Cliente").trim() || "Cliente";
  const dueRaw = String(charge?.due_date || charge?.data_vencimento || charge?.vencimento || "").trim();
  const chargeId = getChargeId(charge);
  const boletoLink = String(charge?.link || "").trim();

  if (!phone || !chargeId || !dueRaw || !boletoLink) {
    console.log("[billing_advanced][d2] missing_required_data", {
      phonePresent: Boolean(phone),
      chargeIdPresent: Boolean(chargeId),
      dueDatePresent: Boolean(dueRaw),
      boletoLinkPresent: Boolean(boletoLink),
      customerId: lead.beeswebCustomerId,
    });
    return { sent: false, skipped: true };
  }

  if (alreadyProcessedSameCharge(lead, OVERDUE_D2_KEY, chargeId, dueRaw)) {
    console.log("[billing_advanced][d2] duplicate_skipped", {
      phone,
      customerId: lead.beeswebCustomerId,
      chargeId,
      dueDate: dueRaw,
    });
    return { sent: false, skipped: true };
  }

  const components = [
    {
      type: "body",
      parameters: [
        { type: "text", text: customerName },
        { type: "text", text: formatAmountBr(charge?.value) },
        { type: "text", text: formatDueDatePtBr(dueRaw) },
        { type: "text", text: boletoLink },
      ],
    },
  ];

  if (mode === "live") {
    await sendWhatsAppTemplate(phone, templateName, languageCode, components);
    console.log("[billing_advanced][d2] sent", { phone, customerId: lead.beeswebCustomerId, chargeId, dueDate: dueRaw });
  } else {
    console.log("[billing_advanced][d2][test] would_send", { phone, customerId: lead.beeswebCustomerId, chargeId, dueDate: dueRaw });
  }

  await Lead.updateOne(
    { _id: lead._id },
    {
      $set: {
        [`campaignLogs.${OVERDUE_D2_KEY}.lastChargeId`]: chargeId,
        [`campaignLogs.${OVERDUE_D2_KEY}.lastDueDate`]: dueRaw,
        [`campaignLogs.${OVERDUE_D2_KEY}.lastSentAt`]: now,
        [`campaignLogs.${OVERDUE_D2_KEY}.lastMode`]: mode,
      },
    }
  );

  return { sent: true, skipped: false };
}

async function sendReactivation(lead, mode, templateName, languageCode, now) {
  const phone = String(lead.phone || "").trim();
  const customerName = String(lead.name || "Cliente").trim() || "Cliente";
  const supportPhone = String(process.env.BILLING_REACTIVATION_SUPPORT_PHONE || "61 99640-6911").trim();

  if (!phone) return { sent: false, skipped: true };

  const lastSentRaw = lead?.campaignLogs?.[REACTIVATION_KEY]?.lastSentAt;
  const lastSent = lastSentRaw ? new Date(lastSentRaw) : null;

  const cooldownDays = Math.max(
    1,
    Math.min(30, parseInt(process.env.BILLING_REACTIVATION_COOLDOWN_DAYS || "7", 10) || 7)
  );

  if (lastSent && !Number.isNaN(lastSent.getTime())) {
    const diffMs = now.getTime() - lastSent.getTime();
    if (diffMs < cooldownDays * 24 * 60 * 60 * 1000) {
      console.log("[billing_advanced][reactivation] cooldown_skip", {
        phone,
        leadId: String(lead._id),
        lastSentAt: lastSent.toISOString(),
      });
      return { sent: false, skipped: true };
    }
  }

  const components = [
    {
      type: "body",
      parameters: [
        { type: "text", text: customerName },
        { type: "text", text: supportPhone },
      ],
    },
  ];

  if (mode === "live") {
    await sendWhatsAppTemplate(phone, templateName, languageCode, components);
    console.log("[billing_advanced][reactivation] sent", { phone, leadId: String(lead._id) });
  } else {
    console.log("[billing_advanced][reactivation][test] would_send", { phone, leadId: String(lead._id) });
  }

  await Lead.updateOne(
    { _id: lead._id },
    {
      $set: {
        [`campaignLogs.${REACTIVATION_KEY}.lastSentAt`]: now,
        [`campaignLogs.${REACTIVATION_KEY}.lastMode`]: mode,
      },
    }
  );

  return { sent: true, skipped: false };
}

async function runBillingAdvancedScheduler() {
  const startedAt = new Date();
  const mode = await getMode();

  const d2Enabled = enabled("BILLING_OVERDUE_D2_ENABLED");
  const reactivationEnabled = enabled("BILLING_REACTIVATION_ENABLED");

  console.log("[billing_advanced] run_start", {
    mode,
    cron: BILLING_ADVANCED_CRON,
    d2Enabled,
    reactivationEnabled,
    startedAt: startedAt.toISOString(),
  });

  if (mode === "disabled") {
    console.log("[billing_advanced] billing_live_disabled_skip");
    return;
  }

  if (!d2Enabled && !reactivationEnabled) {
    console.log("[billing_advanced] all_features_disabled_skip");
    return;
  }

  const languageCode = String(whatsappTemplates.languageCode || "pt_BR").trim() || "pt_BR";
  const d2Template = String(whatsappTemplates.billingOverdueD2 || "").trim();
  const reactivationTemplate = String(whatsappTemplates.billingReactivation || "").trim();
  const maxSends = await getMaxSends();

  let sent = 0;
  let skipped = 0;
  let processed = 0;

  try {
    if (d2Enabled) {
      if (!d2Template) {
        console.log("[billing_advanced][d2] template_missing_skip");
      } else {
        const leads = await Lead.find(
          {
            tenant: "dcnet",
            campaignOptIn: { $ne: false },
            beeswebCustomerId: { $exists: true, $ne: null },
            phone: { $exists: true, $ne: null },
          },
          { _id: 1, phone: 1, name: 1, beeswebCustomerId: 1, campaignLogs: 1 }
        ).lean();

        const byCustomer = new Map();
        for (const lead of leads) {
          if (!hasValidPhone(lead)) continue;
          const customerId = String(lead.beeswebCustomerId || "").trim();
          if (!customerId) continue;
          if (!byCustomer.has(customerId)) byCustomer.set(customerId, []);
          byCustomer.get(customerId).push(lead);
        }

        for (const [customerId, customerLeads] of byCustomer.entries()) {
          if (sent >= maxSends) break;

          const chargesPack = await listChargesByCustomerId(customerId);
          if (!chargesPack?.ok) {
            skipped += customerLeads.length;
            continue;
          }

          const charge = selectPrimaryD2OverdueCharge(chargesPack.charges, startedAt);
          if (!charge) {
            skipped += customerLeads.length;
            continue;
          }

          const targetLead = customerLeads.find((l) => hasValidPhone(l)) || null;
          if (!targetLead) {
            skipped += 1;
            continue;
          }

          processed += 1;

          const result = await sendOverdueD2(targetLead, charge, mode, d2Template, languageCode, startedAt);
          if (result.sent) sent += 1;
          if (result.skipped) skipped += 1;
        }
      }
    }

    if (reactivationEnabled && sent < maxSends) {
      if (!reactivationTemplate) {
        console.log("[billing_advanced][reactivation] template_missing_skip");
      } else {
        const inactiveLeads = await Lead.find(
          {
            tenant: "dcnet",
            campaignOptIn: { $ne: false },
            status: { $in: ["inactive", "inativo", "inadimplente"] },
            phone: { $exists: true, $ne: null },
          },
          { _id: 1, phone: 1, name: 1, status: 1, campaignLogs: 1 }
        )
          .limit(maxSends)
          .lean();

        for (const lead of inactiveLeads) {
          if (sent >= maxSends) break;
          processed += 1;

          const result = await sendReactivation(lead, mode, reactivationTemplate, languageCode, startedAt);
          if (result.sent) sent += 1;
          if (result.skipped) skipped += 1;
        }
      }
    }

    console.log("[billing_advanced] run_done", {
      mode,
      d2Enabled,
      reactivationEnabled,
      processed,
      sent,
      skipped,
      finishedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[billing_advanced] run_failed", e?.message || e);
  }
}

module.exports = {
  BILLING_ADVANCED_CRON,
  runBillingAdvancedScheduler,
};
