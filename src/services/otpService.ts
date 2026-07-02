import prisma from "../lib/prisma.js";
import { OtpType } from "@prisma/client";

const OTP_EXPIRY_MINUTES = 10;

export class OtpService {
  static generateOtp(length = 6): string {
    return Math.random()
      .toString()
      .slice(2, 2 + length);
  }

  static async createOtp(userId: string, type: OtpType) {
    // Invalidate existing OTPs of same type
    await prisma.otp.updateMany({
      where: { userId, type, used: false },
      data: { used: true },
    });

    const code = this.generateOtp();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    return prisma.otp.create({
      data: { code, type, userId, expiresAt },
    });
  }

  static async verifyOtp(userId: string, code: string, type: OtpType) {
    const otp = await prisma.otp.findFirst({
      where: {
        userId,
        code,
        type,
        used: false,
        expiresAt: { gt: new Date() },
      },
    });

    if (!otp) return null;

    // Mark as used
    await prisma.otp.update({
      where: { id: otp.id },
      data: { used: true },
    });

    return otp;
  }
}
