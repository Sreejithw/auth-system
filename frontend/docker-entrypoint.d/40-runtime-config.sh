#!/bin/sh
set -eu

API_URL="${API_URL:-}"
APP_VERSION="${APP_VERSION:-unknown}"
GIT_SHA="${GIT_SHA:-unknown}"
BUILD_TIME="${BUILD_TIME:-unknown}"

case "${API_URL}" in
  http://*|https://*) ;;
  *)
    echo "[frontend] API_URL must be a non-empty http(s) URL." >&2
    exit 1
    ;;
esac

# The deployment URLs and build metadata are constrained to simple URL/version
# values by CI and Coolify. Reject JSON-breaking characters before generating
# the public runtime configuration.
case "${API_URL}${APP_VERSION}${GIT_SHA}${BUILD_TIME}" in
  *\"*|*\\*)
    echo "[frontend] Runtime configuration contains unsupported characters." >&2
    exit 1
    ;;
esac

API_URL="${API_URL%/}"

cat > /usr/share/nginx/html/config.json <<EOF
{
  "apiUrl": "${API_URL}",
  "version": "${APP_VERSION}",
  "gitSha": "${GIT_SHA}",
  "buildTime": "${BUILD_TIME}"
}
EOF

echo "[frontend] Runtime configuration generated for ${API_URL}."
