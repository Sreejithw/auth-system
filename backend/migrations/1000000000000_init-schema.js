/**
 * Initial schema migration.
 *
 * This is a faithful port of the original `src/db/schema.sql`, which is now
 * documented as legacy — migrations are the source of truth for the schema.
 *
 * Every statement is written with `IF NOT EXISTS` / guarded semantics so the
 * migration runs cleanly against BOTH a brand-new database and a developer's
 * existing database that already contains these objects (created previously by
 * the docker-compose init mount). node-pg-migrate only tracks that this file
 * ran (in `pgmigrations`); the SQL itself is idempotent.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
export const up = (pgm) => {
  pgm.sql(`
    -- Extensions:
    --   citext    -> case-insensitive email comparisons (unique regardless of case)
    --   pgcrypto  -> gen_random_uuid() for UUID primary keys
    CREATE EXTENSION IF NOT EXISTS citext;
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    -- -----------------------------------------------------------------------
    -- users
    -- -----------------------------------------------------------------------
    CREATE TABLE IF NOT EXISTS users (
      id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email                 citext UNIQUE NOT NULL,
      password_hash         text NOT NULL,
      failed_login_attempts integer NOT NULL DEFAULT 0,
      locked_until          timestamptz,
      created_at            timestamptz NOT NULL DEFAULT now(),
      updated_at            timestamptz NOT NULL DEFAULT now()
    );

    -- Keep updated_at fresh on every row change.
    CREATE OR REPLACE FUNCTION set_updated_at()
    RETURNS trigger AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS users_set_updated_at ON users;
    CREATE TRIGGER users_set_updated_at
      BEFORE UPDATE ON users
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at();

    -- -----------------------------------------------------------------------
    -- session  (connect-pg-simple store; DDL mirrors the bundled table.sql)
    -- -----------------------------------------------------------------------
    CREATE TABLE IF NOT EXISTS "session" (
      "sid"    varchar NOT NULL COLLATE "default",
      "sess"   json NOT NULL,
      "expire" timestamp(6) NOT NULL
    )
    WITH (OIDS=FALSE);

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'session_pkey'
      ) THEN
        ALTER TABLE "session"
          ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;
      END IF;
    END
    $$;

    CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
  `);
};

/**
 * Down migration. Intentionally conservative: drops only the objects this
 * migration owns. Note that dropping the extensions is deliberately avoided
 * because other databases/objects may depend on them.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
export const down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS "IDX_session_expire";
    DROP TABLE IF EXISTS "session";
    DROP TRIGGER IF EXISTS users_set_updated_at ON users;
    DROP TABLE IF EXISTS users;
    DROP FUNCTION IF EXISTS set_updated_at();
  `);
};
