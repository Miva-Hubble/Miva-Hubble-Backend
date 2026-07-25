// src/services/profilePictureService.ts
//
// Infrastructure concern: upload a profile picture buffer to Supabase Storage.
// Returns the storage path only. Database persistence is the caller's responsibility.
//
// Architecture note:
//   - Uses supabaseAdmin (service-role key) for Storage operations only.
//   - Does NOT write to PostgreSQL. That belongs in onboardingService / user update endpoints.
//   - Stores images under a deterministic path: {userId}/avatar.{ext}
//     This means re-uploading replaces the previous object cleanly (upsert: true),
//     with no orphaned files accumulating in the bucket.

import "multer";
import { supabaseAdmin } from "../config/supabase.js";

const PROFILE_IMAGES_BUCKET =
  process.env.SUPABASE_PROFILE_IMAGES_BUCKET || "profile-images";

/** MIME type → file extension map for the three supported image formats. */
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Uploads the provided image buffer to the profile-images bucket.
 *
 * @param userId  - Authenticated user's ID (used as the path prefix).
 * @param file    - Multer file object (memoryStorage — buffer is in memory).
 * @returns       - The storage path, e.g. "clz190axu0000abcde1234567/avatar.jpg"
 *
 * Consumers: profilePictureController.ts
 */
export const uploadProfilePicture = async (
  userId: string,
  file: Express.Multer.File,
): Promise<string> => {
  const ext = MIME_TO_EXT[file.mimetype];
  if (!ext) {
    // This should never be reached because multer's fileFilter enforces MIME
    // types before this function is called. Guard retained for defence-in-depth.
    throw new Error("Unsupported image type. Only JPEG, PNG, and WebP are allowed.");
  }

  // Deterministic path: one avatar slot per user.
  // Re-uploading replaces the previous file without creating orphans.
  const storagePath = `${userId}/avatar.${ext}`;

  const { error } = await supabaseAdmin.storage
    .from(PROFILE_IMAGES_BUCKET)
    .upload(storagePath, file.buffer, {
      contentType: file.mimetype,
      upsert: true, // Overwrite if user re-uploads their avatar
    });

  if (error) {
    throw new Error(`Profile picture upload failed: ${error.message}`);
  }

  return storagePath;
};
