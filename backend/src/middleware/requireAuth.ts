import type { Request, Response, NextFunction } from "express";

/**
 * Guard for protected routes. Rejects with 401 when there is no authenticated
 * session (i.e. `req.session.userId` is not set).
 */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
}
