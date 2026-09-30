// @vitest-environment node
import { describe, expect, test } from "vitest";
import { formatPasskeyDate, passkeyLabel, UNNAMED_PASSKEY_LABEL } from "@/modules/core/passkeys";

describe("passkey display helpers", () => {
  test("dates are in Spanish and in Lima time (UTC-5)", () => {
    expect(formatPasskeyDate(new Date("2026-09-30T15:00:00Z"))).toBe("30 de setiembre de 2026");
    // 02:00 UTC on Oct 1st is still Sep 30th in Lima.
    expect(formatPasskeyDate(new Date("2026-10-01T02:00:00Z"))).toBe("30 de setiembre de 2026");
  });

  test("label: the given name, else the known authenticator, else a generic label", () => {
    expect(passkeyLabel(" iPhone ", null)).toBe("iPhone");
    expect(passkeyLabel(null, "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4")).toBe(
      "Google Password Manager",
    );
    expect(passkeyLabel("", "00000000-0000-0000-0000-000000000000")).toBe(UNNAMED_PASSKEY_LABEL);
    expect(passkeyLabel(null, null)).toBe(UNNAMED_PASSKEY_LABEL);
  });
});
