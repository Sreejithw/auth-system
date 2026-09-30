import type { SessionData } from "express-session";
import { getDurationMs } from "../services/settings.service.js";

/**
 * Snapshot idle/absolute deadlines at authentication time so active sessions
 * are grandfathered when admin settings change later.
 */
export function applySessionExpirySnapshot(
  session: SessionData,
  now: number = Date.now(),
): void {
  const idleTtlMs = getDurationMs("session.idle_ttl_ms");
  const absoluteTtlMs = getDurationMs("session.absolute_ttl_ms");

  session.sessionStartedAt = now;
  session.idleTtlMsAtIssue = idleTtlMs;
  session.absoluteExpiresAt = now + absoluteTtlMs;
  session.idleExpiresAt = now + idleTtlMs;
  session.lastActivityAt = now;
  session.authenticatedAt = now;
}

/** Paths that must not extend the idle deadline. */
export const ACTIVITY_EXCLUDED_PATHS = new Set([
  "/health",
  "/api/csrf-token",
]);

export function isQualifyingActivity(path: string): boolean {
  const normalized = path.split("?")[0] ?? path;
  return !ACTIVITY_EXCLUDED_PATHS.has(normalized);
}

export type SessionExpiryReason = "idle" | "absolute";

export function evaluateSessionExpiry(
  session: SessionData,
  now: number = Date.now(),
): SessionExpiryReason | null {
  if (!session.userId) return null;

  if (
    typeof session.absoluteExpiresAt === "number" &&
    now >= session.absoluteExpiresAt
  ) {
    return "absolute";
  }

  if (
    typeof session.idleExpiresAt === "number" &&
    now >= session.idleExpiresAt
  ) {
    return "idle";
  }

  return null;
}

/**
 * Extend the idle deadline using the TTL frozen at session issue.
 * Absolute deadline is never modified.
 */
export function refreshIdleDeadline(
  session: SessionData,
  now: number = Date.now(),
): void {
  const idleTtlMs =
    typeof session.idleTtlMsAtIssue === "number" && session.idleTtlMsAtIssue > 0
      ? session.idleTtlMsAtIssue
      : getDurationMs("session.idle_ttl_ms");

  session.lastActivityAt = now;
  session.idleExpiresAt = now + idleTtlMs;
}

export function clearExpiredMfaPending(
  session: SessionData,
  now: number = Date.now(),
): boolean {
  let changed = false;
  if (
    session.pendingMfaChallenge &&
    session.pendingMfaChallenge.expiresAt < now
  ) {
    delete session.pendingMfaChallenge;
    changed = true;
  }
  if (session.pendingMfaSetup && session.pendingMfaSetup.expiresAt < now) {
    delete session.pendingMfaSetup;
    changed = true;
  }
  return changed;
}
