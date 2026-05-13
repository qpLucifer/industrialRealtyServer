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

if pm2 describe "${APP_NAME}" >/dev/null 2>&1; then
  pm2 restart "${APP_NAME}" --update-env
else
  pm2 start src/index.js --name "${APP_NAME}"
fi

pm2 save

echo "[industrial-realty-server] apply bundle done"
