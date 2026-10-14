// E1 of `finance-email`: the contract of the parsers (E2 adds the other formats). Fixtures are
// invented with the shape of the real emails; the real ones never enter the repo.
import { describe, expect, test } from "vitest";
import { parseAmountToCents } from "@/modules/finance/email/parsers/amounts";
import { parseEmail } from "@/modules/finance/email/parsers";
import type { EmailMessage } from "@/modules/finance/email/types";

const BBVA_TEXT = ` BBVA

| |
| # Hola, ANA |

| ## Has realizado el siguiente consumo: |

| Comercio: TIENDA DEMO SAC | |

| Monto: 43.20 | Moneda: PEN |

| Fecha: 11/10/2026 | Hora: 14:52:43 |

| | Este se cargará a tu tarjeta terminada en *1234 |
`;

const message = (over: Partial<EmailMessage> = {}): EmailMessage => ({
  id: "abc12345def67890",
  from: "procesos@bbva.com.pe",
  subject: "Has realizado un consumo con tu tarjeta BBVA",
  receivedAt: new Date("2026-10-11T19:52:46Z"),
  text: BBVA_TEXT,
  senderVerified: true,
  ...over,
});

describe("parseAmountToCents", () => {
  test.each([
    ["43.20", 4320],
    ["20.00", 2000],
    ["6.46", 646],
    ["10378.20", 1037820],
    ["1,000.50", 100050],
    ["5", 500],
    ["0.5", 50],
  ])("%s → %i", (raw, cents) => {
    expect(parseAmountToCents(raw)).toBe(cents);
  });

  test.each(["", "abc", "1,000", "1.000,50", "0", "0.00", "-5", "1.234", "12 .30", "999999999999"])(
    "refuses %j (ambiguous or out of range)",
    (raw) => {
      expect(parseAmountToCents(raw)).toBeNull();
    },
  );
});

describe("BBVA purchase", () => {
  test("reads merchant, amount, currency, Lima day and card", () => {
    expect(parseEmail(message())).toEqual({
      type: "reading",
      source: "bbva",
      reading: {
        kind: "card",
        amountCents: 4320,
        currency: "PEN",
        merchant: "TIENDA DEMO SAC",
        occurredOn: "2026-10-11",
        cardLast4: "1234",
      },
    });
  });

  test("the currency comes from «Moneda:» (USD)", () => {
    const outcome = parseEmail(message({ text: BBVA_TEXT.replace("Moneda: PEN", "Moneda: USD") }));
    expect(outcome.type === "reading" && outcome.reading.currency).toBe("USD");
  });

  test("a card is optional", () => {
    const outcome = parseEmail(message({ text: BBVA_TEXT.replace(/terminada en \*1234/, "") }));
    expect(outcome.type === "reading" && outcome.reading.cardLast4).toBeNull();
  });

  test.each([
    ["no merchant", BBVA_TEXT.replace("Comercio: TIENDA DEMO SAC", "")],
    ["no amount", BBVA_TEXT.replace("Monto: 43.20", "Monto: ")],
    ["an impossible date", BBVA_TEXT.replace("11/10/2026", "31/02/2026")],
    ["a currency it does not know", BBVA_TEXT.replace("Moneda: PEN", "Moneda: EUR")],
    ["an empty body", ""],
  ])("%s is unreadable and never throws", (_label, text) => {
    expect(parseEmail(message({ text }))).toEqual({ type: "unreadable", source: "bbva" });
  });

  test.each(["00/10/0000", "11/10/1999", "11/10/2101"])(
    "a day outside 2000–2100 (%s) is unreadable",
    (day) => {
      expect(parseEmail(message({ text: BBVA_TEXT.replace("11/10/2026", day) }))).toEqual({
        type: "unreadable",
        source: "bbva",
      });
    },
  );

  test("control characters never reach the merchant", () => {
    const outcome = parseEmail(
      message({ text: BBVA_TEXT.replace("TIENDA DEMO SAC", "TIENDA\u0000 DEMO") }),
    );
    expect(outcome.type === "reading" && outcome.reading.merchant).toBe("TIENDA DEMO");
  });

  test("accepts «Name <address>» senders, in any case", () => {
    expect(parseEmail(message({ from: "BBVA <PROCESOS@BBVA.COM.PE>" })).type).toBe("reading");
  });
});

describe("relevance: exact sender AND a known subject", () => {
  test.each([
    ["a look-alike domain", { from: "procesos@bbva.com.pe.evil.test" }],
    ["a look-alike local part", { from: "xprocesos@bbva.com.pe" }],
    ["another sender", { from: "bcpcomunica@email.bcp.com.pe" }],
    [
      "the bank's address inside a quoted display name",
      { from: '"<procesos@bbva.com.pe>" <x@evil.test>' },
    ],
    ["two addresses", { from: "procesos@bbva.com.pe@evil.test" }],
    [
      "a display name with the address and no angle brackets",
      { from: "BBVA procesos@bbva.com.pe" },
    ],
    ["promotional BBVA subject", { subject: "JHORMAN, revisa el estado de cuenta de tu tarjeta" }],
  ])("%s is unknown", (_label, over) => {
    expect(parseEmail(message(over))).toEqual({ type: "unknown" });
  });

  test("payments of the own card and own-account moves are ignored, not expenses", () => {
    for (const subject of [
      "BBVA - Constancia Pago de Tarjetas propias",
      "BBVA - Constancia Transf. a ctas. propias",
    ]) {
      expect(parseEmail(message({ subject }))).toEqual({ type: "ignored" });
    }
    expect(
      parseEmail(
        message({
          from: "notificaciones@notificacionesbcp.com.pe",
          subject:
            "Constancia de Pago de Tarjeta de Crédito Propia - Servicio de Notificaciones BCP",
        }),
      ),
    ).toEqual({ type: "ignored" });
  });
});
