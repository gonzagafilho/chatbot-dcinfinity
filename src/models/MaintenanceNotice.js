const mongoose = require("mongoose");

const MaintenanceNoticeSchema = new mongoose.Schema(
  {
    tenant: { type: String, default: "dcnet", index: true },
    title: { type: String, default: "" },
    message: { type: String, required: true },
    active: { type: Boolean, default: false, index: true },
    startsAt: { type: Date, default: null },
    eta: { type: Date, default: null },
    area: { type: String, default: "geral" },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.MaintenanceNotice ||
  mongoose.model("MaintenanceNotice", MaintenanceNoticeSchema);
