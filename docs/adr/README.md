# Decisiones de arquitectura (ADR)

Cada ADR registra una decisión que ya se tomó: el contexto, la decisión, las alternativas descartadas, las consecuencias y los PRs donde se aplicó. Un ADR aceptado no se reescribe: si la decisión cambia, se escribe uno nuevo que lo reemplaza y el viejo pasa a "reemplazado por ADR-XXX".

**Stack de referencia:** Next.js 16 (App Router) en Vercel (Node.js 24, Fluid Compute), Postgres en Neon, Drizzle con `pg`, Better Auth y el design system propio. Las decisiones técnicas completas están en [`SPEC-core.md`](../../SPEC-core.md).

| ADR | Decisión | Estado |
|---|---|---|
| [001](001-single-user-auth.md) | Autenticación de un solo usuario (Better Auth, owner único, passkeys con verificación de usuario) | aceptado |
| [002](002-database-driver.md) | Driver de base de datos (`pg` + Drizzle) y migraciones | aceptado |
| [003](003-english-code-spanish-ui.md) | Código en inglés, interfaz y documentación en español | aceptado |
| [004](004-pwa-without-service-worker.md) | PWA sin service worker hasta `reminders` | aceptado |
| [005](005-time-zone.md) | Zona horaria: UTC en la base, "hoy" en `America/Lima` | aceptado |
| [006](006-ci-cd-and-deploy.md) | CI/CD trunk-based con GitHub Actions como único deployer (build remoto en Vercel, smoke test, respaldos) | aceptado |
| [007](007-design-system-source-of-truth.md) | Design system con fuente de verdad en Claude Design | aceptado |

## Formato

Archivo `NNN-titulo-en-ingles.md`, texto en español (los identificadores del código, en inglés). Secciones: encabezado con estado, fecha y tarea o PRs; **Contexto**, **Decisión**, **Alternativas** y **Consecuencias**.
