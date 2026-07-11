import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "../db/pool.js";
import { env, isProduction } from "../config/env.js";

const PgSession = connectPgSimple(session);

/** Absolute session lifetime (also the cookie maxAge): 8 hours. */
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/**
 * Server-side session middleware. The session id is stored in an opaque,
 * `httpOnly` cookie named `sid`; the session payload lives in Postgres
 * (connect-pg-simple). `Secure` is enabled only in production so the cookie
 * still works over plain http during local development.
 */
export const sessionMiddleware = session({
  name: "sid",
  store: new PgSession({
    pool,
    tableName: "session",
    createTableIfMissing: false,
    // Periodically purge expired sessions from the store.
    pruneSessionInterval: 60 * 15,
  }),
  secret: env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true, // refresh idle expiry on activity
  cookie: {
    httpOnly: true,
    sameSite: "strict",
    secure: isProduction,
    maxAge: SESSION_TTL_MS,
    path: "/",
  },
});
