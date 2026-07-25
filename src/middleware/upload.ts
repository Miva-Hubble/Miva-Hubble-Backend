// src/middleware/upload.ts
//
// Scoped multer middleware for profile picture uploads.
//
// Design decisions:
//   - memoryStorage only: the file buffer is passed directly to Supabase Storage.
//     Nothing touches the disk on the Express server.
//   - MIME whitelist: JPEG, PNG, WebP. SVG and PDF are explicitly excluded.
//   - 5 MB hard cap: multer rejects the request before it fully buffers.
//   - Exported as a ready-to-use middleware (single field named "image").
//     Other upload shapes should get their own factory call, not share this one.

import multer, { FileFilterCallback } from "multer";
import { Request } from "express";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback,
): void => {
  if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only JPEG, PNG, and WebP images are allowed"));
  }
};

/**
 * Multer middleware for profile picture uploads.
 * Expects a single file field named "image" in a multipart/form-data request.
 *
 * Consumers: onboarding.route.ts → POST /api/onboarding/profile-picture
 */
export const profilePictureUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter,
}).single("image");
