const express = require("express");
const requireTenantUser = require("../middlewares/requireTenantUser.cjs");
const Lead = require("../models/Lead");
const WaMessage = require("../models/WaMessage");

const router = express.Router();

// POST /api/tenant/lead/assign
router.post("/lead/assign", requireTenantUser(), async (req, res) => {
  try {
    const tenant = req.tenantUser.tenant;
    const sessionId = String(req.body?.sessionId || "").trim();
    const phoneRaw = String(req.body?.phone || "").trim();
    const mode = String(req.body?.mode || "take").trim();

    const phone = phoneRaw ? phoneRaw : (sessionId ? `web:${sessionId}` : "");
    if (!phone) return res.status(400).json({ ok: false, error: "phone_or_sessionId_required" });

    const meId = String(req.tenantUser.id);
    const meEmail = String(req.tenantUser.email);

    const lead = await Lead.findOne({ tenant, phone }).lean();

    if (mode === "take") {
      // lock: se tem dono diferente, bloqueia
      if (lead?.assignedTo && String(lead.assignedTo) !== meId) {
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
            resolvedAt: null,
            updatedAt: new Date(),
          },
          $setOnInsert: {
            tenant,
            phone,
            createdAt: new Date(),
          },
        },
        { upsert: true, returnDocument: "after" }
      ).lean();

      await WaMessage.create({
        tenant,
        channel: phone.startsWith("web:") ? "web" : "whatsapp",
        origin: "tenant_panel",
        direction: "system",
        phone,
        body: `ASSUMED_BY:${meEmail}`,
        raw: { type: "assign_take", by: meEmail },
      });

      return res.json({ ok: true, data: updated });
    }

    if (mode === "release") {
      if (lead?.assignedTo && String(lead.assignedTo) !== meId) {
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
        origin: "tenant_panel",
        direction: "system",
        phone,
        body: `RELEASED_BY:${meEmail}`,
        raw: { type: "assign_release", by: meEmail },
      });

      return res.json({ ok: true, data: updated });
    }

    return res.status(400).json({ ok: false, error: "invalid_mode" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// POST /api/tenant/send
router.post("/send", requireTenantUser(), async (req, res) => {
  try {
    const tenant = req.tenantUser.tenant;
    const sessionId = String(req.body?.sessionId || "").trim();
    const phoneRaw = String(req.body?.phone || "").trim();
    const message = String(req.body?.message || "").trim();

    if (!message) return res.status(400).json({ ok: false, error: "message_required" });

    const phone = phoneRaw ? phoneRaw : (sessionId ? `web:${sessionId}` : "");
    if (!phone) return res.status(400).json({ ok: false, error: "phone_or_sessionId_required" });

    const meId = String(req.tenantUser.id);
    const meEmail = String(req.tenantUser.email);

    const lead = await Lead.findOne({ tenant, phone }).lean();

    // lock: se tem dono diferente, bloqueia
    if (lead?.assignedTo && String(lead.assignedTo) !== meId) {
      return res.status(403).json({
        ok: false,
        error: "not_assigned_to_you",
        assignedToEmail: lead.assignedToEmail || null,
      });
    }

    // se lead livre ou não existe: assume automaticamente
    const updated = await Lead.findOneAndUpdate(
      { tenant, phone },
      {
        $set: {
          status: "em_atendimento",
          assignedTo: meId,
          assignedToEmail: meEmail,
          assignedAt: lead?.assignedAt || new Date(),
          resolvedAt: null,
          lastMessage: message,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          tenant,
          phone,
          createdAt: new Date(),
        },
      },
      { upsert: true, returnDocument: "after" }
    ).lean();

    // grava outbound
    await WaMessage.create({
      tenant,
      channel: phone.startsWith("web:") ? "web" : "whatsapp",
      origin: "tenant_panel",
      direction: "outbound",
      phone,
      body: message,
      raw: { type: "tenant_send", by: meEmail },
    });

    // OBS: no canal web, hoje não existe “push” pro widget, então a mensagem fica no histórico.
    return res.json({ ok: true, data: updated });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});
// GET /api/tenant/leads
router.get("/leads", requireTenantUser(), async (req, res) => {
  try {
    const tenant = req.tenantUser.tenant;

    const status = String(req.query?.status || "").trim(); // opcional
    const q = String(req.query?.q || "").trim();           // opcional (busca simples)

    const filter = { tenant };

    if (status) filter.status = status;

    // busca simples por phone ou lastMessage
    if (q) {
      filter.$or = [
        { phone: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
        { lastMessage: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
        { name: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
      ];
    }

    const leads = await Lead.find(filter)
      .sort({ updatedAt: -1 })
      .limit(200)
      .lean();

    return res.json({ ok: true, leads });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// GET /api/tenant/messages?phone=web:xxx
router.get("/messages", requireTenantUser(), async (req, res) => {
  try {
    const tenant = req.tenantUser.tenant;
    const phone = String(req.query?.phone || "").trim();

    if (!phone) return res.status(400).json({ ok: false, error: "phone_required" });

    const limitRaw = Number(req.query?.limit || 200);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 200;

        const rows = await WaMessage.find({ tenant, phone })
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean();

    const messages = rows.map((m) => ({
      _id: m._id,
      tenant: m.tenant,
      phone: m.phone || m.from || phone,
      channel: m.channel,
      origin: m.origin,
      direction: m.direction,
      body: m.body ?? m.text ?? "",
      raw: m.raw || null,
      createdAt: m.createdAt,
    }));

    return res.json({ ok: true, messages });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

module.exports = router;