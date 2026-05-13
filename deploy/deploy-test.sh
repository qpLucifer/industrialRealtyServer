#!/usr/bin/env bash
# Apply a CI-uploaded release bundle on the server (no git).
# Prerequisite: upload server-release.tgz to /tmp (or set RELEASE_TAR).
set -eu

# Required env:
# APP_DIR  - deploy directory on server (same as SERVER_API_APP_DIR)
# APP_NAME - pm2 process name

: "${APP_DIR:?APP_DIR is required}"
: "${APP_NAME:?APP_NAME is required}"

RELEASE_TAR="${RELEASE_TAR:-/tmp/server-release.tgz}"

echo "[industrial-realty-server] apply bundle start"
echo "[industrial-realty-server] APP_DIR=${APP_DIR}"
echo "[industrial-realty-server] APP_NAME=${APP_NAME}"
echo "[industrial-realty-server] RELEASE_TAR=${RELEASE_TAR}"

test -f "${RELEASE_TAR}"
cd "${APP_DIR}"

rm -rf src scripts deploy
tar -xzf "${RELEASE_TAR}" -C "${APP_DIR}"
npm ci --omit=dev

pm2 delete "${APP_NAME}" 2>/dev/null || true
if ! pm2 start src/index.js --name "${APP_NAME}" --update-env; then
  pm2 logs "${APP_NAME}" --lines 80 --nostream 2>/dev/null || pm2 logs --lines 40 --nostream || true
  exit 1
fi
pm2 save || true

echo "[industrial-realty-server] apply bundle done"
