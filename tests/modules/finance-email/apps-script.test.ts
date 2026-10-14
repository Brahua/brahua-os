// E4 of `finance-email`: the reference Apps Script lives outside the app (in the owner's Google
// account), so nothing would notice if it drifted from the endpoint. This pins what it must share
// with the code, and that it carries no secret.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  MAX_EMAIL_TEXT_LENGTH,
  MAX_INGEST_BODY_BYTES,
  MAX_MESSAGES_PER_BATCH,
} from "@/modules/finance/email/constants";
import { parseEmail } from "@/modules/finance/email/parsers";
import { mail, SUBJECTS, YAPE_PAYMENT } from "./fixtures";

const SCRIPT = readFileSync(path.join(process.cwd(), "docs/finance-email-apps-script.js"), "utf8");
const number = (name: string) => Number(new RegExp(`var ${name} = (\\d+)`).exec(SCRIPT)?.[1]);

describe("docs/finance-email-apps-script.js", () => {
  test("its limits fit what the endpoint accepts", () => {
    expect(number("BATCH_SIZE")).toBeLessThanOrEqual(MAX_MESSAGES_PER_BATCH);
    expect(number("TEXT_LIMIT")).toBe(MAX_EMAIL_TEXT_LENGTH);
    // A full batch of full texts (escaped, worst case twice the size) stays under the body limit.
    expect(number("BATCH_SIZE") * number("TEXT_LIMIT") * 2).toBeLessThan(MAX_INGEST_BODY_BYTES);
  });

  test("it searches exactly the senders the app reads", () => {
    const senders = [...SCRIPT.matchAll(/'([^']+@[^']+)'/g)].map((m) => m[1]);
    expect(senders.sort()).toEqual(
      [
        "notificaciones@notificacionesbcp.com.pe",
        "procesos@bbva.com.pe",
        "notificaciones@yape.pe",
      ].sort(),
    );
    // Each is recognised by the app for at least one of its subjects.
    const known = [
      ["notificaciones@notificacionesbcp.com.pe", SUBJECTS.bcpTransfer],
      ["procesos@bbva.com.pe", SUBJECTS.bbvaInterbank],
      ["notificaciones@yape.pe", SUBJECTS.yape],
    ];
    for (const [from, subject] of known) {
      const outcome = parseEmail({ ...mail("yape", subject, YAPE_PAYMENT()), from });
      expect(outcome.type, from).not.toBe("unknown");
    }
  });

  test("it sends the shape the endpoint validates, with the Bearer secret", () => {
    for (const field of ["id:", "from:", "subject:", "receivedAt:", "text:", "auth:"]) {
      expect(SCRIPT).toContain(field);
    }
    expect(SCRIPT).toContain("'Bearer ' + secret");
    expect(SCRIPT).toContain("/api/finance/email-ingest");
    for (const verdict of ["'pass'", "'fail'", "'none'"]) expect(SCRIPT).toContain(verdict);
  });

  test("it carries no secret: the URL and the secret come from the script properties", () => {
    expect(SCRIPT).toMatch(/getProperty\('FINANCE_EMAIL_SECRET'\)/);
    expect(SCRIPT).not.toMatch(/Bearer [A-Za-z0-9_-]{16,}/);
    expect(SCRIPT).not.toMatch(/FINANCE_EMAIL_SECRET'?\s*[:=]\s*['"][^'"]{8,}/);
  });
});
