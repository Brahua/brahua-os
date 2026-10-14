# Tareas: household

> Plan: [`household-plan.md`](household-plan.md) · Spec: [`SPEC-household.md`](../../SPEC-household.md).

Spec: [`SPEC-household.md`](../../SPEC-household.md) (aprobada el 2026-10-14) · Plan: [`household-plan.md`](household-plan.md). Cada tarea termina con el gate local liviano en verde, un PR con los 3 checks verdes y el deploy con smoke. Commits en inglés (`feat(household): …`). Máximo un E2E nuevo en todo el módulo (H3).

- [x] **H1: Cimientos y Limpieza** (S/M, sin tablas; PR #124, ver `docs/HANDOFF.md` → «Cómo funciona household → H1»)
  - Contratos nuevos en `src/modules/tasks/contracts.ts`: `listTasksByTag(tag, now)` y `createTaskWithTags(input)`, reutilizando lo que `tasks` ya tiene (`createTask`, `tag-links.ts`, `completeTask`); sin duplicar lógica.
  - `src/modules/household/`: `module.ts` («Hogar», `navOrder` 67, sin atajo), `routes.ts`, `cleaning-*.ts` puros (frecuencia → recurrencia, zona, agrupar por zona y por día), `components/`, página `/household` con pestañas y slots de Compras y Recetas.
  - Vista «Por zona / Por día», «Hecho» con «Deshacer», «Añadir limpieza» (hoja), «Quitar» (elimina con «Deshacer»); regla de ESLint de fronteras; módulo en `MODULES`.
  - **Aceptación:** una limpieza creada en Hogar sale en Hoy el día que toca; «Hecho» programa la siguiente con `limpieza` y su zona; las 5 frecuencias dan la fecha esperada; sin zona sale en «Sin zona»; ninguna cadena prohibida.
  - **Verificación:** unitarias de lo puro y de los componentes; integración `rtk proxy pnpm test:integration <archivo>` de los contratos (incluida «la siguiente ocurrencia conserva las etiquetas»); gate liviano; tras el push, `update-screenshots.yml` y revisar `e2e/home.spec.ts`. Sin E2E nueva.
  - **Archivos:** ~5 de `tasks` (contratos y su prueba) + el módulo nuevo; dividir en dos PR si pasa de ~5 por área.
- [x] **H2: Compras** (M; PR #125, ver `docs/HANDOFF.md` → «Cómo funciona household → H2») — depende de H1
  - Migración aditiva `household_products` (`CHECK`, único parcial por `name_key`, lock `(7000, hashtext(name_key))` como primer lock), exportación y respaldo; acciones con `ownerAction`: añadir (reutiliza un nombre existente), «Comprado», editar cantidad, «Quitar de la lista», «Olvidar producto», «Terminé la compra» y su «Deshacer» exacto; vista agrupada por categoría con sugerencias y sección «Comprados».
  - **Aceptación:** añadir un nombre existente no duplica; dos añadidos a la vez dejan una fila; «Terminé la compra» pasa lo comprado a guardado y «Deshacer» no pisa un producto cambiado a mano; 320 px sin scroll horizontal.
  - **Verificación:** unitarias (normalización, orden de categorías, sugerencias, copy); integración (`CHECK` con inserts crudos, concurrencia con control positivo, «Deshacer» exacto, autorización, exportación); Prettier sobre el snapshot de Drizzle. Sin E2E nueva.
- [x] **H3: Recetas y E2E** (M; PR #126, ver `docs/HANDOFF.md` → «Cómo funciona household → H3») — depende de H1 (H2 no bloquea)
  - Migración aditiva `household_recipes` (`CHECK` de tipos, días y URL), exportación; acciones de alta, edición y «Quitar» con «Deshacer»; vista con «Para hoy», filtros `?tipo=` y `?dia=`, chips y dominio del enlace.
  - **El único E2E del módulo** `e2e/household.spec.ts`: crear una limpieza y marcarla, añadir un producto con sugerencia y «Terminé la compra», añadir una receta y filtrar; axe en 0 en ambos temas y 320 px con `afterSaveSettled`; una captura con `expectScreenshot`; entrada `["household", "tasks"]` en `SPEC_MODULES` y etiquetas `@today-tasks`.
  - **Aceptación:** «Para hoy» sigue el día de Lima; `javascript:` se rechaza; los filtros viven en la URL.
  - **Verificación:** unitarias e integración como arriba; tras el push, `update-screenshots.yml` (también hace de primera corrida de E2E).
- [x] **H4: Cierre** (S; `feat/household-h4`) — depende de H3
  - `pnpm db:household:import`: solo las **limpiezas** del Notion (decisión del owner), como tareas recurrentes con sus fechas; ids deterministas, una transacción, confirmación por host y palabra, respaldo verificado antes, imprime conteos y nombres (nunca fuera del repo); lo corre el agente solo si el owner lo pide.
  - Retrospectiva en `CLAUDE.md`, backlog, estado en el mapa, HANDOFF («Cómo funciona household»), archivar plan y tareas.

### Checkpoint final
- [x] Recorrido en producción por el agente (Chrome del owner, datos `[QA]` borrados después).
- [x] Se cumplen los criterios de éxito de `SPEC-household.md`.
- [ ] Revisión con el owner de las decisiones autónomas: pendiente de su respuesta al cierre (2026-10-14); están en `docs/HANDOFF.md` → «Cómo funciona household».

Checkpoint en producción (2026-10-14, el agente en el Chrome personal del owner): una limpieza `[QA]` diaria se añadió, salió en «Por zona», «Por día» y en Hoy, «Hecho» creó la siguiente («toca mañana», misma zona) y «Deshacer» la quitó, y «Quitar» la eliminó; un producto `[QA]` se añadió con categoría y cantidad, se marcó, «Terminé la compra» lo guardó, la sugerencia al escribir «[QA] le» lo devolvió a Lácteos con su cantidad («2 L») y «Quitar» y «Olvidar» lo limpiaron; una receta `[QA]` rechazó `javascript:` en su campo, se guardó con `HTTPS://…` (se guarda en minúsculas), salió en «Para hoy · miércoles» con el enlace en otra pestaña y `rel="noopener noreferrer"`, el filtro «Cena» la ocultó y «Quitar» la eliminó. **Hallazgo:** las tarjetas de fila salían apiladas y centradas (la clase `.bo-card` es una columna); se corrigió con `.bo-household-row` en `extensions.css` (H4). Pendiente del owner: el iPhone y revisar las decisiones autónomas.

