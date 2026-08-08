#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 5 ]]; then
  echo "Usage: $0 <frontend-url> <api-url> <expected-api-url> <expected-version> <expected-git-sha>" >&2
  exit 2
fi

frontend_url="${1%/}"
api_url="${2%/}"
expected_api_url="${3%/}"
expected_version="$4"
expected_git_sha="$5"
attempts="${SMOKE_ATTEMPTS:-30}"
delay="${SMOKE_DELAY_SECONDS:-10}"

case "$frontend_url:$api_url:$expected_api_url" in
  *\"*|*\\*)
    echo "::error::Smoke-test URLs contain unsupported characters."
    exit 2
    ;;
esac

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

fetch_200() {
  local name="$1"
  local url="$2"
  local output="$3"
  local attempt status

  for ((attempt = 1; attempt <= attempts; attempt++)); do
    status="$(curl --location --silent --show-error \
      --connect-timeout 10 --max-time 30 \
      --output "$output" --write-out '%{http_code}' "$url" || true)"
    if [[ "$status" == "200" ]]; then
      return 0
    fi
    echo "$name is not ready (attempt $attempt/$attempts, HTTP ${status:-unreachable})."
    sleep "$delay"
  done

  echo "::error::$name did not return HTTP 200: $url"
  return 1
}

fetch_200 "Frontend" "$frontend_url/" "$tmp_dir/frontend.html"
fetch_200 "Backend health" "$api_url/health" "$tmp_dir/health.json"

node - "$tmp_dir/health.json" "$expected_version" "$expected_git_sha" <<'NODE'
const fs = require("fs");
const [path, expectedVersion, expectedSha] = process.argv.slice(2);
let health;
try {
  health = JSON.parse(fs.readFileSync(path, "utf8"));
} catch (error) {
  console.error(`::error::Backend /health returned invalid JSON: ${error.message}`);
  process.exit(1);
}
if (health.status !== "ok") {
  console.error(`::error::Backend health status was ${JSON.stringify(health.status)}, expected "ok".`);
  process.exit(1);
}
if (health.version !== expectedVersion) {
  console.error(`::error::Backend version was ${JSON.stringify(health.version)}, expected ${JSON.stringify(expectedVersion)}.`);
  process.exit(1);
}
if (health.gitSha !== expectedSha) {
  console.error(`::error::Backend git SHA was ${JSON.stringify(health.gitSha)}, expected ${JSON.stringify(expectedSha)}.`);
  process.exit(1);
}
NODE

config_ready=false
for ((attempt = 1; attempt <= attempts; attempt++)); do
  config_status="$(curl --location --silent --show-error \
    --connect-timeout 10 --max-time 30 \
    --output "$tmp_dir/config.json" --write-out '%{http_code}' \
    "$frontend_url/config.json" || true)"
  if [[ "$config_status" == "200" ]] &&
    CONFIG_PATH="$tmp_dir/config.json" EXPECTED_API_URL="$expected_api_url" \
    EXPECTED_VERSION="$expected_version" EXPECTED_GIT_SHA="$expected_git_sha" \
    node -e 'try { const c=JSON.parse(require("fs").readFileSync(process.env.CONFIG_PATH,"utf8")); const n=v=>typeof v==="string"?v.replace(/\/+$/,""):v; process.exit(n(c.apiUrl)===n(process.env.EXPECTED_API_URL)&&c.version===process.env.EXPECTED_VERSION&&c.gitSha===process.env.EXPECTED_GIT_SHA?0:1) } catch { process.exit(1) }'; then
    config_ready=true
    break
  fi
  echo "Frontend runtime config is not ready (attempt $attempt/$attempts)."
  sleep "$delay"
done

if [[ "$config_ready" != "true" ]]; then
  echo "::error::Frontend runtime config did not converge to API URL $expected_api_url, version $expected_version, and SHA $expected_git_sha."
  exit 1
fi

# Bootstrap CSRF without creating or mutating application data.
csrf_status="$(curl --location --silent --show-error \
  --connect-timeout 10 --max-time 30 \
  --cookie-jar "$tmp_dir/cookies.txt" \
  --output "$tmp_dir/csrf.json" --write-out '%{http_code}' \
  "$api_url/api/csrf-token" || true)"
if [[ "$csrf_status" != "200" ]]; then
  echo "::error::CSRF bootstrap returned HTTP ${csrf_status:-unreachable}."
  exit 1
fi

node - "$tmp_dir/csrf.json" <<'NODE'
const fs = require("fs");
let body;
try {
  body = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
} catch (error) {
  console.error(`::error::CSRF bootstrap returned invalid JSON: ${error.message}`);
  process.exit(1);
}
if (typeof body.csrfToken !== "string" || body.csrfToken.length < 16) {
  console.error("::error::CSRF bootstrap did not return a usable token.");
  process.exit(1);
}
NODE

echo "Smoke tests passed for $frontend_url and $api_url."
