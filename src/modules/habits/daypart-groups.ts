// R4: the pads of "Hoy" grouped by part of the day (SPEC-reminders "Pantallas → Hoy"). Pure and
// client-safe, shared by Hábitos → Hoy and the board of `today`.
//
// The grouping only exists when at least one habit has a part of the day: with none, the screen is
// exactly what it was (`groupByDaypart` returns null and the caller renders its plain grid). A
// band that has no habit is not listed; "Sin franja" comes last. Inside a band the habits keep the
// order they came in (the manual one).
import { HABIT_DAYPARTS, type HabitDaypart } from "./habit-constants";
import { DAYPART_LABELS, REMINDER_COPY } from "./reminder-copy";

export type DaypartBand<T> = {
  /** The part of the day, or `none` for the habits without one. */
  key: HabitDaypart | "none";
  /** What the heading says: "Mañana", "Tarde", "Noche" or "Sin franja". */
  label: string;
  habits: T[];
};

/**
 * The accessible name of a band's list: «Hábitos de la franja mañana» / «Hábitos sin franja», so
 * the list says what it holds even when a screen reader jumps straight to it (the `h3` above it
 * is the visible title).
 */
export function bandListLabel(band: Pick<DaypartBand<unknown>, "key" | "label">): string {
  return band.key === "none" ? REMINDER_COPY.noDaypartList : REMINDER_COPY.bandList(band.label);
}

/** The bands of `habits`, or null when no habit has a part of the day (nothing to group). */
export function groupByDaypart<T extends { daypart?: HabitDaypart | null }>(
  habits: readonly T[],
): DaypartBand<T>[] | null {
  if (!habits.some((habit) => habit.daypart)) return null;
  const bands: DaypartBand<T>[] = [];
  for (const key of HABIT_DAYPARTS) {
    const inBand = habits.filter((habit) => habit.daypart === key);
    if (inBand.length > 0) bands.push({ key, label: DAYPART_LABELS[key], habits: inBand });
  }
  const none = habits.filter((habit) => !habit.daypart);
  if (none.length > 0) bands.push({ key: "none", label: REMINDER_COPY.noDaypart, habits: none });
  return bands;
}

/** The habits in the order they are shown: band by band, or as given when there is no grouping. */
export function visualOrder<T extends { daypart?: HabitDaypart | null }>(
  habits: readonly T[],
): T[] {
  const bands = groupByDaypart(habits);
  return bands ? bands.flatMap((band) => band.habits) : [...habits];
}
