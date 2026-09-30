import type { Pool } from "pg";
import { pool } from "../db/pool.js";

export type SettingKey =
  | "session.idle_ttl_ms"
  | "session.absolute_ttl_ms"
  | "session.store_prune_interval_ms"
  | "mfa.challenge_ttl_ms"
  | "mfa.recent_auth_ttl_ms"
  | "auth.lockout_duration_ms"
  | "auth.lockout_max_failed_attempts"
  | "rate_limit.global.window_ms"
  | "rate_limit.global.max"
  | "rate_limit.auth.window_ms"
  | "rate_limit.auth.max"
  | "rate_limit.mfa.window_ms"
  | "rate_limit.mfa.max"
  | "flags.evaluation_timeout_ms";

export interface SettingDefinition {
  key: SettingKey;
  description: string;
  valueMs?: number;
  valueInt?: number;
}

export interface SettingRecord extends SettingDefinition {
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface SettingUpdate {
  key: SettingKey;
  valueMs?: number;
  valueInt?: number;
}

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const DAY = 24 * HOUR;

/** Seed / fallback defaults — must match the migration seeds. */
export const SETTING_DEFAULTS: ReadonlyArray<SettingDefinition> = [
  {
    key: "session.idle_ttl_ms",
    valueMs: 8 * HOUR,
    description: "Rolling idle session lifetime",
  },
  {
    key: "session.absolute_ttl_ms",
    valueMs: 24 * HOUR,
    description: "Maximum authenticated session lifetime",
  },
  {
    key: "session.store_prune_interval_ms",
    valueMs: 15 * MINUTE,
    description: "Interval for pruning expired session rows",
  },
  {
    key: "mfa.challenge_ttl_ms",
    valueMs: 10 * MINUTE,
    description: "Pending MFA login challenge and setup window",
  },
  {
    key: "mfa.recent_auth_ttl_ms",
    valueMs: 10 * MINUTE,
    description: "Window for sensitive MFA actions after full auth",
  },
  {
    key: "auth.lockout_duration_ms",
    valueMs: 15 * MINUTE,
    description: "Account lockout duration after failed logins",
  },
  {
    key: "auth.lockout_max_failed_attempts",
    valueInt: 5,
    description: "Failed logins before account lockout",
  },
  {
    key: "rate_limit.global.window_ms",
    valueMs: 15 * MINUTE,
    description: "Global per-IP rate-limit window",
  },
  {
    key: "rate_limit.global.max",
    valueInt: 300,
    description: "Max requests per global rate-limit window",
  },
  {
    key: "rate_limit.auth.window_ms",
    valueMs: 15 * MINUTE,
    description: "Login/register per-IP rate-limit window",
  },
  {
    key: "rate_limit.auth.max",
    valueInt: 10,
    description: "Max failed auth attempts per rate-limit window",
  },
  {
    key: "rate_limit.mfa.window_ms",
    valueMs: 15 * MINUTE,
    description: "MFA per-IP rate-limit window",
  },
  {
    key: "rate_limit.mfa.max",
    valueInt: 5,
    description: "Max failed MFA attempts per rate-limit window",
  },
  {
    key: "flags.evaluation_timeout_ms",
    valueMs: 750,
    description: "Feature-flag provider evaluation timeout",
  },
];

const KNOWN_KEYS = new Set<SettingKey>(
  SETTING_DEFAULTS.map((setting) => setting.key),
);

const MAX_DURATION_MS: Partial<Record<SettingKey, number>> = {
  "session.idle_ttl_ms": 30 * DAY,
  "session.absolute_ttl_ms": 90 * DAY,
  "session.store_prune_interval_ms": DAY,
  "mfa.challenge_ttl_ms": DAY,
  "mfa.recent_auth_ttl_ms": DAY,
  "auth.lockout_duration_ms": DAY,
  "rate_limit.global.window_ms": DAY,
  "rate_limit.auth.window_ms": DAY,
  "rate_limit.mfa.window_ms": DAY,
  "flags.evaluation_timeout_ms": 30_000,
};

type CacheEntry = {
  valueMs: number | null;
  valueInt: number | null;
  description: string;
  updatedAt: string | null;
  updatedBy: string | null;
};

type Queryable = Pick<Pool, "query">;

function defaultsToCache(): Map<SettingKey, CacheEntry> {
  const map = new Map<SettingKey, CacheEntry>();
  for (const setting of SETTING_DEFAULTS) {
    map.set(setting.key, {
      valueMs: setting.valueMs ?? null,
      valueInt: setting.valueInt ?? null,
      description: setting.description,
      updatedAt: null,
      updatedBy: null,
    });
  }
  return map;
}

let cache = defaultsToCache();
let database: Queryable = pool;

/** Replace the backing store (tests). Resets cache to defaults. */
export function configureSettingsDatabase(db: Queryable): void {
  database = db;
  cache = defaultsToCache();
}

/** Reset to process defaults and the shared pool (tests). */
export function resetSettingsForTests(): void {
  database = pool;
  cache = defaultsToCache();
}

function getEntry(key: SettingKey): CacheEntry {
  const entry = cache.get(key);
  if (!entry) {
    throw new Error(`Unknown setting key: ${key}`);
  }
  return entry;
}

export function getDurationMs(key: SettingKey): number {
  const value = getEntry(key).valueMs;
  if (value === null || value === undefined) {
    throw new Error(`Setting ${key} is not a duration`);
  }
  return value;
}

export function getInt(key: SettingKey): number {
  const value = getEntry(key).valueInt;
  if (value === null || value === undefined) {
    throw new Error(`Setting ${key} is not an integer`);
  }
  return value;
}

export function getAllSettings(): SettingRecord[] {
  return SETTING_DEFAULTS.map((definition) => {
    const entry = getEntry(definition.key);
    return {
      key: definition.key,
      description: entry.description,
      valueMs: entry.valueMs ?? undefined,
      valueInt: entry.valueInt ?? undefined,
      updatedAt: entry.updatedAt,
      updatedBy: entry.updatedBy,
    };
  });
}

export function validateSettingUpdates(
  updates: SettingUpdate[],
): { ok: true; values: Map<SettingKey, CacheEntry> } | { ok: false; error: string } {
  if (updates.length === 0) {
    return { ok: false, error: "At least one setting is required" };
  }

  const next = new Map(cache);
  for (const update of updates) {
    if (!KNOWN_KEYS.has(update.key)) {
      return { ok: false, error: `Unknown setting key: ${update.key}` };
    }

    const existing = getEntry(update.key);
    const hasMs = update.valueMs !== undefined;
    const hasInt = update.valueInt !== undefined;
    if (hasMs === hasInt) {
      return {
        ok: false,
        error: `Setting ${update.key} requires exactly one of valueMs or valueInt`,
      };
    }

    if (existing.valueMs !== null) {
      if (!hasMs || update.valueMs === undefined) {
        return { ok: false, error: `Setting ${update.key} expects valueMs` };
      }
      if (!Number.isInteger(update.valueMs) || update.valueMs <= 0) {
        return {
          ok: false,
          error: `Setting ${update.key} must be a positive integer duration`,
        };
      }
      const max = MAX_DURATION_MS[update.key];
      if (max !== undefined && update.valueMs > max) {
        return {
          ok: false,
          error: `Setting ${update.key} exceeds maximum of ${max} ms`,
        };
      }
      next.set(update.key, {
        ...existing,
        valueMs: update.valueMs,
        valueInt: null,
      });
    } else {
      if (!hasInt || update.valueInt === undefined) {
        return { ok: false, error: `Setting ${update.key} expects valueInt` };
      }
      if (!Number.isInteger(update.valueInt) || update.valueInt < 1) {
        return {
          ok: false,
          error: `Setting ${update.key} must be an integer >= 1`,
        };
      }
      next.set(update.key, {
        ...existing,
        valueMs: null,
        valueInt: update.valueInt,
      });
    }
  }

  const idle = next.get("session.idle_ttl_ms")?.valueMs ?? 0;
  const absolute = next.get("session.absolute_ttl_ms")?.valueMs ?? 0;
  if (absolute < idle) {
    return {
      ok: false,
      error: "session.absolute_ttl_ms must be greater than or equal to session.idle_ttl_ms",
    };
  }

  return { ok: true, values: next };
}

type DbRow = {
  key: string;
  value_ms: string | number | null;
  value_int: number | null;
  description: string;
  updated_at: Date | string | null;
  updated_by: string | null;
};

function rowToEntry(row: DbRow): CacheEntry {
  return {
    valueMs:
      row.value_ms === null || row.value_ms === undefined
        ? null
        : Number(row.value_ms),
    valueInt: row.value_int,
    description: row.description,
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : row.updated_at,
    updatedBy: row.updated_by,
  };
}

/** Load settings from Postgres into the in-memory cache. */
export async function initializeSettings(): Promise<void> {
  const { rows } = await database.query<DbRow>(
    `SELECT key, value_ms, value_int, description, updated_at, updated_by
     FROM app_settings`,
  );

  const next = defaultsToCache();
  for (const row of rows) {
    if (!KNOWN_KEYS.has(row.key as SettingKey)) continue;
    next.set(row.key as SettingKey, rowToEntry(row));
  }
  cache = next;
}

/**
 * Persist setting updates, refresh the cache, and return the new snapshot.
 * Callers must authorize the actor separately.
 */
export async function updateSettings(
  updates: SettingUpdate[],
  updatedBy: string | null,
): Promise<{ ok: true; settings: SettingRecord[] } | { ok: false; error: string }> {
  const validated = validateSettingUpdates(updates);
  if (!validated.ok) return validated;

  for (const update of updates) {
    if (update.valueMs !== undefined) {
      await database.query(
        `UPDATE app_settings
         SET value_ms = $2,
             value_int = NULL,
             updated_at = now(),
             updated_by = $3
         WHERE key = $1`,
        [update.key, update.valueMs, updatedBy],
      );
    } else {
      await database.query(
        `UPDATE app_settings
         SET value_int = $2,
             value_ms = NULL,
             updated_at = now(),
             updated_by = $3
         WHERE key = $1`,
        [update.key, update.valueInt, updatedBy],
      );
    }
  }

  await initializeSettings();
  return { ok: true, settings: getAllSettings() };
}
