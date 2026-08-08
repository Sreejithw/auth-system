import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.DATABASE_URL = "postgres://unused:unused@localhost:5432/unused";
process.env.SESSION_SECRET = "test-session-secret-that-is-at-least-32-chars";
process.env.CSRF_SECRET = "test-csrf-secret-that-is-at-least-32-characters";
process.env.FLIPT_ENABLED = "false";

const {
  CLIENT_FLAG_DEFAULTS,
  CLIENT_FLAG_KEYS,
  FLAG_DEFINITIONS,
} = await import("../src/flags/definitions.js");
const { evaluateBooleanFlag, evaluateClientFlags } = await import(
  "../src/flags/service.js"
);
const { buildFlagContext } = await import("../src/flags/context.js");
const { flagsRouter } = await import("../src/routes/flags.js");

const context = { targetingKey: "test-user" };

describe("feature flag safety", () => {
  it("uses behavior-preserving defaults when evaluation fails", async () => {
    const failingEvaluator = async (): Promise<boolean> => {
      throw new Error("provider unavailable");
    };

    await expect(
      evaluateBooleanFlag(
        "registration-enabled",
        context,
        failingEvaluator,
      ),
    ).resolves.toBe(true);
    await expect(
      evaluateBooleanFlag(
        "new-dashboard-rollout",
        context,
        failingEvaluator,
      ),
    ).resolves.toBe(false);
  });

  it("evaluates and returns only the client-safe allowlist", async () => {
    const evaluatedKeys: string[] = [];
    const flags = await evaluateClientFlags(
      context,
      async (key, defaultValue) => {
        evaluatedKeys.push(key);
        return !defaultValue;
      },
    );

    expect(evaluatedKeys.sort()).toEqual([...CLIENT_FLAG_KEYS].sort());
    expect(flags).toEqual({
      "new-registration-flow": true,
      "new-dashboard-rollout": true,
    });
    expect(flags).not.toHaveProperty("registration-enabled");
    expect(FLAG_DEFINITIONS["registration-enabled"].defaultValue).toBe(true);
  });

  it("derives stable anonymous context only from the server session", () => {
    const session: Record<string, string> = {};
    const req = {
      body: { targetingKey: "attacker-body" },
      query: { targetingKey: "attacker-query" },
      session,
    };

    const first = buildFlagContext(req as never);
    const second = buildFlagContext(req as never);

    expect(first.targetingKey).toMatch(/^anonymous:/);
    expect(second.targetingKey).toBe(first.targetingKey);
    expect(first.targetingKey).not.toContain("attacker");
  });

  it("serves defaults with private caching and no internal metadata", async () => {
    const app = express();
    app.use((req, _res, next) => {
      Object.assign(req, { session: {} });
      next();
    });
    app.use("/api/flags", flagsRouter);

    const response = await request(app).get("/api/flags").expect(200);

    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body).toEqual({ flags: CLIENT_FLAG_DEFAULTS });
    expect(JSON.stringify(response.body)).not.toContain("registration-enabled");
    expect(JSON.stringify(response.body)).not.toContain("FLIPT");
  });
});
