import type { Request, Response, NextFunction } from "express";
import { findAdminById } from "../services/user.service.js";

/**
 * Requires an authenticated admin session. Must run after requireAuth (or
 * check userId itself).
 */
export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const user = await findAdminById(userId);
  if (!user?.is_admin) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  next();
}
