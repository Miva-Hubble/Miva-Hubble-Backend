import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const FROM_EMAIL = process.env.FROM_EMAIL || "noreply@miva.edu.ng";
const APP_NAME = "Miva Hubble";

export class MailService {
  static async sendMail(to: string, subject: string, html: string) {
    return transporter.sendMail({
      from: `"${APP_NAME}" <${FROM_EMAIL}>`,
      to,
      subject,
      html,
    });
  }

  static async sendOtp(to: string, otp: string, type: "verification" | "reset") {
    const subject = type === "verification" ? "Verify your email" : "Reset your password";
    const action = type === "verification" ? "verify your email" : "reset your password";

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>${APP_NAME}</h2>
        <p>Use the following OTP to ${action}:</p>
        <div style="background: #f4f4f4; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 8px; margin: 20px 0;">
          ${otp}
        </div>
        <p>This code expires in 10 minutes.</p>
        <p>If you didn't request this, please ignore this email.</p>
      </div>
    `;

    return this.sendMail(to, subject, html);
  }

  static async sendPasswordResetSuccess(to: string) {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>${APP_NAME}</h2>
        <p>Your password has been successfully reset.</p>
        <p>If you didn't make this change, please contact support immediately.</p>
      </div>
    `;

    return this.sendMail(to, "Password Reset Successful", html);
  }
}
