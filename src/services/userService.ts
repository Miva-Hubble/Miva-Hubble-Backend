// services/userService.ts

import prisma from "../lib/prisma.js";

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
        },
      },
    },
  });

  if (!user) return null;

  return {
    ...user,
    isOnboarded: user.onboarding !== null,
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
      username: userInfo.email.split("@")[0],
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
