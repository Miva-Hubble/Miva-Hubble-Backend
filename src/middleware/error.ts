// src/middleware/errorHandler.ts

import { Request, Response, NextFunction } from "express";

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
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

    default:
      console.error(err);

      return res.status(500).json({
        success: false,
        message: "Internal Server Error",
      });
  }
};
