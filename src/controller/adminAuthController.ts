// controller/adminAuthController.ts

import { Request, Response } from "express";
import { AdminAuthService } from "../services/adminAuthService.js";
import { AdminService } from "../services/adminService.js";
import { HttpStatus } from "../utils/httpStatus.js";
import prisma from "../lib/prisma.js";
import { AdminAuthRequest } from "../middleware/adminAuth.js";

const GENERIC_ERROR = "Invalid email or password";

// A fixed, valid bcrypt hash of a random value. When no admin is found we
// still run comparePassword against this so the response time for
// "unknown email" and "wrong password" is indistinguishable — this is what
// stops an attacker from using response latency to enumerate valid admin
// emails.
const DUMMY_HASH = "$2b$12$CwTycUXWue0Thq9StjUM0uJ8G7EF6tRq6RiHiCvyzB8gt1jJvzcaK";

const getClientMeta = (req: Request) => {
  const rawUserAgent = req.headers["user-agent"];
  return {
    ip: req.ip,
    userAgent: Array.isArray(rawUserAgent) ? rawUserAgent[0] : rawUserAgent,
  };
};

/**
 * POST /api/admin/auth/login
 *
 * Follows the required flow:
 *   validate -> find admin -> (not found => generic error)
 *   -> check account status -> check lock status -> check password hash
 *   -> reset attempt counter -> generate tokens -> save session
 *   -> log event -> return success
 *
 * Note: "check account status" and "check lock status" are evaluated
 * *before* the password hash comparison. This is a deliberate, security-
 * motivated reordering of the spec's listed sequence: a disabled or locked
 * account should never spend a bcrypt cycle validating a password, and
 * doing the lock check first means the failed-attempt counter is never
 * incremented on an account that's already locked.
 */
export const adminLogin = async (req: Request, res: Response) => {
  const { email, password } = req.body as { email: string; password: string };
  const { ip, userAgent } = getClientMeta(req);

  try {
    // 1. Find admin by email
    const admin = await AdminService.findByEmail(email);

    if (!admin) {
      // Burn the same amount of time a real password check would take.
      await AdminAuthService.comparePassword(password, DUMMY_HASH);
      await AdminService.logEvent({ email, type: "FAILED_NOT_FOUND", ip, userAgent });
      return res.status(HttpStatus.UNAUTHORIZED).json({ error: GENERIC_ERROR });
    }

    // 2. Check account status
    if (admin.status !== "ACTIVE") {
      await AdminService.logEvent({ email, adminId: admin.id, type: "FAILED_STATUS", ip, userAgent });
      return res.status(HttpStatus.FORBIDDEN).json({
        error: "This admin account is not active. Contact a super admin.",
      });
    }

    // 3. Check lock status (derived from failedLoginAttempts / lockedUntil)
    if (AdminService.isLocked(admin)) {
      await AdminService.logEvent({ email, adminId: admin.id, type: "FAILED_LOCKED", ip, userAgent });
      const retryAfterMs = admin.lockedUntil!.getTime() - Date.now();
      return res.status(HttpStatus.FORBIDDEN).json({
        error: "Account temporarily locked due to too many failed login attempts.",
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      });
    }

    // 4. Check password hash
    const validPassword = await AdminAuthService.comparePassword(password, admin.password);
    if (!validPassword) {
      await AdminService.registerFailedAttempt(admin.id, admin.failedLoginAttempts);
      await AdminService.logEvent({ email, adminId: admin.id, type: "FAILED_PASSWORD", ip, userAgent });
      return res.status(HttpStatus.UNAUTHORIZED).json({ error: GENERIC_ERROR });
    }

    // 5. Success: reset attempts + lastLoginAt
    await AdminService.registerSuccessfulLogin(admin.id);

    // 6. Generate tokens
    const { accessToken, refreshToken } = AdminAuthService.generateTokens(admin.id, admin.email);

    // 7. Save session (only the hashed refresh token is ever persisted)
    await AdminService.createSession({
      adminId: admin.id,
      refreshToken,
      ip,
      userAgent,
      expiresAt: new Date(Date.now() + AdminAuthService.REFRESH_TOKEN_MAX_AGE_MS),
    });

    // 8. Log login event
    await AdminService.logEvent({ email, adminId: admin.id, type: "SUCCESS", ip, userAgent });

    // 9. Set httpOnly cookies (same convention as the student auth flow)
    res.cookie("adminAccessToken", accessToken, AdminAuthService.cookieOptions(AdminAuthService.ACCESS_TOKEN_MAX_AGE_MS));
    res.cookie("adminRefreshToken", refreshToken, AdminAuthService.cookieOptions(AdminAuthService.REFRESH_TOKEN_MAX_AGE_MS));

    // 10. Return success — never password / password_hash, ever
    return res.status(HttpStatus.OK).json({
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
      },
      accessToken,
      expiresIn: AdminAuthService.ACCESS_TOKEN_MAX_AGE_MS / 1000,
    });
  } catch (error) {
    console.error("Admin login error:", error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: "Login failed" });
  }
};

/**
 * POST /api/admin/auth/refresh
 * Rotates the refresh token (old session revoked, new one issued) and
 * issues a fresh short-lived access token.
 */
export const adminRefreshToken = async (req: Request, res: Response) => {
  try {
    const token = req.cookies?.adminRefreshToken;
    if (!token) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ error: "No refresh token provided" });
    }

    let payload: { adminId: string };
    try {
      payload = AdminAuthService.verifyRefreshToken(token) as { adminId: string };
    } catch {
      return res.status(HttpStatus.UNAUTHORIZED).json({ error: "Invalid or expired refresh token" });
    }

    // The token must also correspond to a live, non-revoked session row —
    // this is what lets us instantly invalidate a stolen refresh token via
    // AdminService.revokeSession/revokeAllSessionsForAdmin.
    const session = await AdminService.findActiveSessionByRefreshToken(token);
    if (!session) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ error: "Session no longer valid" });
    }

    const adminById = await prisma.admin.findUnique({ where: { id: payload.adminId } });

    if (!adminById || adminById.status !== "ACTIVE") {
      await AdminService.revokeSession(session.id);
      return res.status(HttpStatus.UNAUTHORIZED).json({ error: "Admin not found or inactive" });
    }

    // Rotate: revoke old session, issue + persist a brand new pair
    await AdminService.revokeSession(session.id);

    const { accessToken, refreshToken } = AdminAuthService.generateTokens(adminById.id, adminById.email);
    const { ip, userAgent } = getClientMeta(req);

    await AdminService.createSession({
      adminId: adminById.id,
      refreshToken,
      ip,
      userAgent,
      expiresAt: new Date(Date.now() + AdminAuthService.REFRESH_TOKEN_MAX_AGE_MS),
    });

    res.cookie("adminAccessToken", accessToken, AdminAuthService.cookieOptions(AdminAuthService.ACCESS_TOKEN_MAX_AGE_MS));
    res.cookie("adminRefreshToken", refreshToken, AdminAuthService.cookieOptions(AdminAuthService.REFRESH_TOKEN_MAX_AGE_MS));

    return res.status(HttpStatus.OK).json({
      accessToken,
      expiresIn: AdminAuthService.ACCESS_TOKEN_MAX_AGE_MS / 1000,
    });
  } catch (error) {
    console.error("Admin token refresh error:", error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: "Token refresh failed" });
  }
};

/**
 * POST /api/admin/auth/logout
 * Revokes the current session and clears cookies. Idempotent.
 */
export const adminLogout = async (req: Request, res: Response) => {
  try {
    const token = req.cookies?.adminRefreshToken;
    if (token) {
      const session = await AdminService.findActiveSessionByRefreshToken(token);
      if (session) await AdminService.revokeSession(session.id);
    }

    res.clearCookie("adminAccessToken", { path: "/" });
    res.clearCookie("adminRefreshToken", { path: "/" });

    return res.status(HttpStatus.OK).json({ success: true, message: "Logged out" });
  } catch (error) {
    console.error("Admin logout error:", error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: "Logout failed" });
  }
};

/**
 * GET /api/admin/auth/me
 * Returns the currently authenticated admin (mounted behind `authenticateAdmin`).
 */
export const getCurrentAdmin = async (req: AdminAuthRequest, res: Response) => {
  const admin = req.admin!;
  return res.status(HttpStatus.OK).json({
    admin: { id: admin.adminId, email: admin.email },
  });
};
