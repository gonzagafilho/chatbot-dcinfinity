const mongoose = require("mongoose");

const LeadSchema = new mongoose.Schema(
  {
    tenant: { type: String, index: true, default: "dcnet" },
    phone: { type: String, index: true }, // whatsapp: número | web:sessionId
    name: { type: String, default: null },
    avatarUrl: { type: String, default: "" },
    profilePhotoUrl: { type: String, default: "" },
    whatsappProfileName: { type: String, default: "" },
    birthday: { type: String, default: null },
    gender: { type: String, default: null },
    isMother: { type: Boolean, default: false },
    isFather: { type: Boolean, default: false },
    campaignOptIn: { type: Boolean, default: true },
    campaignLogs: { type: Object, default: {} },

    origin: { type: String, default: null }, // "whatsapp" | "web"
    channel: { type: String, default: null }, // "whatsapp" | "web"

    lastMessage: { type: String, default: "" },
    lastIntent: { type: String, default: null },
    tags: { type: [String], default: [], index: true },
    internalNotes: { type: String, default: "" },
    lastCep: { type: String, default: "" },
    selectedPlan: { type: String, default: "" },
    lastCampaign: { type: String, default: "" },
    unreadManual: { type: Boolean, default: false, index: true },
    cpf: { type: String, default: "", index: true },
    city: { type: String, default: "", index: true },
    neighborhood: { type: String, default: "", index: true },
    dueDate: { type: String, default: "" },
    lastInvoice: { type: String, default: "" },
    financialStatus: { type: String, default: "" },
    connectionStatus: { type: String, default: "" },
    customerSince: { type: Date, default: null },
    lastAttendanceAt: { type: Date, default: null },
    protocol: { type: String, default: "", index: true },
    timelineEvents: { type: [mongoose.Schema.Types.Mixed], default: [] },

    /** Fluxo financeiro DC NET + BeesWeb (sem trust_release automático) */
    financialRetryCount: { type: Number, default: 0 },
    requiresHumanFinancialReview: { type: Boolean, default: false },
    lastFinancialIntentAt: { type: Date, default: null },
    /** Liberação manual assistida (comando humano WhatsApp); sem trust_release */
    pixManualReleasedAt: { type: Date, default: null },
    pixManualReleasedBy: { type: String, default: null },
    beeswebCustomerId: { type: String, default: null },
    /** Identificação DC NET + BeesWeb (fallback CPF); não usar trust_release */
    beeswebIdentificationSkip: { type: Boolean, default: false },
    beeswebCpfInvalidAttempts: { type: Number, default: 0 },
    /** Telefone não casou na BeesWeb → “Já sou cliente” → fluxo CPF. */
    beeswebCpfFromUnregisteredPhone: { type: Boolean, default: false },
    /** Menu financeiro 1-2 (boleto/pix) vindo de CPF pós-telefone desconhecido. */
    financeMenuTwoOptionsOnly: { type: Boolean, default: false },
    assignedTo: { type: String, default: null, index: true },     // adminId/email
    assignedToName: { type: String, default: "" },
    assignedToEmail: { type: String, default: null, index: true },
    assignedAt: { type: Date, default: null },
    queueStatus: { type: String, enum: ["waiting", "assigned", "resolved", "paused"], default: "waiting", index: true },
    priority: { type: String, enum: ["low", "normal", "high", "urgent"], default: "normal", index: true },
    department: { type: String, enum: ["comercial", "financeiro", "suporte", "instalacao", "noc"], default: "comercial", index: true },
    aiSummary: { type: String, default: "" },
    aiIntent: { type: String, default: "" },
    aiSentiment: { type: String, default: "" },
    aiSuggestedPriority: { type: String, default: "" },
    aiSuggestedDepartment: { type: String, default: "" },
    aiSuggestedReply: { type: String, default: "" },
    aiNextSteps: { type: [String], default: [] },
    aiAnalyzedAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },

    /** Verificação de cobertura GPS (fluxo comercial / panfleto) */
    coverageStatus: { type: String, default: null },
    coverageAreaName: { type: String, default: null },
    coverageLat: { type: Number, default: null },
    coverageLng: { type: Number, default: null },
    
    status: { type: String, default: "novo", index: true }, // novo | em_atendimento | resolvido
  },
  { timestamps: true }
);

// evita duplicar o model no reload
module.exports = mongoose.models.Lead || mongoose.model("Lead", LeadSchema);