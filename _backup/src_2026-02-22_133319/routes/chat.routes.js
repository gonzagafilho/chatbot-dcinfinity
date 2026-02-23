const router = require("express").Router();
const { replyFromRules } = require("../services/rules");

router.post("/chat", (req, res) => {
  // ✅ vem do tenantMiddleware (por header X-Tenant-Id, body.tenant, ou domínio)
  const tenant = req.tenant || "dcnet";
  const originHeader = req.origin || null;

  // ✅ payload do webchat
  const message = String(req.body?.message || "").trim();
  const name = String(req.body?.name || "").trim();
  const phone = String(req.body?.phone || "").trim();
  const neighborhood = String(req.body?.neighborhood || "").trim();
  const plan = String(req.body?.plan || "").trim();

  // se o frontend mandar origin/page manualmente ainda, ok, mas não sobrescreve header
  const originBody = String(req.body?.origin || "").trim();
  const page = String(req.body?.page || "").trim();

  // ✅ origin final (prioriza o header do middleware)
  const origin = originHeader || originBody || null;

  if (!message) {
    return res.status(400).json({ ok: false, reply: "Envie uma mensagem." });
  }

  // ✅ passa tenant pra regras (para roteamento por site/painel)
  const result = replyFromRules({
    tenant,
    message,
    name,
    phone,
    neighborhood,
    plan,
    origin,
    page,
  });

  const reply =
    typeof result === "string"
      ? result
      : (result?.reply || "Desculpa, tive um problema interno. Tente novamente.");

  return res.json({
    ok: true,
    reply,
    intent: result?.intent || "fallback",
    handoff: result?.handoff || null,
    lead: result?.lead || null,
    tenant, // ✅ devolve pra debug
    meta: { origin: origin || null, page: page || null },
  });
});

module.exports = router;
