# Traspaso entre sesiones

> Punto de entrada para retomar el trabajo en una sesión nueva. Se actualiza al cerrar cada tarea o sesión.
> Última actualización: 2026-09-30.

## Cómo retomar

1. Leer este archivo, `CLAUDE.md`, `tasks/todo.md` y la spec del módulo en curso (`SPEC-core.md`).
2. Verificar la cuenta de GitHub: `gh auth switch -u Brahua` (el `GH_TOKEN` de `~/.zshrc` no ve el repo; usar `gh api` REST si GraphQL falla).
3. Seguir el flujo autónomo acordado (ver memoria `modo-autonomo`):
   - Implementador (subagente, worktree) → PR.
   - Revisores en paralelo: `code-reviewer`, `test-engineer` y `security-auditor` si toca auth, datos o secretos; accesibilidad si toca UI.
   - Correcciones → CI verde → merge → deploy automático.
   - Parar y reportar al usuario **al final de cada módulo**.

## Estado

- **design-system:** ✅ completado. Fuente de verdad en Claude Design (skill `design-sync-pull`).
  - Pendiente del usuario: aplicar en Claude Design los 2 ajustes de `src/design-system/styles/overrides.css` (foco en claro y texto blanco en teclas naranjas); luego sincronizar y borrar esos overrides.
- **core:** en curso.
  - ✅ C0: producción en https://os.brahua.com; deploy desde GitHub Actions solo con todos los checks en verde.
  - ✅ C1 (base de datos): PR #10 integrado; la primera migración (`core_life_areas`) se aplicó en producción el 2026-09-30.
  - **Próximo paso inmediato:** sembrar las 8 áreas en producción. Propuesta: que `scripts/vercel-build` ejecute `pnpm db:seed` (idempotente) después de `db:migrate` en los builds de producción, en vez de un seed manual con credenciales. Va en un PR pequeño o al inicio de C2.
  - Siguiente: C2 (login). `OWNER_EMAIL=josuebh62@gmail.com`; el usuario ejecuta `pnpm auth:owner` en su terminal (los secretos nunca pasan por la sesión).

## Decisiones recientes a respetar

- Driver: `pg` + Drizzle + `attachDatabasePool` (ADR-002). Migraciones con `DATABASE_URL_UNPOOLED`.
- Base Neon con variables **solo en Production**. Las pruebas usan Postgres desechable (Docker en local, servicio en CI), nunca producción.
- Secretos: `gh secret set` desde el `!` de la sesión los guarda vacíos; el usuario debe usar una terminal normal.
- Diseño de pantallas nuevas: los hago yo con el design system, tomando como referencia las pantallas del proyecto de Claude Design; el usuario revisa en los checkpoints.
- Workflows multiagente: no usarlos en `core`. Proponerlos con un costo estimado para las specs en lote o para módulos paralelos.
