import { z } from "zod";

// Single shared fragment — used by onboarding (2.1), GET /api/users/check-username
// (3.1), and PATCH /api/user/username (3.2). Never redefine this regex/length
// rule anywhere else; import this instead.
export const usernameValueSchema = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters")
  .max(15, "Username must be at most 15 characters")
  .regex(/^[a-zA-Z0-9]+$/, "Username must be alphanumeric");

export const CheckUsernameQuerySchema = z.object({
  username: usernameValueSchema,
});

export type CheckUsernameQuery = z.infer<typeof CheckUsernameQuerySchema>;

export const UpdateUsernameSchema = z.object({
  // Required + min(3) already rejects "" — an explicit .min(1) isn't needed
  // on top of usernameValueSchema's .min(3), but the intent (reject empty)
  // is enforced by usernameValueSchema itself, not a separate rule here.
  username: usernameValueSchema,
});

export type UpdateUsernameInput = z.infer<typeof UpdateUsernameSchema>;
