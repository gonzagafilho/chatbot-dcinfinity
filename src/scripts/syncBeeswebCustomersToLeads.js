"use strict";

require("dotenv").config();

const mongoose = require("mongoose");
const Lead = require("../models/Lead");
const { createBeeswebClient } = require("../integrations/beesweb/beeswebClient");

const HUMAN_ATTENDANT_PHONES = new Set([
  "5561996406911",
  "5561991374910",
]);

function digitsOnly(s) {
  return String(s || "").replace(/\D/g, "");
}

function normalizePhone(phone) {
  const d = digitsOnly(phone);
  if (!d) return null;
  if (d.length > 15) return null;
  if (d.length < 10) return null;
  if (d.length === 11 && !d.startsWith("55")) return "55" + d;
  if (d.length === 10 && !d.startsWith("55")) return "55" + d;
  return d;
}

function pickPhone(c) {
  return normalizePhone(
    c?.phone?.number_only ||
    c?.phone?.number ||
    c?.whatsapp ||
    c?.celular ||
    c?.telefone ||
    ""
  );
}

function pickName(c) {
  return String(c?.name || c?.nome || c?.razao_social || "Cliente").trim() || "Cliente";
}

function isActiveCustomer(c) {
  return (
    Number(c?.status) === 1 &&
    Number(c?.approved) === 1 &&
    !c?.deleted_at &&
    !c?.disabled_at
  );
}

async function main() {
  console.log("🔄 Iniciando sincronização paginada BeesWeb → Lead");

  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);

  const client = createBeeswebClient();

  if (!client.isConfigured) {
    console.log("❌ BeesWeb não configurada");
    process.exit(1);
  }

  const maxCustomers = Math.max(1, parseInt(process.env.BEESWEB_SYNC_MAX_CUSTOMERS || "500", 10) || 500);
  const maxPages = Math.ceil(maxCustomers / 15);

  let created = 0;
  let updated = 0;
  let ignored = 0;
  let inactive = 0;
  let totalRead = 0;

  const seenCustomerIds = new Set();
  const seenPhones = new Set();

  for (let page = 1; page <= maxPages; page++) {
    console.log(`📄 Buscando página ${page}/${maxPages}`);

    let raw;
    try {
      raw = await client.request("GET", "adm/customers", {
        query: { page }
      });
    } catch (err) {
      console.error("❌ Erro ao buscar página", page, err?.message || err);
      break;
    }

    const customers = Array.isArray(raw?.data) ? raw.data : [];

    if (!customers.length) {
      console.log("✅ Sem mais clientes na BeesWeb");
      break;
    }

    for (const c of customers) {
      if (totalRead >= maxCustomers) break;

      const customerId = c?.id || c?.customer_id || c?.customerId || null;
      const customerIdStr = customerId != null ? String(customerId).trim() : "";

      if (!customerIdStr || seenCustomerIds.has(customerIdStr)) {
        ignored++;
        continue;
      }

      seenCustomerIds.add(customerIdStr);

      const phone = pickPhone(c);
      if (!phone) {
        ignored++;
        continue;
      }

      if (HUMAN_ATTENDANT_PHONES.has(phone)) {
        console.log("[sync_beesweb] human_attendant_phone_skipped", {
          phone,
          customerId: customerIdStr,
        });
        ignored++;
        continue;
      }

      if (seenPhones.has(phone)) {
        ignored++;
        continue;
      }

      seenPhones.add(phone);

      const name = pickName(c);
      const active = isActiveCustomer(c);

      const payload = {
        name,
        beeswebCustomerId: customerIdStr,
        beeswebStatus: c?.status ?? null,
        beeswebApproved: c?.approved ?? null,
        beeswebDeletedAt: c?.deleted_at || null,
        beeswebDisabledAt: c?.disabled_at || null,
        campaignOptIn: active,
        status: active ? "ativo" : "inactive",
        beeswebInactiveAt: active ? null : new Date(),
        beeswebInactiveReason: active ? null : "beesweb_inactive",
        origin: "sync_beesweb",
        channel: "whatsapp"
      };

      const exists = await Lead.findOne({
        tenant: "dcnet",
        $or: [
          { beeswebCustomerId: customerIdStr },
          { phone }
        ]
      });

      const phoneOwner = await Lead.findOne({ tenant: "dcnet", phone });

      if (!exists && phoneOwner) {
        console.log("[sync_beesweb] duplicate_phone_skipped", {
          phone,
          customerId: customerIdStr,
          existingLeadId: String(phoneOwner._id),
        });
        ignored++;
        continue;
      }

      if (exists && phoneOwner && String(phoneOwner._id) !== String(exists._id)) {
        console.log("[sync_beesweb] phone_conflict_skipped", {
          phone,
          customerId: customerIdStr,
          existingLeadId: String(phoneOwner._id),
          targetLeadId: String(exists._id),
        });
        ignored++;
        continue;
      }

      if (!exists) {
        await Lead.create({
          tenant: "dcnet",
          phone,
          ...payload
        });
        created++;
      } else {
        await Lead.updateOne(
          { _id: exists._id },
          {
            $set: {
              phone,
              ...payload
            }
          }
        );
        updated++;
      }

      if (!active) inactive++;
      totalRead++;
    }

    if (totalRead >= maxCustomers) break;
    if (customers.length < 15) break;
  }

  console.log("✅ FINALIZADO");
  console.log("📥 Lidos da BeesWeb:", totalRead);
  console.log("🆕 Criados:", created);
  console.log("🔄 Atualizados:", updated);
  console.log("🚫 Inativos/arquivados:", inactive);
  console.log("⚠️ Ignorados/duplicados/sem telefone:", ignored);

  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error("❌ Falha no sync:", err?.message || err);
    try { await mongoose.disconnect(); } catch {}
    process.exit(1);
  });
}

module.exports = {
  main,
};
