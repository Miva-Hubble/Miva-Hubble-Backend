import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import { prisma } from "../src/lib/prisma.ts";

dotenv.config();

const BASE = process.env.API_BASE_URL || "http://127.0.0.1:7292";
const secret = process.env.ACCESS_TOKEN_SECRET || "access-secret";

const user = await prisma.user.findFirst({
  where: { onboarding: null },
  select: { id: true, email: true },
});

if (!user) {
  console.log("SKIP: No user without onboarding found in database.");
  await prisma.$disconnect();
  process.exit(0);
}

const token = jwt.sign(
  { userId: user.id, email: user.email },
  secret,
  { expiresIn: "15m" },
);

const res = await fetch(`${BASE}/api/onboarding`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    level: "100",
    department: "Computer Science",
    goals: ["API test"],
    preferredMode: "anonymous",
  }),
  signal: AbortSignal.timeout(60000),
});

const body = await res.text();
console.log(`User: ${user.email}`);
console.log(`Status: ${res.status}`);
console.log(body);

await prisma.$disconnect();
process.exit(res.status === 200 ? 0 : 1);
