import { Router } from "express";
import { googleAuth, register, login, verifyEmailOtp, forgotPassword, verifyResetOtp, resetPassword } from "../controller/authController.js";
import { validate } from "../middleware/validate.js";
import { GoogleTokenSchema, RegisterSchema, LoginSchema, VerifyOtpSchema, ForgotPasswordSchema, ResetPasswordSchema } from "../schemas/auth.schema.js";

const router = Router();

router.post("/google", validate(GoogleTokenSchema), googleAuth);
router.post("/register", validate(RegisterSchema), register);
router.post("/login", validate(LoginSchema), login);
router.post("/verify-email", validate(VerifyOtpSchema), verifyEmailOtp);
router.post("/forgot-password", validate(ForgotPasswordSchema), forgotPassword);
router.post("/verify-otp", validate(VerifyOtpSchema), verifyResetOtp);
router.post("/reset-password", validate(ResetPasswordSchema), resetPassword);

export default router;
