#!/usr/bin/env bash
# Read-only smoke test of production (ci.yml runs it after each deploy). Plain GET requests only:
# it never signs in, never sends credentials and never calls an endpoint that writes.
#
#   bash scripts/smoke-production.sh                 # https://os.brahua.com
#   SMOKE_BASE_URL=http://localhost:3000 bash scripts/smoke-production.sh
#
# Retries the whole round a few times (SMOKE_ATTEMPTS, SMOKE_DELAY seconds apart) to absorb
# propagation; exits 1 if the last round still fails. Worst case with the defaults: 6 rounds of
# 11 requests × 8 s plus 5 pauses of 10 s ≈ 9.6 min (ci.yml's smoke job allows 15).
set -uo pipefail

BASE_URL="${SMOKE_BASE_URL:-https://os.brahua.com}"
BASE_URL="${BASE_URL%/}"
ATTEMPTS="${SMOKE_ATTEMPTS:-6}"
DELAY="${SMOKE_DELAY:-10}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

failures=()
fail() { failures+=("$1"); }

# GET $1 without following redirects. Sets STATUS, and leaves the headers (lowercase names, no CR)
# and the body in $WORK.
fetch() {
  # Nothing from the previous request may leak into this one's checks.
  rm -f "$WORK/headers.raw" "$WORK/headers" "$WORK/body" "$WORK/error"
  STATUS="$(curl -sS --max-time 8 --max-redirs 0 -H "cache-control: no-cache" \
    -D "$WORK/headers.raw" -o "$WORK/body" -w '%{http_code}' "$BASE_URL$1" 2>"$WORK/error")" ||
    STATUS="000 ($(tr -d '\n' <"$WORK/error"))"
  tr -d '\r' <"$WORK/headers.raw" 2>/dev/null |
    awk '{ i = index($0, ":"); if (i) { v = substr($0, i + 1); sub(/^[ \t]+/, "", v); print tolower(substr($0, 1, i - 1)) ": " v } }' \
      >"$WORK/headers" || true
}

header() { grep -m1 "^$1: " "$WORK/headers" | cut -d' ' -f2-; }

expect_header() {
  local path="$1" name="$2" pattern="$3" value
  value="$(header "$name")"
  [[ "$value" =~ $pattern ]] || fail "$path: header $name is '${value:-missing}', expected /$pattern/"
}

security_headers() {
  expect_header "$1" content-security-policy "frame-ancestors 'none'"
  expect_header "$1" x-frame-options '^DENY$'
  expect_header "$1" referrer-policy '^strict-origin-when-cross-origin$'
  expect_header "$1" x-content-type-options '^nosniff$'
  # Vercel adds HSTS on https; a plain-http target (a local server) has none.
  if [[ "$BASE_URL" == https://* ]]; then
    expect_header "$1" strict-transport-security 'max-age=[1-9][0-9]*'
  fi
}

expect_redirect_to_login() {
  local path="$1" location
  fetch "$path"
  [[ "$STATUS" == "307" ]] || fail "$path: status $STATUS, expected 307"
  location="$(header location)"
  # Only this site's /login (relative or absolute), never another host.
  [[ "$location" == "/login" || "$location" == "$BASE_URL/login" ]] ||
    fail "$path: redirects to '${location:-nowhere}', expected /login on $BASE_URL"
  security_headers "$path"
}

# A missing page answers 404 with the app's own page, also without a session.
expect_not_found() {
  local path="$1"
  fetch "$path"
  [[ "$STATUS" == "404" ]] || fail "$path: status $STATUS, expected 404"
  grep -Eq '<h1[^>]*>Nada por aquí</h1>' "$WORK/body" ||
    fail "$path: no <h1>Nada por aquí</h1> (the app's 404 page)"
  security_headers "$path"
}

round() {
  failures=()

  expect_redirect_to_login /
  expect_redirect_to_login /projects
  expect_redirect_to_login /tasks
  expect_redirect_to_login /habits
  expect_redirect_to_login /areas
  expect_redirect_to_login /settings

  fetch /login
  [[ "$STATUS" == "200" ]] || fail "/login: status $STATUS, expected 200"
  grep -Eq '<h1[^>]*>Iniciar sesión</h1>' "$WORK/body" ||
    fail "/login: no <h1>Iniciar sesión</h1> in the page"
  security_headers /login

  # Better Auth's health check: a constant answer, not rate limited (no database write).
  fetch /api/auth/ok
  [[ "$STATUS" == "200" ]] || fail "/api/auth/ok: status $STATUS, expected 200"
  grep -Eq '"ok": ?true' "$WORK/body" || fail "/api/auth/ok: body is not {\"ok\":true}"
  security_headers /api/auth/ok

  # PWA: the manifest and its icons are public (installing happens before signing in).
  fetch /manifest.webmanifest
  [[ "$STATUS" == "200" ]] || fail "/manifest.webmanifest: status $STATUS, expected 200"
  expect_header /manifest.webmanifest content-type '^application/manifest\+json'
  grep -Eq '"display": ?"standalone"' "$WORK/body" ||
    fail "/manifest.webmanifest: no \"display\":\"standalone\""
  security_headers /manifest.webmanifest

  fetch /icons/icon-192.png
  [[ "$STATUS" == "200" ]] || fail "/icons/icon-192.png: status $STATUS, expected 200"
  expect_header /icons/icon-192.png content-type '^image/png$'

  expect_not_found /no-existe
  # The routes that force errors exist only in E2E builds (src/lib/e2e-error-routes.ts). Shipped by
  # mistake, /e2e/error would redirect to /login (it is under the (app) layout) and /e2e/root-error
  # would answer 500.
  expect_not_found /e2e/error
  expect_not_found /e2e/root-error

  ((${#failures[@]} == 0))
}

echo "Smoke test: $BASE_URL"
for ((attempt = 1; attempt <= ATTEMPTS; attempt++)); do
  if round; then
    echo "OK (attempt $attempt): / /projects /tasks /habits /areas /settings → /login, /login 200, /api/auth/ok, manifest and icon, 404s (test routes absent), security headers."
    exit 0
  fi
  echo "Attempt $attempt/$ATTEMPTS failed:"
  printf '  - %s\n' "${failures[@]}"
  ((attempt < ATTEMPTS)) && sleep "$DELAY"
done

for message in "${failures[@]}"; do echo "::error::$message"; done
exit 1
