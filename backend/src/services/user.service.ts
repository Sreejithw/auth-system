import { pool } from "../db/pool.js";

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

/** Number of consecutive failed logins before an account is temporarily locked. */
export const MAX_FAILED_ATTEMPTS = 5;
/** How long an account stays locked once the threshold is hit. */
export const LOCKOUT_MINUTES = 15;

/**
 * Insert a new user. Returns the created public user, or `null` if the email
 * already exists (unique-violation is swallowed to keep responses generic).
 * All queries are parameterized — no string concatenation of user input.
 */
export async function createUser(
  email: string,
  passwordHash: string,
): Promise<PublicUser | null> {
  try {
    const { rows } = await pool.query<PublicUser>(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $2)
       RETURNING id, email`,
      [email, passwordHash],
    );
    return rows[0] ?? null;
  } catch (err: unknown) {
    // 23505 = unique_violation (duplicate email)
    if (isUniqueViolation(err)) return null;
    throw err;
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

export async function findPublicById(id: string): Promise<PublicUser | null> {
  const { rows } = await pool.query<PublicUser>(
    `SELECT id, email FROM users WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/** Increment failed attempts and lock the account when the threshold is reached. */
export async function registerFailedLogin(id: string): Promise<void> {
  await pool.query(
    `UPDATE users
     SET failed_login_attempts = failed_login_attempts + 1,
         locked_until = CASE
           WHEN failed_login_attempts + 1 >= $2
           THEN now() + ($3 || ' minutes')::interval
           ELSE locked_until
         END
     WHERE id = $1`,
    [id, MAX_FAILED_ATTEMPTS, String(LOCKOUT_MINUTES)],
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
