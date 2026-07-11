import cors from "cors";
import helmet from "helmet";
import type { RequestHandler } from "express";
import { env } from "../config/env.js";

/**
 * Helmet security headers: CSP, HSTS, frameguard (clickjacking),
 * X-Content-Type-Options (MIME sniffing), Referrer-Policy, etc. This is a JSON
 * API, so the default CSP is locked down to `'none'` for fetchable resources.
 */
export const securityHeaders: RequestHandler = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"],
    },
  },
  // HSTS is only meaningful over HTTPS; browsers ignore it on http anyway.
  hsts: env.NODE_ENV === "production",
  crossOriginResourcePolicy: { policy: "same-site" },
});

/**
 * Strict CORS allowlist. Only the configured frontend origin may make
 * credentialed (cookie-bearing) requests. The CSRF token header is exposed as
 * an allowed request header so the SPA can send it back on mutations.
 */
export const corsMiddleware: RequestHandler = cors({
  origin: env.CORS_ORIGIN,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-csrf-token"],
});
