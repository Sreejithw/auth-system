import express, { type NextFunction, type Request, type Response } from "express";
import session from "express-session";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.DATABASE_URL = "postgres://unused:unused@localhost:5432/unused";
process.env.SESSION_SECRET = "test-session-secret-".repeat(2);
process.env.CSRF_SECRET = "test-csrf-secret-".repeat(3);

const mocks = vi.hoisted(() => ({
  userHasPermission: vi.fn(),
}));

vi.mock("../src/services/authorization.service.js", () => ({
  userHasPermission: mocks.userHasPermission,
}));

const { requirePermission } = await import(
  "../src/middleware/requirePermission.js"
);

function buildApp(userId?: string) {
  const app = express();
  app.use(
    session({
      secret: "test-session-secret-".repeat(2),
      resave: false,
      saveUninitialized: true,
      cookie: { secure: false },
    }),
  );
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.session.userId = userId;
    next();
  });
  app.get(
    "/protected",
    requirePermission("settings:read"),
    (_req, res) => res.status(200).json({ ok: true }),
  );
  return app;
}

describe("requirePermission", () => {
  beforeEach(() => {
    mocks.userHasPermission.mockReset();
  });

  it("returns a coded 401 without a session identity", async () => {
    const response = await request(buildApp()).get("/protected");
    expect(response.status).toBe(401);
    expect(response.body.code).toBe("AUTHENTICATION_REQUIRED");
    expect(mocks.userHasPermission).not.toHaveBeenCalled();
  });

  it("returns a coded 403 when the current permission is absent", async () => {
    mocks.userHasPermission.mockResolvedValue(false);
    const response = await request(buildApp("user-1")).get("/protected");
    expect(response.status).toBe(403);
    expect(response.body.code).toBe("FORBIDDEN");
    expect(mocks.userHasPermission).toHaveBeenCalledWith(
      "user-1",
      "settings:read",
    );
  });

  it("checks the database on every request", async () => {
    mocks.userHasPermission
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const app = buildApp("user-1");
    expect((await request(app).get("/protected")).status).toBe(200);
    expect((await request(app).get("/protected")).status).toBe(403);
    expect(mocks.userHasPermission).toHaveBeenCalledTimes(2);
  });
});
