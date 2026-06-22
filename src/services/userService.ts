// services/userService.ts

import prisma from "../lib/prisma.js";

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
