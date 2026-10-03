// Realistic demo data (projects, tasks and habits) so every screen has something to show. The
// owner runs it in their own terminal; the agent never sees the database URL.
//   DATABASE_URL_UNPOOLED='…' ALLOW_PROD_DB=1 pnpm db:demo           insert (idempotent)
//   DATABASE_URL_UNPOOLED='…' ALLOW_PROD_DB=1 pnpm db:demo:remove    remove only the demo rows
//   DATABASE_URL_UNPOOLED='…' ALLOW_PROD_DB=1 pnpm db:demo:replace   DESTRUCTIVE: delete every
//     project, task and habit (soft-deleted ones too) and insert the demo
//
// Safety, like `auth:owner`: only DATABASE_URL_UNPOOLED, a non-local host needs ALLOW_PROD_DB=1
// (a Vercel build is never permission) and typing the host back; `replace` also asks for the
// word BORRAR. Nothing prints the URL, a secret or a Postgres message (`describeError`).
//
// Every demo row has a deterministic id (UUID v5 of a key under DEMO_NAMESPACE), so inserting
// twice adds nothing and `remove` deletes exactly those rows. Dates are relative to Lima's day of
// the run (`ownerDateKey`), so "Hoy" always has something due. Life areas are read by slug (the
// seed's); `core` (areas, settings, auth) is never written.
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { and, inArray, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { createDb } from "@/lib/db";
import {
  databaseHost,
  describeDatabaseTarget,
  isLocalDatabaseUrl,
  resolveOwnerScriptDatabaseUrl,
} from "@/lib/db-config";
import { describeError } from "@/lib/describe-error";
import { ownerDateKey } from "@/lib/time";
import { lifeAreas } from "@/modules/core/db/schema";
import { habitLogs, habitPauses, habits } from "@/modules/habits/db/schema";
import {
  projectDependencies,
  projectLinks,
  projectMilestones,
  projects,
} from "@/modules/projects/db/schema";
import { taskTagLinks, taskTags, tasks } from "@/modules/tasks/db/schema";
import type { ProjectStatus } from "@/modules/projects/project-constants";
import { CANCELLED, prompt } from "./terminal-prompt";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

// ── Ids ─────────────────────────────────────────────────────────────────────────────────────────

/** Fixed namespace of this script: every demo id is UUID v5(key, DEMO_NAMESPACE). Never change. */
export const DEMO_NAMESPACE = "6f3c2a9e-4b1d-4e8a-9c57-2d0b7e5a1f43";

/** RFC 4122 UUID version 5 (SHA-1, name-based). */
export function uuidV5(name: string, namespace: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const hash = createHash("sha1").update(ns).update(name, "utf8").digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The id of a demo row, e.g. `demoId("project:aws")`. */
export const demoId = (key: string) => uuidV5(key, DEMO_NAMESPACE);

// ── Dates (Lima days as YYYY-MM-DD; Lima has no DST: UTC-5 all year) ─────────────────────────────

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay() || 7;
}

/** An instant on a Lima day at `hour`:`minute`. */
function at(day: string, hour: number, minute = 0): Date {
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return new Date(`${day}T${hh}:${mm}:00-05:00`);
}

/** Today's times are never in the future (a run at 7:00 has no 8:00 stamp yet). */
function notAfter(date: Date, now: Date): Date {
  return date > now ? now : date;
}

// ── Locks (the modules' own keys, so a demo write never interleaves with an app write) ──────────
// Rule of every module: advisory locks first, before any row lock. Spaces from projects.ts
// (2000 and 2001), tasks.ts (3000), habits.ts (4000) and project-links.ts; the integration test
// checks they still match the modules.

export const DEMO_LOCK_SPACES = { projects: 2_000, milestones: 2_001, tasks: 3_000, habits: 4_000 };

async function takeLocks(tx: Tx) {
  const { projects: p, milestones: m, tasks: t, habits: h } = DEMO_LOCK_SPACES;
  await tx.execute(
    sql`select pg_advisory_xact_lock(${sql.raw(String(p))}, hashtext('project_dependencies'))`,
  );
  await tx.execute(
    sql`select pg_advisory_xact_lock(${sql.raw(String(h))}, hashtext('habits:order'))`,
  );
  const projectIds = DEMO_PROJECTS.map((project) => demoId(`project:${project.key}`)).sort();
  for (const id of projectIds) {
    await tx.execute(sql`select pg_advisory_xact_lock(${sql.raw(String(m))}, hashtext(${id}))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('project_links'), hashtext(${id}))`);
    await tx.execute(sql`select pg_advisory_xact_lock(${sql.raw(String(t))}, hashtext(${id}))`);
  }
  const habitIds = DEMO_HABITS.map((habit) => demoId(`habit:${habit.key}`)).sort();
  for (const id of habitIds) {
    await tx.execute(sql`select pg_advisory_xact_lock(${sql.raw(String(h))}, hashtext(${id}))`);
  }
}

// ── Content ─────────────────────────────────────────────────────────────────────────────────────

type AreaSlug =
  "home" | "health" | "finance" | "learning" | "work" | "relationships" | "travel" | "hobbies";

export const AREA_SLUGS: readonly AreaSlug[] = [
  "home",
  "health",
  "finance",
  "learning",
  "work",
  "relationships",
  "travel",
  "hobbies",
];

type DemoProject = {
  key: string;
  name: string;
  area: AreaSlug;
  status: ProjectStatus;
  priority: "low" | "medium" | "high";
  objective?: string;
  notes?: string;
  /** Days from today (negative: past). */
  start?: number;
  due?: number;
  completed?: number;
  created: number;
  /** Title, due offset (optional) and the day it was done (offset, optional). */
  milestones?: { key: string; title: string; due?: number; done?: number }[];
  links?: { url: string; label?: string }[];
  blockedBy?: string[];
};

const DEMO_PROJECTS: DemoProject[] = [
  {
    key: "aws",
    name: "Certificación AWS Solutions Architect",
    area: "learning",
    status: "active",
    priority: "high",
    objective: "Aprobar el examen SAA-C03 con 800 puntos o más antes de fin de mes.",
    notes: [
      "## Plan de estudio",
      "",
      "- Curso de Adrian Cantrill (videos y laboratorios).",
      "- **Un dominio por semana** y simulacros los fines de semana.",
      "- Repasar las preguntas falladas en Anki.",
      "",
      "> El examen es en el centro Pearson VUE de San Isidro.",
    ].join("\n"),
    start: -40,
    due: 5,
    created: -42,
    milestones: [
      { key: "d1", title: "Dominio 1: Arquitecturas seguras", due: -20, done: -21 },
      { key: "d2", title: "Dominio 2: Arquitecturas resilientes", due: -10, done: -8 },
      { key: "d3", title: "Dominio 3: Arquitecturas de alto rendimiento", due: 1 },
      { key: "d4", title: "Dominio 4: Arquitecturas con costos optimizados", due: 3 },
      { key: "mock", title: "Simulacro final con 80 % o más", due: 4 },
    ],
    links: [
      {
        url: "https://aws.amazon.com/certification/certified-solutions-architect-associate/",
        label: "Guía oficial del examen",
      },
      { url: "https://learn.cantrill.io/", label: "Curso de Adrian Cantrill" },
    ],
  },
  {
    key: "depa",
    name: "Ordenar y pintar el depa",
    area: "home",
    status: "active",
    priority: "medium",
    objective:
      "Sala y comedor pintados de blanco hueso y el clóset ordenado, sin cajas en el piso.",
    notes: "Color elegido: **Blanco hueso** (CPP, mate). Calculo 2 galones para sala y comedor.",
    start: -14,
    due: 2,
    created: -16,
    milestones: [
      { key: "vaciar", title: "Vaciar y ordenar la sala", done: -10 },
      { key: "lijar", title: "Lijar y resanar las paredes", done: -2 },
      { key: "pintar", title: "Pintar sala y comedor", due: 1 },
      { key: "closet", title: "Ordenar el clóset y donar ropa", due: 2 },
    ],
  },
  {
    key: "fondo",
    name: "Fondo de emergencia 6 meses",
    area: "finance",
    status: "active",
    priority: "high",
    objective: "Juntar S/ 18 000 (seis meses de gastos) en una cuenta de ahorro aparte.",
    notes: [
      "Aporte fijo de **S/ 500** cada quincena, el mismo día que llega el sueldo.",
      "",
      "| Meta | Monto |",
      "| --- | --- |",
      "| 1 mes | S/ 3 000 |",
      "| 3 meses | S/ 9 000 |",
      "| 6 meses | S/ 18 000 |",
    ].join("\n"),
    start: -75,
    due: 150,
    created: -76,
    milestones: [
      { key: "m1", title: "Primer mes ahorrado (S/ 3 000)", done: -40 },
      { key: "m3", title: "Tres meses ahorrados (S/ 9 000)", due: 45 },
      { key: "m6", title: "Seis meses ahorrados (S/ 18 000)", due: 150 },
    ],
  },
  {
    key: "portafolio",
    name: "Portafolio web personal",
    area: "work",
    status: "paused",
    priority: "low",
    objective: "Una web con mis 4 mejores proyectos, CV y forma de contacto.",
    notes: "Pausado hasta terminar la certificación de AWS. Idea: Next.js y desplegar en Vercel.",
    start: -50,
    created: -55,
    milestones: [
      { key: "diseno", title: "Elegir diseño y estructura", done: -45 },
      { key: "casos", title: "Escribir los casos de estudio" },
      { key: "publicar", title: "Publicar con dominio propio" },
    ],
    links: [
      {
        url: "https://vercel.com/templates/next.js/portfolio-starter-kit",
        label: "Plantilla base",
      },
    ],
  },
  {
    key: "pasaporte",
    name: "Renovar pasaporte",
    area: "travel",
    status: "active",
    priority: "high",
    objective: "Tener el pasaporte electrónico nuevo antes de comprar los pasajes a Europa.",
    start: -10,
    due: 20,
    created: -12,
    milestones: [
      { key: "pago", title: "Pagar la tasa en el Banco de la Nación", done: -6 },
      { key: "cita", title: "Sacar cita en Migraciones", due: 1 },
      { key: "recojo", title: "Recoger el pasaporte", due: 20 },
    ],
    links: [{ url: "https://www.gob.pe/migraciones", label: "Migraciones en gob.pe" }],
  },
  {
    key: "europa",
    name: "Viaje a Europa 2027",
    area: "travel",
    status: "idea",
    priority: "medium",
    objective: "Tres semanas entre España, Francia e Italia en mayo de 2027.",
    notes: [
      "Ruta tentativa:",
      "",
      "1. Madrid y Barcelona (6 días)",
      "2. París (5 días)",
      "3. Roma, Florencia y Venecia (8 días)",
      "",
      "Presupuesto aproximado: **USD 4 500** con pasajes.",
    ].join("\n"),
    created: -30,
    blockedBy: ["pasaporte"],
  },
  {
    key: "ingles",
    name: "Inglés B2 – Platzi",
    area: "learning",
    status: "done",
    priority: "medium",
    objective: "Terminar la ruta de inglés B2 y aprobar el examen final.",
    start: -120,
    due: -15,
    completed: -20,
    created: -125,
    milestones: [
      { key: "b1", title: "Nivel B1 completo", done: -70 },
      { key: "b2", title: "Nivel B2 completo", done: -30 },
      { key: "final", title: "Examen final aprobado", done: -20 },
    ],
  },
];

type Recurrence =
  | { kind: "every_days" | "every_weeks" | "every_months"; interval: number }
  | { kind: "weekdays"; weekdays: number[] }
  | { kind: "month_day" };

type DemoTask = {
  key: string;
  title: string;
  notes?: string;
  priority: "low" | "medium" | "high";
  due?: number;
  /** Offset of the day it was done (always before today: "Día completo" never shows alone). */
  done?: number;
  area?: AreaSlug;
  project?: string;
  milestone?: string;
  next?: boolean;
  recurrence?: Recurrence;
  tags?: string[];
  spawnedFrom?: string;
  created: number;
};

export const DEMO_TAGS = ["casa", "compras", "trámites", "estudio"] as const;

const DEMO_TASKS: DemoTask[] = [
  // Inbox: no area, no project.
  { key: "pilas", title: "Comprar pilas para el control remoto", priority: "medium", created: -1 },
  {
    key: "gasfitero",
    title: "Llamar al gasfitero por la fuga del baño",
    priority: "medium",
    created: 0,
  },
  { key: "lentes", title: "Averiguar precio de lentes nuevos", priority: "low", created: -2 },
  {
    key: "regalo",
    title: "Ideas de regalo para el cumpleaños de mamá",
    priority: "low",
    created: -1,
  },
  // Overdue.
  {
    key: "contadora",
    title: "Enviar los sustentos de gastos a la contadora",
    priority: "high",
    due: -3,
    area: "finance",
    tags: ["trámites"],
    notes: "Boletas de salud y educación de septiembre. Están en la carpeta *Impuestos 2026*.",
    created: -9,
  },
  {
    key: "libro",
    title: "Devolverle el libro a Diego",
    priority: "low",
    due: -1,
    area: "relationships",
    created: -6,
  },
  // Due today.
  {
    key: "estudiar-d3",
    title: "Estudiar dominio 3: alto rendimiento",
    priority: "high",
    due: 0,
    project: "aws",
    milestone: "d3",
    next: true,
    tags: ["estudio"],
    notes: "Caché con ElastiCache y CloudFront, Auto Scaling y bases de datos de lectura.",
    created: -7,
  },
  {
    key: "pintura",
    title: "Comprar pintura y rodillos en Sodimac",
    priority: "medium",
    due: 0,
    project: "depa",
    milestone: "pintar",
    next: true,
    tags: ["compras", "casa"],
    notes: "- 2 galones de blanco hueso mate\n- 2 rodillos y una bandeja\n- Cinta de pintor",
    created: -3,
  },
  {
    key: "fisio",
    title: "Sesión de fisioterapia de rodilla",
    priority: "high",
    due: 0,
    area: "health",
    notes: "Llevar la resonancia y la lista de ejercicios.",
    created: -5,
  },
  {
    key: "abuela",
    title: "Llamar a la abuela",
    priority: "medium",
    due: 0,
    area: "relationships",
    created: -2,
  },
  {
    key: "estado-cuenta",
    title: "Revisar el estado de cuenta de la tarjeta",
    priority: "low",
    due: 0,
    area: "finance",
    created: -4,
  },
  {
    key: "regar",
    title: "Regar las plantas",
    priority: "medium",
    due: 0,
    area: "home",
    recurrence: { kind: "every_weeks", interval: 1 },
    tags: ["casa"],
    spawnedFrom: "regar-anterior",
    created: -7,
  },
  // Upcoming this week.
  {
    key: "cita-migraciones",
    title: "Sacar cita en Migraciones",
    priority: "high",
    due: 1,
    project: "pasaporte",
    milestone: "cita",
    next: true,
    tags: ["trámites"],
    created: -6,
  },
  {
    key: "luz",
    title: "Pagar recibo de luz",
    priority: "medium",
    due: 3,
    area: "home",
    recurrence: { kind: "month_day" },
    tags: ["casa"],
    created: -27,
  },
  {
    key: "simulacro",
    title: "Simulacro de examen AWS (65 preguntas)",
    priority: "medium",
    due: 3,
    project: "aws",
    milestone: "mock",
    tags: ["estudio"],
    created: -7,
  },
  {
    key: "transferir",
    title: "Transferir S/ 500 al fondo de emergencia",
    priority: "medium",
    due: 5,
    project: "fondo",
    next: true,
    created: -10,
  },
  {
    key: "sofia",
    title: "Reservar restaurante para el cumpleaños de Sofía",
    priority: "medium",
    due: 6,
    area: "relationships",
    created: -3,
  },
  // No date.
  {
    key: "seguro",
    title: "Comparar seguros de salud (EPS o privado)",
    priority: "low",
    area: "health",
    created: -15,
  },
  {
    key: "closet",
    title: "Separar ropa para donar",
    priority: "low",
    project: "depa",
    milestone: "closet",
    tags: ["casa"],
    created: -10,
  },
  {
    key: "casos",
    title: "Escribir el caso de estudio del dashboard de ventas",
    priority: "medium",
    project: "portafolio",
    milestone: "casos",
    next: true,
    created: -48,
  },
  {
    key: "guitarra",
    title: "Cambiar las cuerdas de la guitarra",
    priority: "low",
    area: "hobbies",
    created: -12,
  },
  // Done on past days (none today).
  {
    key: "regar-anterior",
    title: "Regar las plantas",
    priority: "medium",
    due: -7,
    done: -7,
    area: "home",
    recurrence: { kind: "every_weeks", interval: 1 },
    tags: ["casa"],
    created: -14,
  },
  {
    key: "lijar",
    title: "Lijar las paredes de la sala",
    priority: "medium",
    due: -2,
    done: -2,
    project: "depa",
    milestone: "lijar",
    created: -12,
  },
  {
    key: "inscripcion",
    title: "Inscribirme al examen AWS en Pearson VUE",
    priority: "high",
    due: -5,
    done: -6,
    project: "aws",
    tags: ["trámites"],
    created: -15,
  },
  {
    key: "internet",
    title: "Pagar internet",
    priority: "medium",
    due: -4,
    done: -4,
    area: "home",
    created: -10,
  },
  {
    key: "tasa",
    title: "Pagar la tasa del pasaporte",
    priority: "high",
    due: -6,
    done: -6,
    project: "pasaporte",
    milestone: "pago",
    tags: ["trámites"],
    created: -10,
  },
  {
    key: "examen-b2",
    title: "Rendir el examen final de inglés",
    priority: "high",
    due: -20,
    done: -20,
    project: "ingles",
    milestone: "final",
    tags: ["estudio"],
    created: -35,
  },
];

type DemoHabit = {
  key: string;
  name: string;
  area?: AreaSlug;
  identity?: string;
  cue?: string;
  kind?: "build" | "avoid";
  measure: "check" | "quantity";
  goal?: number;
  unit?: string;
  step?: number;
  frequency: "daily" | "weekly_count" | "weekdays";
  weeklyTarget?: number;
  weekdays?: number[];
  /** Days before today it started. */
  started: number;
  pause?: { start: number; end: number; reason: string };
  /**
   * The quantity logged on the day `offset` days ago (1…started), or null for no row. `rank` is
   * the day's position among the scheduled days counted back from yesterday (0 = the latest).
   */
  log: (day: { offset: number; weekday: number; rank: number }) => number | null;
  /** Today's quantity (null: nothing logged today, so "Hoy" shows it pending). */
  today: number | null;
};

const DEMO_HABITS: DemoHabit[] = [
  {
    key: "meditar",
    name: "Meditar 10 min",
    area: "health",
    identity: "Soy alguien que cuida su mente",
    cue: "Al despertar, antes del celular",
    measure: "check",
    frequency: "daily",
    started: 28,
    log: ({ offset }) => ([27, 20, 19, 13, 6].includes(offset) ? null : 1),
    today: 1,
  },
  {
    key: "leer",
    name: "Leer",
    area: "hobbies",
    identity: "Soy alguien que lee",
    cue: "Antes de dormir",
    measure: "quantity",
    goal: 20,
    unit: "páginas",
    step: 5,
    frequency: "daily",
    started: 28,
    log: ({ offset }) => {
      if ([25, 18, 17, 10, 3].includes(offset)) return null;
      return ({ 22: 10, 14: 15, 12: 25, 5: 30 } as Record<number, number>)[offset] ?? 20;
    },
    today: null,
  },
  {
    key: "agua",
    name: "Tomar agua",
    area: "health",
    measure: "quantity",
    goal: 8,
    unit: "vasos",
    step: 1,
    frequency: "daily",
    started: 14,
    log: ({ offset }) => [8, 8, 9, 8, 5, 8, 8, 7, 8, 10, 8, 6, 9, 8][offset - 1] ?? null,
    today: 3,
  },
  {
    key: "rodilla",
    name: "Ejercicios de rodilla",
    area: "health",
    identity: "Soy alguien que se recupera con constancia",
    cue: "Después del trabajo",
    measure: "check",
    frequency: "weekdays",
    weekdays: [1, 3, 5],
    started: 28,
    log: ({ rank }) => (rank === 4 || rank === 9 ? null : 1),
    today: null,
  },
  {
    key: "gimnasio",
    name: "Gimnasio",
    area: "health",
    measure: "check",
    frequency: "weekly_count",
    weeklyTarget: 3,
    started: 28,
    pause: { start: 17, end: 13, reason: "Viaje" },
    log: ({ offset, weekday }) => {
      if (![2, 4, 6].includes(weekday)) return null;
      if (offset >= 13 && offset <= 17) return null; // paused
      // One gym day skipped three weeks ago: that week falls short of its quota.
      if (offset >= 21 && offset <= 27 && weekday === 4) return null;
      return 1;
    },
    today: null,
  },
  {
    key: "ingles",
    name: "Inglés 30 min",
    area: "learning",
    cue: "En el almuerzo",
    measure: "quantity",
    goal: 30,
    unit: "min",
    step: 10,
    frequency: "weekdays",
    weekdays: [1, 2, 3, 4, 5],
    started: 28,
    log: ({ rank }) => (rank === 6 || rank === 15 ? null : rank === 11 ? 20 : 30),
    today: null,
  },
  {
    key: "pantallas",
    name: "Sin pantallas después de las 11 p. m.",
    identity: "Soy alguien que descansa bien",
    kind: "avoid",
    measure: "check",
    frequency: "daily",
    started: 28,
    // A relapse is a log; two old ones.
    log: ({ offset }) => (offset === 22 || offset === 9 ? 1 : null),
    today: null,
  },
  {
    key: "medicacion",
    name: "Medicación",
    area: "health",
    cue: "Con el desayuno y la cena",
    measure: "quantity",
    goal: 2,
    unit: "veces",
    step: 1,
    frequency: "daily",
    started: 28,
    log: ({ offset }) => (offset === 16 || offset === 4 ? 1 : 2),
    today: 1,
  },
];

// ── Row builders ────────────────────────────────────────────────────────────────────────────────

const projectId = (key: string) => demoId(`project:${key}`);
const milestoneId = (project: string, key: string) => demoId(`milestone:${project}:${key}`);
const linkId = (project: string, index: number) => demoId(`link:${project}:${index}`);
const taskId = (key: string) => demoId(`task:${key}`);
const tagId = (name: string) => demoId(`tag:${name}`);
const habitId = (key: string) => demoId(`habit:${key}`);
const pauseId = (key: string) => demoId(`pause:${key}`);

/** Every demo id, by table (what `remove` deletes; the test checks against it). */
export function demoIds() {
  return {
    projects: DEMO_PROJECTS.map((p) => projectId(p.key)),
    milestones: DEMO_PROJECTS.flatMap((p) =>
      (p.milestones ?? []).map((m) => milestoneId(p.key, m.key)),
    ),
    links: DEMO_PROJECTS.flatMap((p) => (p.links ?? []).map((_, i) => linkId(p.key, i))),
    tasks: DEMO_TASKS.map((t) => taskId(t.key)),
    tags: DEMO_TAGS.map(tagId),
    habits: DEMO_HABITS.map((h) => habitId(h.key)),
    pauses: DEMO_HABITS.filter((h) => h.pause).map((h) => pauseId(h.key)),
  };
}

/** Rows of a habit's history, oldest first (days before today, then today). */
export function habitLogRows(habit: DemoHabit, today: string, now: Date) {
  const goal = habit.goal ?? 1;
  const rows: (typeof habitLogs.$inferInsert)[] = [];
  const scheduled = (weekday: number) =>
    habit.frequency !== "weekdays" || (habit.weekdays ?? []).includes(weekday);
  let rank = 0;
  for (let offset = 1; offset <= habit.started; offset++) {
    const day = addDays(today, -offset);
    const weekday = isoWeekday(day);
    if (!scheduled(weekday)) continue;
    const quantity = habit.log({ offset, weekday, rank });
    rank++;
    if (quantity === null) continue;
    rows.push({ habitId: habitId(habit.key), day, quantity, target: goal, updatedAt: at(day, 21) });
  }
  if (habit.today !== null) {
    rows.push({
      habitId: habitId(habit.key),
      day: today,
      quantity: habit.today,
      target: goal,
      updatedAt: notAfter(at(today, 8), now),
    });
  }
  return rows.reverse();
}

/** What an insert added (rows actually written; 0 everywhere when the demo was already there). */
export type DemoCounts = {
  projects: number;
  milestones: number;
  links: number;
  dependencies: number;
  tasks: number;
  tags: number;
  tagLinks: number;
  habits: number;
  logs: number;
  pauses: number;
};

export class DemoDataError extends Error {}

async function areaIds(tx: Tx): Promise<Record<AreaSlug, string>> {
  const rows = await tx
    .select({ id: lifeAreas.id, slug: lifeAreas.slug })
    .from(lifeAreas)
    .where(inArray(lifeAreas.slug, [...AREA_SLUGS]))
    .for("share");
  const bySlug = Object.fromEntries(rows.map((row) => [row.slug, row.id]));
  const missing = AREA_SLUGS.filter((slug) => !bySlug[slug]);
  if (missing.length > 0) {
    throw new DemoDataError(
      `Missing life areas (${missing.join(", ")}). Run \`pnpm db:seed\` first. Nothing was changed.`,
    );
  }
  return bySlug as Record<AreaSlug, string>;
}

/** Inserts the demo in an open transaction that already holds the locks (`takeLocks`). */
async function insertDemoRows(tx: Tx, now: Date): Promise<DemoCounts> {
  const today = ownerDateKey(now);
  const day = (offset: number) => addDays(today, offset);
  const area = await areaIds(tx);

  // Projects, then their milestones, links and dependencies (only for the projects new now).
  const newProjects = new Set(
    (
      await tx
        .insert(projects)
        .values(
          DEMO_PROJECTS.map((p) => ({
            id: projectId(p.key),
            name: p.name,
            objective: p.objective ?? null,
            notes: p.notes ?? null,
            status: p.status,
            priority: p.priority,
            lifeAreaId: area[p.area],
            startDate: p.start === undefined ? null : day(p.start),
            dueDate: p.due === undefined ? null : day(p.due),
            completedAt: p.completed === undefined ? null : at(day(p.completed), 18),
            createdAt: at(day(p.created), 9),
            updatedAt: at(day(Math.max(p.created, p.completed ?? -1)), 18),
          })),
        )
        .onConflictDoNothing({ target: projects.id })
        .returning({ id: projects.id })
    ).map((row) => row.id),
  );
  const fresh = DEMO_PROJECTS.filter((p) => newProjects.has(projectId(p.key)));

  const milestoneRows = fresh.flatMap((p) =>
    (p.milestones ?? []).map((m, index) => ({
      id: milestoneId(p.key, m.key),
      projectId: projectId(p.key),
      title: m.title,
      dueDate: m.due === undefined ? null : day(m.due),
      doneAt: m.done === undefined ? null : at(day(m.done), 20),
      sortOrder: index, // a new project: 0…n-1
    })),
  );
  const milestones = milestoneRows.length
    ? await tx
        .insert(projectMilestones)
        .values(milestoneRows)
        .onConflictDoNothing()
        .returning({ id: projectMilestones.id })
    : [];

  const linkRows = fresh.flatMap((p) =>
    (p.links ?? []).map((link, index) => ({
      id: linkId(p.key, index),
      projectId: projectId(p.key),
      url: link.url,
      label: link.label ?? null,
      sortOrder: index,
    })),
  );
  const links = linkRows.length
    ? await tx
        .insert(projectLinks)
        .values(linkRows)
        .onConflictDoNothing()
        .returning({ id: projectLinks.id })
    : [];

  const dependencyRows = fresh.flatMap((p) =>
    (p.blockedBy ?? []).map((blocker) => ({
      projectId: projectId(p.key),
      blockedById: projectId(blocker),
    })),
  );
  const dependencies = dependencyRows.length
    ? await tx
        .insert(projectDependencies)
        .values(dependencyRows)
        .onConflictDoNothing()
        .returning({ projectId: projectDependencies.projectId })
    : [];

  // Tags: reuse the owner's tag when the name exists (names are unique).
  const tags = await tx
    .insert(taskTags)
    .values(DEMO_TAGS.map((name) => ({ id: tagId(name), name, createdAt: at(day(-30), 9) })))
    .onConflictDoNothing()
    .returning({ id: taskTags.id });
  const tagRows = await tx
    .select({ id: taskTags.id, name: taskTags.name })
    .from(taskTags)
    .where(inArray(taskTags.name, [...DEMO_TAGS]));
  const tagByName = new Map(tagRows.map((row) => [row.name, row.id]));

  // Tasks: the spawned ones after their previous occurrence (the self-reference).
  const ordered = [...DEMO_TASKS].sort(
    (a, b) => Number(Boolean(a.spawnedFrom)) - Number(Boolean(b.spawnedFrom)),
  );
  const taskRows = ordered.map((t) => {
    const due = t.due === undefined ? null : day(t.due);
    const recurrence = t.recurrence;
    return {
      id: taskId(t.key),
      title: t.title,
      notes: t.notes ?? null,
      priority: t.priority,
      dueDate: due,
      doneAt: t.done === undefined ? null : at(day(t.done), 19, 30),
      // The project's area is the task's: never both.
      lifeAreaId: t.project ? null : t.area ? area[t.area] : null,
      projectId: t.project ? projectId(t.project) : null,
      milestoneId: t.project && t.milestone ? milestoneId(t.project, t.milestone) : null,
      isNextAction: Boolean(t.next && t.project && t.done === undefined),
      recurrenceKind: recurrence?.kind ?? null,
      recurrenceInterval: recurrence && "interval" in recurrence ? recurrence.interval : null,
      recurrenceWeekdays: recurrence?.kind === "weekdays" ? recurrence.weekdays : null,
      // Day X of the month: the day it is due.
      recurrenceMonthDay: recurrence?.kind === "month_day" && due ? Number(due.slice(8, 10)) : null,
      spawnedFromId: t.spawnedFrom ? taskId(t.spawnedFrom) : null,
      createdAt: notAfter(at(day(t.created), 8, 15), now),
      updatedAt: notAfter(at(day(t.done ?? t.created), 19, 30), now),
    };
  });
  const newTasks = new Set(
    (
      await tx
        .insert(tasks)
        .values(taskRows)
        .onConflictDoNothing({ target: tasks.id })
        .returning({ id: tasks.id })
    ).map((row) => row.id),
  );
  const tagLinkRows = DEMO_TASKS.filter((t) => newTasks.has(taskId(t.key))).flatMap((t) =>
    (t.tags ?? []).map((name) => ({ taskId: taskId(t.key), tagId: tagByName.get(name) as string })),
  );
  const tagLinks = tagLinkRows.length
    ? await tx
        .insert(taskTagLinks)
        .values(tagLinkRows)
        .onConflictDoNothing()
        .returning({ taskId: taskTagLinks.taskId })
    : [];

  // Habits: appended at the end of the order (deleted and archived ones hold slots too), like a
  // new habit under the order lock; only the ones not there yet get a slot.
  const existing = new Set(
    (
      await tx.select({ id: habits.id }).from(habits).where(inArray(habits.id, demoIds().habits))
    ).map((row) => row.id),
  );
  const missingHabits = DEMO_HABITS.filter((h) => !existing.has(habitId(h.key)));
  const [{ next }] = await tx
    .select({ next: sql<number>`coalesce(max(${habits.sortOrder}) + 1, 0)`.mapWith(Number) })
    .from(habits);
  const newHabits = missingHabits.length
    ? await tx
        .insert(habits)
        .values(
          missingHabits.map((h, index) => ({
            id: habitId(h.key),
            name: h.name,
            identity: h.identity ?? null,
            cue: h.cue ?? null,
            kind: h.kind ?? "build",
            lifeAreaId: h.area ? area[h.area] : null,
            measure: h.measure,
            goal: h.goal ?? 1,
            unit: h.unit ?? null,
            step: h.step ?? 1,
            frequency: h.frequency,
            weeklyTarget: h.weeklyTarget ?? null,
            weekdays: h.weekdays ?? null,
            startDate: day(-h.started),
            sortOrder: next + index,
            createdAt: at(day(-h.started), 7),
            updatedAt: at(day(-h.started), 7),
          })),
        )
        .onConflictDoNothing({ target: habits.id })
        .returning({ id: habits.id })
    : [];
  const insertedHabits = new Set(newHabits.map((row) => row.id));
  const freshHabits = DEMO_HABITS.filter((h) => insertedHabits.has(habitId(h.key)));
  const logRows = freshHabits.flatMap((h) => habitLogRows(h, today, now));
  const logs = logRows.length
    ? await tx
        .insert(habitLogs)
        .values(logRows)
        .onConflictDoNothing()
        .returning({ day: habitLogs.day })
    : [];
  const pauseRows = freshHabits.flatMap((h) =>
    h.pause
      ? [
          {
            id: pauseId(h.key),
            habitId: habitId(h.key),
            startDate: day(-h.pause.start),
            endDate: day(-h.pause.end),
            reason: h.pause.reason,
            createdAt: at(day(-h.pause.start - 1), 20),
          },
        ]
      : [],
  );
  const pauses = pauseRows.length
    ? await tx
        .insert(habitPauses)
        .values(pauseRows)
        .onConflictDoNothing()
        .returning({ id: habitPauses.id })
    : [];

  return {
    projects: fresh.length,
    milestones: milestones.length,
    links: links.length,
    dependencies: dependencies.length,
    tasks: newTasks.size,
    tags: tags.length,
    tagLinks: tagLinks.length,
    habits: newHabits.length,
    logs: logs.length,
    pauses: pauses.length,
  };
}

/** Inserts the demo (idempotent: rows already there are left as they are). One transaction. */
export async function insertDemoData(db: Database, now: Date): Promise<DemoCounts> {
  return db.transaction(async (tx) => {
    await takeLocks(tx);
    return insertDemoRows(tx, now);
  });
}

// ── Remove ──────────────────────────────────────────────────────────────────────────────────────

export type RemoveResult = {
  projects: number;
  tasks: number;
  tags: number;
  habits: number;
  logs: number;
  pauses: number;
  /** The owner's own tasks that were inside a demo project: moved to that project's area. */
  detachedTasks: number;
};

/**
 * Deletes the demo rows and their children, and nothing else, in one transaction:
 * - the demo tasks and every occurrence spawned from them (completing a demo recurring task
 *   creates one with a random id); their tag links go with them;
 * - the owner's own tasks inside a demo project are kept and moved to that project's area
 *   (without project, milestone or next-action mark), so nothing real is lost;
 * - a demo tag is deleted only if no task is left with it (the owner may have used it);
 * - the demo habits with all their logs and pauses; the order of the rest is renumbered 0…n-1
 *   (unchanged when the demo was still at the end);
 * - the demo projects, with their milestones, links and dependencies (cascade).
 */
export async function removeDemoData(db: Database): Promise<RemoveResult> {
  const ids = demoIds();
  return db.transaction(async (tx) => {
    await takeLocks(tx);

    const closure = await tx.execute<{ id: string }>(sql`
      with recursive chain(id) as (
        select id from tasks where id in (${sql.join(
          ids.tasks.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})
        union
        select t.id from tasks t join chain c on t.spawned_from_id = c.id
      )
      select id from chain`);
    const taskIds = closure.rows.map((row) => row.id);

    const detached = await tx.execute(sql`
      update tasks t
      set project_id = null, milestone_id = null, is_next_action = false,
          life_area_id = p.life_area_id, updated_at = now()
      from projects p
      where p.id = t.project_id
        and t.project_id in (${sql.join(
          ids.projects.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})
        ${
          taskIds.length
            ? sql`and t.id not in (${sql.join(
                taskIds.map((id) => sql`${id}::uuid`),
                sql`, `,
              )})`
            : sql``
        }`);

    let removedTasks = 0;
    if (taskIds.length) {
      // The self-reference is RESTRICT: unlink the chain before deleting it.
      await tx.update(tasks).set({ spawnedFromId: null }).where(inArray(tasks.id, taskIds));
      removedTasks = (
        await tx.delete(tasks).where(inArray(tasks.id, taskIds)).returning({ id: tasks.id })
      ).length;
    }
    const removedTags = await tx
      .delete(taskTags)
      .where(
        and(
          inArray(taskTags.id, ids.tags),
          sql`not exists (select 1 from task_tag_links l where l.tag_id = ${taskTags.id})`,
        ),
      )
      .returning({ id: taskTags.id });

    const logs = await tx
      .delete(habitLogs)
      .where(inArray(habitLogs.habitId, ids.habits))
      .returning({ day: habitLogs.day });
    const pauses = await tx
      .delete(habitPauses)
      .where(inArray(habitPauses.habitId, ids.habits))
      .returning({ id: habitPauses.id });
    const removedHabits = await tx
      .delete(habits)
      .where(inArray(habits.id, ids.habits))
      .returning({ id: habits.id });
    if (removedHabits.length) {
      await tx.execute(sql`
        update habits h set sort_order = r.position
        from (select id, (row_number() over (order by sort_order, id) - 1)::int as position from habits) r
        where r.id = h.id and h.sort_order <> r.position`);
    }

    const removedProjects = await tx
      .delete(projects)
      .where(inArray(projects.id, ids.projects))
      .returning({ id: projects.id });

    return {
      projects: removedProjects.length,
      tasks: removedTasks,
      tags: removedTags.length,
      habits: removedHabits.length,
      logs: logs.length,
      pauses: pauses.length,
      detachedTasks: detached.rowCount ?? 0,
    };
  });
}

// ── Replace (destructive) ───────────────────────────────────────────────────────────────────────

/** The tables `replace` empties, children first (the order the foreign keys ask for). */
export const MODULE_TABLES = [
  "task_tag_links",
  "task_tags",
  "tasks",
  "project_dependencies",
  "project_links",
  "project_milestones",
  "projects",
  "habit_logs",
  "habit_pauses",
  "habits",
] as const;

export type ModuleTable = (typeof MODULE_TABLES)[number];

/** Rows per module table (soft-deleted ones included). */
export async function countModuleRows(db: Database | Tx): Promise<Record<ModuleTable, number>> {
  const counts = {} as Record<ModuleTable, number>;
  for (const table of MODULE_TABLES) {
    const result = await db.execute<{ count: number }>(
      sql`select count(*)::int as count from ${sql.identifier(table)}`,
    );
    counts[table] = Number(result.rows[0]?.count ?? 0);
  }
  return counts;
}

/**
 * DESTRUCTIVE: deletes every row of projects, tasks and habits (soft-deleted ones too, with
 * their milestones, links, dependencies, tags, logs and pauses) and inserts the demo, in one
 * transaction. Never touches `core` (areas, settings, auth tables). Returns what it deleted.
 */
export async function replaceWithDemoData(
  db: Database,
  now: Date,
): Promise<{ deleted: Record<ModuleTable, number>; inserted: DemoCounts }> {
  return db.transaction(async (tx) => {
    await takeLocks(tx);
    // Fail before deleting anything when the areas are missing.
    await areaIds(tx);
    const deleted = await countModuleRows(tx);
    // The self-reference of tasks is RESTRICT: unlink the occurrences first.
    await tx
      .update(tasks)
      .set({ spawnedFromId: null })
      .where(sql`${tasks.spawnedFromId} is not null`);
    for (const table of MODULE_TABLES) {
      await tx.execute(sql`delete from ${sql.identifier(table)}`);
    }
    const inserted = await insertDemoRows(tx, now);
    return { deleted, inserted };
  });
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────

const MODES = ["insert", "remove", "replace"] as const;
type Mode = (typeof MODES)[number];

/** Demo rows present now (for the summary before `remove`). */
async function countDemoRows(db: Database) {
  const ids = demoIds();
  const [p] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(projects)
    .where(inArray(projects.id, ids.projects));
  const [t] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(inArray(tasks.id, ids.tasks));
  const [h] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(habits)
    .where(inArray(habits.id, ids.habits));
  return { projects: p.n, tasks: t.n, habits: h.n };
}

async function confirmHost(url: string): Promise<boolean> {
  if (isLocalDatabaseUrl(url)) return true;
  const host = databaseHost(url);
  const typed = await prompt(`Remote database. Type its host (${host}) to continue: `, {
    hidden: false,
  });
  return typed.trim() === host;
}

const summary = (counts: Record<string, number>) =>
  Object.entries(counts)
    .map(([name, value]) => `  ${name}: ${value}`)
    .join("\n");

async function main() {
  const mode = process.argv[2] as Mode;
  if (!MODES.includes(mode)) {
    console.error(`Usage: tsx scripts/demo-data.ts <${MODES.join("|")}>`);
    process.exit(1);
  }
  let url: string;
  try {
    url = resolveOwnerScriptDatabaseUrl(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
  if (!process.stdin.isTTY && (!isLocalDatabaseUrl(url) || mode === "replace")) {
    console.error("Run this in an interactive terminal: the confirmation is typed.");
    process.exit(1);
  }
  console.log(`Target database: ${describeDatabaseTarget(url)}`);
  const db = createDb(url);
  try {
    const now = new Date();
    if (mode === "insert") {
      console.log(`Demo data for ${ownerDateKey(now)} (Lima).`);
      if (!(await confirmHost(url))) return fail("The host does not match. Nothing was changed.");
      const counts = await insertDemoData(db, now);
      console.log(`Inserted (rows already there were left as they are):\n${summary(counts)}`);
    } else if (mode === "remove") {
      console.log(`Demo rows present:\n${summary(await countDemoRows(db))}`);
      if (!(await confirmHost(url))) return fail("The host does not match. Nothing was changed.");
      const result = await removeDemoData(db);
      console.log(`Removed:\n${summary(result)}`);
    } else {
      console.log("DESTRUCTIVE: deletes EVERY project, task and habit (soft-deleted ones too).");
      console.log("Areas, settings and the owner's account are kept. Rows that will be deleted:");
      console.log(summary(await countModuleRows(db)));
      if (!(await confirmHost(url))) return fail("The host does not match. Nothing was changed.");
      const word = await prompt("Type BORRAR to delete them and insert the demo: ", {
        hidden: false,
      });
      if (word.trim() !== "BORRAR") return fail("Not confirmed. Nothing was changed.");
      const { deleted, inserted } = await replaceWithDemoData(db, now);
      console.log(`Deleted:\n${summary(deleted)}\nInserted:\n${summary(inserted)}`);
    }
  } finally {
    await db.$client.end();
  }
}

function fail(message: string) {
  console.error(message);
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    // Our own messages are safe; anything else (Postgres, Drizzle) may quote values.
    if (error instanceof DemoDataError || (error instanceof Error && error.message === CANCELLED)) {
      console.error(error.message);
    } else {
      console.error("Failed, nothing was changed:", describeError(error));
    }
    process.exit(1);
  });
}
