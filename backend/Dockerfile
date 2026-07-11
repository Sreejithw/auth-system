# syntax=docker/dockerfile:1

# =============================================================================
# Auth backend image — multi-stage build.
#
# Debian-based (bookworm-slim) rather than Alpine on purpose: the `argon2`
# native module ships glibc prebuilt binaries, so a glibc base avoids the
# musl native-build pain (python3/make/g++) that Alpine would require.
#
# Target platform: linux/amd64 (x86-64 deploy server). Build on an amd64 host,
# or pass `--platform=linux/amd64` to `docker build`.
# =============================================================================

# ---- Stage 1: builder (all deps + TypeScript build) ----
FROM node:24-bookworm-slim AS builder
WORKDIR /app

# Install ALL deps (incl. dev) using the committed lockfile for reproducibility.
COPY package.json package-lock.json ./
RUN npm ci

# Compile TypeScript (src -> dist).
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Stage 2: runtime (prod-only deps) ----
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# curl is used by the HEALTHCHECK below.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

# Install production dependencies only. argon2 pulls its glibc prebuilt binary
# here, so no compiler toolchain is needed.
COPY package.json package-lock.json ./
# npm ci needs the CLI; drop npm afterward so Trivy does not flag its bundled
# undici (CVE-2026-12151) — the runtime only executes node, not npm.
RUN npm ci --omit=dev \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# Application artifacts: compiled server, migrations, and the entrypoint.
COPY --from=builder /app/dist ./dist
COPY migrations ./migrations
COPY docker-entrypoint.sh ./docker-entrypoint.sh

# Normalize potential CRLF line endings (repo may be checked out on Windows)
# and make the entrypoint executable.
RUN sed -i 's/\r$//' docker-entrypoint.sh \
  && chmod +x docker-entrypoint.sh

# Drop root: run as the built-in unprivileged `node` user.
USER node

EXPOSE 4000

# Liveness probe against the app's /health endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4000/health || exit 1

# Entrypoint runs migrations, then starts the server.
CMD ["./docker-entrypoint.sh"]
