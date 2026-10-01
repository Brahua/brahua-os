@AGENTS.md

# brahua-os

Personal "second brain" app (single user). Specs drive the work:

- `CAPABILITY-MAP.md` — module index and build order
- `SPEC-<module>.md` — approved spec per module
- `tasks/plan.md`, `tasks/todo.md` — current implementation plan
- `docs/principios-ux.md` — UX principles
- `docs/HANDOFF.md` — **read first when resuming**: exact status and work in flight

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
- After each deploy, the `smoke` job checks https://os.brahua.com read-only
  (`scripts/smoke-production.sh`); a failure means production is broken.

## E2E while iterating (details in `docs/HANDOFF.md`, "Pruebas E2E")

- Native, only the specs you touched: `docker compose up -d`, then
  `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:54329/brahua_os_test pnpm test:e2e e2e/<spec>.ts`
  (`pnpm test:e2e:changed` runs the specs changed against `origin/main`). Screenshot comparisons
  are skipped outside the Linux Playwright image and annotated in the report; behaviour and axe run.
- CI is the full gate. `pnpm test:e2e:docker` only to reproduce CI locally (slow).
- Screenshots: always through `expectScreenshot()` (`e2e/support/screenshots.ts`; ESLint enforces it).
  Never commit PNGs made on macOS. To create or refresh references, push the branch and run
  `gh workflow run update-screenshots.yml --ref <branch>`: it commits them as github-actions[bot]
  and re-runs CI on that commit.
