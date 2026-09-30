@AGENTS.md

# brahua-os

Personal "second brain" app (single user). Specs drive the work:

- `CAPABILITY-MAP.md` — module index and build order
- `SPEC-<module>.md` — approved spec per module
- `tasks/plan.md`, `tasks/todo.md` — current implementation plan
- `docs/principios-ux.md` — UX principles

## Rules

- Code, file names, commits: **English**. UI copy, specs, docs: **Spanish**.
- Node 24 (`.nvmrc`) + pnpm. Run `nvm use` first.
- Before committing: `pnpm lint && pnpm typecheck && pnpm build` (plus `pnpm test` once it exists).
- GitHub: personal account `Brahua` only (`gh auth switch -u Brahua` if `jbrahua` is active).

## Workflow (trunk-based)

- One short-lived branch per change: `feat/…`, `fix/…`, `chore/…`, `docs/…`. Open a PR against `main`.
- Merge only with CI green. Every push to `main` re-runs CI in `.github/workflows/ci.yml`, and the
  `deploy` job publishes to production (https://os.brahua.com) **only if all checks pass**.
- Vercel's Git auto-deploy is disabled (`vercel.json`); GitHub Actions is the only deployer.
- MVP works directly on production: tests use a throwaway Postgres, never the production DB.
  Migrations are additive; anything destructive needs the owner's OK and a backup first.
