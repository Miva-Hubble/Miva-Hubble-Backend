import { Response } from "express";
import { AuthRequest } from "../middleware/auth.js";
import { HttpStatus } from "../utils/httpStatus.js";
import { getUserProfile, isUsernameTaken, updateUsername, claimIdentity } from "../services/userService.js";
import { updateDepartment } from "../services/onboardingService.js";
import { CheckUsernameQuerySchema, UpdateUsernameInput } from "../schemas/validations/username.schema.js";
import type { UpdateDepartmentInput } from "../schemas/validations/department.schema.js";
import { normalizeGender } from "../utils/normalizeGender.js";
import type { ClaimIdentityInput } from "../schemas/validations/identity.schema.js";

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

/**
 * GET /api/users/check-username (3.1) — auth required (no anonymous
 * username enumeration). Excludes the requester's own current username
 * from the "taken" check, so editing-without-changing never false-positives.
 */
export const checkUsername = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ error: "Unauthorized" });
    }

    const parsed = CheckUsernameQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: "Validation failed",
        errors: parsed.error.flatten(),
      });
    }

    const taken = await isUsernameTaken(parsed.data.username, userId);

    res.status(HttpStatus.OK).json({
      success: true,
      available: !taken,
    });
  } catch (error) {
    console.error("Check username error:", error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: "Failed to check username" });
  }
};

/**
 * PATCH /api/user/identity — one-time claim for legacy pre-migration
 * accounts that are onboarded but missing username/gender. Body already
 * validated by ClaimIdentitySchema (via the `validate` middleware) before
 * this handler runs.
 */
export const patchIdentity = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ error: "Unauthorized" });
    }

    const { username, gender } = req.body as ClaimIdentityInput;

    const updated = await claimIdentity(userId, { username, gender });

    res.status(HttpStatus.OK).json({
      success: true,
      username: updated.username,
      gender: normalizeGender(updated.gender),
    });
  } catch (error: any) {
    if (error?.name === "UsernameTakenError") {
      return res.status(error.status ?? HttpStatus.CONFLICT).json({
        success: false,
        message: error.message,
      });
    }

    console.error("Claim identity error:", error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: "Failed to claim identity" });
  }
};

/**
 * PATCH /api/user/username (3.2) — lets a user change their username after
 * onboarding. Empty/null is rejected by UpdateUsernameSchema (via the
 * `validate` middleware) before this handler ever runs, so username can
 * change value but never revert to unset here.
 */
export const patchUsername = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ error: "Unauthorized" });
    }

    const { username } = req.body as UpdateUsernameInput;

    const updated = await updateUsername(userId, username);

    res.status(HttpStatus.OK).json({
      success: true,
      username: updated.username,
    });
  } catch (error: any) {
    if (error?.name === "UsernameTakenError") {
      return res.status(error.status ?? HttpStatus.CONFLICT).json({
        success: false,
        message: error.message,
      });
    }

    console.error("Update username error:", error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: "Failed to update username" });
  }
};

/**
 * PATCH /api/user/department — lets a student change their department
 * after onboarding, subject to a 60-day cooldown enforced server-side in
 * OnboardingService.updateDepartment (never trust a client-side-only
 * warning for this — see the EditProfileModal audit this endpoint closes
 * the gap on). Body already validated by UpdateDepartmentSchema (via the
 * `validate` middleware) before this handler runs.
 */
export const patchDepartment = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ error: "Unauthorized" });
    }

    const { department } = req.body as UpdateDepartmentInput;

    const updated = await updateDepartment(userId, department);

    res.status(HttpStatus.OK).json({
      success: true,
      department: updated.department,
      departmentChangedAt: updated.departmentChangedAt,
    });
  } catch (error: any) {
    if (error?.name === "DepartmentCooldownError") {
      return res.status(error.status ?? HttpStatus.CONFLICT).json({
        success: false,
        message: error.message,
        availableAt: error.availableAt,
        daysRemaining: error.daysRemaining,
      });
    }

    console.error("Update department error:", error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: "Failed to update department" });
  }
};
