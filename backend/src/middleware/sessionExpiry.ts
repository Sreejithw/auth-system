import type { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger.js";
import { sessionCookieOptions } from "./session.js";
import {
  clearExpiredMfaPending,
  evaluateSessionExpiry,
  isQualifyingActivity,
  refreshIdleDeadline,
  type SessionExpiryReason,
} from "../services/sessionExpiry.js";

function destroyExpiredSession(
  req: Request,
  res: Response,
  reason: SessionExpiryReason,
): void {
  logger.info(
    { reason, userId: req.session.userId },
    reason === "idle" ? "session_expired_idle" : "session_expired_absolute",
  );

  req.session.destroy((err) => {
    if (err) {
      logger.error({ err }, "failed to destroy expired session");
    }
    res.clearCookie("sid", sessionCookieOptions);
    if (!res.headersSent) {
      res.status(401).json({ error: "Session expired", reason });
    }
  });
}

/**
 * Authoritative idle + absolute session enforcement.
 * Must run after express-session and before protected route handlers.
 */
export function sessionExpiryMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const now = Date.now();
  const mfaCleared = clearExpiredMfaPending(req.session, now);

  if (!req.session.userId) {
    if (mfaCleared) {
      req.session.save((err) => {
        if (err) {
          logger.error({ err }, "failed to persist MFA pending cleanup");
          res.status(500).json({ error: "Internal server error" });
          return;
        }
        next();
      });
      return;
    }
    next();
    return;
  }

  const reason = evaluateSessionExpiry(req.session, now);
  if (reason) {
    destroyExpiredSession(req, res, reason);
    return;
  }

  const shouldRefresh =
    isQualifyingActivity(req.path) &&
    typeof req.session.idleExpiresAt === "number";

  if (shouldRefresh) {
    refreshIdleDeadline(req.session, now);
    req.session.save((err) => {
      if (err) {
        logger.error({ err }, "failed to persist idle session refresh");
        res.status(500).json({ error: "Internal server error" });
        return;
      }
      next();
    });
    return;
  }

  if (mfaCleared) {
    req.session.save((err) => {
      if (err) {
        logger.error({ err }, "failed to persist MFA pending cleanup");
        res.status(500).json({ error: "Internal server error" });
        return;
      }
      next();
    });
    return;
  }

  next();
}
