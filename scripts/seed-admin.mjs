// scripts/seed-admin.mjs
//
// Creates (or updates the password for) the initial MIVA Hubble admin account.
//
// Usage:
//   node scripts/seed-admin.mjs --email admin@miva.edu.ng --password "Str0ng!Pass" --name "John Doe"
//
// Falls back to SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD / SEED_ADMIN_NAME env vars
// if flags aren't passed. Never hardcode real credentials in source control.

import dotenv from "dotenv";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

dotenv.config();

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const email = (arg("email") || process.env.SEED_ADMIN_EMAIL || "").trim().toLowerCase();
const password = arg("password") || process.env.SEED_ADMIN_PASSWORD;
const name = arg("name") || process.env.SEED_ADMIN_NAME || "Super Admin";

if (!email || !password) {
  console.error("Usage: node scripts/seed-admin.mjs --email <email> --password <password> [--name <name>]");
  process.exit(1);
}

if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const hashed = await bcrypt.hash(password, 12);

  const admin = await prisma.admin.upsert({
    where: { email },
    update: { password: hashed, name, status: "ACTIVE", failedLoginAttempts: 0, lockedUntil: null },
    create: { email, password: hashed, name, status: "ACTIVE" },
  });

  console.log(`✅ Admin ready: ${admin.email} (id: ${admin.id})`);
}

main()
  .catch((err) => {
    console.error("❌ Failed to seed admin:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
