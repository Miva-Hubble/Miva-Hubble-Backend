// schemas/adminUser.schema.ts
//
// Admin "Users" dashboard tab — GET /api/admin/users. Query-param
// validation only; there is no request body for this endpoint. Mirrors
// AdminListProgressionQuerySchema's shape (progression.schema.ts) since
// both are paginated admin rosters over the same User table.

import { z } from "zod";

// Same defense-in-depth control-character rejection used across
// admin.schema.ts / progression.schema.ts — no legitimate search term,
// level, or department value needs these bytes.
const NO_CONTROL_CHARS = /^[^\x00-\x08\x0B\x0C\x0E-\x1F]*$/;

export const AdminListUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1, "Page must be 1 or greater").default(1),
  limit: z.coerce.number().int().min(1).max(100, "Limit must be 100 or fewer").default(20),

  // Matches against User.name / User.username / User.email (case-insensitive
  // substring). See listUsersForAdmin in services/userService.ts.
  search: z
    .string()
    .trim()
    .min(1, "Search must not be empty")
    .max(120, "Search must be 120 characters or fewer")
    .regex(NO_CONTROL_CHARS, "Search contains invalid characters")
    .optional(),

  // Onboarding.level is a free-form string (e.g. "Level200"), not a Prisma
  // enum — see Book.level's comment in schema.prisma for the same pattern —
  // so this is validated as a bounded string, not z.enum().
  level: z
    .string()
    .trim()
    .min(1, "Level must not be empty")
    .max(50, "Level must be 50 characters or fewer")
    .regex(NO_CONTROL_CHARS, "Level contains invalid characters")
    .optional(),

  department: z
    .string()
    .trim()
    .min(1, "Department must not be empty")
    .max(120, "Department must be 120 characters or fewer")
    .regex(NO_CONTROL_CHARS, "Department contains invalid characters")
    .optional(),

  // Tri-state via presence/absence: omitted = no filter, "true" = only
  // users with a completed Onboarding record, "false" = only users who
  // haven't onboarded yet.
  onboarded: z
    .enum(["true", "false"], { errorMap: () => ({ message: "onboarded must be 'true' or 'false'" }) })
    .transform((v) => v === "true")
    .optional(),
});

export type AdminListUsersQueryInput = z.infer<typeof AdminListUsersQuerySchema>;
