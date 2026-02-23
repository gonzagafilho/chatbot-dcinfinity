"use strict";

require("dotenv").config();

const app = require("./app");
const { connectDB } = require("./config/db");

const PORT = process.env.PORT || 4010;

(async () => {
  try {
    await connectDB();
  } catch (e) {
    console.error("❌ Falha ao conectar no MongoDB:", e?.message || e);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ chatbot-dcinfinity ON: http://0.0.0.0:${PORT}`);
  });
})();
