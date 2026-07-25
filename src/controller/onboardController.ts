// controllers/onboarding.controller.ts

import { Response, NextFunction } from "express";
import type { AuthRequest } from "../middleware/auth.js";
import * as onboardingService from "../services/onboardingService.js";

export const completeOnboarding = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new Error("Unauthorized");

    const { onboarding, profilePicturePath } = await onboardingService.completeOnboarding(
      userId,
      req.body,
    );

    return res.status(200).json({
      success: true,
      message: "Onboarding completed successfully.",
      profile: {
        level: onboarding.level,
        department: onboarding.department,
        goals: onboarding.goals,
        preferredMode: onboarding.preferredMode.toLowerCase(),
        profilePicturePath: profilePicturePath ?? null,
        isOnboarded: true,
        onboardedAt: onboarding.completedAt,
      },
    });
  } catch (error) {
    next(error);
  }
};
