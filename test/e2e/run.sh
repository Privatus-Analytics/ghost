#!/bin/sh
# Starts a real Ghost in Docker, pastes the snippet into Code injection through the
# Ghost Admin API, then checks the live pages in Chromium with Playwright.
set -eu

GHOST_IMAGE="${GHOST_IMAGE:-ghost:6-alpine}"
PW_VERSION="1.56.1"
NET="privatus-ghost-e2e-$$"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

cleanup() {
  docker rm -f "$NET-ghost" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$NET" >/dev/null
docker run -d --name "$NET-ghost" --network "$NET" --network-alias ghost \
  -e NODE_ENV=development -e url=http://ghost:2368 \
  -e database__client=sqlite3 \
  -e database__connection__filename=/var/lib/ghost/content/data/ghost.db \
  "$GHOST_IMAGE" >/dev/null

docker run --rm --network "$NET" -v "$ROOT:/pkg:ro" -w /work \
  -e GHOST_URL=http://ghost:2368 \
  "mcr.microsoft.com/playwright:v$PW_VERSION-noble" \
  sh -c "npm init -y >/dev/null && npm i --silent playwright@$PW_VERSION >/dev/null && cp /pkg/test/e2e/ghost.e2e.mjs . && node ghost.e2e.mjs"
