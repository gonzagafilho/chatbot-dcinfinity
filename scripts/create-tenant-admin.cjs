require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const TenantUser = require("../src/models/TenantUser.cjs");

async function main() {
  const tenant = process.argv[2];
  const name = process.argv[3];
  const email = process.argv[4];
  const password = process.argv[5];

  if (!tenant || !name || !email || !password) {
    console.log("Uso:");
    console.log("node scripts/create-tenant-admin.cjs <tenant> <name> <email> <password>");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);

  const passwordHash = await bcrypt.hash(String(password), 10);

  const user = await TenantUser.create({
    tenant: String(tenant).trim(),
    name: String(name).trim(),
    email: String(email).toLowerCase().trim(),
    role: "TENANT_ADMIN",
    active: true,
    passwordHash,
  });

  console.log("OK created:", {
    id: String(user._id),
    tenant: user.tenant,
    email: user.email,
    role: user.role,
  });

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
