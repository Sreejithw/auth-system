import { z } from "zod";

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
