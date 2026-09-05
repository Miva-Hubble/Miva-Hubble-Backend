// routes/vault.ts
//
// Gate 12 — student-facing Vault discovery. Separate router (not folded
// into studentResource.ts) because this reads a different domain slice:
// published (APPROVED, level/department-eligible) resources, not the
// caller's own submissions. Student token only — admins use
// GET /api/admin/student-resources for full, unfiltered visibility.

import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { getVault, getVaultResourceUrl } from "../controller/studentResourceController.js";

const router = Router();

router.use(authenticate);

// Basic per-user rate limiting (Gate 12 correction): listing is a cheap DB
// read so gets a looser cap; signed-URL issuance hits Supabase Storage on
// every call and is the more expensive/abusable of the two, so it's capped
// tighter. Neither number is tuned from real traffic yet — revisit once
// actual usage is observed.
const vaultListLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 60,
  message: "Too many Vault requests — please slow down and try again shortly.",
});

const vaultUrlLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 30,
  message: "Too many download/preview requests — please slow down and try again shortly.",
});

router.get("/", vaultListLimiter, getVault);
router.get("/:id/url", vaultUrlLimiter, getVaultResourceUrl);

export default router;
