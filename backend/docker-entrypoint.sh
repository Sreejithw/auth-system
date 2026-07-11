#!/bin/sh
# Container entrypoint for the auth backend.
#
# Production deploys self-migrate: we run all pending node-pg-migrate migrations
# against DATABASE_URL, then start the server. Migrations are idempotent
# (IF NOT EXISTS semantics) so this is safe to run on every boot, including
# against a database that already has the objects.
set -e

echo "[entrypoint] Running database migrations (node-pg-migrate up)..."
node node_modules/node-pg-migrate/bin/node-pg-migrate.js up -m migrations

echo "[entrypoint] Migrations complete. Starting server..."
exec node dist/index.js
