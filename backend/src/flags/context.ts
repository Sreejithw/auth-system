import { randomUUID } from "node:crypto";
import type { Request } from "express";
import type { EvaluationContext } from "./service.js";

/**
 * Builds targeting data exclusively from server-controlled session/DB state.
 * Request query strings and bodies are deliberately never consulted.
 */
export function buildFlagContext(
  req: Request,
  serverUserEmail?: string,
): EvaluationContext {
  const userId = req.session.userId;
  if (userId) {
    return {
      targetingKey: userId,
      ...(serverUserEmail ? { email: serverUserEmail } : {}),
    };
  }

  req.session.flagAnonymousId ??= randomUUID();
  return { targetingKey: `anonymous:${req.session.flagAnonymousId}` };
}
