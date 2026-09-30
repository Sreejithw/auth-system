import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle } from "docx";
import fs from "fs";

const border = { style: BorderStyle.SINGLE, size: 4, color: "999999" };
const borders = { top: border, bottom: border, left: border, right: border };

function infoTable(pairs) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [2800, 6560],
    rows: pairs.map(
      ([k, v]) =>
        new TableRow({
          children: [
            new TableCell({
              borders,
              width: { size: 2800, type: WidthType.DXA },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ text: k, bold: true, size: 18, font: "Calibri" }),
                  ],
                }),
              ],
            }),
            new TableCell({
              borders,
              width: { size: 6560, type: WidthType.DXA },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ text: v, size: 18, font: "Calibri" }),
                  ],
                }),
              ],
            }),
          ],
        }),
    ),
  });
}

const h1 = (t) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 160 },
    children: [new TextRun({ text: t, bold: true, size: 28, font: "Calibri" })],
  });
const h2 = (t) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 120 },
    children: [new TextRun({ text: t, bold: true, size: 24, font: "Calibri" })],
  });
const h3 = (t) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text: t, bold: true, size: 22, font: "Calibri" })],
  });
const p = (t) =>
  new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text: t, size: 20, font: "Calibri" })],
  });
const code = (t) =>
  new Paragraph({
    spacing: { after: 40 },
    children: [new TextRun({ text: t, size: 18, font: "Consolas" })],
  });
const bullet = (t) =>
  new Paragraph({
    spacing: { after: 40 },
    children: [new TextRun({ text: `• ${t}`, size: 20, font: "Calibri" })],
  });

const features = [
  {
    title: "1. Registration",
    summary:
      "Creates a new user account with email and a strong password. Does not create a login session.",
    endpoint: "POST /api/auth/register",
    auth: "None (CSRF required)",
    functions: [
      'routes/auth.ts → authRouter.post("/register")',
      'flags/service.ts → evaluateBooleanFlag("registration-enabled")',
      "utils/validation.ts → credentialsSchema",
      "utils/password.ts → hashPassword (Argon2id)",
      "services/user.service.ts → createUser",
    ],
    payload: `{
  "email": "user@example.com",
  "password": "<strong password>"
}`,
    success: `201
{
  "message": "Registration successful"
}`,
    errors: [
      '400 { "error": "Password is too weak or guessable" }',
      '400 { "error": "Password must be at least 12 characters" }',
      '503 { "error": "Registration is temporarily unavailable" }',
      "Duplicate email still returns 201 with the same message (anti-enumeration)",
    ],
  },
  {
    title: "2. Login (password only / MFA challenge)",
    summary:
      "Verifies credentials. If MFA is enabled, starts a pending MFA challenge instead of authenticating. If MFA is off, creates an authenticated session with idle/absolute expiry snapshots.",
    endpoint: "POST /api/auth/login",
    auth: "None (CSRF required)",
    functions: [
      'routes/auth.ts → authRouter.post("/login")',
      "utils/validation.ts → loginSchema",
      "services/user.service.ts → findByEmail, isLocked, registerFailedLogin, resetLoginFailures",
      "utils/password.ts → verifyPassword",
      "services/mfa.service.ts → getStatus",
      "services/sessionExpiry.ts → applySessionExpirySnapshot (non-MFA success)",
      'services/settings.service.ts → getDurationMs("mfa.challenge_ttl_ms")',
    ],
    payload: `{
  "email": "user@example.com",
  "password": "<current password>"
}`,
    success: `Non-MFA 200:
{
  "user": { "id": "uuid", "email": "user@example.com" },
  "isAdmin": false
}

MFA enrolled 200:
{
  "mfaRequired": true
}
(+ Set-Cookie: sid=...)`,
    errors: [
      '401 { "error": "Invalid email or password" }',
      '429 { "error": "Account temporarily locked. Please try again later." }',
      "400 validation errors for bad email/password shape",
    ],
  },
  {
    title: "3. MFA verify (complete login)",
    summary:
      "Completes a pending MFA login challenge with a TOTP or one-time recovery code, then authenticates the session.",
    endpoint: "POST /api/auth/mfa/verify",
    auth: "Pending MFA session cookie (no userId yet); CSRF required",
    functions: [
      'routes/mfa.ts → mfaRouter.post("/verify")',
      "services/mfa.service.ts → verifyAnyMfaCredential / verifyTotpAndConsume / verifyRecoveryCodeAndConsume",
      "services/user.service.ts → findPublicById",
      "services/sessionExpiry.ts → applySessionExpirySnapshot",
    ],
    payload: `Option A:
{
  "totpCode": "123456"
}

Option B:
{
  "recoveryCode": "xxxx-xxxx-xxxx-xxxx-xxxx"
}`,
    success: `200
{
  "user": { "id": "uuid", "email": "user@example.com" }
}`,
    errors: [
      '401 { "error": "Invalid MFA code" }',
      "400 if both or neither code fields are provided",
    ],
  },
  {
    title: "4. Current user (/me)",
    summary:
      "Returns the authenticated user, admin flag, and session expiry timestamps.",
    endpoint: "GET /api/auth/me",
    auth: "Authenticated session (sid cookie)",
    functions: [
      'routes/auth.ts → authRouter.get("/me")',
      "middleware/requireAuth.ts → requireAuth",
      "middleware/sessionExpiry.ts → sessionExpiryMiddleware (runs before route)",
      "services/user.service.ts → findPublicWithAdminById",
    ],
    payload: "(no body)",
    success: `200
{
  "user": { "id": "uuid", "email": "user@example.com" },
  "isAdmin": true,
  "session": {
    "idleExpiresAt": "2026-09-06T04:00:00.000Z",
    "absoluteExpiresAt": "2026-09-06T14:00:00.000Z"
  }
}`,
    errors: [
      '401 { "error": "Authentication required" }',
      '401 { "error": "Session expired", "reason": "idle" | "absolute" }',
    ],
  },
  {
    title: "5. Logout",
    summary: "Destroys the server-side session and clears the sid cookie.",
    endpoint: "POST /api/auth/logout",
    auth: "CSRF required (session optional)",
    functions: [
      'routes/auth.ts → authRouter.post("/logout")',
      "middleware/session.ts → sessionCookieOptions used by clearCookie",
    ],
    payload: "(no body)",
    success: `200
{
  "message": "Logged out"
}
(+ clears sid cookie)`,
    errors: ['500 { "error": "Logout failed" }'],
  },
  {
    title: "6. MFA status",
    summary: "Returns whether MFA is enabled for the authenticated user.",
    endpoint: "GET /api/auth/mfa",
    auth: "Authenticated + session",
    functions: [
      'routes/mfa.ts → GET "/"',
      "middleware/requireAuth.ts → requireAuth",
      "services/mfa.service.ts → getStatus",
    ],
    payload: "(no body)",
    success: `200
{
  "enabled": false
}`,
    errors: ['401 { "error": "Authentication required" }'],
  },
  {
    title: "7. MFA setup (start enrollment)",
    summary:
      "Creates a session-bound TOTP secret and returns QR provisioning data. Requires recent authentication.",
    endpoint: "POST /api/auth/mfa/setup",
    auth: "Authenticated + CSRF + recent auth",
    functions: [
      'routes/mfa.ts → POST "/setup"',
      "services/mfa.service.ts → createSetupForLabel",
      'services/settings.service.ts → getDurationMs("mfa.challenge_ttl_ms")',
      "services/user.service.ts → findPublicById",
    ],
    payload: "(no body)",
    success: `200
{
  "manualSecret": "BASE32SECRET",
  "provisioningUri": "otpauth://totp/..."
}`,
    errors: [
      '401 { "error": "Recent authentication required" }',
      '409 { "error": "MFA is already enabled" }',
    ],
  },
  {
    title: "8. MFA enable (confirm enrollment)",
    summary:
      "Confirms TOTP possession, persists encrypted secret, and returns 10 one-time recovery codes.",
    endpoint: "POST /api/auth/mfa/enable",
    auth: "Authenticated + CSRF + recent auth + pending setup",
    functions: [
      'routes/mfa.ts → POST "/enable"',
      "services/mfa.service.ts → activate",
    ],
    payload: `{
  "totpCode": "123456"
}`,
    success: `200
{
  "recoveryCodes": ["code1", "code2", "...10 codes"]
}`,
    errors: ['400 { "error": "Invalid MFA code" }'],
  },
  {
    title: "9. MFA disable",
    summary: "Disables MFA after password + TOTP/recovery proof.",
    endpoint: "POST /api/auth/mfa/disable",
    auth: "Authenticated + CSRF",
    functions: [
      'routes/mfa.ts → POST "/disable"',
      "utils/password.ts → verifyPassword",
      "services/mfa.service.ts → verifyAnyMfaCredential, disable",
      "services/user.service.ts → findById",
    ],
    payload: `{
  "password": "<current password>",
  "totpCode": "123456"
}

(or recoveryCode instead of totpCode)`,
    success: `200
{
  "message": "MFA disabled"
}`,
    errors: ['400 { "error": "Invalid MFA code" }'],
  },
  {
    title: "10. Regenerate recovery codes",
    summary:
      "Invalidates all old recovery codes and issues a new set after password + MFA proof.",
    endpoint: "POST /api/auth/mfa/recovery-codes/regenerate",
    auth: "Authenticated + CSRF",
    functions: [
      'routes/mfa.ts → POST "/recovery-codes/regenerate"',
      "services/mfa.service.ts → regenerateRecoveryCodes",
    ],
    payload: `{
  "password": "<current password>",
  "totpCode": "123456"
}`,
    success: `200
{
  "recoveryCodes": ["..."]
}`,
    errors: ['400 { "error": "Invalid MFA code" }'],
  },
  {
    title: "11. Session expiry enforcement",
    summary:
      "Not a separate public endpoint. Runs on every request after session load. Enforces absolute then idle deadlines; extends idle on qualifying activity; clears expired MFA pending state.",
    endpoint: "Middleware on all routes (after session)",
    auth: "N/A",
    functions: [
      "middleware/sessionExpiry.ts → sessionExpiryMiddleware",
      "services/sessionExpiry.ts → evaluateSessionExpiry",
      "services/sessionExpiry.ts → refreshIdleDeadline",
      "services/sessionExpiry.ts → clearExpiredMfaPending",
      "services/sessionExpiry.ts → applySessionExpirySnapshot (at login/MFA verify)",
    ],
    payload: "Triggered by any authenticated request, e.g. GET /api/auth/me",
    success:
      "Request continues to the route handler if session is valid. Idle deadline may be extended.",
    errors: [
      '401 { "error": "Session expired", "reason": "idle" }',
      '401 { "error": "Session expired", "reason": "absolute" }',
    ],
  },
  {
    title: "12. CSRF token bootstrap",
    summary:
      "Issues a CSRF token bound to the session id for subsequent mutating requests.",
    endpoint: "GET /api/csrf-token",
    auth: "None (creates/uses session cookie)",
    functions: [
      "index.ts → GET /api/csrf-token",
      "middleware/csrf.ts → generateCsrfToken",
    ],
    payload: "(no body)",
    success: `200
{
  "csrfToken": "..."
}
(+ Set-Cookie sid and CSRF cookie)`,
    errors: ['500 { "error": "Internal server error" }'],
  },
  {
    title: "13. Feature flags (client-safe)",
    summary:
      "Returns only allowlisted, server-evaluated boolean flags for the UI.",
    endpoint: "GET /api/flags",
    auth: "Optional session (used for targeting)",
    functions: [
      'routes/flags.ts → GET "/"',
      "flags/context.ts → buildFlagContext",
      "flags/service.ts → evaluateClientFlags / evaluateBooleanFlag",
      "services/user.service.ts → findPublicById (optional email enrichment)",
    ],
    payload: "(no body)",
    success: `200
{
  "flags": {
    "new-registration-flow": false,
    "new-dashboard-rollout": false
  }
}`,
    errors: ["Uses code defaults if Flipt is down; does not fail auth"],
  },
  {
    title: "14. Admin settings (list)",
    summary:
      "Lists all database-backed timeout/threshold settings for admins.",
    endpoint: "GET /api/admin/settings",
    auth: "Authenticated admin session",
    functions: [
      'routes/admin.ts → GET "/settings"',
      "middleware/requireAuth.ts → requireAuth",
      "middleware/requireAdmin.ts → requireAdmin",
      "services/settings.service.ts → getAllSettings",
    ],
    payload: "(no body)",
    success: `200
{
  "settings": [
    {
      "key": "session.idle_ttl_ms",
      "description": "Rolling idle session lifetime",
      "valueMs": 28800000,
      "updatedAt": null,
      "updatedBy": null
    }
  ]
}`,
    errors: [
      '401 { "error": "Authentication required" }',
      '403 { "error": "Admin access required" }',
    ],
  },
  {
    title: "15. Admin settings (update)",
    summary:
      "Updates timeout settings in Postgres and refreshes the in-memory cache immediately. Active sessions keep grandfathered deadlines.",
    endpoint: "PUT /api/admin/settings",
    auth: "Authenticated admin + CSRF + recent auth",
    functions: [
      'routes/admin.ts → PUT "/settings"',
      "services/settings.service.ts → validateSettingUpdates, updateSettings, initializeSettings",
    ],
    payload: `{
  "settings": [
    { "key": "session.idle_ttl_ms", "valueMs": 14400000 },
    { "key": "session.absolute_ttl_ms", "valueMs": 43200000 }
  ]
}`,
    success: `200
{
  "settings": [ /* full updated snapshot */ ]
}`,
    errors: [
      '401 { "error": "Recent authentication required" }',
      '400 { "error": "session.absolute_ttl_ms must be greater than or equal to session.idle_ttl_ms" }',
      '403 { "error": "Admin access required" }',
    ],
  },
  {
    title: "16. Health check",
    summary: "Liveness/version probe used by containers and smoke tests.",
    endpoint: "GET /health",
    auth: "None",
    functions: ["index.ts → GET /health"],
    payload: "(no body)",
    success: `200
{
  "status": "ok",
  "version": "development",
  "gitSha": "unknown",
  "buildTime": "unknown"
}`,
    errors: [],
  },
  {
    title: "17. Supporting security controls (cross-cutting)",
    summary:
      "Applied across endpoints rather than as standalone feature APIs.",
    endpoint: "Middleware chain",
    auth: "N/A",
    functions: [
      "middleware/security.ts → Helmet headers + strict CORS",
      "middleware/rateLimit.ts → globalLimiter, authLimiter, mfaLimiter",
      "middleware/csrf.ts → doubleCsrfProtection",
      "middleware/session.ts → Postgres-backed sid cookie sessions",
      "services/user.service.ts → lockout via auth.lockout_* settings",
      "config/env.ts → fail-fast env validation",
    ],
    payload: `Mutating requests must include header:
x-csrf-token: <token from /api/csrf-token>
and cookies:
sid=...; csrf cookie`,
    success: "Requests proceed when CSRF/session/rate-limit checks pass.",
    errors: [
      "403 Invalid CSRF token",
      "429 Too many attempts / Too many requests",
      "413 payload too large",
    ],
  },
];

const children = [
  new Paragraph({
    spacing: { after: 120 },
    children: [
      new TextRun({
        text: "Auth System Backend Features",
        bold: true,
        size: 36,
        font: "Calibri",
      }),
    ],
  }),
  p(
    "API reference for backend features: purpose, targeted functions, request payloads, and expected responses.",
  ),
  p("Base URL (local): http://localhost:4000"),
  p(
    "Notes: All POST/PUT/DELETE requests require a valid CSRF header (x-csrf-token) after calling GET /api/csrf-token. Authenticated routes require the sid session cookie. Password registration requires 12–128 chars and zxcvbn score >= 3.",
  ),
  h1("Feature catalog"),
];

for (const f of features) {
  children.push(h2(f.title));
  children.push(p(f.summary));
  children.push(
    infoTable([
      ["Endpoint", f.endpoint],
      ["Auth / CSRF", f.auth],
    ]),
  );
  children.push(h3("Functions targeted"));
  for (const fn of f.functions) children.push(bullet(fn));
  children.push(h3("Request payload"));
  for (const line of f.payload.split("\n")) children.push(code(line));
  children.push(h3("Expected success output"));
  for (const line of f.success.split("\n")) children.push(code(line));
  if (f.errors.length) {
    children.push(h3("Expected error outputs"));
    for (const e of f.errors) children.push(bullet(e));
  }
}

children.push(h1("Typical call sequence"));
children.push(bullet("GET /api/csrf-token"));
children.push(bullet("POST /api/auth/register (optional)"));
children.push(bullet("POST /api/auth/login"));
children.push(bullet("If mfaRequired: POST /api/auth/mfa/verify"));
children.push(bullet("GET /api/auth/me"));
children.push(bullet("Optional MFA manage / admin settings / flags"));
children.push(bullet("POST /api/auth/logout"));

const doc = new Document({
  sections: [{ properties: {}, children }],
});

const out =
  "C:/Users/sreej/Projects/auth-system/Backend-Features-API-Reference.docx";
const buf = await Packer.toBuffer(doc);
fs.writeFileSync(out, buf);
console.log(out);
