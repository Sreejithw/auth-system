# MFA Operations Guide

This application offers optional, per-user TOTP MFA. It is not controlled by a
feature flag: if a user has enrolled, MFA is enforced on every subsequent
password login. There are no trusted devices, remembered browsers, or bypass
cookies.

## User enrollment

1. Sign in with a password. Enrollment setup and confirmation require a login
   authenticated within the last 10 minutes.
2. Open the dashboard MFA security section and start setup.
3. Scan the QR code in an authenticator app, or enter the displayed manual
   secret. The provisioning URI uses **TOTP, SHA-1, six digits, 30-second
   period**; the issuer label comes from `MFA_ISSUER`.
4. Enter the current six-digit code to enable MFA.
5. Save all 10 displayed recovery codes in an offline password manager or
   other secure location. Codes are single-use and are never shown again.

The server allows a one-period (30-second) clock drift either way. It rejects a
previously accepted TOTP time step, including concurrent reuse. Authenticator
devices must have accurate automatic time.

On later sign-in, a correct password returns `{mfaRequired:true}` rather than an
authenticated user. Submit exactly one of `totpCode` or `recoveryCode` to
`POST /api/auth/mfa/verify` to complete the 10-minute login challenge. A
recovery code is consumed on successful use.

## Recovery, reset, and disable

- A user with the device can use a TOTP code.
- A user without the device can use one saved recovery code. Sign in and
  regenerate recovery codes immediately; regeneration invalidates every old
  code.
- To disable MFA, the signed-in user must submit their password plus exactly one
  TOTP or recovery code. Disabling deletes the MFA enrollment and recovery
  codes.
- Regenerating codes has the same password-plus-proof requirement.

There is intentionally no operator, support, or database-only "lost device"
reset procedure. If a user loses both their authenticator and every recovery
code, they cannot prove MFA possession and cannot self-recover through this
application. Resolve account ownership outside the product's authenticated
flows according to the organization’s identity-verification policy; any
administrative database intervention must be separately authorized, audited,
and treated as a security incident.

## Key custody, backup, and rotation

`MFA_ENCRYPTION_KEY` encrypts TOTP seeds at rest with AES-256-GCM. In every
production-mode deployment (including QA and staging), configure a different
random **64-hex-character** key before the backend can start. Generate one with:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Store the key only in the environment’s secret manager and restrict access to
the runtime service and designated break-glass operators. Never place a real
key in source, docs, logs, tickets, or database backups.

Database backups and this key are coupled: restoring an MFA-enrolled database
requires the corresponding historical key to decrypt TOTP seeds. Back up and
retain the key through the same recovery window as the database backup, but in a
separate protected secret store. Test restoration with both assets in a
throwaway environment.

The current envelope format supports one active key only; it has no built-in
multi-key decrypt or online re-encryption rotation. Do not replace the key on a
live database without a migration plan: existing TOTP seeds become
undecryptable, and users will need an approved reset path. Before planned key
rotation, preserve the old key, test the procedure on a restored copy, and
coordinate a release that can decrypt with old and new keys and re-encrypt every
seed. If a key is suspected compromised, restrict secret access, preserve
forensic evidence, assess database exposure, and force a controlled MFA reset
or enrollment replacement under the incident process.

## Security policy and limits

- MFA is optional at enrollment but mandatory for enrolled users; flags do not
  enable, disable, or bypass it.
- TOTP setup secrets are only session-bound until confirmed. Persisted seeds are
  encrypted; recovery codes are stored only as Argon2id hashes.
- Setup, enable, disable, regeneration, and status are authenticated routes.
  All mutating requests require the normal CSRF header and session cookie.
- MFA verification endpoints are limited to 5 failed requests per IP per
  15 minutes. The global limit is 300 requests per IP per 15 minutes.
- Password login/register are separately limited to 10 failed requests per IP
  per 15 minutes; password login also has a five-failure, 15-minute
  per-account lockout.

## Incident checklist

1. Record the user, environment, timestamp, affected credentials, and observed
   behavior without recording TOTP seeds, recovery codes, passwords, or keys.
2. Check deployment logs and rate-limit events; preserve relevant audit
   evidence.
3. If a device is lost but a recovery code remains, instruct the user to sign
   in, regenerate codes, and enroll a replacement device.
4. If the encryption key or database backup may be exposed, restrict access,
   rotate unrelated secrets as applicable, and escalate to security owners.
   Do not delete the prior MFA key while retained database backups need it.
5. Validate recovery in an isolated restore before changing production keys or
   MFA records.

## QA manual validation checklist

- [ ] With MFA disabled, verify password login returns `{user}` and reaches the
  dashboard.
- [ ] Enroll with a compatible authenticator using QR and, separately, the
  manual secret; confirm the documented issuer, SHA-1, six digits, and
  30-second period.
- [ ] Confirm setup/enable fails after 10 minutes or without recent
  authentication, then succeeds with a current TOTP.
- [ ] Record recovery codes offline; log out and confirm password login returns
  `{mfaRequired:true}` and does not authenticate `/api/auth/me`.
- [ ] Complete the challenge with a TOTP, then separately with a recovery code;
  confirm a used recovery code cannot be reused.
- [ ] Confirm a just-used TOTP cannot be replayed.
- [ ] Regenerate codes with password plus proof and verify old codes fail.
- [ ] Disable with password plus proof, then confirm password-only login again
  returns `{user}`.
- [ ] Verify MFA endpoints receive `429` after 5 failed requests in 15 minutes
  from a test IP; do not run this against shared production traffic.
- [ ] Confirm no trusted-device option exists and all production-mode
  environments have distinct `MFA_ENCRYPTION_KEY` values.
