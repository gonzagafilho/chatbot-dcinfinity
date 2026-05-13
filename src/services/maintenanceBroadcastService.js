"use strict";

const MaintenanceBroadcastJob = require("../models/MaintenanceBroadcastJob");
const Lead = require("../models/Lead");
const { sendWhatsAppText, sendWhatsAppImage } = require("./whatsappSend");
const {
  collectAllCustomers,
  filterCustomersByAudienceList,
  filterByActiveContract,
  buildPhoneList,
  maskFromDigits,
} = require("../integrations/beesweb/broadcastCustomerList");
const { isBeeswebConfigured } = require("../config/beesweb");

const CONFIRM_PHRASE = "CONFIRMAR ENVIO DC NET";
const MAX_LOGS = 400;

const AUDIENCE_LABELS = {
  all: "Todos os clientes",
  active: "Somente clientes ativos",
  contract: "Somente clientes com contrato ativo",
};

function digitsOnly(s) {
  return String(s || "").replace(/\D/g, "");
}

function normalizeBrazilPhone(input) {
  let d = String(input || "").replace(/\D/g, "");

  // remove 0 inicial
  if (d.startsWith("0")) d = d.slice(1);

  // adiciona DDI Brasil se não tiver
  if (d.length === 10 || d.length === 11) {
    d = "55" + d;
  }

  // garantir celular com 9 dígitos
  if (d.length === 12) {
    // exemplo: 556198888888 → pode estar faltando 9
    d = d.slice(0, 4) + "9" + d.slice(4);
  }

  return d;
}

function normalizeReturnText(body) {
  if (!body || typeof body !== "object") return "";
  if (body.returnText != null && String(body.returnText).trim()) return String(body.returnText).trim();
  if (body.expectedReturn != null && String(body.expectedReturn).trim()) {
    return String(body.expectedReturn).trim();
  }
  return "";
}

function normalizePayload(body) {
  if (!body || typeof body !== "object") {
    return { error: "invalid_body" };
  }
  const tenant = String(body.tenant || "dcnet")
    .trim()
    .toLowerCase() || "dcnet";
  const title = String(body.title != null ? body.title : "").trim();
  const message = String(body.message != null ? body.message : "").trim();
  const returnText = normalizeReturnText(body);
  const rawAudience = String(body.audience || "all")
    .trim()
    .toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(AUDIENCE_LABELS, rawAudience)) {
    return { error: "invalid_audience" };
  }
  return {
    tenant,
    title,
    message,
    returnText,
    audience: rawAudience,
  };
}

function buildComposedText({ title, message, returnText }) {
  const parts = [];
  if (title) parts.push(title);
  if (message) parts.push(message);
  if (returnText) parts.push("Retorno previsto: " + returnText);
  return parts.length ? parts.join("\n\n") : "";
}

/**
 * Fuso: America/Sao_Paulo — de segunda a sexta, 9h a menos de 18h (9–17:59 local).
 * Ajuste via env: MAINTENANCE_BROADCAST_BH_WEEKDAYS, MAINTENANCE_BROADCAST_BH_START (0–23), MAINTENANCE_BROADCAST_BH_END
 */
function isWithinBrazilBusinessWindow() {
  const now = new Date();
  const wk = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" }).format(now);
  if (["Sat", "Sun"].includes(wk)) {
    if ((process.env.MAINTENANCE_BROADCAST_ALLOW_WEEKENDS || "") === "1") return true;
    return false;
  }
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hour = parseInt(
    (parts.find((p) => p.type === "hour") || { value: "0" }).value,
    10
  ) || 0;
  const startH = Math.max(0, Math.min(22, parseInt(process.env.MAINTENANCE_BROADCAST_BH_START || "9", 10) || 9));
  const endH = Math.max(0, Math.min(23, parseInt(process.env.MAINTENANCE_BROADCAST_BH_END || "18", 10) || 18));
  if (endH > startH) {
    if (hour < startH) return false;
    if (hour >= endH) return false;
    return true;
  }
  return true;
}

function isValidE164ish(d) {
  if (!d) return false;
  if (d.length < 10 || d.length > 15) return false;
  if (!/^\d+$/.test(d)) return false;
  return true;
}

/**
 * Alinha sentCount/failedCount com totais e recalcula successRate.
 * (totalSent/totalFailed permanecem a fonte de incremento do worker; métricas espelhadas)
 */
function syncBroadcastMetrics(job) {
  if (!job) return;
  const ts = job.totalSent != null ? job.totalSent : 0;
  const tf = job.totalFailed != null ? job.totalFailed : 0;
  job.sentCount = ts;
  job.failedCount = tf;
  const t = (job.sentCount || 0) + (job.failedCount || 0);
  job.successRate = t > 0 ? Math.round(((job.sentCount || 0) / t) * 100) : 0;
}

/**
 * Grava conclusão do lote: métricas + completedAt (só when status=completed)
 */
function finalizeJobCompletionFields(job) {
  if (!job) return;
  if (String(job.status) === "completed" && !job.completedAt) {
    job.completedAt = new Date();
  }
  job.finishedAt = job.finishedAt || new Date();
  syncBroadcastMetrics(job);
}

/**
 * @returns {Promise<{ customers: any[], phoneList: string[] }>}
 */
async function resolveRecipientPhones(audience, tenant = "dcnet") {
  const query = {
    tenant: String(tenant || "dcnet").trim().toLowerCase() || "dcnet",
    phone: { $exists: true, $ne: null },
    campaignOptIn: { $ne: false },
  };

  const leads = await Lead.find(query, {
    _id: 1,
    phone: 1,
    name: 1,
    beeswebCustomerId: 1,
    campaignOptIn: 1,
  }).lean();

  const phoneList = buildPhoneList(leads);

  return { customers: leads, phoneList };
}

async function previewBroadcast(body) {
  const n = normalizePayload(body);
  if (n.error) return { ok: false, error: n.error };
  if (!n.title && !n.message) {
    return { ok: false, error: "title_or_message_required" };
  }
  const composedMessage = buildComposedText(n);
  let estimatedCount = 0;
  let sampleMaskedPhones = [];
  try {
    const { phoneList } = await resolveRecipientPhones(n.audience, n.tenant);
    estimatedCount = phoneList.length;
    sampleMaskedPhones = phoneList.slice(0, 8).map((p) => maskFromDigits(p));
  } catch (e) {
    if (e && (e.code === "BEESWEB_NOT_CONFIGURED" || String(e.message).includes("beesweb"))) {
      return { ok: false, error: "beesweb_not_configured" };
    }
    throw e;
  }
  return {
    ok: true,
    estimatedCount,
    sampleMaskedPhones,
    composedMessage,
    audience: n.audience,
    audienceLabel: AUDIENCE_LABELS[n.audience],
    warning: "Prévia apenas. Nenhuma mensagem foi enviada.",
  };
}

async function sendTestBroadcast(reqBody, adminEmail) {
  const n = normalizePayload(reqBody);
  if (n.error) return { err: 400, body: { ok: false, error: n.error } };
  if (!n.title && !n.message) {
    return { err: 400, body: { ok: false, error: "title_or_message_required" } };
  }
  const testPhoneRaw = String(reqBody.testPhone != null ? reqBody.testPhone : "").trim();
  let d = normalizeBrazilPhone(testPhoneRaw);

  console.log("PHONE FINAL NORMALIZED:", d);

  if (!isValidE164ish(d)) {
    return { err: 400, body: { ok: false, error: "test_phone_invalid" } };
  }
  const text = buildComposedText(n);
  if (!text) {
    return { err: 400, body: { ok: false, error: "empty_composed" } };
  }
  let sent;

  const imageUrlOriginal = String(reqBody.imageUrl != null ? reqBody.imageUrl : "");
  let imageUrl = imageUrlOriginal;

  // limpeza agressiva
  imageUrl = imageUrl
    .replace(/\s+/g, "") // remove espaços e quebras
    .replace(/[\u200B-\u200D\uFEFF]/g, "") // remove caracteres invisíveis
    .trim();

  // validação forte
  if (imageUrl && !/^https:\/\/.+\.(png|jpg|jpeg|webp)$/i.test(imageUrl)) {
    console.error("URL inválida detectada:", imageUrl);
    imageUrl = "";
  }

  const sendMode = imageUrl ? "image" : "text";
  console.log("[maintenance-broadcast/test:diag]", {
    at: new Date().toISOString(),
    admin: String(adminEmail || ""),
    testPhoneOriginal: testPhoneRaw,
    toDigitsE164ish: d,
    imageUrlOriginalLen: imageUrlOriginal.length,
    imageUrlOriginalSample: imageUrlOriginal.slice(0, 80) + (imageUrlOriginal.length > 80 ? "…" : ""),
    imageUrlClean: imageUrl,
    sendMode,
    composedTextLength: text.length,
  });

  if (imageUrl) {
    sent = await sendWhatsAppImage(d, imageUrl, text);
  } else {
    sent = await sendWhatsAppText(d, text, {});
  }

  try {
    console.log(
      "[maintenance-broadcast/test:meta-raw]",
      JSON.stringify(sent, null, 2)
    );
  } catch (e) {
    console.log("[maintenance-broadcast/test:meta-raw] (não-JSON)", sent);
  }

  const sentToMasked = maskFromDigits(d);
  console.log("[maintenance-broadcast/test] sent", {
    at: new Date().toISOString(),
    admin: String(adminEmail || ""),
    toMasked: sentToMasked,
  });
  return {
    ok: true,
    out: {
      ok: true,
      sent: true,
      sentToMasked,
      composedMessage: text,
      warning: "Apenas número de teste. Não foi criado lote de envio em massa.",
      meta: sent,
    },
  };
}

/**
 * Cria lote. Não envia no request.
 */
async function createBroadcastJob(body, admin) {
  const n = normalizePayload(body);
  if (n.error) return { err: 400, body: { ok: false, error: n.error } };
  if (body.confirmPhrase !== CONFIRM_PHRASE) {
    return { err: 400, body: { ok: false, error: "invalid_confirm_phrase" } };
  }
  if (body.previewAccepted !== true) {
    return { err: 400, body: { ok: false, error: "preview_not_accepted" } };
  }
  if (!n.title && !n.message) {
    return { err: 400, body: { ok: false, error: "title_or_message_required" } };
  }
  const allowOutside = body.allowOutsideBusinessHours === true;
  if (!allowOutside && !isWithinBrazilBusinessWindow()) {
    return {
      err: 400,
      body: {
        ok: false,
        error: "outside_business_hours",
        hint: "Reenvie com allowOutsideBusinessHours: true para autorizar fora do horário comercial (Brasil).",
      },
    };
  }
  const composedText = buildComposedText(n);
  if (!composedText) {
    return { err: 400, body: { ok: false, error: "empty_composed" } };
  }
  let phoneList;
  try {
    const resolved = await resolveRecipientPhones(n.audience);
    phoneList = resolved.phoneList;
  } catch (e) {
    if (e && (e.code === "BEESWEB_NOT_CONFIGURED" || String(e.message || "").includes("beesweb_not_configured"))) {
      return { err: 503, body: { ok: false, error: "beesweb_not_configured" } };
    }
    return { err: 500, body: { ok: false, error: String(e && e.message ? e.message : e) } };
  }
  if (!phoneList.length) {
    return { err: 400, body: { ok: false, error: "no_recipients" } };
  }
  const createdBy = {
    id: String((admin && admin._id) || ""),
    email: String((admin && admin.email) || ""),
  };
  const job = await MaintenanceBroadcastJob.create({
    tenant: n.tenant,
    title: n.title,
    message: n.message,
    imageUrl: body.imageUrl || "",
    returnText: n.returnText,
    audience: n.audience,
    composedText,
    status: "queued",
    totalEstimated: phoneList.length,
    totalQueued: phoneList.length,
    totalSent: 0,
    totalFailed: 0,
    sentCount: 0,
    failedCount: 0,
    successRate: 0,
    phoneQueue: phoneList,
    currentIndex: 0,
    createdBy,
  });
  console.log("[maintenance-broadcast/create]", {
    at: new Date().toISOString(),
    jobId: String(job._id),
    totalQueued: phoneList.length,
    admin: createdBy.email,
  });
  return {
    ok: true,
    out: {
      ok: true,
      jobId: String(job._id),
      status: job.status,
      totalQueued: phoneList.length,
      warning: "Lote enfileirado. O envio ocorre em segundo plano com taxa controlada.",
    },
  };
}

function jobToPublicView(job) {
  if (!job) return null;
  const o = job.toObject ? job.toObject() : job;
  return {
    id: String(o._id),
    tenant: o.tenant,
    status: o.status,
    totalEstimated: o.totalEstimated,
    totalQueued: o.totalQueued,
    totalSent: o.totalSent,
    totalFailed: o.totalFailed,
    sentCount: o.sentCount != null ? o.sentCount : o.totalSent,
    failedCount: o.failedCount != null ? o.failedCount : o.totalFailed,
    successRate: o.successRate != null ? o.successRate : 0,
    currentIndex: o.currentIndex,
    phoneQueueSize: Array.isArray(o.phoneQueue) ? o.phoneQueue.length : 0,
    pending: Math.max(
      0,
      (Array.isArray(o.phoneQueue) ? o.phoneQueue.length : 0) - (o.currentIndex || 0)
    ),
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    startedAt: o.startedAt,
    finishedAt: o.finishedAt,
    completedAt: o.completedAt,
    canceledAt: o.canceledAt,
    audience: o.audience,
    lastError: o.lastError,
    title: o.title,
    messagePreview: o.message ? o.message.slice(0, 200) : "",
    imageUrl: o.imageUrl || "",
    logs: (o.logs || [])
      .slice(-40)
      .map((L) => ({
        at: L.at,
        phoneMasked: L.phoneMasked,
        status: L.status,
        error: L.error || undefined,
      })),
  };
}

async function getJobById(id) {
  if (!id || !String(id).match(/^[a-fA-F0-9]{24}$/)) {
    return { err: 400, body: { ok: false, error: "invalid_id" } };
  }
  const job = await MaintenanceBroadcastJob.findById(id);
  if (!job) return { err: 404, body: { ok: false, error: "not_found" } };
  return { ok: true, job: jobToPublicView(job) };
}

async function setJobStatus(id, next) {
  const job = await MaintenanceBroadcastJob.findById(id);
  if (!job) return { err: 404, body: { ok: false, error: "not_found" } };
  const s = job.status;
  if (next === "paused") {
    if (s !== "queued" && s !== "running") {
      return { err: 400, body: { ok: false, error: "cannot_pause" } };
    }
    job.status = "paused";
  } else if (next === "canceled") {
    if (s !== "queued" && s !== "running" && s !== "paused") {
      return { err: 400, body: { ok: false, error: "cannot_cancel" } };
    }
    job.status = "canceled";
    job.canceledAt = new Date();
  } else if (next === "resumed") {
    if (s !== "paused") {
      return { err: 400, body: { ok: false, error: "cannot_resume" } };
    }
    const otherRunning = await MaintenanceBroadcastJob.findOne({
      _id: { $ne: job._id },
      status: "running",
    });
    if (otherRunning) {
      job.status = "queued";
    } else {
      job.status = "running";
      if (!job.startedAt) job.startedAt = new Date();
    }
  } else {
    return { err: 400, body: { ok: false, error: "invalid_op" } };
  }
  await job.save();
  return { ok: true, out: { ok: true, job: jobToPublicView(job) } };
}

const PER_TICK = Math.max(
  1,
  Math.min(3, parseInt(process.env.MAINTENANCE_BROADCAST_PER_TICK || "2", 10) || 2)
);

let workerInFlight = false;

async function processOneMessageStep(jobId) {
  const fresh = await MaintenanceBroadcastJob.findById(jobId);
  if (!fresh) return;
  if (["paused", "canceled", "failed", "completed"].includes(fresh.status)) return;
  if (fresh.currentIndex >= (fresh.phoneQueue || []).length) {
    if (fresh.status === "running" || fresh.status === "queued") {
      fresh.status = "completed";
      finalizeJobCompletionFields(fresh);
      await fresh.save();
    }
    return;
  }
  const to = fresh.phoneQueue[fresh.currentIndex];
  if (to == null) return;
  if (!isValidE164ish(to)) {
    fresh.logs = fresh.logs || [];
    fresh.logs.push({ at: new Date(), phoneMasked: "****", status: "invalid_phone", error: "invalid" });
    if (fresh.logs.length > MAX_LOGS) fresh.logs = fresh.logs.slice(-MAX_LOGS);
    fresh.currentIndex += 1;
    fresh.totalFailed += 1;
    syncBroadcastMetrics(fresh);
    if (fresh.currentIndex >= (fresh.phoneQueue || []).length) {
      fresh.status = "completed";
      finalizeJobCompletionFields(fresh);
    } else {
      fresh.status = "running";
    }
    await fresh.save();
    return;
  }
  const masked = maskFromDigits(to);
  if (["paused", "canceled", "failed", "completed"].includes(fresh.status)) return;
  try {
    if (fresh.imageUrl) {
      await sendWhatsAppText(to, fresh.composedText + "\n\n" + fresh.imageUrl, {});
    } else {
      await sendWhatsAppText(to, fresh.composedText, {});
    }
    fresh.logs = fresh.logs || [];
    fresh.logs.push({ at: new Date(), phoneMasked: masked, status: "sent" });
    if (fresh.logs.length > MAX_LOGS) fresh.logs = fresh.logs.slice(-MAX_LOGS);
    fresh.currentIndex += 1;
    fresh.totalSent += 1;
  } catch (e) {
    const msg = (e && e.message) || String(e);
    fresh.logs = fresh.logs || [];
    fresh.logs.push({ at: new Date(), phoneMasked: masked, status: "error", error: msg.slice(0, 200) });
    if (fresh.logs.length > MAX_LOGS) fresh.logs = fresh.logs.slice(-MAX_LOGS);
    fresh.currentIndex += 1;
    fresh.totalFailed += 1;
  }
  syncBroadcastMetrics(fresh);
  const done = fresh.currentIndex >= (fresh.phoneQueue || []).length;
  if (done) {
    fresh.status = "completed";
    finalizeJobCompletionFields(fresh);
  } else {
    fresh.status = "running";
  }
  await fresh.save();
}

async function runWorkerTick() {
  if (workerInFlight) return;
  workerInFlight = true;
  try {
    let run = await MaintenanceBroadcastJob.findOne({ status: "running" }).sort({ createdAt: 1 });
    if (!run) {
      run = await MaintenanceBroadcastJob.findOneAndUpdate(
        { status: "queued" },
        { $set: { status: "running", startedAt: new Date() } },
        { sort: { createdAt: 1 }, returnDocument: 'after' }
      );
    }
    if (!run) {
      return;
    }
    for (let t = 0; t < PER_TICK; t++) {
      const j = await MaintenanceBroadcastJob.findById(run._id);
      if (!j) return;
      if (j.status === "paused" || j.status === "canceled" || j.status === "failed" || j.status === "completed") {
        return;
      }
      if (j.currentIndex >= (j.phoneQueue || []).length) {
        if (j.status === "running" || j.status === "queued") {
          j.status = "completed";
          finalizeJobCompletionFields(j);
          await j.save();
        }
        return;
      }
      await processOneMessageStep(j._id);
    }
  } catch (e) {
    console.error("[maintenance-broadcast/worker] tick_error", e);
  } finally {
    workerInFlight = false;
  }
}

function startMaintenanceBroadcastWorker() {
  if ((process.env.MAINTENANCE_BROADCAST_DISABLED || "") === "1") {
    console.log("[maintenance-broadcast] worker desabilitado por env");
    return;
  }
  const intervalMs = Math.max(
    2000,
    Math.min(120_000, parseInt(process.env.MAINTENANCE_BROADCAST_INTERVAL_MS || "8000", 10) || 8000)
  );
  setInterval(() => {
    runWorkerTick().catch((e) => console.error(e));
  }, intervalMs);
  console.log(`[maintenance-broadcast] worker interval_ms=${intervalMs} per_tick=${PER_TICK}`);
}

module.exports = {
  CONFIRM_PHRASE,
  previewBroadcast,
  sendTestBroadcast,
  createBroadcastJob,
  getJobById,
  setJobStatus,
  runWorkerTick,
  startMaintenanceBroadcastWorker,
  isWithinBrazilBusinessWindow,
  jobToPublicView,
};
