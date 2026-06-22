import { Request, Response, NextFunction } from "express";
import { AuthService } from "../services/authService.js";
import { HttpStatus } from "../utils/httpStatus.js";

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
  };
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

    req.user = decoded;

    next();
  } catch {
    return res
      .status(HttpStatus.UNAUTHORIZED)
      .json({ error: "Invalid or expired token" });
  }
};
