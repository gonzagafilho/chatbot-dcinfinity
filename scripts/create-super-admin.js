"use strict";

require("dotenv").config();
const bcrypt = require("bcryptjs");

const { connectDB } = require("../src/config/db");
const Admin = require("../src/models/Admin");

(async () => {
  try {
    await connectDB();

    const email = "dc.net.infinity@gmail.com";
    const senha = "Marilene0310";
    const nome = "Administrador Master";

    const passwordHash = await bcrypt.hash(senha, 10);

    let admin = await Admin.findOne({ email });

    if (admin) {
      admin.passwordHash = passwordHash;
      admin.nome = admin.nome || nome;
      admin.active = true;
      admin.role = admin.role || "ADMIN";
      await admin.save();
      console.log("✅ Admin atualizado (senha redefinida).");
    } else {
      await Admin.create({
        email,
        nome,
        passwordHash,
        role: "ADMIN",
        active: true,
      });
      console.log("✅ Admin criado com sucesso.");
    }

    process.exit(0);
  } catch (err) {
    console.error("❌ Erro:", err);
    process.exit(1);
  }
})();