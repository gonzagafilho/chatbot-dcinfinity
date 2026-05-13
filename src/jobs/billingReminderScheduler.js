"use strict";

const Lead = require("../models/Lead");
const { listChargesByCustomerId } = require("../integrations/beesweb/charges");
const { sendWhatsAppTemplate } = require("../services/whatsappSend");
const whatsappTemplates = require("../config/whatsappTemplates");
const { getRuntimeAutomationConfig } = require("../config/runtimeAutomationConfig");

const BILLING_REMINDER_CRON = "0 9 * * *";
const BILLING_CAMPAIGN_KEY = "billingReminder";

async function getBillingMode() {
  const runtime = await getRuntimeAutomationConfig();

  if (!runtime.billingLive) return "disabled";

  return "live";
}

async function getBillingMaxSends() {
  const runtime = await getRuntimeAutomationConfig();

  const raw = parseInt(runtime.billingMax || "5", 10);

  if (!Number.isFinite(raw) || raw < 1) return 5;

  return Math.min(raw, 50);
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

function isDueInThreeDays(charge, nowUtc) {
  const rawDue = charge?.due_date || charge?.data_vencimento || charge?.vencimento || charge?.due_at;
  const due = parseDueDate(rawDue);
  if (!due) return false;
  const target = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate() + 3));
  return (
    due.getUTCFullYear() === target.getUTCFullYear() &&
    due.getUTCMonth() === target.getUTCMonth() &&
    due.getUTCDate() === target.getUTCDate()
  );
}

function getChargeId(charge) {
  const id = charge?.id ?? charge?.charge_id ?? charge?.cobranca_id ?? "";
  return String(id || "").trim();
}

function hasValidPhone(lead) {
  return Boolean(String(lead?.phone || "").trim());
}

function getBillingLog(lead) {
  return lead?.campaignLogs?.[BILLING_CAMPAIGN_KEY] || null;
}

function alreadyProcessedSameCharge(lead, chargeId, dueDateRaw) {
  const log = getBillingLog(lead);
  if (!log) return false;
  const lastChargeId = String(log.lastChargeId || "").trim();
  const lastDueDate = String(log.lastDueDate || "").trim();
  return lastChargeId && lastDueDate && lastChargeId === chargeId && lastDueDate === String(dueDateRaw || "").trim();
}

function selectPrimaryD3Charge(charges, nowUtc) {
  const eligible = (charges || []).filter((charge) => {
    const link = String(charge?.link || "").trim();
    const customerId = getCustomerIdFromCharge(charge);
    return Boolean(link) && Boolean(customerId) && isUnpaidCharge(charge) && isDueInThreeDays(charge, nowUtc);
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

async function processLeadReminder(lead, charge, mode, templateName, languageCode, now) {
  const phone = String(lead.phone || "").trim();
  const customerName = String(lead.name || "Cliente").trim() || "Cliente";
  const dueRaw = String(charge?.due_date || charge?.data_vencimento || charge?.vencimento || "").trim();
  const chargeId = getChargeId(charge);
  const boletoLink = String(charge?.link || "").trim();
  const formattedAmount = formatAmountBr(charge?.value);
  const formattedDueDate = formatDueDatePtBr(dueRaw);

  if (!phone || !chargeId || !dueRaw || !boletoLink) {
    console.log("[billing_reminder] missing_required_data", {
      phonePresent: Boolean(phone),
      chargeIdPresent: Boolean(chargeId),
      dueDatePresent: Boolean(dueRaw),
      boletoLinkPresent: Boolean(boletoLink),
      customerId: lead.beeswebCustomerId,
    });
    return { sent: false, skipped: true };
  }
  if (alreadyProcessedSameCharge(lead, chargeId, dueRaw)) {
    console.log("[billing_reminder] duplicate_skipped", {
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
      { type: "text", text: formattedAmount },
      { type: "text", text: formattedDueDate },
      { type: "text", text: boletoLink },
    ],
  },
];

  console.log("[billing_reminder] template_ok", {
    templateName,
    params: components[0].parameters.length,
  });

  if (mode === "test") {
    console.log("[billing_reminder][test] would_send", {
      phone,
      customerId: lead.beeswebCustomerId,
      chargeId,
      dueDate: dueRaw,
      templateName,
      languageCode,
    });
  } else if (mode === "live") {
    await sendWhatsAppTemplate(phone, templateName, languageCode, components);
    console.log("[billing_reminder] sent", { phone, customerId: lead.beeswebCustomerId, chargeId, dueDate: dueRaw });
  }

  await Lead.updateOne(
    { _id: lead._id },
    {
      $set: {
        [`campaignLogs.${BILLING_CAMPAIGN_KEY}.lastChargeId`]: chargeId,
        [`campaignLogs.${BILLING_CAMPAIGN_KEY}.lastDueDate`]: dueRaw,
        [`campaignLogs.${BILLING_CAMPAIGN_KEY}.lastSentAt`]: now,
        [`campaignLogs.${BILLING_CAMPAIGN_KEY}.lastMode`]: mode,
      },
    }
  );

  return { sent: true, skipped: false };
}

async function runBillingReminderScheduler() {
  const startedAt = new Date();
  const mode = await getBillingMode();
  console.log("[billing_reminder] run_start", {
    mode,
    cron: BILLING_REMINDER_CRON,
    startedAt: startedAt.toISOString(),
  });
  if (mode === "disabled") {
    console.log("[billing_reminder] disabled_skip");
    return;
  }

  const templateName = String(whatsappTemplates.billingReminder || "").trim();
  const languageCode = String(whatsappTemplates.languageCode || "pt_BR").trim() || "pt_BR";

  if (!templateName) {
    console.log("[billing_reminder] template_missing_skip");
    return;
  }

  try {
    const leads = await Lead.find(
      {
        tenant: "dcnet",
        campaignOptIn: { $ne: false },
        beeswebCustomerId: { $exists: true, $ne: null },
        phone: { $exists: true, $ne: null },
      },
      { _id: 1, phone: 1, name: 1, beeswebCustomerId: 1, campaignOptIn: 1, campaignLogs: 1 }
    ).lean();

    console.log("[billing_reminder] leads_loaded", {
      totalLeads: Array.isArray(leads) ? leads.length : 0,
    });

    if (!Array.isArray(leads) || !leads.length) {
      console.log("[billing_reminder] no_eligible_leads");
      return;
    }

    const byCustomer = new Map();
    for (const lead of leads) {
      if (!hasValidPhone(lead)) continue;
      const customerId = String(lead.beeswebCustomerId || "").trim();
      if (!customerId) continue;
      if (!byCustomer.has(customerId)) byCustomer.set(customerId, []);
      byCustomer.get(customerId).push(lead);
    }

    console.log("[billing_reminder] customers_grouped", {
      totalCustomers: byCustomer.size,
    });

    let processed = 0;
    let sent = 0;
    let skipped = 0;
    const maxSends = await getBillingMaxSends();

    for (const [customerId, customerLeads] of byCustomer.entries()) {
      const chargesPack = await listChargesByCustomerId(customerId);
      if (!chargesPack?.ok) {
        console.log("[billing_reminder] charges_lookup_failed", { customerId });
        skipped += customerLeads.length;
        continue;
      }
      const charge = selectPrimaryD3Charge(chargesPack.charges, startedAt);
      if (!charge) {
        console.log("[billing_reminder] no_d3_charge", { customerId });
        skipped += customerLeads.length;
        continue;
      }

      const targetLead = customerLeads.find((l) => hasValidPhone(l)) || null;
      if (!targetLead) {
        console.log("[billing_reminder] lead_not_found_for_customer", { customerId });
        skipped += 1;
        continue;
      }

      processed += 1;
      try {
        const result = await processLeadReminder(targetLead, charge, mode, templateName, languageCode, startedAt);
        if (result.sent) sent += 1;
        if (result.skipped) skipped += 1;
      } catch (e) {
        skipped += 1;
        console.error("[billing_reminder] process_failed", {
          customerId,
          phone: targetLead.phone,
          error: e?.message || e,
        });
      }
    }

    console.log("[billing_reminder] run_done", {
      mode,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      processedCustomers: byCustomer.size,
      processed,
      sent,
      skipped,
    });
  } catch (e) {
    console.error("[billing_reminder] run_failed", e?.message || e);
  }
}

module.exports = {
  runBillingReminderScheduler,
  BILLING_REMINDER_CRON,
};
