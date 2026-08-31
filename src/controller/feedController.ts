// src/controller/feedController.ts

import { Response, NextFunction } from "express";
import { AuthRequest } from "../middleware/auth.js";
import { HttpStatus } from "../utils/httpStatus.js";
import { getFeed } from "../services/feedService.js";

/**
 * GET /api/feed
 *
 * Always returns 200 OK. Degradation is signalled via meta.failedSections,
 * never via HTTP status — the client should always receive a usable response.
 */
export const getFeedHandler = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ error: "Unauthorized" });
    }

    // getFeed() handles individual section errors via Promise.allSettled.
    // The try/catch here protects against unforeseen orchestration crashes.
    const feed = await getFeed(userId);
    return res.status(HttpStatus.OK).json(feed);
  } catch (error) {
    next(error);
  }
};
