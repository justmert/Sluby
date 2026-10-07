#!/usr/bin/env bash
# checks a running compose stack through its web port, then stops the backend
# with SIGTERM and checks that it shut down cleanly. run after
# `docker compose up -d --wait`, with BOOTSTRAP_API_KEY set to the stack's
# bootstrap key. COMPOSE_ARGS adds compose options (-p, -f), WEB_PORT the port.
#
#   BOOTSTRAP_API_KEY=sluby_... scripts/stack-check.sh
set -euo pipefail

base="http://127.0.0.1:${WEB_PORT:-8080}"
key="${BOOTSTRAP_API_KEY:?set BOOTSTRAP_API_KEY to the bootstrap key of the stack}"
# shellcheck disable=SC2206 # word splitting of the extra compose options is wanted
compose=(docker compose ${COMPOSE_ARGS:-})
failed=0

fail() {
  echo "FAIL: $*" >&2
  failed=1
}

expect_status() {
  local want="$1" path="$2"
  shift 2
  local got
  got="$(curl -s -o /dev/null -w '%{http_code}' "$@" "$base$path")"
  if [ "$got" = "$want" ]; then echo "ok: $path answered $got"; else fail "$path answered $got, expected $want"; fi
}

expect_status 200 /studio
expect_status 200 /health
expect_status 200 /api/v1/openapi.json
expect_status 200 /api/v1/system/status -H "Authorization: Bearer $key"

# the root redirect must stay relative, so it keeps whatever port and scheme
# the browser used
location="$(curl -s -o /dev/null -D - "$base/" | tr -d '\r' | awk 'tolower($1) == "location:" { print $2 }')"
case "$location" in
  /*) echo "ok: / redirects to $location" ;;
  *) fail "/ redirects to '$location', expected a relative path" ;;
esac

# error bodies carry no stack trace unless EXPOSE_ERROR_STACKS is set
body="$(curl -s -H "Authorization: Bearer $key" "$base/api/v1/assets/00000000-0000-4000-8000-000000000000")"
case "$body" in
  *'"stack"'*) fail "an error response carries a stack trace: $body" ;;
  *'"error"'*) echo "ok: error responses carry no stack trace" ;;
  *) fail "unexpected error body: $body" ;;
esac

# SIGTERM must reach node (not a shell as pid 1) and end in a clean exit
container="$("${compose[@]}" ps -q backend)"
started=$(date +%s)
"${compose[@]}" stop -t 30 backend >/dev/null
took=$(($(date +%s) - started))
code="$(docker inspect -f '{{.State.ExitCode}}' "$container")"
if [ "$code" = 0 ]; then echo "ok: backend exited 0 after SIGTERM in ${took}s"; else fail "backend exited $code after SIGTERM (${took}s)"; fi
if "${compose[@]}" logs --no-color backend | grep -q 'Graceful shutdown complete'; then
  echo "ok: backend logged its shutdown"
else
  fail "backend did not log 'Graceful shutdown complete'"
fi

exit "$failed"
