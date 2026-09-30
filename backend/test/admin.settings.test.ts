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

vi.mock("../src/services/authorization.service.js", () => ({
  PERMISSIONS: {
    SETTINGS_READ: "settings:read",
    SETTINGS_UPDATE: "settings:update",
    USERS_READ: "users:read",
    USERS_ROLES_UPDATE: "users:roles:update",
  },
  AuthorizationError: class AuthorizationError extends Error {},
  userHasPermission: vi.fn(async (id: string, permission: string) => {
    if (id === "admin-1") return true;
    if (id === "support-1") return permission === "users:read";
    if (id === "settings-manager-1") {
      return permission === "settings:read" || permission === "settings:update";
    }
    return false;
  }),
  listRoles: vi.fn(async () => []),
  listUsersWithRoles: vi.fn(async () => ({ users: [], nextCursor: null })),
  replaceUserRoles: vi.fn(),
}));

const { adminRouter } = await import("../src/routes/admin.js");
const authorizationMocks = await import(
  "../src/services/authorization.service.js"
);
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

describe("admin authorization API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(res.body.code).toBe("RECENT_AUTH_REQUIRED");
  });

  it("allows support users to list users without exposing role mutation", async () => {
    vi.mocked(authorizationMocks.listUsersWithRoles).mockResolvedValueOnce({
      users: [
        {
          id: "00000000-0000-4000-8000-000000000002",
          email: "target@example.com",
          roles: ["user"],
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      nextCursor: null,
    });

    const listResponse = await request(buildApp("support-1")).get(
      "/api/admin/users?search=target&limit=20",
    );
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.users[0].email).toBe("target@example.com");
    expect(authorizationMocks.listUsersWithRoles).toHaveBeenCalledWith({
      search: "target",
      limit: 20,
    });

    const rolesResponse = await request(buildApp("support-1")).get(
      "/api/admin/roles",
    );
    expect(rolesResponse.status).toBe(403);
    expect(rolesResponse.body.code).toBe("FORBIDDEN");
  });

  it("returns the fixed role catalog to role administrators", async () => {
    vi.mocked(authorizationMocks.listRoles).mockResolvedValueOnce([
      {
        key: "user",
        name: "User",
        description: "Base role",
        permissions: [],
      },
    ]);

    const response = await request(buildApp("admin-1")).get("/api/admin/roles");
    expect(response.status).toBe(200);
    expect(response.body.roles).toEqual([
      {
        key: "user",
        name: "User",
        description: "Base role",
        permissions: [],
      },
    ]);
  });

  it("requires recent authentication before replacing roles", async () => {
    const stale = Date.now() - 60 * 60 * 1000;
    const response = await request(buildApp("admin-1", stale))
      .put("/api/admin/users/00000000-0000-4000-8000-000000000002/roles")
      .send({ roleKeys: ["user", "support"] });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe("RECENT_AUTH_REQUIRED");
    expect(authorizationMocks.replaceUserRoles).not.toHaveBeenCalled();
  });

  it("validates and replaces a user's fixed roles", async () => {
    vi.mocked(authorizationMocks.replaceUserRoles).mockResolvedValueOnce({
      id: "00000000-0000-4000-8000-000000000002",
      email: "target@example.com",
      roles: ["settings-manager", "user"],
      permissions: ["settings:read", "settings:update"],
    });

    const response = await request(buildApp("admin-1"))
      .put("/api/admin/users/00000000-0000-4000-8000-000000000002/roles")
      .send({ roleKeys: ["user", "settings-manager"] });

    expect(response.status).toBe(200);
    expect(response.body.user.roles).toEqual(["settings-manager", "user"]);
    expect(authorizationMocks.replaceUserRoles).toHaveBeenCalledWith(
      "admin-1",
      "00000000-0000-4000-8000-000000000002",
      ["user", "settings-manager"],
    );
  });

  it("rejects malformed role assignment requests", async () => {
    const response = await request(buildApp("admin-1"))
      .put("/api/admin/users/not-a-uuid/roles")
      .send({ roleKeys: ["user"], unexpected: true });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("INVALID_ROLE_ASSIGNMENT");
    expect(authorizationMocks.replaceUserRoles).not.toHaveBeenCalled();
  });
});
