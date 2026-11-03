# Plan de implementación: notes

> Spec: [`SPEC-notes.md`](../SPEC-notes.md) (APROBADA v1.0, 2026-11-03) · Tareas: [`todo.md`](todo.md) → «Módulo `notes`»
> Planes anteriores en [`archive/`](archive/).

## Enfoque

El de `learning`: rebanadas verticales, **un implementador a la vez** (gate local liviano; los archivos de integración nuevos se corren de a uno), rama corta → PR a `main` → CI verde verificado antes de cada merge → deploy y smoke. Cada agente hace push **una vez**. Trabajo autónomo hasta el **Checkpoint final** (el owner lo pidió el 2026-11-03); decisiones no cubiertas: la opción conservadora, anotada en HANDOFF como «decisión autónoma para revisar con el owner». **Presupuesto E2E:** un solo spec nuevo en todo el módulo (`notes.spec.ts`, en N4), con su entrada `["notes", "today", "projects", "tasks"]` en `SPEC_MODULES` y las etiquetas `@today-tasks` si crea o completa tareas que se ven en Hoy.

## Orden y dependencias

```
N1 Notas y editor ─> N2 Enlaces ─> N3 Línea → tarea, captura y pie ─> N4 Búsqueda y E2E ─> N5 Cierre
```

- **N1** crea el módulo: migración aditiva de `notes` (`CHECK` por tipo, único parcial del día, FK a `life_areas`), `NOTES_ADVISORY_SPACE = 9000`, manifiesto «Notas» (`navOrder` 69, sin atajo de número, bajo «Más» en el celular), `/notes` (lista con filtro y «Ver más»), `/notes/[key]` (día `YYYY-MM-DD` o uuid), vista renderizada con «Editar», guardado automático con cola y versión (conflicto «Cambió en otro dispositivo» con borrador), eliminar con «Deshacer», fijar y área, «Nota de hoy» en Hoy (vía `src/lib`) y la tecla `N` en `core`, exportación y regla de ESLint. Deja en la nota los huecos «Enlazada desde» (N2) y «Ese día» (N3).
- **N2** enlaces: plugin `[[type:id|Nombre]]` en `src/lib/markdown/` (renderiza con un mapa de resueltos; sin mapa, el nombre guardado), `NoteLinkSource` en `notes/contracts.ts` y la raíz `src/lib/note-link-sources.ts` con las seis fuentes (cada módulo su `note-link-source.ts`), el selector combobox debajo del `textarea`, «Enlazada desde» y `<NoteMentions>` (`src/lib/note-extensions.tsx`) al final de las cinco páginas de detalle.
- **N3** línea → tarea (`createInboxTask`/`undoInboxTask` de `tasks` dentro de la transacción de la nota), la casilla viva de `[[task:…]]` con las acciones de completar y deshacer de `tasks`, el proveedor «Nota» de la captura rápida (añadir línea con hora bajo el lock del día, «Deshacer» por versión) y el pie «Ese día» (`countTasksCompletedOn`, `countHabitsDoneOn`).
- **N4** migración de búsqueda (`unaccent`, configuración `notes_spanish`, columna generada y GIN), `search.ts` (consulta saneada con prefijos, `ts_rank`, `ts_headline` con marcadores propios), buscador en `/notes` con `?q=` y el único E2E.
- **N5** Checkpoint en producción, retrospectiva en `CLAUDE.md`, backlog, mapa, HANDOFF («Cómo funciona notes»), archivo del plan y las tareas.

Todos son secuenciales: N2 escribe sobre el editor de N1, N3 sobre la vista y los enlaces de N2, y el E2E de N4 recorre todo.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Dos notas del mismo día (dos pestañas, captura y editor a la vez) | Único parcial `(day) WHERE kind='daily' AND deleted_at IS NULL` y *upsert* bajo `(9000, hashtext('notes:daily:'‖day))` como primer lock; prueba concurrente con control positivo (días distintos crean dos). |
| El guardado automático pisa lo escrito en otro dispositivo o pierde texto | Versión optimista (`WHERE version = $v`); conflicto deja borrador local; cola de un guardado en vuelo + el último; guardar en `pagehide`/`visibilitychange`; temporizador limpiado al desmontar. Unitarias de la cola y del conflicto; integración del guardado viejo rechazado. |
| La captura y el editor abiertos a la vez: la línea capturada choca con la versión del editor | La captura sube la versión; el editor abierto recibe el conflicto y ofrece ver la versión guardada; prueba de integración de captura + guardado con la versión vieja. |
| `[[…]]` inyecta HTML o URLs | El plugin crea nodos `link` con `href` armado por la app desde el tipo e id validados (uuid); el nombre es texto; el saneador sigue después. Pruebas de nombres con `<script>`, `]`, `|` y ids no uuid. |
| El selector en el iPhone pierde el foco o lo tapa el teclado | Lista debajo del campo, combobox ARIA con `aria-activedescendant` (el foco nunca sale del `textarea`), `scroll-padding`; el owner lo verifica en el iPhone en el Checkpoint. |
| Backlinks lentos o con falsos positivos | `LIKE '%[[type:<uuid>|%'` con uuid validado (sin comodines del usuario); borradas fuera; si crece, índice trigram (backlog). |
| Convertir en tarea sobre una nota que cambió | La acción exige versión e índice + texto del ítem; si no coinciden, «Cambió mientras tanto» sin escribir; integración del caso. |
| `unaccent` no está en el Postgres local (`embedded-postgres`) | Verificarlo en N4 antes de escribir la migración; si falta, la prueba de búsqueda corre solo en CI y se anota en HANDOFF. Neon y la imagen de CI lo traen. |
| Operadores de `tsquery` en la búsqueda (`&`, `!`, `:`, `'`) | Se arma con palabras extraídas por regex Unicode (`\p{L}\p{N}`), cada una como lexema con `:*`, pasado como parámetro a `to_tsquery`; pruebas de inyección. |
| `ts_headline` devuelve HTML | `StartSel`/`StopSel` con caracteres privados (U+E000/U+E001) que el componente parte y dibuja con `<mark>`; el resto es texto. |
| Tocar cinco páginas de detalle rompe sus pruebas | `<NoteMentions>` vive en `@/lib/note-extensions` y se mockea en cada prueba de página (como `@/lib/project-extensions`). |
| La entrada nueva de navegación rompe E2E y capturas | En N1, revisar `e2e/home.spec.ts` y dispatch de `update-screenshots.yml` justo tras el push. N2 (sección en detalles), N3 (captura con tres tipos) y N4 también cambian capturas: dispatch tras cada push. |
| El contenido de las notas se filtra a logs | `describeError` y logs sin cuerpo ni título; pruebas de las acciones con un error de base que no imprimen el texto. |
| Tono de culpa | Prueba automática de cadenas prohibidas sobre el copy de cada corte. |

## Checkpoints

- **Tras N1:** «Nota de hoy» desde Hoy, escribir, recargar y ver lo guardado; dos pestañas dan el conflicto sin perder texto; nota de conocimiento fijada con área.
- **Tras N2:** `[[` enlaza un proyecto y el proyecto muestra «Mencionado en 1 nota»; renombrarlo cambia el texto del enlace.
- **Tras N3:** convertir una línea en tarea y marcarla desde la nota; captura «Nota» con «Deshacer»; pie «Ese día».
- **Tras N4:** búsqueda con acentos y prefijo; el E2E pasa en CI.
- **Checkpoint final:** recorrido del agente en producción con el Chrome personal del owner (datos `[QA]` que luego borra); el iPhone (selector `[[` con el teclado, captura) queda para el owner.
