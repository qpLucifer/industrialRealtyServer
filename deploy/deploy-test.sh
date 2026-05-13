#!/usr/bin/env bash
# Avoid pipefail: not supported by dash/sh; CRLF on this line also breaks bash.
set -eu

# Required env:
# APP_DIR        - project directory on server, e.g. /www/wwwroot/industrial-realty-hifi/industrial-realty-server
# DEPLOY_BRANCH  - git branch to deploy, e.g. main
# APP_NAME       - pm2 app name, e.g. industrial-realty-server-test

: "${APP_DIR:?APP_DIR is required}"
: "${DEPLOY_BRANCH:?DEPLOY_BRANCH is required}"
: "${APP_NAME:?APP_NAME is required}"

echo "[industrial-realty-server] deploy start"
echo "[industrial-realty-server] APP_DIR=${APP_DIR}"
echo "[industrial-realty-server] DEPLOY_BRANCH=${DEPLOY_BRANCH}"
echo "[industrial-realty-server] APP_NAME=${APP_NAME}"

cd "${APP_DIR}"

git fetch --all --prune
git checkout "${DEPLOY_BRANCH}"
git reset --hard "origin/${DEPLOY_BRANCH}"

npm ci --omit=dev

if pm2 describe "${APP_NAME}" >/dev/null 2>&1; then
  pm2 restart "${APP_NAME}" --update-env
else
  pm2 start src/index.js --name "${APP_NAME}"
fi

pm2 save


echo "[industrial-realty-server] deploy done"
