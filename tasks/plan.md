# Plan de implementación: goals

> Spec: [`SPEC-goals.md`](../SPEC-goals.md) (APROBADO v1.0, 2026-10-12) · Tareas: [`todo.md`](todo.md)
> Planes anteriores en [`archive/`](archive/).

## Enfoque

Rebanadas verticales (datos + acción + pantalla + pruebas), **un implementador a la vez** (gate local liviano, `CLAUDE.md`), rama corta → PR a `main` → CI verde verificado antes de cada merge → deploy y smoke. Cada agente hace push **una vez**. Trabajo autónomo hasta el **Checkpoint final**; decisiones no cubiertas: la opción conservadora, anotada en HANDOFF como «decisión autónoma para revisar con el owner». **Presupuesto E2E:** un solo spec nuevo en todo el módulo (G1), con su entrada en `SPEC_MODULES`.

## Orden y dependencias

```
G1 manuales + pantalla ─> G2 hábito y proyecto ─> G3 objetivo semanal y enlaces ─> G4 cierre
```

- **G1** es la base: migración con las tres tablas (`goals`, `goal_entries`, `weekly_objectives`) y sus `CHECK`, `pace.ts` y `progress.ts` puros con tablas de casos, `/goals` (crear, editar, archivar, eliminar y deshacer, «+N», lograr y reabrir, «Anteriores», orden con arrastre), manifiesto, exportación. Deja **slots** para las fuentes de G2 (selector de fuente en el formulario, `progress.ts` por `sourceKind`) y para el objetivo semanal de G3.
- **G2** añade los contratos `getHabitDoneDays` y `getProjectProgress`, las fuentes `habit` y `project` y la regla de ESLint de fronteras.
- **G3** añade el objetivo semanal y las secciones de meta en el detalle de hábitos y proyectos (`goal-extensions`).
- **G4**: «Pasar al próximo periodo», retrospectiva, backlog, mapa y HANDOFF; Checkpoint.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Límites de año y trimestre en Lima (31-dic, bisiesto, medianoche) | `pace.ts` puro con tablas de casos antes de la UI. |
| Dos «+1» a la vez o doble logro | Lock `(5000, hashtext(goal_id))` y lograr idempotente; prueba con control positivo. |
| Hábito: pausas y días no programados contaminan el conteo | Reutilizar `isDoneOn`/`weekCompliance`; casos de pausa y días fijos en integración. |
| `habits`/`projects` acaban importando `goals` | Contrato registrado + raíz de composición importada por nombre + regla de ESLint. |
| Tono de culpa en el copy | Prueba automática de cadenas prohibidas sobre todo el copy. |
| Presupuesto E2E y CI | Un solo spec nuevo; el resto unitario, componente o integración. |

## Checkpoints

- **Checkpoint final:** recorrido del agente en producción con el Chrome personal del owner (datos `[QA]` que luego borra) y revisión del owner en el iPhone.
