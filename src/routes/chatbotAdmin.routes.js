"use strict";

const express = require("express");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const sharp = require("sharp");
const multer = require("multer");
const mongoose = require("mongoose");
const requireAdminAuth = require("../middlewares/requireAdmin");
const {
  getConfigForTenant,
  patchConfigForTenant,
  MERGE_KEYS,
} = require("../services/chatbotContentConfigService");
const {
  previewBroadcast,
  sendTestBroadcast,
  sendTestBroadcastTemplate,
  createBroadcastJob,
  getJobById,
  setJobStatus,
} = require("../services/maintenanceBroadcastService");
const MaintenanceBroadcastJob = require("../models/MaintenanceBroadcastJob");
const CoverageArea = require("../models/CoverageArea");
const Lead = require("../models/Lead");
const CampaignExecutionLog = require("../models/CampaignExecutionLog");
const WaMessage = require("../models/WaMessage");
const { sendWhatsAppText, sendWhatsAppImage, sendWhatsAppMedia, sendWhatsAppTemplate, translateMetaError } = require("../services/whatsappSend");
const {
  syncMetaTemplates,
  listTemplates,
  sendTemplateSmart,
  metaDashboard,
  metaHistory,
  buildComponentsFromTemplate,
} = require("../services/metaTemplateService");

const dcnetOperationalAi = require("../services/ai/dcnetOperationalAiService");

const {
  runSeasonalCampaigns,
} = require("../jobs/seasonalCampaignScheduler");

const router = express.Router();

let seasonalCampaignRunning = false;

const UPLOAD_DIR = path.join(__dirname, "..", "..", "public", "uploads", "campaigns");
const AVATAR_UPLOAD_DIR = path.join(__dirname, "..", "..", "public", "uploads", "avatars");
const CONVERSATION_UPLOAD_DIR = path.join(__dirname, "..", "..", "public", "uploads", "conversations");
const MulterError = multer.MulterError;

/** mimetype → extensões permitidas no nome do arquivo (validação em dupla) */
const CAMPAIGN_IMAGE_ALLOW = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
};

const CONVERSATION_ATTACHMENT_ALLOW = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/webm",
  "video/mp4",
  "video/webm",
]);

function slugifyOriginalName(name) {
  const base = path.basename(String(name || "image"));
  const noExt = base.replace(/\.[^.]+$/, "");
  const s = noExt
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return s || "image";
}

function extForMimetype(mime) {
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  return null;
}

function verifyImageMagicBytes(filePath) {
  const buf = Buffer.alloc(16);
  const fd = fs.openSync(filePath, "r");
  try {
    const n = fs.readSync(fd, buf, 0, 16, 0);
    if (n < 12) return null;
  } finally {
    fs.closeSync(fd);
  }
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "image/png";
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

const campaignImageStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    try {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    } catch (e) {
      return cb(e);
    }
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = Date.now() + ext;
    cb(null, safeName);
  },
});

const campaignImageUpload = multer({
  storage: campaignImageStorage,
  limits: {
    // Limite de upload *antes* da compressão; saída fica <800KB (JPEG) para WhatsApp
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: function (req, file, cb) {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Apenas imagens permitidas"));
    }
    cb(null, true);
  },
});

const avatarImageStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    try {
      fs.mkdirSync(AVATAR_UPLOAD_DIR, { recursive: true });
    } catch (e) {
      return cb(e);
    }
    cb(null, AVATAR_UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = "avatar-" + Date.now() + "-" + Math.random().toString(16).slice(2, 8) + ext;
    cb(null, safeName);
  },
});

const avatarImageUpload = multer({
  storage: avatarImageStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    if (!file.mimetype.startsWith("image/")) return cb(new Error("Apenas imagens permitidas"));
    cb(null, true);
  },
});

const conversationAttachmentStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    try {
      fs.mkdirSync(CONVERSATION_UPLOAD_DIR, { recursive: true });
    } catch (e) {
      return cb(e);
    }
    cb(null, CONVERSATION_UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".bin";
    const safeBase = slugifyOriginalName(file.originalname || "anexo");
    cb(null, "conversation-" + Date.now() + "-" + Math.random().toString(16).slice(2, 8) + "-" + safeBase + ext);
  },
});

const conversationAttachmentUpload = multer({
  storage: conversationAttachmentStorage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    if (!CONVERSATION_ATTACHMENT_ALLOW.has(String(file.mimetype || ""))) return cb(new Error("type_not_allowed"));
    cb(null, true);
  },
});

function conversationAttachmentUploadHandler(req, res, next) {
  conversationAttachmentUpload.single("file")(req, res, function (err) {
    if (err) {
      if (err instanceof MulterError && err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ ok: false, error: "file_too_large" });
      return res.status(400).json({ ok: false, error: err.message || "upload_error" });
    }
    next();
  });
}

function conversationMediaTypeFromMime(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("video/")) return "video";
  return "document";
}

function avatarImageUploadHandler(req, res, next) {
  avatarImageUpload.single("file")(req, res, function (err) {
    if (err) {
      if (err instanceof MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ ok: false, error: "file_too_large" });
        return res.status(400).json({ ok: false, error: "upload_rejected" });
      }
      return res.status(400).json({ ok: false, error: "upload_error" });
    }
    next();
  });
}

function campaignImageUploadHandler(req, res, next) {
  campaignImageUpload.single("file")(req, res, function (err) {
    if (err) {
      if (err instanceof MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({ ok: false, error: "file_too_large" });
        }
        return res.status(400).json({ ok: false, error: "upload_rejected" });
      }
      const code = err.message || "upload_error";
      if (code === "type_not_allowed" || code === "ext_not_allowed") {
        return res.status(400).json({ ok: false, error: code });
      }
      return res.status(400).json({ ok: false, error: "upload_error" });
    }
    next();
  });
}

function publicBaseUrl(req) {
  const raw = (req.get("x-forwarded-proto") || req.protocol || "https") + "";
  const proto = raw.split(",")[0].trim();
  const host = req.get("host") || "";
  const fallback = host && !/^127\.0\.0\.1|localhost/i.test(host) ? proto + "://" + host : "https://chatbot.dcinfinity.net.br";
  return (process.env.PUBLIC_APP_BASE_URL || fallback).replace(/\/$/, "");
}

/**
 * POST /api/chatbot-admin/uploads/campaign-image
 * Multipart field: file (png/jpeg/webp, até 5MB no upload; comprimido a JPEG ~700KB). JWT admin obrigatório.
 */
router.post(
  "/chatbot-admin/uploads/campaign-image",
  requireAdminAuth,
  campaignImageUploadHandler,
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "file_required" });
    }
    const byMagic = verifyImageMagicBytes(req.file.path);
    if (!byMagic || byMagic !== req.file.mimetype) {
      try {
        await fsp.unlink(req.file.path);
      } catch (e) {
        /* ignore */
      }
      return res.status(400).json({ ok: false, error: "invalid_image" });
    }

    const filePath = path.join(UPLOAD_DIR, req.file.filename);

    try {
      const tempPath = filePath + "_tmp.jpg";

      await sharp(filePath)
        .resize({ width: 1000 })
        .jpeg({
          quality: 70,
          chromaSubsampling: "4:2:0",
        })
        .toFile(tempPath);

      fs.unlinkSync(filePath);
      fs.renameSync(tempPath, filePath);

      const jpgName = path.basename(filePath).replace(/\.[^.]+$/, ".jpg");
      const jpgPath = path.join(UPLOAD_DIR, jpgName);
      if (jpgPath !== filePath) {
        fs.renameSync(filePath, jpgPath);
      }
      req.file.path = jpgPath;
      req.file.filename = jpgName;
      req.file.mimetype = "image/jpeg";
      try {
        const st = fs.statSync(req.file.path);
        req.file.size = st.size;
      } catch (e) {
        /* ignore */
      }

      console.log("Imagem comprimida forte (~700KB):", req.file.filename);
    } catch (err) {
      console.error("Erro ao comprimir imagem:", err.message);
    }

    const base = publicBaseUrl(req);
    const publicUrl = base + "/uploads/campaigns/" + encodeURIComponent(req.file.filename);
    return res.json({
      ok: true,
      url: publicUrl,
    });
  }
);

function normalizeTenantParam(v) {
  return String(v || "dcnet")
    .trim()
    .toLowerCase();
}

function pickAllowedPatch(body) {
  const out = {};
  if (!body || typeof body !== "object") return out;
  for (const k of MERGE_KEYS) {
    if (body[k] != null && typeof body[k] === "object" && !Array.isArray(body[k])) {
      out[k] = body[k];
    }
  }
  const topLevelCommercialKeys = [
    "commercialPlanFlyerEnabled",
    "commercialPlanFlyerImageUrl",
    "commercialPlanFlyerCaption",
  ];
  for (const k of topLevelCommercialKeys) {
    if (body[k] !== undefined) out[k] = body[k];
  }
  return out;
}

/**
 * GET /api/chatbot-admin/me
 * Mesmo JWT do admin de atendimento; rota separada do /api/admin/me.
 */
router.get("/chatbot-admin/me", requireAdminAuth, (req, res) => {
  const a = req.admin || {};
  res.json({
    ok: true,
    admin: {
      id: String(a._id || ""),
      email: a.email || "",
      role: a.role || "ADMIN",
    },
  });
});

/**
 * GET /api/chatbot-admin/automation/status
 */
router.get("/chatbot-admin/automation/status", requireAdminAuth, async (req, res) => {
  try {
    const total = await Lead.countDocuments({ tenant: "dcnet" });

    const active = await Lead.countDocuments({
      tenant: "dcnet",
      status: { $ne: "inactive" },
    });

    const inactive = await Lead.countDocuments({
      tenant: "dcnet",
      status: "inactive",
    });

    const optOut = await Lead.countDocuments({
      tenant: "dcnet",
      campaignOptIn: false,
    });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const campaignLogsToday = await CampaignExecutionLog.find({
      tenant: "dcnet",
      executedAt: { $gte: todayStart, $lt: todayEnd },
    })
      .sort({ executedAt: -1 })
      .limit(50)
      .lean();

    const campaignsToday = campaignLogsToday.reduce(
      (acc, item) => {
        acc.executions += 1;
        acc.totalProcessed += Number(item.totalProcessed || 0);
        acc.totalSent += Number(item.totalSent || 0);
        acc.totalFailed += Number(item.totalFailed || 0);
        acc.totalSkipped += Number(item.totalSkipped || 0);
        return acc;
      },
      {
        executions: 0,
        totalProcessed: 0,
        totalSent: 0,
        totalFailed: 0,
        totalSkipped: 0,
      }
    );

    const latestCampaignLogs = await CampaignExecutionLog.find({
      tenant: "dcnet",
    })
      .sort({ executedAt: -1 })
      .limit(20)
      .lean();

    return res.json({
      ok: true,

      billing: {
        enabled: String(process.env.BILLING_REMINDER_ENABLED || "false").toLowerCase() === "true",
        mode: String(process.env.BILLING_REMINDER_MODE || "test"),
        maxSends: Number(process.env.BILLING_REMINDER_MAX_SENDS || 5),
        cron: "0 9 * * *",
      },

      seasonalCampaign: {
        enabled: String(process.env.SEASONAL_CAMPAIGN_ENABLED || "false").toLowerCase() === "true",
        mode: String(process.env.SEASONAL_CAMPAIGN_MODE || "test"),
        maxSends: Number(process.env.SEASONAL_CAMPAIGN_MAX_SENDS || 5),
        cron: "0 8 * * *",
      },

      sync: {
        enabled: true,
        cron: "0 2 * * *",
      },

      leads: {
        total,
        active,
        inactive,
        optOut,
      },

      campaignHistory: {
        today: campaignsToday,
        latest: latestCampaignLogs.map((item) => ({
          id: String(item._id),
          tenant: item.tenant || "dcnet",
          type: item.type || "",
          campaignKey: item.campaignKey || "",
          totalProcessed: Number(item.totalProcessed || 0),
          totalSent: Number(item.totalSent || 0),
          totalFailed: Number(item.totalFailed || 0),
          totalSkipped: Number(item.totalSkipped || 0),
          imageUrl: item.imageUrl || "",
          mode: item.mode || "",
          executedAt: item.executedAt,
          createdAt: item.createdAt,
        })),
      },
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: String(e?.message || e),
    });
  }
});


/**
 * POST /api/chatbot-admin/conversations/:phone/avatar
 * Multipart field: file. Salva foto do cliente em public/uploads/avatars e persiste no Lead.
 */
router.post(
  "/chatbot-admin/conversations/:phone/avatar",
  requireAdminAuth,
  avatarImageUploadHandler,
  async (req, res) => {
    try {
      const tenant = normalizeTenantParam(req.body?.tenant || req.query.tenant);
      const phone = normalizeConversationPhone(req.params.phone);
      if (!phone) return res.status(400).json({ ok: false, error: "phone_required" });
      if (!req.file) return res.status(400).json({ ok: false, error: "file_required" });

      const byMagic = verifyImageMagicBytes(req.file.path);
      if (!byMagic || byMagic !== req.file.mimetype) {
        try { await fsp.unlink(req.file.path); } catch (e) { /* ignore */ }
        return res.status(400).json({ ok: false, error: "invalid_image" });
      }

      const filePath = path.join(AVATAR_UPLOAD_DIR, req.file.filename);
      const jpgName = path.basename(filePath).replace(/\.[^.]+$/, ".jpg");
      const jpgPath = path.join(AVATAR_UPLOAD_DIR, jpgName);
      const tmpPath = filePath + "_tmp.jpg";

      await sharp(filePath)
        .resize({ width: 512, height: 512, fit: "cover" })
        .jpeg({ quality: 82, chromaSubsampling: "4:2:0" })
        .toFile(tmpPath);
      try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
      fs.renameSync(tmpPath, jpgPath);

      const base = publicBaseUrl(req);
      const publicUrl = base + "/uploads/avatars/" + encodeURIComponent(jpgName);
      const by = req.admin?.email || String(req.admin?._id || "");
      const lead = await Lead.findOneAndUpdate(
        { tenant, phone },
        {
          $set: { avatarUrl: publicUrl, profilePhotoUrl: publicUrl, updatedAt: new Date() },
          $push: { timelineEvents: { type: "avatar_upload", label: "Foto do cliente atualizada", by, at: new Date() } },
          $setOnInsert: { tenant, phone, channel: "whatsapp", origin: "whatsapp" }
        },
        { upsert: true, new: true }
      ).lean();

      return res.json({ ok: true, url: publicUrl, avatarUrl: publicUrl, profilePhotoUrl: publicUrl, lead: conversationLeadPayload(lead) });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }
);

/**
 * GET /api/chatbot-admin/config?tenant=dcnet
 */
router.get("/chatbot-admin/config", requireAdminAuth, async (req, res) => {
  try {
    const tenant = normalizeTenantParam(req.query.tenant);
    const config = await getConfigForTenant(tenant);
    res.json({ ok: true, config });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * PATCH /api/chatbot-admin/config
 * body: { tenant, campaigns?, campaignTexts?, campaignActive?, operationalMessages?, maintenance? }
 */
router.patch("/chatbot-admin/config", requireAdminAuth, async (req, res) => {
  try {
    const tenant = normalizeTenantParam(req.body?.tenant || req.query?.tenant);
    if (!tenant) {
      return res.status(400).json({ ok: false, error: "tenant_required" });
    }
    const patch = pickAllowedPatch(req.body);
    if (!Object.keys(patch).length) {
      return res.status(400).json({ ok: false, error: "empty_patch" });
    }
    const config = await patchConfigForTenant(tenant, patch);
    res.json({ ok: true, config });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * GET /api/chatbot-admin/coverage-areas?tenant=dcnet
 * Lista áreas de cobertura GPS (sempre filtrado por tenant).
 */
router.get("/chatbot-admin/coverage-areas", requireAdminAuth, async (req, res) => {
  try {
    const tenant = normalizeTenantParam(req.query.tenant);
    if (!tenant) {
      return res.status(400).json({ ok: false, error: "tenant_required" });
    }
    const areas = await CoverageArea.find({ tenant })
      .sort({ active: -1, updatedAt: -1 })
      .lean();
    res.json({ ok: true, areas });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * POST /api/chatbot-admin/coverage-areas
 */
router.post("/chatbot-admin/coverage-areas", requireAdminAuth, async (req, res) => {
  try {
    const tenant = normalizeTenantParam(req.body?.tenant);
    if (!tenant) {
      return res.status(400).json({ ok: false, error: "tenant_required" });
    }
    const name = String(req.body?.name != null ? req.body.name : "").trim();
    const centerLat = Number(req.body?.centerLat);
    const centerLng = Number(req.body?.centerLng);
    const radiusMeters = Number(req.body?.radiusMeters);
    const active = req.body?.active === false ? false : true;
    const notes = String(req.body?.notes != null ? req.body.notes : "");
    if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng)) {
      return res.status(400).json({ ok: false, error: "invalid_coordinates" });
    }
    if (!Number.isFinite(radiusMeters) || radiusMeters < 1) {
      return res.status(400).json({ ok: false, error: "invalid_radius" });
    }
    const area = await CoverageArea.create({
      tenant,
      name,
      centerLat,
      centerLng,
      radiusMeters,
      active,
      notes,
    });
    res.json({ ok: true, area });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * PATCH /api/chatbot-admin/coverage-areas/:id
 * Atualiza apenas se o :id pertencer ao tenant indicado.
 */
router.patch("/chatbot-admin/coverage-areas/:id", requireAdminAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ ok: false, error: "invalid_id" });
    }
    const tenant = normalizeTenantParam(req.body?.tenant);
    if (!tenant) {
      return res.status(400).json({ ok: false, error: "tenant_required" });
    }
    const existing = await CoverageArea.findOne({ _id: req.params.id, tenant }).lean();
    if (!existing) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }
    const $set = {};
    if (req.body.name != null) $set.name = String(req.body.name).trim();
    if (req.body.centerLat != null) {
      const v = Number(req.body.centerLat);
      if (!Number.isFinite(v)) {
        return res.status(400).json({ ok: false, error: "invalid_centerLat" });
      }
      $set.centerLat = v;
    }
    if (req.body.centerLng != null) {
      const v = Number(req.body.centerLng);
      if (!Number.isFinite(v)) {
        return res.status(400).json({ ok: false, error: "invalid_centerLng" });
      }
      $set.centerLng = v;
    }
    if (req.body.radiusMeters != null) {
      const v = Number(req.body.radiusMeters);
      if (!Number.isFinite(v) || v < 1) {
        return res.status(400).json({ ok: false, error: "invalid_radius" });
      }
      $set.radiusMeters = v;
    }
    if (req.body.active != null) $set.active = Boolean(req.body.active);
    if (req.body.notes != null) $set.notes = String(req.body.notes);
    if (Object.keys($set).length === 0) {
      return res.status(400).json({ ok: false, error: "empty_patch" });
    }
    const area = await CoverageArea.findOneAndUpdate(
      { _id: req.params.id, tenant },
      { $set },
      { new: true, runValidators: true }
    ).lean();
    if (!area) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }
    res.json({ ok: true, area });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * DELETE /api/chatbot-admin/coverage-areas/:id?tenant=dcnet
 * Desativa a área (não apaga o documento).
 */
router.delete("/chatbot-admin/coverage-areas/:id", requireAdminAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ ok: false, error: "invalid_id" });
    }
    const tenant = normalizeTenantParam(req.query.tenant);
    if (!tenant) {
      return res.status(400).json({ ok: false, error: "tenant_required" });
    }
    const area = await CoverageArea.findOneAndUpdate(
      { _id: req.params.id, tenant },
      { $set: { active: false } },
      { new: true }
    ).lean();
    if (!area) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }
    res.json({ ok: true, area });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * GET /api/chatbot-admin/broadcast/overview
 * Métricas agregadas + histórico (20 últimas campanhas, sem fila de telefones).
 */
router.get("/chatbot-admin/broadcast/overview", requireAdminAuth, async (req, res) => {
  try {
    const totalJobs = await MaintenanceBroadcastJob.countDocuments();
    const agg = await MaintenanceBroadcastJob.aggregate([
      {
        $addFields: {
          sc: { $ifNull: ["$sentCount", "$totalSent"] },
          fc: { $ifNull: ["$failedCount", "$totalFailed"] },
        },
      },
      {
        $group: {
          _id: null,
          totalSent: { $sum: { $ifNull: ["$sc", 0] } },
          totalFailed: { $sum: { $ifNull: ["$fc", 0] } },
        },
      },
    ]);
    const totalSent = (agg[0] && agg[0].totalSent) || 0;
    const totalFailed = (agg[0] && agg[0].totalFailed) || 0;
    const denom = totalSent + totalFailed;
    const successRate = denom > 0 ? Math.round((totalSent / denom) * 100) : 0;
    const jobs = await MaintenanceBroadcastJob.find({})
      .select("-phoneQueue -composedText")
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
    res.json({
      ok: true,
      stats: {
        totalJobs,
        totalSent,
        totalFailed,
        successRate,
      },
      jobs,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/* --- Manutenção em massa BeesWeb (fila + worker) --- */

/**
 * POST /api/chatbot-admin/maintenance-broadcast/preview
 */
router.post("/chatbot-admin/maintenance-broadcast/preview", requireAdminAuth, async (req, res) => {
  try {
    const email = (req.admin && req.admin.email) || "";
    console.log("[chatbot-admin/maintenance-broadcast/preview]", {
      at: new Date().toISOString(),
      admin: email,
    });
    const r = await previewBroadcast(req.body);
    if (r.ok === false) {
      const code = r.error === "beesweb_not_configured" ? 503 : 400;
      return res.status(code).json({ ok: false, error: r.error });
    }
    res.json(r);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * POST /api/chatbot-admin/maintenance-broadcast/test
 * Envia uma única mensagem real para testPhone (não cria lote).
 */
router.post("/chatbot-admin/maintenance-broadcast/test", requireAdminAuth, async (req, res) => {
  try {
    const r = await sendTestBroadcast(req.body, (req.admin && req.admin.email) || "");
    if (r.err) {
      return res.status(r.err).json(r.body);
    }
    res.json(r.out);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * POST /api/chatbot-admin/maintenance-broadcast/test-template
 * Envia uma única mensagem real via Template Meta aprovado.
 */
router.post("/chatbot-admin/maintenance-broadcast/test-template", requireAdminAuth, async (req, res) => {
  try {
    const r = await sendTestBroadcastTemplate(req.body, (req.admin && req.admin.email) || "");
    if (r.err) {
      return res.status(r.err).json(r.body);
    }
    res.json(r.out);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * POST /api/chatbot-admin/maintenance-broadcast/create
 * Cria lote enfileirado (envio fora do request).
 */
router.post("/chatbot-admin/maintenance-broadcast/create", requireAdminAuth, async (req, res) => {
  try {
    const r = await createBroadcastJob(req.body, req.admin);
    if (r.err) {
      return res.status(r.err).json(r.body);
    }
    res.json(r.out);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * GET /api/chatbot-admin/maintenance-broadcast/jobs/:id
 */
router.get("/chatbot-admin/maintenance-broadcast/jobs/:id", requireAdminAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ ok: false, error: "invalid_id" });
    }
    const r = await getJobById(req.params.id);
    if (r.err) {
      return res.status(r.err).json(r.body);
    }
    res.json({ ok: true, job: r.job });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.post(
  "/chatbot-admin/maintenance-broadcast/jobs/:id/pause",
  requireAdminAuth,
  async (req, res) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(400).json({ ok: false, error: "invalid_id" });
      }
      const r = await setJobStatus(req.params.id, "paused");
      if (r.err) {
        return res.status(r.err).json(r.body);
      }
      res.json(r.out);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }
);

router.post(
  "/chatbot-admin/maintenance-broadcast/jobs/:id/cancel",
  requireAdminAuth,
  async (req, res) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(400).json({ ok: false, error: "invalid_id" });
      }
      const r = await setJobStatus(req.params.id, "canceled");
      if (r.err) {
        return res.status(r.err).json(r.body);
      }
      res.json(r.out);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }
);

router.post(
  "/chatbot-admin/maintenance-broadcast/jobs/:id/resume",
  requireAdminAuth,
  async (req, res) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(400).json({ ok: false, error: "invalid_id" });
      }
      const r = await setJobStatus(req.params.id, "resumed");
      if (r.err) {
        return res.status(r.err).json(r.body);
      }
      res.json(r.out);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }
);


/**
 * POST /api/chatbot-admin/seasonal/run-now
 * Execução manual segura da campanha sazonal.
 */
router.post(
  "/chatbot-admin/seasonal/run-now",
  requireAdminAuth,
  async (req, res) => {
    try {
      if (seasonalCampaignRunning) {
        return res.status(409).json({
          ok: false,
          error: "campaign_already_running",
        });
      }

      seasonalCampaignRunning = true;

      const adminEmail =
        (req.admin && req.admin.email) || "unknown_admin";

      console.log("[seasonal_campaign] manual_run_requested", {
        admin: adminEmail,
        at: new Date().toISOString(),
      });

      runSeasonalCampaigns()
        .then(() => {
          console.log("[seasonal_campaign] manual_run_finished");
        })
        .catch((err) => {
          console.error(
            "[seasonal_campaign] manual_run_failed",
            err?.message || err
          );
        })
        .finally(() => {
          seasonalCampaignRunning = false;
        });

      return res.json({
        ok: true,
        started: true,
        message: "Campanha sazonal iniciada em background.",
      });
    } catch (e) {
      seasonalCampaignRunning = false;

      return res.status(500).json({
        ok: false,
        error: String(e?.message || e),
      });
    }
  }
);

router.delete(
  "/chatbot-admin/maintenance-broadcast/jobs/:id",
  requireAdminAuth,
  async (req, res) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(400).json({ ok: false, error: "invalid_id" });
      }

      const job = await MaintenanceBroadcastJob.findById(req.params.id);
      if (!job) {
        return res.status(404).json({ ok: false, error: "not_found" });
      }

      await MaintenanceBroadcastJob.deleteOne({ _id: job._id });

      return res.json({ ok: true, deleted: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e.message || e) });
    }
  }
);

/**
 * GET /api/chatbot-admin/automation/logs
 */
router.get("/chatbot-admin/automation/logs", requireAdminAuth, async (req, res) => {
  try {
    return res.json({
      ok: true,

      logs: [
        {
          type: "billing",
          level: "info",
          message: "Billing D-3 scheduler ativo",
          time: new Date().toISOString(),
        },

        {
          type: "campaign",
          level: "info",
          message: "Campanhas sazonais em modo LIVE",
          time: new Date().toISOString(),
        },

        {
          type: "sync",
          level: "info",
          message: "Sync BeesWeb operacional",
          time: new Date().toISOString(),
        },

        {
          type: "system",
          level: "success",
          message: "Central operacional funcionando normalmente",
          time: new Date().toISOString(),
        }
      ]
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: String(e?.message || e),
    });
  }
});




/**
 * POST /api/chatbot-admin/billing/test-template
 * Envia teste individual dos templates financeiros novos.
 */
router.post("/chatbot-admin/billing/test-template", requireAdminAuth, async (req, res) => {
  try {
    const { sendWhatsAppTemplate } = require("../services/whatsappSend");
    const templates = require("../config/whatsappTemplates");

    const phone = String(req.body.phone || "").trim();
    const type = String(req.body.type || "").trim();

    if (!phone) {
      return res.status(400).json({ ok: false, error: "Telefone obrigatório" });
    }

    if (!["d2", "reactivation"].includes(type)) {
      return res.status(400).json({ ok: false, error: "Tipo inválido" });
    }

    let templateName = "";
    let components = [];

    if (type === "d2") {
      templateName = templates.billingOverdueD2;
      components = [{
        type: "body",
        parameters: [
          { type: "text", text: "Cliente Teste" },
          { type: "text", text: "89,90" },
          { type: "text", text: "14/05/2026" },
          { type: "text", text: "https://exemplo.com/boleto" }
        ]
      }];
    } else {
      templateName = templates.billingReactivation;
      components = [{
        type: "body",
        parameters: [
          { type: "text", text: "Cliente Teste" },
          { type: "text", text: "61 99640-6911" }
        ]
      }];
    }

    if (!templateName) {
      return res.status(400).json({ ok: false, error: "Template não configurado" });
    }

    const out = await sendWhatsAppTemplate(
      phone,
      templateName,
      templates.languageCode,
      components
    );

    return res.json({
      ok: true,
      sent: true,
      template: templateName,
      phone,
      meta: out
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: String(e?.message || e)
    });
  }
});



/**
 * DELETE /api/chatbot-admin/delivery-history
 * Limpa somente histórico de envios WhatsApp com wamid.
 */
router.delete("/chatbot-admin/delivery-history", requireAdminAuth, async (req, res) => {
  try {
    if (req.body?.confirm !== "EXCLUIR HISTORICO") {
      return res.status(400).json({ ok: false, error: "confirm_required" });
    }

    const result = await WaMessage.deleteMany({
      direction: "outbound",
      wamid: { $exists: true, $ne: "" },
    });

    return res.json({
      ok: true,
      deleted: result.deletedCount || 0,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: String(e?.message || e),
    });
  }
});



/**
 * GET /api/chatbot-admin/automation/logs-real
 */
router.get("/chatbot-admin/automation/logs-real", requireAdminAuth, async (req, res) => {
  try {
    const fs = require("fs/promises");

    const outLogPath = "/home/servidor-dcnet/.pm2/logs/chatbot-dcinfinity-out.log";
    const errLogPath = "/home/servidor-dcnet/.pm2/logs/chatbot-dcinfinity-error.log";

    async function readLastLines(filePath, limit = 80) {
      try {
        const raw = await fs.readFile(filePath, "utf8");

        return raw
          .split("\n")
          .filter(Boolean)
          .slice(-limit);
      } catch (e) {
        return [];
      }
    }

    function classify(line, source) {
      const text = String(line || "").trim();

      if (!text) return null;

      let type = "system";
      let level = source === "error" ? "error" : "info";

      if (text.includes("[billing_reminder]")) {
        type = "billing";
      } else if (
        text.includes("[seasonal_campaign]") ||
        text.includes("[campaigns]")
      ) {
        type = "campaign";
      } else if (text.includes("[beesweb_sync]")) {
        type = "sync";
      } else if (
        text.toLowerCase().includes("whatsapp")
      ) {
        type = "whatsapp";
      }

      if (
        text.toLowerCase().includes("error") ||
        text.toLowerCase().includes("failed") ||
        text.toLowerCase().includes("erro")
      ) {
        level = "error";
      }

      if (
        text.includes("scheduler_started") ||
        text.includes("MongoDB conectado") ||
        text.includes("ON:")
      ) {
        level = "success";
      }

      return {
        type,
        level,
        message: text.replace(/^\d+\|chatbot\s*\|\s*/, "").slice(0, 240),
        time: new Date().toISOString(),
      };
    }

    const outLines = await readLastLines(outLogPath, 80);
    const errLines = await readLastLines(errLogPath, 40);

    const logs = []
      .concat(outLines.map((l) => classify(l, "out")))
      .concat(errLines.map((l) => classify(l, "error")))
      .filter(Boolean)
      .slice(-80)
      .reverse();

    return res.json({
      ok: true,
      source: "pm2",
      logs,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: String(e?.message || e),
    });
  }
});



/**
 * GET /api/chatbot-admin/delivery-history
 */
router.get("/chatbot-admin/delivery-history", requireAdminAuth, async (req, res) => {
  try {
    const rows = await WaMessage.find({
      direction: "outbound",
      wamid: { $exists: true, $ne: "" },
    })
      .sort({ createdAt: -1 })
      .limit(80)
      .lean();

    return res.json({
      ok: true,
      rows,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: String(e?.message || e),
    });
  }
});



/**
 * DELETE item único
 */
router.delete("/chatbot-admin/delivery-history/item/:id", requireAdminAuth, async (req, res) => {
  try {
    await WaMessage.deleteOne({ _id: req.params.id });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * DELETE múltiplos itens
 */
router.delete("/chatbot-admin/delivery-history/items", requireAdminAuth, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];

    await WaMessage.deleteMany({
      _id: { $in: ids }
    });

    return res.json({
      ok: true,
      deleted: ids.length
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: String(e?.message || e)
    });
  }
});


function digitsOnlyHistory(v) {
  return String(v || "").replace(/\D/g, "");
}

function escapeRegexHistory(v) {
  return String(v || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function inferWaHistoryType(row) {
  const rawType = String(row.messageType || row.raw?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.type || row.raw?.messages?.[0]?.type || "").toLowerCase();
  if (rawType) return rawType;
  if (row.templateName) return "template";
  if (String(row.text || "").startsWith("[template]")) return "template";
  if (String(row.text || "").startsWith("[interactive:")) return "interactive";
  return "text";
}

function inferWaHistoryPhone(row) {
  return row.direction === "inbound" ? String(row.from || "") : String(row.to || "");
}

function inferWaHistoryStatus(row) {
  if (row.direction === "inbound") return "received";
  return String(row.deliveryStatus || row.metaStatus || (row.metaError ? "failed" : "sent") || "sent").toLowerCase();
}

function originLabelHistory(origin) {
  const raw = String(origin || "").toLowerCase();
  if (raw.includes("commercial")) return "Comercial";
  if (raw.includes("billing") || raw.includes("finance") || raw.includes("pix") || raw.includes("boleto")) return "Financeiro";
  if (raw.includes("support") || raw.includes("suporte") || raw.includes("maintenance") || raw.includes("interactive")) return "Suporte";
  if (raw.includes("campaign") || raw.includes("birthday") || raw.includes("seasonal") || raw.includes("partner")) return "Campanha";
  if (raw.includes("template")) return "Template";
  return origin || "WhatsApp";
}

function historyFilterMatch(originFilter) {
  const f = String(originFilter || "").toLowerCase();
  if (!f || f === "all") return null;
  if (f === "templates") return { templateName: { $nin: [null, ""] } };
  if (f === "campaigns") return { origin: /campaign|birthday|seasonal|partner/i };
  if (f === "commercial") return { $or: [{ origin: /commercial/i }, { intent: /commercial/i }] };
  if (f === "financial") return { $or: [{ origin: /billing|finance|pix|boleto|reactivation/i }, { intent: /finance|pix|boleto/i }] };
  if (f === "support") return { $or: [{ origin: /support|suporte|maintenance|interactive/i }, { intent: /support|suporte|maintenance/i }] };
  return { origin: new RegExp(escapeRegexHistory(f), "i") };
}

router.get("/chatbot-admin/whatsapp-history", requireAdminAuth, async (req, res) => {
  try {
    const tenant = normalizeTenantParam(req.query.tenant);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10) || 20, 1), 80);
    const page = Math.max(parseInt(req.query.page || "1", 10) || 1, 1);
    const q = String(req.query.q || "").trim();
    const phone = digitsOnlyHistory(req.query.phone);
    const direction = String(req.query.direction || "all").toLowerCase();
    const status = String(req.query.status || "").toLowerCase();
    const query = { tenant };

    if (direction === "inbound" || direction === "outbound") query.direction = direction;

    if (status === "failed") {
      query.$or = [{ deliveryStatus: "failed" }, { metaStatus: "failed" }, { metaError: { $ne: null } }];
    } else if (status && status !== "all") {
      query.$or = [{ deliveryStatus: status }, { metaStatus: status }];
    }

    const originMatch = historyFilterMatch(req.query.origin);
    if (originMatch) {
      if (query.$and) query.$and.push(originMatch);
      else query.$and = [originMatch];
    }

    if (phone) {
      const phoneRe = new RegExp(escapeRegexHistory(phone));
      const phoneMatch = { $or: [{ from: phoneRe }, { to: phoneRe }] };
      if (query.$and) query.$and.push(phoneMatch);
      else query.$and = [phoneMatch];
    }

    const dateFrom = req.query.dateFrom ? new Date(String(req.query.dateFrom)) : null;
    const dateTo = req.query.dateTo ? new Date(String(req.query.dateTo)) : null;
    if ((dateFrom && !Number.isNaN(dateFrom.getTime())) || (dateTo && !Number.isNaN(dateTo.getTime()))) {
      query.createdAt = {};
      if (dateFrom && !Number.isNaN(dateFrom.getTime())) query.createdAt.$gte = dateFrom;
      if (dateTo && !Number.isNaN(dateTo.getTime())) {
        const end = new Date(dateTo);
        if (String(req.query.dateTo).length <= 10) end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    if (q) {
      const re = new RegExp(escapeRegexHistory(q), "i");
      const leadMatches = await Lead.find({ tenant, name: re }).select("phone").limit(80).lean();
      const leadPhoneMatches = leadMatches.map((lead) => digitsOnlyHistory(lead.phone)).filter(Boolean);
      const qOr = [
        { from: re },
        { to: re },
        { text: re },
        { templateName: re },
        { origin: re },
        { deliveryStatus: re },
        { metaStatus: re },
      ];
      for (const ph of leadPhoneMatches) {
        const phRe = new RegExp(escapeRegexHistory(ph));
        qOr.push({ from: phRe }, { to: phRe });
      }
      const qMatch = { $or: qOr };
      if (query.$and) query.$and.push(qMatch);
      else query.$and = [qMatch];
    }

    const [rows, total] = await Promise.all([
      WaMessage.find(query).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      WaMessage.countDocuments(query),
    ]);

    const phones = Array.from(new Set(rows.map(inferWaHistoryPhone).map(digitsOnlyHistory).filter(Boolean)));
    const leads = phones.length
      ? await Lead.find({ tenant, phone: { $in: phones } }).select("phone name avatarUrl profilePhotoUrl whatsappProfileName status lastIntent assignedToEmail coverageStatus beeswebCustomerId origin channel updatedAt").lean()
      : [];
    const leadByPhone = new Map(leads.map((lead) => [digitsOnlyHistory(lead.phone), lead]));

    const mapped = rows.map((row) => {
      const ph = inferWaHistoryPhone(row);
      const lead = leadByPhone.get(digitsOnlyHistory(ph)) || null;
      const messageType = inferWaHistoryType(row);
      const statusValue = inferWaHistoryStatus(row);
      return {
        id: String(row._id),
        tenant: row.tenant || tenant,
        direction: row.direction || "",
        phone: ph,
        leadName: lead?.name || "",
        text: row.text || "",
        messageType,
        mediaUrl: row.mediaUrl || (/^https?:\/\//i.test(String(row.text || "")) ? String(row.text || "") : ""),
        templateName: row.templateName || "",
        languageCode: row.languageCode || "",
        origin: row.origin || "WhatsApp",
        originLabel: originLabelHistory(row.origin),
        status: statusValue,
        deliveryStatus: row.deliveryStatus || "",
        metaStatus: row.metaStatus || "",
        metaStatusAt: row.metaStatusAt || null,
        metaError: row.metaError || null,
        wamid: row.wamid || row.waMessageId || "",
        waMessageId: row.waMessageId || "",
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        raw: row.raw || null,
        lead,
        templateVariables: row.templateVariables || null,
        templateComponents: row.templateComponents || null,
        fallbackToTemplate: !!row.fallbackToTemplate,
        hiddenFromInbox: !!row.hiddenFromInbox,
        hiddenAt: row.hiddenAt || null,
        hiddenBy: row.hiddenBy || "",
      };
    });

    return res.json({ ok: true, rows: mapped, page, limit, total, hasMore: page * limit < total });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});


const CONVERSATION_TAGS = ["Comercial", "Cliente", "Financeiro", "Instalação", "Suporte", "VIP", "Prioridade", "Cobertura", "Campanha", "Urgente", "Favorito"];

function normalizeConversationPhone(v) {
  let d = String(v || "").replace(/\D/g, "");
  if (d.startsWith("0")) d = d.slice(1);
  if (!d.startsWith("55") && d.length >= 10 && d.length <= 11) d = "55" + d;
  return d;
}

function conversationPhoneExpr() {
  return { $cond: [{ $eq: ["$direction", "inbound"] }, "$from", "$to"] };
}

function getFriendlyTemplateName(templateName) {
  const key = String(templateName || "").trim();
  const map = {
    dcnet_billing_reminder_v2: "📅 Aviso D-3",
    dcnet_billing_overdue_d2_v2: "🔴 Cobrança D+2",
    dcnet_billing_overdue_d2: "🔴 Cobrança D+2",
    dcnet_billing_reactivation: "🟢 Reativação",
    dcnet_birthday_card: "🎂 Aniversário",
    dcnet_christmas_card: "🎄 Natal",
    dcnet_new_year_card: "🎆 Ano Novo",
    dcnet_easter_card: "✝️ Páscoa",
    dcnet_mothers_day_card: "🌷 Dia das Mães",
    dcnet_fathers_day_card: "👔 Dia dos Pais",
    dcnet_indique_ganhe_v1: "🎁 Indique e Ganhe",
    dcnet_promocao_fibra: "🚀 Promoção",
    dcnet_manutencao_programada: "🔧 Manutenção",
    dcnet_comunicado_oficial: "📢 Comunicado",
    dcnet_guardian_alert: "🛡️ Guardian",
    dcnet_parceria_banner: "🤝 Parceria",
  };
  return map[key] || key;
}

function inferConversationMessageType(row) {
  const rawType = String(row.messageType || row.raw?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.type || "").toLowerCase();
  if (rawType) return rawType;
  if (row.templateName) return "template";
  if (String(row.text || "").startsWith("[template]")) return "template";
  if (String(row.text || "").startsWith("[interactive:")) return "interactive";
  return "text";
}

function compactMetaRaw(raw) {
  if (!raw) return null;
  return {
    object: raw.object,
    entry: Array.isArray(raw.entry) ? raw.entry.slice(0, 1) : undefined,
    messages: raw.messages,
    contacts: raw.contacts,
    error: raw.error,
  };
}

function conversationLeadPayload(lead) {
  if (!lead) return null;
  return {
    id: String(lead._id || ""),
    name: lead.name || "",
    displayName: lead.name || lead.whatsappProfileName || lead.phone || "",
    avatarUrl: lead.avatarUrl || "",
    profilePhotoUrl: lead.profilePhotoUrl || "",
    whatsappProfileName: lead.whatsappProfileName || "",
    phone: lead.phone || "",
    status: lead.status || "novo",
    lastIntent: lead.lastIntent || "",
    lastCep: lead.lastCep || "",
    selectedPlan: lead.selectedPlan || "",
    origin: lead.origin || lead.channel || "",
    lastCampaign: lead.lastCampaign || "",
    cpf: lead.cpf || "",
    city: lead.city || "",
    neighborhood: lead.neighborhood || "",
    dueDate: lead.dueDate || "",
    lastInvoice: lead.lastInvoice || "",
    financialStatus: lead.financialStatus || "",
    connectionStatus: lead.connectionStatus || "",
    customerSince: lead.customerSince || null,
    lastAttendanceAt: lead.lastAttendanceAt || lead.assignedAt || lead.resolvedAt || null,
    protocol: lead.protocol || "",
    timelineEvents: Array.isArray(lead.timelineEvents) ? lead.timelineEvents.slice(-40) : [],
    tags: Array.isArray(lead.tags) ? lead.tags : [],
    isFavorite: Array.isArray(lead.tags) ? lead.tags.includes("Favorito") : false,
    unreadManual: !!lead.unreadManual,
    internalNotes: lead.internalNotes || "",
    assignedTo: lead.assignedTo || "",
    assignedToEmail: lead.assignedToEmail || "",
    resolvedAt: lead.resolvedAt || null,
    coverageStatus: lead.coverageStatus || "",
    coverageAreaName: lead.coverageAreaName || "",
    updatedAt: lead.updatedAt || null,
  };
}

function conversationStatus(row, lead, hasFailed) {
  if (hasFailed) return "falhou";
  const st = String(lead?.status || "").toLowerCase();
  if (st === "handoff" || st === "em_atendimento") return "humano";
  if (st === "resolved" || st === "resolvido") return "finalizado";
  if (row?.lastDirection === "outbound") return "aguardando resposta";
  if (row?.lastDirection === "inbound") return "novo";
  return "bot";
}

function conversationDeliveryIndicator(row) {
  const st = String(row?.deliveryStatus || row?.metaStatus || "").toLowerCase();
  if (st === "read") return { icon: "✓✓", label: "lido", tone: "read" };
  if (st === "delivered") return { icon: "✓✓", label: "entregue", tone: "delivered" };
  if (st === "sent") return { icon: "✓", label: "enviado", tone: "sent" };
  if (row?.templateName) return { icon: "📄", label: "template", tone: "template" };
  return null;
}

function conversationMetaIndicator(translated) {
  const code = Number(translated?.code || 0);
  if (code === 131047) return { icon: "⚠", label: "janela 24h", tone: "window24h" };
  if (code === 131051) return { icon: "🚫", label: "bloqueado", tone: "blocked" };
  if (translated?.needsTemplate) return { icon: "📄", label: "template pendente", tone: "template" };
  return { icon: "⚠", label: "não entregue", tone: "failed" };
}

router.get("/chatbot-admin/conversations", requireAdminAuth, async (req, res) => {
  try {
    const tenant = normalizeTenantParam(req.query.tenant);
    const q = String(req.query.q || "").trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit || "60", 10) || 60, 1), 120);
    const includeHidden = String(req.query.includeHidden || "false").toLowerCase() === "true";
    const match = { tenant, channel: "whatsapp", direction: { $in: ["inbound", "outbound"] } };
    if (!includeHidden) match.hiddenFromInbox = { $ne: true };
    const pipeline = [
      { $match: match },
      { $addFields: { conversationPhone: conversationPhoneExpr() } },
      { $sort: { createdAt: -1, _id: -1 } },
      {
        $group: {
          _id: "$conversationPhone",
          last: { $first: "$$ROOT" },
          lastMessageId: { $first: "$_id" },
          unreadCount: { $sum: { $cond: [{ $eq: ["$direction", "inbound"] }, 1, 0] } },
          hasFailed: { $max: { $cond: [{ $or: [{ $eq: ["$deliveryStatus", "failed"] }, { $eq: ["$metaStatus", "failed"] }, { $ne: ["$metaError", null] }] }, 1, 0] } },
          hasMedia: { $max: { $cond: [{ $in: ["$messageType", ["image", "document", "audio", "location"]] }, 1, 0] } },
          templateNames: { $addToSet: "$templateName" },
        }
      },
      { $sort: { "last.createdAt": -1 } },
      { $limit: limit }
    ];
    const grouped = await WaMessage.aggregate(pipeline);
    const phones = grouped.map((g) => normalizeConversationPhone(g._id)).filter(Boolean);
    const leads = phones.length ? await Lead.find({ tenant, phone: { $in: phones } }).lean() : [];
    const leadByPhone = new Map(leads.map((l) => [normalizeConversationPhone(l.phone), l]));
    let rows = grouped.map((g) => {
      const ph = normalizeConversationPhone(g._id);
      const lead = leadByPhone.get(ph) || null;
      const last = g.last || {};
      const leadTags = Array.isArray(lead?.tags) ? lead.tags : [];
      const out = {
        id: String(g.lastMessageId || last._id || ""),
        phone: ph,
        leadName: lead?.name || lead?.whatsappProfileName || "",
        displayName: lead?.name || lead?.whatsappProfileName || ph,
        avatarUrl: lead?.avatarUrl || "",
        profilePhotoUrl: lead?.profilePhotoUrl || "",
        whatsappProfileName: lead?.whatsappProfileName || "",
        lastMessage: last.templateName ? getFriendlyTemplateName(last.templateName) : (last.text || ""),
        lastMessageAt: last.createdAt || null,
        unreadCount: Number(g.unreadCount || 0) + (lead?.unreadManual ? 1 : 0),
        unreadManual: !!lead?.unreadManual,
        isFavorite: leadTags.includes("Favorito"),
        lastDirection: last.direction || "",
        status: conversationStatus({ lastDirection: last.direction }, lead, !!g.hasFailed),
        lastIntent: lead?.lastIntent || last.intent || "",
        hasFailed: !!g.hasFailed,
        hasMedia: !!g.hasMedia,
        messageType: inferConversationMessageType(last),
        templateName: last.templateName || "",
        friendlyTemplateName: last.templateName ? getFriendlyTemplateName(last.templateName) : "",
        origin: last.origin || lead?.origin || "WhatsApp",
        cpf: lead?.cpf || "",
        city: lead?.city || "",
        neighborhood: lead?.neighborhood || "",
        protocol: lead?.protocol || "",
        assignedToEmail: lead?.assignedToEmail || "",
        typingUntil: lead?.typingUntil || null,
        tags: leadTags,
        metaError: last.metaError || null,
        metaErrorTranslated: last.metaError ? translateMetaError(last.metaError) : null,
        indicator: last.metaError ? conversationMetaIndicator(translateMetaError(last.metaError)) : conversationDeliveryIndicator(last),
      };
      return out;
    });
    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter((r) => [r.phone, r.leadName, r.displayName, r.whatsappProfileName, r.lastMessage, r.status, r.lastIntent, r.origin, (r.tags || []).join(" ")].join(" ").toLowerCase().includes(needle));
    }
    return res.json({ ok: true, items: rows, rows, tags: CONVERSATION_TAGS });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.get("/chatbot-admin/conversations/:phone/messages", requireAdminAuth, async (req, res) => {
  try {
    const tenant = normalizeTenantParam(req.query.tenant);
    const phone = normalizeConversationPhone(req.params.phone);
    if (!phone) return res.status(400).json({ ok: false, error: "phone_required" });
    const phoneRe = new RegExp(escapeRegexHistory(phone));
    const includeHidden = String(req.query.includeHidden || "false").toLowerCase() === "true";
    const messageQuery = { tenant, channel: "whatsapp", $or: [{ from: phoneRe }, { to: phoneRe }] };
    if (!includeHidden) messageQuery.hiddenFromInbox = { $ne: true };
    const [messages, lead] = await Promise.all([
      WaMessage.find(messageQuery).sort({ createdAt: 1, _id: 1 }).limit(500).lean(),
      Lead.findOne({ tenant, phone }).lean(),
    ]);
    const mapped = messages.map((m) => ({
      id: String(m._id),
      direction: m.direction || "",
      from: m.from || "",
      to: m.to || "",
      text: m.text || "",
      messageType: inferConversationMessageType(m),
      mediaUrl: m.mediaUrl || (/^https?:\/\//i.test(String(m.text || "")) ? String(m.text || "") : ""),
      templateName: m.templateName || "",
      friendlyTemplateName: m.templateName ? getFriendlyTemplateName(m.templateName) : "",
      origin: m.origin || "WhatsApp",
      status: m.direction === "inbound" ? "received" : String(m.deliveryStatus || m.metaStatus || (m.metaError ? "failed" : "sent") || "sent"),
      operatorName: m.operatorName || "",
      operatorEmail: m.operatorEmail || "",
      responseKind: m.responseKind || (m.direction === "outbound" && (m.operatorEmail || m.operatorName) ? "manual" : (m.direction === "outbound" ? "bot" : "")),
      auditAction: m.auditAction || "",
      replyToMessageId: m.replyToMessageId || "",
      replyToText: m.replyToText || "",
      replyToWamid: m.replyToWamid || "",
      reactions: Array.isArray(m.reactions) ? m.reactions : [],
      filename: m.filename || "",
      deliveryStatus: m.deliveryStatus || "",
      metaStatus: m.metaStatus || "",
      metaError: m.metaError || null,
      metaErrorTranslated: m.metaError ? translateMetaError(m.metaError) : null,
      wamid: m.wamid || "",
      waMessageId: m.waMessageId || "",
      raw: compactMetaRaw(m.raw),
      hiddenFromInbox: !!m.hiddenFromInbox,
      hiddenAt: m.hiddenAt || null,
      hiddenBy: m.hiddenBy || "",
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    }));
    return res.json({ ok: true, phone, lead: conversationLeadPayload(lead), messages: mapped, tags: CONVERSATION_TAGS });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});


function conversationPhoneMongoQuery(tenant, phone) {
  const normalized = normalizeConversationPhone(phone);
  if (!normalized) return null;
  const phoneRe = new RegExp(escapeRegexHistory(normalized));
  return { tenant, channel: "whatsapp", $or: [{ from: phoneRe }, { to: phoneRe }] };
}

async function hideConversationMessages({ tenant, phone, admin }) {
  const q = conversationPhoneMongoQuery(tenant, phone);
  if (!q) return { matched: 0, modified: 0 };
  const by = admin?.email || String(admin?._id || "");
  const r = await WaMessage.updateMany(q, { $set: { hiddenFromInbox: true, hiddenAt: new Date(), hiddenBy: by } });
  return { matched: r.matchedCount || r.n || 0, modified: r.modifiedCount || r.nModified || 0 };
}

router.post("/chatbot-admin/conversations/clear-bulk", requireAdminAuth, async (req, res) => {
  try {
    const tenant = normalizeTenantParam(req.body?.tenant || req.query.tenant);
    const phones = Array.isArray(req.body?.phones) ? req.body.phones.map(normalizeConversationPhone).filter(Boolean) : [];
    if (!phones.length) return res.status(400).json({ ok: false, error: "phones_required" });
    let matched = 0, modified = 0;
    for (const phone of Array.from(new Set(phones))) {
      const r = await hideConversationMessages({ tenant, phone, admin: req.admin });
      matched += r.matched;
      modified += r.modified;
    }
    return res.json({ ok: true, matched, modified });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.post("/chatbot-admin/conversations/clear-all", requireAdminAuth, async (req, res) => {
  try {
    const tenant = normalizeTenantParam(req.body?.tenant || req.query.tenant);
    const confirm = String(req.body?.confirm || "").trim();
    if (confirm !== "LIMPAR CONVERSAS") return res.status(400).json({ ok: false, error: "invalid_confirmation" });
    const by = req.admin?.email || String(req.admin?._id || "");
    const r = await WaMessage.updateMany({ tenant, channel: "whatsapp", direction: { $in: ["inbound", "outbound"] }, hiddenFromInbox: { $ne: true } }, { $set: { hiddenFromInbox: true, hiddenAt: new Date(), hiddenBy: by } });
    return res.json({ ok: true, matched: r.matchedCount || r.n || 0, modified: r.modifiedCount || r.nModified || 0 });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.post("/chatbot-admin/conversations/:phone/clear", requireAdminAuth, async (req, res) => {
  try {
    const tenant = normalizeTenantParam(req.body?.tenant || req.query.tenant);
    const phone = normalizeConversationPhone(req.params.phone);
    if (!phone) return res.status(400).json({ ok: false, error: "phone_required" });
    const result = await hideConversationMessages({ tenant, phone, admin: req.admin });
    return res.json({ ok: true, phone, ...result });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.post("/chatbot-admin/conversations/:phone/restore", requireAdminAuth, async (req, res) => {
  try {
    const tenant = normalizeTenantParam(req.body?.tenant || req.query.tenant);
    const phone = normalizeConversationPhone(req.params.phone);
    const q = conversationPhoneMongoQuery(tenant, phone);
    if (!q) return res.status(400).json({ ok: false, error: "phone_required" });
    const r = await WaMessage.updateMany(q, { $set: { hiddenFromInbox: false }, $unset: { hiddenAt: "", hiddenBy: "" } });
    return res.json({ ok: true, phone, matched: r.matchedCount || r.n || 0, modified: r.modifiedCount || r.nModified || 0 });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.delete("/chatbot-admin/conversations/:phone/messages", requireAdminAuth, async (req, res) => {
  try {
    const tenant = normalizeTenantParam(req.body?.tenant || req.query.tenant);
    const phone = normalizeConversationPhone(req.params.phone);
    const confirm = String(req.body?.confirm || req.query.confirm || "").trim();
    if (confirm !== "APAGAR") return res.status(400).json({ ok: false, error: "invalid_confirmation" });
    const q = conversationPhoneMongoQuery(tenant, phone);
    if (!q) return res.status(400).json({ ok: false, error: "phone_required" });
    const by = req.admin?.email || String(req.admin?._id || "");
    const count = await WaMessage.countDocuments(q);
    const r = await WaMessage.deleteMany(q);
    await Lead.findOneAndUpdate(
      { tenant, phone },
      { $push: { timelineEvents: { type: "delete_messages", label: "Conversa apagada definitivamente", by, at: new Date(), count } }, $set: { unreadManual: false, lastAttendanceAt: new Date() } },
      { upsert: true, new: true }
    ).catch(() => null);
    return res.json({ ok: true, phone, deleted: r.deletedCount || 0, audit: { action: "delete_messages", by, at: new Date(), count } });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.post("/chatbot-admin/conversations/:phone/messages/:messageId/reaction", requireAdminAuth, async (req, res) => {
  try {
    const tenant = normalizeTenantParam(req.body?.tenant || req.query.tenant);
    const phone = normalizeConversationPhone(req.params.phone);
    const emoji = String(req.body?.emoji || "").trim().slice(0, 8);
    if (!phone || !req.params.messageId) return res.status(400).json({ ok: false, error: "message_required" });
    const q = conversationPhoneMongoQuery(tenant, phone);
    q._id = req.params.messageId;
    const by = req.admin?.email || String(req.admin?._id || "");
    const reaction = emoji ? { emoji, by, at: new Date() } : null;
    const update = reaction ? { $set: { reactions: [reaction], auditAction: "reaction", auditBy: by, auditAt: new Date() } } : { $set: { reactions: [], auditAction: "reaction_removed", auditBy: by, auditAt: new Date() } };
    const row = await WaMessage.findOneAndUpdate(q, update, { new: true }).lean();
    if (!row) return res.status(404).json({ ok: false, error: "message_not_found" });
    return res.json({ ok: true, reaction, message: row });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.post("/chatbot-admin/conversations/:phone/ai/suggest-reply", requireAdminAuth, async (req, res) => {
  try {
    const tenant = normalizeTenantParam(req.body?.tenant || req.query.tenant);
    const phone = normalizeConversationPhone(req.params.phone);
    if (!phone) return res.status(400).json({ ok: false, error: "phone_required" });
    const [messages, lead, templates] = await Promise.all([
      WaMessage.find(conversationPhoneMongoQuery(tenant, phone)).sort({ createdAt: 1 }).limit(120).lean(),
      Lead.findOne({ tenant, phone }).lean(),
      listTemplates(tenant).catch(() => []),
    ]);
    const result = dcnetOperationalAi.suggestReply({ messages, lead, templates, context: req.body?.context || {} });
    await Lead.findOneAndUpdate(
      { tenant, phone },
      { $push: { timelineEvents: { type: "ai_suggest_reply", label: "IA sugeriu resposta", by: req.admin?.email || String(req.admin?._id || ""), at: new Date(), intent: result.intent } } },
      { upsert: true, new: true }
    ).catch(() => null);
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.post("/chatbot-admin/conversations/:phone/attachment", requireAdminAuth, conversationAttachmentUploadHandler, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: "file_required" });
    const base = publicBaseUrl(req);
    const url = base + "/uploads/conversations/" + encodeURIComponent(req.file.filename);
    return res.json({
      ok: true,
      url,
      mediaUrl: url,
      mediaType: conversationMediaTypeFromMime(req.file.mimetype),
      mimeType: req.file.mimetype || "application/octet-stream",
      filename: req.file.originalname || req.file.filename,
      size: req.file.size || 0,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.post("/chatbot-admin/conversations/:phone/send", requireAdminAuth, async (req, res) => {
  try {
    const tenant = normalizeTenantParam(req.body?.tenant || req.query.tenant);
    const phone = normalizeConversationPhone(req.params.phone);
    const text = String(req.body?.text || "").trim();
    const mediaUrl = String(req.body?.mediaUrl || "").trim();
    const mediaType = String(req.body?.mediaType || (mediaUrl ? "image" : "text")).trim().toLowerCase();
    const filename = String(req.body?.filename || "").trim();
    const replyToMessageId = String(req.body?.replyToMessageId || "").trim();
    const replyToText = String(req.body?.replyToText || "").trim().slice(0, 300);
    const replyToWamid = String(req.body?.replyToWamid || "").trim();
    if (!phone) return res.status(400).json({ ok: false, error: "phone_required" });
    if (!text && !mediaUrl) return res.status(400).json({ ok: false, error: "message_required" });
    try {
      const operatorName = req.admin?.name || req.admin?.email || "Operador";
      const operatorEmail = req.admin?.email || "";
      const sendOptions = { tenant, origin: "human_chat", operatorId: String(req.admin?._id || ""), operatorName, operatorEmail, responseKind: "manual", auditAction: "reply", auditBy: operatorEmail || operatorName, replyToMessageId, replyToText, replyToWamid };
      const sent = mediaUrl ? await sendWhatsAppMedia(phone, mediaType, mediaUrl, text, filename, sendOptions) : await sendWhatsAppText(phone, text, sendOptions);
      await Lead.findOneAndUpdate({ tenant, phone }, { $set: { status: "handoff", lastIntent: "human_chat", assignedTo: String(req.admin?._id || ""), assignedToEmail: operatorEmail, assignedAt: new Date(), lastAttendanceAt: new Date() }, $push: { timelineEvents: { type: "manual_reply", label: "Mensagem manual", by: operatorEmail || operatorName, at: new Date() } }, $setOnInsert: { tenant, phone, channel: "whatsapp", origin: "whatsapp" } }, { upsert: true, new: true });
      return res.json({ ok: true, sent });
    } catch (e) {
      const meta = e.meta || e.metaError || null;
      const translated = translateMetaError(meta || e);
      await WaMessage.create({
        tenant,
        channel: "whatsapp",
        origin: "human_chat",
        direction: "outbound",
        from: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
        to: phone,
        text: text || mediaUrl || "[media]",
        messageType: mediaUrl ? mediaType : "text",
        filename,
        mediaUrl,
        raw: meta || { error: String(e?.message || e) },
        deliveryStatus: "failed",
        metaStatus: "failed",
        metaStatusAt: new Date(),
        failedAt: new Date(),
        metaError: meta && meta.error ? meta.error : meta,
        replyToMessageId,
        replyToText,
        replyToWamid,
      }).catch((err) => console.error("conversation send failed history:", err?.message || err));
      return res.status(Number(translated.code) === 131047 ? 409 : (e.status || 500)).json({ ok: false, error: "meta_send_failed", message: translated.reason, metaErrorTranslated: translated });
    }
  } catch (e) {
    const translated = translateMetaError(e.meta || e.metaError || e);
    return res.status(e.status || 500).json({ ok: false, error: String(e?.message || e), message: translated.reason, metaErrorTranslated: translated });
  }
});

router.post("/chatbot-admin/conversations/:phone/assume", requireAdminAuth, async (req, res) => {
  try {
    const tenant = normalizeTenantParam(req.body?.tenant || req.query.tenant);
    const phone = normalizeConversationPhone(req.params.phone);
    const adminId = String(req.admin?._id || "");
    const email = req.admin?.email || "";
    const lead = await Lead.findOneAndUpdate({ tenant, phone }, { $set: { status: "handoff", assignedTo: adminId, assignedToEmail: email, assignedAt: new Date(), lastIntent: "human_chat" }, $setOnInsert: { tenant, phone, channel: "whatsapp", origin: "whatsapp" } }, { upsert: true, new: true }).lean();
    await WaMessage.create({ tenant, channel: "whatsapp", origin: "human_chat", direction: "system", from: "admin", to: phone, text: "Atendimento assumido por " + (email || adminId || "admin"), messageType: "system", raw: { event: "assume", adminId, email, at: new Date() } });
    return res.json({ ok: true, lead: conversationLeadPayload(lead) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.post("/chatbot-admin/conversations/:phone/resolve", requireAdminAuth, async (req, res) => {
  try {
    const tenant = normalizeTenantParam(req.body?.tenant || req.query.tenant);
    const phone = normalizeConversationPhone(req.params.phone);
    const by = req.admin?.email || String(req.admin?._id || "");
    const lead = await Lead.findOneAndUpdate({ tenant, phone }, { $set: { status: "resolved", resolvedAt: new Date(), lastAttendanceAt: new Date() }, $push: { timelineEvents: { type: "resolve", label: "Atendimento finalizado", by, at: new Date() } } }, { new: true }).lean();
    await WaMessage.create({ tenant, channel: "whatsapp", origin: "human_chat", direction: "system", from: "admin", to: phone, text: "Atendimento finalizado", messageType: "system", raw: { event: "resolve", admin: by, at: new Date() }, auditAction: "resolve", auditBy: by, auditAt: new Date() });
    return res.json({ ok: true, lead: conversationLeadPayload(lead) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.post("/chatbot-admin/conversations/:phone/release", requireAdminAuth, async (req, res) => {
  try {
    const tenant = normalizeTenantParam(req.body?.tenant || req.query.tenant);
    const phone = normalizeConversationPhone(req.params.phone);
    const by = req.admin?.email || String(req.admin?._id || "");
    const lead = await Lead.findOneAndUpdate({ tenant, phone }, { $set: { status: "aguardando_cliente", assignedTo: "", assignedToEmail: "", lastAttendanceAt: new Date() }, $push: { timelineEvents: { type: "release", label: "Atendimento liberado", by, at: new Date() } } }, { new: true }).lean();
    await WaMessage.create({ tenant, channel: "whatsapp", origin: "human_chat", direction: "system", from: "admin", to: phone, text: "Atendimento liberado", messageType: "system", raw: { event: "release", admin: by, at: new Date() }, auditAction: "release", auditBy: by, auditAt: new Date() });
    return res.json({ ok: true, lead: conversationLeadPayload(lead) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.post("/chatbot-admin/conversations/:phone/reopen", requireAdminAuth, async (req, res) => {
  try {
    const tenant = normalizeTenantParam(req.body?.tenant || req.query.tenant);
    const phone = normalizeConversationPhone(req.params.phone);
    const by = req.admin?.email || String(req.admin?._id || "");
    const lead = await Lead.findOneAndUpdate({ tenant, phone }, { $set: { status: "handoff", resolvedAt: null, lastAttendanceAt: new Date(), assignedTo: String(req.admin?._id || ""), assignedToEmail: req.admin?.email || "" }, $push: { timelineEvents: { type: "reopen", label: "Atendimento reaberto", by, at: new Date() } } }, { new: true }).lean();
    await WaMessage.create({ tenant, channel: "whatsapp", origin: "human_chat", direction: "system", from: "admin", to: phone, text: "Atendimento reaberto", messageType: "system", raw: { event: "reopen", admin: by, at: new Date() }, auditAction: "reopen", auditBy: by, auditAt: new Date() });
    return res.json({ ok: true, lead: conversationLeadPayload(lead) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.patch("/chatbot-admin/conversations/:phone/lead", requireAdminAuth, async (req, res) => {
  try {
    const tenant = normalizeTenantParam(req.body?.tenant || req.query.tenant);
    const phone = normalizeConversationPhone(req.params.phone);
    const set = {};
    if (Array.isArray(req.body?.tags)) set.tags = req.body.tags.filter((x) => CONVERSATION_TAGS.includes(String(x))).slice(0, 12);
    if (req.body?.internalNotes != null) set.internalNotes = String(req.body.internalNotes || "").slice(0, 8000);
    if (req.body?.name != null) set.name = String(req.body.name || "").slice(0, 120);
    if (req.body?.lastCep != null) set.lastCep = String(req.body.lastCep || "").slice(0, 20);
    if (req.body?.selectedPlan != null) set.selectedPlan = String(req.body.selectedPlan || "").slice(0, 120);
    if (req.body?.cpf != null) set.cpf = String(req.body.cpf || "").slice(0, 20);
    if (req.body?.city != null) set.city = String(req.body.city || "").slice(0, 80);
    if (req.body?.neighborhood != null) set.neighborhood = String(req.body.neighborhood || "").slice(0, 80);
    if (req.body?.dueDate != null) set.dueDate = String(req.body.dueDate || "").slice(0, 40);
    if (req.body?.lastInvoice != null) set.lastInvoice = String(req.body.lastInvoice || "").slice(0, 120);
    if (req.body?.financialStatus != null) set.financialStatus = String(req.body.financialStatus || "").slice(0, 80);
    if (req.body?.connectionStatus != null) set.connectionStatus = String(req.body.connectionStatus || "").slice(0, 80);
    if (req.body?.protocol != null) set.protocol = String(req.body.protocol || "").slice(0, 80);
    if (req.body?.unreadManual != null) set.unreadManual = !!req.body.unreadManual;
    if (!Object.keys(set).length) return res.status(400).json({ ok: false, error: "empty_patch" });
    const lead = await Lead.findOneAndUpdate({ tenant, phone }, { $set: set, $setOnInsert: { tenant, phone, channel: "whatsapp", origin: "whatsapp" } }, { upsert: true, new: true }).lean();
    return res.json({ ok: true, lead: conversationLeadPayload(lead), tags: CONVERSATION_TAGS });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});


function metaRouteError(res, e) {
  const code = e && (e.code || e.message);
  if (code === "meta_waba_config_missing") {
    return res.status(400).json({ ok: false, error: code, message: "Configure WHATSAPP_BUSINESS_ACCOUNT_ID/WABA_ID e WHATSAPP_TOKEN para sincronizar templates Meta." });
  }
  if (code === "template_not_found" || code === "invalid_phone") {
    return res.status(400).json({ ok: false, error: code });
  }
  return res.status(e && e.status ? e.status : 500).json({ ok: false, error: String(e && e.message || e), meta: e && e.meta ? e.meta : undefined });
}

/**
 * GET /api/chatbot-admin/meta/templates
 * Lista templates Meta sincronizados no cache local.
 */
router.get("/chatbot-admin/meta/templates", requireAdminAuth, async (req, res) => {
  try {
    const tenant = normalizeTenantParam(req.query.tenant);
    const templates = await listTemplates(tenant);
    return res.json({ ok: true, templates });
  } catch (e) {
    return metaRouteError(res, e);
  }
});

/**
 * POST /api/chatbot-admin/meta/templates/sync
 * Sincroniza templates diretamente da Cloud API da Meta.
 */
router.post("/chatbot-admin/meta/templates/sync", requireAdminAuth, async (req, res) => {
  try {
    const tenant = normalizeTenantParam(req.body && req.body.tenant || req.query.tenant);
    const sync = await syncMetaTemplates(tenant);
    const templates = await listTemplates(tenant);
    return res.json({ ok: true, sync, templates });
  } catch (e) {
    return metaRouteError(res, e);
  }
});

function defaultMetaTemplateVariables(template, phone) {
  const values = ["Teste DC NET", "Brasília", phone || "556199999999", "Cliente", "DC NET"];
  const out = {};
  (template.variableKeys || []).forEach((item, idx) => {
    out[item.key] = values[idx] || ("Valor " + (idx + 1));
  });
  return out;
}

function defaultTemplateHeaderImage(req) {
  return process.env.META_TEMPLATE_TEST_HEADER_IMAGE_URL || publicBaseUrl(req) + "/chatbot-admin/icons/icon-512.png";
}

/**
 * POST /api/chatbot-admin/meta/templates/test
 * Envia sempre via Template Meta aprovado, sem mensagem livre, para validar fora da janela de 24h.
 */
router.post("/chatbot-admin/meta/templates/test", requireAdminAuth, async (req, res) => {
  try {
    const tenant = normalizeTenantParam(req.body && req.body.tenant);
    const to = normalizeConversationPhone(req.body && req.body.to);
    if (!to) return res.status(400).json({ ok: false, error: "phone_required", message: "Informe número de teste." });
    const templates = await listTemplates(tenant);
    const templateId = String(req.body?.templateId || "").trim();
    const templateName = String(req.body?.templateName || "").trim();
    const tpl = templates.find((t) => (templateId && String(t.id) === templateId) || (templateName && t.name === templateName));
    if (!tpl) return res.status(404).json({ ok: false, error: "template_not_found" });
    if (String(tpl.status || "").toUpperCase() !== "APPROVED") return res.status(400).json({ ok: false, error: "template_not_approved", templateName: tpl.name, friendlyName: getFriendlyTemplateName(tpl.name), status: tpl.status || "" });

    const variables = req.body?.variables && typeof req.body.variables === "object" ? req.body.variables : defaultMetaTemplateVariables(tpl, to);
    const headerImageUrl = String(req.body?.headerImageUrl || "").trim() || (tpl.needsHeaderImage ? defaultTemplateHeaderImage(req) : "");
    const components = buildComponentsFromTemplate(tpl, { variables, headerImageUrl });
    const sent = await sendWhatsAppTemplate(to, tpl.name, tpl.language || "pt_BR", components, {
      tenant,
      origin: "meta_template_test",
      templateName: tpl.name,
      languageCode: tpl.language || "pt_BR",
      templateVariables: variables,
      templateComponents: components,
      responseKind: "template_test",
      auditAction: "template_test",
      auditBy: req.admin?.email || String(req.admin?._id || ""),
    });
    const wamid = sent?.messages?.[0]?.id || "";
    return res.json({ ok: true, templateName: tpl.name, friendlyName: getFriendlyTemplateName(tpl.name), status: "enviado", wamid, error: null });
  } catch (e) {
    const translated = translateMetaError(e.meta || e.metaError || e);
    const templateName = String(req.body?.templateName || "");
    return res.status(e.status || 500).json({ ok: false, templateName, friendlyName: getFriendlyTemplateName(templateName), status: "falhou", wamid: "", error: { code: translated.code, message: translated.reason, details: translated.details, meta: e.meta || e.metaError || null } });
  }
});

/**
 * POST /api/chatbot-admin/meta/templates/send
 * Tenta mensagem livre e, se a Meta retornar 131047, envia o template selecionado automaticamente.
 */
router.post("/chatbot-admin/meta/templates/send", requireAdminAuth, async (req, res) => {
  try {
    const tenant = normalizeTenantParam(req.body && req.body.tenant);
    const result = await sendTemplateSmart({
      tenant,
      to: req.body && req.body.to,
      templateId: req.body && req.body.templateId,
      templateName: req.body && req.body.templateName,
      language: req.body && req.body.language,
      variables: req.body && req.body.variables,
      headerImageUrl: req.body && req.body.headerImageUrl,
      freeMessage: req.body && req.body.freeMessage,
    });
    return res.json({ ok: true, result });
  } catch (e) {
    return metaRouteError(res, e);
  }
});

/**
 * GET /api/chatbot-admin/meta/history
 */
router.get("/chatbot-admin/meta/history", requireAdminAuth, async (req, res) => {
  try {
    const tenant = normalizeTenantParam(req.query.tenant);
    const rows = await metaHistory(tenant, req.query.limit);
    return res.json({ ok: true, rows });
  } catch (e) {
    return metaRouteError(res, e);
  }
});

/**
 * GET /api/chatbot-admin/meta/stats
 */
router.get("/chatbot-admin/meta/stats", requireAdminAuth, async (req, res) => {
  try {
    const tenant = normalizeTenantParam(req.query.tenant);
    const stats = await metaDashboard(tenant);
    return res.json({ ok: true, stats });
  } catch (e) {
    return metaRouteError(res, e);
  }
});

module.exports = router;
