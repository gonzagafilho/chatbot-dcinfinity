function ruleSite2({ message }) {
  const msg = (message || "").trim().toLowerCase();

  if (msg === "1" || msg.includes("plan")) {
    return "📦 SITE2: Planos disponíveis:\n- 300 Mega\n- 500 Mega\n\nQuer que eu te mande valores?";
  }

  if (msg === "2" || msg.includes("suporte")) {
    return "🛠️ SITE2 Suporte:\n1) Internet lenta\n2) Sem conexão\n3) Trocar senha do Wi-Fi\n\nDigite o número.";
  }

  if (msg === "3" || msg.includes("comercial") || msg.includes("venda")) {
    return "💰 SITE2 Comercial:\nMe diga seu bairro e se é casa ou empresa.";
  }

  if (msg.includes("atendente") || msg === "4") {
    return "👤 SITE2: Ok! Vou te colocar com um atendente. Me informe seu nome e bairro.";
  }

  return "Olá! 👋 Sou o atendimento do SITE2.\nEscolha uma opção:\n\n1) 📦 Planos\n2) 🛠️ Suporte\n3) 💰 Comercial\n4) 👤 Atendente";
}

module.exports = { ruleSite2 };
