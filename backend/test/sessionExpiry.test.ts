import { describe, expect, it } from "vitest";
import type { SessionData } from "express-session";

const TEST_SESSION_SECRET = "test-session-secret-".repeat(2);
const TEST_CSRF_SECRET = "test-csrf-secret-".repeat(3);

process.env.NODE_ENV = "test";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.DATABASE_URL = "postgres://unused:unused@localhost:5432/unused";
process.env.SESSION_SECRET = TEST_SESSION_SECRET;
process.env.CSRF_SECRET = TEST_CSRF_SECRET;

const {
  applySessionExpirySnapshot,
  clearExpiredMfaPending,
  evaluateSessionExpiry,
  isQualifyingActivity,
  refreshIdleDeadline,
} = await import("../src/services/sessionExpiry.js");
const { resetSettingsForTests } = await import(
  "../src/services/settings.service.js"
);

function emptySession(): SessionData {
  return {} as SessionData;
}

describe("sessionExpiry helpers", () => {
  it("snapshots idle and absolute deadlines from settings", () => {
    resetSettingsForTests();
    const session = emptySession();
    const now = 1_000_000;
    applySessionExpirySnapshot(session, now);

    expect(session.sessionStartedAt).toBe(now);
    expect(session.idleTtlMsAtIssue).toBe(8 * 60 * 60 * 1000);
    expect(session.idleExpiresAt).toBe(now + 8 * 60 * 60 * 1000);
    expect(session.absoluteExpiresAt).toBe(now + 24 * 60 * 60 * 1000);
    expect(session.lastActivityAt).toBe(now);
    expect(session.authenticatedAt).toBe(now);
  });

  it("treats absolute expiry before idle expiry", () => {
    const session = emptySession();
    session.userId = "user-1";
    session.absoluteExpiresAt = 100;
    session.idleExpiresAt = 200;

    expect(evaluateSessionExpiry(session, 150)).toBe("absolute");
    expect(evaluateSessionExpiry(session, 50)).toBeNull();
  });

  it("detects idle expiry when absolute is still valid", () => {
    const session = emptySession();
    session.userId = "user-1";
    session.absoluteExpiresAt = 10_000;
    session.idleExpiresAt = 500;

    expect(evaluateSessionExpiry(session, 500)).toBe("idle");
    expect(evaluateSessionExpiry(session, 499)).toBeNull();
  });

  it("refreshes idle using grandfathered idleTtlMsAtIssue", () => {
    const session = emptySession();
    session.userId = "user-1";
    session.idleTtlMsAtIssue = 5 * 60 * 1000;
    session.absoluteExpiresAt = 1_000_000_000;
    session.idleExpiresAt = 1000;

    refreshIdleDeadline(session, 2000);
    expect(session.lastActivityAt).toBe(2000);
    expect(session.idleExpiresAt).toBe(2000 + 5 * 60 * 1000);
    expect(session.absoluteExpiresAt).toBe(1_000_000_000);
  });

  it("clears expired MFA pending fields without authenticating", () => {
    const session = emptySession();
    session.pendingMfaChallenge = { userId: "u", expiresAt: 10 };
    session.pendingMfaSetup = { encryptedSecret: "x", expiresAt: 20 };

    expect(clearExpiredMfaPending(session, 15)).toBe(true);
    expect(session.pendingMfaChallenge).toBeUndefined();
    expect(session.pendingMfaSetup?.expiresAt).toBe(20);

    expect(clearExpiredMfaPending(session, 25)).toBe(true);
    expect(session.pendingMfaSetup).toBeUndefined();
  });

  it("excludes health and csrf bootstrap from activity", () => {
    expect(isQualifyingActivity("/health")).toBe(false);
    expect(isQualifyingActivity("/api/csrf-token")).toBe(false);
    expect(isQualifyingActivity("/api/auth/me")).toBe(true);
    expect(isQualifyingActivity("/api/auth/me?x=1")).toBe(true);
  });
});
