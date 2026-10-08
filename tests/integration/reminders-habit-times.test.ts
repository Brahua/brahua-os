// @vitest-environment node
// R4 of `reminders`: a habit's reminder time and part of the day against Postgres. The CHECKs with
// raw inserts (defense in depth behind Zod), the real `habits` source (who gets a `habit_time`
// candidate: done, paused, archived, deleted, a evitar, other weekdays, not started), the edit
// refusing a time on a habit to avoid, the engine sending ONE notice for habits at the same
// minute and two ticks at once sending one per habit (with a positive control), the switch, and
// the export carrying the two columns.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { buildExport } from "@/lib/data-export";
import { ensureReminderSources, SOURCES } from "@/lib/reminder-sources";
import { habitLogs, habitPauses, habits } from "@/modules/habits/db/schema";
import { selectTimedHabitsLeft } from "@/modules/habits/contracts";
import { selectHabitItemById } from "@/modules/habits/habits";
import { updateHabitById } from "@/modules/habits/organize";
import type { ChannelSendResult, ReminderChannel } from "@/modules/reminders/contracts";
import { reminderDeliveries, reminderSettings } from "@/modules/reminders/db/schema";
import { runTick } from "@/modules/reminders/engine";
import { getSettings } from "@/modules/reminders/settings";
import { limaInstant } from "@/modules/reminders/slots";
import { testDb } from "./test-db";

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  getDb: () => testDb,
}));

const CHAT_ID = 5_000_000_042;
/** Thursday 2026-10-08 in Lima. */
const DAY = "2026-10-08";
const AT_22 = limaInstant(DAY, "22:05");

beforeEach(async () => {
  ensureReminderSources();
  await getSettings(testDb);
  await testDb
    .update(reminderSettings)
    .set({ telegramChatId: CHAT_ID, linkedAt: new Date("2026-10-01T12:00:00Z") })
    .where(eq(reminderSettings.id, true));
});

let order = 0;
async function habit(values: Partial<typeof habits.$inferInsert> & { name: string }) {
  const [row] = await testDb
    .insert(habits)
    .values({
      measure: "check",
      frequency: "daily",
      startDate: "2026-09-01",
      sortOrder: order++,
      ...values,
    })
    .returning({ id: habits.id });
  return row.id;
}

/** The constraint a raw statement breaks, or null. */
async function violation(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    const cause = (error as { cause?: { code?: string; constraint?: string } }).cause;
    return { code: cause?.code, constraint: cause?.constraint };
  }
  return null;
}
const check = (constraint: string) => ({ code: "23514", constraint });
const insertHabit = (values: Record<string, unknown>) => () =>
  habit({ name: "Leer", ...values } as typeof habits.$inferInsert & { name: string });

describe("the CHECKs", () => {
  test("a whole-minute time and a franja pass; both are optional", async () => {
    expect(await violation(insertHabit({}))).toBeNull();
    expect(await violation(insertHabit({ reminderTime: "22:00" }))).toBeNull();
    expect(await violation(insertHabit({ reminderTime: "00:00", daypart: "morning" }))).toBeNull();
    expect(await violation(insertHabit({ reminderTime: "23:59", daypart: "evening" }))).toBeNull();
    expect(await violation(insertHabit({ daypart: "afternoon" }))).toBeNull();
  });

  test("a time with seconds, or at 24:00, is refused", async () => {
    expect(await violation(insertHabit({ reminderTime: "22:00:30" }))).toEqual(
      check("habits_reminder_time_check"),
    );
    expect(await violation(insertHabit({ reminderTime: "24:00" }))).toEqual(
      check("habits_reminder_time_check"),
    );
  });

  test("a habit to avoid takes no time, but may have a franja", async () => {
    expect(await violation(insertHabit({ kind: "avoid", reminderTime: "22:00" }))).toEqual(
      check("habits_reminder_time_check"),
    );
    expect(await violation(insertHabit({ kind: "avoid", daypart: "evening" }))).toBeNull();
    expect(await violation(insertHabit({ kind: "avoid" }))).toBeNull();
  });

  test("an unknown franja is refused (the three keys pass)", async () => {
    for (const daypart of ["night", "Mañana", "", "noon"]) {
      expect(await violation(insertHabit({ daypart })), daypart).toEqual(
        check("habits_daypart_check"),
      );
    }
  });

  test("an UPDATE can't slip a time onto a habit to avoid either", async () => {
    const id = await habit({ name: "No fumar", kind: "avoid" });
    expect(
      await violation(() =>
        testDb.update(habits).set({ reminderTime: "22:00" }).where(eq(habits.id, id)),
      ),
    ).toEqual(check("habits_reminder_time_check"));
  });
});

describe("the habit's item and the edit", () => {
  test("the item carries the time as HH:MM and the franja; none is null", async () => {
    const withBoth = await habit({ name: "Leer", reminderTime: "22:00", daypart: "evening" });
    const without = await habit({ name: "Agua" });
    expect(await selectHabitItemById(testDb, withBoth, DAY)).toMatchObject({
      reminderTime: "22:00",
      daypart: "evening",
    });
    expect(await selectHabitItemById(testDb, without, DAY)).toMatchObject({
      reminderTime: null,
      daypart: null,
    });
  });

  const base = {
    name: "Leer",
    lifeAreaId: null,
    frequency: "daily" as const,
    weeklyTarget: null,
    weekdays: null,
  };

  test("sets, keeps (missing) and clears (null) the two fields", async () => {
    const id = await habit({ name: "Leer" });
    let item = await updateHabitById(
      testDb,
      { id, ...base, reminderTime: "21:30", daypart: "evening" },
      DAY,
    );
    expect(item).toMatchObject({ reminderTime: "21:30", daypart: "evening" });
    // Missing: untouched.
    item = await updateHabitById(testDb, { id, ...base, name: "Leer 2" }, DAY);
    expect(item).toMatchObject({ name: "Leer 2", reminderTime: "21:30", daypart: "evening" });
    item = await updateHabitById(testDb, { id, ...base, reminderTime: null, daypart: null }, DAY);
    expect(item).toMatchObject({ reminderTime: null, daypart: null });
  });

  test("a habit to avoid refuses a time but takes a franja and a clear", async () => {
    const id = await habit({ name: "No fumar", kind: "avoid" });
    expect(await updateHabitById(testDb, { id, ...base, reminderTime: "22:00" }, DAY)).toBe(
      "avoidReminder",
    );
    expect(await updateHabitById(testDb, { id, ...base, daypart: "morning" }, DAY)).toMatchObject({
      daypart: "morning",
    });
    expect(await updateHabitById(testDb, { id, ...base, reminderTime: null }, DAY)).toMatchObject({
      reminderTime: null,
    });
  });
});

describe("the source: who gets a habit_time candidate", () => {
  const names = async (at: Date) => (await selectTimedHabitsLeft(testDb, at)).map((h) => h.name);

  test("a habit with a time that is due, active and not met", async () => {
    await habit({ name: "Leer", reminderTime: "22:00" });
    expect(await selectTimedHabitsLeft(testDb, AT_22)).toEqual([
      expect.objectContaining({ name: "Leer", reminderTime: "22:00" }),
    ]);
  });

  test("none of: no time, done, paused, archived, deleted, a evitar, other weekday, not started", async () => {
    await habit({ name: "Sin hora" });
    const done = await habit({ name: "Hecho", reminderTime: "22:00" });
    const paused = await habit({ name: "Pausado", reminderTime: "22:00" });
    await habit({ name: "Archivado", reminderTime: "22:00", archivedAt: new Date() });
    await habit({ name: "Eliminado", reminderTime: "22:00", deletedAt: new Date() });
    await habit({ name: "No fumar", kind: "avoid", daypart: "evening" });
    await habit({
      name: "Lunes",
      reminderTime: "22:00",
      frequency: "weekdays",
      weekdays: [1],
    });
    await habit({ name: "Futuro", reminderTime: "22:00", startDate: "2026-10-09" });
    await habit({ name: "Pendiente", reminderTime: "22:00" });
    await testDb.insert(habitLogs).values({ habitId: done, day: DAY, quantity: 1, target: 1 });
    await testDb
      .insert(habitPauses)
      .values({ habitId: paused, startDate: "2026-10-07", endDate: "2026-10-09" });

    expect(await names(AT_22)).toEqual(["Pendiente"]);
  });

  test("another day's log does not make today done (control for the one above)", async () => {
    const id = await habit({ name: "Leer", reminderTime: "22:00" });
    await testDb
      .insert(habitLogs)
      .values({ habitId: id, day: "2026-10-07", quantity: 1, target: 1 });
    expect(await names(AT_22)).toEqual(["Leer"]);
  });

  test("an unmarked day (quantity 0) is not done", async () => {
    const id = await habit({ name: "Leer", reminderTime: "22:00" });
    await testDb.insert(habitLogs).values({ habitId: id, day: DAY, quantity: 0, target: 1 });
    expect(await names(AT_22)).toEqual(["Leer"]);
  });

  test("at 23:59 of Lima it is still the same day; one second later, the next", async () => {
    await habit({ name: "Jueves", reminderTime: "23:30", frequency: "weekdays", weekdays: [4] });
    expect(await names(limaInstant(DAY, "23:59"))).toEqual(["Jueves"]);
    expect(await names(limaInstant("2026-10-09", "00:00"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// through the engine
// ---------------------------------------------------------------------------------------------

function recordingChannel(delayMs = 0) {
  const sent: { text: string; dedupeKey: string }[] = [];
  const channel: ReminderChannel = {
    id: "telegram",
    send: async (message): Promise<ChannelSendResult> => {
      sent.push({ text: message.text, dedupeKey: message.dedupeKey });
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { ok: true, messageId: sent.length };
    },
  };
  return { channel, sent };
}

const tick = (now: Date, channel: ReminderChannel) =>
  runTick({ db: testDb, now, sources: SOURCES, channelsFor: () => ({ telegram: channel }) });

/** Only the habit_time notices: the evening review at 21:00 also rides these ticks. */
const habitSent = (sent: { text: string }[]) => sent.filter((m) => m.text.startsWith("Es hora"));

describe("the engine", () => {
  test("«Es hora de Leer.» once at its time; the next ticks of the window send nothing more", async () => {
    const id = await habit({ name: "Leer", reminderTime: "22:00" });
    const { channel, sent } = recordingChannel();
    await tick(limaInstant(DAY, "22:00"), channel);
    await tick(limaInstant(DAY, "22:15"), channel);
    await tick(limaInstant(DAY, "23:45"), channel);
    expect(habitSent(sent)).toEqual([
      { text: "Es hora de Leer.", dedupeKey: `habit:${id}:${DAY}` },
    ]);
  });

  test("not before its time, and not after its window (skipped, never sent late)", async () => {
    await habit({ name: "Leer", reminderTime: "22:00" });
    const { channel, sent } = recordingChannel();
    await tick(limaInstant(DAY, "21:59"), channel);
    expect(habitSent(sent)).toEqual([]);
    // 2 h later exactly: expired.
    await tick(new Date(limaInstant(DAY, "22:00").getTime() + 2 * 3600_000), channel);
    expect(habitSent(sent)).toEqual([]);
    const rows = await testDb.select().from(reminderDeliveries);
    expect(rows.find((row) => row.kind === "habit_time")).toMatchObject({ status: "skipped" });
  });

  test("a habit done before its time gets no notice", async () => {
    const id = await habit({ name: "Leer", reminderTime: "22:00" });
    await testDb.insert(habitLogs).values({ habitId: id, day: DAY, quantity: 1, target: 1 });
    const { channel, sent } = recordingChannel();
    await tick(AT_22, channel);
    expect(habitSent(sent)).toEqual([]);
  });

  test("the switch off sends none (positive control: on, it sends)", async () => {
    await habit({ name: "Leer", reminderTime: "22:00" });
    const { channel, sent } = recordingChannel();
    await testDb.update(reminderSettings).set({ habitTimesEnabled: false });
    await tick(AT_22, channel);
    expect(habitSent(sent)).toEqual([]);
    await testDb.update(reminderSettings).set({ habitTimesEnabled: true });
    await tick(AT_22, channel);
    expect(habitSent(sent)).toHaveLength(1);
  });

  test("a habit at 23:30 is still told at 00:15 of the next day while its window is open", async () => {
    const id = await habit({ name: "Leer", reminderTime: "23:30" });
    const { channel, sent } = recordingChannel();
    await tick(limaInstant("2026-10-09", "00:15"), channel);
    expect(habitSent(sent)).toEqual([
      { text: "Es hora de Leer.", dedupeKey: `habit:${id}:${DAY}` },
    ]);
  });

  test("habits at the same minute: ONE message naming both, and each key is claimed", async () => {
    const leer = await habit({ name: "Leer", reminderTime: "22:00" });
    const meditar = await habit({ name: "Meditar", reminderTime: "22:00" });
    const { channel, sent } = recordingChannel();
    await tick(AT_22, channel);
    await tick(limaInstant(DAY, "22:20"), channel);
    expect(habitSent(sent)).toEqual([
      { text: "Es hora de Leer y Meditar.", dedupeKey: `habit:${leer}:${DAY}` },
    ]);
    const claimed = (await testDb.select().from(reminderDeliveries))
      .filter((row) => row.kind === "habit_time")
      .map((row) => [row.dedupeKey, row.status]);
    expect(claimed.sort()).toEqual(
      [
        [`habit:${leer}:${DAY}`, "sent"],
        [`habit:${meditar}:${DAY}`, "skipped"],
      ].sort(),
    );
  });

  test("two ticks at once send ONE notice per habit; two habits at different times send two", async () => {
    await habit({ name: "Leer", reminderTime: "22:00" });
    const { channel, sent } = recordingChannel(150);
    await Promise.all([tick(AT_22, channel), tick(AT_22, channel)]);
    expect(habitSent(sent)).toHaveLength(1);

    // Positive control: another habit at another time is another notice.
    await habit({ name: "Meditar", reminderTime: "22:01" });
    await Promise.all([tick(AT_22, channel), tick(AT_22, channel)]);
    expect(habitSent(sent).map((m) => m.text)).toEqual(["Es hora de Leer.", "Es hora de Meditar."]);
  });
});

describe("the export", () => {
  test("carries both columns of every habit, archived ones too", async () => {
    await habit({ name: "Leer", reminderTime: "22:00", daypart: "evening" });
    await habit({ name: "Agua", archivedAt: new Date() });
    const data = await buildExport(testDb, new Date("2026-10-08T12:00:00Z"));
    const rows = data.tables.habits.rows;
    expect(rows.find((row) => row.name === "Leer")).toMatchObject({
      reminder_time: "22:00:00",
      daypart: "evening",
    });
    expect(rows.find((row) => row.name === "Agua")).toMatchObject({
      reminder_time: null,
      daypart: null,
    });
  });
});
