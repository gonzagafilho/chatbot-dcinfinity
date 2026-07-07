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
    messageType: { type: String, default: "", index: true },
    mediaUrl: { type: String, default: "" },
    filename: { type: String, default: "" },
    intent: { type: String, default: "" },
    page: { type: String, default: "" },

    raw: { type: mongoose.Schema.Types.Mixed },

    deliveryStatus: { type: String, default: null, index: true },
    metaStatus: { type: String, default: null, index: true },
    metaStatusAt: { type: Date, default: null },

    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },

    metaError: { type: mongoose.Schema.Types.Mixed, default: null },

    templateName: { type: String, default: "", index: true },
    languageCode: { type: String, default: "" },
    templateVariables: { type: mongoose.Schema.Types.Mixed, default: null },
    templateComponents: { type: mongoose.Schema.Types.Mixed, default: null },
    fallbackToTemplate: { type: Boolean, default: false, index: true },
    hiddenFromInbox: { type: Boolean, default: false, index: true },
    hiddenAt: { type: Date, default: null },
    hiddenBy: { type: String, default: "" },
    operatorId: { type: String, default: "", index: true },
    operatorName: { type: String, default: "" },
    operatorEmail: { type: String, default: "" },
    responseKind: { type: String, default: "" },
    auditAction: { type: String, default: "", index: true },
    auditBy: { type: String, default: "" },
    auditAt: { type: Date, default: null },
    reactions: { type: [mongoose.Schema.Types.Mixed], default: [] },
    replyToMessageId: { type: String, default: "", index: true },
    replyToText: { type: String, default: "" },
    replyToWamid: { type: String, default: "" },
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
