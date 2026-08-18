// src/middleware/errorHandler.ts

import { Request, Response, NextFunction } from "express";
import { ZodError, ZodIssue } from "zod";

export const errorHandler = (
  err: Error & { status?: number },
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  // Zod v4 schema validation errors — .issues (not .errors) is the v4 API
  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: err.issues.map((issue: ZodIssue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  switch (err.message) {
    case "User not found":
      return res.status(404).json({
        success: false,
        message: err.message,
      });

    case "User has already completed onboarding":
      return res.status(409).json({
        success: false,
        message: err.message,
      });

    case "Notification not found":
      return res.status(404).json({
        success: false,
        message: err.message,
      });

    default:
      // Some services (e.g. NotificationService) already know the correct
      // client-facing status for their thrown error and attach it as
      // `err.status` (see dispatchNotification's "No eligible students
      // found..." / "createdByAdminId is required" errors). Without this,
      // every one of those messages fell through to a generic 500 here
      // because the switch above only matches exact, hardcoded strings —
      // silently hiding real 4xx client errors behind "Internal Server
      // Error". Only trust it for 4xx: a mistaken/malicious err.status in
      // the 5xx+ range shouldn't suppress the log below.
      if (err.status && err.status >= 400 && err.status < 500) {
        return res.status(err.status).json({
          success: false,
          message: err.message,
        });
      }

      console.error(err);

      return res.status(500).json({
        success: false,
        message: "Internal Server Error",
      });
  }
};
