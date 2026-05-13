"use strict";

const mongoose = require("mongoose");

/**
 * Configuração manual de conteúdo do chatbot por tenant (painel /chatbot-admin).
 * Manutenção aqui tem prioridade sobre MaintenanceNotice quando active=true e body preenchido.
 */
const ChatbotContentConfigSchema = new mongoose.Schema(
  {
    tenant: { type: String, required: true, unique: true, index: true },

    campaigns: {
      aniversarioImage: { type: String, default: "" },
      pascoaImage: { type: String, default: "" },
      diaDasMaesImage: { type: String, default: "" },
      diaDosPaisImage: { type: String, default: "" },
      natalImage: { type: String, default: "" },
      anoNovoImage: { type: String, default: "" },
    },

    campaignTexts: {
      aniversarioText: { type: String, default: "" },
      pascoaText: { type: String, default: "" },
      diaDasMaesText: { type: String, default: "" },
      diaDosPaisText: { type: String, default: "" },
      natalText: { type: String, default: "" },
      anoNovoText: { type: String, default: "" },
    },

    campaignActive: {
      aniversario: { type: Boolean, default: true },
      pascoa: { type: Boolean, default: true },
      diaDasMaes: { type: Boolean, default: true },
      diaDosPais: { type: Boolean, default: true },
      natal: { type: Boolean, default: true },
      anoNovo: { type: Boolean, default: true },
    },

    operationalMessages: {
      maintenanceMessage: { type: String, default: "" },
      instabilityMessage: { type: String, default: "" },
      expectedReturnMessage: { type: String, default: "" },
      shortAlertMessage: { type: String, default: "" },
    },

    maintenance: {
      active: { type: Boolean, default: false },
      title: { type: String, default: "" },
      body: { type: String, default: "" },
      eta: { type: Date, default: null },
    },

    automation: {
      billingLive: { type: Boolean, default: true },
      seasonalLive: { type: Boolean, default: true },
      campaignMax: { type: Number, default: 10 },
      billingMax: { type: Number, default: 5 },
    },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.ChatbotContentConfig ||
  mongoose.model("ChatbotContentConfig", ChatbotContentConfigSchema);
