import type { Request, Response, NextFunction } from "express";
import { invalidCsrfTokenError } from "./csrf.js";
import { logger } from "../utils/logger.js";

/** 404 handler for unmatched routes. */
export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: "Not found" });
}

/**
 * Centralized error handler. Maps known errors (CSRF, payload too large) to
 * safe generic responses and logs unexpected errors without leaking internals
 * to the client.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err === invalidCsrfTokenError || isCsrfError(err)) {
    res.status(403).json({ error: "Invalid CSRF token" });
    return;
  }

  if (isPayloadTooLarge(err)) {
    res.status(413).json({ error: "Payload too large" });
    return;
  }

  logger.error({ err }, "Unhandled error");
  res.status(500).json({ error: "Internal server error" });
}

function isCsrfError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "EBADCSRFTOKEN"
  );
}

function isPayloadTooLarge(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "type" in err &&
    (err as { type?: string }).type === "entity.too.large"
  );
}
