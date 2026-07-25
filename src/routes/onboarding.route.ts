// routes/onboarding.routes.ts

import { Router } from "express";
import { validate } from "../middleware/validate.js";
import { authenticate } from "../middleware/auth.js";
import { profilePictureUpload } from "../middleware/upload.js";
import { onboardingSchema } from "../schemas/validations/onboarding.schema.js";
import { completeOnboarding } from "../controller/onboardController.js";
import { uploadProfilePicture } from "../controller/profilePictureController.js";

const router = Router();

/**
 * POST /api/onboarding/profile-picture
 * Infrastructure concern: receives a multipart image, uploads it to
 * Supabase Storage, and returns the storage path.
 * This runs independently of onboarding completion — the frontend
 * saves the returned path and supplies it to POST /api/onboarding.
 */
router.post(
  "/profile-picture",
  authenticate,
  profilePictureUpload,
  uploadProfilePicture,
);

/**
 * POST /api/onboarding
 * Business concern: saves academic profile and optionally
 * persists the profilePicturePath on the User record.
 */
router.post(
  "/",
  authenticate,
  validate(onboardingSchema),
  completeOnboarding,
);

export default router;
