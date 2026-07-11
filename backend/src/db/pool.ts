import { Pool } from "pg";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

/**
 * Shared PostgreSQL connection pool. All queries in the app go through this
 * pool and use parameterized statements ($1, $2, ...) — user input is never
 * concatenated into SQL, preventing SQL injection.
 */
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on("error", (err) => {
  logger.error({ err }, "Unexpected error on idle Postgres client");
});

/** Verify connectivity at startup; throws if the DB is unreachable. */
export async function assertDbConnection(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT 1");
    logger.info("Connected to PostgreSQL");
  } finally {
    client.release();
  }
}
