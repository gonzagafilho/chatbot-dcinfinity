"use strict";

const mongoose = require("mongoose");

const LogEntrySchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    phoneMasked: { type: String, default: "" },
    status: { type: String, required: true },
    error: { type: String, default: "" },
  },
  { _id: true }
);

const JobSchema = new mongoose.Schema(
  {
    tenant: { type: String, required: true, index: true, default: "dcnet" },
    title: { type: String, default: "" },
    message: { type: String, default: "" },
    imageUrl: { type: String, default: "" },
    returnText: { type: String, default: "" },
    audience: {
      type: String,
      enum: ["all", "active", "contract"],
      default: "all",
    },
    composedText: { type: String, required: true },
    status: {
      type: String,
      enum: ["draft", "queued", "running", "paused", "canceled", "completed", "failed"],
      default: "queued",
      index: true,
    },
    totalEstimated: { type: Number, default: 0 },
    totalQueued: { type: Number, default: 0 },
    totalSent: { type: Number, default: 0 },
    totalFailed: { type: Number, default: 0 },
    sentCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    successRate: { type: Number, default: 0 },
    phoneQueue: { type: [String], default: () => [] },
    currentIndex: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.Mixed, default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    canceledAt: { type: Date, default: null },
    lastError: { type: String, default: "" },
    logs: { type: [LogEntrySchema], default: () => [] },
  },
  { timestamps: true }
);

JobSchema.index({ status: 1, createdAt: 1 });
JobSchema.index({ createdAt: -1 });

module.exports =
  mongoose.models.MaintenanceBroadcastJob ||
  mongoose.model("MaintenanceBroadcastJob", JobSchema);
