"use strict";

const Lead = require("../models/Lead");
const WaMessage = require("../models/WaMessage");
const { resolveActiveMaintenance } = require("./maintenanceResolver");

async function resolveConversationContext({ tenant, phone, origin }) {
  const safeTenant = (tenant || "dcnet").toString().trim().toLowerCase();
  const safePhone = (phone || "").toString().trim();
  const safeOrigin = (origin || "").toString().trim().toLowerCase();

  if (!safePhone) {
    return {
      customer: null,
      history: null,
      context: null,
      maintenance: null,
      origin: safeOrigin || null,
    };
  }

  let lead = null;
  let msgCount = 0;
  let lastMsg = null;

  try {
    lead = await Lead.findOne({ tenant: safeTenant, phone: safePhone }).lean();
  } catch {
    lead = null;
  }

  try {
    const where = {
      tenant: safeTenant,
      $or: [{ phone: safePhone }, { from: safePhone }, { to: safePhone }],
    };
    msgCount = await WaMessage.countDocuments(where);
    lastMsg = await WaMessage.findOne(where).sort({ createdAt: -1 }).lean();
  } catch {
    msgCount = 0;
    lastMsg = null;
  }

  const maintenance = await resolveActiveMaintenance(safeTenant);

  return {
    customer: lead
      ? {
          phone: lead.phone || safePhone,
          tenant: lead.tenant || safeTenant,
          status: lead.status || null,
          lastIntent: lead.lastIntent || null,
          financialRetryCount: lead.financialRetryCount ?? 0,
          requiresHumanFinancialReview: Boolean(lead.requiresHumanFinancialReview),
          beeswebIdentificationSkip: Boolean(lead.beeswebIdentificationSkip),
          beeswebCpfInvalidAttempts: lead.beeswebCpfInvalidAttempts ?? 0,
          beeswebCpfFromUnregisteredPhone: Boolean(lead.beeswebCpfFromUnregisteredPhone),
          financeMenuTwoOptionsOnly: Boolean(lead.financeMenuTwoOptionsOnly),
        }
      : null,
    history:
      msgCount > 0
        ? {
            count: msgCount,
            lastMessageAt: lastMsg?.createdAt || null,
          }
        : null,
    context: {
      tenant: safeTenant,
      phone: safePhone,
      origin: safeOrigin || lead?.origin || null,
      status: lead?.status || null,
      lastIntent: lead?.lastIntent || null,
      financialRetryCount: lead?.financialRetryCount ?? 0,
      requiresHumanFinancialReview: Boolean(lead?.requiresHumanFinancialReview),
      lastFinancialIntentAt: lead?.lastFinancialIntentAt || null,
      beeswebCustomerId: lead?.beeswebCustomerId || null,
      beeswebIdentificationSkip: Boolean(lead?.beeswebIdentificationSkip),
      beeswebCpfInvalidAttempts: lead?.beeswebCpfInvalidAttempts ?? 0,
      beeswebCpfFromUnregisteredPhone: Boolean(lead?.beeswebCpfFromUnregisteredPhone),
      financeMenuTwoOptionsOnly: Boolean(lead?.financeMenuTwoOptionsOnly),
    },
    maintenance,
  };
}

module.exports = { resolveConversationContext };
