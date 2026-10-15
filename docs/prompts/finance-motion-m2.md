# Arranque de M2 (`finance-motion`) en una conversación nueva

Pega esto como primer mensaje (sin ejecutar nada antes):

---

Retoma el módulo `finance-motion` en brahua-os: toca **M2: Estructura nueva**. Lee primero `docs/HANDOFF.md` (entrada `finance-motion`), `CLAUDE.md`, `SPEC-finance-motion.md` (aprobada v1.0), `tasks/plan.md`, la tarea M2 en `tasks/todo.md` y `docs/motion-contract.md`. Antes de escribir código, lee la guía de Next en `node_modules/next/dist/docs/` y vuelve a leer el diseño por MCP (`DesignSync`: `get_file` de `Finanzas.dc.html`, proyecto `3787b11d-b9b0-4ea2-bd5d-26d0f072f863`) por si lo cambié. Trabaja con las reglas del repo: rama corta `feat/finance-motion-m2`, gate local liviano (prettier, eslint, typecheck y solo las unitarias que toques; build, E2E e integración los corre el CI), un solo push, PR contra `main`, merge solo con los 3 checks verdes, `gh api user -q .login` debe decir `Brahua`. Idioma: respuestas en español, código y commits en inglés.

Alcance de M2 (ver la tarea): control de 4 secciones (Resumen · Gastos · Pendientes · Pagados) con cookie compatible con los valores antiguos `mes`/`pagos`; cabecera con delta neutro «vs. mes anterior al mismo punto del mes» y «Día n de m»; tarjetas *Gastado* y *Pendiente de pagar*; barra apilada + lista por categoría; tarjeta única de medios y recurrente/suelto; total por día en Gastos; `trend.ts` y `getMonthlyTotals`. Deja los slots para M3 (color de categorías), M4 (gráfico) y M5 (acciones animadas). Sin E2E nuevo (el único del módulo es de M5), pero revisa `e2e/finance*.spec.ts`, `home.spec.ts` y `e2e/support/*` por lo que cambia la estructura, y despacha `update-screenshots.yml` justo después del push.

Cosas que aprendimos en M1 (no repetir):
- Nada que dependa de JS puede dejar el HTML del servidor oculto: la entrada va en CSS (`Cascade`), Motion solo para cambios posteriores a hidratar.
- Un componente animado no cambia de tipo de elemento ni de clase durante su vida.
- `animate()` de `motion/mini` no existe en jsdom: los hooks lo saltan; las pruebas lo simulan.
- Las cifras con `NumberFlow` no son texto asertable en E2E (dígitos sueltos): asevera por el nombre accesible o por la parte de texto plano.
- Un clic de Playwright espera a que el elemento deje de moverse: una animación de transform antes de un muestreo corto se come la ventana; asienta con `animationsSettled`.
- Tras el push, `update-screenshots.yml` genera las referencias y deja la ejecución del PR en `action_required`: aprobarla con `gh api -X POST repos/Brahua/brahua-os/actions/runs/<id>/approve`.
- Los cambios de documentos sueltos cuestan un CI completo: agrúpalos con el PR de código.

Al terminar M2, actualiza `tasks/todo.md` y el HANDOFF en el mismo PR y reporta qué quedó y qué sigue (M3 y M4 en paralelo posible, luego M5).
