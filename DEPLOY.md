# Deployment (Phase 1 — production-shippable)

This document covers building the container images, running database migrations,
and the environment variables required to ship the auth system to an
**x86/amd64** Linux server. It does **not** cover CI/CD or Coolify (a later
phase).

## Components

| Image           | Base                 | Serves            | Port |
| --------------- | -------------------- | ----------------- | ---- |
| `auth-backend`  | `node:24-bookworm-slim` | Express API (+ self-migrate) | 4000 |
| `auth-frontend` | `nginx:alpine`       | Built Vite SPA    | 80   |

The backend uses `argon2`, a native module. The image is Debian-based
(bookworm-slim, glibc) on purpose so argon2's prebuilt binaries are used and no
compiler toolchain is required.

## Environment variables

### Backend (runtime — injected by the platform, never baked into the image)

| Variable         | Required | Example                                            | Notes |
| ---------------- | -------- | -------------------------------------------------- | ----- |
| `NODE_ENV`       | yes      | `production`                                       | Enables `Secure` cookies + HSTS. |
| `PORT`           | no       | `4000`                                             | Defaults to 4000. |
| `CORS_ORIGIN`    | yes      | `https://app.example.com`                          | Exact frontend origin (scheme+host+port). |
| `DATABASE_URL`   | yes      | `postgres://user:pass@db-host:5432/authdb`         | Used by the app AND migrations. |
| `SESSION_SECRET` | yes      | 64 hex chars                                       | Min 32 chars. |
| `CSRF_SECRET`    | yes      | 64 hex chars (different value)                     | Min 32 chars. |

The loader (`backend/src/config/env.ts`, zod) **fails fast at boot** if any
required var is missing or malformed.

### Frontend (build-time — baked into the static bundle)

| Variable        | When       | Example                     | Notes |
| --------------- | ---------- | --------------------------- | ----- |
| `VITE_API_URL`  | build only | `https://api.example.com`   | Inlined by Vite at build. Changing it requires rebuilding the image. |

### Generating real secrets (PowerShell)

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Run it twice to get two distinct values for `SESSION_SECRET` and `CSRF_SECRET`.

## Building the images

Run from the repository root. On an amd64 host the default platform is already
`linux/amd64`; on other hosts add `--platform=linux/amd64`.

```powershell
# Backend
docker build -t auth-backend:latest ./backend

# Frontend (VITE_API_URL is baked in at build time)
docker build --build-arg VITE_API_URL=https://api.example.com -t auth-frontend:latest ./frontend
```

## Database migrations

Schema is owned by **node-pg-migrate** (`backend/migrations/`). `schema.sql` is
now a reference only and is no longer mounted by docker-compose.

- **On deploy (self-migrating):** the backend image's entrypoint
  (`docker-entrypoint.sh`) runs `node-pg-migrate up` against `DATABASE_URL`
  and then starts the server. Migrations are idempotent (`IF NOT EXISTS`
  semantics), so booting against an already-populated database is safe.
- **Manually / locally:** `cd backend; npm run migrate` (reads `backend/.env`).
  Roll back the last migration with `npm run migrate:down`.

> If you prefer a separate release command instead of self-migration, run
> `node node_modules/node-pg-migrate/bin/node-pg-migrate.js up -m migrations`
> inside the backend image as a one-off before starting the server, and remove
> the migrate step from the entrypoint. The entrypoint approach is the default.

## Running

```powershell
# Backend (expects a reachable Postgres in DATABASE_URL)
docker run -d --name auth-backend -p 4000:4000 `
  -e NODE_ENV=production `
  -e CORS_ORIGIN=https://app.example.com `
  -e DATABASE_URL=postgres://user:pass@db-host:5432/authdb `
  -e SESSION_SECRET=<64-hex> `
  -e CSRF_SECRET=<64-hex> `
  auth-backend:latest

# Frontend
docker run -d --name auth-frontend -p 8080:80 auth-frontend:latest
```

Put both behind a TLS-terminating reverse proxy in production. `NODE_ENV=production`
turns on `Secure` cookies, so the API must be reached over HTTPS for auth to
work end-to-end. The app sets `trust proxy = 1` in production.

## Local development is unaffected

- `docker compose up -d` still starts Postgres on `localhost:5432` with the same
  credentials and persistent `pgdata` volume (nothing is wiped).
- `cd backend; npm run dev` and `cd frontend; npm run dev` work exactly as
  before. The only new local step for a fresh database is `npm run migrate`
  (previously the schema was applied via the compose init mount).
