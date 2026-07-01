// controllers/onboarding.controller.ts

import { Request, Response, NextFunction } from "express";
import * as onboardingService from "../services/onboardingService.js";

export const completeOnboarding = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new Error("Unauthorized");

    const user = await onboardingService.completeOnboarding(userId, req.body);

    return res.status(200).json({
      success: true,
      message: "Onboarding completed successfully.",
      profile: {
        level: user.level,
        department: user.department,
        goals: user.goals,
        preferredMode: user.preferredMode.toLowerCase(),
        isOnboarded: true,
        onboardedAt: user.completedAt,
      },
    });
  } catch (error) {
    next(error);
  }
};
