import type { QueryResult, QueryResultRow } from "pg";
import { pool } from "../db/pool.js";
import { logger } from "../utils/logger.js";

export const PERMISSIONS = {
  SETTINGS_READ: "settings:read",
  SETTINGS_UPDATE: "settings:update",
  USERS_READ: "users:read",
  USERS_ROLES_UPDATE: "users:roles:update",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export interface Authorization {
  roles: string[];
  permissions: Permission[];
}

export interface FixedRole {
  key: string;
  name: string;
  description: string;
  permissions: Permission[];
}

export interface ListedUser {
  id: string;
  email: string;
  roles: string[];
  createdAt: string;
}

export interface UserList {
  users: ListedUser[];
  nextCursor: string | null;
}

export interface RoleReplacementResult {
  id: string;
  email: string;
  roles: string[];
  permissions: Permission[];
}

export class AuthorizationError extends Error {
  constructor(
    public readonly code:
      | "INVALID_ROLE_ASSIGNMENT"
      | "LAST_ADMINISTRATOR"
      | "SELF_DEMOTION_NOT_ALLOWED"
      | "USER_NOT_FOUND"
      | "INVALID_CURSOR",
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
}

interface AuthorizationRow {
  roles: string[];
  permissions: Permission[];
}

export async function getAuthorizationForUser(
  userId: string,
  db: Queryable = pool,
): Promise<Authorization> {
  const { rows } = await db.query<AuthorizationRow>(
    `SELECT
       COALESCE(array_agg(DISTINCT r.key ORDER BY r.key)
         FILTER (WHERE r.key IS NOT NULL), ARRAY[]::text[]) AS roles,
       COALESCE(array_agg(DISTINCT p.key ORDER BY p.key)
         FILTER (WHERE p.key IS NOT NULL), ARRAY[]::text[]) AS permissions
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     LEFT JOIN role_permissions rp ON rp.role_id = r.id
     LEFT JOIN permissions p ON p.id = rp.permission_id
     WHERE u.id = $1
     GROUP BY u.id`,
    [userId],
  );
  return rows[0] ?? { roles: [], permissions: [] };
}

export async function userHasPermission(
  userId: string,
  permission: Permission,
  db: Queryable = pool,
): Promise<boolean> {
  const { rows } = await db.query<{ allowed: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE ur.user_id = $1 AND p.key = $2
     ) AS allowed`,
    [userId, permission],
  );
  return rows[0]?.allowed === true;
}

export async function listRoles(db: Queryable = pool): Promise<FixedRole[]> {
  const { rows } = await db.query<FixedRole>(
    `SELECT r.key, r.name, r.description,
       COALESCE(array_agg(p.key ORDER BY p.key)
         FILTER (WHERE p.key IS NOT NULL), ARRAY[]::text[]) AS permissions
     FROM roles r
     LEFT JOIN role_permissions rp ON rp.role_id = r.id
     LEFT JOIN permissions p ON p.id = rp.permission_id
     WHERE r.is_system = true
     GROUP BY r.id
     ORDER BY r.key`,
  );
  return rows;
}

interface UserCursor {
  createdAt: string;
  id: string;
}

function decodeCursor(cursor: string): UserCursor {
  try {
    const value = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Partial<UserCursor>;
    if (
      typeof value.createdAt !== "string" ||
      Number.isNaN(Date.parse(value.createdAt)) ||
      typeof value.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value.id,
      )
    ) {
      throw new Error("invalid cursor");
    }
    return { createdAt: value.createdAt, id: value.id };
  } catch {
    throw new AuthorizationError("INVALID_CURSOR", "Invalid cursor", 400);
  }
}

function encodeCursor(user: ListedUser): string {
  return Buffer.from(
    JSON.stringify({ createdAt: user.createdAt, id: user.id }),
  ).toString("base64url");
}

export async function listUsersWithRoles(
  options: { search?: string; limit?: number; cursor?: string },
  db: Queryable = pool,
): Promise<UserList> {
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
  const cursor = options.cursor ? decodeCursor(options.cursor) : null;
  const search = options.search?.trim() || null;
  const { rows } = await db.query<ListedUser>(
    `SELECT u.id, u.email::text AS email,
       COALESCE(array_agg(r.key ORDER BY r.key)
         FILTER (WHERE r.key IS NOT NULL), ARRAY[]::text[]) AS roles,
       u.created_at AS "createdAt"
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     WHERE ($1::text IS NULL OR u.email ILIKE '%' || $1 || '%')
       AND ($2::timestamptz IS NULL OR
         (u.created_at, u.id) < ($2::timestamptz, $3::uuid))
     GROUP BY u.id
     ORDER BY u.created_at DESC, u.id DESC
     LIMIT $4`,
    [search, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1],
  );
  const normalized = rows.map((row) => ({
    ...row,
    createdAt: new Date(row.createdAt).toISOString(),
  }));
  const hasMore = normalized.length > limit;
  const users = normalized.slice(0, limit);
  return {
    users,
    nextCursor: hasMore ? encodeCursor(users[users.length - 1]!) : null,
  };
}

export async function assignDefaultRole(
  client: Queryable,
  userId: string,
): Promise<void> {
  const result = await client.query(
    `INSERT INTO user_roles (user_id, role_id)
     SELECT $1, id FROM roles WHERE key = 'user' AND is_system = true
     ON CONFLICT DO NOTHING`,
    [userId],
  );
  if (result.rowCount !== 1) {
    throw new Error("Base user role is not configured");
  }
}

async function writeDeniedAudit(
  actorUserId: string,
  targetUserId: string,
  requestedRoles: string[],
  reason: string,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO authorization_audit_events
         (actor_user_id, target_user_id, action, outcome, after_roles, reason)
       SELECT $1, $2, 'user.roles.updated', 'denied', $3::jsonb, $4
       WHERE EXISTS (SELECT 1 FROM users WHERE id = $1)
         AND EXISTS (SELECT 1 FROM users WHERE id = $2)`,
      [actorUserId, targetUserId, JSON.stringify(requestedRoles), reason],
    );
  } catch (err) {
    logger.error({ err, actorUserId, targetUserId, reason }, "role_change_audit_failed");
  }
}

export async function replaceUserRoles(
  actorUserId: string,
  targetUserId: string,
  roleKeys: string[],
): Promise<RoleReplacementResult> {
  const requestedRoles = [...new Set([...roleKeys, "user"])].sort();
  const client = await pool.connect();
  let denial: AuthorizationError | null = null;
  try {
    await client.query("BEGIN");
    const targetResult = await client.query<{ id: string; email: string }>(
      `SELECT id, email::text AS email FROM users WHERE id = $1 FOR UPDATE`,
      [targetUserId],
    );
    const target = targetResult.rows[0];
    if (!target) {
      throw new AuthorizationError("USER_NOT_FOUND", "User not found", 404);
    }
    const actorResult = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE id = $1`,
      [actorUserId],
    );
    if (!actorResult.rows[0]) {
      throw new AuthorizationError("USER_NOT_FOUND", "User not found", 404);
    }

    const roleResult = await client.query<{ id: string; key: string }>(
      `SELECT id, key FROM roles
       WHERE is_system = true AND key = ANY($1::text[])
       ORDER BY key`,
      [requestedRoles],
    );
    if (
      roleResult.rows.length !== requestedRoles.length ||
      roleResult.rows.some((role, index) => role.key !== requestedRoles[index])
    ) {
      throw new AuthorizationError(
        "INVALID_ROLE_ASSIGNMENT",
        "One or more roles are unknown",
        400,
      );
    }

    await client.query(
      `SELECT id FROM roles WHERE key = 'administrator' FOR UPDATE`,
    );
    const before = await getAuthorizationForUser(targetUserId, client);
    const removingAdministrator =
      before.roles.includes("administrator") &&
      !requestedRoles.includes("administrator");
    if (removingAdministrator && actorUserId === targetUserId) {
      throw new AuthorizationError(
        "SELF_DEMOTION_NOT_ALLOWED",
        "Administrators cannot remove their own administrator role",
        409,
      );
    }
    if (removingAdministrator) {
      const countResult = await client.query<{ count: string }>(
        `SELECT count(DISTINCT ur.user_id)::text AS count
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         WHERE r.key = 'administrator'`,
      );
      if (Number(countResult.rows[0]?.count ?? 0) <= 1) {
        throw new AuthorizationError(
          "LAST_ADMINISTRATOR",
          "The final administrator cannot be removed",
          409,
        );
      }
    }

    await client.query(`DELETE FROM user_roles WHERE user_id = $1`, [targetUserId]);
    await client.query(
      `INSERT INTO user_roles (user_id, role_id, assigned_by)
       SELECT $1, id, $2 FROM roles WHERE key = ANY($3::text[])`,
      [targetUserId, actorUserId, requestedRoles],
    );
    const authorization = await getAuthorizationForUser(targetUserId, client);
    await client.query(
      `INSERT INTO authorization_audit_events
         (actor_user_id, target_user_id, action, outcome, before_roles, after_roles, reason)
       VALUES ($1, $2, 'user.roles.updated', 'success', $3::jsonb, $4::jsonb, 'roles_replaced')`,
      [
        actorUserId,
        targetUserId,
        JSON.stringify(before.roles),
        JSON.stringify(authorization.roles),
      ],
    );
    await client.query("COMMIT");
    return { ...target, ...authorization };
  } catch (err) {
    await client.query("ROLLBACK");
    if (err instanceof AuthorizationError) denial = err;
    else throw err;
  } finally {
    client.release();
  }

  await writeDeniedAudit(
    actorUserId,
    targetUserId,
    requestedRoles,
    denial!.code,
  );
  throw denial!;
}
