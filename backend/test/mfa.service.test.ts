import { generate } from "otplib";
import express from "express";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.DATABASE_URL = "postgres://unused:unused@localhost:5432/unused";
process.env.SESSION_SECRET = "test-session-secret-that-is-at-least-32-chars";
process.env.CSRF_SECRET = "test-csrf-secret-that-is-at-least-32-characters";
// Deterministic test-only key; construct it to avoid resembling a committed credential.
process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(32, 0x42).toString("hex");

let MfaService: (new (database: never) => {
  createSetup(): {
    encryptedSecret: string;
    secret: string;
  };
  activate(
    userId: string,
    encryptedSecret: string,
    code: string,
  ): Promise<string[] | null>;
  verifyTotpAndConsume(userId: string, code: string): Promise<boolean>;
  verifyRecoveryCodeAndConsume(userId: string, code: string): Promise<boolean>;
}) & typeof import("../src/services/mfa.service.js").MfaService;
let encryptTotpSecret: typeof import("../src/services/mfa.service.js").encryptTotpSecret;
let decryptTotpSecret: typeof import("../src/services/mfa.service.js").decryptTotpSecret;
let mfaRouter: typeof import("../src/routes/mfa.js").mfaRouter;

beforeAll(async () => {
  ({ MfaService, encryptTotpSecret, decryptTotpSecret } = await import(
    "../src/services/mfa.service.js"
  ));
  ({ mfaRouter } = await import("../src/routes/mfa.js"));
});

type Code = { id: string; code_hash: string; consumed_at: Date | null };
type State = {
  mfa: { secret_ciphertext: string; last_totp_counter: string | null } | null;
  codes: Code[];
};

function fakeDatabase(state: State) {
  let id = 0;
  const client = {
    async query(sql: string, values: unknown[] = []) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      if (normalized.startsWith("SELECT secret_ciphertext")) {
        return { rows: state.mfa ? [state.mfa] : [], rowCount: state.mfa ? 1 : 0 };
      }
      if (normalized.startsWith("INSERT INTO user_mfa (")) {
        state.mfa = {
          secret_ciphertext: values[1] as string,
          last_totp_counter: String(values[2]),
        };
        return { rows: [], rowCount: 1 };
      }
      if (normalized.startsWith("UPDATE user_mfa SET")) {
        if (state.mfa) state.mfa.last_totp_counter = String(values[1]);
        return { rows: [], rowCount: 1 };
      }
      if (normalized.startsWith("DELETE FROM user_mfa_recovery_codes")) {
        state.codes = [];
        return { rows: [], rowCount: 0 };
      }
      if (normalized.startsWith("INSERT INTO user_mfa_recovery_codes")) {
        state.codes.push({
          id: String(++id),
          code_hash: values[1] as string,
          consumed_at: null,
        });
        return { rows: [], rowCount: 1 };
      }
      if (normalized.startsWith("SELECT id, code_hash")) {
        return {
          rows: state.codes
            .filter((code) => code.consumed_at === null)
            .map(({ id: codeId, code_hash }) => ({ id: codeId, code_hash })),
          rowCount: state.codes.filter((code) => code.consumed_at === null).length,
        };
      }
      if (normalized.startsWith("UPDATE user_mfa_recovery_codes")) {
        const code = state.codes.find(
          (candidate) => candidate.id === values[0] && candidate.consumed_at === null,
        );
        if (code) code.consumed_at = new Date();
        return { rows: [], rowCount: code ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  return { connect: async () => client };
}

describe("MFA cryptography and consumption", () => {
  it("encrypts TOTP seeds with authenticated versioned envelopes", () => {
    const key = Buffer.alloc(32, 7);
    const envelope = encryptTotpSecret("JBSWY3DPEHPK3PXP", key);

    expect(envelope).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(envelope).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decryptTotpSecret(envelope, key)).toBe("JBSWY3DPEHPK3PXP");
    expect(() => decryptTotpSecret(`${envelope}x`, key)).toThrow();
  });

  it("prevents a TOTP time-step from being replayed", async () => {
    const state: State = { mfa: null, codes: [] };
    const service = new MfaService(fakeDatabase(state) as never);
    const setup = service.createSetup();
    const token = await generate({
      secret: setup.secret,
      period: 30,
      digits: 6,
    });
    const recoveryCodes = await service.activate("user-1", setup.encryptedSecret, token);
    expect(recoveryCodes).not.toBeNull();

    const nextToken = await generate({
      secret: setup.secret,
      period: 30,
      digits: 6,
    });
    expect(await service.verifyTotpAndConsume("user-1", nextToken)).toBe(false);
  });

  it("stores recovery codes as hashes and consumes each code only once", async () => {
    const state: State = { mfa: null, codes: [] };
    const service = new MfaService(fakeDatabase(state) as never);
    const setup = service.createSetup();
    const token = await generate({
      secret: setup.secret,
      period: 30,
      digits: 6,
    });
    const recoveryCodes = await service.activate("user-1", setup.encryptedSecret, token);
    const code = recoveryCodes?.[0];
    expect(code).toBeTruthy();
    expect(state.codes.map((entry) => entry.code_hash)).not.toContain(code);
    expect(await service.verifyRecoveryCodeAndConsume("user-1", code as string)).toBe(
      true,
    );
    expect(await service.verifyRecoveryCodeAndConsume("user-1", code as string)).toBe(
      false,
    );
  });

  it("does not treat a pending MFA challenge as an authenticated session", async () => {
    const session: {
      pendingMfaChallenge?: { userId: string; expiresAt: number };
      userId?: string;
      save: (callback: (err?: Error) => void) => void;
    } = {
      pendingMfaChallenge: {
        userId: "user-1",
        expiresAt: Date.now() - 1,
      },
      save: (callback) => callback(),
    };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, { session });
      next();
    });
    app.use("/mfa", mfaRouter);

    await request(app)
      .post("/mfa/verify")
      .send({ totpCode: "123456" })
      .expect(401);
    expect(session.userId).toBeUndefined();
    expect(session.pendingMfaChallenge).toBeUndefined();
  });
});
