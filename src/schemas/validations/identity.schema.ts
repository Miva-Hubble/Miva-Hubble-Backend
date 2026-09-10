import { z } from "zod";
import { usernameValueSchema } from "./username.schema.js";
import { genderValueSchema } from "./gender.schema.js";

/**
 * PATCH /api/user/identity — one-time claim for legacy pre-migration
 * accounts that are onboarded but never set a username/gender (see
 * ProtectedRoute.tsx/GuestRoute.tsx's needsIdentityClaim on the frontend).
 * Both fields are required together: this is a single atomic claim action,
 * not a partial-field update like PATCH /api/user/username.
 */
export const ClaimIdentitySchema = z.object({
  username: usernameValueSchema,
  gender: genderValueSchema,
});

export type ClaimIdentityInput = z.infer<typeof ClaimIdentitySchema>;
