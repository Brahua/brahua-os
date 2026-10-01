#!/usr/bin/env bash
# Vercel build command (vercel.json). Migrates and seeds the database only for production builds;
# a failed migration or seed fails the build, so the deploy never ships against an old schema.
# The seed is idempotent (existing slugs are left untouched) and areas are never hard-deleted.
set -euo pipefail

env_name="${VERCEL_ENV:-}"

if [ "$env_name" = "production" ]; then
  echo "Production build: checking auth variables, applying migrations and seeding life areas."
  # Fails before touching the database if BETTER_AUTH_SECRET, BETTER_AUTH_URL or OWNER_EMAIL
  # is missing or invalid.
  pnpm auth:check-env
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
# The routes that force errors (E2E only) must never ship; next.config.ts already refuses
# E2E_ERROR_ROUTES on Vercel, this checks the result.
node scripts/check-no-e2e-routes.mjs
