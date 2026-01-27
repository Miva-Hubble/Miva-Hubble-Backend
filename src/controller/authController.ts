import { Request, Response } from "express";
import { AuthService } from "../services/authService.js";
import { OtpService } from "../services/otpService.js";
import { MailService } from "../services/mailService.js";
import prisma from "../lib/prisma.js";
import { HttpStatus } from "../utils/httpStatus.js";
import { ALLOWED_EMAIL_DOMAIN } from "../schemas/auth.schema.js";

const isMivaEmail = (email: string) => email.endsWith(ALLOWED_EMAIL_DOMAIN);

// Create Manual GET & POST endpoints for normal OAuth screens

// GOOGLE AUTH
export const googleAuth = async (req: Request, res: Response) => {
  try {
    const { credential } = req.body;

    const payload = await AuthService.verifyGoogleToken(credential);

    if (!payload || !payload.email) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ error: "Invalid token" });
    }

    // Validate Miva email domain
    if (!isMivaEmail(payload.email)) {
      return res.status(HttpStatus.FORBIDDEN).json({ error: "Only Miva student emails (@miva.edu.ng) are allowed" });
    }

    // 1. Check if user exists in database
    let user = await prisma.user.findFirst({
      where: {
        OR: [{ email: payload.email }, { googleId: payload.sub }],
      },
    });

    // 2. Create user if they don't exist
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: payload.email,
          username: payload.email.split("@")[0],
          name: payload.name || "",
          googleId: payload.sub,
          picture: payload.picture,
          email_verified: payload.email_verified ?? false,
          email_verified_at: payload.email_verified ? new Date() : null,
          last_login_with: "GOOGLE",
          last_login_at: new Date(),
        },
      });
    } else {
      // Update existing user with Google info and last login
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          googleId: payload.sub,
          picture: payload.picture,
          email_verified: payload.email_verified ?? user.email_verified,
          email_verified_at: payload.email_verified ? new Date() : user.email_verified_at,
          last_login_with: "GOOGLE",
          last_login_at: new Date(),
        },
      });
    }

    // 3. Generate JWT tokens
    const { accessToken, refreshToken } = AuthService.generateTokens(user.id, user.email);

    // 4. Return user data and tokens
    res.status(HttpStatus.OK).json({
      success: true,
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture,
      },
    });
  } catch (error) {
    console.error("Google auth error:", error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: "Authentication failed" });
  }
};

// REGISTER AUTH
export const register = async (req: Request, res: Response) => {
  try {
    // 1. Extract name, username, email, password from request body
    const { name, username, email, password } = req.body;

    // 2. Check if user already exists by email or username
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email }, { username }],
      },
    });

    // 3. If user exists, handle based on verification status
    if (user) {
      // Check which field caused the conflict
      if (user.username === username) {
        return res.status(HttpStatus.CONFLICT).json({ error: "Username already exists" });
      }

      // Email exists - check if verified
      if (!user.email_verified) {
        // Email not verified - resend OTP
        const otp = await OtpService.createOtp(user.id, "EMAIL_VERIFICATION");
        await MailService.sendOtp(user.email, otp.code, "verification");
        return res.status(HttpStatus.CONFLICT).json({ redirectTo: "/otp", message: "Email exists but not verified. OTP sent for verification" });
      }

      // Email exists and is verified
      return res.status(HttpStatus.CONFLICT).json({ error: "Email already exists" });
    }

    // 4. Hash the password
    const hashedPassword = await AuthService.hashPassword(password);

    // 5. Create new user in database
    const newUser = await prisma.user.create({
      data: {
        name,
        username,
        email,
        password: hashedPassword,
        last_login_with: "NORMAL",
        last_login_at: new Date(),
      },
    });

    // 6. Generate and save OTP for email verification
    const otp = await OtpService.createOtp(newUser.id, "EMAIL_VERIFICATION");

    // 7. Send OTP email
    await MailService.sendOtp(newUser.email, otp.code, "verification");

    // 8. Return response asking user to verify email
    return res.status(HttpStatus.CREATED).json({
      success: true,
      redirectTo: "/otp",
      message: "User registered. OTP sent to your email for verification",
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: "Registration failed" });
  }
};

// LOGIN AUTH
export const login = async (req: Request, res: Response) => {
  try {
    // 1. Extract email and password from request body
    const { email, password } = req.body;

    // 2. Find user by email
    const user = await prisma.user.findFirst({ where: { email } });

    // 3. If user doesn't exist, return 401
    if (!user) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ error: "Invalid credentials" });
    }

    // 4. Email not verified
    if (!user.email_verified) {
      // Generate and save OTP
      const otp = await OtpService.createOtp(user.id, "EMAIL_VERIFICATION");
      // Send OTP email
      await MailService.sendOtp(user.email, otp.code, "verification");
      return res.status(HttpStatus.CONFLICT).json({ redirectTo: "/otp", message: "Sent OTP for email verification" });
    }

    // 5. Check if user has a password (might be Google-only user)
    if (!user.password) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ error: "Please login with Google" });
    }

    // 6. Compare password
    const isValidPassword = await AuthService.comparePassword(password, user.password);
    if (!isValidPassword) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ error: "Invalid credentials" });
    }

    // 7. Update last login info
    await prisma.user.update({
      where: { id: user.id },
      data: {
        last_login_with: "NORMAL",
        last_login_at: new Date(),
      },
    });

    // 7. Generate JWT tokens
    const { accessToken, refreshToken } = AuthService.generateTokens(user.id, user.email);

    // 8. Return success response with tokens
    return res.status(HttpStatus.OK).json({ success: true, accessToken, refreshToken, message: "Login successful" });
  } catch (error) {
    console.error("Login error:", error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: "Login failed" });
  }
};

// VERIFY EMAIL OTP
export const verifyEmailOtp = async (req: Request, res: Response) => {
  try {
    const { email, otp } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(HttpStatus.BAD_REQUEST).json({ error: "Invalid request" });
    }

    const validOtp = await OtpService.verifyOtp(user.id, otp, "EMAIL_VERIFICATION");
    if (!validOtp) {
      return res.status(HttpStatus.BAD_REQUEST).json({ error: "Invalid or expired OTP" });
    }

    // Mark email as verified
    await prisma.user.update({
      where: { id: user.id },
      data: {
        email_verified: true,
        email_verified_at: new Date(),
      },
    });

    // Generate JWT tokens
    const { accessToken, refreshToken } = AuthService.generateTokens(user.id, user.email);

    return res.status(HttpStatus.OK).json({
      success: true,
      accessToken,
      refreshToken,
      message: "Email verified successfully",
    });
  } catch (error) {
    console.error("Verify email OTP error:", error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: "Failed to verify email" });
  }
};

// FORGOT PASSWORD - Send OTP
export const forgotPassword = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });

    // Always return success to prevent email enumeration
    if (!user) {
      return res.status(HttpStatus.OK).json({ success: true, message: "If the email exists, an OTP has been sent" });
    }

    // Check if user has a password (Google-only users can't reset password)
    if (!user.password) {
      return res.status(HttpStatus.BAD_REQUEST).json({ error: "This account uses Google login. Please login with Google." });
    }

    // Generate and save OTP
    const otp = await OtpService.createOtp(user.id, "PASSWORD_RESET");

    // Send OTP email
    await MailService.sendOtp(email, otp.code, "reset");

    return res.status(HttpStatus.OK).json({ success: true, message: "OTP sent to your email" });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: "Failed to process request" });
  }
};

// VERIFY OTP
export const verifyResetOtp = async (req: Request, res: Response) => {
  try {
    const { email, otp } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(HttpStatus.BAD_REQUEST).json({ error: "Invalid request" });
    }

    const validOtp = await OtpService.verifyOtp(user.id, otp, "PASSWORD_RESET");
    if (!validOtp) {
      return res.status(HttpStatus.BAD_REQUEST).json({ error: "Invalid or expired OTP" });
    }

    // Generate a temporary reset token
    const resetToken = AuthService.generateAccessToken({ userId: user.id, email: user.email });

    return res.status(HttpStatus.OK).json({ success: true, resetToken });
  } catch (error) {
    console.error("Verify OTP error:", error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: "Failed to verify OTP" });
  }
};

// RESET PASSWORD
export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { resetToken, newPassword } = req.body;

    // Verify reset token
    let decoded;
    try {
      decoded = AuthService.verifyAccessToken(resetToken) as { userId: string; email: string };
    } catch {
      return res.status(HttpStatus.UNAUTHORIZED).json({ error: "Invalid or expired reset token" });
    }

    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user) {
      return res.status(HttpStatus.BAD_REQUEST).json({ error: "User not found" });
    }

    // Hash new password
    const hashedPassword = await AuthService.hashPassword(newPassword);

    // Update password
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    // Send confirmation email
    await MailService.sendPasswordResetSuccess(user.email);

    return res.status(HttpStatus.OK).json({ success: true, message: "Password reset successful" });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: "Failed to reset password" });
  }
};
