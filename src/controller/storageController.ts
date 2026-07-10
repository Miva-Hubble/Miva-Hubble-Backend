// controller/storageController.ts

import { Response, Request } from "express";
import { AuthRequest } from "../middleware/auth.js";
import { AdminAuthRequest } from "../middleware/adminAuth.js";
import { StorageService } from "../services/storageService.js";
import { HttpStatus } from "../utils/httpStatus.js";
import { BookStatus } from "@prisma/client";

// -----------------------------------------------------------------------
// Student: private files & personalized feed
// -----------------------------------------------------------------------

export const getUserUploadUrl = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(HttpStatus.UNAUTHORIZED).json({ error: "Unauthorized" });

    // req.body is already validated + typed by RequestUploadUrlSchema; only
    // `filename` matters here since path construction is server-controlled.
    const { filename } = req.body as { filename: string };

    const upload = await StorageService.createUserUploadUrl(userId, filename);
    return res.status(HttpStatus.OK).json({ success: true, ...upload });
  } catch (error: any) {
    console.error("Get upload URL error:", error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: error.message || "Failed to create upload URL" });
  }
};

export const registerUpload = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(HttpStatus.UNAUTHORIZED).json({ error: "Unauthorized" });

    const { path, customLabel } = req.body;
    const file = await StorageService.createUserFile(userId, path, customLabel);

    return res.status(HttpStatus.CREATED).json({ success: true, file });
  } catch (error: any) {
    console.error("Register upload error:", error);
    return res.status(HttpStatus.BAD_REQUEST).json({ error: error.message || "Failed to register upload" });
  }
};

export const listFiles = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(HttpStatus.UNAUTHORIZED).json({ error: "Unauthorized" });

    const files = await StorageService.listUserFiles(userId);
    return res.status(HttpStatus.OK).json({ success: true, files });
  } catch (error) {
    console.error("List files error:", error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: "Failed to list files" });
  }
};

export const archiveFile = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(HttpStatus.UNAUTHORIZED).json({ error: "Unauthorized" });

    await StorageService.archiveUserFile(userId, req.params.id);
    return res.status(HttpStatus.OK).json({ success: true });
  } catch (error: any) {
    console.error("Archive file error:", error);
    return res.status(HttpStatus.NOT_FOUND).json({ error: error.message || "Failed to archive file" });
  }
};

export const getPersonalizedLibrary = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(HttpStatus.UNAUTHORIZED).json({ error: "Unauthorized" });

    const books = await StorageService.getPersonalizedFeed(userId);
    return res.status(HttpStatus.OK).json({ success: true, books });
  } catch (error) {
    console.error("Library feed error:", error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: "Failed to generate personalized library feed" });
  }
};

export const getDownloadUrl = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(HttpStatus.UNAUTHORIZED).json({ error: "Unauthorized" });

    const { id } = req.params;
    const isBook = req.query.isBook === "true"; // ?isBook=true

    const signedUrl = await StorageService.generatePresignedUrl(userId, id, isBook);
    return res.status(HttpStatus.OK).json({ success: true, signedUrl });
  } catch (error: any) {
    console.error("Download URL generation error:", error);
    return res.status(HttpStatus.NOT_FOUND).json({ error: error.message || "Failed to generate download URL" });
  }
};

// -----------------------------------------------------------------------
// Admin: library book management
// -----------------------------------------------------------------------

export const getAdminBookUploadUrl = async (req: AdminAuthRequest, res: Response) => {
  try {
    const { filename } = req.body as { filename: string };
    const upload = await StorageService.createBookUploadUrl(filename);
    return res.status(HttpStatus.OK).json({ success: true, ...upload });
  } catch (error: any) {
    console.error("Admin get upload URL error:", error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: error.message || "Failed to create upload URL" });
  }
};

export const adminCreateBook = async (req: Request, res: Response) => {
  try {
    const book = await StorageService.createBook(req.body);
    return res.status(HttpStatus.CREATED).json({ success: true, book });
  } catch (error: any) {
    console.error("Admin create book error:", error);
    return res.status(HttpStatus.BAD_REQUEST).json({ error: error.message || "Failed to register book" });
  }
};

export const adminListBooks = async (req: Request, res: Response) => {
  try {
    const status = req.query.status as BookStatus | undefined;
    const books = await StorageService.listAllBooksForAdmin(status);
    return res.status(HttpStatus.OK).json({ success: true, books });
  } catch (error) {
    console.error("Admin list books error:", error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: "Failed to list books" });
  }
};

export const adminUpdateBook = async (req: Request, res: Response) => {
  try {
    const book = await StorageService.updateBook(req.params.id, req.body);
    return res.status(HttpStatus.OK).json({ success: true, book });
  } catch (error: any) {
    console.error("Admin update book error:", error);
    return res.status(HttpStatus.NOT_FOUND).json({ error: error.message || "Failed to update book" });
  }
};

export const adminDeleteBook = async (req: Request, res: Response) => {
  try {
    await StorageService.deleteBook(req.params.id);
    return res.status(HttpStatus.OK).json({ success: true });
  } catch (error: any) {
    console.error("Admin delete book error:", error);
    return res.status(HttpStatus.NOT_FOUND).json({ error: error.message || "Failed to delete book" });
  }
};
