function ruleDcsolar({ message }) {
  const msg = (message || "").trim().toLowerCase();

  if (msg === "1" || msg.includes("simul") || msg.includes("orçamento") || msg.includes("orcamento")) {
    return "☀️ *DC SOLAR*\nPerfeito! Me diga:\n1) Cidade/UF\n2) Valor médio da conta de luz\n3) Tipo: casa ou empresa";
  }

  if (msg === "2" || msg.includes("manuten") || msg.includes("suporte")) {
    return "🛠️ *Suporte DC SOLAR*\nMe explique o problema (ex: inversor, geração baixa, app). Se puder, envie foto.";
  }

  if (msg === "3" || msg.includes("atendente") || msg.includes("humano") || msg.includes("whatsapp")) {
    // o handoff real vai ser um botão/link no widget (vamos adicionar já já)
    return "👤 Ok! Vou te passar para um atendente.\nClique em *Falar no WhatsApp* no botão do chat, ou me diga seu *nome e cidade*.";
  }

  return (
    "Olá! 👋 Sou o atendimento da *DC SOLAR*.\n" +
    "Como posso te ajudar?\n\n" +
    "1) ☀️ Simulação / Orçamento\n" +
    "2) 🛠️ Suporte / Manutenção\n" +
    "3) 👤 Falar com atendente"
  );
}

module.exports = { ruleDcsolar };
