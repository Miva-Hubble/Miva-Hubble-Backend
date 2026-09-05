// schemas/progression.schema.ts
//
// Admin progression reporting (Gate 10).

import { z } from "zod";

// Same defense-in-depth control-character rejection used across
// admin.schema.ts — no legitimate userId, name, or email fragment needs
// these bytes.
const NO_CONTROL_CHARS = /^[^\x00-\x08\x0B\x0C\x0E-\x1F]*$/;

export const AdminUserProgressionParamSchema = z.object({
  userId: z
    .string()
    .trim()
    .min(1, "User ID is required")
    .max(100, "User ID is too long")
    .regex(NO_CONTROL_CHARS, "User ID contains invalid characters"),
});

export type AdminUserProgressionParamInput = z.infer<typeof AdminUserProgressionParamSchema>;

// Ranks are a fixed, seeded ladder of 10 (Novice level 1 -> Ultimate level
// 10 — see prisma/schema.prisma's RankDefinition comment), so the level
// filter is bounded rather than an open-ended integer.
export const AdminListProgressionQuerySchema = z.object({
  page: z.coerce.number().int().min(1, "Page must be 1 or greater").default(1),
  limit: z.coerce.number().int().min(1).max(100, "Limit must be 100 or fewer").default(20),
  rankLevel: z.coerce
    .number()
    .int()
    .min(1, "Rank level must be between 1 and 10")
    .max(10, "Rank level must be between 1 and 10")
    .optional(),
  search: z
    .string()
    .trim()
    .min(1, "Search must not be empty")
    .max(120, "Search must be 120 characters or fewer")
    .regex(NO_CONTROL_CHARS, "Search contains invalid characters")
    .optional(),
});

export type AdminListProgressionQueryInput = z.infer<typeof AdminListProgressionQuerySchema>;
