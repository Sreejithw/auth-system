import { pool } from "../db/pool.js";
import { getDurationMs, getInt } from "./settings.service.js";
import { assignDefaultRole } from "./authorization.service.js";

export interface UserRecord {
  id: string;
  email: string;
  password_hash: string;
  failed_login_attempts: number;
  locked_until: Date | null;
}

export interface PublicUser {
  id: string;
  email: string;
}

/**
 * Insert a new user. Returns the created public user, or `null` if the email
 * already exists (unique-violation is swallowed to keep responses generic).
 * All queries are parameterized — no string concatenation of user input.
 */
export async function createUser(
  email: string,
  passwordHash: string,
): Promise<PublicUser | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<PublicUser>(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $2)
       RETURNING id, email`,
      [email, passwordHash],
    );
    const user = rows[0];
    if (!user) throw new Error("User insert returned no row");
    await assignDefaultRole(client, user.id);
    await client.query("COMMIT");
    return user;
  } catch (err: unknown) {
    await client.query("ROLLBACK");
    // 23505 = unique_violation (duplicate email)
    if (isUniqueViolation(err)) return null;
    throw err;
  } finally {
    client.release();
  }
}

export async function findByEmail(email: string): Promise<UserRecord | null> {
  const { rows } = await pool.query<UserRecord>(
    `SELECT id, email, password_hash, failed_login_attempts, locked_until
     FROM users
     WHERE email = $1`,
    [email],
  );
  return rows[0] ?? null;
}

export async function findById(id: string): Promise<UserRecord | null> {
  const { rows } = await pool.query<UserRecord>(
    `SELECT id, email, password_hash, failed_login_attempts, locked_until
     FROM users
     WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function findPublicById(id: string): Promise<PublicUser | null> {
  const { rows } = await pool.query<PublicUser>(
    `SELECT id, email FROM users WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/** Increment failed attempts and lock the account when the threshold is reached. */
export async function registerFailedLogin(id: string): Promise<void> {
  const maxAttempts = getInt("auth.lockout_max_failed_attempts");
  const lockoutMinutes = Math.max(
    1,
    Math.ceil(getDurationMs("auth.lockout_duration_ms") / 60_000),
  );
  await pool.query(
    `UPDATE users
     SET failed_login_attempts = failed_login_attempts + 1,
         locked_until = CASE
           WHEN failed_login_attempts + 1 >= $2
           THEN now() + ($3 || ' minutes')::interval
           ELSE locked_until
         END
     WHERE id = $1`,
    [id, maxAttempts, String(lockoutMinutes)],
  );
}

/** Clear the failure counter and lock on a successful login. */
export async function resetLoginFailures(id: string): Promise<void> {
  await pool.query(
    `UPDATE users
     SET failed_login_attempts = 0,
         locked_until = NULL
     WHERE id = $1`,
    [id],
  );
}

export function isLocked(user: UserRecord): boolean {
  return user.locked_until !== null && user.locked_until.getTime() > Date.now();
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}
