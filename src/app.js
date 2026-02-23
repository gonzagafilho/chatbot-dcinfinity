"use strict";

const express = require("express");
const path = require("path");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const tenantMiddleware = require("./middlewares/tenantMiddleware");

// Rotas
const whatsappWebhook = require("./routes/whatsappWebhook");
const chatRoutes = require("./routes/chat.routes");
const handoffRoutes = require("./routes/handoff.routes");
const adminRoutes = require("./routes/admin.routes");


const app = express();

// Trust proxy (Nginx)
app.set("trust proxy", 1);

// Segurança básica
app.use(helmet());

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

// ✅ Widget público (IMPORTANTE: esse caminho é a raiz do projeto /public/widget)
app.use("/widget", express.static(path.join(__dirname, "..", "public", "widget")));
  // admin panel (static)
  app.use("/admin", express.static(path.join(__dirname, "..", "public", "admin")));
  app.get("/admin", (req, res) => res.redirect("/admin/"));


// Tenant middleware antes das APIs
app.use(tenantMiddleware);

// Rotas
app.use(whatsappWebhook);        // /webhook/whatsapp
app.use("/api", chatRoutes);     // /api/chat
app.use("/api", handoffRoutes);
app.use("/api", adminRoutes);


module.exports = app;
