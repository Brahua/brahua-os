#!/usr/bin/env bash
# Vercel build command (vercel.json). Migrates the database only for production builds;
# a failed migration fails the build, so the deploy never ships against an old schema.
set -euo pipefail

env_name="${VERCEL_ENV:-}"

if [ "$env_name" = "production" ]; then
  echo "Production build: applying database migrations."
  pnpm db:migrate
elif [ "${VERCEL:-}" = "1" ] && [ -z "$env_name" ]; then
  # Never skip migrations silently on Vercel because the environment is unknown.
  echo "VERCEL_ENV is not set; refusing to guess whether to migrate." >&2
  exit 1
else
  echo "Skipping database migrations (VERCEL_ENV=${env_name:-unset})."
fi

pnpm build
