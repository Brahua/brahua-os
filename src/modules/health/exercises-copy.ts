// Copy of the exercise catalogue (SPEC-health "Catálogo", "Pantallas"), in Spanish. Client-safe.
// No guilt (tests/modules/health-copy.test.ts scans it with the rest of the module's copy).
import {
  EXERCISE_NAME_MAX_LENGTH,
  REST_MAX_SECONDS,
  REST_MIN_SECONDS,
  type Equipment,
  type ExerciseKind,
  type MuscleGroup,
} from "./health-constants";
import { formatDuration } from "./format";

export const KIND_LABELS: Record<ExerciseKind, string> = {
  weight_reps: "Peso y repeticiones",
  reps: "Repeticiones",
  time: "Tiempo",
  cardio: "Cardio (tiempo y distancia)",
};

export const GROUP_LABELS: Record<MuscleGroup, string> = {
  chest: "Pecho",
  back: "Espalda",
  shoulders: "Hombros",
  biceps: "Bíceps",
  triceps: "Tríceps",
  forearms: "Antebrazo",
  abs: "Abdomen",
  quads: "Cuádriceps",
  hamstrings: "Isquiotibiales",
  glutes: "Glúteos",
  calves: "Pantorrillas",
  full_body: "Cuerpo completo",
  cardio: "Cardio",
};

export const EQUIPMENT_LABELS: Record<Equipment, string> = {
  barbell: "Barra",
  dumbbell: "Mancuernas",
  machine: "Máquina",
  cable: "Polea",
  bodyweight: "Peso corporal",
  kettlebell: "Kettlebell",
  band: "Banda",
  other: "Otro",
};

export const EXERCISE_ERRORS = {
  nameRequired: "Ponle un nombre.",
  nameTooLong: `Usa ${EXERCISE_NAME_MAX_LENGTH} caracteres como máximo.`,
  invisible: "Quita los caracteres invisibles o de control.",
  nameTaken: "Ya existe un ejercicio con ese nombre.",
  kind: "Elige cómo se mide.",
  group: "Elige el grupo muscular.",
  equipment: "Elige el equipo.",
  rest: `El descanso va de ${formatDuration(REST_MIN_SECONDS)} a ${formatDuration(REST_MAX_SECONDS)}.`,
  perDumbbell: "Indica si el peso es por mancuerna.",
  notFound: "Este ejercicio ya no existe (se eliminó). Ya ves el catálogo actual.",
  inRoutine: (routine: string) =>
    `Está en la rutina «${routine}». Quítalo de ahí antes de eliminarlo o de cambiar cómo se mide.`,
} as const;

export const EXERCISES_COPY = {
  pageTitle: "Ejercicios",
  backToHealth: "Entreno",
  backToList: "Ejercicios",
  newExercise: "Nuevo ejercicio",
  searchLabel: "Buscar ejercicio",
  searchHelp: "Sin importar mayúsculas ni acentos.",
  groupFilter: "Grupo",
  allGroups: "Todos los grupos",
  results: (count: number) => (count === 1 ? "1 ejercicio." : `${count} ejercicios.`),
  noResults: "Ningún ejercicio coincide. Prueba otra palabra o crea uno nuevo.",
  noResultsInGroup: "Este grupo no tiene ejercicios. Elige otro grupo o crea uno nuevo.",
  createNamed: (name: string) => `Crear «${name}»`,
  groupName: (group: string, count: number) =>
    `${group}, ${count} ${count === 1 ? "ejercicio" : "ejercicios"}`,
  perDumbbell: "Por mancuerna",
  rowMeta: (equipment: string, kind: string) => `${equipment} · ${kind}`,

  // ── The form (new exercise and its page) ───────────────────────────────────────────────
  newSheetTitle: "Nuevo ejercicio",
  nameLabel: "Nombre",
  namePlaceholder: "Press de banca con barra",
  kindLabel: "Cómo se mide",
  groupLabel: "Grupo muscular",
  equipmentLabel: "Equipo",
  perDumbbellLabel: "El peso es por mancuerna",
  perDumbbellHelp: "Anotas lo que marca una mancuerna, no la suma de las dos.",
  restLabel: "Descanso entre series",
  restHelp: "Una rutina puede usar otro.",
  create: "Crear ejercicio",

  // ── Its page ───────────────────────────────────────────────────────────────────────────
  detailTitle: (name: string) => `${name} · Ejercicios · brahua-os`,
  notFoundTitle: "Ejercicio no encontrado · brahua-os",
  notFoundLcd: "SIN EJERCICIO",
  notFoundHeading: "Este ejercicio no existe",
  notFoundText: "Puede que se haya eliminado o que el enlace esté mal.",
  dataTitle: "Datos",
  summary: (group: string, equipment: string) => `${group} · ${equipment}`,
  deleteExercise: "Eliminar",

  // ── Notices ────────────────────────────────────────────────────────────────────────────
  createdTitle: "Ejercicio creado",
  created: (name: string) => `«${name}» está en el catálogo.`,
  savedTitle: "Guardado",
  saved: (name: string) => `Se guardó «${name}».`,
  deletedTitle: "Ejercicio eliminado",
  deleted: (name: string) => `«${name}» se eliminó del catálogo.`,
  restored: (name: string) => `«${name}» volvió al catálogo.`,
  notSaved: {
    create: "No se creó el ejercicio.",
    update: "No se guardó el ejercicio.",
    delete: "No se eliminó el ejercicio.",
  },
} as const;
