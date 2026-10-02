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
- [x] Recorrido completo en celular y escritorio: crear, detalle, hitos, dependencias, notas, eliminar y deshacer (owner, 2026-10-02).
- [x] Ajustes del recorrido del owner (PRs #45 y #46, integrados): barra de estado del iPhone (`black-translucent` y franja oscura en todas las páginas), tarjeta del Historial que se salía de la pantalla, subtítulo de la hoja como texto, "Cerrar proyecto" (terminar o cancelar con confirmación, y reabrir) y LED en cada prioridad. **Pendiente del owner:** verificar la barra de estado en el iPhone (no se puede probar en Playwright). Ver `docs/HANDOFF.md`, "Ajustes del Checkpoint final".
- [x] Se cumplen los criterios de éxito de `SPEC-projects.md`.
- [x] Revisión contigo antes del siguiente módulo (`tasks`). Módulo `projects` cerrado por el owner el 2026-10-02.

> El backlog técnico sigue en `tasks/todo.md`.
