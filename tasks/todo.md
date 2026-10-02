# Tareas: projects

> Plan: [`tasks/plan.md`](plan.md) · Spec: [`SPEC-projects.md`](../SPEC-projects.md)
> Cada tarea termina con lint, typecheck, unitarias, integración y build en verde, E2E nativa de lo tocado, un PR con CI verde y el merge (publica en producción). Commits en inglés (`feat(projects): …`).
> Tareas anteriores en [`archive/`](archive/).

## Fase 1 — Base

- [x] **P1: Datos, lista y crear**
  - **Qué:**
    - Esquema `src/modules/projects/db/schema.ts` con `projects`, `project_milestones`, `project_links` y `project_dependencies`, sus `CHECK`, índices y una migración aditiva.
    - `projectsModule` disponible (Proyectos, `/projects`, atajo 2, `navOrder` 20).
    - `/projects`: grupos por estado (Activo, Mantenimiento, Pausado, Idea) y "Historial" plegado (Terminado, Cancelado); orden por prioridad, fecha límite y nombre; filtro por área en la URL; estado vacío. `ProjectCard` con área, prioridad alta, vencimiento.
    - Crear en un Sheet (nombre, área activa, estado) con `ownerAction`; lleva al detalle (P2 lo construye; mientras tanto, una página mínima).
    - Tablas registradas en `pnpm db:export`.
  - **Aceptación:** crear en el celular en < 10 s; la lista agrupa, ordena y filtra; acciones rechazadas sin sesión; `CHECK` probados; axe en 0 en ambos temas.
  - **Tamaño:** M
  - **Estado:** integrado (PR #33). Cómo funciona y decisiones: `docs/HANDOFF.md`, "Cómo funciona projects". El vencimiento ("Vence hoy / en N días / vencido hace N días") ya está en `progress.ts` y en las tarjetas; P2 lo reutiliza en el detalle.

### Checkpoint P1
- [ ] El owner crea proyectos desde el celular y ve la lista agrupada.
- [x] Ajuste pedido por el owner: el filtro por área pasa de chips a un selector compacto "Área: …" con hoja (PR `fix/projects-area-filter`).

## Fase 2 — Detalle

- [x] **P2: Detalle y edición** (PR #36, integrado)
  - **Qué:** `/projects/[id]` (P1 dejó una versión mínima con su 404) con nombre, área, estado, prioridad, objetivo y fechas editables en el lugar (UI optimista); `completed_at` al pasar a Terminado; vencimiento visible ("Vence hoy / en N días / vencido hace N días", Lima) en `progress.ts`; Eliminar (borrado lógico) con "Deshacer". El detalle queda armado por secciones para P3–P5.
  - **Aceptación:** criterios 1, 5 y 7 (eliminar) de la spec; pruebas de vencimiento alrededor de la medianoche de Lima.
  - **Tamaño:** M
  - **Estado:** integrado (PR #36). Cómo funciona, decisiones y los puntos de inserción de P3–P5: `docs/HANDOFF.md`, "Cómo funciona projects" → "Detalle y edición (P2)".

- [x] **P3: Hitos y avance** (PR #40, integrado)
  - **Qué:** agregar en línea, editar título y fecha, marcar, eliminar con "Deshacer"; reordenar arrastrando (`@dnd-kit`, patrón de C6) y con Subir/Bajar, en transacción con lock por proyecto; avance hechos/total en la tarjeta y el detalle (sin hitos o en Mantenimiento, sin avance).
  - **Aceptación:** criterio 3 de la spec; E2E con teclado y arrastre; movimiento reducido.
  - **Tamaño:** M
  - **Estado:** integrado (PR #40). Cómo funciona y decisiones: `docs/HANDOFF.md`, "Cómo funciona projects" → "Hitos y avance (P3)".

- [x] **P4: Dependencias** (PR #38, integrado)
  - **Qué:** "Bloqueado por" con buscador (excluye el propio, eliminados y los que crearían un ciclo); quitar; insignia "Bloqueado" en la tarjeta y el detalle mientras un bloqueador no esté terminado o cancelado; rechazo de ciclos directos e indirectos en la base.
  - **Aceptación:** criterio 4 de la spec; integración con ciclos y concurrencia.
  - **Tamaño:** S/M

- [x] **P5: Notas en Markdown y enlaces** (PR #41, integrado)
  - **Qué:** `src/lib/markdown/` con `react-markdown` + `remark-gfm` + `rehype-sanitize` (reutilizable); notas con "Escribir" / "Vista previa", guardado explícito y aviso de cambios sin guardar; enlaces `http(s)` con etiqueta: agregar, editar, reordenar, quitar.
  - **Aceptación:** criterio 6 de la spec; pruebas de saneado (`<script>`, `javascript:`, HTML crudo).
  - **Tamaño:** M
  - **Estado:** integrado (PR #41). Cómo funciona y decisiones: `docs/HANDOFF.md`, "Notas y enlaces (P5)".

## Fase 3 — Contratos

- [x] **P6: Contratos con otros módulos** (PR #42, integrado)
  - **Qué:** `registerProgressSource()` en `progress.ts` (lo usará `tasks`); `getProjectsTodaySummary()` (vencen en ≤ 7 días, vencidos, bloqueados) para `today`; documentarlos en la spec.
  - **Aceptación:** pruebas unitarias del contrato con una fuente de avance falsa.
  - **Tamaño:** S
  - **Estado:** integrado (PR #42), en `contracts.ts` (no en `progress.ts`, que es de P3). Cómo funciona y decisiones: `docs/HANDOFF.md`, "Cómo funciona projects" → "Contratos (P6)".

### Checkpoint final
- [ ] Recorrido completo en celular y escritorio: crear, detalle, hitos, dependencias, notas, eliminar y deshacer.
- [ ] Se cumplen los criterios de éxito de `SPEC-projects.md`.
- [ ] Revisión contigo antes del siguiente módulo (`tasks`).

## Backlog técnico

Deuda y tareas técnicas que cruzan módulos. Se toman cuando haya espacio entre módulos o cuando algo las vuelva urgentes.

- [ ] **LCP con datos reales:** medir el LCP con datos reales (Vercel Speed Insights o Lighthouse con *throttling* real de DevTools) en vez del Lighthouse simulado. Si supera 2,5 s, autoalojar las fuentes recortadas (prototipo: ~0,15 s). Ver "Rendimiento de `/login` (LCP)" en `docs/HANDOFF.md` (cómo medir, hallazgos y siguientes palancas). Origen: criterio de Calidad de `SPEC-core.md`, aceptado por el owner el 2026-10-01.
- [x] **Postgres de pruebas en 18:** CI (`ci.yml`, `update-screenshots.yml` y `backup.yml` con `target=ci-service`) usa `postgres:18.6` fijado por digest, y en local Docker se reemplazó por Postgres 18 nativo (`embedded-postgres`, `pnpm db:test:start`; ver "Pruebas E2E" en `docs/HANDOFF.md`). Hecho en `chore/no-docker-test-db`.
- [ ] **Observabilidad de errores de cliente** (de C8): un error de un componente cliente no tiene `digest` ni llega al registro del servidor; hoy la página no muestra código y nadie se entera. Definir cómo reportarlos (p. ej. un endpoint propio que registre una línea sin el mensaje).
- [ ] **E2E inestable** (de C8): estabilizar la E2E de C6 `e2e/areas-order.spec.ts:329` (⌘Z deshace, escritorio): falló una vez en CI y pasó al reintentar.
