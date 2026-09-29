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
