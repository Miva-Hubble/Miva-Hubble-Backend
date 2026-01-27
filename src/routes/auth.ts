import { Router } from "express";
import { googleAuth, register, login, verifyEmailOtp, forgotPassword, verifyResetOtp, resetPassword } from "../controller/authController.js";
import { initiateGoogleAuth, handleGoogleCallback, handleGoogleCallbackPopup, exchangeGoogleCode } from "../controller/googleOAuthController.js";
import { validate } from "../middleware/validate.js";
import { GoogleTokenSchema, RegisterSchema, LoginSchema, VerifyOtpSchema, ForgotPasswordSchema, ResetPasswordSchema } from "../schemas/auth.schema.js";

const router = Router();

// Manual OAuth flow (recommended)
router.get("/google", initiateGoogleAuth); // Step 1: Get auth URL
router.get("/google/callback", handleGoogleCallback); // Step 2: Handle callback from Google
router.get("/google/callback-popup", handleGoogleCallbackPopup); // Alternative: Popup window flow
router.post("/google/token", exchangeGoogleCode); // Alternative: Exchange code manually

// Client-side Google Sign-In (legacy)
// router.post("/google", validate(GoogleTokenSchema), googleAuth);

router.post("/register", validate(RegisterSchema), register);
router.post("/login", validate(LoginSchema), login);
router.post("/verify-email", validate(VerifyOtpSchema), verifyEmailOtp);
router.post("/forgot-password", validate(ForgotPasswordSchema), forgotPassword);
router.post("/verify-otp", validate(VerifyOtpSchema), verifyResetOtp);
router.post("/reset-password", validate(ResetPasswordSchema), resetPassword);

export default router;
