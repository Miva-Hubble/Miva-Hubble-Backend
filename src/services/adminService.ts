// services/adminService.ts

import prisma from "../lib/prisma.js";
import { AdminLoginEventType, AdminStatus } from "@prisma/client";
import { AdminAuthService } from "./adminAuthService.js";

export const AdminService = {
  findByEmail(email: string) {
    return prisma.admin.findUnique({ where: { email } });
  },

  create(data: { name: string; email: string; password: string }) {
    return prisma.admin.create({
      data: {
        name: data.name,
        email: data.email,
        password: data.password,
      },
    });
  },

  /** Returns true if the account is currently inside an active lockout window. */
  isLocked(admin: { lockedUntil: Date | null }) {
    return !!admin.lockedUntil && admin.lockedUntil.getTime() > Date.now();
  },

  /**
   * Records a failed password attempt. Once MAX_LOGIN_ATTEMPTS is reached,
   * locks the account for LOCKOUT_DURATION_MS and resets the counter so the
   * lock window is what gates access, not an ever-growing attempt count.
   */
  async registerFailedAttempt(adminId: string, currentAttempts: number) {
    const attempts = currentAttempts + 1;
    const shouldLock = attempts >= AdminAuthService.MAX_LOGIN_ATTEMPTS;

    return prisma.admin.update({
      where: { id: adminId },
      data: {
        failedLoginAttempts: shouldLock ? 0 : attempts,
        lockedUntil: shouldLock ? new Date(Date.now() + AdminAuthService.LOCKOUT_DURATION_MS) : undefined,
      },
    });
  },

  async registerSuccessfulLogin(adminId: string) {
    return prisma.admin.update({
      where: { id: adminId },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });
  },

  createSession(params: { adminId: string; refreshToken: string; ip?: string; userAgent?: string; expiresAt: Date }) {
    return prisma.adminSession.create({
      data: {
        adminId: params.adminId,
        refreshTokenHash: AdminAuthService.hashRefreshToken(params.refreshToken),
        ip: params.ip,
        userAgent: params.userAgent,
        expiresAt: params.expiresAt,
      },
    });
  },

  findActiveSessionByRefreshToken(refreshToken: string) {
    return prisma.adminSession.findFirst({
      where: {
        refreshTokenHash: AdminAuthService.hashRefreshToken(refreshToken),
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
  },

  revokeSession(id: string) {
    return prisma.adminSession.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  },

  revokeAllSessionsForAdmin(adminId: string) {
    return prisma.adminSession.updateMany({
      where: { adminId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },

  logEvent(params: { email: string; type: AdminLoginEventType; adminId?: string; ip?: string; userAgent?: string }) {
    return prisma.adminLoginEvent.create({
      data: {
        email: params.email,
        type: params.type,
        adminId: params.adminId,
        ip: params.ip,
        userAgent: params.userAgent,
      },
    });
  },
};

export { AdminStatus };
