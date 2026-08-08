import express, { type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import { env, isProduction } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { assertDbConnection } from "./db/pool.js";
import { securityHeaders, corsMiddleware } from "./middleware/security.js";
import {
  globalLimiter,
  authLimiter,
  mfaLimiter,
} from "./middleware/rateLimit.js";
import { sessionMiddleware } from "./middleware/session.js";
import { doubleCsrfProtection, generateCsrfToken } from "./middleware/csrf.js";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler.js";
import { authRouter } from "./routes/auth.js";
import { mfaRouter } from "./routes/mfa.js";
import { flagsRouter } from "./routes/flags.js";
import {
  initializeFeatureFlags,
  shutdownFeatureFlags,
} from "./flags/service.js";

const app = express();

// Behind a reverse proxy in production, trust the first hop so Secure cookies
// and client IPs (for rate limiting) are handled correctly.
app.set("trust proxy", isProduction ? 1 : false);
app.disable("x-powered-by");

// --- Middleware chain: helmet -> CORS -> rate limit -> body parse ->
//     cookie parse -> session -> CSRF -> routes ---
app.use(securityHeaders);
app.use(corsMiddleware);
app.use(globalLimiter);

// Bounded body size to limit DoS via oversized payloads.
app.use(express.json({ limit: "10kb" }));

// Parse cookies into req.cookies. Required by csrf-csrf, which reads the
// double-submit token from the CSRF cookie.
app.use(cookieParser());

// Session must run before CSRF: the double-submit token is bound to the
// session id (see middleware/csrf.ts), so the session must be available first.
app.use(sessionMiddleware);

// Browser-safe flags are evaluated after session targeting is available and
// before CSRF protection. The router exposes only its explicit allowlist.
app.use("/api/flags", flagsRouter);

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    version: env.APP_VERSION,
    gitSha: env.GIT_SHA,
    buildTime: env.BUILD_TIME,
  });
});

// CSRF bootstrap: issues a token + cookie. Marking the session dirty forces the
// `sid` cookie to be set now so the session id stays stable for the follow-up
// mutating request that the token is validated against.
app.get("/api/csrf-token", (req: Request, res: Response) => {
  const csrfToken = generateCsrfToken(req, res);
  req.session.csrfBootstrapped = true;
  req.session.save((err) => {
    if (err) {
      logger.error({ err }, "failed to persist session for CSRF bootstrap");
      res.status(500).json({ error: "Internal server error" });
      return;
    }
    res.status(200).json({ csrfToken });
  });
});

// Enforce CSRF on all mutating requests below this point.
app.use(doubleCsrfProtection);

// Tighter rate limit specifically on credential endpoints.
app.use("/api/auth/register", authLimiter);
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/mfa", mfaLimiter);

app.use("/api/auth", authRouter);
app.use("/api/auth/mfa", mfaRouter);

app.use(notFoundHandler);
app.use(errorHandler);

async function start(): Promise<void> {
  // Initialization is deliberately non-blocking: auth remains available even
  // if Flipt is unreachable or misconfigured.
  void initializeFeatureFlags();
  await assertDbConnection();
  app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV, corsOrigin: env.CORS_ORIGIN },
      "Auth backend listening",
    );
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdownFeatureFlags().finally(() => process.exit(0));
  });
}

start().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});
