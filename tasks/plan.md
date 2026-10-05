# Plan de implementación: finance

> Spec: [`SPEC-finance.md`](../SPEC-finance.md) (APROBADO v1, 2026-10-05) · Tareas: [`todo.md`](todo.md)
> Planes anteriores en [`archive/`](archive/).

## Enfoque

El de los módulos anteriores: rebanadas verticales (datos + pantalla + pruebas), implementador en worktree → PR → revisores (`code-reviewer`, `test-engineer`, accesibilidad si toca UI y `security-auditor` en F1 y F5, que tocan datos y producción) → CI verde (verificado antes de cada merge) → deploy y smoke test. Trabajo autónomo hasta el **Checkpoint final**; decisiones no cubiertas: la opción conservadora, anotada en HANDOFF.

Minutos de CI: cada agente hace push **una vez**, con el gate local en verde.

## Orden y dependencias

```
F1 datos + gastos ─┬─> F2 recurrentes ─┬─> F4 portada
                   │                   └─> F5 importación
                   └─> F3 resumen
```

- **F1** es la base: las seis tablas (migración aditiva, `CHECK`, locks, exportación), `money.ts`, catálogo y tipo de cambio en "Ajustes", `/finance` → Mes con la lista de gastos, hoja "Gasto", captura rápida con selector "Tarea · Gasto" (el contexto de `core` pasa a una lista de proveedores) y manifiesto. Deja **slots**: la pestaña Pagos, el bloque de resumen del mes y la tira "Pendiente de pagar".
- **F2 y F3 en paralelo** sobre los slots de F1, cada uno con su `TEST_DB_PORT` y `E2E_PORT`; merge F2 → F3 (F3 rebasa, sin push intermedio). F3 deja "Pendiente de pagar" leyendo una función de F2 (`getPendingForMonth`); si F2 no está integrada todavía, el slot queda vacío y se conecta al rebasar.
- **F4** necesita F2 (períodos pendientes y `markPaid`).
- **F5** necesita F2 (tablas de recurrentes y `settlements`). La corrida en producción la hace el agente con respaldo previo comprobado.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Errores de redondeo con dinero | Céntimos en `bigint`; conversión a PEN con el tipo guardado y redondeo explícito (half-up) en `money.ts`, con tablas de casos. |
| Fechas de vencimiento mal calculadas (días 29–31, bisiestos, cada N meses cruzando el año, medianoche de Lima) | `schedule.ts` puro con tablas de casos exhaustivas (colectar diferencias y afirmar una vez, lección de `tasks`). |
| Pago doble con dos toques | PK `(recurring_payment_id, due_on)` + lock del pago; prueba de integración con dos llamadas a la vez y control positivo. |
| Datos financieros reales en el repo público | El JSON de importación vive fuera del repo (`/.data/` en `.gitignore`); el script recibe la ruta; nada de datos reales en pruebas ni capturas. |
| La captura rápida de `tasks` se rompe al volverla multi-proveedor | Cambio pequeño y aislado en F1 con E2E de captura de tareas sin tocar; el proveedor de `tasks` no cambia. |
| "Día completo" de `today` cambia con Pagos | Regla en `today-board.ts` ampliada con tablas de casos; solo vencidos o de hoy lo impiden. |
| E2E de `/` comparten datos | Pruebas de F4 con la etiqueta de la lección de `today` y `boardTest`. |

## Checkpoints

- **Checkpoint final:** el agente hace el recorrido en producción con el Chrome personal del owner (escritorio y ancho de celular, ambos temas; datos `[QA]` que luego borra, sin tocar los importados) y el owner revisa en el iPhone la captura de un gasto real.
