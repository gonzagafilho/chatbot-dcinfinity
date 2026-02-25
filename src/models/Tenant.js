"use strict";

const mongoose = require("mongoose");

const TenantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    token: { type: String, required: true, unique: true, trim: true },

    // SaaS (Etapa B já preparado)
    plan: { type: String, default: "basic" },
    maxUsers: { type: Number, default: 1 },
    expiresAt: { type: Date, default: null },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);


module.exports = mongoose.model("Tenant", TenantSchema);