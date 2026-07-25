// src/controller/profilePictureController.ts
//
// Thin controller for the profile picture upload endpoint.
// Delegates all infrastructure work to profilePictureService.
//
// Route:   POST /api/onboarding/profile-picture
// Auth:    Student accessToken (Bearer / Cookie) — enforced by authenticate middleware
// Body:    multipart/form-data, field name "image"
// Returns: { success: true, path: "userId/avatar.jpg" }

import "multer";
import { Response, NextFunction } from "express";
import type { AuthRequest } from "../middleware/auth.js";
import * as profilePictureService from "../services/profilePictureService.js";

export const uploadProfilePicture = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }

    if (!req.file) {
      res.status(400).json({ success: false, error: "No image file provided" });
      return;
    }

    const path = await profilePictureService.uploadProfilePicture(userId, req.file);

    res.status(200).json({ success: true, path });
  } catch (error) {
    next(error);
  }
};
