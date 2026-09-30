#!/usr/bin/env bash
# Vercel build command (vercel.json). Migrates and seeds the database only for production builds;
# a failed migration or seed fails the build, so the deploy never ships against an old schema.
# The seed is idempotent (existing slugs are left untouched) and areas are never hard-deleted.
set -euo pipefail

env_name="${VERCEL_ENV:-}"

if [ "$env_name" = "production" ]; then
  echo "Production build: applying database migrations and seeding default life areas."
  pnpm db:migrate
  pnpm db:seed
elif [ "${VERCEL:-}" = "1" ] && [ -z "$env_name" ]; then
  # Never skip migrations silently on Vercel because the environment is unknown.
  echo "VERCEL_ENV is not set; refusing to guess whether to migrate." >&2
  exit 1
else
  echo "Skipping database migrations and seed (VERCEL_ENV=${env_name:-unset})."
fi

pnpm build
