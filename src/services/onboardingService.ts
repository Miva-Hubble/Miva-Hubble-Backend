// src/services/onboarding.service.ts

import { prisma } from "../lib/prisma.js";
import { eventEmitter } from "../events/eventEmitter.js";
import { PreferredMode } from "../generated/prisma/index.js";
import type { OnboardingDto } from "../schemas/validations/onboarding.schema.js";

const toPreferredMode = (mode: OnboardingDto["preferredMode"]): PreferredMode =>
  mode === "identified" ? PreferredMode.IDENTIFIED : PreferredMode.ANONYMOUS;

export const completeOnboarding = async (
  userId: string,
  payload: OnboardingDto,
) => {
  /**
   * Find the authenticated user, including any existing onboarding record
   */
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { onboarding: true },
  });

  if (!user) {
    throw new Error("User not found");
  }

  /**
   * Prevent onboarding twice
   */
  if (user.onboarding) {
    throw new Error("User has already completed onboarding");
  }

  /**
   * Create the onboarding record (1:1 with User)
   */
  const onboarding = await prisma.onboarding.create({
    data: {
      level: payload.level,
      department: payload.department,
      goals: payload.goals,
      preferredMode: toPreferredMode(payload.preferredMode),
      userId,
    },
  });

  /**
   * Notify the rest of the application
   */
  eventEmitter.emit("user.onboarded", {
    userId,
    level: onboarding.level,
    department: onboarding.department,
  });

  return onboarding;
};
