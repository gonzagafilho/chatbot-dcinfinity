const mongoose = require("mongoose");

const TenantUserSchema = new mongoose.Schema(
  {
    tenant: { type: String, required: true, index: true, trim: true },

    name: { type: String, required: true, trim: true },

    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    role: {
      type: String,
      enum: ["TENANT_ADMIN", "AGENT"],
      default: "AGENT",
      required: true,
    },

    active: { type: Boolean, default: true, index: true },

    passwordHash: { type: String, required: true },

    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// email único POR tenant
TenantUserSchema.index({ tenant: 1, email: 1 }, { unique: true });

module.exports = mongoose.model("TenantUser", TenantUserSchema);