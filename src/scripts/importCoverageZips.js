require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const CoverageZip = require("../models/CoverageZip");

const mongoUri =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  "mongodb://127.0.0.1:27017/dcnet";

function normalizeCep(input) {
  return String(input || "").replace(/\D/g, "").slice(0, 8);
}

async function main() {
  const file = path.join(process.cwd(), "data", "coverage-dcnet-ceps.tsv");
  const raw = fs.readFileSync(file, "utf8");

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.toLowerCase().startsWith("logradouro"));

  await mongoose.connect(mongoUri);

  let imported = 0;
  let skipped = 0;

  for (const line of lines) {
    const parts = line.split(/\t+/).map((p) => p.trim());

    if (parts.length < 4) {
      skipped++;
      continue;
    }

    const [logradouro, bairro, localidadeUf, cepRaw] = parts;
    const cep = normalizeCep(cepRaw);

    if (!/^\d{8}$/.test(cep)) {
      skipped++;
      continue;
    }

    const [cidadeRaw, ufRaw] = localidadeUf.split("/");
    const cidade = (cidadeRaw || "Brasília").trim();
    const uf = (ufRaw || "DF").trim();

    await CoverageZip.findOneAndUpdate(
      { tenant: "dcnet", cep },
      {
        $set: {
          tenant: "dcnet",
          cep,
          logradouro,
          bairro,
          cidade,
          uf,
          status: "covered",
          technology: "fibra",
          notes: "Cobertura DC NET importada por CEP",
          active: true,
        },
      },
      { upsert: true, new: true }
    );

    imported++;
  }

  const total = await CoverageZip.countDocuments({ tenant: "dcnet", active: true });

  console.log("OK: importação concluída");
  console.log("Importados/atualizados:", imported);
  console.log("Ignorados:", skipped);
  console.log("Total ativo no banco:", total);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("ERRO:", err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
