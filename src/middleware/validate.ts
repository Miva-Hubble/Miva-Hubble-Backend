// middleware/validate.ts

import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";

export const validate =
  (schema: ZodSchema) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = await schema.parseAsync(req.body);

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        console.error("❌ Validation Error on", req.originalUrl, ":", JSON.stringify(error.flatten(), null, 2));
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: error.flatten(),
        });
      }

      next(error);
    }
  };
