// Copy of the records and the history (E3, SPEC-health "Récords", "Al terminar", "Detalle del
// ejercicio"), in Spanish. Client-safe. No guilt (tests/modules/health-copy.test.ts scans it).
import { formatDuration } from "./format";
import type { RecordMetric } from "./records";
import { formatKg, formatKm } from "./weight";

const METRIC_LABELS: Record<RecordMetric, string> = {
  maxWeight: "Peso máximo",
  e1rm: "1RM estimado",
  maxReps: "Más repeticiones",
  maxSeconds: "Más tiempo",
  maxDistance: "Más distancia",
};

const LINE_TITLES: Record<RecordMetric, string> = {
  maxWeight: "Mejor peso por sesión",
  e1rm: "Mejor 1RM estimado por sesión",
  maxReps: "Más repeticiones por sesión",
  maxSeconds: "Más tiempo por sesión",
  maxDistance: "Más distancia por sesión",
};

/** A record's value as the screens write it: «82,5 kg», «15 repeticiones», «1 min 30 s», «5,2 km». */
export function recordValue(metric: RecordMetric, value: number): string {
  switch (metric) {
    case "maxWeight":
    case "e1rm":
      return formatKg(value);
    case "maxReps":
      return value === 1 ? "1 repetición" : `${value} repeticiones`;
    case "maxSeconds":
      return formatDuration(value);
    case "maxDistance":
      return formatKm(value);
    default:
      return String(value);
  }
}

export const RECORDS_COPY = {
  metricLabel: METRIC_LABELS,
  lineTitle: LINE_TITLES,

  // ── A session's summary and the session rows ───────────────────────────────────────────
  newCount: (count: number) => (count === 1 ? "1 récord nuevo" : `${count} récords nuevos`),
  rowCount: (count: number) => (count === 1 ? "1 récord" : `${count} récords`),
  newListLabel: "Récords nuevos",
  /** «Sentadilla con barra: 82,5 kg», «Press de banca: 1RM estimado 79 kg». */
  newRecord: (exercise: string, metric: RecordMetric, value: number) =>
    metric === "e1rm"
      ? `${exercise}: ${METRIC_LABELS.e1rm} ${recordValue(metric, value)}`
      : `${exercise}: ${recordValue(metric, value)}`,

  // ── The exercise's page ────────────────────────────────────────────────────────────────
  title: "Récords",
  empty: "Cuando lo entrenes, aquí verás tus récords.",
  listLabel: "Récords del ejercicio",
  recordDay: (day: string) => `el ${day}`,
  openRecordSession: (label: string, value: string, day: string) =>
    `${label}, ${value}: abrir la sesión del ${day}`,
  noRecords: "Estas series no tienen valores que den récords (por ejemplo, peso 0).",
  lineWindow: "Últimos 12 meses",
  lineEmpty: "En los últimos 12 meses no hay sesiones con este ejercicio.",
  lineOnePoint: "La línea aparece desde tu segunda sesión.",
  lineTable: (title: string) => `${title}, últimos 12 meses`,
  columnDay: "Fecha",
  columnBest: "Mejor",
  lineRange: (low: string, high: string) => (low === high ? high : `De ${low} a ${high}`),
  historyTitle: "Historial",
  historyLabel: "Historial por sesión",
  historyCount: (count: number) => (count === 1 ? "1 sesión" : `${count} sesiones`),
  seeMore: "Ver más",
  historyShown: (shown: number, total: number) =>
    `Mostrando ${shown} de ${total} ${total === 1 ? "sesión" : "sesiones"}.`,
} as const;
