// @ts-nocheck
"use strict";

const express = require("express");
const path = require("path");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const tenantChatRoutes = require("./routes/tenantChat.routes.cjs");
const adminTenantsRoutes = require("./routes/adminTenants.routes");

const tenantMiddleware = require("./middlewares/tenantMiddleware");

// Rotas
const whatsappWebhook = require("./routes/whatsappWebhook");
const chatRoutes = require("./routes/chat.routes");
const handoffRoutes = require("./routes/handoff.routes");
const adminRoutes = require("./routes/admin.routes");
const chatbotAdminRoutes = require("./routes/chatbotAdmin.routes");
const chatbotAdminLogsRealRoutes = require("./routes/chatbotAdmin.logsReal.route");
const tenantAuthRoutes = require("./routes/tenantAuth.routes.cjs");
const tenantUsersRoutes = require("./routes/tenantUsers.routes.cjs");

const app = express();

// Trust proxy (Nginx)
app.set("trust proxy", 1);

// Segurança básica (+ Google Maps no painel /chatbot-admin/)
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://maps.googleapis.com", "https://maps.gstatic.com"],
        connectSrc: ["'self'", "https://maps.googleapis.com", "https://maps.gstatic.com"],
        imgSrc: [
          "'self'",
          "data:",
          "blob:",
          "https://maps.gstatic.com",
          "https://maps.googleapis.com",
          "https://*.googleapis.com",
          "https://*.gstatic.com",
          "https://*.google.com",
          "https://*.googleusercontent.com",
          "https:", // demais imagens (URLs de campanha / link externo) sem quebrar o painel
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com",
          "https://maps.googleapis.com",
        ],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        frameSrc: ["'self'", "https://www.google.com"],
        workerSrc: ["'self'", "blob:"],
      },
    },
  })
);

// Body parser
app.use(express.json({ limit: "2mb" }));

// CORS
const originsEnv = process.env.CORS_ORIGINS || "";
const originList = originsEnv
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: function (origin, cb) {
      // permite curl/postman sem origin
      if (!origin) return cb(null, true);
      if (originList.length === 0) return cb(null, true);
      if (originList.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS: " + origin));
    },
    credentials: true,
  })
);

// Rate limit geral
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// Health
app.get("/health", (req, res) => {
  res.json({ ok: true, service: "chatbot-dcinfinity" });
});

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Página leve com Open Graph para link preview da abertura comercial DC NET no WhatsApp */
app.get("/dcnet", (req, res) => {
  const proto = (req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim();
  const host = req.get("host") || "";
  const base = (process.env.PUBLIC_APP_BASE_URL || `${proto}://${host}`).replace(/\/$/, "");
  const pageUrl = `${base}/dcnet`;
  const title = "DC NET - Internet Fibra";
  const desc =
    "Internet rápida, estável e com suporte de verdade para sua casa ou empresa.";
  const ogImage = (
    process.env.DCNET_PREVIEW_OG_IMAGE_URL ||
    process.env.DCNET_WHATSAPP_COMMERCIAL_IMAGE_URL ||
    `${base}/assets/dcnet-logo.png.jpeg`
  ).trim();
  res.type("html");
  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${escapeHtml(pageUrl)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(desc)}">
<meta property="og:image" content="${escapeHtml(ogImage)}">
</head>
<body>
<main>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(desc)}</p>
</main>
</body>
</html>`);
});

app.use("/assets", express.static(path.join(__dirname, "..", "public", "assets")));
// uploads gerados pelo painel (ex.: campanhas)
app.use("/uploads", express.static(path.join(__dirname, "..", "public", "uploads")));

// ✅ Widget público (IMPORTANTE: esse caminho é a raiz do projeto /public/widget)
  app.use("/widget", express.static(path.join(__dirname, "..", "public", "widget")));
  // admin panel (static)
  app.use("/admin", express.static(path.join(__dirname, "..", "public", "admin")));
  app.get("/admin", (req, res) => res.redirect("/admin/"));
  // painel de conteúdo do chatbot (separado do /admin de atendimento)
  app.use("/chatbot-admin", express.static(path.join(__dirname, "..", "public", "chatbot-admin")));
  app.get("/chatbot-admin", (req, res) => res.redirect("/chatbot-admin/"));
  // tenant panel (static)
  app.use("/tenant", express.static(path.join(__dirname, "..", "public", "tenant")));
  app.get("/tenant", (req, res) => res.redirect("/tenant/"));


// Tenant middleware antes das APIs
app.use(tenantMiddleware);

// Rotas
app.use(whatsappWebhook);        // /webhook/whatsapp
app.use("/api", chatRoutes);     // /api/chat
app.use("/api", handoffRoutes);
app.use("/api", adminRoutes);
app.use("/api", adminTenantsRoutes); // ✅ novo
app.use("/api", chatbotAdminRoutes);
app.use("/api", chatbotAdminLogsRealRoutes);

app.use("/api/tenant", tenantAuthRoutes);          // login, me
app.use("/api/tenant", tenantChatRoutes);          // leads, messages, assign, send
app.use("/api/tenant/users", tenantUsersRoutes);   // CRUD users


module.exports = app;
