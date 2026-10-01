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
- `main` is unprotected (free private plan; owner's decision, 2026-10-01): before every merge, check that
  all 3 CI checks are green, and never push directly to `main`.
- Vercel's Git auto-deploy is disabled (`vercel.json`); GitHub Actions is the only deployer. The
  `deploy` job runs `vercel deploy --prod` (remote build on Vercel: `scripts/vercel-build.sh`
  migrates there, because the Neon variables are Sensitive and never reach the runner).
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
  (deleting orphans) and re-runs CI on that commit. In CI the screenshot gate cannot be turned off.
- Workflow actions are pinned to full SHAs (`# vX.Y.Z` comment); Dependabot proposes bumps.

## Lessons from `core` (retrospective, 2026-10-01)

Recurring review findings and incidents, turned into rules. Apply them before review, not after.

- **Secrets:** never ask the owner to paste a secret into the session, and never print one. Owner-only
  steps (`gh secret set`, `pnpm auth:owner`, `psql`) run in their own terminal; the `!` prefix stores
  secrets empty. Logs never include input values or Postgres messages (`describeError`).
- **Neon credentials are Sensitive:** after "Rotate Secrets" in Vercel → Storage, re-run the production
  deploy (one rotation, then one deploy); the running deployment keeps the old password until then.
- **Server Actions:** always `ownerAction(schema, handler)`; pages call `requireOwner()` (a test enforces it).
  Validate id lists as sets, take `LIFE_AREAS_LOCK`-style advisory locks for ordering, never hard-delete.
- **Focus:** never put `disabled` on a focused control while pending; use `aria-disabled` plus a guard.
  Restore focus explicitly after anything that re-renders or unmounts the focused element.
- **Toasts and overlays** must not cover the focused control (`--toast-offset`, `scroll-padding`).
- **Design system:** synced files (`tokens/`, `components.css`) are never edited; fixes go to
  `overrides.css` with a `PENDING UPSTREAM` note and a line in HANDOFF, then get applied in Claude Design.
- **E2E stability:** wait for hydration markers before keyboard input, serialize tests that mutate shared
  data, and assert something that can fail (negative tests need a positive control).
- **Docs:** after each merge, update `tasks/todo.md` and HANDOFF status lines (no stale "sin merge").
