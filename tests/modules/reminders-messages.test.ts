// reminders → messages.ts (R2): the text of each reminder. Short (the briefing is one line, never
// more than 3), amounts only when the channel's switch is on, and none of the words a reminder
// never says.
import { describe, expect, test } from "vitest";
import {
  briefingText,
  eveningReviewText,
  habitTimeText,
  paymentEveText,
  paymentFollowupText,
  shortDayLabel,
} from "@/modules/reminders/messages";

/** Words and signs a reminder never uses (lowercase; matched on the lowercase text). */
const FORBIDDEN = ["racha", "riesgo", "⚠️", "atrasad", "deuda", "vencid", "pierdes", "perdiste"];

const NETFLIX = { name: "Netflix", amountLabel: "S/ 50.00" };
const LUZ = { name: "Luz", amountLabel: "S/ 80.00" };
const AGUA = { name: "Agua", amountLabel: null };

describe("briefingText", () => {
  test("the story's sentence: habits, tasks and a payment with its amount, on one line", () => {
    expect(
      briefingText({ habitsToday: 3, tasksDueToday: 2, paymentsDueToday: [NETFLIX] }, true),
    ).toBe("Buen día. Hoy: 3 hábitos, 2 tareas y 1 pago (Netflix · S/ 50.00).");
  });

  test("without the amounts switch no amount shows, only the name", () => {
    const text = briefingText({ habitsToday: 3, paymentsDueToday: [NETFLIX, LUZ] }, false);
    expect(text).toBe("Buen día. Hoy: 3 hábitos y 2 pagos (Netflix, Luz).");
    expect(text).not.toMatch(/S\/|\d+\.\d{2}/);
  });

  test("with the amounts switch on, each named payment carries its amount; a variable one has none", () => {
    expect(briefingText({ paymentsDueToday: [NETFLIX, AGUA] }, true)).toBe(
      "Buen día. Hoy: 2 pagos (Netflix · S/ 50.00, Agua).",
    );
  });

  test("names two payments and counts the rest", () => {
    expect(briefingText({ paymentsDueToday: [NETFLIX, LUZ, AGUA] }, false)).toBe(
      "Buen día. Hoy: 3 pagos (Netflix, Luz y 1 más).",
    );
  });

  test("singular and plural", () => {
    expect(briefingText({ habitsToday: 1, tasksDueToday: 1 }, true)).toBe(
      "Buen día. Hoy: 1 hábito y 1 tarea.",
    );
    expect(briefingText({ tasksDueToday: 4 }, true)).toBe("Buen día. Hoy: 4 tareas.");
  });

  test("an empty day says nothing (null: the engine records it as skipped)", () => {
    expect(briefingText({}, true)).toBeNull();
    expect(
      briefingText({ habitsToday: 0, tasksDueToday: 0, paymentsDueToday: [] }, true),
    ).toBeNull();
  });

  test("never more than 3 lines, whatever the day", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      name: `Pago ${i}`,
      amountLabel: "S/ 1.00",
    }));
    for (const showAmounts of [true, false]) {
      const text = briefingText(
        { habitsToday: 9, tasksDueToday: 9, paymentsDueToday: many },
        showAmounts,
      );
      expect(text!.split("\n").length).toBeLessThanOrEqual(3);
    }
  });
});

describe("payments", () => {
  test("the eve: «Mañana vence …», with the amount only if the switch is on", () => {
    expect(paymentEveText(NETFLIX, { showAmounts: true })).toBe("Mañana vence Netflix · S/ 50.00.");
    expect(paymentEveText(NETFLIX, { showAmounts: false })).toBe("Mañana vence Netflix.");
    expect(paymentEveText(AGUA, { showAmounts: true })).toBe("Mañana vence Agua.");
  });

  test("when the window crossed midnight it is «Hoy vence …»", () => {
    expect(paymentEveText(NETFLIX, { showAmounts: false, day: "today" })).toBe(
      "Hoy vence Netflix.",
    );
  });

  test("the follow-up: «sigue pendiente desde el lun 5 oct.», no amount, never «atrasado»", () => {
    expect(paymentFollowupText(NETFLIX, "2026-10-05")).toBe(
      "Netflix sigue pendiente desde el lun 5 oct.",
    );
  });

  test("short day labels read the calendar day, not a time zone", () => {
    expect(shortDayLabel("2026-10-05")).toBe("lun 5 oct");
    expect(shortDayLabel("2026-12-31")).toBe("jue 31 dic");
    expect(shortDayLabel("2027-01-01")).toBe("vie 1 ene");
    expect(shortDayLabel("2026-10-07")).toBe("mié 7 oct");
    expect(shortDayLabel("2026-10-10")).toBe("sáb 10 oct");
    expect(shortDayLabel("2026-10-11")).toBe("dom 11 oct");
    expect(() => shortDayLabel("5 oct")).toThrow();
  });
});

describe("eveningReviewText", () => {
  test("one habit: the story's sentence", () => {
    expect(eveningReviewText(["Leer"])).toBe("Te queda Leer. Si lo haces ahora, cuenta hoy.");
  });

  test("several: a natural sentence in the plural", () => {
    expect(eveningReviewText(["Leer", "Meditar"])).toBe(
      "Te quedan Leer y Meditar. Si los haces ahora, cuentan hoy.",
    );
    expect(eveningReviewText(["Leer", "Meditar", "Correr"])).toBe(
      "Te quedan Leer, Meditar y Correr. Si los haces ahora, cuentan hoy.",
    );
    expect(eveningReviewText(["Leer", "Meditar", "Correr", "Agua", "Yoga"])).toBe(
      "Te quedan Leer, Meditar, Correr y 2 más. Si los haces ahora, cuentan hoy.",
    );
  });

  test("nothing left: nothing to say", () => {
    expect(eveningReviewText([])).toBeNull();
  });
});

describe("habitTimeText (R4)", () => {
  test("one habit, one sentence: «Es hora de Leer.»", () => {
    expect(habitTimeText("Leer")).toBe("Es hora de Leer.");
    expect(habitTimeText("Meditar 10 min")).toBe("Es hora de Meditar 10 min.");
  });

  test("one line, whatever the name", () => {
    expect(habitTimeText("Hábito ".repeat(10).trim()).split("\n")).toHaveLength(1);
  });
});

describe("no forbidden word or sign", () => {
  test("in any sentence a reminder can say", () => {
    const texts = [
      briefingText({ habitsToday: 3, tasksDueToday: 2, paymentsDueToday: [NETFLIX, LUZ] }, true),
      briefingText({ habitsToday: 1 }, false),
      briefingText({ tasksDueToday: 1 }, false),
      briefingText({ paymentsDueToday: [AGUA] }, true),
      paymentEveText(NETFLIX, { showAmounts: true }),
      paymentEveText(NETFLIX, { showAmounts: false, day: "today" }),
      paymentFollowupText(NETFLIX, "2026-10-05"),
      eveningReviewText(["Leer"]),
      eveningReviewText(["Leer", "Meditar"]),
      eveningReviewText(["Leer", "Meditar", "Correr", "Agua", "Yoga"]),
      habitTimeText("Leer"),
      habitTimeText("Meditar 10 min"),
    ] as string[];
    const found = texts.flatMap((text) =>
      FORBIDDEN.filter((word) => text.toLowerCase().includes(word)).map((word) => ({ text, word })),
    );
    expect(found).toEqual([]);
  });
});
