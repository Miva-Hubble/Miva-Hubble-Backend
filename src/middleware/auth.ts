import { Request, Response, NextFunction } from "express";
import { AuthService } from "../services/authService.js";
import { HttpStatus } from "../utils/httpStatus.js";
import { prisma } from "../lib/prisma.js";
import type { UploadedImageFile } from "../types/upload.types.js";

export interface AuthRequest extends Omit<Request, "file"> {
  user?: {
    userId: string;
    email: string;
  };
  file?: UploadedImageFile;
}


export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const authHeader = req.headers.authorization;

    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.substring(7)
      : req.cookies?.accessToken;

    if (!token) {
      return res
        .status(HttpStatus.UNAUTHORIZED)
        .json({ error: "No token provided" });
    }

    const decoded = AuthService.verifyAccessToken(token) as {
      userId: string;
      email: string;
    };

    // Verify the user still exists in the database — catches deleted/banned
    // users holding valid (not-yet-expired) JWTs. Lightweight select: no
    // full user hydration, just existence check.
    const userExists = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true },
    });

    if (!userExists) {
      return res
        .status(HttpStatus.UNAUTHORIZED)
        .json({ error: "User account no longer exists" });
    }

    req.user = decoded;

    next();
  } catch {
    return res
      .status(HttpStatus.UNAUTHORIZED)
      .json({ error: "Invalid or expired token" });
  }
};
