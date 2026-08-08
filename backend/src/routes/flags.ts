import { Router, type Request, type Response } from "express";
import { buildFlagContext } from "../flags/context.js";
import { evaluateClientFlags } from "../flags/service.js";
import { findPublicById } from "../services/user.service.js";
import { logger } from "../utils/logger.js";

export const flagsRouter = Router();

flagsRouter.get("/", async (req: Request, res: Response) => {
  let serverUserEmail: string | undefined;
  if (req.session.userId) {
    try {
      serverUserEmail = (await findPublicById(req.session.userId))?.email;
    } catch {
      logger.warn(
        { userId: req.session.userId },
        "could not enrich feature flag context with user email",
      );
    }
  }

  const flags = await evaluateClientFlags(
    buildFlagContext(req, serverUserEmail),
  );
  res.set("Cache-Control", "private, no-store");
  res.status(200).json({ flags });
});
