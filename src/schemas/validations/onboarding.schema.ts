// src/validations/onboarding.schema.ts

import { z } from "zod";

export const onboardingSchema = z.object({
  level: z.string().trim().min(1).max(50),
  department: z.string().trim().min(2).max(100),
  goals: z.array(z.string()).max(10).optional().default([]),
  preferredMode: z
    .preprocess(
      (val) => (typeof val === "string" ? val.toLowerCase() : val),
      z.enum(["anonymous", "identified"]),
    )
    .optional()
    .default("anonymous"),
  /**
   * Optional storage path returned by POST /api/onboarding/profile-picture.
   * This is a path string (e.g. "userId/avatar.jpg"), never a binary payload.
   * Image validation is the upload endpoint's responsibility, not ours.
   */
  profilePicturePath: z.string().trim().min(1).optional(),
});

export type OnboardingDto = z.infer<typeof onboardingSchema>;