const mongoose = require("mongoose");

let isConnected = false;

async function connectDB() {
  if (isConnected) return;

  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.warn("⚠️ MONGO_URI não definido no .env (Mongo desativado)");
    return;
  }

  mongoose.set("strictQuery", true);

  await mongoose.connect(uri, { autoIndex: true });

  isConnected = true;
  console.log("✅ MongoDB conectado");
}

module.exports = connectDB;
