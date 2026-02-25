"use strict";

require("dotenv").config();
const bcrypt = require("bcryptjs");
const { connectDB } = require("../src/config/db");
const Admin = require("../src/models/Admin");

(async () => {
  try {
    const email = process.argv[2];
    const newPassword = process.argv[3];

    if (!email || !newPassword) {
      console.log("Uso:");
      console.log("  node scripts/rotate-admin-password.js <email> <nova_senha>");
      process.exit(1);
    }

    await connectDB();

    const admin = await Admin.findOne({ email });
    if (!admin) {
      console.error("❌ Admin não encontrado:", email);
      process.exit(1);
    }

    admin.passwordHash = await bcrypt.hash(newPassword, 10);
    admin.active = true;
    await admin.save();

    console.log("✅ Senha do admin atualizada com sucesso:", email);
    process.exit(0);
  } catch (err) {
    console.error("❌ Erro rotate-admin-password:", err);
    process.exit(1);
  }
})();
