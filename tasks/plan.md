# Plan de implementación: habits

> Spec: [`SPEC-habits.md`](../SPEC-habits.md) (APROBADO v2, 2026-10-02) · Tareas: [`todo.md`](todo.md)
> Planes anteriores en [`archive/`](archive/).

## Enfoque

El de `tasks`: rebanadas verticales (datos + acción + pantalla + pruebas), implementador en worktree → PR → revisores → CI verde (verificado antes de cada merge; el ruleset de `main` lo exige mientras el repo sea público) → deploy y smoke test. Trabajo autónomo hasta el **Checkpoint final** (el owner salta los intermedios, como en `tasks`); decisiones no cubiertas: la opción conservadora, anotada en HANDOFF.

Minutos de CI: cada agente hace push **una vez**, con el gate local en verde.

## Orden y dependencias

```
H1 datos + crear + toque ─┬─> H2 frecuencias y agenda ─┬─> H4 rachas y pausas ─> H5 historial ─> H6 contrato con today + navegación
                          └─> H3 cantidad y a evitar ───┘
```

- **H1** es la base: las tres tablas completas (con `kind`, `CHECK`, índices) en una migración aditiva, el manifiesto provisional (Hábitos en la barra inferior, Tareas a "Más", atajo 4), `/habits` "Hoy" con pads y el toque optimista con "Deshacer". Deja el pad, el formulario y el contexto de pantalla con **slots** para H2 y H3.
- **H2 y H3 en paralelo** sobre los slots de H1, cada uno con su `TEST_DB_PORT` y `E2E_PORT`; merge H2 → H3.
- **H4** necesita las tres mediciones y frecuencias (`streak.ts` puro primero, con tablas de casos).
- **H5** usa `streak.ts` para la semana y el calendario. **H6** al final.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Reglas de racha (frecuencias, pausas, semana en curso, a evitar) | Funciones puras con tablas de casos antes de la UI (H4). |
| Doble toque en un pad | Upsert atómico por `(habit_id, day)`; `check` envía el estado deseado (idempotente). |
| Medianoche de Lima y semanas lunes–domingo | `schedule.ts` puro con pruebas de borde (cambio de mes, año, 23:59/00:00). |
| Navegación provisional que choca con Tareas | Manifiestos de H1; la definitiva se itera en Claude Design. |
| Minutos de CI | Un push por agente; sin re-runs para "verificar". |

## Checkpoints

- **Checkpoint final:** el agente hace el recorrido en producción con el Chrome personal del owner (escritorio, ancho de celular, ambos temas; datos `[QA]` que luego borra) y el owner revisa en el iPhone.
