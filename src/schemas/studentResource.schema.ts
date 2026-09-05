// schemas/studentResource.schema.ts

import { z } from "zod";
import { StudentResourceStatus, StudentResourceType } from "@prisma/client";
import { ALLOWED_UPLOAD_MIME_TYPES, MAX_UPLOAD_SIZE_BYTES } from "./storage.schema.js";
import { LEVELS, DEPARTMENTS } from "../constants/taxonomy.js";

// No path separators, no leading dot, no control characters — filename validation
const SAFE_FILENAME = /^[^\\/\x00-\x1f]{1,255}$/;

export const RequestStudentResourceUploadUrlSchema = z.object({
  filename: z.string().trim().min(1, "Filename is required").regex(SAFE_FILENAME, "Invalid filename"),
  contentType: z.enum(ALLOWED_UPLOAD_MIME_TYPES, {
    message: "Only PDF, EPUB, DOC, and DOCX files are supported",
  }),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(MAX_UPLOAD_SIZE_BYTES, `File must be ${MAX_UPLOAD_SIZE_BYTES / (1024 * 1024)}MB or smaller`),
});

export type RequestStudentResourceUploadUrlInput = z.infer<typeof RequestStudentResourceUploadUrlSchema>;

export const CreateStudentResourceSchema = z.object({
  path: z.string().trim().min(1, "Upload path is required"),
  title: z.string().trim().min(1, "Title is required").max(200, "Title must be 200 characters or fewer"),
  description: z.string().trim().max(1000, "Description must be 1000 characters or fewer").optional().nullable(),
  // Canonical taxonomy only — same z.enum(LEVELS)/z.enum(DEPARTMENTS) contract
  // onboardingSchema enforces. A resource with an off-taxonomy level/department
  // could never match anyone's Vault (listVaultResources does exact equality
  // against the student's own onboarding row), so previously it would silently
  // create a resource nobody could ever see instead of failing loudly here.
  level: z.enum(LEVELS, { message: "Level must be one of the values returned by GET /api/taxonomy" }),
  department: z.enum(DEPARTMENTS, { message: "Department must be one of the values returned by GET /api/taxonomy" }),
  courseCode: z.string().trim().max(20, "Course code must be 20 characters or fewer").optional().nullable(),
  courseTitle: z.string().trim().min(1, "Course title is required").max(200, "Course title must be 200 characters or fewer"),
  resourceType: z.nativeEnum(StudentResourceType, {
    message: "Resource type must be NOTE, PAST_QUESTION, STUDY_GUIDE, or REFERENCE",
  }),
  contentType: z.enum(ALLOWED_UPLOAD_MIME_TYPES, {
    message: "Only PDF, EPUB, DOC, and DOCX files are supported",
  }),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(MAX_UPLOAD_SIZE_BYTES, `File must be ${MAX_UPLOAD_SIZE_BYTES / (1024 * 1024)}MB or smaller`),
});

export type CreateStudentResourceInput = z.infer<typeof CreateStudentResourceSchema>;

export const ResourceIdParamSchema = z.object({
  id: z.string().uuid("Resource ID must be a valid UUID"),
});

export type ResourceIdParamInput = z.infer<typeof ResourceIdParamSchema>;

// ---------------------------------------------------------------------------
// Admin moderation (Gate 7)
// ---------------------------------------------------------------------------

export const AdminListStudentResourcesQuerySchema = z.object({
  status: z.nativeEnum(StudentResourceStatus, { message: "Invalid status filter" }).optional(),
  page: z.coerce.number().int().min(1, "Page must be 1 or greater").default(1),
  limit: z.coerce.number().int().min(1).max(100, "Limit must be 100 or fewer").default(20),
});

export type AdminListStudentResourcesQueryInput = z.infer<typeof AdminListStudentResourcesQuerySchema>;

// Rejection must carry a reason; approval never needs one. Enforced with
// superRefine (not .refine on a discriminated union) so the single "reason"
// field can stay optional at the base-shape level for APPROVE while still
// being required, non-empty, for REJECT.
export const AdminReviewStudentResourceSchema = z
  .object({
    action: z.enum(["APPROVE", "REJECT"], { message: "Action must be APPROVE or REJECT" }),
    reason: z.string().trim().max(1000, "Reason must be 1000 characters or fewer").optional(),
  })
  .superRefine((data, ctx) => {
    if (data.action === "REJECT" && (!data.reason || data.reason.length === 0)) {
      ctx.addIssue({
        code: "custom",
        message: "Rejection requires a reason",
        path: ["reason"],
      });
    }
  });

export type AdminReviewStudentResourceInput = z.infer<typeof AdminReviewStudentResourceSchema>;

export const AdminArchiveStudentResourceSchema = z.object({
  reason: z.string().trim().max(1000, "Reason must be 1000 characters or fewer").optional(),
});

export type AdminArchiveStudentResourceInput = z.infer<typeof AdminArchiveStudentResourceSchema>;

// ---------------------------------------------------------------------------
// Gate 12 — Vault discovery (student-facing)
// ---------------------------------------------------------------------------

// level/department are deliberately NOT accepted here — eligibility is
// always re-derived server-side from the caller's own Onboarding row (see
// VaultService.listVaultResources). Accepting them as query params would
// let a student request another level/department's content directly.
export const VaultQuerySchema = z.object({
  courseCode: z.string().trim().min(1).max(20).optional(),
  resourceType: z.nativeEnum(StudentResourceType, { message: "Invalid resource type filter" }).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1, "Page must be 1 or greater").default(1),
  limit: z.coerce.number().int().min(1).max(100, "Limit must be 100 or fewer").default(20),
});

export type VaultQueryInput = z.infer<typeof VaultQuerySchema>;

export const VaultResourceUrlQuerySchema = z.object({
  mode: z.enum(["preview", "download"], { message: "mode must be preview or download" }).default("download"),
});

export type VaultResourceUrlQueryInput = z.infer<typeof VaultResourceUrlQuerySchema>;

// ---------------------------------------------------------------------------
// Gate 12 — student's own submissions (ownership-based, not eligibility-based)
// ---------------------------------------------------------------------------

export const MyStudentResourcesQuerySchema = z.object({
  status: z.nativeEnum(StudentResourceStatus, { message: "Invalid status filter" }).optional(),
});

export type MyStudentResourcesQueryInput = z.infer<typeof MyStudentResourcesQuerySchema>;
