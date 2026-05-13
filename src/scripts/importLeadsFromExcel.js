"use strict";

require("dotenv").config();

const mongoose = require("mongoose");
const xlsx = require("xlsx");
const Lead = require("../models/Lead");

function digitsOnly(s) {
  return String(s || "").replace(/\D/g, "");
}

function normalizePhone(phone) {
  const d = digitsOnly(phone);
  if (!d) return null;

  if (d.length === 11 && !d.startsWith("55")) {
    return "55" + d;
  }

  if (d.length === 10) {
    return "55" + d;
  }

  return d;
}

function formatBirthday(dateStr) {
  if (!dateStr) return null;

  const parts = String(dateStr).split("/");
  if (parts.length !== 3) return null;

  return `${parts[2]}-${parts[1]}-${parts[0]}`; // yyyy-mm-dd
}

async function main() {
  console.log("📥 Importando clientes do Excel...");

  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);

  const path = require("path");

  const filePath = path.join(__dirname, "../../data/clientes-1777133577.xlsx");

  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet);

  console.log("📊 Total no Excel:", rows.length);

  let created = 0;
  let updated = 0;
  let ignored = 0;

  for (const r of rows) {
    const phone = normalizePhone(r["Celular 1"]);
    if (!phone) {
      ignored++;
      continue;
    }

    const name = String(r["Nome"] || "Cliente").trim();

    const birthday = formatBirthday(r["Data de Nascimento"]);

    const exists = await Lead.findOne({ phone });

    if (!exists) {
      await Lead.create({
        tenant: "dcnet",
        phone,
        name,
        birthday,
        beeswebCustomerId: String(r["ID"] || ""),
        origin: "import_excel",
        channel: "whatsapp"
      });
      created++;
    } else {
      await Lead.updateOne(
        { _id: exists._id },
        {
          $set: {
            name,
            birthday,
            beeswebCustomerId: String(r["ID"] || "")
          }
        }
      );
      updated++;
    }
  }

  console.log("✅ FINALIZADO");
  console.log("🆕 Criados:", created);
  console.log("🔄 Atualizados:", updated);
  console.log("⚠️ Ignorados:", ignored);

  await mongoose.disconnect();
}

main();
