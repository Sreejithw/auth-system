# Feature Flag Operations

The application evaluates flags through the vendor-neutral OpenFeature server
SDK. Flipt is the initial provider; the browser never connects to Flipt and
never receives its token or authoritative flags.

## Flag catalog

| Key | Default | Browser-safe | Purpose |
| --- | ------- | ------------ | ------- |
| `new-registration-flow` | `false` | yes | Release flag for optional registration UI. |
| `new-dashboard-rollout` | `false` | yes | Harmless targeted/percentage dashboard rollout. |
| `registration-enabled` | `true` | no | Operational kill switch; `false` blocks registration server-side. |

Defaults deliberately preserve the stable application. Flipt outages or
timeouts do not take down authentication.

## Local Flipt

Start PostgreSQL and the pinned Flipt container:

```powershell
docker compose up -d
```

The Flipt UI/API is bound to `127.0.0.1:8080`. Set these in `backend/.env` when
you want local remote evaluation:

```dotenv
FLIPT_ENABLED=true
FLIPT_URL=http://localhost:8080
FLIPT_NAMESPACE=auth-system
```

Create the three boolean flags above in the configured namespace. If they do not
exist, code defaults are returned.

## Coolify setup

Deploy one Flipt resource from the pinned image in `docker-compose.yml`, attach
a persistent volume at `/var/opt/flipt`, enable authentication, and keep its
evaluation endpoint on the internal Coolify network. Do not expose it directly
to the public internet.

Each backend resource receives:

```text
FLIPT_ENABLED=true
FLIPT_URL=<internal Flipt URL>
FLIPT_NAMESPACE=auth-system-qa | auth-system-staging | auth-system-production
FLIPT_TOKEN=<secret client token>
```

Flipt v2's current OpenFeature provider does not select Flipt v2 environments,
so namespaces provide explicit isolation. Never reuse production namespaces or
tokens in QA/staging. Back up the persistent Flipt data alongside application
databases.

For administration without a public domain, use an SSH tunnel to the private
port. Restrict the UI to operators and rotate client tokens.

## Rollout patterns

- Release flag: enable in QA, then staging; start production disabled and expand
  deliberately.
- Percentage rollout: use the server-controlled `targetingKey` (user UUID or a
  stable anonymous session identifier) for deterministic cohorts.
- Targeted rollout: target server-derived email/user identity. The API ignores
  client-supplied targeting fields.
- Kill switch: set `registration-enabled=false` to return a generic `503` from
  the authoritative registration route.

Client flags only control presentation. Authorization, validation, data access,
and operational enforcement remain server-side.

## Lifecycle requirements

Every new flag must record an owner, purpose, safe default, target environments,
creation date, expiry/removal date, rollout metric, and removal ticket. Remove
flag branches after full rollout. Review operational kill switches quarterly.

## Provider alternatives

OpenFeature keeps evaluation calls provider-neutral. Unleash is a stronger fit
for enterprise governance, Flagsmith for API-first remote configuration, and
GrowthBook for experimentation/statistical analysis. Replacing Flipt should
only require provider initialization and infrastructure changes.
