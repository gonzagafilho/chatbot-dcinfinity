const mongoose = require("mongoose");

const LeadSchema = new mongoose.Schema(
  {
    tenant: { type: String, index: true, default: "dcnet" },
    phone: { type: String, index: true }, // whatsapp: número | web:sessionId
    name: { type: String, default: null },

    origin: { type: String, default: null }, // "whatsapp" | "web"
    channel: { type: String, default: null }, // "whatsapp" | "web"

    lastMessage: { type: String, default: "" },
    lastIntent: { type: String, default: null },

    status: { type: String, default: "novo", index: true }, // novo | em_atendimento | resolvido
  },
  { timestamps: true }
);

// evita duplicar o model no reload
module.exports = mongoose.models.Lead || mongoose.model("Lead", LeadSchema);