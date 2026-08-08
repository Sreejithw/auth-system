import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { credentialsSchema, loginSchema } from "../utils/validation.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import {
  createUser,
  findByEmail,
  findPublicById,
  isLocked,
  registerFailedLogin,
  resetLoginFailures,
} from "../services/user.service.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { logger } from "../utils/logger.js";
import { buildFlagContext } from "../flags/context.js";
import { evaluateBooleanFlag } from "../flags/service.js";
import { mfaService } from "../services/mfa.service.js";
import { PENDING_MFA_TTL_MS } from "./mfa.js";

export const authRouter = Router();

// Generic messages — identical regardless of which check failed, to prevent
// account enumeration.
const INVALID_CREDENTIALS = "Invalid email or password";

/**
 * A precomputed hash to verify against when the account doesn't exist. This
 * equalizes response timing between "unknown email" and "wrong password",
 * closing a timing side-channel for enumeration.
 */
const dummyHashPromise = hashPassword("timing-equalization-placeholder");

function formatValidationError(err: z.ZodError): string {
  return err.issues[0]?.message ?? "Invalid input";
}

async function regenerateSession(req: Request): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

async function saveSession(req: Request): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

// ---------------------------------------------------------------------------
// POST /register
// ---------------------------------------------------------------------------
authRouter.post("/register", async (req: Request, res: Response) => {
  const registrationEnabled = await evaluateBooleanFlag(
    "registration-enabled",
    buildFlagContext(req),
  );
  if (!registrationEnabled) {
    res.status(503).json({ error: "Registration is temporarily unavailable" });
    return;
  }

  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatValidationError(parsed.error) });
    return;
  }

  const { email, password } = parsed.data;
  const passwordHash = await hashPassword(password);
  const user = await createUser(email, passwordHash);

  if (user) {
    logger.info({ userId: user.id }, "user registered");
  } else {
    // Duplicate email — respond identically to a fresh registration so the
    // endpoint doesn't reveal which emails are already in use.
    logger.info({ email }, "registration attempt for existing email");
  }

  res.status(201).json({ message: "Registration successful" });
});

// ---------------------------------------------------------------------------
// POST /login
// ---------------------------------------------------------------------------
authRouter.post("/login", async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatValidationError(parsed.error) });
    return;
  }

  const { email, password } = parsed.data;
  const user = await findByEmail(email);

  if (!user) {
    // Perform a dummy verify to keep timing constant, then respond generically.
    await verifyPassword(await dummyHashPromise, password);
    res.status(401).json({ error: INVALID_CREDENTIALS });
    return;
  }

  if (isLocked(user)) {
    logger.warn({ userId: user.id }, "login attempt on locked account");
    res.status(429).json({
      error: "Account temporarily locked. Please try again later.",
    });
    return;
  }

  const passwordOk = await verifyPassword(user.password_hash, password);
  if (!passwordOk) {
    await registerFailedLogin(user.id);
    logger.warn({ userId: user.id }, "failed login");
    res.status(401).json({ error: INVALID_CREDENTIALS });
    return;
  }

  // Password success still does not authenticate an MFA-enabled account. The
  // fresh session contains only a short-lived challenge, never userId.
  await resetLoginFailures(user.id);
  await regenerateSession(req);
  if ((await mfaService.getStatus(user.id)).enabled) {
    req.session.pendingMfaChallenge = {
      userId: user.id,
      expiresAt: Date.now() + PENDING_MFA_TTL_MS,
    };
    await saveSession(req);
    logger.info({ userId: user.id }, "MFA challenge started");
    res.status(200).json({ mfaRequired: true });
    return;
  }

  // Non-MFA flow remains the same: bind the user to the new session.
  req.session.userId = user.id;
  req.session.authenticatedAt = Date.now();
  await saveSession(req);

  logger.info({ userId: user.id }, "login successful");
  res.status(200).json({ user: { id: user.id, email: user.email } });
});

// ---------------------------------------------------------------------------
// POST /logout
// ---------------------------------------------------------------------------
authRouter.post("/logout", (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      logger.error({ err }, "session destroy failed");
      res.status(500).json({ error: "Logout failed" });
      return;
    }
    res.clearCookie("sid", { path: "/" });
    res.status(200).json({ message: "Logged out" });
  });
});

// ---------------------------------------------------------------------------
// GET /me
// ---------------------------------------------------------------------------
authRouter.get("/me", requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId as string;
  const user = await findPublicById(userId);

  if (!user) {
    // Session references a user that no longer exists — clean up.
    req.session.destroy(() => undefined);
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  res.status(200).json({ user });
});
