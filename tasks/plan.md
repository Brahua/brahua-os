# Plan de implementación: tasks

> Spec: [`SPEC-tasks.md`](../SPEC-tasks.md) (APROBADO v1, 2026-10-01) · Tareas: [`todo.md`](todo.md)
> Planes anteriores en [`archive/`](archive/) (`design-system`, `core`, `projects`).

## Enfoque

El de `projects`: rebanadas verticales (datos + acción + pantalla + pruebas), implementador en worktree → PR → revisores → CI verde (verificado antes de cada merge) → deploy y smoke test. Tareas en paralelo solo con **puntos de extensión definidos de antemano**, puertos propios (`TEST_DB_PORT`, `E2E_PORT`) y un orden de merge acordado.

## Orden y dependencias

```
T1 datos + captura + bandeja ─┬─> T2 vistas y detalle ─┬─> T5 tareas en proyectos (próxima acción, avance)
                              ├─> T3 recurrencia        │
                              └─> T4 etiquetas ─────────┘
                                                        └─> T6 contrato con today + navegación definitiva
```

- **T1** es la base: el esquema completo (las 3 tablas, `CHECK` e índices en una migración aditiva), el manifiesto provisional (Tareas, atajo 3), la **captura rápida global** (activa la tecla naranja) y la bandeja con completar/deshacer.
- **T2, T3 y T4 en paralelo** después de T1: T1 deja el detalle de la tarea armado por secciones (como P2) y la fila con sus puntos de inserción (ícono de recurrencia, etiquetas).
- **T5** necesita T2 (detalle) y conecta con `projects` por contratos (fuente de avance, fuente de próxima acción) sin que `projects` importe `tasks`.
- **T6** al final: contrato `getTasksTodaySummary` y la navegación definitiva cuando el owner la itere en Claude Design.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Captura global montada desde el shell de `core` sin que `core` importe `tasks` | Punto de extensión registrado (como los manifiestos y las fuentes de avance), definido en T1. |
| Fechas de recurrencia (fin de mes, días de semana, medianoche de Lima) | Funciones puras con pruebas exhaustivas antes de la UI (T3). |
| Doble toque al completar una recurrente (duplicados) | Completar es idempotente por `done_at` y la siguiente se crea en la misma transacción. |
| Próxima acción única con escrituras concurrentes | Índice único parcial + lock del proyecto como primer lock (convención de `projects`). |
| Pruebas E2E inestables tras revalidar (título ausente) | `afterSaveSettled()` antes de axe (lección de `projects`). |

## Checkpoints

- **Checkpoint T1:** el owner captura desde el celular en < 10 s y completa desde la bandeja.
- **Checkpoint final:** recorrido completo (capturar, clasificar, vistas, recurrente, etiquetas, tareas de un proyecto y próxima acción) en celular y escritorio.
