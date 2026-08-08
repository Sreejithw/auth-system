import { z } from "zod";
import { randomBytes } from "node:crypto";

// Load variables from a local `.env` (if present) using Node's built-in loader
// (Node >= 20.12). In production, real env vars are expected to be injected by
// the platform, so a missing file is not an error.
try {
  process.loadEnvFile();
} catch {
  // No .env file present — rely on the ambient environment.
}

/**
 * Zod-validated environment loader.
 *
 * Fails fast (process exit) when a required variable is missing or malformed,
 * so misconfiguration is caught at boot rather than at request time. Secrets
 * are never hardcoded — they come from the environment / a gitignored `.env`.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().url(),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters"),
  CSRF_SECRET: z
    .string()
    .min(32, "CSRF_SECRET must be at least 32 characters"),
  APP_VERSION: z.string().min(1).default("development"),
  GIT_SHA: z.string().min(1).default("unknown"),
  BUILD_TIME: z.string().min(1).default("unknown"),
  FLIPT_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  FLIPT_URL: z.string().url().default("http://localhost:8080"),
  FLIPT_NAMESPACE: z.string().min(1).default("auth-system"),
  FLIPT_TOKEN: z.string().min(1).optional(),
  MFA_ENCRYPTION_KEY: z.string().optional(),
  MFA_ISSUER: z.string().trim().min(1).max(128).default("Auth System"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    console.error(
      `\n[env] Invalid or missing environment variables:\n${issues}\n`,
    );
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === "production";

/**
 * AES-256-GCM key used solely to encrypt TOTP seeds at rest. Production
 * requires an explicitly configured, exactly 32-byte hex or base64 key.
 * Development/test generate an ephemeral key when omitted so developers never
 * accidentally persist a predictable default secret.
 */
export const mfaEncryptionKey = parseMfaEncryptionKey(env.MFA_ENCRYPTION_KEY);

function parseMfaEncryptionKey(value: string | undefined): Buffer {
  if (!value) {
    if (isProduction) {
      console.error(
        "\n[env] Invalid or missing environment variables:\n  - MFA_ENCRYPTION_KEY: required in production\n",
      );
      process.exit(1);
    }
    return randomBytes(32);
  }

  const normalized = value.trim();
  const isHex = /^[0-9a-fA-F]{64}$/.test(normalized);
  const isBase64 =
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      normalized,
    );
  const key = Buffer.from(normalized, isHex ? "hex" : "base64");

  if (
    (!isHex && !isBase64) ||
    key.length !== 32 ||
    (!isHex && key.toString("base64") !== normalized)
  ) {
    console.error(
      "\n[env] Invalid or missing environment variables:\n  - MFA_ENCRYPTION_KEY: must be an exactly 32-byte hex or canonical base64 key\n",
    );
    process.exit(1);
  }

  return key;
}
