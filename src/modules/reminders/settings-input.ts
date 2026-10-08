// Validation of Ajustes → Avisos' writes (SPEC-reminders "Pantallas"). Client-safe: the screen
// runs the same schema before it calls the Server Action. R2 owns the day's reminders (briefing,
// payments, evening review) and the Telegram amounts switch; R4 adds `habit_times_enabled` (the
// habits' own times). `delivery_channel` and `show_amounts_push` come with R5 and are NOT accepted
// here yet.
import { z } from "zod";
import { DEFAULT_BRIEFING_TIME, DEFAULT_EVENING_TIME } from "./reminders-constants";

export const SETTINGS_ERRORS = {
  timeInvalid: "Escribe una hora válida, como 07:30.",
  empty: "No hay nada que guardar.",
} as const;

/** `HH:MM`, 24 h, no seconds (the column is `time` and a CHECK rejects seconds). */
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const time = z
  .string({ error: SETTINGS_ERRORS.timeInvalid })
  .regex(TIME, SETTINGS_ERRORS.timeInvalid);

/**
 * A change of one or more fields (the screen sends the one the owner touched). Strict: an unknown
 * key (a forged `telegramChatId`, say) is rejected instead of ignored.
 */
export const updateReminderSettingsSchema = z
  .strictObject({
    briefingEnabled: z.boolean(),
    briefingTime: time,
    paymentsEnabled: z.boolean(),
    eveningEnabled: z.boolean(),
    eveningTime: time,
    habitTimesEnabled: z.boolean(),
    showAmountsTelegram: z.boolean(),
  })
  .partial()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    error: SETTINGS_ERRORS.empty,
  });

export type UpdateReminderSettingsInput = z.output<typeof updateReminderSettingsSchema>;

/** What Ajustes shows and edits (times as `HH:MM`). */
export type ReminderSchedule = {
  briefingEnabled: boolean;
  briefingTime: string;
  paymentsEnabled: boolean;
  eveningEnabled: boolean;
  eveningTime: string;
  habitTimesEnabled: boolean;
  showAmountsTelegram: boolean;
};

/** A fresh install: what the row has before the owner touches anything. */
export const DEFAULT_SCHEDULE: ReminderSchedule = {
  briefingEnabled: true,
  briefingTime: DEFAULT_BRIEFING_TIME,
  paymentsEnabled: true,
  eveningEnabled: true,
  eveningTime: DEFAULT_EVENING_TIME,
  habitTimesEnabled: true,
  showAmountsTelegram: true,
};

/** The schedule of a settings row (Postgres' `07:30:00` → `07:30`). */
export function scheduleOf(row: {
  briefingEnabled: boolean;
  briefingTime: string;
  paymentsEnabled: boolean;
  eveningEnabled: boolean;
  eveningTime: string;
  habitTimesEnabled: boolean;
  showAmountsTelegram: boolean;
}): ReminderSchedule {
  return {
    briefingEnabled: row.briefingEnabled,
    briefingTime: row.briefingTime.slice(0, 5),
    paymentsEnabled: row.paymentsEnabled,
    eveningEnabled: row.eveningEnabled,
    eveningTime: row.eveningTime.slice(0, 5),
    habitTimesEnabled: row.habitTimesEnabled,
    showAmountsTelegram: row.showAmountsTelegram,
  };
}
