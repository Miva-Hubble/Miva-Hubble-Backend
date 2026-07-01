// routes/onboarding.routes.ts

import { Router } from "express";
import { validate } from "../middleware/validate.js";
import { authenticate } from "../middleware/auth.js";
import { onboardingSchema } from "../schemas/validations/onboarding.schema.js";
import { completeOnboarding } from "../controller/onboardController.js";

const router = Router();

router.post(
  "/",
  authenticate,
  validate(onboardingSchema),
  completeOnboarding,
);

export default router;
