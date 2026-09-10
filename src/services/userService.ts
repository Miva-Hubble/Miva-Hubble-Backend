// services/userService.ts

import prisma from "../lib/prisma.js";
import type { Prisma } from "@prisma/client";
import { UsernameTakenError } from "../errors/usernameTakenError.js";
import { normalizeGender, toPrismaGender } from "../utils/normalizeGender.js";

/**
 * Single shared uniqueness check backing both GET /api/users/check-username
 * (3.1) and PATCH /api/user/username (3.2) — not two copies. `excludeUserId`
 * excludes the requester's own current username from the "taken" check, so
 * editing-without-changing (or checking a name that happens to already be
 * yours) never false-positives as taken.
 */
export async function isUsernameTaken(username: string, excludeUserId?: string): Promise<boolean> {
  const existing = await prisma.user.findUnique({
    where: { username },
    select: { id: true },
  });

  if (!existing) return false;
  if (excludeUserId && existing.id === excludeUserId) return false;
  return true;
}

/**
 * Changes a user's username post-onboarding. Callers are expected to run
 * isUsernameTaken first for a friendly pre-check, but the P2002 catch here
 * is the actual race-condition backstop — two concurrent requests claiming
 * the same name can't both win a pre-check and then both succeed here.
 */
export async function updateUsername(userId: string, username: string) {
  try {
    return await prisma.user.update({
      where: { id: userId },
      data: { username },
      select: { id: true, username: true },
    });
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      const target = (err as { meta?: { target?: unknown } }).meta?.target;
      const targetsUsername = Array.isArray(target)
        ? target.includes("username")
        : typeof target === "string" && target.includes("username");

      if (targetsUsername) {
        throw new UsernameTakenError();
      }
    }
    throw err;
  }
}

/**
 * Claims username + gender together for a legacy pre-migration account
 * (PATCH /api/user/identity). Same P2002 race-condition backstop as
 * updateUsername — two concurrent claims of the same name can't both win.
 */
export async function claimIdentity(userId: string, data: { username: string; gender: "male" | "female" }) {
  try {
    return await prisma.user.update({
      where: { id: userId },
      data: {
        username: data.username,
        gender: toPrismaGender(data.gender),
      },
      select: { id: true, username: true, gender: true },
    });
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      const target = (err as { meta?: { target?: unknown } }).meta?.target;
      const targetsUsername = Array.isArray(target)
        ? target.includes("username")
        : typeof target === "string" && target.includes("username");

      if (targetsUsername) {
        throw new UsernameTakenError();
      }
    }
    throw err;
  }
}

/**
 * Fetches the full user profile including onboarding state.
 * This is the single source of truth every endpoint should use
 * when it needs to tell the frontend whether onboarding is complete.
 */
export async function getUserProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      username: true,
      name: true,
      picture: true,
      profilePicturePath: true,
      gender: true,
      email_verified: true,
      last_login_with: true,
      createdAt: true,
      onboarding: {
        select: {
          level: true,
          department: true,
          goals: true,
          preferredMode: true,
          completedAt: true,
          departmentChangedAt: true,
        },
      },
    },
  });

  if (!user) return null;

  return {
    ...user,
    gender: normalizeGender(user.gender),
    isOnboarded: user.onboarding !== null,
  };
}

// ---------------------------------------------------------------------------
// Admin "Users" dashboard tab (GET /api/admin/users)
// ---------------------------------------------------------------------------

export interface AdminListUsersParams {
  page: number;
  limit: number;
  search?: string;
  level?: string;
  department?: string;
  onboarded?: boolean;
}

export interface AdminUserListItem {
  id: string;
  name: string;
  username: string;
  email: string;
  picture: string | null;
  profilePicturePath: string | null;
  emailVerified: boolean;
  lastLoginWith: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  onboarding: {
    level: string;
    department: string;
    goals: string[];
    preferredMode: string;
    completedAt: Date;
  } | null;
}

export interface AdminUserListResult {
  users: AdminUserListItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

/**
 * Admin-facing paginated user roster for the "Users" dashboard tab —
 * identity fields plus the user's onboarding selection (level, department,
 * goals, preferredMode, completedAt), or `onboarding: null` if they haven't
 * completed onboarding yet. A user without an Onboarding row is still
 * included in the list rather than silently excluded, so the admin can see
 * who still needs to onboard (see the `onboarded: false` filter below).
 *
 * NEVER selects `password` or `googleId` — this is an admin-facing roster,
 * not an account-recovery or auth-debugging tool. If a future admin need
 * requires either field, add it explicitly and re-review at that time
 * rather than widening the existing `select`.
 *
 * A single Prisma `findMany` + `count` (relational `include`, not a raw
 * SQL join) is deliberate here, unlike ProgressionService.listUserProgression's
 * `$queryRaw`: that query needed a 7-day rolling window computed per user,
 * which Prisma's query builder can't express — this one is a plain 1:1
 * relation filter/select, so the ORM path is simpler and equally N+1-safe
 * (one join, not one query per row).
 */
export async function listUsersForAdmin(params: AdminListUsersParams): Promise<AdminUserListResult> {
  const { page, limit, search, level, department, onboarded } = params;

  const where: Prisma.UserWhereInput = {};

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { username: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ];
  }

  if (onboarded === false) {
    // Explicitly "no related Onboarding row", not merely "falsy".
    where.onboarding = { is: null };
  } else if (onboarded === true || level || department) {
    where.onboarding = {
      is: {
        ...(level ? { level } : {}),
        ...(department ? { department } : {}),
      },
    };
  }

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        picture: true,
        profilePicturePath: true,
        email_verified: true,
        last_login_with: true,
        last_login_at: true,
        createdAt: true,
        onboarding: {
          select: {
            level: true,
            department: true,
            goals: true,
            preferredMode: true,
            completedAt: true,
          },
        },
      },
    }),
  ]);

  return {
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      username: u.username,
      email: u.email,
      picture: u.picture,
      profilePicturePath: u.profilePicturePath,
      emailVerified: u.email_verified,
      lastLoginWith: u.last_login_with,
      lastLoginAt: u.last_login_at,
      createdAt: u.createdAt,
      onboarding: u.onboarding,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  };
}

export async function upsertGoogleUser(userInfo: any) {
  if (!userInfo?.email) {
    throw new Error("Google userInfo missing email");
  }

  return await prisma.user.upsert({
    where: {
      email: userInfo.email,
    },
    update: {
      name: userInfo.name || "",
      picture: userInfo.picture,
      googleId: userInfo.id,
      email_verified: userInfo.verified_email ?? false,
      email_verified_at: userInfo.verified_email ? new Date() : null,
      last_login_with: "GOOGLE",
      last_login_at: new Date(),
    },
    create: {
      email: userInfo.email,
      // username intentionally omitted — stays null until chosen during
      // onboarding (see authController.googleAuth's identical comment;
      // that function is dead code, this is the live path).
      name: userInfo.name || "",
      googleId: userInfo.id,
      picture: userInfo.picture,
      email_verified: userInfo.verified_email ?? false,
      email_verified_at: userInfo.verified_email ? new Date() : null,
      last_login_with: "GOOGLE",
      last_login_at: new Date(),
    },
  });
}
