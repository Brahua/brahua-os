@AGENTS.md

# brahua-os

Personal "second brain" app (single user). Specs drive the work:

- `CAPABILITY-MAP.md` — module index and build order
- `SPEC-<module>.md` — approved spec per module
- `tasks/plan.md`, `tasks/todo.md` — current module plan and tasks (plus "Backlog técnico"); past modules in `tasks/archive/`
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
- While the repo is public (from 2026-10-02 until ~2026-11-01, when Actions minutes reset), the ruleset
  "Protect main" enforces PRs and the 3 checks; after a bot screenshot commit, approve the PR's
  `action_required` run (details in HANDOFF). Back to private, the ruleset stops applying and this holds:
- `main` is unprotected when private (free plan; owner's decision, 2026-10-01): before every merge, check that
  all 3 CI checks are green, and never push directly to `main`.
- Vercel's Git auto-deploy is disabled (`vercel.json`); GitHub Actions is the only deployer. The
  `deploy` job runs `vercel deploy --prod` (remote build on Vercel: `scripts/vercel-build.sh`
  migrates there, because the Neon variables are Sensitive and never reach the runner).
- MVP works directly on production: tests use a throwaway Postgres, never the production DB.
  Migrations are additive; anything destructive needs the owner's OK and a backup first.
- After each deploy, the `smoke` job checks https://os.brahua.com read-only
  (`scripts/smoke-production.sh`); a failure means production is broken.

## E2E while iterating (details in `docs/HANDOFF.md`, "Pruebas E2E")

- No Docker. Test database: native Postgres 18 from `embedded-postgres` (`pnpm db:test:start`,
  `db:test:stop`, `db:test:reset`; port 54329, data in `.pgdata/`). `pnpm test:integration` and
  `pnpm test:e2e` default `TEST_DATABASE_URL` to it locally and start it if it is not running.
- Native, only the specs you touched: `pnpm test:e2e e2e/<spec>.ts`
  (`pnpm test:e2e:changed` runs the specs changed against `origin/main`). Screenshot comparisons
  are skipped outside the Linux Playwright image and annotated in the report; behaviour and axe run.
- CI is the full gate (Postgres 18 service containers).
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

## Lessons from `projects` (retrospective, 2026-10-02)

- **Verify before merging:** read `gh pr view N --json statusCheckRollup` and confirm all 3 checks green on the
  final head *before* `gh pr merge`. A dispatched run (after a bot screenshot commit) counts; a red
  `pull_request` run on the same head must be understood, not ignored.
- **Parallel work needs contracts first:** the task that builds a page leaves named slots and a context
  (`enqueue`, `toaster`, `announce`) for the parallel tasks; each parallel agent gets its own
  `TEST_DB_PORT` and `E2E_PORT` and a merge order. Cross-module features go through registered contracts
  (`registerProgressSource`), never imports in the wrong direction.
- **Advisory locks:** two-key form `(module space, hashtext(key))`, always the first lock of the
  transaction, never taken after a row lock; document the rule next to the lock.
- **E2E after a save:** run `afterSaveSettled(page)` (no `[data-saving]`, `<title>` present, animations
  settled) before axe or screenshots; Next 16 streams metadata and the title can be briefly missing.
- **iPhone is the source of truth for PWA chrome:** status bar, safe areas and native date inputs can't be
  verified in Playwright; ask the owner to check on the device (reinstalling the app after meta changes).
- **Disk hygiene:** delete `.next`, test output and `.pgdata` when an agent finishes, and remove finished
  worktrees; a full disk stalls every agent.
