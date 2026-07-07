"use strict";

const MetaTemplate = require("../models/MetaTemplate");
const WaMessage = require("../models/WaMessage");
const { sendWhatsAppText, sendWhatsAppTemplate } = require("./whatsappSend");

function digitsOnly(s) { return String(s || "").replace(/\D/g, ""); }
function normalizePhone(input) {
  let d = digitsOnly(input);
  if (d.startsWith("0")) d = d.slice(1);
  if (!d.startsWith("55") && d.length >= 10 && d.length <= 11) d = "55" + d;
  return d;
}
function isValidPhone(d) { return /^\d{10,15}$/.test(String(d || "")); }
function getMetaConfig() {
  return {
    token: process.env.WHATSAPP_TOKEN,
    wabaId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || process.env.WABA_ID || process.env.META_WABA_ID || process.env.WHATSAPP_WABA_ID || "",
  };
}
function parseQuality(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return String(value.score || value.quality_score || value.status || "");
}
function extractVariablesFromText(text, prefix) {
  const out = [];
  const seen = new Set();
  const re = /{{\s*(\d+)\s*}}/g;
  let m;
  while ((m = re.exec(String(text || "")))) {
    const key = String(prefix || "body") + "_" + m[1];
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ key, index: Number(m[1]), label: "Variável " + m[1], scope: prefix || "body" });
    }
  }
  return out;
}
function analyzeTemplate(tpl) {
  const components = Array.isArray(tpl.components) ? tpl.components : [];
  let needsHeaderImage = false;
  const variableKeys = [];
  for (const c of components) {
    const type = String(c.type || "").toUpperCase();
    const format = String(c.format || "").toUpperCase();
    if (type === "HEADER" && format === "IMAGE") needsHeaderImage = true;
    if ((type === "HEADER" || type === "BODY") && c.text) variableKeys.push(...extractVariablesFromText(c.text, type.toLowerCase()));
  }
  return { needsHeaderImage, variableKeys };
}
function favoriteKind(tpl) {
  const name = String(tpl && tpl.name || "").toLowerCase();
  const cat = String(tpl && tpl.category || "").toLowerCase();
  if (name.includes("promoc") || name.includes("fibra")) return "Promoção Fibra";
  if (name.includes("cobr") || name.includes("boleto") || name.includes("pix")) return "Cobrança";
  if (name.includes("manut") || name.includes("instab")) return "Manutenção";
  if (name.includes("anivers") || name.includes("birthday")) return "Aniversário";
  if (name.includes("indique") || name.includes("ganhe") || name.includes("refer")) return "Indique e Ganhe";
  if (cat.includes("marketing")) return "Campanha";
  return "";
}
function toClientTemplate(doc, statsByName) {
  const o = doc.toObject ? doc.toObject() : doc;
  const stats = (statsByName || {})[o.name] || {};
  const fav = favoriteKind(o);
  return {
    id: String(o._id || ""), metaId: o.metaId || "", name: o.name || "", category: o.category || "",
    language: o.language || "", status: o.status || "", quality: o.quality || "",
    updatedAt: o.lastMetaUpdatedAt || o.updatedAt || null, lastSyncedAt: o.lastSyncedAt || null,
    components: o.components || [], variableKeys: o.variableKeys || [], needsHeaderImage: !!o.needsHeaderImage,
    favoriteLabel: fav, isFavorite: !!fav, lastSentAt: stats.lastSentAt || null, sentCount: stats.sentCount || 0,
  };
}
async function fetchAllTemplatesFromMeta() {
  const cfg = getMetaConfig();
  if (!cfg.token || !cfg.wabaId) { const err = new Error("meta_waba_config_missing"); err.code = "meta_waba_config_missing"; throw err; }
  const fields = "name,category,language,status,quality_score,components,last_updated_time,updated_time,id";
  let url = "https://graph.facebook.com/v25.0/" + encodeURIComponent(cfg.wabaId) + "/message_templates?fields=" + encodeURIComponent(fields) + "&limit=100";
  const all = [];
  while (url) {
    const resp = await fetch(url, { headers: { Authorization: "Bearer " + cfg.token } });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) { const err = new Error("meta_templates_sync_failed"); err.meta = data; err.status = resp.status; throw err; }
    if (Array.isArray(data.data)) all.push(...data.data);
    url = (data.paging && data.paging.next) || "";
  }
  return all;
}
async function syncMetaTemplates(tenant) {
  const t = String(tenant || "dcnet").trim().toLowerCase();
  const rows = await fetchAllTemplatesFromMeta();
  const now = new Date();
  let synced = 0;
  for (const tpl of rows) {
    const analysis = analyzeTemplate(tpl);
    const lastUpdatedRaw = tpl.last_updated_time || tpl.updated_time || null;
    const set = {
      tenant: t, metaId: String(tpl.id || ""), name: String(tpl.name || ""), category: String(tpl.category || ""),
      language: String(tpl.language || ""), status: String(tpl.status || ""), quality: parseQuality(tpl.quality_score),
      components: Array.isArray(tpl.components) ? tpl.components : [], variableKeys: analysis.variableKeys,
      needsHeaderImage: analysis.needsHeaderImage, lastMetaUpdatedAt: lastUpdatedRaw ? new Date(lastUpdatedRaw) : null,
      lastSyncedAt: now, raw: tpl,
    };
    await MetaTemplate.findOneAndUpdate({ tenant: t, name: set.name, language: set.language }, { $set: set }, { upsert: true, setDefaultsOnInsert: true });
    synced += 1;
  }
  return { synced, at: now };
}
async function templateSendStats(tenant) {
  const rows = await WaMessage.aggregate([
    { $match: { tenant, direction: "outbound", templateName: { $nin: [null, ""] } } },
    { $group: { _id: "$templateName", sentCount: { $sum: 1 }, lastSentAt: { $max: "$createdAt" } } },
  ]);
  return rows.reduce((acc, r) => { acc[r._id] = { sentCount: r.sentCount, lastSentAt: r.lastSentAt }; return acc; }, {});
}
async function listTemplates(tenant) {
  const t = String(tenant || "dcnet").trim().toLowerCase();
  const templates = await MetaTemplate.find({ tenant: t }).sort({ status: 1, name: 1, language: 1 }).lean();
  const stats = await templateSendStats(t);
  return templates.map((x) => toClientTemplate(x, stats)).sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite) || a.name.localeCompare(b.name));
}
async function getTemplateByIdOrName(p) {
  const where = { tenant: String(p.tenant || "dcnet").trim().toLowerCase() };
  if (p.id) where._id = p.id;
  else { where.name = p.name; if (p.language) where.language = p.language; }
  return MetaTemplate.findOne(where).lean();
}
function buildComponentsFromTemplate(template, opts) {
  opts = opts || {};
  const components = [];
  const byScope = { body: [], header: [] };
  const vars = opts.variables || {};
  for (const item of template.variableKeys || []) {
    const value = vars[item.key] != null ? vars[item.key] : vars[String(item.index)] || "";
    if (String(value).trim()) byScope[item.scope || "body"].push({ type: "text", text: String(value).trim() });
  }
  const imageUrl = String(opts.headerImageUrl || "").trim();
  if (template.needsHeaderImage && imageUrl) components.push({ type: "header", parameters: [{ type: "image", image: { link: imageUrl } }] });
  else if (byScope.header.length) components.push({ type: "header", parameters: byScope.header });
  if (byScope.body.length) components.push({ type: "body", parameters: byScope.body });
  return components;
}
function isMeta131047(e) { return Number(e && (e.metaErrorCode || (e.meta && e.meta.error && e.meta.error.code)) || 0) === 131047; }
async function saveFailedSmartMessage(p) {
  try {
    await WaMessage.create({ tenant: p.tenant, channel: "whatsapp", origin: p.fallbackToTemplate ? "meta_smart_free_failed" : "meta_smart_send_failed", direction: "outbound", from: process.env.WHATSAPP_PHONE_NUMBER_ID || "", to: p.to, text: p.text, raw: p.raw, deliveryStatus: "failed", metaStatus: "failed", metaStatusAt: new Date(), failedAt: new Date(), metaError: p.raw, fallbackToTemplate: !!p.fallbackToTemplate });
  } catch (err) { console.error("❌ meta smart failed history:", err && err.message || err); }
}
async function sendTemplateSmart(p) {
  const tenant = String(p.tenant || "dcnet").trim().toLowerCase();
  const phone = normalizePhone(p.to);
  if (!isValidPhone(phone)) { const err = new Error("invalid_phone"); err.code = "invalid_phone"; throw err; }
  const template = await getTemplateByIdOrName({ tenant, id: p.templateId, name: p.templateName, language: p.language });
  if (!template) { const err = new Error("template_not_found"); err.code = "template_not_found"; throw err; }
  const freeText = String(p.freeMessage || "").trim();
  let freeMeta = null;
  if (freeText) {
    try {
      const sentFree = await sendWhatsAppText(phone, freeText, { origin: "meta_smart_free", tenant });
      return { mode: "free", fallbackToTemplate: false, template: toClientTemplate(template), meta: sentFree };
    } catch (e) {
      freeMeta = e.meta || e.metaError || { error: String(e.message || e) };
      await saveFailedSmartMessage({ tenant, to: phone, text: freeText, raw: freeMeta, fallbackToTemplate: isMeta131047(e) });
      if (!isMeta131047(e)) throw e;
    }
  }
  const components = buildComponentsFromTemplate(template, { variables: p.variables, headerImageUrl: p.headerImageUrl });
  const sentTemplate = await sendWhatsAppTemplate(phone, template.name, template.language, components, { origin: freeText ? "meta_template_fallback" : "meta_template_direct", tenant, templateName: template.name, languageCode: template.language, templateVariables: p.variables || {}, templateComponents: components, fallbackToTemplate: !!freeText });
  return { mode: freeText ? "fallback_template" : "template", fallbackToTemplate: !!freeText, template: toClientTemplate(template), components, meta: sentTemplate, freeMeta };
}
async function metaDashboard(tenant) {
  const t = String(tenant || "dcnet").trim().toLowerCase();
  const templates = await MetaTemplate.find({ tenant: t }).lean();
  const counts = await WaMessage.aggregate([{ $match: { tenant: t, direction: "outbound", templateName: { $nin: [null, ""] } } }, { $group: { _id: "$metaStatus", count: { $sum: 1 } } }]);
  const byStatus = (s) => templates.filter((x) => String(x.status || "").toUpperCase() === s).length;
  const msg = counts.reduce((acc, r) => { acc[String(r._id || "sent")] = r.count; return acc; }, {});
  const sent = Object.values(msg).reduce((a, b) => a + Number(b || 0), 0);
  const delivered = Number(msg.delivered || 0), read = Number(msg.read || 0), failed = Number(msg.failed || msg.template_failed || 0);
  return { templatesApproved: byStatus("APPROVED"), templatesPending: byStatus("PENDING"), templatesRejected: byStatus("REJECTED"), sent, delivered, read, failed, deliveryRate: sent ? Number((delivered / sent * 100).toFixed(1)) : 0, readRate: delivered ? Number((read / delivered * 100).toFixed(1)) : 0 };
}
async function metaHistory(tenant, limit) {
  const rows = await WaMessage.find({ tenant, direction: "outbound", $or: [{ templateName: { $nin: [null, ""] } }, { origin: /template/ }] }).sort({ createdAt: -1 }).limit(Number(limit) || 80).lean();
  return rows.map((r) => ({ id: String(r._id), templateName: r.templateName || "", languageCode: r.languageCode || "", templateVariables: r.templateVariables || null, status: r.deliveryStatus || r.metaStatus || "sent", metaStatus: r.metaStatus || "", createdAt: r.createdAt, wamid: r.wamid || "", to: r.to || "", fallbackToTemplate: !!r.fallbackToTemplate, raw: r.raw || null }));
}
module.exports = { syncMetaTemplates, listTemplates, sendTemplateSmart, metaDashboard, metaHistory, buildComponentsFromTemplate };
