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
- Before committing (**light local gate**, owner's decision 2026-10-07): `prettier --check`, `eslint` and
  `pnpm typecheck`, plus only the unit tests you touched (`rtk proxy pnpm vitest run --maxWorkers=2 <files>`).
  Build, the full unit suite, integration, E2E, axe and screenshots are validated by **CI only**: do not run
  them locally (they pushed the owner's Mac to a load of 250). Exceptions: reproducing one failing CI spec,
  or a build when you touch `next.config`, `package.json` or other build configuration. Run one implementer
  at a time unless the owner asks for more.
- **E2E budget (CI plan, step 4, 2026-10-12):** each cut (module or slice) adds **at most one new E2E spec**;
  the rest of the coverage is unit, component or integration. The E2E job has a budget of ~12 min:
  `scripts/e2e-timing-summary.mjs` emits a `::warning::` when the Playwright run goes over it (it never fails the
  job). A new spec also needs its entry in `SPEC_MODULES` (`scripts/e2e-affected.mjs`), which decides which specs
  a PR runs; a unit test fails without it.
- GitHub: personal account `Brahua` only (`gh auth switch -u Brahua` if `jbrahua` is active).

## Workflow (trunk-based)

- One short-lived branch per change: `feat/…`, `fix/…`, `chore/…`, `docs/…`. Open a PR against `main`.
- PRs run only the CI work their change can affect (`changes` job, `scripts/e2e-affected.mjs`): docs-only PRs skip E2E
  and integration, code PRs run the E2E specs their modules reach, shared code runs everything; `main` always runs
  everything (details in `docs/HANDOFF.md`, "CI: qué corre en cada PR"). A job skipped on purpose (E2E or
  integration on a docs-only PR) counts as a passed check; "Detect changes" must be green too.
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
- Native E2E is for debugging a failure CI reported, one spec at a time (`--workers=2`): `pnpm test:e2e e2e/<spec>.ts`
  (`pnpm test:e2e:changed` runs the specs changed against `origin/main`). Screenshot comparisons
  are skipped outside the Linux Playwright image and annotated in the report; behaviour and axe run.
- CI is the full gate (Postgres 18 service containers): build, unit, integration, E2E, axe and screenshots.
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

## Lessons from `tasks` (retrospective, 2026-10-02)

- **Anchor ignore patterns:** `.vercelignore` and similar files match at any depth; write `/tasks/`, never
  `tasks/` (it dropped `src/modules/tasks/` from the deploy). Check with `vercel deploy --dry` when you edit it.
- **CI minutes are finite:** agents push once, with the local gate green, and don't re-run CI to "check";
  docs-only changes and screenshot runs cost the same full pipeline. When Actions stops starting jobs, don't
  merge without CI: verify locally and deploy a commit that already passed CI by hand.
- **Timers in components:** every `setTimeout` that sets state is cleared on unmount; for live-region
  messages use core's `useAnnouncer()`. An uncleared timer fails the unit job ("window is not defined").
- **Optimistic rollback in tests:** the failure notice can render before `useOptimistic` rolls back; assert
  the rolled-back state inside `waitFor`, never right after waiting for the notice (it flaked three tests).
- **Exhaustive tests:** loops with thousands of cases collect mismatches and assert once (with an explicit
  timeout); an `expect` per case timed out on CI runners.
- **Checkpoint in production:** with the owner signed in to their own Chrome, the agent can run the
  checkpoint walkthrough with Claude in Chrome (prefix data with `[QA]`, delete it after, restore theme,
  window size and sidebar). Use element refs, not coordinates, and wait after scrolling: clicks during a
  smooth scroll or before hydration are lost. Never type with no field focused (keys hit app shortcuts).

## Lessons from `habits` (retrospective, 2026-10-02)

- **Check the GitHub identity, not the status line:** `gh auth status` can say "Brahua" while the token is
  `jbrahua`. Before merges or admin calls run `gh api user -q .login`; fix with
  `env -u GH_TOKEN gh auth switch -h github.com -u Brahua`.
- **Ruleset and bot commits:** after `update-screenshots.yml`, the PR's own run stays at `action_required`;
  approve it while waiting, or `gh run rerun <id>` once it has completed. Only that run satisfies the ruleset.
- **Parallel slices:** the second agent finishes locally and waits for the first PR to merge before it
  rebases and pushes once; the first agent leaves rebase notes (renamed exports, new fields) in its report.
- **Agents stall when the laptop sleeps:** they keep their worktree; resume them with `SendMessage` and
  record in-flight work (worktree, branch, next step) before the owner closes the laptop.
- **Disk:** remove finished worktrees right after merging; several agents with `.next` and `.pgdata` fill it.
- **Shortcuts registered in effects:** a key handler for something that appears after a Server Action must
  be registered in `useLayoutEffect` (or earlier); with `useEffect` a fast key press is lost (it was the
  real cause of the `areas-order` flake, #65).

## Lessons from `today` (retrospective, 2026-10-05)

- **Slots stay mounted:** a board slot renders its content whenever the slot exists; the section decides
  whether it shows. Unmounting on a server count of 0 killed the optimistic "Deshacer" of the last row (D2).
- **Aggregating screens share data in E2E:** `/` shows every module's rows, so tests that create or complete
  tasks due by today carry `@today-tasks` (enforced by the insert helpers and a lint test) and board tests use
  `boardTest`. Any new module that adds a section to `/` needs the same.
- **Review before push:** reviewing a parallel slice's local commit while it waits for the rebase saves a CI
  round; one push per agent still holds.
- **Never attribute decisions to the owner:** an autonomous choice is "decisión autónoma para revisar con el
  owner" until the owner says otherwise, in docs and in messages to agents.
- **Production data scripts:** deterministic ids, one transaction, host + word confirmation, a verified backup
  first. The agent may run them with `neonctl connection-string` in a shell variable (never printed) when
  the owner asks; the Neon CLI lives under Node 20, so resolve the URL before `nvm use`.

## Lessons from `finance` (retrospective, 2026-10-06)

- **Schedules and edits:** anything with due dates must define what an edit, a reactivation or a start-date
  change does to periods already settled; reviewers found three ways to re-open a paid period (F2). Test each.
- **Undo targets the exact row:** an undo carries the id it created (`expenseId`), never just the period or
  slot; toasts don't expire, and a stale "Deshacer" removed a newer payment.
- **Screenshots cost a CI round:** when a push adds or changes a visual, dispatch `update-screenshots.yml`
  right after pushing instead of waiting for the PR run to fail on the comparison.
- **Merge whatever is green first:** if the second parallel slice is ready before the first, merge it and tell
  the one in flight to rebase before its single push (docs conflicts only) instead of idling.
- **Real data stays out of the repo:** files with the owner's data live in the session scratchpad (never in
  the public repo) and are deleted after use; import scripts print counts and names, never amounts.
- **Tooling quirks:** `neonctl connection-string` needs `--role-name neondb_owner` (two roles exist); RTK
  rewrites `pnpm` and rejects `-s`, so run scripts with `rtk proxy pnpm …`.
- **Disk before parallel agents:** check `df -h`; the disk hit 100 % with three worktrees. Remove each worktree
  as soon as its PR merges.

## Lessons from `polish` (retrospective, 2026-10-07)

- **Heavy checks belong to CI:** the full unit suite (129 jsdom environments), the build, integration with
  Postgres and E2E with Chromium run in CI. Locally they saturate the machine; see the light local gate in
  "Rules". After the repo goes private again (~2026-11-01) CI minutes are finite: keep `--only-changed` E2E on
  PRs and `paths-ignore` for docs-only PRs in the backlog.
- **Format generated files:** `prettier --check .` also covers `drizzle/meta/*_snapshot.json`; run Prettier on
  the snapshot right after `pnpm db:generate` (CI rejected an unformatted one).
- **Rebase on a merged sibling:** two PRs that edit the same HANDOFF status line conflict after the first
  merges; the second implementer (or the orchestrator) rebases, resolves docs, pushes once and re-dispatches
  `update-screenshots.yml` (the references change when another PR touched the same screens).
- **Midnight in Lima breaks date tests:** a run that crosses 00:00 Lima fails any spec that expects "Vence
  hoy" (seen in `e2e/projects.spec.ts` on the `main` run of 2026-10-07 00:01). Re-run before debugging; fix the
  spec with a fixed clock if it repeats.
- **GitHub outages:** when githubstatus.com reports Git Operations, Pull Requests or Actions down, agents keep
  working locally, commit, try one push and one `gh pr create`, and stop with the branch and SHA; no retry
  loops and no `--force`. A merge that returns 5xx through `gh pr merge` can be retried through the REST API
  (`gh api -X PUT repos/Brahua/brahua-os/pulls/<n>/merge -f merge_method=squash -f sha=<head>`); it does not
  delete the branch.
- **Confirm the merge before cleaning up:** do not remove a worktree or branch until `gh api
  repos/Brahua/brahua-os/pulls/<n> -q .merged` says `true`.

## Lessons from `reminders` (retrospective, 2026-10-09)

- **Deploy gates are written per result:** `!cancelled()` did not see a `needs` job that hit its timeout
  (`cancelled`), so three timed-out E2E runs deployed on 2026-10-08. Plain `success()` then failed the other way: it
  also looks at ancestors, and the skipped `guard` job on `push` blocked the first deploy after the fix (#97,
  #99). The gate spells out `needs.<job>.result == 'success'` for each job and does not use `success()`; test a
  gate change with a real push to `main`, not only a read of the YAML.
- **E2E time is a budget:** the E2E job (14–19 min) hit its 20-min timeout; the cut was 30 min of cushion plus
  `mobile` running only tests tagged `@responsive` (103 tests against 376 on `desktop`; a lint enforces the tag). Each slice adds at
  most one E2E spec (R4 one, R3 none); everything else is unit, component or integration. A new screenshot
  costs a CI round.
- **Security-review every slice that takes untrusted input or secrets:** the webhook and push reviews found
  what tests had not: attempt limits that could lock the owner's own link code (limits count per chat and never
  touch codes), a poison message that made Telegram retry a 500 forever (permanent errors, SQLSTATE class 22/23,
  close the `update_id` with 200), and push `endpoint`s the server would POST to (allowlist where it is written,
  not where it is sent). Order for any public route: secret, size, JSON, relevance, and only then write.
- **One claim per reminder and channel:** the engine claims `(dedupe_key, channel)` with `INSERT … ON CONFLICT
  DO NOTHING` before building or sending. Test two ticks at once with a positive control (two different keys
  send two). Never claim a key on behalf of another: R4 grouped habits at the same time under one message and the
  review turned it into one key per habit. A key without the time also means editing the time does not notify
  again that day: say it in the rule.
- **Ambiguous failures are not retried:** a timeout or network error may have delivered the message, and a double
  reminder is worse than a lost one. Classify every failure as clear (the service answered with an error:
  retry up to 3) or ambiguous (`*_network`, `send_threw`: `failed`, no retry), and test both. A 403 disconnects
  only the chat that is still linked; a 401/403 from the push service revokes the device and falls back.
- **Bot capture rules:** claim the `update_id`, create the entity and write the capture row in one transaction
  and reply after the commit, once, without retry. "Deshacer" carries the id of the capture row (never the
  entity), deletes in a single `UPDATE` that checks nobody touched it, and expires after 24 h. Text that does not
  fit is rejected and said, never cut; any unknown `/command` answers and is never saved as a task.
- **Day-bound reminders do not cross midnight:** the 2-hour grace window can span 00:00, so each kind states
  whether it may still fire for yesterday (briefing and evening review: no; payment eve and habit time: yes).
  Define it per kind and test 23:59 and 00:30.
- **Provisioning secrets without seeing them:** the owner generates and stores them in their own terminal
  (`openssl rand … | vercel env add … --sensitive`, `gh secret set`); Sensitive Vercel variables cannot be read
  back, so a secret needed for manual checks (the tick) lives in the owner's password manager. The VAPID script
  refuses to print without a terminal on stdin and stdout; env validation names variables, never values, and
  checks that the keys are a pair. Vercel Cron only sends `GET` with `CRON_SECRET`, so the endpoint accepts it too.
- **Write the setup guide from the code:** checking `env.ts`, the workflows and the screen copy against the spec
  found six drifts (a button label, a webhook registered only while unlinked, a token error that is not a 403).
  A guide that comes from memory is wrong somewhere; verify every variable name, command and label.
- **Do not add code to satisfy jsdom:** R4's first Enter-in-name fix compensated for jsdom's implicit submit; the
  E2E showed Chromium already submitted, and the extra handler went. Decide behaviour in the real browser.

## Lessons from `goals` (retrospective, 2026-10-13)

- **Integration tests are worth running one file at a time:** G2 shipped three bugs only CI caught (a fixture whose
  habit started after the logs it counted, a read that lost a race and reported "active", an ESLint rule that blocked
  the FK import). Run the integration file you wrote (`rtk proxy pnpm test:integration <file>`), stop the test DB and
  delete `.pgdata` afterwards; that is the "reproduce one failing CI spec" exception made routine for new files.
- **`ON DELETE RESTRICT` is SQLSTATE `23001`, not `23503`:** a foreign key that does not exist is `23503`; deleting a
  referenced row under RESTRICT is `23001`. Assert both, each with its own code.
- **A read that loses a race reports what is stored:** when achieving on read (`UPDATE … WHERE status = 'active'`),
  the loser matches no row and must re-read the row instead of returning its stale in-memory status.
- **Composition roots are mocked in page tests:** a page that calls `ensureXExtensions()` pulls the module (and the
  DB) into its unit test. Mock `@/lib/<x>-extensions` where `@/lib/project-extensions` is already mocked.
- **Adding a navigation item touches other specs:** `e2e/home.spec.ts` counts links and uses the free shortcut number;
  every screenshot with the sidebar changes, so dispatch `update-screenshots.yml` right after the push.
- **Module boundaries need a one-file exception for FKs:** a schema file must import the other module's table. The
  ESLint block for `goals/db/schema.ts` leaves the habits/projects pattern out (a `!` negation cannot reopen a file
  inside a closed folder).
- **Exact undo carries what it applied:** moves of period, the weekly objective and entries each carry the previous
  value and what they left, and write only if the row still holds it (otherwise "cambió mientras tanto").
- **Chrome checkpoint quirks:** a click right after `navigate` can precede hydration, and a click while the page
  scrolls is lost; use element refs, wait, and re-click. A confirm button that renders after the first click needs its
  own lookup.

## Lessons from `weekly-review` (retrospective, 2026-10-14)

- **A checkpoint that closes something can't be undone:** the review has no delete in v1, so the walkthrough in
  production closed an old week (never a real one) and the leftover row is in the backlog. Before a checkpoint, list
  which actions leave a permanent row and choose the cheapest target.
- **A consumer needs no registry when it has one consumer:** the invitation card is composed by `src/lib/review-extensions.tsx`
  and awaited by the two pages; a `registerHomeBanner` contract would have been a new surface for a single use. ESLint
  still forbids `today` and `goals` from importing `weekly-review`.
- **Time windows get a test clock:** a card that only exists on Sunday evening would flake any E2E run on that day, so a
  build-time cookie (`bo_e2e_invite`) fixes the clock, like `bo_e2e_evening`. Decide the clock before writing the feature.
- **Intermittent focus tests are fixed, not retried:** three reminders focus assertions failed in CI after awaited
  actions; wrapping the post-async ones in `await waitFor(...)` is the fix. Synchronous ones stay as they are.
- **The screenshots workflow doubles as the first E2E run:** `update-screenshots.yml` runs every spec, so a green run
  on a new spec is the best sign before the PR's own run (it was for W3). It still needs the `action_required` approval.
- **Clicks right after `navigate` or while the page scrolls are lost:** the Chrome walkthrough had to retype a note once;
  check the field has the text before submitting.

## Lessons from `household` (retrospective, 2026-10-14)

- **A tag is the only link that survives a recurrence:** completing a recurring task creates the next one as another
  row, so a view over "the cleaning" cannot hold task ids; it filters by tag (`limpieza` + `zona: …`). The first
  integration test of a module that sits on another module's rows is the one that proves the link survives the
  other module's write path (here: complete, and the next occurrence keeps both tags).
- **A `CHECK` cannot hold a subquery:** "no repeated elements" of an array column lives in Zod; the table bounds the
  allowed set and the size. Generate the migration, then apply it in an integration run before trusting it.
- **Zod and the `CHECK` must accept exactly the same texts:** a case-insensitive regex in Zod against a case-sensitive
  one in the table turned `HTTPS://…` into a generic 500 on the wrong field. Normalize what is stored (scheme in
  lowercase) and reject control characters (NUL) in the same function the schema and the render path use.
- **An optional field that is missing is not "none":** reusing a known row (add by name) keeps what it had unless the
  input says otherwise; `preprocess` that turns `undefined` into `null` silently erased quantities. Test the
  "missing" and the "empty" cases apart.
- **Optimistic overrides settle with what the server answered:** after a successful action the screen shows the
  returned row (never the snapshot from before: an old "Deshacer" can run later), drops an override when the server
  shows the same thing or its save is over, and reconciles by the returned id when the server made a new row.
- **Focus when a row leaves:** hand it to the neighbor's key in the same list (remember which section the key was
  pressed in when a row shows twice), and when the server's props drop the row afterwards, put it back on the same
  record's key or the add key. A `key` that changes with the value remounts the input and loses focus: sync the field
  while rendering instead.
- **Eslint `react-hooks/set-state-in-effect` is a rule here:** reset state on a prop change while rendering, not in an
  effect.
- **Component tests need the real Lima day:** a screen that refuses to act when its day has passed ignores clicks
  under a fixed fake date. Compute the day in the test.
- **Drizzle prints single-table columns without the table:** a raw subquery that mentions `${tasks.id}` reads the
  inner table's `id`. Qualify it by hand (`"tasks"."id"`). The first real run of a new E2E is `update-screenshots.yml`:
  one failing case there was a helper bug, reproduced locally with that one spec and fixed in a second push.
- **Row cards are columns:** `.bo-card` is `flex-direction: column` and wins over utility classes, so a row layout
  needs its own class (`.bo-card.bo-household-row` in `extensions.css`). Only the real browser showed it (the unit
  tests and the E2E passed with the broken layout): look at the first deploy of any new screen before closing.
- **Clicks and typing right after `navigate` are lost in production too:** wait, check the field holds the text
  before sending, and re-click once. A form filled with the `form_input` tool on a select still reaches React state.
- **Lima midnight again:** the PR's E2E failed on `projects`, `task-views` and `today-projects` when the run crossed
  05:00 UTC; the rerun after midnight was green. Rerun first, debug after.
- **Shell habits:** `sed -i` on macOS needs `''`; a bare `cat > file` waits on stdin and hangs; kill it.

## Lessons from `finance-email` (E1–E3, 2026-10-14)

- **Entrada pública con secreto:** el secreto se comprueba antes de leer el cuerpo y todo lo demás (método, secreto, servidor sin configurar) responde 404 sin cuerpo; luego tamaño, JSON, forma, relevancia (remitente **y** asunto exactos) y recién escribir. Los límites de lote y de cuerpo se calculan juntos (20 × 8 KB no cabía en 64 KB). El servidor repite las reglas que la interfaz oculta (sin «Registrar» de un toque para un remitente no verificado).
- **Una fila venenosa no frena el lote:** los errores permanentes de una fila (SQLSTATE 22/23) se omiten y se cuentan; solo los transitorios dan 500 para que el script reintente. Rechazar NUL y fechas fuera de rango en la puerta.
- **El `From` no es el remitente:** tomar la última dirección `<…>` anclada al final; un nombre visible con la dirección del banco no pasa.
- **Drizzle y los subqueries:** columnas de una sola tabla se imprimen sin tabla, así que `exists (select … where ${a.col} = ${b.col})` compara la columna consigo misma. Calificar a mano; la prueba necesita casos que **no** coincidan además del que sí.
- **Helpers de E2E con `truncate`:** una FK nueva hacia `finance_expenses` rompió `clearFinance` en todas las specs de Finanzas; revisar `e2e/support/*` al añadir tablas.
- **Estados terminales y CHECKs:** decidir qué campos puede no tener cada estado, incluido «descartada» de algo que nunca se leyó.
- **Gmail agrupa por asunto:** nada de etiquetar hilos para saber qué se envió; marca de tiempo con solapamiento y servidor idempotente.
- **Artefactos fuera de la app se vigilan con una prueba:** el script de Google vive en otra cuenta; una prueba fija sus límites, remitentes y la forma de la petición contra el código.
- **El texto plano de un correo HTML no es el que viste:** `getPlainBody` aplana las tablas a su manera (el BCP es solo HTML). Los lectores se apoyan en la frase de arriba y en etiquetas con cualquier separador, y se prueban en varias formas de aplanado; el primer correo real de cada banco es parte del Checkpoint, no de la spec.
- **El texto plano de Gmail marca la negrita con asteriscos** (`*PARAMOUNT+*`): se recortan solo los extremos de cada valor (un `*` interno, como `DLC*help`, se queda). Ver el primer correo real de cada formato antes de dar por buenas las fixtures.


## Lessons from `finance-motion` (retrospective, 2026-10-15)

- **Moving a block between hidden panels breaks every spec that reads it:** hidden panels are out of the
  accessibility tree, so `getByRole` finds nothing. Before restructuring tabs, grep `e2e/` and the component
  tests for the rows, lists and headings that move (`expenseRow`, `payKey`, list names) and give the specs a
  helper that opens the right tab (`openPayments`, `openRecurring`, `openExpenses`).
- **Count the width of a segmented control at 320 px:** four tabs gave 411 px of scroll width on every
  finance page and failed five @responsive specs. Check each control's width with its longest labels.
- **Exit animations need `waitFor` in tests:** with `AnimatePresence` a row or chip stays in the DOM until its
  exit ends; assert its absence inside `waitFor`. An unresolved `deferred()` in a failing test also keeps the
  following tests' transitions pending: resolve it before any assertion that can throw.
- **Stacked branches after a squash merge:** `git rebase --onto origin/main <old base> <branch>` for each
  branch in order; a plain rebase replays the already-merged commits and conflicts on the files both appended
  to (`extensions.css`).
- **A new E2E spec's first run is `update-screenshots.yml`:** it also regenerates the references that the
  restructure changed; approve the `action_required` run afterwards. Two failed CI rounds came from specs I
  did not update (rows read from the wrong tab): grep every spec that touches the screen before the first push.
- **CSS-only entry and draw:** anything that must be visible in the server HTML (cascade, the chart's line)
  is CSS; Motion is for changes after hydration (`AnimatePresence initial={false}`).
- **A color per category is data, not index:** the accent lives in `color_slot` (backfilled by order,
  first free slot on create); drawing by list position changed the color of a category whenever the order did.
- **Measure the JS with two builds:** CI prints no size. Build the commit before the module and the one
  after, and sum the gzip of the chunks listed in `.next/server/app/(app)/finance/page_client-reference-manifest.js`
  (+42.2 kB gz against a goal of 25: set the goal with the first slice, not at the end).
- **A Chrome tab driven by the agent can be hidden:** `document.visibilityState` was `hidden`, so
  `requestAnimationFrame` and CSS animations stood still (rows stuck mid-fold, sheets that never finished
  closing). Check it first; motion needs the owner's eyes (iPhone), the data checks do not.
