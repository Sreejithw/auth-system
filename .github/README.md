# CI/CD and Artifact Promotion

The repository uses trunk-based delivery. Pull requests validate changes;
accepted commits on `main` are built once and automatically deployed to QA. The
same immutable image digests are promoted to stable environments without a
rebuild.

## Workflows

| File | Trigger | Purpose |
| ---- | ------- | ------- |
| `workflows/ci-cd.yml` | PR/push to `main` | CI, audits, Gitleaks, versioned Docker builds, Trivy, GHCR push, automatic dual-resource QA deploy, smoke tests. |
| `workflows/promote.yml` | Manual dispatch | Promote a QA-tested SHA to staging or production by digest, deploy both resources, smoke test, and create production releases. |
| `workflows/codeql.yml` | PR/push to `main`, weekly | JavaScript/TypeScript static analysis. |
| `dependabot.yml` | Weekly | npm and GitHub Actions update PRs. |

## Version and image contract

The root `VERSION` contains the next release base. A successful `main` build gets
`<VERSION>-qa.<run-number>`, for example `1.0.0-qa.42`.

Both GHCR repositories publish:

- immutable full Git SHA and QA-version tags;
- moving `qa` after the image passes Trivy;
- moving `staging` plus a `staging-<full-sha>` verification marker only after
  approved staging promotion and successful smoke tests;
- immutable SemVer plus `production` and `latest` only through production
  promotion.

Backend and frontend are built together and carry matching `APP_VERSION` and
`GIT_SHA` metadata. Production may only promote the exact digests currently in
staging with matching successful-smoke verification markers. Promotions are
serialized across staging and production so that gate cannot race a staging
update.

## Required GitHub Environments

Create `qa`, `staging`, and `production` under **Settings → Environments**.

- QA: automatic, no reviewer.
- Staging: required reviewer and prevent self-review.
- Production: required reviewer, prevent self-review, restrict deployment
  branches/tags.

Protect `main`: require pull requests, required CI/CodeQL checks, current branch,
and disallow force pushes.

### One-time trunk cutover

1. Create all QA Coolify resources and GitHub `qa` secrets/variables first.
2. Open one final PR from the existing `develop` branch into `main`.
3. Merge only after required checks pass. The workflow version included in that
   merge deploys `main` to QA; it no longer deploys `main` directly to production.
4. Remove `develop` from branch protection/default developer instructions after
   confirming QA smoke checks. Keep the branch temporarily only if rollback of
   the repository migration is needed.

## Required secrets

Add `COOLIFY_TOKEN` as a repository secret. Add each webhook to its matching
GitHub Environment:

| Environment | Secrets |
| ----------- | ------- |
| QA | `COOLIFY_QA_BACKEND_WEBHOOK`, `COOLIFY_QA_FRONTEND_WEBHOOK` |
| Staging | `COOLIFY_STAGING_BACKEND_WEBHOOK`, `COOLIFY_STAGING_FRONTEND_WEBHOOK` |
| Production | `COOLIFY_PRODUCTION_BACKEND_WEBHOOK`, `COOLIFY_PRODUCTION_FRONTEND_WEBHOOK` |

`GITHUB_TOKEN` is generated automatically and needs no manual setup.

## Required environment variables

| Environment | Variables |
| ----------- | --------- |
| QA | `QA_API_URL`, `QA_FRONTEND_URL` |
| Staging | `STAGING_API_URL`, `STAGING_FRONTEND_URL` |
| Production | `PRODUCTION_API_URL`, `PRODUCTION_FRONTEND_URL` |

These URLs are public deployment coordinates used by health/smoke checks. The
frontend API URL itself is supplied to each Coolify frontend container as
runtime `API_URL`, not as a CI build argument.

## Promotion procedure

1. Confirm the desired `main` run completed successfully, including QA smoke.
2. Open **Actions → Promote → Run workflow**.
3. Select `staging` and enter the full 40-character Git SHA. Staging approval
   gates the job.
4. After staging verification, run again with `production`, the same SHA, and a
   new `X.Y.Z` release version. Production approval gates the job.
5. The workflow verifies source identity, preserves digests while retagging,
   deploys backend first, deploys frontend second, records successful staging
   smoke-test markers, and records both digests.

To roll back, run staging promotion with an older successful QA SHA. Production
release tags are immutable; a production rollback should be recorded as a new
patch release pointing to the previously verified source build.

## Coolify expectations

- QA resources track tag `qa`; staging tracks `staging`; production tracks
  `production`.
- Every environment has isolated PostgreSQL and application secrets.
- Frontend resources set runtime `API_URL`; backend resources set the exact
  sibling frontend `CORS_ORIGIN`.
- Webhooks are HTTP `GET` requests authenticated by the Coolify Bearer token.
- Trivy blocks HIGH/CRITICAL findings before any image is published.
