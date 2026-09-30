/**
 * TOTP MFA state and one-time recovery codes.
 *
 * TOTP secrets are AES-256-GCM envelopes, never plaintext or hashes. Recovery
 * codes are stored only as Argon2id hashes and are consumed atomically.
 */
export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS user_mfa (
      user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      secret_ciphertext text NOT NULL,
      enabled_at timestamptz NOT NULL DEFAULT now(),
      last_totp_counter bigint,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    DROP TRIGGER IF EXISTS user_mfa_set_updated_at ON user_mfa;
    CREATE TRIGGER user_mfa_set_updated_at
      BEFORE UPDATE ON user_mfa
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at();

    CREATE TABLE IF NOT EXISTS user_mfa_recovery_codes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash text NOT NULL,
      consumed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS user_mfa_recovery_codes_active_idx
      ON user_mfa_recovery_codes (user_id)
      WHERE consumed_at IS NULL;
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS user_mfa_recovery_codes_active_idx;
    DROP TABLE IF EXISTS user_mfa_recovery_codes;
    DROP TRIGGER IF EXISTS user_mfa_set_updated_at ON user_mfa;
    DROP TABLE IF EXISTS user_mfa;
  `);
};
