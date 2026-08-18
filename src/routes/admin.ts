// routes/admin.ts

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { adminLogin, adminRefreshToken, adminLogout, getCurrentAdmin } from "../controller/adminAuthController.js";
import {
  getAdminBookUploadUrl,
  adminCreateBook,
  adminListBooks,
  adminUpdateBook,
  adminDeleteBook,
} from "../controller/storageController.js";
import { validate } from "../middleware/validate.js";
import { AdminLoginSchema } from "../schemas/admin.schema.js";
import { RequestUploadUrlSchema, CreateBookSchema, UpdateBookSchema } from "../schemas/storage.schema.js";
import { authenticateAdmin } from "../middleware/adminAuth.js";
import { notificationController } from "../modules/notifications/notification.controller.js";
import { createNotificationSchema } from "../modules/notifications/notification.validation.js";

const router = Router();

// Rate limiter for notification dispatch — protects Resend email quota.
// 10 dispatches per minute per IP. Sized for the current single-recipient
// dispatch call; revisit once campaign/bulk targeting (Phase 1+) lands, since
// a single admin POST will then resolve to many recipients internally.
const notificationRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many notification requests. Please wait before sending more.",
  },
});

router.post("/auth/login", validate(AdminLoginSchema), adminLogin);
router.post("/auth/refresh", adminRefreshToken);
router.post("/auth/logout", adminLogout);
router.get("/auth/me", authenticateAdmin, getCurrentAdmin);

// Library book management — everything below requires an active admin session
router.post("/storage/books/upload-url", authenticateAdmin, validate(RequestUploadUrlSchema), getAdminBookUploadUrl);
router.post("/storage/books", authenticateAdmin, validate(CreateBookSchema), adminCreateBook);
router.get("/storage/books", authenticateAdmin, adminListBooks);
router.patch("/storage/books/:id", authenticateAdmin, validate(UpdateBookSchema), adminUpdateBook);
router.delete("/storage/books/:id", authenticateAdmin, adminDeleteBook);

// Notification dispatch — admin-only (Phase 0 containment fix).
// Previously mounted at POST /api/notifications/send behind student
// `authenticate`, meaning any authenticated student could trigger a send.
// Now gated by `authenticateAdmin`, same as every other admin capability
// in this file, and validated via the shared `validate()` middleware
// (Phase 0 QA report, Low #11) instead of parsing inline in the controller.
router.post(
  "/notifications/send",
  authenticateAdmin,
  validate(createNotificationSchema),
  notificationRateLimit,
  (req, res, next) => notificationController.sendNotification(req, res, next)
);

export default router;
