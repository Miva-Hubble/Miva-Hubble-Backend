import { Request, Response, NextFunction } from "express";
import { notificationService } from "./notification.service.js";
import { notificationIdParamSchema } from "./notification.validation.js";
import type { CreateNotificationInput } from "./notification.validation.js";
import type { AdminAuthRequest } from "../../middleware/adminAuth.js";

export class NotificationController {
  // sendNotification is only reachable via POST /api/admin/notifications/send,
  // which is gated by authenticateAdmin + validate(createNotificationSchema)
  // (see routes/admin.ts). Validation now happens in that shared middleware,
  // matching every other admin route, instead of parsing inline here
  // (Phase 0 QA report, Low #11) — req.body is already validated and
  // sanitized by the time this handler runs.
  async sendNotification(req: AdminAuthRequest, res: Response, next: NextFunction) {
    try {
      const validatedInput = req.body as CreateNotificationInput;

      // Delegate execution to Service — admin identity comes from the
      // verified token (req.admin), never from the request body, so it can't
      // be spoofed by the caller.
      const result = await notificationService.dispatchNotification(
        validatedInput,
        req.admin?.adminId
      );

      // Return HTTP 202 Accepted response (Command accepted for processing)
      return res.status(202).json({
        success: true,
        message: "Notification batch accepted and queued for delivery",
        data: {
          queuedCount: result.queuedCount,
          targetLevels: result.targetLevels,
        },
      });
    } catch (error) {
      return next(error);
    }
  }

  async getNotificationStatus(req: Request, res: Response, next: NextFunction) {
    try {
      // 1. Validate parameter schema
      const { id } = notificationIdParamSchema.parse(req.params);

      // 2. Delegate execution to Service
      const notification = await notificationService.getNotificationStatus(id);

      // 3. Ownership check — prevent IDOR: a student may only read their own
      //    notifications. Return 404 (not 403) to avoid leaking existence info.
      const requestingUserId = (req as any).user?.userId;
      if (notification.userId && notification.userId !== requestingUserId) {
        return res.status(404).json({
          success: false,
          message: "Notification not found",
        });
      }

      // 4. Return HTTP 200 Response
      return res.status(200).json({
        success: true,
        data: notification,
      });
    } catch (error) {
      return next(error);
    }
  }

  async getUserNotifications(req: Request, res: Response, next: NextFunction) {
    try {
      // authenticate middleware sets req.user.userId (see middleware/auth.ts AuthRequest interface)
      const userId = (req as any).user?.userId;
      if (!userId) {
        return res.status(400).json({
          success: false,
          message: "User ID is required",
        });
      }

      const notifications = await notificationService.getUserNotifications(userId);

      return res.status(200).json({
        success: true,
        data: notifications,
      });
    } catch (error) {
      return next(error);
    }
  }
}

export const notificationController = new NotificationController();
