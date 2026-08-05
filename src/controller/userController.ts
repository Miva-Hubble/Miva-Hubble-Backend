import { Response } from "express";
import { AuthRequest } from "../middleware/auth.js";
import { HttpStatus } from "../utils/httpStatus.js";
import { getUserProfile } from "../services/userService.js";

export const getCurrentUser = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ error: "Unauthorized" });
    }

    const profile = await getUserProfile(userId);

    if (!profile) {
      return res.status(HttpStatus.NOT_FOUND).json({ error: "User not found" });
    }

    res.status(HttpStatus.OK).json({
      success: true,
      user: profile,
    });
  } catch (error) {
    console.error("Get current user error:", error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: "Failed to get user" });
  }
};
