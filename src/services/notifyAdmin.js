const { sendWhatsAppText } = require("./whatsappSend");

// Número do admin (você) – pode colocar no .env também
const ADMIN_WA = (process.env.ADMIN_NOTIFY_WA || "5561999656269").trim();

// Anti-spam simples por sessão/telefone
const cooldown = new Map();
const COOLDOWN_MS = 2 * 60 * 1000;

function canNotify(key) {
  const now = Date.now();
  const last = cooldown.get(key) || 0;
  if (now - last < COOLDOWN_MS) return false;
  cooldown.set(key, now);
  return true;
}

async function notifyAdmin({ tenant, from, origin, message, sessionId }) {
  const key = `${tenant}:${from || sessionId || "unknown"}`;
  if (!canNotify(key)) return;

  const text =
    `🚨 *Novo pedido de atendente*\n` +
    `Empresa: *${tenant}*\n` +
    `Origem: ${origin || "web"}\n` +
    `Contato: ${from || "web (sem telefone)"}\n` +
    `Mensagem: ${message || "-"}\n` +
    `Data: ${new Date().toLocaleString("pt-BR")}`;

  try {
    await sendWhatsAppText(ADMIN_WA, text);
    console.log("✅ Admin notify sent");
  } catch (e) {
    console.error("❌ Admin notify error:", e?.message || e);
  }
}

module.exports = { notifyAdmin };
