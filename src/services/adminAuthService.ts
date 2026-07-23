// services/adminAuthService.ts

import bcrypt from "bcrypt";
import crypto from "crypto";
import jwt from "jsonwebtoken";

/**
 * Admin tokens are signed with their own secrets and carry a distinct
 * `scope: "admin"` claim so a leaked/forged student token can never be
 * replayed against admin-only routes, and vice versa.
 */
export class AdminAuthService {
  static readonly ACCESS_TOKEN_SECRET =
    process.env.ADMIN_ACCESS_TOKEN_SECRET || "admin-access-secret";
  static readonly REFRESH_TOKEN_SECRET =
    process.env.ADMIN_REFRESH_TOKEN_SECRET || "admin-refresh-secret";

  static readonly ACCESS_TOKEN_EXPIRY: jwt.SignOptions["expiresIn"] = "15m";
  static readonly REFRESH_TOKEN_EXPIRY: jwt.SignOptions["expiresIn"] = "8h";
  static readonly ACCESS_TOKEN_MAX_AGE_MS = 15 * 60 * 1000;
  static readonly REFRESH_TOKEN_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours — admin must re-login after this window

  // Account lockout policy
  static readonly MAX_LOGIN_ATTEMPTS = 5;
  static readonly LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

  static async hashPassword(plain: string) {
    return bcrypt.hash(plain, 12);
  }

  static async comparePassword(plain: string, hash: string) {
    return bcrypt.compare(plain, hash);
  }

  static generateAccessToken(payload: { adminId: string; email: string }) {
    return jwt.sign({ ...payload, scope: "admin" }, this.ACCESS_TOKEN_SECRET, {
      expiresIn: this.ACCESS_TOKEN_EXPIRY,
    });
  }

  static generateRefreshToken(payload: { adminId: string }) {
    // jti gives every refresh token a unique identity so the hash stored in
    // AdminSession is unique even if issued to the same admin twice in the
    // same second.
    return jwt.sign({ ...payload, scope: "admin", jti: crypto.randomUUID() }, this.REFRESH_TOKEN_SECRET, {
      expiresIn: this.REFRESH_TOKEN_EXPIRY,
    });
  }

  static generateTokens(adminId: string, email: string) {
    return {
      accessToken: this.generateAccessToken({ adminId, email }),
      refreshToken: this.generateRefreshToken({ adminId }),
    };
  }

  static verifyAccessToken(token: string) {
    const decoded = jwt.verify(token, this.ACCESS_TOKEN_SECRET) as jwt.JwtPayload;
    if (decoded.scope !== "admin") throw new Error("Invalid token scope");
    return decoded as { adminId: string; email: string; scope: string };
  }

  static verifyRefreshToken(token: string) {
    const decoded = jwt.verify(token, this.REFRESH_TOKEN_SECRET) as jwt.JwtPayload;
    if (decoded.scope !== "admin") throw new Error("Invalid token scope");
    return decoded as { adminId: string; scope: string; jti: string };
  }

  /** We never store raw refresh tokens — only a one-way hash, so a DB leak can't be replayed. */
  static hashRefreshToken(token: string) {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  static cookieOptions(maxAge: number) {
    const isProd = process.env.NODE_ENV === "production";
    return {
      httpOnly: true,
      secure: isProd,
      sameSite: (isProd ? "none" : "lax") as "none" | "lax",
      maxAge,
      path: "/",
    };
  }
}
