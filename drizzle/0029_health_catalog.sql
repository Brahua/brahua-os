CREATE TABLE "health_exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seed_key" text,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"kind" text NOT NULL,
	"muscle_group" text NOT NULL,
	"equipment" text NOT NULL,
	"per_dumbbell" boolean DEFAULT false NOT NULL,
	"rest_seconds" integer DEFAULT 90 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "health_exercises_name_check" CHECK (char_length("health_exercises"."name") between 1 and 80),
	CONSTRAINT "health_exercises_name_key_check" CHECK (char_length("health_exercises"."name_key") >= 1),
	CONSTRAINT "health_exercises_kind_check" CHECK ("health_exercises"."kind" in ('weight_reps', 'reps', 'time', 'cardio')),
	CONSTRAINT "health_exercises_muscle_group_check" CHECK ("health_exercises"."muscle_group" in ('chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms', 'abs', 'quads', 'hamstrings', 'glutes', 'calves', 'full_body', 'cardio')),
	CONSTRAINT "health_exercises_equipment_check" CHECK ("health_exercises"."equipment" in ('barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'kettlebell', 'band', 'other')),
	CONSTRAINT "health_exercises_rest_check" CHECK ("health_exercises"."rest_seconds" between 30 and 600)
);
--> statement-breakpoint
CREATE TABLE "health_routine_exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"routine_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"target_sets" integer NOT NULL,
	"reps_min" integer,
	"reps_max" integer,
	"target_seconds" integer,
	"rest_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "health_routine_exercises_sets_check" CHECK ("health_routine_exercises"."target_sets" between 1 and 10),
	CONSTRAINT "health_routine_exercises_reps_check" CHECK (("health_routine_exercises"."reps_min" is null) = ("health_routine_exercises"."reps_max" is null) and ("health_routine_exercises"."reps_min" is null or ("health_routine_exercises"."reps_min" between 1 and 100 and "health_routine_exercises"."reps_max" between 1 and 100 and "health_routine_exercises"."reps_min" <= "health_routine_exercises"."reps_max"))),
	CONSTRAINT "health_routine_exercises_seconds_check" CHECK ("health_routine_exercises"."target_seconds" is null or "health_routine_exercises"."target_seconds" between 1 and 36000),
	CONSTRAINT "health_routine_exercises_target_check" CHECK ("health_routine_exercises"."reps_min" is null or "health_routine_exercises"."target_seconds" is null),
	CONSTRAINT "health_routine_exercises_rest_check" CHECK ("health_routine_exercises"."rest_seconds" is null or "health_routine_exercises"."rest_seconds" between 30 and 600),
	CONSTRAINT "health_routine_exercises_position_check" CHECK ("health_routine_exercises"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "health_routines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "health_routines_name_check" CHECK (char_length("health_routines"."name") between 1 and 60),
	CONSTRAINT "health_routines_position_check" CHECK ("health_routines"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "health_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"habit_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "health_settings_single_row_check" CHECK ("health_settings"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "health_routine_exercises" ADD CONSTRAINT "health_routine_exercises_routine_id_health_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."health_routines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_routine_exercises" ADD CONSTRAINT "health_routine_exercises_exercise_id_health_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."health_exercises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_settings" ADD CONSTRAINT "health_settings_habit_id_habits_id_fk" FOREIGN KEY ("habit_id") REFERENCES "public"."habits"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "health_exercises_name_key_unique" ON "health_exercises" USING btree ("name_key") WHERE "health_exercises"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "health_exercises_seed_key_unique" ON "health_exercises" USING btree ("seed_key") WHERE "health_exercises"."seed_key" is not null;--> statement-breakpoint
CREATE INDEX "health_routine_exercises_routine_idx" ON "health_routine_exercises" USING btree ("routine_id","position") WHERE "health_routine_exercises"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "health_routine_exercises_exercise_idx" ON "health_routine_exercises" USING btree ("exercise_id") WHERE "health_routine_exercises"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "health_routines_position_idx" ON "health_routines" USING btree ("position") WHERE "health_routines"."deleted_at" is null;--> statement-breakpoint
-- E1 of health: the catalogue's seed (src/modules/health/seed.ts, SPEC-health "Anexo"), the 64
-- exercises written for the app. The ids derive from the stable seed key (md5 → uuid) and every
-- conflict is skipped, so running it again inserts nothing (tests/integration/health-catalog.test.ts),
-- and tests/modules/health-seed.test.ts fails if these rows drift from seed.ts. `name_key` is the
-- name lowercased without accents, as the app computes it (name-key.ts).
INSERT INTO "health_exercises" ("id", "seed_key", "name", "name_key", "kind", "muscle_group", "equipment", "per_dumbbell") VALUES
  (md5('health:exercise:barbell_bench_press')::uuid, 'barbell_bench_press', 'Press de banca con barra', 'press de banca con barra', 'weight_reps', 'chest', 'barbell', false),
  (md5('health:exercise:barbell_incline_press')::uuid, 'barbell_incline_press', 'Press inclinado con barra', 'press inclinado con barra', 'weight_reps', 'chest', 'barbell', false),
  (md5('health:exercise:dumbbell_bench_press')::uuid, 'dumbbell_bench_press', 'Press de banca con mancuernas', 'press de banca con mancuernas', 'weight_reps', 'chest', 'dumbbell', true),
  (md5('health:exercise:dumbbell_incline_press')::uuid, 'dumbbell_incline_press', 'Press inclinado con mancuernas', 'press inclinado con mancuernas', 'weight_reps', 'chest', 'dumbbell', true),
  (md5('health:exercise:dumbbell_fly')::uuid, 'dumbbell_fly', 'Aperturas con mancuernas', 'aperturas con mancuernas', 'weight_reps', 'chest', 'dumbbell', true),
  (md5('health:exercise:cable_crossover')::uuid, 'cable_crossover', 'Cruce de poleas', 'cruce de poleas', 'weight_reps', 'chest', 'cable', false),
  (md5('health:exercise:machine_chest_press')::uuid, 'machine_chest_press', 'Press de pecho en máquina', 'press de pecho en maquina', 'weight_reps', 'chest', 'machine', false),
  (md5('health:exercise:machine_chest_fly')::uuid, 'machine_chest_fly', 'Contractora de pecho', 'contractora de pecho', 'weight_reps', 'chest', 'machine', false),
  (md5('health:exercise:parallel_bar_dips')::uuid, 'parallel_bar_dips', 'Fondos en paralelas', 'fondos en paralelas', 'reps', 'chest', 'bodyweight', false),
  (md5('health:exercise:push_up')::uuid, 'push_up', 'Flexiones', 'flexiones', 'reps', 'chest', 'bodyweight', false),
  (md5('health:exercise:pull_up')::uuid, 'pull_up', 'Dominadas', 'dominadas', 'reps', 'back', 'bodyweight', false),
  (md5('health:exercise:lat_pulldown')::uuid, 'lat_pulldown', 'Jalón al pecho', 'jalon al pecho', 'weight_reps', 'back', 'cable', false),
  (md5('health:exercise:barbell_row')::uuid, 'barbell_row', 'Remo con barra', 'remo con barra', 'weight_reps', 'back', 'barbell', false),
  (md5('health:exercise:dumbbell_row')::uuid, 'dumbbell_row', 'Remo con mancuerna', 'remo con mancuerna', 'weight_reps', 'back', 'dumbbell', true),
  (md5('health:exercise:seated_cable_row')::uuid, 'seated_cable_row', 'Remo en polea baja', 'remo en polea baja', 'weight_reps', 'back', 'cable', false),
  (md5('health:exercise:machine_row')::uuid, 'machine_row', 'Remo en máquina', 'remo en maquina', 'weight_reps', 'back', 'machine', false),
  (md5('health:exercise:deadlift')::uuid, 'deadlift', 'Peso muerto', 'peso muerto', 'weight_reps', 'back', 'barbell', false),
  (md5('health:exercise:cable_pullover')::uuid, 'cable_pullover', 'Pullover en polea', 'pullover en polea', 'weight_reps', 'back', 'cable', false),
  (md5('health:exercise:back_extension')::uuid, 'back_extension', 'Hiperextensiones', 'hiperextensiones', 'reps', 'back', 'bodyweight', false),
  (md5('health:exercise:barbell_overhead_press')::uuid, 'barbell_overhead_press', 'Press militar con barra', 'press militar con barra', 'weight_reps', 'shoulders', 'barbell', false),
  (md5('health:exercise:dumbbell_shoulder_press')::uuid, 'dumbbell_shoulder_press', 'Press de hombros con mancuernas', 'press de hombros con mancuernas', 'weight_reps', 'shoulders', 'dumbbell', true),
  (md5('health:exercise:lateral_raise')::uuid, 'lateral_raise', 'Elevaciones laterales', 'elevaciones laterales', 'weight_reps', 'shoulders', 'dumbbell', true),
  (md5('health:exercise:front_raise')::uuid, 'front_raise', 'Elevaciones frontales', 'elevaciones frontales', 'weight_reps', 'shoulders', 'dumbbell', true),
  (md5('health:exercise:rear_delt_fly')::uuid, 'rear_delt_fly', 'Pájaros', 'pajaros', 'weight_reps', 'shoulders', 'dumbbell', true),
  (md5('health:exercise:face_pull')::uuid, 'face_pull', 'Face pull', 'face pull', 'weight_reps', 'shoulders', 'cable', false),
  (md5('health:exercise:dumbbell_shrug')::uuid, 'dumbbell_shrug', 'Encogimientos con mancuernas', 'encogimientos con mancuernas', 'weight_reps', 'shoulders', 'dumbbell', true),
  (md5('health:exercise:barbell_curl')::uuid, 'barbell_curl', 'Curl con barra', 'curl con barra', 'weight_reps', 'biceps', 'barbell', false),
  (md5('health:exercise:dumbbell_curl')::uuid, 'dumbbell_curl', 'Curl con mancuernas', 'curl con mancuernas', 'weight_reps', 'biceps', 'dumbbell', true),
  (md5('health:exercise:hammer_curl')::uuid, 'hammer_curl', 'Curl martillo', 'curl martillo', 'weight_reps', 'biceps', 'dumbbell', true),
  (md5('health:exercise:cable_curl')::uuid, 'cable_curl', 'Curl en polea', 'curl en polea', 'weight_reps', 'biceps', 'cable', false),
  (md5('health:exercise:preacher_curl')::uuid, 'preacher_curl', 'Curl predicador', 'curl predicador', 'weight_reps', 'biceps', 'machine', false),
  (md5('health:exercise:cable_triceps_pushdown')::uuid, 'cable_triceps_pushdown', 'Extensión de tríceps en polea', 'extension de triceps en polea', 'weight_reps', 'triceps', 'cable', false),
  (md5('health:exercise:skull_crusher')::uuid, 'skull_crusher', 'Press francés', 'press frances', 'weight_reps', 'triceps', 'barbell', false),
  (md5('health:exercise:overhead_dumbbell_extension')::uuid, 'overhead_dumbbell_extension', 'Extensión sobre la cabeza con mancuerna', 'extension sobre la cabeza con mancuerna', 'weight_reps', 'triceps', 'dumbbell', false),
  (md5('health:exercise:bench_dips')::uuid, 'bench_dips', 'Fondos en banco', 'fondos en banco', 'reps', 'triceps', 'bodyweight', false),
  (md5('health:exercise:close_grip_bench_press')::uuid, 'close_grip_bench_press', 'Press de banca con agarre cerrado', 'press de banca con agarre cerrado', 'weight_reps', 'triceps', 'barbell', false),
  (md5('health:exercise:barbell_squat')::uuid, 'barbell_squat', 'Sentadilla con barra', 'sentadilla con barra', 'weight_reps', 'quads', 'barbell', false),
  (md5('health:exercise:front_squat')::uuid, 'front_squat', 'Sentadilla frontal', 'sentadilla frontal', 'weight_reps', 'quads', 'barbell', false),
  (md5('health:exercise:goblet_squat')::uuid, 'goblet_squat', 'Sentadilla goblet', 'sentadilla goblet', 'weight_reps', 'quads', 'dumbbell', false),
  (md5('health:exercise:leg_press')::uuid, 'leg_press', 'Prensa de piernas', 'prensa de piernas', 'weight_reps', 'quads', 'machine', false),
  (md5('health:exercise:leg_extension')::uuid, 'leg_extension', 'Extensión de cuádriceps', 'extension de cuadriceps', 'weight_reps', 'quads', 'machine', false),
  (md5('health:exercise:dumbbell_lunge')::uuid, 'dumbbell_lunge', 'Zancadas con mancuernas', 'zancadas con mancuernas', 'weight_reps', 'quads', 'dumbbell', true),
  (md5('health:exercise:bulgarian_split_squat')::uuid, 'bulgarian_split_squat', 'Sentadilla búlgara', 'sentadilla bulgara', 'weight_reps', 'quads', 'dumbbell', true),
  (md5('health:exercise:romanian_deadlift')::uuid, 'romanian_deadlift', 'Peso muerto rumano', 'peso muerto rumano', 'weight_reps', 'hamstrings', 'barbell', false),
  (md5('health:exercise:lying_leg_curl')::uuid, 'lying_leg_curl', 'Curl femoral tumbado', 'curl femoral tumbado', 'weight_reps', 'hamstrings', 'machine', false),
  (md5('health:exercise:seated_leg_curl')::uuid, 'seated_leg_curl', 'Curl femoral sentado', 'curl femoral sentado', 'weight_reps', 'hamstrings', 'machine', false),
  (md5('health:exercise:hip_thrust')::uuid, 'hip_thrust', 'Hip thrust', 'hip thrust', 'weight_reps', 'glutes', 'barbell', false),
  (md5('health:exercise:cable_glute_kickback')::uuid, 'cable_glute_kickback', 'Patada de glúteo en polea', 'patada de gluteo en polea', 'weight_reps', 'glutes', 'cable', false),
  (md5('health:exercise:machine_hip_abduction')::uuid, 'machine_hip_abduction', 'Abductores en máquina', 'abductores en maquina', 'weight_reps', 'glutes', 'machine', false),
  (md5('health:exercise:machine_hip_adduction')::uuid, 'machine_hip_adduction', 'Aductores en máquina', 'aductores en maquina', 'weight_reps', 'quads', 'machine', false),
  (md5('health:exercise:standing_calf_raise')::uuid, 'standing_calf_raise', 'Elevación de talones de pie', 'elevacion de talones de pie', 'weight_reps', 'calves', 'machine', false),
  (md5('health:exercise:seated_calf_raise')::uuid, 'seated_calf_raise', 'Elevación de talones sentado', 'elevacion de talones sentado', 'weight_reps', 'calves', 'machine', false),
  (md5('health:exercise:plank')::uuid, 'plank', 'Plancha', 'plancha', 'time', 'abs', 'bodyweight', false),
  (md5('health:exercise:side_plank')::uuid, 'side_plank', 'Plancha lateral', 'plancha lateral', 'time', 'abs', 'bodyweight', false),
  (md5('health:exercise:crunch')::uuid, 'crunch', 'Crunch', 'crunch', 'reps', 'abs', 'bodyweight', false),
  (md5('health:exercise:hanging_leg_raise')::uuid, 'hanging_leg_raise', 'Elevación de piernas colgado', 'elevacion de piernas colgado', 'reps', 'abs', 'bodyweight', false),
  (md5('health:exercise:ab_wheel_rollout')::uuid, 'ab_wheel_rollout', 'Rueda abdominal', 'rueda abdominal', 'reps', 'abs', 'other', false),
  (md5('health:exercise:cable_crunch')::uuid, 'cable_crunch', 'Crunch en polea', 'crunch en polea', 'weight_reps', 'abs', 'cable', false),
  (md5('health:exercise:treadmill')::uuid, 'treadmill', 'Cinta', 'cinta', 'cardio', 'cardio', 'machine', false),
  (md5('health:exercise:stationary_bike')::uuid, 'stationary_bike', 'Bicicleta estática', 'bicicleta estatica', 'cardio', 'cardio', 'machine', false),
  (md5('health:exercise:elliptical')::uuid, 'elliptical', 'Elíptica', 'eliptica', 'cardio', 'cardio', 'machine', false),
  (md5('health:exercise:rowing_machine')::uuid, 'rowing_machine', 'Remo ergómetro', 'remo ergometro', 'cardio', 'cardio', 'machine', false),
  (md5('health:exercise:stair_climber')::uuid, 'stair_climber', 'Escaladora', 'escaladora', 'cardio', 'cardio', 'machine', false),
  (md5('health:exercise:jump_rope')::uuid, 'jump_rope', 'Saltar la cuerda', 'saltar la cuerda', 'cardio', 'cardio', 'other', false)
ON CONFLICT DO NOTHING;
