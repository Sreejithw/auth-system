# Coolify Setup Runbook

Step-by-step guide to deploy the **auth-system** app to a self-hosted
[Coolify](https://coolify.io) instance on a Hetzner Cloud server, with separate
**staging** and **production** environments, free `sslip.io` HTTPS hostnames, and
images pulled from GitHub Container Registry (GHCR).

This is an operations runbook. It does not change any application code. It is
tailored to how this project actually builds and runs:

| Component | Image                                     | Serves            | Port | Notes |
| --------- | ----------------------------------------- | ----------------- | ---- | ----- |
| Backend   | `ghcr.io/sreejithw/auth-system-backend`   | Express API       | 4000 | Self-migrates on boot (`node-pg-migrate up`). Health check on `/health`. |
| Frontend  | `ghcr.io/sreejithw/auth-system-frontend`  | nginx-served SPA  | 80   | `VITE_API_URL` is **baked at build time in CI**, not a Coolify runtime var. |

Key facts that drive the whole setup:

- The backend enables `Secure` cookies and HSTS when `NODE_ENV=production`, so the
  API and SPA **must** be reached over HTTPS end-to-end or auth silently fails.
- Cookies are `SameSite=Strict`, so the frontend and backend should be **sibling
  subdomains of the same base domain** to stay same-site (e.g. `app.<...>.sslip.io`
  and `api.<...>.sslip.io`).
- The backend validates env at boot with zod and **fails fast** if anything
  required is missing or malformed.
- The frontend's API URL cannot be changed at runtime; pointing it at a different
  API means rebuilding the image with a different `--build-arg VITE_API_URL`.

> Coolify UI labels and menu positions change between versions. Where a step
> depends on an exact label, this runbook describes the general location and what
> to look for rather than pinning a specific string. Adjust to your installed
> version.

---

## Contents

1. [Prerequisites and SSH in](#1-prerequisites-and-ssh-in)
2. [Server hardening quick pass](#2-server-hardening-quick-pass)
3. [Install Coolify](#3-install-coolify)
4. [Connect the server in Coolify](#4-connect-the-server-in-coolify)
5. [Create a project with staging and production](#5-create-a-project-with-staging-and-production)
6. [Add GHCR pull credentials](#6-add-ghcr-pull-credentials)
7. [Create backend and frontend resources per environment](#7-create-backend-and-frontend-resources-per-environment)
8. [Provision PostgreSQL per environment](#8-provision-postgresql-per-environment)
9. [Assign sslip.io domains and confirm TLS](#9-assign-sslipio-domains-and-confirm-tls)
10. [Set up deploy webhooks for GitHub Actions](#10-set-up-deploy-webhooks-for-github-actions)
11. [First deploy and verification](#11-first-deploy-and-verification)
12. [Scheduled off-site Postgres backups](#12-scheduled-off-site-postgres-backups)
13. [Troubleshooting](#13-troubleshooting)
14. [Value handoff checklist: Coolify to GitHub Actions](#14-value-handoff-checklist-coolify-to-github-actions)

---

## 1. Prerequisites and SSH in

You should already have:

- A **Hetzner CX23** server (x86/amd64, 2 vCPU / 4 GB RAM / 40 GB disk) running
  Ubuntu, created, with your SSH public key added.
- The server's public IPv4 address. This runbook refers to it as `<server-ip>`
  (for example `203.0.113.45`).
- A GitHub account (`sreejithw`) that owns the GHCR packages.

On amd64/2 vCPU/4 GB, Coolify plus two small environments (each: backend +
frontend + Postgres) is tight but workable. Keep an eye on RAM; add swap if
needed (shown in step 2).

From **Windows PowerShell**, connect:

```powershell
ssh root@<server-ip>
```

If this is the first connection, accept the host key fingerprint. If it asks for
a password instead of using your key, your key was not added at creation; fix
that in the Hetzner console before continuing.

Everything in sections 2 and 3 runs **on the server** (bash). Sections that
generate secrets or hit URLs from your machine are marked as **PowerShell (local)**.

---

## 2. Server hardening quick pass

Keep this concise. The essentials are a firewall and automatic security updates.
A non-root sudo user is recommended but optional for a single-operator box.

### 2.1 Update the base system (essential)

```bash
apt update && apt upgrade -y
```

### 2.2 Automatic security updates (essential)

```bash
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades   # choose "Yes" when prompted
```

### 2.3 Firewall: open only 22, 80, 443 (essential)

You have two good options. Pick one; do not fight both against each other.

**Option A — Hetzner Cloud Firewall (recommended).** Configure it in the Hetzner
Cloud Console (Firewalls), attached to this server. Allow inbound:

- TCP `22` (SSH)
- TCP `80` (HTTP, needed for Let's Encrypt HTTP-01 challenges)
- TCP `443` (HTTPS)

This filters traffic before it reaches the VM and needs nothing installed.

**Option B — ufw on the host.** If you prefer an on-host firewall:

```bash
apt install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

> Do not block port 80. Coolify/Traefik uses it for Let's Encrypt HTTP-01
> validation and to redirect to HTTPS. Blocking 80 breaks certificate issuance.

Coolify also serves its dashboard on port `8000` initially (see step 3). You can
reach it directly by IP without opening 8000 to the world by using an SSH tunnel,
or open 8000 temporarily. The cleaner path is to give Coolify its own sslip.io
domain later so it is reachable on 443.

### 2.4 Optional: non-root sudo user

```bash
adduser deploy
usermod -aG sudo deploy
# copy your SSH key so you can log in as this user
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
```

The Coolify installer expects to run as root (or via sudo). If you create a sudo
user, run the installer with `sudo`.

### 2.5 Optional: add swap (helps on 4 GB)

```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

---

## 3. Install Coolify

Run the official installer **on the server** as root:

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

The installer sets up Docker (if missing), pulls Coolify's containers, and starts
the dashboard. This takes a few minutes.

### 3.1 First login

When it finishes, open the dashboard from **your** browser:

```
http://<server-ip>:8000
```

(The default port is `8000`. If you enabled ufw and did not open `8000`, either
open it temporarily with `ufw allow 8000/tcp`, or use an SSH tunnel:
`ssh -L 8000:localhost:8000 root@<server-ip>` from PowerShell, then browse to
`http://localhost:8000`.)

The very first visit is the **registration screen**. The first account you create
becomes the root admin. Set a strong email/password. There is no public signup
after this.

### 3.2 Give Coolify its own domain (recommended, do later)

Once DNS/sslip.io is working (step 9), set Coolify's own FQDN in
**Settings → Configuration** (look for the instance/domain field) to something
like `https://coolify.<ip-with-dashes>.sslip.io`. Coolify will then serve its own
dashboard over HTTPS on 443 and you can close port 8000. Do this after you have
confirmed TLS works for an app, so you do not lock yourself out.

---

## 4. Connect the server in Coolify

Coolify installs with the local machine already registered as the
**localhost / self** server (often named `localhost`). You deploy onto this same
box.

Verify it:

1. Go to **Servers** in the left navigation.
2. Confirm the localhost server is present and its status/health check is green
   ("reachable", Docker running). Coolify runs a validation you can re-trigger
   from the server's page.

No separate SSH key setup is needed for the localhost server since Coolify manages
it directly. (You would only add a remote server here if deploying to a different
box.)

---

## 5. Create a project with staging and production

1. Go to **Projects → New Project**. Name it e.g. `auth-system`.
2. A project contains **environments**. Coolify creates a default one (often
   `production`). Rename or keep it as **production**.
3. Add a second environment named **staging** (look for "Environments" within the
   project, then add/new).

You will end up with one project `auth-system` holding two environments:
`staging` and `production`. Each environment will get its own backend, frontend,
and Postgres resources, with **its own secrets and its own database**. Never share
`SESSION_SECRET`/`CSRF_SECRET` or a database between environments.

---

## 6. Add GHCR pull credentials

The GHCR packages are **private by default**, so Coolify needs a GitHub token to
pull them.

### 6.1 Create a GitHub Personal Access Token (classic)

1. On GitHub: **Settings → Developer settings → Personal access tokens →
   Tokens (classic) → Generate new token (classic)**.
2. Scope: check **`read:packages`** (that is all Coolify needs to pull images).
3. Set a sensible expiration and generate. Copy the token now (starts with
   `ghp_...`); you cannot see it again.

> A fine-grained PAT or a dedicated machine user also works, but classic
> `read:packages` is the simplest reliable option for pulling private GHCR images.

### 6.2 Add the registry credential in Coolify

1. Go to **Settings → Docker Registries** (also called Private Registries /
   Sources depending on version), then **Add**.
2. Fill in:
   - **Registry URL / server:** `ghcr.io`
   - **Username:** your GitHub username, `sreejithw`
   - **Password / token:** the `ghp_...` PAT from step 6.1
3. Save. This credential will be selectable when you create the Docker Image
   resources below.

If your Coolify version does not expose a global registry store, you can instead
provide the same credentials on each Docker Image resource where it asks for
registry authentication. Same values either way.

---

## 7. Create backend and frontend resources per environment

Do this **twice** — once in the `staging` environment, once in `production`. The
only differences between environments are the **image tag** (`staging` vs
`production`), the **hostnames**, the **database**, and the **secrets**.

Within the project, select the target environment first, then **Add Resource → Docker
Image** (a resource deployed from a prebuilt image, not from source).

### 7.1 Backend resource

**Image:**

- Image: `ghcr.io/sreejithw/auth-system-backend`
- Tag: `staging` in the staging environment, `production` in the production
  environment.
- Registry credential: select the GHCR credential from step 6.

**Port / networking:**

- The container listens on **4000**. Set the exposed/container port to `4000` so
  Coolify's proxy routes the domain to it. Do not publish 4000 to the host; let
  Traefik reach it over the internal Docker network.

**Health check:**

- Path: `/health`, port `4000`, expected `200`. The image already defines a
  Docker `HEALTHCHECK` hitting `http://127.0.0.1:4000/health`; mirror that in
  Coolify's health-check settings if it asks.

**Environment variables (Environment / Secrets tab):**

Mark the secret ones as secret/build-safe as offered. Set:

| Variable         | Value (staging example)                                   | Notes |
| ---------------- | --------------------------------------------------------- | ----- |
| `NODE_ENV`       | `production`                                              | Yes, `production` even in the staging env — this is what turns on `Secure` cookies + HSTS. |
| `PORT`           | `4000`                                                    | Matches the exposed port and health check. |
| `DATABASE_URL`   | *(paste from the Postgres resource — see step 8)*         | Internal connection string of THIS environment's Coolify Postgres. |
| `CORS_ORIGIN`    | `https://app.<staging-ip-with-dashes>.sslip.io`           | Exact frontend origin (scheme+host, no trailing slash). Must match the frontend URL exactly. |
| `SESSION_SECRET` | *(64 hex chars — generate, see below)*                    | Min 32 chars. Unique per environment. |
| `CSRF_SECRET`    | *(64 hex chars, DIFFERENT value — generate)*              | Min 32 chars. Unique per environment and different from `SESSION_SECRET`. |

Generate the two secrets on your machine — **PowerShell (local)**, from `DEPLOY.md`:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Run it **four times total** (two secrets x two environments) so every value is
distinct. If you do not have Node locally, generate them on the server instead:

```bash
openssl rand -hex 32
```

> Set `DATABASE_URL`, `CORS_ORIGIN`, and both secrets before the first deploy.
> The zod loader fails fast at boot, so a missing/blank var means the container
> exits immediately and the deploy is marked failed.

### 7.2 Frontend resource

**Image:**

- Image: `ghcr.io/sreejithw/auth-system-frontend`
- Tag: `staging` or `production` to match the environment.
- Registry credential: the GHCR credential from step 6.

**Port / networking:**

- The container serves on **80** (nginx). Set the exposed/container port to `80`.

**Health check:**

- Path `/`, port `80`, expected `200` (the image health-checks the root).

**Environment variables:**

- **None required at runtime.** This is the critical, project-specific point:
  `VITE_API_URL` is a Vite build-time variable that is **inlined into the static
  bundle when the image is built in CI**. Setting it in Coolify does nothing for a
  prebuilt image. Coolify simply serves the already-built files on port 80.
- Therefore the correct API URL must be provided as the **GitHub Actions build
  argument per environment** (see step 14). Concretely, the staging image must be
  built with `--build-arg VITE_API_URL=https://api.<staging-ip-with-dashes>.sslip.io`
  and the production image with the production API URL. If the frontend calls the
  wrong API, you have to rebuild/republish the image, not edit a Coolify var.

Assign domains to both resources in step 9.

---

## 8. Provision PostgreSQL per environment

Each environment gets its own database. Do this twice (staging, production).

1. In the environment, **Add Resource → Database → PostgreSQL** (choose a version;
   the app is developed against Postgres 16).
2. Name it e.g. `auth-db-staging` / `auth-db-production`. Let Coolify generate the
   username/password/db name (or set your own).
3. Deploy the database resource and wait until it is healthy.

### 8.1 Copy the internal connection string into `DATABASE_URL`

- On the Postgres resource page, find the connection strings. Use the **internal**
  URL (the one using the Docker service/host name, not `localhost` and not the
  public host), because the backend container reaches Postgres over Coolify's
  internal network. It looks like:

  ```
  postgres://<user>:<password>@<internal-host>:5432/<dbname>
  ```

- Paste that value into the **backend** resource's `DATABASE_URL` env var (step
  7.1) for the **same** environment. Redeploy the backend afterward if it was
  already created.

> Only expose the database publicly if you truly need external access. For this
> setup the backend talks to it internally, so keep it private.

### 8.2 Migrations: automatic, but here is how to inspect them

- **No manual migration step is needed.** The backend image self-migrates: its
  entrypoint runs `node node_modules/node-pg-migrate/bin/node-pg-migrate.js up -m
  migrations` against `DATABASE_URL` on every boot, then starts the server.
  Migrations are idempotent, so booting against an already-populated DB is safe.
- The deploy logs will show `[entrypoint] Running database migrations...` followed
  by `Migrations complete. Starting server...`.
- **To inspect or run migrations manually** (rarely needed), open a shell in the
  running backend container (Coolify resource → **Terminal/Exec**, or on the server
  `docker exec -it <backend-container> sh`) and run:

  ```sh
  # show/apply pending migrations
  node node_modules/node-pg-migrate/bin/node-pg-migrate.js up -m migrations
  # roll back the last migration
  node node_modules/node-pg-migrate/bin/node-pg-migrate.js down -m migrations
  ```

- To inspect tables directly, exec into the Postgres container:

  ```sh
  psql "$DATABASE_URL" -c "\dt"
  ```

---

## 9. Assign sslip.io domains and confirm TLS

`sslip.io` is a free wildcard DNS service: any hostname of the form
`<anything>.<ip-with-dashes>.sslip.io` resolves to the embedded IP. **No DNS
setup, no domain purchase.**

### 9.1 The dashed-IP format

Take your server's IPv4 and replace the dots with dashes:

- IP `203.0.113.45` -> dashed `203-0-113-45`
- So `1-2-3-4.sslip.io` resolves to `1.2.3.4`, and
  `app.203-0-113-45.sslip.io` resolves to `203.0.113.45`.

You can also use the dotted form (`app.203.0.113.45.sslip.io`) — both resolve —
but the **dashed form is more robust** with TLS tooling and is recommended here.

Because both environments run on the **same server IP**, distinguish them with the
subdomain label. A clean scheme:

| Environment | Frontend hostname                          | Backend hostname                          |
| ----------- | ------------------------------------------ | ----------------------------------------- |
| Staging     | `app-staging.<ip-with-dashes>.sslip.io`    | `api-staging.<ip-with-dashes>.sslip.io`   |
| Production  | `app.<ip-with-dashes>.sslip.io`            | `api.<ip-with-dashes>.sslip.io`           |

The frontend and backend of an environment are **sibling subdomains of the same
base** (`<ip-with-dashes>.sslip.io`), which keeps the `SameSite=Strict` session
cookie same-site. Do not put them on unrelated bases.

### 9.2 Assign the domains

For each resource (backend and frontend, both environments):

1. Open the resource → **Domains / FQDN** field.
2. Enter the full `https://...` URL, e.g. for production frontend
   `https://app.<ip-with-dashes>.sslip.io` and production backend
   `https://api.<ip-with-dashes>.sslip.io`. Use the `https://` scheme so Coolify
   requests a certificate and routes correctly to the container port (80 for
   frontend, 4000 for backend).
3. Save and redeploy the resource if prompted.

### 9.3 Confirm Let's Encrypt TLS

- Coolify's bundled proxy (Traefik) automatically requests a Let's Encrypt
  certificate for each hostname on first request. This needs port **80** reachable
  from the internet (HTTP-01 challenge) — that is why step 2.3 keeps 80 open.
- Give it a minute, then from **PowerShell (local)**:

  ```powershell
  curl.exe -I https://api.<ip-with-dashes>.sslip.io/health
  ```

  Expect `HTTP/2 200` (or `HTTP/1.1 200`) with a valid certificate and no TLS
  warning. Hitting the frontend URL in a browser should show a padlock.
- If the cert does not issue, see [Troubleshooting](#13-troubleshooting).

### 9.4 Cross-check `CORS_ORIGIN`

Make sure each backend's `CORS_ORIGIN` (step 7.1) exactly equals its
environment's **frontend** `https://` URL — no trailing slash, correct subdomain.
A mismatch here is the most common cause of "works in curl, fails in browser".

---

## 10. Set up deploy webhooks for GitHub Actions

CI/CD (the project's "Phase 5") builds and pushes images to GHCR, then tells
Coolify to pull and redeploy by calling a **deploy webhook**. Set up one webhook
per deployable resource per environment.

### 10.1 Find the webhook URL and token

For each resource (typically the backend and frontend of each environment):

1. Open the resource → **Webhooks** (sometimes under a "Deploy" or "Settings"
   section).
2. Coolify shows a **deployment webhook URL**. It generally looks like:

   ```
   https://<coolify-host>/api/v1/deploy?uuid=<resource-uuid>&force=false
   ```

3. Authentication uses a **Coolify API token** as a Bearer token, created under
   **Settings → API Tokens / Keys**. Create a token with deploy permission and
   copy it. (Some versions embed a secret in the URL instead; use whatever that
   resource's webhook panel shows.)

Triggering it manually looks like (for reference, **PowerShell local**):

```powershell
curl.exe -X POST "https://<coolify-host>/api/v1/deploy?uuid=<resource-uuid>" -H "Authorization: Bearer <coolify-api-token>"
```

### 10.2 What GitHub Actions expects

The CI pipeline references two repository secrets:

- `COOLIFY_STAGING_WEBHOOK`
- `COOLIFY_PRODUCTION_WEBHOOK`

Paste the corresponding webhook URL (and, if your version separates them, the API
token) into these GitHub repository secrets under **GitHub repo → Settings →
Secrets and variables → Actions**. The workflow will `POST` to the staging webhook
on a staging deploy and the production webhook on a production deploy, after the
new `staging`/`production`-tagged image has been pushed to GHCR.

> If a single environment has both a backend and a frontend resource, you have two
> choices: point the environment's `COOLIFY_*_WEBHOOK` at one resource and let it
> pull, or store both resource webhooks and call both from the workflow. Match this
> to how the Phase 5 workflow is written. The key handoff is: **the webhook
> URL(s)/token from Coolify become the `COOLIFY_STAGING_WEBHOOK` /
> `COOLIFY_PRODUCTION_WEBHOOK` GitHub Actions secrets.**

---

## 11. First deploy and verification

### 11.1 Trigger the first deploy

Because the images are already published to GHCR (by CI), just deploy each
resource in Coolify:

1. Open the resource → **Deploy** (or **Redeploy**). Do the **database** first (if
   not already up), then the **backend**, then the **frontend**.
2. Watch the deploy/build logs in Coolify. For the backend, confirm you see the
   migration lines and then `Auth backend listening`. The container should reach a
   healthy state (health check green on `/health`).

### 11.2 Smoke test over HTTPS

Use the production (or staging) URLs. Replace the host accordingly.

**Quick liveness (PowerShell local):**

```powershell
curl.exe -I https://api.<ip-with-dashes>.sslip.io/health
```

Expect `200`.

**Full auth flow — do this in a browser** (cookies and CSRF are easiest there):

1. Open `https://app.<ip-with-dashes>.sslip.io`.
2. **Register** a test account (email + a strong password, min 12 chars, zxcvbn
   score >= 3). Expect success (`201`, generic message).
3. **Login** with the same credentials. Expect to land on the dashboard.
4. The dashboard fetches **`GET /api/auth/me`** and shows your user — confirms the
   session cookie is being sent cross-subdomain.
5. **Logout**. Confirm you are returned to the login screen and `me` now 401s.

**Confirm cookie flags (browser DevTools → Application/Storage → Cookies):**

- The `sid` session cookie must show: **HttpOnly = true**, **Secure = true**,
  **SameSite = Strict**.
- If `Secure`/`SameSite` look wrong or the cookie is missing, the app is almost
  certainly being served over HTTP somewhere, or the two hosts are not siblings —
  revisit steps 7 (`NODE_ENV=production`, `CORS_ORIGIN`) and 9 (HTTPS + sibling
  subdomains).

Run the same smoke test against staging before treating production as good.

---

## 12. Scheduled off-site Postgres backups

Coolify has a built-in scheduled backup feature for its managed databases. Use it
for both environments (production is essential; staging is nice-to-have).

### 12.1 Configure backups in Coolify

1. Open the **PostgreSQL** resource → **Backups**.
2. Enable **scheduled backups** and set a cron schedule (e.g. daily
   `0 3 * * *`). Set a retention count.
3. Choose an **off-site destination**. Local-only backups die with the server, so
   configure an **S3-compatible target**. **Cloudflare R2** is a good free-tier
   option; **Backblaze B2** or AWS S3 also work. You will provide:
   - S3 endpoint URL (for R2: `https://<accountid>.r2.cloudflarestorage.com`)
   - Bucket name
   - Access key ID and secret access key (create an R2 API token scoped to the
     bucket)
   - Region (R2 uses `auto`)
4. Save. Add the S3 destination under **Settings → Backup/Storage destinations**
   first if your version manages destinations separately, then select it here.

### 12.2 Test a restore (do not skip this)

A backup you have never restored is not a backup. Periodically:

1. Trigger a manual backup and confirm the object lands in the R2/S3 bucket.
2. Restore into a **throwaway** database (spin up a temporary Postgres resource, or
   restore locally):

   ```sh
   # download the dump, then, against a scratch DB:
   pg_restore --clean --if-exists -d "postgres://<scratch-conn>" backup.dump
   # or for a plain SQL dump:
   psql "postgres://<scratch-conn>" -f backup.sql
   ```

3. Verify the `users` and session tables exist and row counts look right. Tear the
   scratch DB down afterward.

Document the restore steps and the last successful restore date somewhere durable.

---

## 13. Troubleshooting

**Image pull auth failures** (`denied`, `unauthorized`, `manifest unknown` in deploy
logs):
- The GHCR PAT is missing/expired or lacks `read:packages`. Regenerate (step 6.1)
  and update the Coolify registry credential (step 6.2).
- Wrong image name or tag. Confirm `ghcr.io/sreejithw/auth-system-backend` /
  `-frontend` and that the `staging`/`production` tag actually exists in GHCR (the
  CI build must have pushed it).
- The credential is not attached to the resource — reselect it on the resource.

**TLS/cert issues on sslip.io** (browser warns, cert never issues):
- Port **80** must be open to the internet for the HTTP-01 challenge. Check the
  Hetzner Cloud Firewall and/or ufw (step 2.3). Do not block 80.
- The hostname must resolve to this server. Confirm the dashed IP is correct:
  `app.<ip-with-dashes>.sslip.io` -> your `<server-ip>`.
- Let's Encrypt rate limits: if you re-issued many times, wait or use the staging
  ACME endpoint if your Coolify exposes that toggle.
- Give Traefik a minute after first request; check the proxy logs in Coolify.

**CORS mismatches** (browser console: blocked by CORS policy):
- Backend `CORS_ORIGIN` must **exactly** equal the frontend origin — correct
  scheme (`https`), correct subdomain, **no trailing slash**. Fix in the backend
  env (step 7.1) and redeploy.
- Remember each environment has its own `CORS_ORIGIN` pointing at its own
  frontend.

**Cookies not set / not sent** (login "succeeds" but `/me` returns 401):
- Almost always an HTTPS problem. `NODE_ENV=production` makes cookies `Secure`, so
  they are only sent over HTTPS. Ensure both frontend and backend are reached via
  `https://` (step 9), not the raw IP or `http://`.
- `SameSite=Strict` requires same-site: frontend and backend must be sibling
  subdomains of the same base (`app.` and `api.` under the same
  `<ip-with-dashes>.sslip.io`). Unrelated hosts will drop the cookie.
- Confirm `VITE_API_URL` in the built frontend points at the `https://api...`
  host (this is baked at build time — rebuild in CI if wrong).

**Migration errors** (backend crashes on boot, deploy fails):
- Read the backend deploy logs. The entrypoint runs `node-pg-migrate up` before
  the server starts; a bad `DATABASE_URL` or an unreachable DB shows here.
- Verify `DATABASE_URL` is the **internal** connection string of the same
  environment's Postgres and that the DB resource is healthy (step 8).
- The zod env loader also fails fast — a missing `SESSION_SECRET`/`CSRF_SECRET`
  (min 32 chars) or malformed `CORS_ORIGIN` will exit before the server binds.
  Check for a config validation error in the logs.

**Out of memory / deploy killed** (4 GB box):
- Backend builds happen in CI, not on the server, so on-server memory is mostly
  runtime. If containers get OOM-killed, add swap (step 2.5) and avoid deploying
  staging + production heavy operations simultaneously.

---

## 14. Value handoff checklist: Coolify to GitHub Actions

These are the values that must flow between the two systems. Get these right and
CI/CD deploys cleanly.

**From Coolify -> into GitHub Actions repository secrets:**

| GitHub Actions secret        | Where it comes from in Coolify                                  |
| ---------------------------- | --------------------------------------------------------------- |
| `COOLIFY_STAGING_WEBHOOK`    | Staging resource(s) → Webhooks: the deploy webhook URL (+ API token if separate). |
| `COOLIFY_PRODUCTION_WEBHOOK` | Production resource(s) → Webhooks: the deploy webhook URL (+ API token if separate). |

**Set in GitHub Actions (build variables), consumed by Coolify indirectly via the image:**

| GitHub Actions build value                    | Used for | Must equal |
| --------------------------------------------- | -------- | ---------- |
| `VITE_API_URL` (staging build arg)            | Frontend build for staging | `https://api-staging.<ip-with-dashes>.sslip.io` |
| `VITE_API_URL` (production build arg)         | Frontend build for production | `https://api.<ip-with-dashes>.sslip.io` |
| Image tags `staging` / `production`           | Which image Coolify pulls | Must match the tag configured on each Coolify resource (step 7). |

**Set in Coolify (not in GitHub), per environment (step 7.1):**

`NODE_ENV=production`, `PORT=4000`, `DATABASE_URL` (internal Postgres string),
`CORS_ORIGIN` (that environment's frontend `https://` URL), `SESSION_SECRET`,
`CSRF_SECRET`.

**Provided by you to Coolify once (step 6):** the GitHub `read:packages` PAT as the
`ghcr.io` registry credential.

Consistency rules to double-check:
- The Coolify frontend domain == the `VITE_API_URL`'s sibling (`app.` vs `api.`).
- The backend `CORS_ORIGIN` == the frontend `https://` domain, exactly.
- The Coolify resource image **tag** == the tag CI pushes for that environment.
