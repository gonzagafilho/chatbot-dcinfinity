"use strict";

require("dotenv").config();
const { connectDB } = require("../src/config/db");
const Admin = require("../src/models/Admin");

(async () => {
  try {
    await connectDB();

    const KEEP_EMAIL = "dc.net.infinity@gmail.com";

    const before = await Admin.countDocuments();
    const del = await Admin.deleteMany({ email: { $ne: KEEP_EMAIL } });
    const after = await Admin.countDocuments();

    const remaining = await Admin.find().lean();

    console.log("✅ Cleanup Admins concluído");
    console.log("Manter:", KEEP_EMAIL);
    console.log("Antes:", before);
    console.log("Removidos:", del.deletedCount);
    console.log("Depois:", after);
    console.log("Restantes:", remaining);

    process.exit(0);
  } catch (err) {
    console.error("❌ Erro no cleanup-admins:", err);
    process.exit(1);
  }
})();
