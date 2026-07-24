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
});

export type OnboardingDto = z.infer<typeof onboardingSchema>;