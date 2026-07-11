-- Secure Auth — database schema
--
-- DEPRECATED as the source of truth. The schema is now owned by
-- node-pg-migrate: see backend/migrations/. Apply it with `npm run migrate`
-- (or automatically on container start via docker-entrypoint.sh).
-- This file is kept only as a human-readable reference of the initial schema
-- and is no longer mounted by docker-compose. Keep it in sync with the first
-- migration if you edit either.
--
-- All statements below remain idempotent (IF NOT EXISTS guards).

-- Extensions:
--   citext    -> case-insensitive email comparisons (unique regardless of case)
--   pgcrypto  -> gen_random_uuid() for UUID primary keys
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- session  (connect-pg-simple store; DDL mirrors the bundled table.sql)
-- ---------------------------------------------------------------------------
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
