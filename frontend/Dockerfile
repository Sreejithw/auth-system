# syntax=docker/dockerfile:1

# =============================================================================
# Frontend image — multi-stage build.
#
# IMPORTANT: Vite inlines `VITE_*` variables at BUILD time. `VITE_API_URL` is
# therefore a build ARG that gets baked into the static bundle — it is NOT a
# runtime setting. To point the app at a different API, rebuild the image with
# a different `--build-arg VITE_API_URL=...`.
#
# Target platform: linux/amd64 (x86-64 deploy server).
# =============================================================================

# ---- Stage 1: builder ----
FROM node:24-bookworm-slim AS builder
WORKDIR /app

# API base URL, baked into the bundle at build time.
ARG VITE_API_URL=http://localhost:4000
ENV VITE_API_URL=${VITE_API_URL}

# Install deps from the committed lockfile, then build.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Stage 2: runtime (static files served by nginx) ----
FROM nginx:alpine AS runtime

# Pull patched Alpine packages (e.g. c-ares, libexpat) so Trivy OS scans pass.
RUN apk upgrade --no-cache

# SPA-aware server config (client-side routing, gzip, cache headers).
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Built static assets.
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
