// src/services/onboarding.service.ts

import { prisma } from "../lib/prisma.js";
import { eventEmitter } from "../events/eventEmitter.js";
import { PreferredMode, Prisma } from "@prisma/client";
import type { OnboardingDto } from "../schemas/validations/onboarding.schema.js";
import { UsernameTakenError } from "../errors/usernameTakenError.js";
import { DepartmentCooldownError } from "../errors/departmentCooldownError.js";
import { toPrismaGender } from "../utils/normalizeGender.js";
import { DEPARTMENTS } from "../constants/taxonomy.js";

const toPreferredMode = (mode: OnboardingDto["preferredMode"]): PreferredMode =>
  mode === "identified" ? PreferredMode.IDENTIFIED : PreferredMode.ANONYMOUS;

export { UsernameTakenError, DepartmentCooldownError };

// Business rule confirmed 2026-09-10: exactly 60 days, measured from
// departmentChangedAt (not calendar months, which would drift in length).
const DEPARTMENT_COOLDOWN_DAYS = 60;
const DEPARTMENT_COOLDOWN_MS = DEPARTMENT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

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
   * Claim username + gender on User, and create the Onboarding record, as
   * one atomic unit. If the username conflicts, the whole attempt rolls
   * back — there must never be a partial state where Onboarding exists but
   * the username didn't save, or vice versa.
   */
  let updatedUser;
  let onboarding;

  try {
    [updatedUser, onboarding] = await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: {
          username: payload.username,
          gender: toPrismaGender(payload.gender),
        },
      }),
      prisma.onboarding.create({
        data: {
          level: payload.level,
          department: payload.department,
          goals: payload.goals,
          preferredMode: toPreferredMode(payload.preferredMode),
          userId,
        },
      }),
    ]);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const target = err.meta?.target;
      const targetsUsername = Array.isArray(target)
        ? target.includes("username")
        : typeof target === "string" && target.includes("username");

      if (targetsUsername) {
        throw new UsernameTakenError();
      }
    }
    throw err;
  }

  /**
   * Notify the rest of the application
   */
  eventEmitter.emit("user.onboarded", {
    userId,
    level: onboarding.level,
    department: onboarding.department,
  });

  return { onboarding, username: updatedUser.username, gender: updatedUser.gender };
};

/**
 * Changes a student's department post-onboarding, subject to a 60-day
 * cooldown measured from departmentChangedAt. Mirrors userService's
 * updateUsername in shape (throw a distinguishable named error, let the
 * controller pattern-match on it) but lives here rather than in
 * userService.ts because department is an Onboarding-table field, not a
 * User-table field — same domain boundary the rest of this file already
 * respects.
 *
 * Picking the *same* department the student already has is treated as a
 * no-op success, not a "change": it never touches departmentChangedAt, so
 * re-submitting an unchanged form can't accidentally start a fresh 60-day
 * lock the student didn't ask for.
 */
export const updateDepartment = async (userId: string, department: string) => {
  const onboarding = await prisma.onboarding.findUnique({ where: { userId } });

  if (!onboarding) {
    throw new Error("User has not completed onboarding");
  }

  if (onboarding.department === department) {
    return onboarding;
  }

  // A department that no longer exists in the canonical DEPARTMENTS list
  // (e.g. it was renamed/retired in a taxonomy update) was never a choice
  // the student can be held to — the cooldown exists to rate-limit
  // voluntary changes between two currently-valid options, not to lock a
  // student into a value the system itself invalidated. Only enforce the
  // cooldown when their *current* department is still a real, selectable
  // one; a stale current value always allows an immediate correction,
  // regardless of departmentChangedAt.
  const isCurrentDepartmentStale = !DEPARTMENTS.includes(
    onboarding.department as (typeof DEPARTMENTS)[number],
  );

  if (!isCurrentDepartmentStale && onboarding.departmentChangedAt) {
    const availableAt = new Date(
      onboarding.departmentChangedAt.getTime() + DEPARTMENT_COOLDOWN_MS,
    );

    if (availableAt.getTime() > Date.now()) {
      const daysRemaining = Math.ceil(
        (availableAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
      );
      throw new DepartmentCooldownError(availableAt, daysRemaining);
    }
  }

  return prisma.onboarding.update({
    where: { userId },
    data: { department, departmentChangedAt: new Date() },
  });
};
