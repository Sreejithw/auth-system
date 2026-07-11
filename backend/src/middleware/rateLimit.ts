import { rateLimit } from "express-rate-limit";

/**
 * Global limiter — a coarse cap on total request volume per IP to blunt
 * generic flooding / scraping.
 */
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

/**
 * Auth limiter — a much tighter cap on the credential endpoints
 * (register/login) to slow brute-force and credential-stuffing attacks. This
 * complements the per-account lockout in the DB.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  // Count only failed attempts so a legitimate user isn't punished for success.
  skipSuccessfulRequests: true,
  message: { error: "Too many attempts, please try again later." },
});
