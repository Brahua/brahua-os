-- Creates `backup_ro`, the read-only role the weekly backup (.github/workflows/backup.yml) uses.
-- Run it ONCE with psql, connected as the role that owns the tables (the one in
-- DATABASE_URL_UNPOOLED, usually neondb_owner), never as backup_ro:
--
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/backup/readonly-role.sql
--
-- It asks for the new role's password (or takes `-v backup_ro_password=…`, as CI does against its
-- throwaway database). Steps for the owner: docs/HANDOFF.md, "Respaldos (C10)".
--
-- Grants: CONNECT on this database, USAGE and SELECT on every table and sequence in `public`
-- (the app) and `drizzle` (the migration journal, which pg_dump also dumps), and the same SELECT
-- on tables and sequences that migrations create later (default privileges of the owner role).
-- No INSERT, UPDATE, DELETE, TRUNCATE or DDL.
\set ON_ERROR_STOP on

\if :{?backup_ro_password}
\else
\prompt 'Password for backup_ro (it will be shown while you type): ' backup_ro_password
\endif

BEGIN;

-- Default privileges only cover objects created by the role running this file, so it must be
-- the role that runs the migrations (the owner of the tables).
DO $$
DECLARE
  foreign_owner text;
BEGIN
  SELECT tableowner INTO foreign_owner
  FROM pg_tables
  WHERE schemaname IN ('public', 'drizzle') AND tableowner <> current_user
  LIMIT 1;
  IF foreign_owner IS NOT NULL THEN
    RAISE EXCEPTION 'Run this as the table owner (%), not as %.', foreign_owner, current_user;
  END IF;
END
$$;

CREATE ROLE backup_ro LOGIN PASSWORD :'backup_ro_password';

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO backup_ro', current_database());
END
$$;

-- The drizzle schema exists once the first migration ran (always true in production).
CREATE SCHEMA IF NOT EXISTS drizzle;

GRANT USAGE ON SCHEMA public, drizzle TO backup_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public, drizzle TO backup_ro;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public, drizzle TO backup_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public, drizzle GRANT SELECT ON TABLES TO backup_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public, drizzle GRANT SELECT ON SEQUENCES TO backup_ro;

COMMIT;
