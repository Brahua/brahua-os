# Plan de implementación: design-system

> Spec: [`SPEC-design-system.md`](../SPEC-design-system.md) · Tareas: [`tasks/todo.md`](todo.md) · Estado: **BORRADOR — pendiente de aprobación**

## Resumen

Primero se arma la app vacía, con sus herramientas de calidad y el CI. Luego se definen los tokens, con el test de contraste. Después se construye la guía viva `/design` junto con el primer componente (`Key`), de punta a punta: componente, pruebas, captura de referencia y axe. Con ese patrón probado, se agregan los demás componentes por grupos. Al final vienen las protecciones (regla de lint) y la exportación a Claude Design.

## Decisiones de arquitectura

- **Primero una rebanada vertical completa.** La tarea 4 entrega `Key` + `/design` + test de componente + captura + axe. Así se valida todo el proceso antes de multiplicarlo por 18 componentes.
- **`/design` solo en desarrollo hasta `core`.** La spec pide que sea visible solo para el dueño, pero la autenticación llega en `core`. Mientras tanto, la ruta devuelve 404 en producción salvo que el build se haga con `DESIGN_GUIDE=enabled`, que solo usan las pruebas E2E. No se despliega nada público.
- **Capturas de referencia solo en Linux (CI).** Las fuentes se renderizan distinto en macOS. Las capturas se generan y comparan en el contenedor de Playwright, igual en local (`pnpm test:e2e:docker`) y en CI. Fuera de Linux, esas pruebas se omiten.
- **Ambos temas desde el inicio.** El tema claro está diseñado; los tokens de los dos temas se cargan en T3 y cada componente se prueba en ambos.
- **Verificar la documentación antes de cada integración** (Next.js 16, Tailwind v4, shadcn, Vaul, NumberFlow), con la skill `source-driven-development`. No se usan APIs de memoria.

## Orden y dependencias

```
T1 Andamiaje ─► T2 Pruebas + CI ─► T3 Tokens + fuentes + temas
                                         │
                                         ▼
                              T4 /design + Icon + Key  (rebanada vertical)
                                         │
      ┌──────────┬──────────┬──────────┬─┴────────┬──────────┬──────────┐
      T5         T6         T7         T8         T9         T10        T11/T12
   Led/Area   Label/Stat  Ring/Seg   Dot/Day    Lcd/Toast  Switch/Seg  Text/Sheet
      └──────────┴──────────┴──────────┴────┬─────┴──────────┴──────────┘
                                            ▼
                         T13 Regla de lint + reduced motion ─► T14 Exportar a Claude Design
```

- **Se pueden hacer en paralelo:** T5 a T12 y T15 (`Kbd` + `Tooltip` + layout de escritorio), porque solo dependen de T4. Usan el mismo patrón pero tocan archivos distintos.
- **Tienen que ir en orden:** T1 → T2 → T3 → T4, y al final T13 → T14.

## Fases

1. **Base (T1–T3):** app, calidad, CI y tokens. *Checkpoint 1.*
2. **Rebanada vertical y fidelidad (T4–T6):** guía viva y primeros componentes. *Checkpoint 2: comparación lado a lado contigo contra el diseño de Claude Design.*
3. **Resto de componentes y escritorio (T7–T12, T15).** *Checkpoint 3.*
4. **Protecciones y sincronización (T13–T14).** *Checkpoint final:* los 9 criterios de éxito de la spec.

## Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Next.js 16, Tailwind v4 y shadcn tienen APIs recientes que no conozco de memoria | Alto | Leer la documentación oficial en cada tarea (`source-driven-development`) |
| Las capturas de referencia fallan de forma intermitente (fuentes, animaciones) | Medio | Contenedor Linux fijo, `reducedMotion` y animaciones desactivadas al capturar, esperar a `document.fonts.ready` |
| Vaul podría estar sin mantenimiento | Medio | Revisar su estado en T12; si no está activo, construir `Sheet` sobre Radix Dialog + Motion |
| NumberFlow con Server Components o SSR | Bajo | Usarlo solo en componentes cliente, con respaldo de texto estático |
| La fidelidad visual se aleja del diseño | Medio | Checkpoint 2 con comparación lado a lado antes de construir el resto |

## Preguntas abiertas

- Ninguna. Los diseños de celular, escritorio y tema claro están completos.
