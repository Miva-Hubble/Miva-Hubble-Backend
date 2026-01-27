import { Response } from "express";
import { AuthRequest } from "../middleware/auth.js";
import prisma from "../lib/prisma.js";
import { HttpStatus } from "../utils/httpStatus.js";

export const getCurrentUser = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ error: "Unauthorized" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        picture: true,
        email_verified: true,
        last_login_with: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(HttpStatus.NOT_FOUND).json({ error: "User not found" });
    }

    res.status(HttpStatus.OK).json({
      success: true,
      user,
    });
  } catch (error) {
    console.error("Get current user error:", error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: "Failed to get user" });
  }
};
