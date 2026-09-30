import type { NextFunction, Request, Response } from "express";
import {
  userHasPermission,
  type Permission,
} from "../services/authorization.service.js";

/**
 * Checks the current database state on every request so grants and revocations
 * take effect immediately.
 */
export function requirePermission(permission: Permission) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({
        error: "Authentication required",
        code: "AUTHENTICATION_REQUIRED",
      });
      return;
    }
    if (!(await userHasPermission(userId, permission))) {
      res.status(403).json({
        error: "Required permission is missing",
        code: "FORBIDDEN",
      });
      return;
    }
    next();
  };
}
