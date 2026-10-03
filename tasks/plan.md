# Plan de implementación: today

> Spec: [`SPEC-today.md`](../SPEC-today.md) (APROBADO v1, 2026-10-03) · Tareas: [`todo.md`](todo.md)
> Planes anteriores en [`archive/`](archive/).

## Enfoque

El de `habits`: rebanadas verticales (contrato + pantalla + pruebas), implementador en worktree → PR → revisores (`code-reviewer`, `test-engineer` y accesibilidad, porque todo es UI) → CI verde (verificado antes de cada merge) → deploy y smoke test. Trabajo autónomo hasta el **Checkpoint final**; decisiones no cubiertas: la opción conservadora, anotada en HANDOFF.

`today` no tiene tablas ni migraciones: solo consume contratos. Lo que falte en un módulo proveedor (un conteo, una función pura exportada, la revalidación de `/`) se agrega **en ese módulo**, nunca se reimplementa en `today`.

Minutos de CI: cada agente hace push **una vez**, con el gate local en verde.

## Orden y dependencias

```
D1 tablero + hábitos ─┬─> D2 tareas ─────┬─> D4 día completo
                      └─> D3 proyectos ──┘
```

- **D1** es la base: `src/modules/today/` (manifiesto "Hoy" movido desde `core`, regla de límites "nadie importa `today`"), la portada con cabecera, la sección Hábitos (pads con `getHabitsDueToday` dentro de `ScreenServicesProvider` → `HabitsScreenWithin`) y el día vacío. Deja `TodayBoard` con **slots** para Tareas, Proyectos y Día completo, y la lectura en paralelo de la página lista para sumar contratos.
- **D2 y D3 en paralelo** sobre los slots de D1, cada uno con su `TEST_DB_PORT` y `E2E_PORT`; merge D2 → D3 (D3 rebasa, sin push intermedio).
- **D4** necesita D2 (tareas completadas y su conteo).

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Dos módulos (hábitos y tareas) con avisos y anuncios en la misma pantalla | Una sola zona de avisos: la del anfitrión (`ScreenServicesProvider`); ambos usan sus servicios. |
| Completar una tarea saca la fila de la lista y el foco se pierde | Restaurar el foco explícitamente (siguiente fila, o el título de la sección); prueba unitaria y E2E con teclado. |
| Datos viejos en `/` tras actuar en otro módulo | `tasks` y `projects` revalidan `/` (D2, D3); `habits` ya lo hace. |
| Reglas duplicadas (cumplimiento, vencimiento, recurrencia) | Solo se usan funciones de los módulos proveedores; `today-board.ts` combina, no decide. |
| "Día completo" que parpadea mientras hay acciones en vuelo | Se calcula sobre el estado optimista confirmado; pruebas de tabla en `today-board.ts`. |
| Medianoche de Lima | Todo con `ownerDateKey`; pruebas de borde 23:59/00:00 en el conteo de completadas. |

## Checkpoints

- **Checkpoint final:** el agente hace el recorrido en producción con el Chrome personal del owner (escritorio, ancho de celular, ambos temas; datos `[QA]` que luego borra) y el owner revisa en el iPhone (es el MVP usable: uso diario real).
