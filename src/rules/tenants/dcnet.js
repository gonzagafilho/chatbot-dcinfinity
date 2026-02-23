function ruleDcnet({ message }) {
  const msg = (message || "").trim().toLowerCase();

  // atalhos
  if (msg === "1" || msg.includes("plano")) {
    return (
      "📦 *Planos DC NET*\n" +
      "1) 350 Mbps – R$ 78,99\n" +
      "2) 400 Mbps – R$ 88,99\n" +
      "3) 500 Mbps – R$ 98,99\n" +
      "4) 600 Mbps – R$ 119,99\n\n" +
      "Quer contratar qual? (digite 1-4)"
    );
  }

  if (msg === "2" || msg.includes("suporte")) {
    return (
      "🛠️ *Suporte DC NET*\n" +
      "1) Internet lenta\n" +
      "2) Sem conexão\n" +
      "3) Trocar senha do Wi-Fi\n" +
      "4) Teste de velocidade\n\n" +
      "Digite o número da opção."
    );
  }

  if (msg === "3" || msg.includes("comercial") || msg.includes("venda") || msg.includes("orçamento")) {
    return "💰 *Comercial DC NET*\nMe informe seu *bairro* e se é *casa* ou *empresa*.";
  }

  if (msg === "4" || msg.includes("atendente") || msg.includes("humano")) {
    return "👤 Ok! Vou chamar um atendente.\nMe informe seu *nome* e *bairro*.\n\n📲 WhatsApp: (61) 99965-6269";
  }

  // escolha de plano
  if (["1","2","3","4"].includes(msg)) {
    const planos = {
      "1": "350 Mbps – R$ 78,99",
      "2": "400 Mbps – R$ 88,99",
      "3": "500 Mbps – R$ 98,99",
      "4": "600 Mbps – R$ 119,99",
    };
    return `✅ Perfeito! Você escolheu: *${planos[msg]}*\nAgora me diga seu *bairro* e o *nome* do responsável.`;
  }

  return (
    "Olá! 👋 Sou o atendimento DC NET.\n" +
    "Me diga o que você precisa:\n\n" +
    "1) 📦 Planos\n" +
    "2) 🛠️ Suporte\n" +
    "3) 💰 Comercial\n" +
    "4) 👤 Falar com atendente"
  );
}

module.exports = { ruleDcnet };
