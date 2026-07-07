const mongoose = require("mongoose");

const CoverageZipSchema = new mongoose.Schema(
  {
    tenant: { type: String, required: true, index: true, default: "dcnet" },
    cep: { type: String, required: true, index: true },
    bairro: { type: String, default: "" },
    cidade: { type: String, default: "" },
    uf: { type: String, default: "DF" },
    status: {
      type: String,
      enum: ["covered", "partial", "not_covered"],
      default: "covered",
      index: true,
    },
    technology: { type: String, default: "fibra" },
    notes: { type: String, default: "" },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

CoverageZipSchema.index({ tenant: 1, cep: 1 }, { unique: true });

module.exports = mongoose.models.CoverageZip || mongoose.model("CoverageZip", CoverageZipSchema);
