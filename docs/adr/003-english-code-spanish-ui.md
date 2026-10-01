# ADR-003: Código en inglés, interfaz y documentación en español

- **Estado:** aceptado (2026-09-29)
- **Origen:** `SPEC-core.md` v2 ("Estilo de código", decisión cerrada 5) · aplicado desde el PR [#10](https://github.com/Brahua/brahua-os/pull/10)

## Contexto

El owner usa la app en español y escribe las specs en español. El código, en cambio, convive con librerías, documentación, mensajes de error y herramientas (incluidos los agentes que lo escriben) que están en inglés. Mezclar idiomas dentro del código (`crearArea`, `areas_de_vida`) obliga a decidir cada nombre dos veces y vuelve inconsistentes los identificadores.

## Decisión

- **Todo el código va en inglés:** identificadores, comentarios, nombres de archivos y carpetas, rutas (`/areas`, `/settings`, `/login`), tablas y columnas (`core_life_areas.sort_order`), ids de módulo, scripts y **mensajes de commit** (Conventional Commits).
- **Solo lo que ve el usuario va en español:** JSX, mensajes de validación, toasts, títulos de página y `label` de los manifiestos de módulo. Sin librería de i18n: los textos van inline o en `src/modules/<id>/copy.ts`.
- **Specs, documentación, ADRs y descripciones de PR en español.** Dentro de ellos, los identificadores del código se escriben tal cual, en inglés.

## Alternativas

- **Todo en español:** choca con las APIs y convenciones de las librerías y con los mensajes de error, que seguirán en inglés.
- **Todo en inglés, con i18n:** agrega una capa de traducción para una app de un solo usuario y un solo idioma.

## Consecuencias

- Las rutas forman parte del código y quedan en inglés; los títulos y textos visibles, en español.
- Los mensajes que van al servidor o a los logs (errores internos, salida de scripts) son en inglés; los que ve el owner en la app, en español.
- Revisar un PR implica dos idiomas a propósito: el diff en inglés y la descripción en español.
