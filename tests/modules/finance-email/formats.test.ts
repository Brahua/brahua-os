// E2 of `finance-email`: one reader per format seen in the owner's emails, against fixtures shaped
// like the real ones (see fixtures.ts), plus the dates, the ignored formats and «Mis nombres».
import { describe, expect, test } from "vitest";
import { isOwnName } from "@/modules/finance/email/own-names";
import { parseEmail } from "@/modules/finance/email/parsers";
import { parseSpanishDay } from "@/modules/finance/email/parsers/text";
import {
  BBVA_INTERBANK,
  BBVA_PLIN,
  BCP_CARD,
  BCP_TRANSFER,
  LAYOUT_NAMES,
  LAYOUTS,
  SUBJECTS,
  YAPE_PAYMENT,
  mail,
} from "./fixtures";

const reading = (outcome: ReturnType<typeof parseEmail>) => {
  if (outcome.type !== "reading") throw new Error(`expected a reading, got ${outcome.type}`);
  return outcome.reading;
};

describe("parseSpanishDay: the four shapes of the banks (and their variations)", () => {
  test.each([
    ["14 de octubre de 2026 - 12:10 AM", "2026-10-14"],
    ["11 de Octubre de 2026 - 09:53 AM", "2026-10-11"],
    ["12 octubre 2026 - 07:36 p. m.", "2026-10-12"],
    ["04 octubre, 2026 09:51", "2026-10-04"],
    ["3 de octubre, 2026 17:19", "2026-10-03"],
    ["1 de setiembre de 2026", "2026-09-01"],
    ["31 de diciembre de 2026 - 11:59 PM", "2026-12-31"],
  ])("%s → %s", (raw, day) => {
    expect(parseSpanishDay(raw)).toBe(day);
  });

  test.each([
    "",
    "octubre 2026",
    "31 de febrero de 2026",
    "14 de octubrre de 2026",
    "14 de octubre de 1999",
    "14 de octubre de 2101",
  ])("%j is not a day", (raw) => {
    expect(parseSpanishDay(raw)).toBeNull();
  });
});

describe("BCP purchase", () => {
  test("credit card in dollars", () => {
    expect(reading(parseEmail(mail("bcp", SUBJECTS.bcpCredit, BCP_CARD({}))))).toEqual({
      kind: "card",
      amountCents: 646,
      currency: "USD",
      merchant: "TIENDA DEMO+",
      occurredOn: "2026-10-14",
      cardLast4: "1111",
    });
  });

  test("debit card in soles, the debit subject", () => {
    const r = reading(
      parseEmail(
        mail(
          "bcp",
          SUBJECTS.bcpDebit,
          BCP_CARD({
            kind: "Débito",
            symbol: "S/",
            amount: "132.50",
            company: "CINE DEMO",
            card: "2222",
          }),
        ),
      ),
    );
    expect(r).toMatchObject({
      currency: "PEN",
      amountCents: 13250,
      cardLast4: "2222",
      kind: "card",
    });
  });

  test("a payment through Plin is a transfer to a person, without the PLIN- prefix", () => {
    const r = reading(
      parseEmail(
        mail(
          "bcp",
          SUBJECTS.bcpDebit,
          BCP_CARD({ kind: "Débito", symbol: "S/", amount: "20.00", company: "PLIN-MARIA DEMO" }),
        ),
      ),
    );
    expect(r).toMatchObject({ kind: "transfer", merchant: "MARIA DEMO", amountCents: 2000 });
  });

  test("a company with symbols and a star stays as written", () => {
    const r = reading(
      parseEmail(
        mail(
          "bcp",
          SUBJECTS.bcpCredit,
          BCP_CARD({ company: "DLC*helphbomaxcom", symbol: "S/", amount: "26.90" }),
        ),
      ),
    );
    expect(r.merchant).toBe("DLC*helphbomaxcom");
  });

  test.each([
    [
      "no company anywhere (sentence or row)",
      BCP_CARD({})
        .replace(/\| Empresa \|[^\n]*\n/, "")
        .replace(/ en TIENDA DEMO\+\./, "."),
    ],
    ["no amount sentence", BCP_CARD({}).replace("consumo de", "consumo")],
    ["no date", BCP_CARD({}).replace(/\| Fecha y hora \|[^\n]*\n/, "")],
    ["a date it cannot read", BCP_CARD({ when: "ayer por la noche" })],
    ["an ambiguous amount", BCP_CARD({ amount: "1,000" })],
  ])("%s is unreadable", (_label, text) => {
    expect(parseEmail(mail("bcp", SUBJECTS.bcpCredit, text))).toEqual({
      type: "unreadable",
      source: "bcp",
    });
  });
});

describe("BCP transfer to a third party", () => {
  test("amount, recipient and day", () => {
    expect(reading(parseEmail(mail("bcp", SUBJECTS.bcpTransfer, BCP_TRANSFER())))).toEqual({
      kind: "transfer",
      amountCents: 40000,
      currency: "PEN",
      merchant: "Perez Quispe Maria L.",
      occurredOn: "2026-10-11",
      cardLast4: null,
    });
  });

  test("a missing recipient is unreadable", () => {
    const text = BCP_TRANSFER().replace(/Enviado a \*[^*]*\*/, "");
    expect(parseEmail(mail("bcp", SUBJECTS.bcpTransfer, text))).toEqual({
      type: "unreadable",
      source: "bcp",
    });
  });
});

describe("Yape payment", () => {
  test("the merchant is on the line before «fue exitoso»", () => {
    expect(reading(parseEmail(mail("yape", SUBJECTS.yape, YAPE_PAYMENT())))).toEqual({
      kind: "yape",
      amountCents: 4990,
      currency: "PEN",
      merchant: "TIENDA YAPE",
      occurredOn: "2026-10-12",
      cardLast4: null,
    });
  });

  test("an amount glued to the symbol and the p. m. clock still read", () => {
    const text = YAPE_PAYMENT().replace("S/ 49.90", "S/49.90");
    expect(reading(parseEmail(mail("yape", SUBJECTS.yape, text))).amountCents).toBe(4990);
  });

  test("without the amount it is unreadable", () => {
    const text = YAPE_PAYMENT().replace(/Monto total[^\n]*/, "");
    expect(parseEmail(mail("yape", SUBJECTS.yape, text)).type).toBe("unreadable");
  });
});

describe("BBVA Plin", () => {
  test.each([SUBJECTS.bbvaPlin, SUBJECTS.bbvaPlinQr])("%s", (subject) => {
    expect(reading(parseEmail(mail("bbva", subject, BBVA_PLIN())))).toEqual({
      kind: "transfer",
      amountCents: 5000,
      currency: "PEN",
      merchant: "Luis M Torres R",
      occurredOn: "2026-10-03",
      cardLast4: null,
    });
  });

  test("without a recipient it is unreadable", () => {
    const text = BBVA_PLIN().replace(/a Luis M Torres R/, "");
    expect(parseEmail(mail("bbva", SUBJECTS.bbvaPlin, text)).type).toBe("unreadable");
  });
});

describe("BBVA interbank transfer", () => {
  test("to someone else it is a suggestion for the beneficiary", () => {
    expect(reading(parseEmail(mail("bbva", SUBJECTS.bbvaInterbank, BBVA_INTERBANK())))).toEqual({
      kind: "transfer",
      amountCents: 100000,
      currency: "PEN",
      merchant: "Carlos Demo Rojas",
      occurredOn: "2026-10-04",
      cardLast4: null,
    });
  });

  test("«Esta cuenta es propia» is ignored", () => {
    expect(
      parseEmail(
        mail("bbva", SUBJECTS.bbvaInterbank, BBVA_INTERBANK({ own: true, to: "Ana Demo" })),
      ),
    ).toEqual({ type: "ignored" });
  });

  test("a beneficiary equal to the holder is ignored, with accents and case apart", () => {
    const text = BBVA_INTERBANK({ holder: "Ana Pérez Quispe", to: "ANA PEREZ QUISPE" });
    expect(parseEmail(mail("bbva", SUBJECTS.bbvaInterbank, text))).toEqual({ type: "ignored" });
  });
});

describe("«Mis nombres»", () => {
  const own = ["Jhorman Josue Bravo Huaman"];

  test.each([
    "Jhorman J Bravo H",
    "JHORMAN JOSUE BRAVO HUAMAN",
    "Bravo Huaman Jhorman",
    "jhorman bravo",
  ])("%s is the owner except when out of order", (name) => {
    expect(isOwnName(name, own)).toBe(name !== "Bravo Huaman Jhorman");
  });

  test.each(["Huaman Loayza Jessica P.", "Jhorman Perez", "Jhorman", "Leonardo I Dino G", ""])(
    "%j is someone else (or too short to say)",
    (name) => {
      expect(isOwnName(name, own)).toBe(false);
    },
  );

  test("with no names set nobody is the owner", () => {
    expect(isOwnName("Jhorman J Bravo H", [])).toBe(false);
  });
});

// How Gmail's plain body lays a table out is not ours to count on: each format reads the same in
// every layout (the real BCP emails are HTML only; the first BCP fix came from this).
describe.each(LAYOUT_NAMES)("layout: %s", (layout) => {
  const lay = LAYOUTS[layout];
  const BBVA_CONSUMPTION =
    "| Comercio: TIENDA DEMO SAC | |\n| Monto: 43.20 | Moneda: PEN |\n| Fecha: 11/10/2026 | Hora: 14:52:43 |\n| Este se cargará a tu tarjeta terminada en *1234 |\n";

  test("BCP purchase (credit, USD)", () => {
    expect(reading(parseEmail(mail("bcp", SUBJECTS.bcpCredit, lay(BCP_CARD({})))))).toEqual({
      kind: "card",
      amountCents: 646,
      currency: "USD",
      merchant: "TIENDA DEMO+",
      occurredOn: "2026-10-14",
      cardLast4: "1111",
    });
  });

  test("BCP purchase through Plin (debit): a transfer to a person", () => {
    const text = lay(
      BCP_CARD({ kind: "Débito", symbol: "S/", amount: "20.00", company: "PLIN-MARIA DEMO" }),
    );
    expect(reading(parseEmail(mail("bcp", SUBJECTS.bcpDebit, text)))).toMatchObject({
      kind: "transfer",
      merchant: "MARIA DEMO",
      amountCents: 2000,
      occurredOn: "2026-10-14",
    });
  });

  test("a merchant with a dot inside is not cut", () => {
    const text = lay(BCP_CARD({ company: "TIENDA S.A.C. DEMO" }));
    expect(reading(parseEmail(mail("bcp", SUBJECTS.bcpCredit, text))).merchant).toBe(
      "TIENDA S.A.C. DEMO",
    );
  });

  test("BCP transfer to a third party", () => {
    expect(
      reading(parseEmail(mail("bcp", SUBJECTS.bcpTransfer, lay(BCP_TRANSFER())))),
    ).toMatchObject({
      kind: "transfer",
      amountCents: 40000,
      merchant: "Perez Quispe Maria L.",
      occurredOn: "2026-10-11",
    });
  });

  test("BBVA purchase", () => {
    expect(
      reading(
        parseEmail(
          mail("bbva", "Has realizado un consumo con tu tarjeta BBVA", lay(BBVA_CONSUMPTION)),
        ),
      ),
    ).toMatchObject({
      merchant: "TIENDA DEMO SAC",
      amountCents: 4320,
      occurredOn: "2026-10-11",
      cardLast4: "1234",
    });
  });

  test("BBVA Plin", () => {
    expect(reading(parseEmail(mail("bbva", SUBJECTS.bbvaPlin, lay(BBVA_PLIN()))))).toMatchObject({
      merchant: "Luis M Torres R",
      amountCents: 5000,
      occurredOn: "2026-10-03",
    });
  });

  test("BBVA interbank: to someone else, and to the holder (ignored)", () => {
    expect(
      reading(parseEmail(mail("bbva", SUBJECTS.bbvaInterbank, lay(BBVA_INTERBANK())))),
    ).toMatchObject({
      merchant: "Carlos Demo Rojas",
      amountCents: 100000,
      occurredOn: "2026-10-04",
    });
    expect(
      parseEmail(
        mail(
          "bbva",
          SUBJECTS.bbvaInterbank,
          lay(BBVA_INTERBANK({ holder: "Ana Demo Perez", to: "Ana Demo Perez" })),
        ),
      ),
    ).toEqual({ type: "ignored" });
  });

  test("Yape payment", () => {
    expect(reading(parseEmail(mail("yape", SUBJECTS.yape, lay(YAPE_PAYMENT()))))).toMatchObject({
      merchant: "TIENDA YAPE",
      amountCents: 4990,
      occurredOn: "2026-10-12",
    });
  });
});
