import { z } from "zod";

export const ALLOWED_EMAIL_DOMAIN = "@miva.edu.ng";

const mivaEmail = z.email("Invalid email address").refine((email) => email.endsWith(ALLOWED_EMAIL_DOMAIN), {
  message: "Only Miva student emails (@miva.edu.ng) are allowed",
});

export const GoogleTokenSchema = z.object({
  credential: z.string(),
});

export const GoogleUserSchema = z.object({
  sub: z.string(),
  email: z.string(),
  email_verified: z.boolean(),
  name: z.string().optional(),
  picture: z.string().optional(),
  given_name: z.string().optional(),
  family_name: z.string().optional(),
});

export type GoogleTokenInput = z.infer<typeof GoogleTokenSchema>;
export type GoogleUser = z.infer<typeof GoogleUserSchema>;

export const RegisterSchema = z.object({
  name: z.string().min(1, "Name is required"),
  username: z.string(),
  email: mivaEmail,
  password: z
    .string()
    .min(8, "Password must be at least 8 characters long")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character"),
});

export const LoginSchema = z.object({
  email: mivaEmail,
  password: z.string(),
});

export const ForgotPasswordSchema = z.object({
  email: mivaEmail,
});

export const VerifyOtpSchema = z.object({
  email: mivaEmail,
  otp: z.string().length(6, "OTP must be 6 digits"),
});

export const ResetPasswordSchema = z.object({
  resetToken: z.string(),
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters long")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character"),
});
