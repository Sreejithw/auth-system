import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { getDurationMs } from "../services/settings.service.js";
import {
  getAllSettings,
  updateSettings,
  type SettingKey,
  type SettingUpdate,
} from "../services/settings.service.js";
import { logger } from "../utils/logger.js";

export const adminRouter = Router();

const RECENT_AUTH_FOR_SETTINGS_MS = () =>
  getDurationMs("mfa.recent_auth_ttl_ms");

const settingUpdateSchema = z
  .object({
    key: z.string().min(1),
    valueMs: z.number().int().optional(),
    valueInt: z.number().int().optional(),
  })
  .strict();

const putBodySchema = z
  .object({
    settings: z.array(settingUpdateSchema).min(1).max(50),
  })
  .strict();

function hasRecentAuthentication(req: Request): boolean {
  return (
    typeof req.session.authenticatedAt === "number" &&
    Date.now() - req.session.authenticatedAt <= RECENT_AUTH_FOR_SETTINGS_MS()
  );
}

adminRouter.get(
  "/settings",
  requireAuth,
  requireAdmin,
  (_req: Request, res: Response) => {
    res.set("Cache-Control", "no-store");
    res.status(200).json({ settings: getAllSettings() });
  },
);

adminRouter.put(
  "/settings",
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response) => {
    if (!hasRecentAuthentication(req)) {
      res.status(401).json({ error: "Recent authentication required" });
      return;
    }

    const parsed = putBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message ?? "Invalid settings payload",
      });
      return;
    }

    const updates: SettingUpdate[] = parsed.data.settings.map((item) => ({
      key: item.key as SettingKey,
      valueMs: item.valueMs,
      valueInt: item.valueInt,
    }));

    const result = await updateSettings(updates, req.session.userId ?? null);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }

    logger.info(
      {
        updatedBy: req.session.userId,
        keysChanged: updates.map((u) => u.key),
      },
      "settings_updated",
    );

    res.set("Cache-Control", "no-store");
    res.status(200).json({ settings: result.settings });
  },
);
