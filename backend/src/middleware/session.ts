import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "../db/pool.js";
import { env, isProduction } from "../config/env.js";
import { getDurationMs } from "../services/settings.service.js";

const PgSession = connectPgSimple(session);

/**
 * Cookie options shared by set-cookie and clear-cookie paths.
 * `maxAge` is a browser hint only; idle/absolute enforcement is app middleware.
 */
export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: isProduction,
  path: "/",
};

/**
 * Server-side session middleware. The session id is stored in an opaque,
 * `httpOnly` cookie named `sid`; the session payload lives in Postgres
 * (connect-pg-simple). Authoritative idle/absolute expiry is enforced by
 * `sessionExpiryMiddleware` using snapshotted deadlines.
 */
export const sessionMiddleware = session({
  name: "sid",
  store: new PgSession({
    pool,
    tableName: "session",
    createTableIfMissing: false,
    // Cookie/store prune uses settings cache (defaults until initializeSettings).
    pruneSessionInterval: Math.max(
      1,
      Math.floor(getDurationMs("session.store_prune_interval_ms") / 1000),
    ),
  }),
  secret: env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  // Rolling cookie refresh is a hint; app middleware owns idle semantics.
  rolling: true,
  cookie: {
    ...sessionCookieOptions,
    maxAge: getDurationMs("session.absolute_ttl_ms"),
  },
});
