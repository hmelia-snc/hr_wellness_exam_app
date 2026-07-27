#!/usr/bin/env bash
# Runs `prisma migrate deploy` with a few retries before starting the server.
#
# Why: a fresh App Service container's first outbound TLS connection to
# Azure SQL intermittently fails ("Error opening a TLS connection ...
# Connection reset by peer") in the first moment or two after the
# container's networking comes up — not a real config problem (encrypt=true,
# trustServerCertificate=false is the correct, secure setting; loosening it
# would trade security for papering over a timing race). `prisma migrate
# deploy` doesn't retry on its own, so a single blip used to crash the whole
# container, and Azure's only recovery path was recreating it from scratch —
# 100+ seconds of downtime just to get a second attempt. Retrying in-process
# is far cheaper and faster.
set -uo pipefail

MAX_ATTEMPTS=5
RETRY_DELAY_SECONDS=5

# Invoke the CLI's actual file directly with `node`, rather than through
# `npx` or the node_modules/.bin/prisma symlink. Two separate problems ruled
# those out: `npx prisma` falls back to silently installing the LATEST
# prisma (a different major version, with a much larger unrelated dependency
# tree) from the registry whenever it can't resolve a local install — an
# install that alone can take minutes and blow past Azure's startup probe
# timeout. And node_modules/.bin/prisma is itself a symlink, which Azure's
# GitHub Actions zip-deploy pipeline doesn't preserve, so the symlink is
# simply missing in the deployed container ("No such file or directory").
# node_modules/prisma/build/index.js is a real file, not a symlink, so it
# survives zip/unzip and this fails fast on a genuine problem instead of
# silently doing the wrong thing.
attempt=1
until node node_modules/prisma/build/index.js migrate deploy; do
  if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
    echo "prisma migrate deploy failed after $MAX_ATTEMPTS attempts, giving up." >&2
    exit 1
  fi
  echo "prisma migrate deploy failed (attempt $attempt/$MAX_ATTEMPTS) — retrying in ${RETRY_DELAY_SECONDS}s..." >&2
  attempt=$((attempt + 1))
  sleep "$RETRY_DELAY_SECONDS"
done

exec node dist/scripts/startServer.js
