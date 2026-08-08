import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/requireAuth.js";
import { mfaService } from "../services/mfa.service.js";
import { findById, findPublicById } from "../services/user.service.js";
import { verifyPassword } from "../utils/password.js";

export const mfaRouter = Router();

const PENDING_MFA_TTL_MS = 10 * 60 * 1000;
const RECENT_AUTH_TTL_MS = 10 * 60 * 1000;
const codeSchema = z
  .object({
    totpCode: z.string().regex(/^\d{6}$/).optional(),
    recoveryCode: z.string().min(20).max(128).optional(),
  })
  .strict()
  .refine(
    (value) => Boolean(value.totpCode) !== Boolean(value.recoveryCode),
    "Provide exactly one MFA code",
  );
const sensitiveActionSchema = codeSchema.extend({
  password: z.string().min(1).max(128),
});
const GENERIC_MFA_ERROR = "Invalid MFA code";

function noStore(res: Response): void {
  res.set("Cache-Control", "no-store");
}

function parseCode(req: Request): string | null {
  const parsed = codeSchema.safeParse(req.body);
  return parsed.success
    ? (parsed.data.totpCode ?? parsed.data.recoveryCode ?? null)
    : null;
}

function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

function hasRecentAuthentication(req: Request): boolean {
  return (
    typeof req.session.authenticatedAt === "number" &&
    Date.now() - req.session.authenticatedAt <= RECENT_AUTH_TTL_MS
  );
}

function requireRecentAuth(req: Request, res: Response): boolean {
  if (!hasRecentAuthentication(req)) {
    res.status(401).json({ error: "Recent authentication required" });
    return false;
  }
  return true;
}

// GET /api/auth/mfa
mfaRouter.get("/", requireAuth, async (req: Request, res: Response) => {
  const status = await mfaService.getStatus(req.session.userId as string);
  res.status(200).json(status);
});

// POST /api/auth/mfa/setup
mfaRouter.post("/setup", requireAuth, async (req: Request, res: Response) => {
  if (!requireRecentAuth(req, res)) return;
  if ((await mfaService.getStatus(req.session.userId as string)).enabled) {
    res.status(409).json({ error: "MFA is already enabled" });
    return;
  }

  const user = await findPublicById(req.session.userId as string);
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const setup = mfaService.createSetupForLabel(user.email);
  req.session.pendingMfaSetup = {
    encryptedSecret: setup.encryptedSecret,
    expiresAt: Date.now() + PENDING_MFA_TTL_MS,
  };
  await saveSession(req);
  noStore(res);
  res.status(200).json({
    manualSecret: setup.secret,
    provisioningUri: setup.otpauthUrl,
  });
});

// POST /api/auth/mfa/enable
mfaRouter.post("/enable", requireAuth, async (req: Request, res: Response) => {
  const code = parseCode(req);
  const pending = req.session.pendingMfaSetup;
  if (
    !code ||
    !pending ||
    pending.expiresAt < Date.now() ||
    !requireRecentAuth(req, res)
  ) {
    delete req.session.pendingMfaSetup;
    if (!res.headersSent) res.status(400).json({ error: GENERIC_MFA_ERROR });
    return;
  }

  const recoveryCodes = await mfaService.activate(
    req.session.userId as string,
    pending.encryptedSecret,
    code,
  );
  if (!recoveryCodes) {
    res.status(400).json({ error: GENERIC_MFA_ERROR });
    return;
  }
  delete req.session.pendingMfaSetup;
  await saveSession(req);
  noStore(res);
  res.status(200).json({ recoveryCodes });
});

// POST /api/auth/mfa/disable
mfaRouter.post("/disable", requireAuth, async (req: Request, res: Response) => {
  const parsed = sensitiveActionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: GENERIC_MFA_ERROR });
    return;
  }
  const userId = req.session.userId as string;
  const user = await findById(userId);
  const code = parsed.data.totpCode ?? parsed.data.recoveryCode ?? "";
  if (
    !user ||
    !(await verifyPassword(user.password_hash, parsed.data.password)) ||
    !(await mfaService.verifyAnyMfaCredential(userId, code))
  ) {
    res.status(400).json({ error: GENERIC_MFA_ERROR });
    return;
  }
  await mfaService.disable(userId);
  req.session.authenticatedAt = Date.now();
  delete req.session.pendingMfaSetup;
  await saveSession(req);
  res.status(200).json({ message: "MFA disabled" });
});

// POST /api/auth/mfa/recovery-codes/regenerate
mfaRouter.post(
  "/recovery-codes/regenerate",
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = sensitiveActionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: GENERIC_MFA_ERROR });
      return;
    }
    const userId = req.session.userId as string;
    const user = await findById(userId);
    const code = parsed.data.totpCode ?? parsed.data.recoveryCode ?? "";
    if (
      !user ||
      !(await verifyPassword(user.password_hash, parsed.data.password)) ||
      !(await mfaService.verifyAnyMfaCredential(userId, code))
    ) {
      res.status(400).json({ error: GENERIC_MFA_ERROR });
      return;
    }
    const recoveryCodes = await mfaService.regenerateRecoveryCodes(userId);
    req.session.authenticatedAt = Date.now();
    await saveSession(req);
    noStore(res);
    res.status(200).json({ recoveryCodes });
  },
);

// POST /api/auth/mfa/verify -- completes an unauthenticated login challenge.
mfaRouter.post("/verify", async (req: Request, res: Response) => {
  const code = parseCode(req);
  const challenge = req.session.pendingMfaChallenge;
  if (!code || !challenge || challenge.expiresAt < Date.now()) {
    delete req.session.pendingMfaChallenge;
    if (challenge) await saveSession(req);
    res.status(401).json({ error: GENERIC_MFA_ERROR });
    return;
  }

  if (!(await mfaService.verifyAnyMfaCredential(challenge.userId, code))) {
    delete req.session.pendingMfaChallenge;
    await saveSession(req);
    res.status(401).json({ error: GENERIC_MFA_ERROR });
    return;
  }

  const user = await findPublicById(challenge.userId);
  if (!user) {
    delete req.session.pendingMfaChallenge;
    await saveSession(req);
    res.status(401).json({ error: GENERIC_MFA_ERROR });
    return;
  }

  await regenerateSession(req);
  req.session.userId = challenge.userId;
  req.session.authenticatedAt = Date.now();
  await saveSession(req);
  res.status(200).json({ user });
});

export { PENDING_MFA_TTL_MS };
