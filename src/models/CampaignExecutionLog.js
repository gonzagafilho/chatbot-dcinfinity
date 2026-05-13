"use strict";

const mongoose = require("mongoose");

const CampaignExecutionLogSchema = new mongoose.Schema(
  {
    tenant: { type: String, required: true, index: true, default: "dcnet" },
    type: { type: String, required: true, index: true },
    campaignKey: { type: String, required: true, index: true },
    totalProcessed: { type: Number, default: 0 },
    totalSent: { type: Number, default: 0 },
    totalFailed: { type: Number, default: 0 },
    totalSkipped: { type: Number, default: 0 },
    imageUrl: { type: String, default: "" },
    mode: { type: String, default: "live", index: true },
    executedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

CampaignExecutionLogSchema.index({ tenant: 1, executedAt: -1 });
CampaignExecutionLogSchema.index({ tenant: 1, type: 1, campaignKey: 1, executedAt: -1 });

module.exports =
  mongoose.models.CampaignExecutionLog ||
  mongoose.model("CampaignExecutionLog", CampaignExecutionLogSchema);
