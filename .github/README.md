# CI/CD (Phase 5 — GitHub Actions)

This folder holds the automated pipeline for the auth system.

## Workflows

| File                    | Trigger                                   | What it does |
| ----------------------- | ----------------------------------------- | ------------ |
| `workflows/ci-cd.yml`   | push (any branch) + pull_request          | CI (backend typecheck/audit, frontend lint/build/audit, test guard), Gitleaks secret scan, and — only on push to `develop`/`main` — build + Trivy scan + push images to GHCR, then trigger the Coolify deploy. |
| `workflows/codeql.yml`  | push/PR to `main`/`develop` + weekly cron | CodeQL static analysis for JavaScript/TypeScript across both packages. |
| `dependabot.yml`        | scheduled (weekly)                        | Dependency update PRs for backend npm, frontend npm, and github-actions. |

## Branch → environment mapping

| Branch    | CI  | Build + push | GitHub Environment | Image tags                       | Deploy webhook               |
| --------- | --- | ------------ | ------------------ | -------------------------------- | ---------------------------- |
| any other | yes | no           | —                  | —                                | —                            |
| `develop` | yes | yes          | `staging`          | `<git-sha>`, `staging`           | `COOLIFY_STAGING_WEBHOOK`    |
| `main`    | yes | yes          | `production`       | `<git-sha>`, `production`, `latest` | `COOLIFY_PRODUCTION_WEBHOOK` |

Pull requests run CI + security only (no build/push/deploy).

## Images produced (GHCR, lowercase, linux/amd64 only)

- `ghcr.io/sreejithw/auth-system-backend`
- `ghcr.io/sreejithw/auth-system-frontend`

Every push to a deploy branch pushes an immutable `<git-sha>` tag plus the
moving environment tag(s) above. Deploy consumers should prefer the `<git-sha>`
tag for reproducibility.

## Required GitHub configuration

Set these under **Settings → Secrets and variables → Actions**. Per-environment
values go under the matching **Environment** (`staging` / `production`);
repo-wide values can be repository-level.

### Secrets

| Name                         | Scope (Environment) | Purpose | Example |
| ---------------------------- | ------------------- | ------- | ------- |
| `COOLIFY_STAGING_WEBHOOK`    | `staging`           | Full Coolify deploy webhook URL for the staging resource. The deploy job `GET`s this to trigger a pull + redeploy. | `https://coolify.example.com/api/v1/deploy?uuid=abc123&force=false` |
| `COOLIFY_PRODUCTION_WEBHOOK` | `production`        | Same, for the production resource. | `https://coolify.example.com/api/v1/deploy?uuid=def456&force=false` |
| `COOLIFY_TOKEN`              | repo or both envs   | Coolify API token, sent as `Authorization: Bearer` with the webhook call. | `1|xxxxxxxxxxxxxxxxxxxx` |

> `GITHUB_TOKEN` is provided automatically by GitHub Actions and is used to log
> in to GHCR and by Gitleaks/CodeQL. You do **not** create it.

### Variables

| Name                     | Scope (Environment) | Purpose | Example |
| ------------------------ | ------------------- | ------- | ------- |
| `VITE_API_URL_STAGING`   | `staging` (or repo) | Backend API base URL baked into the **staging** frontend bundle at build time. | `https://api.staging.example.com` |
| `VITE_API_URL_PRODUCTION`| `production` (or repo) | Backend API base URL baked into the **production** frontend bundle at build time. | `https://api.example.com` |

> `VITE_API_URL` is a **build-time** value (Vite inlines it). Changing it
> requires rebuilding the frontend image, which happens automatically on the
> next push to the corresponding branch.

### GitHub Environments

Create two environments under **Settings → Environments**: `staging` and
`production`. Add environment-scoped secrets/variables as above. Optionally add
**required reviewers** on `production` to gate deploys behind manual approval —
the `deploy` job already targets these environments.

## Notes / assumptions to verify

- GHCR owner is lowercase `sreejithw` (GHCR requires lowercase). Verify this
  matches your GitHub account/org that owns the repo.
- Coolify webhooks are triggered with an HTTP `GET` and a Bearer token. If your
  Coolify instance expects `POST` or a different auth scheme, adjust the `curl`
  in the `deploy` job of `ci-cd.yml`.
- No automated tests exist yet; the `test` steps are guarded and skip cleanly.
  Add a `test` script to each `package.json` to activate them (see `# TODO: add
  tests`).
- Trivy scanning happens **before** push (image is built and loaded locally,
  scanned, then pushed only if it passes), so a HIGH/CRITICAL image never
  reaches the registry.
