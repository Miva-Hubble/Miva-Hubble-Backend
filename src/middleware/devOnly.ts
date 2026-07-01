import { Request, Response, NextFunction } from "express";

/** Blocks dev-only routes in production unless ENABLE_DEBUG_TOKEN=true. */
export const devOnly = (_req: Request, res: Response, next: NextFunction) => {
  const allowed =
    process.env.NODE_ENV !== "production" ||
    process.env.ENABLE_DEBUG_TOKEN === "true";

  if (!allowed) {
    return res.status(404).json({ error: "Not found" });
  }
  next();
};
