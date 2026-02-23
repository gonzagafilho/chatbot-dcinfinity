function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function includesAny(t, list) {
  return list.some((k) => t.includes(k));
}

function moneyBRL(n) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}

const PLANS = [
  { speed: "350 MB", price: 78.99 },
  { speed: "400 MB", price: 88.99 },
  { speed: "500 MB", price: 98.99 },
  { speed: "600 MB", price: 119.99 },
];

const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER || "5561991374910";
const CITY = process.env.CITY || "Planaltina DF";

function plansText() {
  const lines = PLANS.map((p) => `• ${p.speed} — ${moneyBRL(p.price)}`);
  return `📦 *Planos disponíveis em ${CITY}:*\n${lines.join("\n")}\n\n✅ Sem fidelidade\n✅ Instalação grátis\n✅ Wi-Fi 5G`;
}

function ruralText() {
  return (
    "🌾🚀 *Internet Rural (Starlink)*\n" +
    "Perfeita para áreas sem cobertura de fibra.\n\n" +
    "✅ Instalação rápida\n" +
    "✅ Alta estabilidade\n" +
    "✅ Ideal para sítios, chácaras e fazendas\n\n" +
    "Me diga:\n" +
    "• Nome\n" +
    "• Local (bairro/linha/roteiro)\n" +
    "• Se precisa para casa ou empresa\n"
  );
}

function handoffText(reason = "Atendimento humano") {
  const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(
    `Olá! Quero falar com um atendente (${reason}).`
  )}`;
  return {
    handoff: { type: "whatsapp", url },
    reply: `Claro! Vou te encaminhar para um atendente.\n👉 Clique aqui: ${url}`,
  };
}

function buildLead({ name, phone, neighborhood, plan, intent, message, origin, page }) {
  if (!name && !phone) return null;
  return {
    name: name || null,
    phone: phone || null,
    neighborhood: neighborhood || null,
    plan: plan || null,
    origin: origin || null,
    page: page || null,
    intent,
    lastMessage: message,
    createdAt: new Date().toISOString(),
  };
}

function replyFromRulesInternal({ message, name, phone, neighborhood, plan, origin, page }) {
  const t = normalize(message);

  console.log("🧠 rules.js ACTIVE", { message, origin, page });

  const isRuralPage = String(page || "").includes("internet-rural.html");

  // INTERNET RURAL
  if (isRuralPage || includesAny(t, ["rural", "starlink", "fazenda", "chacara", "chácara", "sitio", "sítio"])) {
    return {
      intent: "rural",
      reply: ruralText(),
      lead: buildLead({ name, phone, neighborhood, plan, origin, page, intent: "rural", message }),
    };
  }

  // SAUDAÇÃO
  if (includesAny(t, ["oi", "ola", "bom dia", "boa tarde", "boa noite", "eai"])) {
    return {
      intent: "greeting",
      reply:
        "Olá! 👋 Sou o atendimento DCNET Infinity.\nMe diga o que você precisa:\n\n1) 📦 Planos\n2) 🛠️ Suporte\n3) 💰 Comercial\n4) 👤 Falar com atendente",
    };
  }

  // PLANOS
  if (includesAny(t, ["plano", "planos", "preco", "preço", "valor", "mensalidade", "internet"])) {
    return {
      intent: "plans",
      reply: plansText() + "\n\nQuer que eu te indique o melhor plano? Me diga: quantas pessoas usam e se joga/streaming.",
      lead: buildLead({ name, phone, neighborhood, plan, origin, page, intent: "plans", message }),
    };
  }

  // SUPORTE
  if (includesAny(t, ["suporte", "nao funciona", "não funciona", "sem internet", "caiu", "lento", "lentidao", "wifi", "roteador"])) {
    return {
      intent: "support",
      reply:
        "🛠️ Vamos resolver! Responde rapidinho:\n\n1) A luz *PON* do modem está *verde* ou *vermelha*?\n2) O problema é no Wi-Fi ou no cabo?\n3) Qual seu bairro/rua (só referência)?",
      lead: buildLead({ name, phone, neighborhood, plan, origin, page, intent: "support", message }),
    };
  }

  // COMERCIAL / CONTRATAÇÃO
  if (includesAny(t, ["contratar", "assinar", "instalacao", "instalação", "endereco", "endereço", "cobertura"])) {
    return {
      intent: "sales",
      reply:
        `💰 Perfeito! Para confirmar cobertura em ${CITY}, me diga:\n\n• Bairro\n• Ponto de referência\n• Se é casa ou empresa\n\nSe preferir, posso te mandar direto para o WhatsApp do comercial.`,
      lead: buildLead({ name, phone, neighborhood, plan, origin, page, intent: "sales", message }),
    };
  }

  // ATENDENTE HUMANO
  if (includesAny(t, ["atendente", "humano", "pessoa", "falar com", "ligacao", "ligação"])) {
    return {
      intent: "handoff",
      ...handoffText("Falar com atendente"),
      lead: buildLead({ name, phone, neighborhood, plan, origin, page, intent: "handoff", message }),
    };
  }

  // DEFAULT
  return {
    intent: "fallback",
    reply:
      "Entendi 🙂 Você quer:\n\n📦 Planos\n🛠️ Suporte\n💰 Comercial\n👤 Atendente\n\nResponda com uma dessas palavras.",
    lead: buildLead({ name, phone, neighborhood, plan, origin, page, intent: "fallback", message }),
  };
}

function replyFromRules(payload) {
  return replyFromRulesInternal(payload);
}

module.exports = { replyFromRules };
