import { z } from "zod";
import { LEVELS, DEPARTMENTS, GOALS } from "../../constants/taxonomy.js";
import { usernameValueSchema } from "./username.schema.js";
import { genderValueSchema } from "./gender.schema.js";

export const onboardingSchema = z.object({
  level: z.enum(LEVELS),
  department: z.enum(DEPARTMENTS),
  username: usernameValueSchema,
  gender: genderValueSchema,
  goals: z.array(z.enum(GOALS)).max(10).optional().default([]),
  preferredMode: z
    .preprocess(
      (val) => (typeof val === "string" ? val.toLowerCase() : val),
      z.enum(["anonymous", "identified"]),
    )
    .optional()
    .default("anonymous"),
  profilePicturePath: z.string().trim().min(1).optional(),
});

export type OnboardingDto = z.infer<typeof onboardingSchema>;
