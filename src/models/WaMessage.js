const mongoose = require("mongoose");

const WaMessageSchema = new mongoose.Schema(
  {
    // ✅ MULTITENANT
    tenant: { type: String, default: "dcnet", index: true },
    channel: { type: String, default: "whatsapp", index: true },
    origin: { type: String, default: null }, // domínio/origem (web) | null no WhatsApp

    // inbound msg.id
    waMessageId: { type: String },

    // outbound wamid
    wamid: { type: String },

    direction: {
      type: String,
      direction: { type: String, enum: ["inbound", "outbound", "system"], required: true }
    },

    from: { type: String, default: "" },
    to: { type: String, default: "" },

    text: { type: String, default: "" },
    intent: { type: String, default: "" },
    page: { type: String, default: "" },

    raw: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

// índice único só aqui (sem "index:true" no campo pra não duplicar)
WaMessageSchema.index(
  { waMessageId: 1 },
  { unique: true, partialFilterExpression: { waMessageId: { $type: "string" } } }
);

module.exports =
  mongoose.models.WaMessage ||
  mongoose.model("WaMessage", WaMessageSchema);
