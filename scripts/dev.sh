#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export NODE_ENV="${NODE_ENV:-development}"
export DISABLE_AUTH="${DISABLE_AUTH:-true}"
export FORGE_ALLOWED_PUBKEYS="${FORGE_ALLOWED_PUBKEYS:-npub1zxu639qym0esxnn7rzrt48wycmfhdu3e5yvzwx7ja3t84zyc2r8qz8cx2y}"
export FORGE_PORT="${FORGE_PORT:-3030}"

if [ -z "${FORGE_DATA_DIR:-}" ]; then
  FORGE_DATA_DIR="$(mktemp -d -t forge-dev-XXXXXX)"
  export FORGE_DATA_DIR
  CLEANUP_DATA_DIR=1
  echo "Using temporary Forge data dir: ${FORGE_DATA_DIR}"
else
  CLEANUP_DATA_DIR=0
fi

bun run src/index.ts &
SERVER_PID=$!

cleanup() {
  if kill -0 "${SERVER_PID}" >/dev/null 2>&1; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
  if [ "${CLEANUP_DATA_DIR}" = "1" ]; then
    rm -rf "${FORGE_DATA_DIR}"
  fi
}

trap cleanup EXIT INT TERM

SERVER_URL="http://localhost:${FORGE_PORT}"

# Wait for server to respond before seeding repositories
printf "Waiting for forge to start"
for _ in $(seq 1 40); do
  if curl -sSf "${SERVER_URL}/login" >/dev/null 2>&1; then
    echo
    break
  fi
  printf '.'
  sleep 0.5
done

mkdir -p "${FORGE_DATA_DIR}"
mkdir -p "${FORGE_DATA_DIR}/repos"

DEMO_BARE="${FORGE_DATA_DIR}/repos/demo-stream.git"
TEMPLATE_DIR="${ROOT_DIR}/examples/demo-stream"

if [ ! -d "${DEMO_BARE}" ]; then
  echo "Seeding demo repository at demo-stream"
  bun run src/cli/index.ts create demo-stream >/dev/null

  WORKDIR="$(mktemp -d)"
  git clone "${DEMO_BARE}" "${WORKDIR}/repo" >/dev/null
  pushd "${WORKDIR}/repo" >/dev/null

  git config user.name "Forge Demo"
  git config user.email "demo@example.com"

  cp -R "${TEMPLATE_DIR}/." .
  git add .
  git commit -m "Initial commit" >/dev/null
  git push origin master >/dev/null

  git checkout -b feature/log-stream >/dev/null
  {
    echo ""
    echo "## Pending changes"
    echo ""
    echo "- This line demonstrates realtime log streaming."
  } >> README.md
  git add README.md
  git commit -m "Add demo change" >/dev/null
  git push origin feature/log-stream >/dev/null

  popd >/dev/null
  rm -rf "${WORKDIR}"
fi
REPO_URL="${FORGE_DATA_DIR}/repos/demo-stream.git"

echo "Forge server running at ${SERVER_URL}"
echo "Clone the demo repo with:"
echo "  git clone ${REPO_URL}"

if command -v open >/dev/null 2>&1; then
  open "${SERVER_URL}" >/dev/null 2>&1 || true
fi

wait "${SERVER_PID}"
