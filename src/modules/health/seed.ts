// The catalogue's seed (SPEC-health "Anexo"): 64 common exercises, written for the app in Spanish
// (free-exercise-db, public domain, only as a reference; nothing copied from openGym). Client-safe
// data. Migration 0029 inserts exactly these rows (ids derived with md5 from `seedKey`, ON CONFLICT
// DO NOTHING); tests/modules/health-seed.test.ts parses the migration and fails if the two drift.
// Once inserted, a seed exercise is like any other: it can be renamed, edited and deleted.
import type { Equipment, ExerciseKind, MuscleGroup } from "./health-constants";

export type SeedExercise = {
  /** Stable, English; never shown. */
  seedKey: string;
  name: string;
  kind: ExerciseKind;
  muscleGroup: MuscleGroup;
  equipment: Equipment;
  /** The weight written is one dumbbell's. */
  perDumbbell: boolean;
};

const lift = (
  seedKey: string,
  name: string,
  muscleGroup: MuscleGroup,
  equipment: Equipment,
  perDumbbell = false,
): SeedExercise => ({ seedKey, name, kind: "weight_reps", muscleGroup, equipment, perDumbbell });

/** One dumbbell's weight (★ in the spec). */
const pair = (seedKey: string, name: string, muscleGroup: MuscleGroup) =>
  lift(seedKey, name, muscleGroup, "dumbbell", true);

const other = (
  seedKey: string,
  name: string,
  kind: ExerciseKind,
  muscleGroup: MuscleGroup,
  equipment: Equipment,
): SeedExercise => ({ seedKey, name, kind, muscleGroup, equipment, perDumbbell: false });

export const SEED_EXERCISES: readonly SeedExercise[] = [
  // Pecho (10)
  lift("barbell_bench_press", "Press de banca con barra", "chest", "barbell"),
  lift("barbell_incline_press", "Press inclinado con barra", "chest", "barbell"),
  pair("dumbbell_bench_press", "Press de banca con mancuernas", "chest"),
  pair("dumbbell_incline_press", "Press inclinado con mancuernas", "chest"),
  pair("dumbbell_fly", "Aperturas con mancuernas", "chest"),
  lift("cable_crossover", "Cruce de poleas", "chest", "cable"),
  lift("machine_chest_press", "Press de pecho en máquina", "chest", "machine"),
  lift("machine_chest_fly", "Contractora de pecho", "chest", "machine"),
  other("parallel_bar_dips", "Fondos en paralelas", "reps", "chest", "bodyweight"),
  other("push_up", "Flexiones", "reps", "chest", "bodyweight"),
  // Espalda (9)
  other("pull_up", "Dominadas", "reps", "back", "bodyweight"),
  lift("lat_pulldown", "Jalón al pecho", "back", "cable"),
  lift("barbell_row", "Remo con barra", "back", "barbell"),
  pair("dumbbell_row", "Remo con mancuerna", "back"),
  lift("seated_cable_row", "Remo en polea baja", "back", "cable"),
  lift("machine_row", "Remo en máquina", "back", "machine"),
  lift("deadlift", "Peso muerto", "back", "barbell"),
  lift("cable_pullover", "Pullover en polea", "back", "cable"),
  other("back_extension", "Hiperextensiones", "reps", "back", "bodyweight"),
  // Hombros (7)
  lift("barbell_overhead_press", "Press militar con barra", "shoulders", "barbell"),
  pair("dumbbell_shoulder_press", "Press de hombros con mancuernas", "shoulders"),
  pair("lateral_raise", "Elevaciones laterales", "shoulders"),
  pair("front_raise", "Elevaciones frontales", "shoulders"),
  pair("rear_delt_fly", "Pájaros", "shoulders"),
  lift("face_pull", "Face pull", "shoulders", "cable"),
  pair("dumbbell_shrug", "Encogimientos con mancuernas", "shoulders"),
  // Bíceps (5)
  lift("barbell_curl", "Curl con barra", "biceps", "barbell"),
  pair("dumbbell_curl", "Curl con mancuernas", "biceps"),
  pair("hammer_curl", "Curl martillo", "biceps"),
  lift("cable_curl", "Curl en polea", "biceps", "cable"),
  lift("preacher_curl", "Curl predicador", "biceps", "machine"),
  // Tríceps (5)
  lift("cable_triceps_pushdown", "Extensión de tríceps en polea", "triceps", "cable"),
  lift("skull_crusher", "Press francés", "triceps", "barbell"),
  lift(
    "overhead_dumbbell_extension",
    "Extensión sobre la cabeza con mancuerna",
    "triceps",
    "dumbbell",
  ),
  other("bench_dips", "Fondos en banco", "reps", "triceps", "bodyweight"),
  lift("close_grip_bench_press", "Press de banca con agarre cerrado", "triceps", "barbell"),
  // Piernas (16)
  lift("barbell_squat", "Sentadilla con barra", "quads", "barbell"),
  lift("front_squat", "Sentadilla frontal", "quads", "barbell"),
  lift("goblet_squat", "Sentadilla goblet", "quads", "dumbbell"),
  lift("leg_press", "Prensa de piernas", "quads", "machine"),
  lift("leg_extension", "Extensión de cuádriceps", "quads", "machine"),
  pair("dumbbell_lunge", "Zancadas con mancuernas", "quads"),
  pair("bulgarian_split_squat", "Sentadilla búlgara", "quads"),
  lift("romanian_deadlift", "Peso muerto rumano", "hamstrings", "barbell"),
  lift("lying_leg_curl", "Curl femoral tumbado", "hamstrings", "machine"),
  lift("seated_leg_curl", "Curl femoral sentado", "hamstrings", "machine"),
  lift("hip_thrust", "Hip thrust", "glutes", "barbell"),
  lift("cable_glute_kickback", "Patada de glúteo en polea", "glutes", "cable"),
  lift("machine_hip_abduction", "Abductores en máquina", "glutes", "machine"),
  lift("machine_hip_adduction", "Aductores en máquina", "quads", "machine"),
  lift("standing_calf_raise", "Elevación de talones de pie", "calves", "machine"),
  lift("seated_calf_raise", "Elevación de talones sentado", "calves", "machine"),
  // Abdomen (6)
  other("plank", "Plancha", "time", "abs", "bodyweight"),
  other("side_plank", "Plancha lateral", "time", "abs", "bodyweight"),
  other("crunch", "Crunch", "reps", "abs", "bodyweight"),
  other("hanging_leg_raise", "Elevación de piernas colgado", "reps", "abs", "bodyweight"),
  other("ab_wheel_rollout", "Rueda abdominal", "reps", "abs", "other"),
  lift("cable_crunch", "Crunch en polea", "abs", "cable"),
  // Cardio (6). The rowing machine is «Remo ergómetro»: «Remo en máquina» is the back exercise
  // above, and two live exercises can't share a name.
  other("treadmill", "Cinta", "cardio", "cardio", "machine"),
  other("stationary_bike", "Bicicleta estática", "cardio", "cardio", "machine"),
  other("elliptical", "Elíptica", "cardio", "cardio", "machine"),
  other("rowing_machine", "Remo ergómetro", "cardio", "cardio", "machine"),
  other("stair_climber", "Escaladora", "cardio", "cardio", "machine"),
  other("jump_rope", "Saltar la cuerda", "cardio", "cardio", "other"),
];
