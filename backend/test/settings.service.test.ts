import { beforeEach, describe, expect, it } from "vitest";
import type { SettingKey } from "../src/services/settings.service.js";

const TEST_SESSION_SECRET = "test-session-secret-".repeat(2);
const TEST_CSRF_SECRET = "test-csrf-secret-".repeat(3);

process.env.NODE_ENV = "test";
process.env.CORS_ORIGIN = "http://localhost:5173";
process.env.DATABASE_URL = "postgres://unused:unused@localhost:5432/unused";
process.env.SESSION_SECRET = TEST_SESSION_SECRET;
process.env.CSRF_SECRET = TEST_CSRF_SECRET;

const {
  configureSettingsDatabase,
  getAllSettings,
  getDurationMs,
  getInt,
  initializeSettings,
  resetSettingsForTests,
  updateSettings,
  validateSettingUpdates,
} = await import("../src/services/settings.service.js");

type Row = {
  key: string;
  value_ms: number | null;
  value_int: number | null;
  description: string;
  updated_at: Date | null;
  updated_by: string | null;
};

function fakeDatabase(initial: Row[] = []) {
  const rows = new Map<string, Row>(initial.map((row) => [row.key, { ...row }]));
  return {
    rows,
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

beforeEach(() => {
  resetSettingsForTests();
});

describe("settings.service validation", () => {
  it("rejects unknown keys and xor violations", () => {
    expect(
      validateSettingUpdates([
        { key: "not.a.real.key" as SettingKey, valueMs: 1000 },
      ]).ok,
    ).toBe(false);

    expect(
      validateSettingUpdates([
        { key: "session.idle_ttl_ms", valueMs: 1000, valueInt: 1 },
      ]).ok,
    ).toBe(false);

    expect(
      validateSettingUpdates([{ key: "session.idle_ttl_ms" }]).ok,
    ).toBe(false);
  });

  it("rejects absolute TTL shorter than idle TTL", () => {
    const result = validateSettingUpdates([
      { key: "session.idle_ttl_ms", valueMs: 8 * 60 * 60 * 1000 },
      { key: "session.absolute_ttl_ms", valueMs: 60 * 60 * 1000 },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/absolute_ttl_ms/);
    }
  });

  it("accepts valid duration and integer updates", () => {
    const result = validateSettingUpdates([
      { key: "session.idle_ttl_ms", valueMs: 4 * 60 * 60 * 1000 },
      { key: "session.absolute_ttl_ms", valueMs: 12 * 60 * 60 * 1000 },
      { key: "rate_limit.mfa.max", valueInt: 3 },
    ]);
    expect(result.ok).toBe(true);
  });
});

describe("settings.service cache", () => {
  it("starts with seeded defaults before DB load", () => {
    expect(getDurationMs("session.idle_ttl_ms")).toBe(8 * 60 * 60 * 1000);
    expect(getDurationMs("session.absolute_ttl_ms")).toBe(24 * 60 * 60 * 1000);
    expect(getInt("auth.lockout_max_failed_attempts")).toBe(5);
    expect(getAllSettings()).toHaveLength(14);
  });

  it("loads DB values into the cache and refreshes immediately on update", async () => {
    const db = fakeDatabase([
      {
        key: "session.idle_ttl_ms",
        value_ms: 30 * 60 * 1000,
        value_int: null,
        description: "Rolling idle session lifetime",
        updated_at: null,
        updated_by: null,
      },
      {
        key: "session.absolute_ttl_ms",
        value_ms: 2 * 60 * 60 * 1000,
        value_int: null,
        description: "Maximum authenticated session lifetime",
        updated_at: null,
        updated_by: null,
      },
    ]);
    configureSettingsDatabase(db);

    await initializeSettings();
    expect(getDurationMs("session.idle_ttl_ms")).toBe(30 * 60 * 1000);
    expect(getDurationMs("session.absolute_ttl_ms")).toBe(2 * 60 * 60 * 1000);

    const updated = await updateSettings(
      [
        { key: "session.idle_ttl_ms", valueMs: 15 * 60 * 1000 },
        { key: "session.absolute_ttl_ms", valueMs: 60 * 60 * 1000 },
      ],
      "11111111-1111-1111-1111-111111111111",
    );

    expect(updated.ok).toBe(true);
    expect(getDurationMs("session.idle_ttl_ms")).toBe(15 * 60 * 1000);
    expect(getDurationMs("session.absolute_ttl_ms")).toBe(60 * 60 * 1000);
    expect(db.rows.get("session.idle_ttl_ms")?.updated_by).toBe(
      "11111111-1111-1111-1111-111111111111",
    );
  });

  it("does not mutate cache when validation fails", async () => {
    const before = getDurationMs("session.idle_ttl_ms");
    const result = await updateSettings(
      [{ key: "session.idle_ttl_ms", valueMs: -1 }],
      null,
    );
    expect(result.ok).toBe(false);
    expect(getDurationMs("session.idle_ttl_ms")).toBe(before);
  });
});
