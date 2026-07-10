// schemas/storage.schema.ts

import { z } from "zod";
import { BookType, BookStatus } from "@prisma/client";

export const ALLOWED_UPLOAD_MIME_TYPES = ["application/pdf", "application/epub+zip"] as const;
// 50MB — matches the Supabase bucket's file-size limit, which is a hard
// ceiling enforced by the Free plan regardless of what this app says. Keep
// this in lockstep with the bucket setting: if the bucket is ever raised
// (e.g. after upgrading to Pro), raise this to match, or uploads that pass
// this check will still get rejected by Supabase at the actual upload step.
export const MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024; // 50MB, matches the Supabase Free plan hard limit

// No path separators, no leading dot, no control characters — this is a
// filename, not a path. The actual storage path is always built server-side.
const SAFE_FILENAME = /^[^\\/\x00-\x1f]{1,255}$/;

export const RequestUploadUrlSchema = z.object({
  filename: z.string().trim().min(1, "Filename is required").regex(SAFE_FILENAME, "Invalid filename"),
  contentType: z.enum(ALLOWED_UPLOAD_MIME_TYPES, {
    message: "Only PDF and EPUB files are supported",
  }),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(MAX_UPLOAD_SIZE_BYTES, `File must be ${MAX_UPLOAD_SIZE_BYTES / (1024 * 1024)}MB or smaller`),
});

export type RequestUploadUrlInput = z.infer<typeof RequestUploadUrlSchema>;

// `path` must be exactly the path our own upload-url endpoint generated —
// never a client-supplied storageObjectId. StorageService re-derives and
// verifies ownership of the path before trusting it (see storageService.ts).
export const CreateFileSchema = z.object({
  path: z.string().trim().min(1, "path is required"),
  customLabel: z.string().trim().min(1).max(200).optional(),
});

export type CreateFileInput = z.infer<typeof CreateFileSchema>;

const TARGETING_TAG = z.string().trim().min(1).max(50);

export const CreateBookSchema = z.object({
  path: z.string().trim().min(1, "path is required"),
  title: z.string().trim().min(1, "Title is required").max(300),
  author: z.string().trim().min(1, "Author is required").max(200),
  description: z.string().trim().max(2000).optional(),
  level: z.string().trim().min(1, "Level is required").max(50),
  department: z.string().trim().min(1, "Department is required").max(120),
  bookType: z.nativeEnum(BookType),
  // Empty tags is valid and intentional: per the targeting rules, an
  // untagged book reaches "the whole department + level" rather than being
  // invisible, so we don't force at least one tag here.
  tags: z.array(TARGETING_TAG).max(30).default([]),
  status: z.nativeEnum(BookStatus).optional(),
});

export type CreateBookInput = z.infer<typeof CreateBookSchema>;

export const UpdateBookSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    author: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).optional(),
    level: z.string().trim().min(1).max(50).optional(),
    department: z.string().trim().min(1).max(120).optional(),
    bookType: z.nativeEnum(BookType).optional(),
    tags: z.array(TARGETING_TAG).max(30).optional(),
    status: z.nativeEnum(BookStatus).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "At least one field must be provided" });

export type UpdateBookInput = z.infer<typeof UpdateBookSchema>;
