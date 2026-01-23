import { OAuth2Client } from "google-auth-library";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.js";
import { LoginProvider } from "../generated/prisma/client.js";

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

interface CreateUserData {
  email: string;
  username: string;
  name: string;
  password?: string;
  googleId?: string;
  picture?: string;
  email_verified?: boolean;
  loginProvider: LoginProvider;
}

export class AuthService {
  static readonly ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || "access-secret";
  static readonly REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || "refresh-secret";
  static readonly ACCESS_TOKEN_EXPIRY: jwt.SignOptions["expiresIn"] = "15m";
  static readonly REFRESH_TOKEN_EXPIRY: jwt.SignOptions["expiresIn"] = "7d";

  //
  static async verifyGoogleToken(token: string) {
    try {
      const ticket = await client.verifyIdToken({
        idToken: token,
        audience: process.env.GOOGLE_CLIENT_ID,
      });

      const payload = ticket.getPayload();
      return payload;
    } catch (error) {
      console.error("Token verification failed:", error);
      return null;
    }
  }

  //
  static async createUser(data: CreateUserData) {
    return prisma.user.create({
      data: {
        email: data.email,
        username: data.username,
        name: data.name,
        password: data.password,
        googleId: data.googleId,
        picture: data.picture,
        email_verified: data.email_verified ?? false,
        email_verified_at: data.email_verified ? new Date() : null,
        last_login_with: data.loginProvider,
        last_login_at: new Date(),
      },
    });
  }

  //
  static async findUserByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } });
  }

  //
  static async findUserByEmailOrUsername(email: string, username: string) {
    return prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
    });
  }

  //
  static async findUserByEmailOrGoogleId(email: string, googleId: string) {
    return prisma.user.findFirst({
      where: { OR: [{ email }, { googleId }] },
    });
  }

  //
  static async updateLastLogin(userId: string, provider: LoginProvider) {
    return prisma.user.update({
      where: { id: userId },
      data: {
        last_login_with: provider,
        last_login_at: new Date(),
      },
    });
  }

  //
  static async linkGoogleAccount(userId: string, googleId: string, picture?: string, emailVerified?: boolean) {
    return prisma.user.update({
      where: { id: userId },
      data: {
        googleId,
        picture,
        email_verified: emailVerified ?? undefined,
        email_verified_at: emailVerified ? new Date() : undefined,
        last_login_with: "GOOGLE",
        last_login_at: new Date(),
      },
    });
  }

  //
  static async hashPassword(data: string) {
    return await bcrypt.hash(data, 12);
  }

  //
  static async comparePassword(password: string, hash: string) {
    return await bcrypt.compare(password, hash);
  }

  //
  static generateAccessToken(payload: { userId: string; email: string }) {
    return jwt.sign(payload, this.ACCESS_TOKEN_SECRET, { expiresIn: this.ACCESS_TOKEN_EXPIRY });
  }

  //
  static generateRefreshToken(payload: { userId: string }) {
    return jwt.sign(payload, this.REFRESH_TOKEN_SECRET, { expiresIn: this.REFRESH_TOKEN_EXPIRY });
  }

  //
  static verifyAccessToken(token: string) {
    return jwt.verify(token, this.ACCESS_TOKEN_SECRET);
  }

  //
  static verifyRefreshToken(token: string) {
    return jwt.verify(token, this.REFRESH_TOKEN_SECRET);
  }

  //
  static generateTokens(userId: string, email: string) {
    return {
      accessToken: this.generateAccessToken({ userId, email }),
      refreshToken: this.generateRefreshToken({ userId }),
    };
  }
}
