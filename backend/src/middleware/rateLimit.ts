import type { Request, Response, NextFunction, RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { getDurationMs, getInt } from "../services/settings.service.js";
import type { SettingKey } from "../services/settings.service.js";

type LimiterKind = "global" | "auth" | "mfa";

const CONFIG: Record<
  LimiterKind,
  {
    windowKey: SettingKey;
    maxKey: SettingKey;
    skipSuccessfulRequests: boolean;
    message: { error: string };
  }
> = {
  global: {
    windowKey: "rate_limit.global.window_ms",
    maxKey: "rate_limit.global.max",
    skipSuccessfulRequests: false,
    message: { error: "Too many requests, please try again later." },
  },
  auth: {
    windowKey: "rate_limit.auth.window_ms",
    maxKey: "rate_limit.auth.max",
    skipSuccessfulRequests: true,
    message: { error: "Too many attempts, please try again later." },
  },
  mfa: {
    windowKey: "rate_limit.mfa.window_ms",
    maxKey: "rate_limit.mfa.max",
    skipSuccessfulRequests: true,
    message: { error: "Too many attempts, please try again later." },
  },
};

/**
 * Builds a wrapper that recreates the underlying limiter only when settings
 * change. express-rate-limit forbids creating instances inside request
 * handlers by default; we intentionally allow it here so admin timeout edits
 * apply immediately without a process restart.
 */
function createDynamicLimiter(kind: LimiterKind): RequestHandler {
  const config = CONFIG[kind];
  let handler: RequestHandler | null = null;
  let boundWindow = -1;
  let boundMax = -1;

  return (req: Request, res: Response, next: NextFunction) => {
    const windowMs = getDurationMs(config.windowKey);
    const max = getInt(config.maxKey);
    if (!handler || windowMs !== boundWindow || max !== boundMax) {
      handler = rateLimit({
        windowMs,
        limit: max,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        skipSuccessfulRequests: config.skipSuccessfulRequests,
        message: config.message,
        validate: { creationStack: false },
      });
      boundWindow = windowMs;
      boundMax = max;
    }
    return handler(req, res, next);
  };
}

/**
 * Global limiter — coarse cap on total request volume per IP.
 * Window/limit come from app_settings and refresh immediately on change.
 */
export const globalLimiter = createDynamicLimiter("global");

/**
 * Auth limiter — tighter cap on credential endpoints. Complements per-account
 * lockout in the DB.
 */
export const authLimiter = createDynamicLimiter("auth");

/** MFA codes have a separate, stricter brute-force budget. */
export const mfaLimiter = createDynamicLimiter("mfa");
