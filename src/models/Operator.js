"use strict";

const mongoose = require("mongoose");

const OperatorSchema = new mongoose.Schema(
  {
    tenant: { type: String, default: "dcnet", index: true },
    adminId: { type: String, default: "", index: true },
    name: { type: String, default: "" },
    email: { type: String, default: "", index: true },
    role: { type: String, default: "operator" },
    departments: { type: [String], default: ["comercial", "financeiro", "suporte"] },
    active: { type: Boolean, default: true, index: true },
    lastSeenAt: { type: Date, default: null },
  },
  { timestamps: true }
);

OperatorSchema.index({ tenant: 1, email: 1 }, { unique: true, partialFilterExpression: { email: { $gt: "" } } });
OperatorSchema.index({ tenant: 1, adminId: 1 });

module.exports = mongoose.models.Operator || mongoose.model("Operator", OperatorSchema);
