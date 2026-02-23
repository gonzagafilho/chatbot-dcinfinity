require("dotenv").config({ override: true });

const path = require("path");
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const connectDB = require("./config/db");
connectDB();

const chatRoutes = require("./routes/chat.routes");
const whatsappWebhook = require("./routes/whatsappWebhook");
const adminRoutes = require("./routes/admin.routes"); // ✅ IMPORTANTE
const tenantMiddleware = require("./middlewares/tenantMiddleware");

const app = express();
app.set("trust proxy", 1);

// 1) body parser
app.use(express.json({ limit: "250kb" }));

// 2) tenant middleware
app.use(tenantMiddleware);

// 3) CORS
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: function (origin, cb) {
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.length === 0) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

// 4) rate limit
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// HEALTH CHECK
app.get("/health", (req, res) => {
  res.json({ ok: true, service: "chatbot-dcinfinity" });
});

// ==========================
// STATIC FILES
// ==========================

// Widget
app.use(
  "/widget",
  express.static(path.join(__dirname, "..", "public", "widget"))
);

// Admin Panel
app.use(
  "/admin",
  express.static(path.join(__dirname, "..", "public", "admin"), {
    maxAge: "5m",
    etag: true,
  })
);

app.get("/admin", (req, res) => {
  res.redirect("/admin/");
});

// ==========================
// API ROUTES
// ==========================

// WhatsApp webhook
app.use(whatsappWebhook);

// Chat API
app.use("/api", chatRoutes);

// ✅ Admin API
app.use("/api", adminRoutes);

module.exports = app;