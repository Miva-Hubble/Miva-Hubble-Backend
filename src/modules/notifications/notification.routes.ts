import { Router } from "express";
import { notificationController } from "./notification.controller.js";
import { authenticate } from "../../middleware/auth.js";

const router = Router();

// NOTE: POST /send (notification dispatch) has been moved to the admin
// boundary — see routes/admin.ts ("POST /api/admin/notifications/send").
// This module only exposes student-facing, read-only status endpoints.
// Any authenticated user could previously trigger a dispatch here, which
// was a live authorization gap — do not re-add a /send route to this router.

// Get user notifications (GET /api/notifications/user/me)
// MUST be registered before /:id — static routes take priority over parameterized ones
router.get(
  "/user/me",
  authenticate,
  (req, res, next) => notificationController.getUserNotifications(req, res, next)
);

// Get notification status by ID (GET /api/notifications/:id)
router.get(
  "/:id",
  authenticate,
  (req, res, next) => notificationController.getNotificationStatus(req, res, next)
);

export default router;
