"use strict";

function textOf(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeMessages(messages) {
  return (Array.isArray(messages) ? messages : []).slice(-80).map((m) => ({
    direction: textOf(m.direction),
    text: textOf(m.text || m.friendlyTemplateName || m.templateName || m.messageType),
    type: textOf(m.messageType || "text"),
    at: m.createdAt || m.metaStatusAt || m.updatedAt || null,
    status: textOf(m.deliveryStatus || m.metaStatus || m.status),
    templateName: textOf(m.templateName),
    metaError: m.metaError || null,
  }));
}

function classifyIntent(input) {
  const text = textOf(input).toLowerCase();
  if (/boleto|fatura|pix|pagar|pagamento|vencid|cobran|segunda via|2a via|2ª via/.test(text)) return "financeiro";
  if (/sem internet|lento|lentid|caiu|caindo|roteador|sinal|suporte|manuten/.test(text)) return "suporte";
  if (/instala|técnico|tecnico|agendar|visita/.test(text)) return "instalacao";
  if (/plano|preço|preco|promo|cobertura|cep|contratar|fibra|internet/.test(text)) return "comercial";
  return "atendimento";
}

function detectHotLead(messages, lead) {
  const joined = messages.map((m) => m.text).join(" ").toLowerCase();
  const commercial = classifyIntent(joined) === "comercial";
  const hasPlan = !!(lead && (lead.selectedPlan || lead.plan || lead.planoEscolhido));
  const hasCep = /\b\d{5}-?\d{3}\b/.test(joined) || !!(lead && (lead.lastCep || lead.cep));
  return commercial && (hasPlan || hasCep || /quero|contratar|assinar|fechar/.test(joined));
}

function suggestTemplate(intent, lead) {
  const status = textOf(lead && (lead.financialStatus || lead.statusFinanceiro)).toLowerCase();
  if (intent === "financeiro" && /venc|atras|bloq/.test(status)) return "dcnet_billing_overdue_d2_v2";
  if (intent === "financeiro") return "dcnet_billing_reminder_v2";
  if (intent === "comercial") return "dcnet_promocao_fibra";
  if (intent === "suporte") return "dcnet_comunicado_oficial";
  return "dcnet_comunicado_oficial";
}

function summarizeConversation(messages) {
  if (!messages.length) return "Sem histórico suficiente para resumir.";
  const last = messages.slice(-6).map((m) => (m.direction === "inbound" ? "Cliente: " : "DC NET: ") + m.text).join(" | ");
  return last.slice(0, 900);
}

function generateTasks(intent, hotLead, lead) {
  const tasks = [];
  if (hotLead) tasks.push("Priorizar atendimento comercial: lead demonstrou intenção de contratação.");
  if (intent === "financeiro") tasks.push("Conferir faturas, vencimento e opção de PIX/segunda via antes de responder.");
  if (intent === "suporte") tasks.push("Validar status de conexão e pedir evidências simples antes de escalar visita técnica.");
  if (intent === "comercial") tasks.push("Confirmar CEP/cobertura, plano escolhido e encaminhar para fechamento humano.");
  if (lead && lead.birthdayToday) tasks.push("Cliente faz aniversário hoje: considerar template de aniversário aprovado.");
  return tasks;
}

function detectSentiment(messages, intent, hotLead) {
  const joined = messages.map((m) => m.text).join(" ").toLowerCase();
  if (/urgente|agora|cancelar|reclama|procon|processo|sem internet|parado|bloqueado|muito ruim/.test(joined)) return "urgente";
  if (/obrigad|valeu|perfeito|ok|certo|bom dia|boa tarde|boa noite/.test(joined) && !/problema|erro|falha/.test(joined)) return "positivo";
  if (/problema|erro|falha|demora|lento|cai|atras|vencid/.test(joined)) return "atencao";
  if (hotLead || intent === "comercial") return "oportunidade";
  return "neutro";
}

function priorityForAnalysis(intent, sentiment, hotLead) {
  if (sentiment === "urgente") return "urgent";
  if (hotLead || intent === "suporte" || sentiment === "atencao") return "high";
  if (intent === "financeiro") return "normal";
  return "normal";
}

function departmentForIntent(intent) {
  if (intent === "financeiro") return "financeiro";
  if (intent === "suporte") return "suporte";
  if (intent === "instalacao") return "instalacao";
  if (intent === "comercial") return "comercial";
  return "suporte";
}

function analyzeConversation({ messages, lead }) {
  const normalized = normalizeMessages(messages);
  const joined = normalized.map((m) => m.text).join(" ");
  const lastInbound = normalized.slice().reverse().find((m) => m.direction === "inbound" && m.text) || normalized[normalized.length - 1] || {};
  const intent = classifyIntent(lastInbound.text || joined);
  const hotLead = detectHotLead(normalized, lead || {});
  const sentiment = detectSentiment(normalized, intent, hotLead);
  const suggestedPriority = priorityForAnalysis(intent, sentiment, hotLead);
  const suggestedDepartment = departmentForIntent(intent);
  const reply = suggestReply({ messages: normalized, lead }).reply;
  const nextSteps = generateTasks(intent, hotLead, lead || {});
  if (!nextSteps.length) nextSteps.push("Confirmar a necessidade do cliente e registrar o próximo encaminhamento no atendimento.");
  return {
    ok: true,
    mode: process.env.OPENAI_API_KEY ? "heuristic_safe_with_ai_ready" : "heuristic_safe_fallback",
    autoSendAllowed: false,
    summary: summarizeConversation(normalized),
    intent,
    sentiment,
    urgency: sentiment === "urgente" ? "urgent" : suggestedPriority,
    suggestedReply: reply,
    suggestedDepartment,
    suggestedPriority,
    nextSteps,
    safeguards: [
      "A analise nao envia mensagem automaticamente ao cliente.",
      "Setor e prioridade sao apenas sugestoes ate o operador confirmar.",
      "Use Template Meta aprovado quando a janela de 24h estiver encerrada.",
    ],
  };
}

function suggestReply({ messages, lead }) {
  const normalized = normalizeMessages(messages);
  const lastInbound = normalized.slice().reverse().find((m) => m.direction === "inbound" && m.text) || normalized[normalized.length - 1] || {};
  const intent = classifyIntent(lastInbound.text || normalized.map((m) => m.text).join(" "));
  const hotLead = detectHotLead(normalized, lead || {});
  let reply = "Olá! Obrigado pelo contato. Vou verificar isso para você e já te retorno com a melhor orientação.";
  if (intent === "financeiro") reply = "Olá! Vou verificar sua situação financeira e te envio a melhor opção de pagamento com segurança.";
  if (intent === "suporte") reply = "Olá! Vamos verificar sua conexão. Pode me confirmar se as luzes do roteador estão acesas e se já reiniciou o equipamento?";
  if (intent === "instalacao") reply = "Olá! Vou verificar o andamento da instalação e te retorno com a previsão ou próximo passo.";
  if (intent === "comercial") reply = "Olá! Vou verificar os planos e a cobertura para seu endereço. Pode me informar seu CEP ou enviar sua localização?";
  return {
    ok: true,
    mode: "heuristic_safe",
    autoSendAllowed: false,
    reply,
    intent,
    hotLead,
    suggestedTemplate: suggestTemplate(intent, lead || {}),
    summary: summarizeConversation(normalized),
    tasks: generateTasks(intent, hotLead, lead || {}),
    safeguards: [
      "A IA nao envia mensagens automaticamente por padrao.",
      "Fora da janela de 24h, use Template Meta aprovado.",
      "Toda acao operacional deve permanecer auditavel.",
    ],
  };
}

function analyzeMetaFailure(metaError) {
  const code = Number(metaError && (metaError.code || metaError.error_code || metaError.errorCode) || 0) || null;
  const map = {
    131047: "Usar Template Meta aprovado para reabrir conversa fora da janela de 24h.",
    131026: "Conferir telefone do cliente antes de reenviar.",
    131051: "Cliente bloqueou a empresa; aguardar desbloqueio.",
    131009: "Sincronizar templates e escolher um template aprovado existente.",
  };
  return { code, recommendation: map[code] || "Verificar detalhes tecnicos no Historico e tentar novamente se fizer sentido." };
}

module.exports = {
  classifyIntent,
  suggestReply,
  summarizeConversation,
  detectHotLead,
  suggestTemplate,
  generateTasks,
  analyzeConversation,
  analyzeMetaFailure,
};
