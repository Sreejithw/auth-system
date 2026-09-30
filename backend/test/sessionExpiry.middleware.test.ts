import express, { type Request, type Response } from "express";
import session from "express-session";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

const TEST_SESSION_SECRET = "test-session-secret-".repeat(2);
const TEST_CSRF_SECRET = "test-csrf-secret-".repeat(3);

process.env.NODE_ENV = "test";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.DATABASE_URL = "postgres://unused:unused@localhost:5432/unused";
process.env.SESSION_SECRET = TEST_SESSION_SECRET;
process.env.CSRF_SECRET = TEST_CSRF_SECRET;

const { sessionExpiryMiddleware } = await import(
  "../src/middleware/sessionExpiry.js"
);
const { applySessionExpirySnapshot } = await import(
  "../src/services/sessionExpiry.js"
);
const { resetSettingsForTests } = await import(
  "../src/services/settings.service.js"
);

function buildApp(seed?: (req: Request) => void) {
  const app = express();
  app.use(
    session({
      secret: TEST_SESSION_SECRET,
      resave: false,
      saveUninitialized: true,
      cookie: { secure: false },
    }),
  );
  if (seed) {
    app.use((req: Request, _res: Response, next) => {
      seed(req);
      next();
    });
  }
  app.use(sessionExpiryMiddleware);
  app.get("/api/auth/me", (req: Request, res: Response) => {
    res.status(200).json({
      userId: req.session.userId ?? null,
      idleExpiresAt: req.session.idleExpiresAt ?? null,
      absoluteExpiresAt: req.session.absoluteExpiresAt ?? null,
    });
  });
  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok" });
  });
  return app;
}

describe("sessionExpiryMiddleware", () => {
  beforeEach(() => {
    resetSettingsForTests();
  });

  it("returns 401 with reason absolute when absolute deadline has passed", async () => {
    const now = Date.now();
    const app = buildApp((req) => {
      req.session.userId = "user-1";
      req.session.absoluteExpiresAt = now - 1;
      req.session.idleExpiresAt = now + 60_000;
      req.session.idleTtlMsAtIssue = 60_000;
    });

    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: "Session expired",
      code: "AUTHENTICATION_REQUIRED",
      reason: "absolute",
    });
  });

  it("returns 401 with reason idle when idle deadline has passed", async () => {
    const now = Date.now();
    const app = buildApp((req) => {
      req.session.userId = "user-1";
      req.session.absoluteExpiresAt = now + 60_000;
      req.session.idleExpiresAt = now - 1;
      req.session.idleTtlMsAtIssue = 60_000;
    });

    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: "Session expired",
      code: "AUTHENTICATION_REQUIRED",
      reason: "idle",
    });
  });

  it("extends idle deadline using grandfathered idleTtlMsAtIssue", async () => {
    const now = Date.now();
    const app = buildApp((req) => {
      req.session.userId = "user-1";
      applySessionExpirySnapshot(req.session, now);
      // Freeze a short idle TTL independent of current settings defaults.
      req.session.idleTtlMsAtIssue = 5 * 60 * 1000;
      req.session.idleExpiresAt = now + 1000;
    });

    const agent = request.agent(app);
    const before = Date.now();
    const res = await agent.get("/api/auth/me");
    expect(res.status).toBe(200);
    expect(res.body.idleExpiresAt).toBeGreaterThanOrEqual(
      before + 5 * 60 * 1000 - 50,
    );
    expect(res.body.absoluteExpiresAt).toBe(now + 24 * 60 * 60 * 1000);
  });

  it("does not treat /health as qualifying activity for idle refresh", async () => {
    const now = Date.now();
    const originalIdle = now + 30_000;
    const app = buildApp((req) => {
      req.session.userId = "user-1";
      req.session.idleTtlMsAtIssue = 5 * 60 * 1000;
      req.session.idleExpiresAt = originalIdle;
      req.session.absoluteExpiresAt = now + 24 * 60 * 60 * 1000;
    });

    const agent = request.agent(app);
    await agent.get("/health");
    const res = await agent.get("/api/auth/me");
    // /me refreshes; verify health itself did not expire the session.
    expect(res.status).toBe(200);
  });

  it("clears expired MFA pending challenge without authenticating", async () => {
    const now = Date.now();
    const app = buildApp((req) => {
      req.session.pendingMfaChallenge = {
        userId: "user-1",
        expiresAt: now - 1,
      };
    });

    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(200);
    expect(res.body.userId).toBeNull();
  });
});
