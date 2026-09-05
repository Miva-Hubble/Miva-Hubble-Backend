// middleware/rateLimit.ts
//
// Thin factory over express-rate-limit's default in-memory store. That
// store is per-process: fine for a single running instance, but if this
// API is ever deployed as multiple concurrent instances behind a load
// balancer, each instance enforces its own window independently — the
// effective combined limit becomes (max * instanceCount) per windowMs, not
// a single global cap. That's an accepted trade-off for "basic protection"
// (per Gate 12 scope: correctness first, measure before optimizing) — a
// Redis-backed store would fix it, and Upstash is already wired up for
// BullMQ (see config/redis.ts) if that becomes necessary later.

import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";
import { HttpStatus } from "../utils/httpStatus.js";
import type { AuthRequest } from "./auth.js";

/**
 * Builds a rate limiter keyed by the authenticated userId when available,
 * falling back to IP. Every route this is applied to runs `authenticate`
 * first (see routes/vault.ts), so req.user.userId is normally present —
 * keying by user rather than only IP stops one student on a shared/proxied
 * IP (campus wifi, NAT) from being penalized for another student's volume,
 * and stops a student from evading the limit by rotating IPs while reusing
 * the same token.
 *
 * The IP fallback MUST go through express-rate-limit's own ipKeyGenerator
 * helper, not raw req.ip: an IPv6 address carries far more usable bits than
 * a v4 one, so a naive per-address key lets a single client cycle through
 * effectively unlimited distinct IPv6 addresses and dodge the limit
 * entirely. ipKeyGenerator collapses an IPv6 address down to its /56 subnet
 * (the library's default) before using it as a key, closing that hole —
 * express-rate-limit v8 enforces this at startup (throwing synchronously
 * from inside rateLimit(), which is why skipping it doesn't just weaken
 * protection, it crashes the whole app before it can even start listening).
 */
export const createRateLimiter = (options: { windowMs: number; max: number; message: string }) =>
  rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    statusCode: HttpStatus.TOO_MANY_REQUESTS,
    message: { error: options.message },
    keyGenerator: (req: Request) => {
      const userId = (req as AuthRequest).user?.userId;
      if (userId) return userId;
      return req.ip ? ipKeyGenerator(req.ip) : "unknown";
    },
  });
