/**
 * Database-backed timeout/settings catalog and admin flag on users.
 *
 * Seeds current hardcoded defaults so behavior is unchanged on first deploy.
 * Duration settings use value_ms; count thresholds use value_int.
 */
export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

    CREATE TABLE IF NOT EXISTS app_settings (
      key text PRIMARY KEY,
      value_ms bigint,
      value_int integer,
      description text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by uuid REFERENCES users(id),
      CONSTRAINT app_settings_value_xor CHECK (
        (value_ms IS NOT NULL AND value_int IS NULL)
        OR (value_ms IS NULL AND value_int IS NOT NULL)
      )
    );

    INSERT INTO app_settings (key, value_ms, value_int, description) VALUES
      ('session.idle_ttl_ms', 28800000, NULL, 'Rolling idle session lifetime'),
      ('session.absolute_ttl_ms', 86400000, NULL, 'Maximum authenticated session lifetime'),
      ('session.store_prune_interval_ms', 900000, NULL, 'Interval for pruning expired session rows'),
      ('mfa.challenge_ttl_ms', 600000, NULL, 'Pending MFA login challenge and setup window'),
      ('mfa.recent_auth_ttl_ms', 600000, NULL, 'Window for sensitive MFA actions after full auth'),
      ('auth.lockout_duration_ms', 900000, NULL, 'Account lockout duration after failed logins'),
      ('auth.lockout_max_failed_attempts', NULL, 5, 'Failed logins before account lockout'),
      ('rate_limit.global.window_ms', 900000, NULL, 'Global per-IP rate-limit window'),
      ('rate_limit.global.max', NULL, 300, 'Max requests per global rate-limit window'),
      ('rate_limit.auth.window_ms', 900000, NULL, 'Login/register per-IP rate-limit window'),
      ('rate_limit.auth.max', NULL, 10, 'Max failed auth attempts per rate-limit window'),
      ('rate_limit.mfa.window_ms', 900000, NULL, 'MFA per-IP rate-limit window'),
      ('rate_limit.mfa.max', NULL, 5, 'Max failed MFA attempts per rate-limit window'),
      ('flags.evaluation_timeout_ms', 750, NULL, 'Feature-flag provider evaluation timeout')
    ON CONFLICT (key) DO NOTHING;
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS app_settings;
    ALTER TABLE users DROP COLUMN IF EXISTS is_admin;
  `);
};
