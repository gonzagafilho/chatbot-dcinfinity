const mongoose = require("mongoose");

const CoverageAreaSchema = new mongoose.Schema(
  {
    tenant: { type: String, required: true, index: true },
    name: { type: String, default: "" },
    centerLat: { type: Number, required: true },
    centerLng: { type: Number, required: true },
    radiusMeters: { type: Number, required: true, min: 1 },
    active: { type: Boolean, default: true, index: true },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

CoverageAreaSchema.index({ tenant: 1, active: 1 });

module.exports =
  mongoose.models.CoverageArea || mongoose.model("CoverageArea", CoverageAreaSchema);
