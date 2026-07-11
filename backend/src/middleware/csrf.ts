import { doubleCsrf } from "csrf-csrf";
import { env, isProduction } from "../config/env.js";

/**
 * CSRF protection via the double-submit cookie pattern (csrf-csrf).
 * `csurf` is deprecated, so we use `csrf-csrf`'s HMAC-backed double submit.
 *
 * The token is bound to the session id (`getSessionIdentifier`), so a token is
 * only valid for the session that requested it. The SPA fetches a token from
 * `GET /api/csrf-token` and echoes it back in the `x-csrf-token` header on all
 * mutating (POST/PUT/PATCH/DELETE) requests. `SameSite=Strict` provides a first
 * line of defense; this is defense-in-depth on top of it.
 */
const {
  doubleCsrfProtection,
  generateCsrfToken,
  invalidCsrfTokenError,
} = doubleCsrf({
  getSecret: () => env.CSRF_SECRET,
  getSessionIdentifier: (req) => req.sessionID ?? "",
  cookieName: isProduction ? "__Host-csrf" : "csrf",
  cookieOptions: {
    httpOnly: true,
    sameSite: "strict",
    secure: isProduction,
    path: "/",
  },
  size: 32,
  ignoredMethods: ["GET", "HEAD", "OPTIONS"],
  getCsrfTokenFromRequest: (req) => req.headers["x-csrf-token"],
});

export { doubleCsrfProtection, generateCsrfToken, invalidCsrfTokenError };
