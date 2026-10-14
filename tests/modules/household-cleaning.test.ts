// H1 of `household`: the pure rules of the cleaning (SPEC-household "Estrategia de pruebas"):
// frequency -> recurrence, zone tags, the Zod input, and the grouping by zone and by day.
import { describe, expect, test } from "vitest";
import {
  frequencyOf,
  FREQUENCIES,
  nextWeekdayOnOrAfter,
  recurrenceFor,
  weekEndOf,
  zoneLabel,
  zoneOfTags,
  zoneTagName,
} from "@/modules/household/cleaning";
import { addCleaningInputSchema } from "@/modules/household/cleaning-input";
import {
  frequencyText,
  groupByDay,
  groupByZone,
  whenText,
  type CleaningItem,
} from "@/modules/household/cleaning-view";
import { householdPath, parseGroup, parseView } from "@/modules/household/routes";

describe("frequency to recurrence", () => {
  test("the five frequencies use the rules `tasks` already has", () => {
    expect(recurrenceFor("daily")).toEqual({
      kind: "every_days",
      interval: 1,
      weekdays: null,
      monthDay: null,
    });
    expect(recurrenceFor("weekly", [4, 1, 4])).toEqual({
      kind: "weekdays",
      interval: null,
      weekdays: [1, 4],
      monthDay: null,
    });
    expect(recurrenceFor("biweekly")).toMatchObject({ kind: "every_weeks", interval: 2 });
    expect(recurrenceFor("monthly")).toMatchObject({ kind: "every_months", interval: 1 });
    expect(recurrenceFor("quarterly")).toMatchObject({ kind: "every_months", interval: 3 });
  });

  test("weekly without a weekday is refused", () => {
    expect(() => recurrenceFor("weekly", [])).toThrow(RangeError);
  });

  test("every frequency round-trips through frequencyOf", () => {
    for (const frequency of FREQUENCIES) {
      expect(frequencyOf(recurrenceFor(frequency, [2]))).toBe(frequency);
    }
    expect(frequencyOf(null)).toBeNull();
    expect(
      frequencyOf({ kind: "every_days", interval: 5, weekdays: null, monthDay: null }),
    ).toBeNull();
    expect(
      frequencyOf({ kind: "month_day", interval: null, weekdays: null, monthDay: 3 }),
    ).toBeNull();
  });
});

describe("zones as tags", () => {
  test("a zone tag is lowercase, normalized and fits a tag", () => {
    expect(zoneTagName("  Dormitorio   principal ")).toBe("zona: dormitorio principal");
    expect(zoneTagName("Cocina/Lavandería").length).toBeLessThanOrEqual(30);
    for (const zone of ["Dormitorio principal", "Oficina Antonella", "Cocina/Lavandería"]) {
      expect([...zoneTagName(zone)].length).toBeLessThanOrEqual(30);
    }
  });

  test("the zone is read back from the tags", () => {
    expect(zoneOfTags(["limpieza", "zona: baño"])).toBe("baño");
    expect(zoneOfTags(["limpieza"])).toBeNull();
    expect(zoneOfTags(["zona: "])).toBeNull();
    expect(zoneLabel("baño")).toBe("Baño");
    expect(zoneLabel("sala/comedor")).toBe("Sala/comedor");
  });
});

describe("dates", () => {
  test("the Sunday of a week", () => {
    expect(weekEndOf("2026-10-12")).toBe("2026-10-18"); // Monday
    expect(weekEndOf("2026-10-18")).toBe("2026-10-18"); // Sunday
    expect(weekEndOf("2026-12-30")).toBe("2027-01-03"); // across the year
    expect(weekEndOf("2028-02-28")).toBe("2028-03-05"); // leap year
  });

  test("the next weekday on or after a day", () => {
    expect(nextWeekdayOnOrAfter("2026-10-14", [3])).toBe("2026-10-14"); // Wednesday itself
    expect(nextWeekdayOnOrAfter("2026-10-14", [1])).toBe("2026-10-19");
    expect(nextWeekdayOnOrAfter("2026-12-31", [1, 5])).toBe("2027-01-01");
  });

  test("when a cleaning comes up, without guilt", () => {
    expect(whenText("2026-10-14", "2026-10-14")).toBe("toca hoy");
    expect(whenText("2026-10-15", "2026-10-14")).toBe("toca mañana");
    expect(whenText("2026-10-16", "2026-10-14")).toBe("toca el viernes 16");
    expect(whenText("2026-10-12", "2026-10-14")).toBe("desde el lunes 12");
    expect(whenText(null, "2026-10-14")).toBeNull();
    // Tomorrow across a month end.
    expect(whenText("2026-11-01", "2026-10-31")).toBe("toca mañana");
  });

  test("the frequency in words", () => {
    expect(frequencyText(recurrenceFor("weekly", [1]))).toBe("Cada semana, lunes");
    expect(frequencyText(recurrenceFor("weekly", [1, 4]))).toBe("Cada semana, lunes y jueves");
    expect(frequencyText(recurrenceFor("weekly", [1, 3, 5]))).toBe(
      "Cada semana, lunes, miércoles y viernes",
    );
    expect(frequencyText(recurrenceFor("quarterly"))).toBe("Cada 3 meses");
    expect(frequencyText(null)).toBeNull();
  });
});

const item = (
  id: string,
  title: string,
  dueDate: string | null,
  zone: string | null,
): CleaningItem => ({
  id,
  title,
  dueDate,
  zone,
  frequency: null,
});

describe("grouping", () => {
  const today = "2026-10-14"; // Wednesday; the week ends on 2026-10-18
  const items = [
    item("a", "Limpiar inodoro", "2026-10-12", "baño"),
    item("b", "Trapear", "2026-10-14", "sala/comedor"),
    item("c", "Barrer", "2026-10-14", "sala/comedor"),
    item("d", "Lavar sábanas", "2026-10-18", "dormitorio principal"),
    item("e", "Limpiar ventanas", "2026-11-02", "zona nueva"),
    item("f", "Ordenar", null, null),
  ];

  test("by zone: the owner's order, other zones by name, «Sin zona» last", () => {
    const groups = groupByZone(items, today);
    expect(groups.map((group) => group.label)).toEqual([
      "Dormitorio principal",
      "Baño",
      "Sala/comedor",
      "Zona nueva",
      "Sin zona",
    ]);
  });

  test("by zone: items by date then title, and what comes up this week counts", () => {
    const groups = groupByZone(items, today);
    const sala = groups.find((group) => group.zone === "sala/comedor");
    expect(sala?.items.map((entry) => entry.title)).toEqual(["Barrer", "Trapear"]);
    expect(groups.find((group) => group.zone === "baño")?.dueThisWeek).toBe(1); // overdue still counts
    expect(groups.find((group) => group.zone === "zona nueva")?.dueThisWeek).toBe(0);
    expect(groups.find((group) => group.zone === null)?.dueThisWeek).toBe(0);
  });

  test("by day: before, each day of the week with something, later, no date", () => {
    const groups = groupByDay(items, today);
    expect(groups.map((group) => group.kind)).toEqual(["before", "day", "day", "later", "none"]);
    expect(groups[0].label).toBe("De antes");
    expect(groups[1].label).toBe("Hoy · miércoles 14");
    expect(groups[2].label).toBe("domingo 18");
    expect(groups[3].items.map((entry) => entry.id)).toEqual(["e"]);
  });

  test("by day across a month end: Saturday 31 oct, the week still ends on Sunday 1 nov", () => {
    const groups = groupByDay(
      [item("x", "Barrer", "2026-11-01", "baño"), item("y", "Trapear", "2026-11-02", "baño")],
      "2026-10-31",
    );
    expect(groups.map((group) => group.kind)).toEqual(["day", "later"]);
    // On that Sunday the week is over by the next day.
    const sunday = groupByDay([item("z", "Barrer", "2026-11-02", "baño")], "2026-11-01");
    expect(sunday.map((group) => group.kind)).toEqual(["later"]);
  });

  test("nothing at all gives no groups", () => {
    expect(groupByZone([], today)).toEqual([]);
    expect(groupByDay([], today)).toEqual([]);
  });
});

describe("«Añadir limpieza» input", () => {
  const valid = {
    title: "  Limpiar   inodoro ",
    zone: " Baño ",
    frequency: "weekly",
    weekdays: [4, 1],
  };

  test("normalizes and accepts a weekly cleaning without a first date", () => {
    const parsed = addCleaningInputSchema.parse(valid);
    expect(parsed).toMatchObject({
      title: "Limpiar inodoro",
      zone: "Baño",
      weekdays: [4, 1],
      firstDate: null,
    });
  });

  test("an empty first date means none", () => {
    expect(addCleaningInputSchema.parse({ ...valid, firstDate: "" }).firstDate).toBeNull();
  });

  test("weekly needs a weekday, and a first date on one of them", () => {
    const none = addCleaningInputSchema.safeParse({ ...valid, weekdays: [] });
    expect(none.success).toBe(false);
    const off = addCleaningInputSchema.safeParse({ ...valid, firstDate: "2026-10-14" }); // Wednesday
    expect(off.success).toBe(false);
    const on = addCleaningInputSchema.safeParse({ ...valid, firstDate: "2026-10-15" }); // Thursday
    expect(on.success).toBe(true);
  });

  test("other frequencies ignore the weekdays", () => {
    const parsed = addCleaningInputSchema.parse({
      ...valid,
      frequency: "monthly",
      weekdays: [],
      firstDate: "2026-10-14",
    });
    expect(parsed.frequency).toBe("monthly");
  });

  test("refuses what a tag or a task can't hold", () => {
    const bad = (patch: object) =>
      addCleaningInputSchema.safeParse({ ...valid, frequency: "daily", ...patch }).success;
    expect(bad({ title: "   " })).toBe(false);
    expect(bad({ title: "x".repeat(201) })).toBe(false);
    expect(bad({ zone: "" })).toBe(false);
    expect(bad({ zone: "x".repeat(25) })).toBe(false);
    expect(bad({ zone: "a, b" })).toBe(false);
    // Lowercasing lengthens "İ" (two code points): what has to fit is the tag, not the typed name.
    expect(bad({ zone: "İ".repeat(20) })).toBe(false);
    expect(bad({ zone: "bañ‮o" })).toBe(false);
    expect(bad({ firstDate: "2026-02-30" })).toBe(false);
    expect(bad({ firstDate: "mañana" })).toBe(false);
    expect(bad({ frequency: "hourly" })).toBe(false);
    // Positive control: the same input with fixed fields passes.
    expect(bad({})).toBe(true);
  });
});

describe("routes", () => {
  test("view and grouping fall back to the defaults", () => {
    expect(parseView(undefined)).toBe("limpieza");
    expect(parseView("compras")).toBe("compras");
    // Recipes join in H3: until then an unknown view is the first.
    expect(parseView("recetas")).toBe("limpieza");
    expect(parseGroup("dia")).toBe("dia");
    expect(parseGroup("x")).toBe("zona");
    expect(householdPath()).toBe("/household");
    expect(householdPath("limpieza", "dia")).toBe("/household?agrupar=dia");
    expect(householdPath("compras")).toBe("/household?vista=compras");
  });
});
