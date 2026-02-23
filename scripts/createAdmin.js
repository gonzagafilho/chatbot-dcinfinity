import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import "dotenv/config";
import Admin from "../src/models/Admin.js";

const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
  console.log("Uso: node scripts/createAdmin.js email senha");
  process.exit(1);
}

await mongoose.connect(process.env.MONGO_URI);

const passwordHash = await bcrypt.hash(password, 12);

await Admin.findOneAndUpdate(
  { email },
  { $set: { email, passwordHash, active: true, role: "ADMIN" } },
  { upsert: true }
);

console.log("✅ Admin criado/atualizado:", email);
process.exit(0);