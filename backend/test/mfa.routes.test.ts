import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import session from "express-session";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.DATABASE_URL = "postgres://unused:unused@localhost:5432/unused";
process.env.SESSION_SECRET = "test-session-secret-".repeat(2);
process.env.CSRF_SECRET = "test-csrf-secret-".repeat(3);

const mocks = vi.hoisted(() => ({
  verifyAnyMfaCredential: vi.fn(),
  findPublicById: vi.fn(),
}));

vi.mock("../src/services/mfa.service.js", () => ({
  mfaService: {
    getStatus: vi.fn(),
    createSetupForLabel: vi.fn(),
    activate: vi.fn(),
    verifyAnyMfaCredential: mocks.verifyAnyMfaCredential,
    disable: vi.fn(),
    regenerateRecoveryCodes: vi.fn(),
  },
}));

vi.mock("../src/services/user.service.js", () => ({
  findById: vi.fn(),
  findPublicById: mocks.findPublicById,
}));

const { mfaRouter } = await import("../src/routes/mfa.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: "test-session-secret-".repeat(2),
      resave: false,
      saveUninitialized: true,
      cookie: { secure: false },
    }),
  );
  app.post(
    "/challenge",
    (req: Request, res: Response, _next: NextFunction) => {
      req.session.pendingMfaChallenge = {
        userId: "user-1",
        expiresAt: Date.now() + 60_000,
      };
      req.session.save((err) => {
        if (err) {
          res.status(500).end();
          return;
        }
        res.status(204).end();
      });
    },
  );
  app.use("/api/auth/mfa", mfaRouter);
  return app;
}

describe("MFA login verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findPublicById.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
    });
  });

  it("retains the challenge after an invalid code so recovery remains possible", async () => {
    mocks.verifyAnyMfaCredential
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const agent = request.agent(buildApp());
    expect((await agent.post("/challenge")).status).toBe(204);

    const invalid = await agent
      .post("/api/auth/mfa/verify")
      .send({ totpCode: "000000" });
    expect(invalid.status).toBe(401);

    const recovery = await agent
      .post("/api/auth/mfa/verify")
      .send({ recoveryCode: "abcdefghijklmnopqrst" });
    expect(recovery.status).toBe(200);
    expect(recovery.body.user.email).toBe("user@example.com");
    expect(mocks.verifyAnyMfaCredential).toHaveBeenCalledTimes(2);
  });
});
