"use strict";

const mongoose = require("mongoose");

const MetaTemplateSchema = new mongoose.Schema(
  {
    tenant: { type: String, default: "dcnet", index: true },
    metaId: { type: String, default: "", index: true },
    name: { type: String, required: true, index: true },
    category: { type: String, default: "" },
    language: { type: String, default: "pt_BR", index: true },
    status: { type: String, default: "" },
    quality: { type: String, default: "" },
    components: { type: Array, default: [] },
    variableKeys: { type: Array, default: [] },
    needsHeaderImage: { type: Boolean, default: false },
    lastMetaUpdatedAt: { type: Date, default: null },
    lastSyncedAt: { type: Date, default: null, index: true },
    raw: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

MetaTemplateSchema.index({ tenant: 1, name: 1, language: 1 }, { unique: true });

module.exports = mongoose.models.MetaTemplate || mongoose.model("MetaTemplate", MetaTemplateSchema);
