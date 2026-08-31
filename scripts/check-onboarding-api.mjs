import dotenv from "dotenv";
import jwt from "jsonwebtoken";

dotenv.config();

const BASE = process.env.API_BASE_URL || "http://127.0.0.1:7292";
const secret = process.env.ACCESS_TOKEN_SECRET || "access-secret";

async function request(path, options = {}) {
  const started = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    signal: AbortSignal.timeout(60000),
  });
  const body = await res.text();
  const ms = Date.now() - started;
  return { status: res.status, body, ms };
}

function pass(label, ok, detail = "") {
  const icon = ok ? "PASS" : "FAIL";
  console.log(`[${icon}] ${label}${detail ? ` — ${detail}` : ""}`);
  return ok;
}

console.log(`\nOnboarding API check — ${BASE}\n`);

let allOk = true;

// 1. Health
const health = await request("/health");
allOk = pass("GET /health", health.status === 200, `${health.status} (${health.ms}ms)`) && allOk;
if (health.status === 200) console.log(`       ${health.body}`);

// 2. Typo URL
const typo = await request("/api/onboardin", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ level: "100", department: "CS" }),
});
allOk =
  pass(
    "POST /api/onboardin (typo)",
    typo.status === 404,
    `${typo.status} — use /api/onboarding (${typo.ms}ms)`,
  ) && allOk;

// 3. No auth
const noAuth = await request("/api/onboarding", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    level: "100",
    department: "Computer Science",
    goals: ["Study groups"],
    preferredMode: "anonymous",
  }),
});
allOk =
  pass(
    "POST /api/onboarding without token",
    noAuth.status === 401,
    `${noAuth.status} (${noAuth.ms}ms)`,
  ) && allOk;

// 4. Invalid token
const badToken = await request("/api/onboarding", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer invalid.token.here",
  },
  body: JSON.stringify({
    level: "100",
    department: "Computer Science",
  }),
});
allOk =
  pass(
    "POST /api/onboarding invalid token",
    badToken.status === 401,
    `${badToken.status} (${badToken.ms}ms)`,
  ) && allOk;

// 5. Valid token, fake user
const fakeToken = jwt.sign(
  { userId: "nonexistent-user-id", email: "fake@miva.edu.ng" },
  secret,
  { expiresIn: "15m" },
);
const fakeUser = await request("/api/onboarding", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${fakeToken}`,
  },
  body: JSON.stringify({
    level: "100",
    department: "Computer Science",
    goals: ["Study groups"],
    preferredMode: "anonymous",
  }),
});
allOk =
  pass(
    "POST /api/onboarding valid token, unknown user",
    fakeUser.status === 404,
    `${fakeUser.status} (${fakeUser.ms}ms)`,
  ) && allOk;

// 6. Google auth init
const google = await request("/api/auth/google");
allOk =
  pass(
    "GET /api/auth/google",
    google.status === 200 && google.body.includes("authUrl"),
    `${google.status} (${google.ms}ms)`,
  ) && allOk;

// 7. Validation error
const validation = await request("/api/onboarding", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${fakeToken}`,
  },
  body: JSON.stringify({ level: "100" }),
});
allOk =
  pass(
    "POST /api/onboarding missing department",
    validation.status === 400,
    `${validation.status} (${validation.ms}ms)`,
  ) && allOk;

console.log(`\n${allOk ? "All checks passed." : "Some checks failed."}\n`);
console.log("Postman tips:");
console.log("  URL:  POST http://127.0.0.1:7292/api/onboarding");
console.log("  Auth: Bearer Token from /api/auth/login or /api/auth/google/token");
console.log("  Use 127.0.0.1 instead of localhost if requests time out\n");

process.exit(allOk ? 0 : 1);
