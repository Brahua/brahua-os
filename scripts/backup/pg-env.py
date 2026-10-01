#!/usr/bin/env python3
"""Turns a Postgres connection URL into libpq PG* variables for .github/workflows/backup.yml.

    eval "$(python3 scripts/backup/pg-env.py [--production])"   # reads $BACKUP_URL

Prints `export PGHOST=…` lines (shell-quoted) for eval, so the URL never reaches a command line
and the containers get the connection through `docker run -e PG…`. Never prints the URL; errors
name the problem, not the value. With --production it also requires the direct Neon host (no
`-pooler`) and verified TLS (`sslmode=verify-full&sslrootcert=system`).

`sslrootcert=system` becomes the CA bundle path the workflow mounts into the container
(CA_BUNDLE): the postgres images ship no CA certificates of their own.
"""
import os
import shlex
import sys
from urllib.parse import parse_qsl, unquote, urlsplit

CA_BUNDLE = "/etc/ssl/certs/ca-certificates.crt"
HANDOFF = 'see docs/HANDOFF.md, section "Respaldos (C10)"'

# URL query parameter -> libpq environment variable. Anything else is refused, not dropped.
PARAMS = {
    "sslmode": "PGSSLMODE",
    "sslrootcert": "PGSSLROOTCERT",
    "channel_binding": "PGCHANNELBINDING",
    "connect_timeout": "PGCONNECT_TIMEOUT",
}


def fail(message: str) -> None:
    print(f"::error::{message} ({HANDOFF}).", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    production = "--production" in sys.argv[1:]
    url = os.environ.get("BACKUP_URL", "")
    if not url:
        fail("The connection string is empty")
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        fail("The connection string is not a valid URL")
    if parts.scheme not in ("postgres", "postgresql"):
        fail("The connection string must start with postgresql://")
    host = parts.hostname or ""
    database = unquote(parts.path.lstrip("/"))
    if not host or not parts.username or not database:
        fail("The connection string needs a user, a host and a database")

    env = {
        "PGHOST": host,
        "PGUSER": unquote(parts.username),
        "PGDATABASE": database,
    }
    if port:
        env["PGPORT"] = str(port)
    if parts.password:
        env["PGPASSWORD"] = unquote(parts.password)

    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    for key, value in query.items():
        if key not in PARAMS:
            fail(f"Unsupported connection parameter: {key}")
        env[PARAMS[key]] = CA_BUNDLE if key == "sslrootcert" and value == "system" else value

    if production:
        if "-pooler." in host:
            fail("BACKUP_DATABASE_URL uses the pooled host (-pooler); pg_dump needs the direct one")
        if query.get("sslmode") != "verify-full" or query.get("sslrootcert") != "system":
            fail("BACKUP_DATABASE_URL must verify TLS: add sslmode=verify-full&sslrootcert=system")
        if "PGPASSWORD" not in env:
            fail("BACKUP_DATABASE_URL has no password")

    for name, value in env.items():
        print(f"export {name}={shlex.quote(value)}")


if __name__ == "__main__":
    main()
