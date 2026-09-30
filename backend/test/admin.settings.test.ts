import express, { type Request, type Response, type NextFunction } from "express";
import session from "express-session";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TEST_SESSION_SECRET = "test-session-secret-".repeat(2);
const TEST_CSRF_SECRET = "test-csrf-secret-".repeat(3);

process.env.NODE_ENV = "test";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.DATABASE_URL = "postgres://unused:unused@localhost:5432/unused";
process.env.SESSION_SECRET = TEST_SESSION_SECRET;
process.env.CSRF_SECRET = TEST_CSRF_SECRET;

vi.mock("../src/services/user.service.js", () => ({
  findAdminById: vi.fn(async (id: string) => {
    if (id === "admin-1") return { id, is_admin: true };
    if (id === "user-1") return { id, is_admin: false };
    return null;
  }),
}));

const { adminRouter } = await import("../src/routes/admin.js");
const {
  configureSettingsDatabase,
  getDurationMs,
  resetSettingsForTests,
} = await import("../src/services/settings.service.js");

type Row = {
  key: string;
  value_ms: number | null;
  value_int: number | null;
  description: string;
  updated_at: Date | null;
  updated_by: string | null;
};

function fakeDatabase(initial: Row[]) {
  const rows = new Map(initial.map((row) => [row.key, { ...row }]));
  return {
    async query(sql: string, values: unknown[] = []) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      if (normalized.startsWith("SELECT key, value_ms")) {
        return { rows: [...rows.values()] };
      }
      if (normalized.startsWith("UPDATE app_settings")) {
        const key = values[0] as string;
        const existing = rows.get(key);
        if (!existing) return { rows: [], rowCount: 0 };
        if (normalized.includes("value_ms = $2")) {
          existing.value_ms = values[1] as number;
          existing.value_int = null;
        } else {
          existing.value_int = values[1] as number;
          existing.value_ms = null;
        }
        existing.updated_by = values[2] as string | null;
        existing.updated_at = new Date();
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${normalized}`);
    },
  };
}

function buildApp(userId: string | null, authenticatedAt = Date.now()) {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: TEST_SESSION_SECRET,
      resave: false,
      saveUninitialized: true,
      cookie: { secure: false },
    }),
  );
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (userId) {
      req.session.userId = userId;
      req.session.authenticatedAt = authenticatedAt;
    }
    next();
  });
  app.use("/api/admin", adminRouter);
  return app;
}

describe("admin settings API", () => {
  beforeEach(() => {
    resetSettingsForTests();
    configureSettingsDatabase(
      fakeDatabase([
        {
          key: "session.idle_ttl_ms",
          value_ms: 8 * 60 * 60 * 1000,
          value_int: null,
          description: "Rolling idle session lifetime",
          updated_at: null,
          updated_by: null,
        },
        {
          key: "session.absolute_ttl_ms",
          value_ms: 24 * 60 * 60 * 1000,
          value_int: null,
          description: "Maximum authenticated session lifetime",
          updated_at: null,
          updated_by: null,
        },
      ]),
    );
  });

  it("rejects non-admin users", async () => {
    const res = await request(buildApp("user-1")).get("/api/admin/settings");
    expect(res.status).toBe(403);
  });

  it("returns settings for admins", async () => {
    const res = await request(buildApp("admin-1")).get("/api/admin/settings");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.settings)).toBe(true);
    expect(res.body.settings.length).toBeGreaterThan(0);
  });

  it("updates settings immediately for admins with recent auth", async () => {
    const agent = request.agent(buildApp("admin-1"));
    const res = await agent.put("/api/admin/settings").send({
      settings: [
        { key: "session.idle_ttl_ms", valueMs: 4 * 60 * 60 * 1000 },
        { key: "session.absolute_ttl_ms", valueMs: 12 * 60 * 60 * 1000 },
      ],
    });
    expect(res.status).toBe(200);
    expect(getDurationMs("session.idle_ttl_ms")).toBe(4 * 60 * 60 * 1000);
    expect(getDurationMs("session.absolute_ttl_ms")).toBe(12 * 60 * 60 * 1000);
  });

  it("rejects settings updates without recent authentication", async () => {
    const stale = Date.now() - 60 * 60 * 1000;
    const res = await request(buildApp("admin-1", stale))
      .put("/api/admin/settings")
      .send({
        settings: [{ key: "session.idle_ttl_ms", valueMs: 60_000 }],
      });
    expect(res.status).toBe(401);
  });
});
