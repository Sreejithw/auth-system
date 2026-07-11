import pino from "pino";
import { env, isProduction } from "../config/env.js";

/**
 * Structured logger (pino). In development it pretty-prints; in production it
 * emits JSON. Auth events are logged for detection/audit, but secrets
 * (passwords, tokens, session ids, password hashes) must never be logged.
 */
export const logger = pino({
  level: env.NODE_ENV === "test" ? "silent" : isProduction ? "info" : "debug",
  redact: {
    paths: [
      "password",
      "*.password",
      "req.body.password",
      "password_hash",
      "*.password_hash",
    ],
    censor: "[redacted]",
  },
  // Pretty-printing is a development-only convenience and `pino-pretty` is a
  // devDependency, so it is intentionally absent from the production image.
  // Only attach it in `development`; `production` emits JSON and `test` is
  // silent — neither requires the transport (avoids a boot crash when the
  // prod build runs under any non-production NODE_ENV).
  transport:
    env.NODE_ENV === "development"
      ? {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:standard" },
        }
      : undefined,
});
