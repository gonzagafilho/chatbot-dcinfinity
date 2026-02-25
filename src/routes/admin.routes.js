"use strict";

const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const Admin = require("../models/Admin.js");
const Lead = require("../models/Lead.js");
const WaMessage = require("../models/WaMessage.js");

const router = express.Router();

// throttle simples para evitar spam de login
const loginThrottle = new Map();

function requireAdmin(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, error: "no_token" });

  try {
    const payload = jwt.verify(token, process.env.ADMIN_JWT_SECRET);
    req.admin = payload;
    return next();
  } catch {
    return res.status(401).json({ ok: false, error: "invalid_token" });
  }
}

function isSuperAdmin(req) {
  return String(req.admin?.role || "").toUpperCase() === "SUPERADMIN";
}

function normalizePhoneFromSession(sessionId) {
  return `web:${String(sessionId || "").trim()}`;
}

function normalizeMessageDoc(m) {
  // compat com histórico antigo: text/from/to/raw...
  const direction =
    m.direction ||
    (m.from && m.from !== "bot" ? "inbound" : "outbound");

  const body = m.body || m.text || "";

  const phone =
    m.phone ||
    (m.from && String(m.from).startsWith("web:") ? m.from : null) ||
    (m.to && String(m.to).startsWith("web:") ? m.to : null) ||
    "";

  return {
    _id: m._id,
    tenant: m.tenant,
    phone,
    direction,
    channel: m.channel || (phone.startsWith("web:") ? "web" : "whatsapp"),
    origin: m.origin || "web",
    body,
    intent: m.intent || null,
    createdAt: m.createdAt,
  };
}

/**
 * POST /api/admin/login
 */
router.post("/admin/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ ok: false, error: "email_senha_obrigatorios" });
  }

  // anti-spam (2s por ip/email)
  const key = `${req.ip}:${String(email).toLowerCase()}`;
  const last = loginThrottle.get(key) || 0;
  if (Date.now() - last < 2000) {
    return res.status(429).json({ ok: false, error: "too_many_requests" });
  }
  loginThrottle.set(key, Date.now());

  const admin = await Admin.findOne({ email, active: true }).lean();
  if (!admin) return res.status(401).json({ ok: false, error: "credenciais_invalidas" });

  const ok = await bcrypt.compare(password, admin.passwordHash);
  if (!ok) return res.status(401).json({ ok: false, error: "credenciais_invalidas" });

  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) return res.status(500).json({ ok: false, error: "admin_jwt_secret_missing" });

  const token = jwt.sign(
    { sub: String(admin._id), email: admin.email, role: admin.role || "ADMIN" },
    secret,
    { expiresIn: "7d" }
  );

  res.json({
    ok: true,
    token,
    admin: { email: admin.email, role: admin.role || "ADMIN" },
  });
});

/**
 * GET /api/admin/me
 */
router.get("/admin/me", requireAdmin, async (req, res) => {
  return res.json({ ok: true, admin: req.admin });
});
/**
 * POST /api/admin/password
 * body: { currentPassword, newPassword }
 */
router.post("/admin/password", requireAdmin, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ ok: false, error: "missing_passwords" });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ ok: false, error: "weak_password_min_8" });
    }

    const adminId = String((req.admin && req.admin.sub) || "");
    if (!adminId) {
      return res.status(401).json({ ok: false, error: "invalid_token_payload" });
    }

    const admin = await Admin.findById(adminId);
    if (!admin || !admin.active) {
      return res.status(404).json({ ok: false, error: "admin_not_found" });
    }

    const ok = await bcrypt.compare(String(currentPassword), admin.passwordHash);
    if (!ok) {
      return res.status(401).json({ ok: false, error: "invalid_current_password" });
    }

    admin.passwordHash = await bcrypt.hash(String(newPassword), 10);
    await admin.save();

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

/**
 * GET /api/admin/leads?tenant=dcsolar&limit=50&skip=0&status=handoff&q=joao
 */
router.get("/admin/leads", requireAdmin, async (req, res) => {
  const { tenant, status, q } = req.query;
  const limit = Math.min(Number(req.query.limit || 50), 200);
  const skip = Math.max(Number(req.query.skip || 0), 0);

  const where = {};
  if (tenant) where.tenant = String(tenant);
  if (status) where.status = String(status);

  if (q) {
    const qq = String(q);
    where.$or = [
      { phone: qq },
      { name: new RegExp(qq, "i") },
      { lastMessage: new RegExp(qq, "i") },
      { assignedToEmail: new RegExp(qq, "i") },
    ];
  }

  const [total, data] = await Promise.all([
    Lead.countDocuments(where),
    Lead.find(where).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
  ]);

  res.json({
    ok: true,
    data,
    page: { total, limit, skip, hasMore: skip + data.length < total },
  });
});

/**
 * GET /api/admin/conversations/:sessionId?tenant=dcsolar
 * Busca por phone = web:<sessionId>
 * Compatível com histórico antigo
 */
router.get("/admin/conversations/:sessionId", requireAdmin, async (req, res) => {
  const { sessionId } = req.params;
  const { tenant } = req.query;

  const phone = normalizePhoneFromSession(sessionId);

  const or = [
    { phone },
    { from: phone },
    { to: phone },
    { "raw.sessionId": String(sessionId) },
  ];

  const where = { $or: or };
  if (tenant) where.tenant = String(tenant);

  const msgsRaw = await WaMessage.find(where).sort({ createdAt: 1 }).limit(500).lean();
  const msgs = msgsRaw.map(normalizeMessageDoc);

  res.json({ ok: true, data: msgs });
});

/**
 * POST /api/admin/lead/assign
 * body: { tenant, sessionId?, phone?, mode }
 * mode: "take" (assumir) | "release" (liberar)
 */
router.post("/admin/lead/assign", requireAdmin, async (req, res) => {
  const tenant = String(req.body?.tenant || "").trim();
  const sessionId = String(req.body?.sessionId || "").trim();
  const phoneRaw = String(req.body?.phone || "").trim();
  const mode = String(req.body?.mode || "take").trim();

  if (!tenant) return res.status(400).json({ ok: false, error: "tenant_required" });

  const phone = phoneRaw ? phoneRaw : (sessionId ? `web:${sessionId}` : "");
  if (!phone) return res.status(400).json({ ok: false, error: "phone_or_sessionId_required" });

  const meId = String(req.admin?.sub || "");
  const meEmail = String(req.admin?.email || "");
  const superAdmin = isSuperAdmin(req);

  const lead = await Lead.findOne({ tenant, phone }).lean();

  if (mode === "take") {
  // se existe e tem dono diferente, bloqueia (exceto superAdmin)
  if (lead?.assignedTo && lead.assignedTo !== meId && !superAdmin) {
    return res.status(403).json({
      ok: false,
      error: "not_assigned_to_you",
      assignedToEmail: lead.assignedToEmail || null,
    });
  }

  const updated = await Lead.findOneAndUpdate(
    { tenant, phone },
    {
      $set: {
        status: "em_atendimento",
        assignedTo: meId,
        assignedToEmail: meEmail,
        assignedAt: new Date(),
        resolvedAt: null, // ✅ lugar certo
        updatedAt: new Date(),
      },
      $setOnInsert: {
        tenant,
        phone,
        origin: phone.startsWith("web:") ? "web" : "whatsapp",
        channel: phone.startsWith("web:") ? "web" : "whatsapp",
        createdAt: new Date(),
      },
    },
    { upsert: true, returnDocument: "after" }
  ).lean();

  await WaMessage.create({
    tenant,
    channel: phone.startsWith("web:") ? "web" : "whatsapp",
    origin: "admin_panel",
    direction: "system",
    phone,
    body: `ASSUMED_BY:${meEmail}`,
    raw: { type: "assign_take", by: meEmail },
  });

  return res.json({ ok: true, data: updated });
}

    if (mode === "release") {
    if (lead?.assignedTo && lead.assignedTo !== meId && !superAdmin) {
      return res.status(403).json({
        ok: false,
        error: "not_assigned_to_you",
        assignedToEmail: lead.assignedToEmail || null,
      });
    }

    const updated = await Lead.findOneAndUpdate(
      { tenant, phone },
      {
        $set: {
          status: "handoff",
          assignedTo: null,
          assignedToEmail: null,
          assignedAt: null,
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after" }
    ).lean();

    await WaMessage.create({
      tenant,
      channel: phone.startsWith("web:") ? "web" : "whatsapp",
      origin: "admin_panel",
      direction: "system",
      phone,
      body: `RELEASED_BY:${meEmail}`,
      raw: { type: "assign_release", by: meEmail },
    });

    return res.json({ ok: true, data: updated });
  }

  return res.status(400).json({ ok: false, error: "invalid_mode" });
});

/**
 * POST /api/admin/lead/status
 * body: { tenant, sessionId?, phone?, status }
 * status: novo | handoff | em_atendimento | resolvido
 * Regra: só dono ou superadmin
 */
router.post("/admin/lead/status", requireAdmin, async (req, res) => {
  const tenant = String(req.body?.tenant || "").trim();
  const sessionId = String(req.body?.sessionId || "").trim();
  const phoneRaw = String(req.body?.phone || "").trim();
  const status = String(req.body?.status || "").trim();

  const allowed = new Set(["novo", "handoff", "em_atendimento", "resolvido"]);
  if (!tenant) return res.status(400).json({ ok: false, error: "tenant_required" });
  if (!allowed.has(status)) return res.status(400).json({ ok: false, error: "invalid_status" });

  const phone = phoneRaw ? phoneRaw : (sessionId ? `web:${sessionId}` : "");
  if (!phone) return res.status(400).json({ ok: false, error: "phone_or_sessionId_required" });

  const meId = String(req.admin?.sub || "");
  const meEmail = String(req.admin?.email || "");
  const superAdmin = isSuperAdmin(req);

  const lead = await Lead.findOne({ tenant, phone }).lean();
  if (lead?.assignedTo && lead.assignedTo !== meId && !superAdmin) {
    return res.status(403).json({
      ok: false,
      error: "not_assigned_to_you",
      assignedToEmail: lead.assignedToEmail || null,
    });
  }

  const updated = await Lead.findOneAndUpdate(
    { tenant, phone },
    {
     $set: {
       status,
        resolvedAt: status === "resolvido" ? new Date() : null,
        updatedAt: new Date(),
     },
    },
    { upsert: true, returnDocument: "after" }
  ).lean();

  await WaMessage.create({
    tenant,
    channel: phone.startsWith("web:") ? "web" : "whatsapp",
    origin: "admin_panel",
    direction: "system",
    phone,
    body: `STATUS_CHANGED:${status}`,
    raw: { type: "status_change", by: meEmail, status },
  });

  return res.json({ ok: true, data: updated });
});

/**
 * POST /api/admin/send
 * body: { tenant, sessionId?, phone?, text }
 * Regra: só dono ou superadmin. Se não tiver dono, auto-assume.
 */
router.post("/admin/send", requireAdmin, async (req, res) => {
  const tenant = String(req.body?.tenant || "").trim();
  const sessionId = String(req.body?.sessionId || "").trim();
  const phoneRaw = String(req.body?.phone || "").trim();
  const text = String(req.body?.text || "").trim();

  if (!tenant) return res.status(400).json({ ok: false, error: "tenant_required" });
  if (!text) return res.status(400).json({ ok: false, error: "text_required" });

  const phone = phoneRaw ? phoneRaw : (sessionId ? `web:${sessionId}` : "");
  if (!phone) return res.status(400).json({ ok: false, error: "phone_or_sessionId_required" });

  const channel = phone.startsWith("web:") ? "web" : "whatsapp";

  const meId = String(req.admin?.sub || "");
  const meEmail = String(req.admin?.email || "");
  const superAdmin = isSuperAdmin(req);

  const lead = await Lead.findOne({ tenant, phone }).lean();

  // se já tem dono diferente, bloqueia (exceto super)
  if (lead?.assignedTo && lead.assignedTo !== meId && !superAdmin) {
    return res.status(403).json({
      ok: false,
      error: "not_assigned_to_you",
      assignedToEmail: lead.assignedToEmail || null,
    });
  }

  // auto-assume se estiver livre
  if (!lead?.assignedTo) {
    await Lead.findOneAndUpdate(
      { tenant, phone },
      {
        $set: {
          assignedTo: meId,
          assignedToEmail: meEmail,
          assignedAt: new Date(),
          status: "em_atendimento",
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
  }

  // grava outbound
  const msg = await WaMessage.create({
    tenant,
    channel,
    origin: "admin_panel",
    direction: "outbound",
    phone,
    body: text,
    raw: { via: "admin_panel" },
  });

  // atualiza lead (best effort)
  try {
    await Lead.findOneAndUpdate(
      { tenant, phone },
      {
        $set: {
          tenant,
          phone,
          channel,
          origin: channel,
          lastMessage: text,
          status: "em_atendimento",
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
  } catch (e) {
    console.log("⚠️ lead update failed (send):", e?.message);
  }

  return res.json({ ok: true, data: { id: String(msg._id), tenant, phone, body: text } });
});

module.exports = router;
