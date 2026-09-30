import { describe, expect, it, vi } from "vitest";

process.env.NODE_ENV = "test";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.DATABASE_URL = "postgres://unused:unused@localhost:5432/unused";
process.env.SESSION_SECRET = "test-session-secret-".repeat(2);
process.env.CSRF_SECRET = "test-csrf-secret-".repeat(3);

const {
  assignDefaultRole,
  getAuthorizationForUser,
  userHasPermission,
} = await import("../src/services/authorization.service.js");

describe("authorization service", () => {
  it("returns effective role and permission unions from the database", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          roles: ["settings-manager", "support", "user"],
          permissions: ["settings:read", "settings:update", "users:read"],
        },
      ],
    });
    const authorization = await getAuthorizationForUser("user-1", {
      query,
    } as never);
    expect(authorization).toEqual({
      roles: ["settings-manager", "support", "user"],
      permissions: ["settings:read", "settings:update", "users:read"],
    });
    expect(query.mock.calls[0]?.[0]).toContain("array_agg(DISTINCT p.key");
  });

  it("performs permission lookup against current assignments", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ allowed: true }] });
    await expect(
      userHasPermission(
        "user-1",
        "users:read",
        { query } as never,
      ),
    ).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(expect.any(String), [
      "user-1",
      "users:read",
    ]);
  });

  it("assigns the mandatory base role through the supplied transaction", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    await assignDefaultRole({ query } as never, "user-1");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("'user'"), [
      "user-1",
    ]);
  });

  it("fails registration assignment when the base role is unavailable", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(
      assignDefaultRole({ query } as never, "user-1"),
    ).rejects.toThrow("Base user role is not configured");
  });
});
