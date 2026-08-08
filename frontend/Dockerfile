# syntax=docker/dockerfile:1

# =============================================================================
# Frontend image — multi-stage build.
#
# The API URL is injected at container startup through API_URL. This keeps the
# image environment-neutral so the exact same digest can be promoted.
#
# Target platform: linux/amd64 (x86-64 deploy server).
# =============================================================================

# ---- Stage 1: builder ----
FROM node:24-bookworm-slim AS builder
WORKDIR /app

# Install deps from the committed lockfile, then build.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Stage 2: runtime (static files served by nginx) ----
FROM nginx:alpine AS runtime

ARG APP_VERSION=development
ARG GIT_SHA=unknown
ARG BUILD_TIME=unknown
ENV APP_VERSION=${APP_VERSION} \
    GIT_SHA=${GIT_SHA} \
    BUILD_TIME=${BUILD_TIME}
LABEL org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_TIME}"

# Pull patched Alpine packages (e.g. c-ares, libexpat) so Trivy OS scans pass.
RUN apk upgrade --no-cache

# SPA-aware server config (client-side routing, gzip, cache headers).
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Built static assets.
COPY --from=builder /app/dist /usr/share/nginx/html
COPY docker-entrypoint.d/40-runtime-config.sh /docker-entrypoint.d/40-runtime-config.sh

RUN sed -i 's/\r$//' /docker-entrypoint.d/40-runtime-config.sh \
  && chmod +x /docker-entrypoint.d/40-runtime-config.sh

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
