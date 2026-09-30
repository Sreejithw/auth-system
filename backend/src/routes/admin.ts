import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requirePermission } from "../middleware/requirePermission.js";
import { getDurationMs } from "../services/settings.service.js";
import {
  AuthorizationError,
  listRoles,
  listUsersWithRoles,
  PERMISSIONS,
  replaceUserRoles,
} from "../services/authorization.service.js";
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

const usersQuerySchema = z
  .object({
    search: z.string().trim().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().min(1).max(1000).optional(),
  })
  .strict();

const userIdSchema = z.uuid();

const roleUpdateSchema = z
  .object({
    roleKeys: z.array(z.string().min(1).max(100)).max(20),
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
  requirePermission(PERMISSIONS.SETTINGS_READ),
  (_req: Request, res: Response) => {
    res.set("Cache-Control", "no-store");
    res.status(200).json({ settings: getAllSettings() });
  },
);

adminRouter.put(
  "/settings",
  requirePermission(PERMISSIONS.SETTINGS_UPDATE),
  async (req: Request, res: Response) => {
    if (!hasRecentAuthentication(req)) {
      res.status(401).json({
        error: "Recent authentication required",
        code: "RECENT_AUTH_REQUIRED",
      });
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

adminRouter.get(
  "/users",
  requirePermission(PERMISSIONS.USERS_READ),
  async (req: Request, res: Response) => {
    const parsed = usersQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message ?? "Invalid user query",
        code: "INVALID_USER_QUERY",
      });
      return;
    }
    try {
      res.status(200).json(await listUsersWithRoles(parsed.data));
    } catch (err) {
      if (err instanceof AuthorizationError) {
        res.status(err.status).json({ error: err.message, code: err.code });
        return;
      }
      throw err;
    }
  },
);

adminRouter.get(
  "/roles",
  requirePermission(PERMISSIONS.USERS_ROLES_UPDATE),
  async (_req: Request, res: Response) => {
    res.status(200).json({ roles: await listRoles() });
  },
);

adminRouter.put(
  "/users/:userId/roles",
  requirePermission(PERMISSIONS.USERS_ROLES_UPDATE),
  async (req: Request, res: Response) => {
    if (!hasRecentAuthentication(req)) {
      res.status(401).json({
        error: "Recent authentication required",
        code: "RECENT_AUTH_REQUIRED",
      });
      return;
    }
    const userId = userIdSchema.safeParse(req.params.userId);
    const body = roleUpdateSchema.safeParse(req.body);
    if (!userId.success) {
      res.status(400).json({
        error: "Invalid user ID",
        code: "INVALID_ROLE_ASSIGNMENT",
      });
      return;
    }
    if (!body.success) {
      res.status(400).json({
        error: body.error.issues[0]?.message ?? "Invalid role assignment",
        code: "INVALID_ROLE_ASSIGNMENT",
      });
      return;
    }
    try {
      const user = await replaceUserRoles(
        req.session.userId as string,
        userId.data,
        body.data.roleKeys,
      );
      logger.info(
        {
          actorUserId: req.session.userId,
          targetUserId: userId.data,
          roles: user.roles,
        },
        "user_roles_updated",
      );
      res.status(200).json({ user });
    } catch (err) {
      if (err instanceof AuthorizationError) {
        logger.warn(
          {
            actorUserId: req.session.userId,
            targetUserId: userId.data,
            reason: err.code,
          },
          "user_roles_update_denied",
        );
        res.status(err.status).json({ error: err.message, code: err.code });
        return;
      }
      throw err;
    }
  },
);
