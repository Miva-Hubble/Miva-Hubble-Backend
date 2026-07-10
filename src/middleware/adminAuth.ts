// middleware/adminAuth.ts

import { Request, Response, NextFunction } from "express";
import { AdminAuthService } from "../services/adminAuthService.js";
import { HttpStatus } from "../utils/httpStatus.js";
import prisma from "../lib/prisma.js";

export interface AdminAuthRequest extends Request {
  admin?: {
    adminId: string;
    email: string;
  };
}

/**
 * Verifies the admin access token (cookie or Bearer header) and confirms
 * the admin still exists and is ACTIVE. Uses the admin-scoped secret/claim,
 * so this can never be satisfied by a student access token.
 */
export const authenticateAdmin = async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : req.cookies?.adminAccessToken;

    if (!token) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ error: "No token provided" });
    }

    const decoded = AdminAuthService.verifyAccessToken(token);

    const admin = await prisma.admin.findUnique({ where: { id: decoded.adminId } });
    if (!admin || admin.status !== "ACTIVE") {
      return res.status(HttpStatus.UNAUTHORIZED).json({ error: "Admin not found or inactive" });
    }

    req.admin = { adminId: decoded.adminId, email: decoded.email };
    next();
  } catch {
    return res.status(HttpStatus.UNAUTHORIZED).json({ error: "Invalid or expired token" });
  }
};
