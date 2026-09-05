// controller/progressionController.ts
//
// Admin progression reporting (Gate 10). Both handlers are mounted behind
// `authenticateAdmin` in routes/admin.ts — there is no student-token path
// to either of them, which is what makes a student token's 401 structural
// rather than a runtime check this file has to remember to make.

import { Response } from "express";
import { AdminAuthRequest } from "../middleware/adminAuth.js";
import { ProgressionService } from "../services/progressionService.js";
import { HttpStatus } from "../utils/httpStatus.js";
import {
  AdminUserProgressionParamSchema,
  AdminListProgressionQuerySchema,
} from "../schemas/progression.schema.js";

/**
 * GET /api/admin/users/:userId/progression
 * One user's full progression report: identity, daily goal, streak,
 * consistency, rank/next-rank, and their last 7 Lagos-calendar-day records.
 */
export const adminGetUserProgression = async (req: AdminAuthRequest, res: Response) => {
  try {
    const adminId = req.admin?.adminId;
    if (!adminId) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ error: "Unauthorized" });
    }

    const paramResult = AdminUserProgressionParamSchema.safeParse(req.params);
    if (!paramResult.success) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        error: "Validation failed",
        errors: paramResult.error.flatten(),
      });
    }

    const report = await ProgressionService.getAdminUserProgress(paramResult.data.userId);

    return res.status(HttpStatus.OK).json({ success: true, ...report });
  } catch (error: any) {
    console.error("Admin get user progression error:", error);
    const isNotFound = error.message?.includes("not found");
    return res.status(isNotFound ? HttpStatus.NOT_FOUND : HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: error.message || "Failed to load user progression",
    });
  }
};

/**
 * GET /api/admin/progression
 * Paginated roster of every user's progression, optionally filtered by
 * rank level and/or searched by name, username, or email.
 */
export const adminListProgression = async (req: AdminAuthRequest, res: Response) => {
  try {
    const adminId = req.admin?.adminId;
    if (!adminId) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ error: "Unauthorized" });
    }

    const queryResult = AdminListProgressionQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        error: "Validation failed",
        errors: queryResult.error.flatten(),
      });
    }

    const { page, limit, rankLevel, search } = queryResult.data;
    const result = await ProgressionService.listUserProgression({ page, limit, rankLevel, search });

    return res.status(HttpStatus.OK).json({ success: true, ...result });
  } catch (error: any) {
    console.error("Admin list progression error:", error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: error.message || "Failed to list progression",
    });
  }
};
