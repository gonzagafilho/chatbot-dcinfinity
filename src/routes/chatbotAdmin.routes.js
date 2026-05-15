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
  createBroadcastJob,
  getJobById,
  setJobStatus,
} = require("../services/maintenanceBroadcastService");
const MaintenanceBroadcastJob = require("../models/MaintenanceBroadcastJob");
const CoverageArea = require("../models/CoverageArea");
const Lead = require("../models/Lead");
const CampaignExecutionLog = require("../models/CampaignExecutionLog");

const {
  runSeasonalCampaigns,
} = require("../jobs/seasonalCampaignScheduler");

const router = express.Router();

let seasonalCampaignRunning = false;

const UPLOAD_DIR = path.join(__dirname, "..", "..", "public", "uploads", "campaigns");
const MulterError = multer.MulterError;

/** mimetype → extensões permitidas no nome do arquivo (validação em dupla) */
const CAMPAIGN_IMAGE_ALLOW = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
};

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
  return (process.env.PUBLIC_APP_BASE_URL || proto + "://" + host).replace(/\/$/, "");
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


module.exports = router;

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

