# Plan de implementación: core

> Spec: [`SPEC-core.md`](../SPEC-core.md) · Tareas: [`tasks/todo.md`](todo.md) · Estado: **BORRADOR — pendiente de aprobación**
> Plan anterior (design-system, completado): [`tasks/archive/`](archive/)

## Resumen

`core` convierte la base de la app en algo que puedes usar a diario:

- **Login** solo para ti, con contraseña y passkey.
- **Base de datos** en Neon.
- **Navegación:** barra inferior en el celular y barra lateral en escritorio, con los patrones del design system.
- **Tus áreas de vida:** crear, editar, reordenar y archivar.
- **App instalable.**
- **Despliegue** en `os.brahua.com`.

Se construye en rebanadas verticales. Cada tarea deja algo que funciona de punta a punta: base de datos, servidor, interfaz y pruebas.

## Decisiones de arquitectura

- **Desarrollo y pruebas con Postgres local** (Docker, el mismo contenedor que usa el CI). Neon se conecta en el despliegue (C9). Así las tareas C1–C8 no dependen de tu cuenta de Vercel.
- **Driver:** se decide en C1 leyendo la documentación de Drizzle, Neon y Vercel (Neon serverless con WebSocket o `pg` con Fluid Compute). El criterio es que admita transacciones interactivas, porque reordenar las necesita. Queda registrado en un ADR.
- **Better Auth, verificado contra su documentación y sus skills instaladas** (`better-auth-best-practices`, `better-auth-security-best-practices`): nombres del plugin de passkey, `modelName`, rate limit en base de datos y la integración con Next 16.
- **Los patrones de navegación (`BottomNav`, `Sidebar`) salen de Claude Design** (`components/patterns/Navigation`). Se portan con la misma API y las clases `bo-*`, como los componentes.
- **Pruebas E2E con usuario real:** un owner de prueba sembrado antes de las pruebas y la passkey probada con el autenticador virtual de Chromium. Las capturas se siguen generando en Docker.
- **`/design` pasa a ser solo para el owner** en cuanto exista el login (C2). Se elimina la variable `DESIGN_GUIDE`.

## Orden y dependencias

```
C1 Base de datos ─► C2 Login ─► C3 Navegación ─► C4 Ajustes
                        │             │
                        │             └─► C5 Áreas: ver y crear ─► C6 Áreas: reordenar y archivar
                        │
                        └─► C7 PWA + cabeceras ─► C8 Páginas de error
                                                        │
                        C1–C8 ──────────────────────────┴─► C9 Despliegue ─► C10 Operación
```

- **En paralelo después de C3:** C4 y C5; C7 y C8.
- **En secuencia:** C1 → C2 (el login necesita sus tablas) y C9 → C10 (los respaldos necesitan la base de producción).

## Fases

1. **Base segura (C1–C2):** base de datos y login. *Checkpoint 1: inicias sesión en local con contraseña y con passkey.*
2. **App usable (C3–C6):** navegación, ajustes y áreas de vida. *Checkpoint 2: recorrido completo en celular y escritorio; lo revisamos juntos.*
3. **Plataforma (C7–C8):** instalable, cabeceras de seguridad y páginas de error.
4. **Producción (C9–C10):** despliegue en `os.brahua.com`, respaldos y ADRs. *Checkpoint final: criterios de éxito de `SPEC-core.md`.*

## Qué necesito de ti y cuándo

| Cuándo | Qué |
|---|---|
| C2 | Confirmar `OWNER_EMAIL` (propuesta: `josuebh62@gmail.com`) y elegir tu contraseña al ejecutar `pnpm auth:owner` |
| Checkpoint 1 | Registrar tu passkey (Touch ID o Face ID) |
| C9 | Instalar e iniciar sesión en Vercel CLI, crear la base Neon desde Vercel Marketplace y agregar el `CNAME os` en Hostinger |
| C9 | Probar la instalación en tu celular (iOS o Android) |

## Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| APIs de Better Auth distintas a lo que asume la spec (plugin de passkey, `modelName`, `disableSignUp`) | Alto | Leer su documentación y skills en C2; ajustar la spec antes de implementar si algo cambia |
| El driver de Neon no admite transacciones en serverless | Alto | Decidirlo en C1 con documentación y una prueba de transacción en integración |
| Passkeys en la PWA instalada de iOS | Medio | E2E con autenticador virtual y checklist manual en C9 con tu iPhone |
| Passkeys no funcionan en previews (el dominio no coincide) | Bajo | Previsto en la spec: en previews se usa contraseña; passkey solo en `os.brahua.com` |
| Pruebas E2E con sesión: cookies, rate limit y datos compartidos entre pruebas | Medio | Base de datos de prueba aislada por corrida y un fixture de sesión reutilizable |
| DNS en Hostinger tarda en propagarse | Bajo | Configurarlo al inicio de C9 y probar con el dominio `*.vercel.app` mientras tanto |

## Preguntas abiertas

- `OWNER_EMAIL`: ¿`josuebh62@gmail.com`? No bloquea hasta C2.
