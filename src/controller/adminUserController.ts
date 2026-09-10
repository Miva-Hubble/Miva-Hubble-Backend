// controller/adminUserController.ts
//
// Admin "Users" dashboard tab. Mounted behind `authenticateAdmin` in
// routes/admin.ts — there is no student-token path to this handler.
// Structurally mirrors progressionController.ts: validate query with Zod,
// delegate the actual query to the service layer, return a consistent
// { success, ... } envelope.

import { Response } from "express";
import { AdminAuthRequest } from "../middleware/adminAuth.js";
import { HttpStatus } from "../utils/httpStatus.js";
import { AdminListUsersQuerySchema } from "../schemas/adminUser.schema.js";
import { listUsersForAdmin } from "../services/userService.js";

/**
 * GET /api/admin/users
 * Paginated roster of every student, each with their onboarding selection
 * (level/department/goals/preferredMode) inline, or `onboarding: null` if
 * they haven't onboarded yet. Supports `search` (name/username/email),
 * `level`, `department`, and `onboarded` (true/false) query filters — see
 * AdminListUsersQuerySchema for validation rules.
 */
export const adminListUsers = async (req: AdminAuthRequest, res: Response) => {
  try {
    const adminId = req.admin?.adminId;
    if (!adminId) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ error: "Unauthorized" });
    }

    const queryResult = AdminListUsersQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        error: "Validation failed",
        errors: queryResult.error.flatten(),
      });
    }

    const { page, limit, search, level, department, onboarded } = queryResult.data;
    const result = await listUsersForAdmin({ page, limit, search, level, department, onboarded });

    return res.status(HttpStatus.OK).json({ success: true, ...result });
  } catch (error: any) {
    console.error("Admin list users error:", error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: error.message || "Failed to list users",
    });
  }
};
