const mongoose = require("mongoose");

const CoverageInterestSchema = new mongoose.Schema(
  {
    tenant: { type: String, required: true, index: true, default: "dcnet" },
    phone: { type: String, required: true, index: true },
    name: { type: String, default: "" },
    cep: { type: String, required: true, index: true },
    source: { type: String, default: "whatsapp" },
    status: {
      type: String,
      enum: ["waiting_coverage", "contacted", "converted", "discarded"],
      default: "waiting_coverage",
      index: true,
    },
    lastMessage: { type: String, default: "" },
  },
  { timestamps: true }
);

CoverageInterestSchema.index({ tenant: 1, phone: 1, cep: 1 }, { unique: true });

module.exports = mongoose.models.CoverageInterest || mongoose.model("CoverageInterest", CoverageInterestSchema);
