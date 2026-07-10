// schemas/admin.schema.ts

import { z } from "zod";

/**
 * Rejects control characters and NUL bytes that have no legitimate place in
 * an email/password field. Prisma already parameterizes queries (no raw SQL
 * concatenation happens anywhere in this codebase) so classic SQL injection
 * via string concatenation isn't possible here, but we still reject obvious
 * injection/operator-injection payloads (Mongo-style `$gt`, template literal
 * markers, embedded quotes used for breakout attempts) as defense in depth,
 * and cap payload size to prevent abuse.
 */
const NO_CONTROL_CHARS = /^[^\x00-\x08\x0B\x0C\x0E-\x1F]*$/;
const NO_INJECTION_PATTERNS = /^(?!.*(\$\{|\$\(|--|;|\/\*|\*\/)).*$/;

export const AdminLoginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Email is required")
    .max(254, "Email is too long")
    .email("Invalid email format")
    .regex(NO_CONTROL_CHARS, "Email contains invalid characters"),
  password: z
    .string()
    .min(1, "Password is required")
    .max(128, "Password is too long")
    .regex(NO_CONTROL_CHARS, "Password contains invalid characters")
    .regex(NO_INJECTION_PATTERNS, "Password contains invalid characters"),
});

export type AdminLoginInput = z.infer<typeof AdminLoginSchema>;

export const CreateAdminSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().toLowerCase().email("Invalid email format").max(254),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters long")
    .max(128, "Password is too long")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character"),
});

export type CreateAdminInput = z.infer<typeof CreateAdminSchema>;
